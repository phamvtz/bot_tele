import { ObjectId } from "mongodb";
import { prisma } from "./db.js";
import { sendLog, warnOnce } from "./lib/logger.js";
import { buildOfferMessage, FLASH_COPY, flashPricePair, flashPerMLine } from "./flash-sale-text.js";
import { getProductDeepLink } from "./telegram-links.js";
import { escapeHtml } from "./bot-ui/format.js";
import {
    FLASH_STATUS,
    LIVE_STATUSES,
    FLASH_RESPONSE,
    DEFAULT_SECS_PER_USER,
    MEASURE_BUFFER,
    normalizeDiscountPct,
    discountedUnitPrice,
    isTotalDiscountProduct,
    flashPriceFor,
    estimateOpensAt,
    sendProgressView,
    evaluateClaim,
    evaluateSkip,
    pickBestOffer,
    offerMinutesLeft,
} from "./flash-sale-math.js";

/**
 * Flash Sale — đợt giảm giá giới hạn suất, gửi cho TOÀN BỘ khách rồi mới MỞ.
 *
 * Ba quyết định thiết kế đáng giá nhất nằm ở đây, đều xuất phát từ một sự thật:
 * tính năng này đụng TRỰC TIẾP vào số tiền khách phải trả.
 *
 * 1. GỬI TRƯỚC, MỞ SAU. Nếu mở rồi mới gửi thì ~20 tin/giây nghĩa là người nhận
 *    tin sớm hơn sẽ giành suất trước — thứ tự gửi (một chi tiết kỹ thuật) quyết định
 *    ai được mua giá rẻ. Vì vậy thời điểm mở được IN RA ngay trong tin ưu đãi, tính
 *    từ số khách và tốc độ gửi đo được, rồi bot mới bắt đầu gửi.
 *
 * 2. HAI LUẬT GIÁ KHÁC NHAU (xem `flashPriceFor`). Hàng thường giảm trên GIÁ ĐƠN VỊ
 *    (số nguyên, floor). API key giảm trên TỔNG ĐƠN: giá 1M token là 1 cent, giảm
 *    30% giá đơn vị ra 0.7 cent rồi bị làm tròn NGƯỢC LẠI 1 cent — khách mua 100M
 *    token vẫn trả đủ 100 cent và ưu đãi biến mất không dấu vết. Giảm trên tổng thì
 *    100 cent còn 70 cent.
 *
 * 3. MỌI thứ atomic đều là `updateOne` có điều kiện trên raw collection, KHÔNG phải
 *    `$transaction` — adapter prisma của repo này chỉ là `Promise.all` (xem cảnh báo
 *    ở lib/prisma.js). Claim suất vì thế dùng `$expr` để so HAI FIELD với nhau
 *    (`acceptedCount < maxSlots`), điều mà `mapWhere` của adapter không diễn đạt được.
 */

/** Setting tự sinh: giây/người đo được từ LẦN GỬI TRƯỚC, nhân hệ số an toàn. */
export const SECS_PER_USER_KEY = "flash_send_secs_per_user";

/** Lease của vòng gửi. Process chết thì sau khoảng này process khác được tiếp quản. */
export const SEND_LEASE_MS = 60000;
export const LEASE_REFRESH_EVERY = 10;

/** Số người mỗi mẻ đọc từ DB. */
export const SEND_BATCH = 100;

/** Nhịp nghỉ giữa hai tin — khớp broadcast.js (50ms ≈ 20 tin/giây). */
export const SEND_THROTTLE_MS = Number(process.env.FLASH_SEND_THROTTLE_MS || 50);

/** Trần số sale quét mỗi tick — chạm trần thì phải kêu, không im lặng. */
export const TICK_SCAN_MAX = 50;

// Phần toán thuần sống ở `flash-sale-math.js` (không I/O) để `bot-ui/messages.js`
// dùng được mà không kéo theo Mongo client. Re-export ở đây để mọi caller cũ vẫn
// import từ một chỗ.
export {
    FLASH_STATUS,
    FLASH_RESPONSE,
    LIVE_STATUSES,
    DEFAULT_SECS_PER_USER,
    MEASURE_BUFFER,
    OPEN_SAFETY_MS,
    normalizeDiscountPct,
    discountedUnitPrice,
    ceilCents,
    discountedUsdTotal,
    discountedUsdPerM,
    isTotalDiscountProduct,
    flashPriceFor,
    roundUpToMinute,
    estimateOpensAt,
    sendProgressView,
    progressBar,
    evaluateClaim,
    evaluateSkip,
    pickBestOffer,
    offerMinutesLeft,
} from "./flash-sale-math.js";

// ─── Helpers DB ─────────────────────────────────────────────────────────────────────

const toOid = (value) => {
    try { return ObjectId.isValid(value) ? new ObjectId(value) : value; } catch { return value; }
};

const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);

/** Nối nhãn cho log kênh admin. `sendLog` dùng parse_mode Markdown nên phải escape. */
const md = (s) => String(s ?? "").replace(/([_*\[\]`])/g, "\\$1");

/**
 * Giá $/1M token của cửa hàng API key, cho dòng `~~0.01~~ → 0.007 / 1M token` (§4).
 *
 * Không đọc được thì trả 0 và `flashPerMLine` chỉ nêu % — thà thiếu một con số trang
 * trí còn hơn in ra một giá $/1M bịa đặt trên tin gửi cho TOÀN BỘ khách hàng.
 */
export async function readPerMUsd(sale = null) {
    try {
        const { getConfig, getProfileConfig } = await import("./gpt2api.js");
        if (sale?.targetProfileId) {
            const pcfg = await getProfileConfig(sale.targetProfileId).catch(() => null);
            if (pcfg && Number(pcfg.usdPerMtoken) > 0) return Number(pcfg.usdPerMtoken);
        }
        return Number((await getConfig())?.usdPerMtoken) || 0;
    } catch {
        return 0;
    }
}

async function saleCollection() {
    return prisma.flashSale.collection();
}

// ─── Cài đặt tốc độ gửi (§3) ────────────────────────────────────────────────────────

export async function getSendSecsPerUser() {
    try {
        const row = await prisma.setting.findUnique({ where: { key: SECS_PER_USER_KEY } });
        const v = Number(row?.value);
        if (Number.isFinite(v) && v > 0 && v < 10) return v;
    } catch { /* setting chưa có — dùng mặc định */ }
    return DEFAULT_SECS_PER_USER;
}

/**
 * Ghi lại tốc độ ĐO ĐƯỢC của lần gửi vừa rồi để lần sau dự đoán giờ mở sát hơn.
 * Nhân `MEASURE_BUFFER` vì thà in ra một giờ mở hơi trễ (bot chờ, khách vẫn nhận được
 * đúng lời hứa) còn hơn in ra giờ sớm rồi phải mở trễ — lúc đó lời hứa bị phá vỡ.
 */
export async function recordSendMeasurement({ sentCount = 0, elapsedMs = 0 } = {}) {
    const n = Number(sentCount) || 0;
    const ms = Number(elapsedMs) || 0;
    if (n <= 0 || ms <= 0) return null;
    const measured = (ms / 1000 / n) * MEASURE_BUFFER;
    if (!Number.isFinite(measured) || measured <= 0) return null;
    const value = String(Math.min(10, Math.max(0.005, Number(measured.toFixed(4)))));
    await prisma.setting.upsert({
        where: { key: SECS_PER_USER_KEY },
        update: { value },
        create: { key: SECS_PER_USER_KEY, value },
    }).catch(() => {});
    return Number(value);
}

// ─── Cache ưu đãi đang sống ─────────────────────────────────────────────────────────

/**
 * Mỗi lần render màn sản phẩm mà hỏi DB hai câu (response + sale) là nhân đôi số
 * round-trip trên đường nóng. TTL ngắn vì hạn ưu đãi tính bằng PHÚT, còn 5s sai lệch
 * thì không ai cảm nhận được.
 *
 * Bị xoá ngay khi khách claim/skip (`invalidateFlashOfferCache`) — nếu không thì
 * khách vừa bấm Nhận xong bấm Mua vẫn thấy giá gốc trong 5 giây, đúng lúc họ đang
 * kiểm tra xem ưu đãi có thật không.
 */
const OFFER_CACHE_TTL = 5000;
const _offerCache = new Map();

export function invalidateFlashOfferCache(telegramId) {
    if (telegramId === undefined || telegramId === null) { _offerCache.clear(); return; }
    for (const key of _offerCache.keys()) {
        if (key.startsWith(`${telegramId}:`)) _offerCache.delete(key);
    }
}

/**
 * Dựng shape của một offer từ (sale, response). MỘT chỗ duy nhất, để bản đơn và bản
 * gộp không lệch nhau về tên field — lệch một cái là màn này hiện ưu đãi, màn kia thì
 * không, và khách đọc ra hai giá cho cùng một món hàng.
 */
function toOffer(sale, response) {
    return {
        saleId: sale.id,
        productId: sale.productId,
        productName: sale.productName || "",
        discountPct: normalizeDiscountPct(sale.discountPct),
        expiresAt: response?.expiresAt ?? sale.expiresAt ?? null,
        validityMinutes: num(sale.validityMinutes, 60),
        responseId: response?.id ?? null,
        totalDiscount: isTotalDiscountProduct(sale),
        targetProfileId: sale.targetProfileId !== null && sale.targetProfileId !== undefined ? Number(sale.targetProfileId) : null,
        priceBefore: Number(sale.productPrice) || 0,
    };
}

/**
 * Ưu đãi flash sale ĐANG SỐNG của MỘT khách cho MỘT sản phẩm, hoặc null.
 *
 * Chỉ nhìn `FlashSaleResponse.expiresAt` của chính khách đó — KHÔNG nhìn trạng thái
 * đợt. Lý do (§5): đợt đã FULL/CLOSED thì người kịp nhận trước đó vẫn dùng ưu đãi
 * tới hết hạn của riêng họ.
 *
 * `isAdmin` → luôn null. Admin phải thấy GIÁ GỐC, nếu không màn sửa giá trong
 * /admin bị chính ưu đãi che mất và admin không biết mình đang sửa từ số nào (§4).
 *
 * `profileId` → nếu được truyền (đơn API key), chỉ match ưu đãi của đúng server đó
 * hoặc ưu đãi chung cho mọi server (targetProfileId == null).
 */
export async function getActiveFlashOffer(telegramId, productId, { now = Date.now(), isAdmin = false, profileId = null } = {}) {
    if (isAdmin) return null;
    const tg = String(telegramId ?? "").trim();
    const pid = String(productId ?? "").trim();
    if (!tg || !pid) return null;

    const pKey = profileId !== null && profileId !== undefined ? String(profileId) : "all";
    const cacheKey = `${tg}:${pid}:${pKey}`;
    const hit = _offerCache.get(cacheKey);
    if (hit && now - hit.ts < OFFER_CACHE_TTL) return hit.value;

    let value = null;
    try {
        const rows = await prisma.flashSaleResponse.findMany({
            where: { telegramId: tg, kind: FLASH_RESPONSE.ACCEPT, expiresAt: { gt: new Date(now) } },
        });
        if (rows.length) {
            const sales = await prisma.flashSale.findMany({
                where: { id: { in: rows.map((r) => r.flashSaleId).filter(Boolean) }, productId: pid },
            });
            const byId = new Map(sales.map((s) => [s.id, s]));
            const offers = rows
                .map((r) => {
                    const sale = byId.get(r.flashSaleId);
                    if (!sale) return null;
                    if (profileId !== null && profileId !== undefined) {
                        const targetPid = sale.targetProfileId !== null && sale.targetProfileId !== undefined
                            ? Number(sale.targetProfileId)
                            : null;
                        if (targetPid !== null && targetPid !== Number(profileId)) {
                            return null;
                        }
                    }
                    return toOffer(sale, r);
                })
                .filter((o) => o && normalizeDiscountPct(o.discountPct) > 0);
            value = pickBestOffer(offers);
        }
    } catch (err) {
        // KHÔNG ném. Đây là đường hiển thị giá: một lỗi DB thoáng qua mà làm crash
        // handler thì khách không mua được gì cả. Giá gốc là fallback an toàn duy nhất.
        console.error("[flash-sale] getActiveFlashOffer failed:", err?.message);
        return null;
    }

    // Cache cả giá trị null: phần lớn khách KHÔNG có ưu đãi, và nếu không cache bản
    // rỗng thì mỗi lần họ mở một màn sản phẩm lại tốn hai query vô ích.
    _offerCache.set(cacheKey, { value, ts: now });
    return value;
}

/**
 * Bản GỘP cho màn danh sách — đúng HAI query bất kể danh sách dài bao nhiêu.
 *
 * Gọi `getActiveFlashOffer` cho từng sản phẩm là 2N query; với 8 sản phẩm một trang
 * và Atlas ~200ms/query thì mỗi lần khách bấm sang trang là ~3 giây chờ.
 *
 * Trả `Map<productId, offer|null>` — luôn đủ khoá cho mọi productId hỏi, để caller
 * không phải phân biệt "không có ưu đãi" với "chưa tra".
 */
export async function getActiveFlashOffers(telegramId, productIds, { now = Date.now(), isAdmin = false } = {}) {
    const out = new Map();
    const ids = [...new Set((productIds || []).map((x) => String(x ?? "").trim()).filter(Boolean))];
    if (isAdmin || !ids.length) {
        for (const pid of ids) out.set(pid, null);
        return out;
    }
    const tg = String(telegramId ?? "").trim();
    if (!tg) {
        for (const pid of ids) out.set(pid, null);
        return out;
    }

    const missing = [];
    for (const pid of ids) {
        const hit = _offerCache.get(`${tg}:${pid}`);
        if (hit && now - hit.ts < OFFER_CACHE_TTL) out.set(pid, hit.value);
        else missing.push(pid);
    }
    if (!missing.length) return out;

    const byProduct = new Map();
    try {
        const rows = await prisma.flashSaleResponse.findMany({
            where: { telegramId: tg, kind: FLASH_RESPONSE.ACCEPT, expiresAt: { gt: new Date(now) } },
        });
        const saleIds = rows.map((r) => r.flashSaleId).filter(Boolean);
        if (saleIds.length) {
            const sales = await prisma.flashSale.findMany({
                where: { id: { in: saleIds }, productId: { in: missing } },
            });
            const respBySale = new Map(rows.map((r) => [r.flashSaleId, r]));
            for (const sale of sales) {
                const offer = toOffer(sale, respBySale.get(sale.id));
                if (!normalizeDiscountPct(offer.discountPct)) continue;
                const prev = byProduct.get(sale.productId);
                byProduct.set(sale.productId, prev ? pickBestOffer([prev, offer]) : offer);
            }
        }
    } catch (err) {
        console.error("[flash-sale] getActiveFlashOffers failed:", err?.message);
        for (const pid of missing) out.set(pid, null);
        return out;
    }

    for (const pid of missing) {
        const value = byProduct.get(pid) || null;
        _offerCache.set(`${tg}:${pid}`, { value, ts: now });
        out.set(pid, value);
    }
    return out;
}

/**
 * Áp MỘT offer đã biết lên product — THUẦN, không I/O. Trả BẢN COPY.
 *
 * ⚠️ bot.js cache product trong `_productCache` và category.js cache cả danh sách
 * sản phẩm trong 30 phút, dùng lại cho MỌI khách. Sửa `product.price` tại chỗ là giá
 * giảm của người này rò sang màn hình — và sang ĐƠN HÀNG — của người không hề nhận
 * ưu đãi. Đây là lý do hàm này spread chứ không mutate.
 */
export function applyOfferToProduct(product, offer) {
    if (!product) return product;
    if (!normalizeDiscountPct(offer?.discountPct)) return product;

    // IDEMPOTENT — chốt này không phải để tối ưu, nó chặn một lỗi TIỀN.
    //
    // Cùng một product có thể đi qua đây hai lần trên một lượt bấm: một lần lúc fetch
    // để hiển thị màn chi tiết, một lần trong `createPendingOrder`. `flashPriceFor`
    // tính % trên GIÁ HIỆN TẠI của object, nên áp hai lần là NHÂN mức giảm — 30% hai
    // lần thành 51%, và khách bị thu ÍT HƠN cả giá ưu đãi đã hứa.
    //
    // So theo `saleId` chứ không theo %: hai đợt khác nhau cùng 30% trên cùng sản
    // phẩm vẫn phải được đổi sang đợt đang sống (xem pickBestOffer).
    if (product.flashOffer && String(product.flashOffer.saleId) === String(offer.saleId)) {
        return product;
    }

    const priced = flashPriceFor(product, offer);
    if (priced.mode === "none") return product;
    return {
        ...product,
        // `mode: "total"` KHÔNG đổi price — giảm áp lên báo giá tổng đơn ở chỗ khác.
        price: priced.price,
        priceBeforeFlash: Number(product.priceBeforeFlash ?? product.price) || 0,
        flashOffer: offer,
        flashMode: priced.mode,
        flashPct: priced.pct,
    };
}

/**
 * Trả product đã áp giá flash sale cho MỘT khách (tự tra offer).
 */
export async function applyFlashToProduct(product, telegramId, { now = Date.now(), isAdmin = false } = {}) {
    if (!product) return product;
    const offer = await getActiveFlashOffer(telegramId, product.id, { now, isAdmin });
    return applyOfferToProduct(product, offer);
}

/**
 * Áp offer cho MỘT DANH SÁCH product, dùng kết quả gộp của `getActiveFlashOffers`.
 * Trả mảng mới; product không có ưu đãi thì giữ nguyên tham chiếu cũ (không copy thừa).
 */
export async function applyFlashToProducts(products, telegramId, { now = Date.now(), isAdmin = false } = {}) {
    const list = Array.isArray(products) ? products : [];
    if (!list.length || isAdmin) return list;
    const offers = await getActiveFlashOffers(telegramId, list.map((p) => p?.id), { now, isAdmin });
    return list.map((p) => (p ? applyOfferToProduct(p, offers.get(String(p.id)) || null) : p));
}


// ─── Tạo / đọc / đóng đợt (§1) ──────────────────────────────────────────────────────

/**
 * Tạo đợt ở trạng thái 📤 SENDING với `opensAt` ĐÃ TÍNH XONG (§3).
 *
 * Giờ mở phải được chốt TRƯỚC khi gửi tin đầu tiên, vì nó được in vào nội dung tin
 * — tính sau thì mỗi khách đọc một giờ khác nhau.
 */
export async function createFlashSale({
    productId, discountPct, validityMinutes = 60, maxSlots = 0,
    adminId = null, now = Date.now(),
    targetProfileId = null, productName = null,
} = {}) {
    const pct = normalizeDiscountPct(discountPct);
    if (!productId) throw new Error("flash sale: thiếu productId");
    if (!pct) throw new Error("flash sale: % giảm không hợp lệ (1–90)");

    const product = await prisma.product.findUnique({ where: { id: productId } });
    if (!product) throw new Error("flash sale: không tìm thấy sản phẩm");

    const normProfileId = targetProfileId !== null && targetProfileId !== undefined ? Number(targetProfileId) : null;

    // Cùng một sản phẩm chỉ nên có MỘT đợt đang sống cho cùng mục tiêu (§8).
    // Nếu là API key và có targetProfileId riêng thì các server khác nhau có thể chạy song song.
    const liveSales = await prisma.flashSale.findMany({
        where: { productId, status: { in: LIVE_STATUSES } },
        select: { id: true, status: true, productName: true, targetProfileId: true },
    });
    const conflict = liveSales.find((s) => {
        const sPid = s.targetProfileId !== null && s.targetProfileId !== undefined ? Number(s.targetProfileId) : null;
        if (normProfileId === null) return true; // Đợt mới áp dụng tất cả -> xung đột với mọi đợt đang sống
        return sPid === null || sPid === normProfileId;
    });
    if (conflict) {
        const err = new Error("Sản phẩm này đang có một đợt flash sale chưa kết thúc");
        err.code = "already_running";
        err.existing = conflict;
        throw err;
    }

    const [customerCount, secsPerUser] = await Promise.all([
        prisma.user.count({ where: { isBlocked: false } }),
        getSendSecsPerUser(),
    ]);

    const startedAt = new Date(now);
    const opensAt = new Date(estimateOpensAt({ startedAt: now, customerCount, secsPerUser }));
    const mins = Math.max(1, Math.min(1440, Math.floor(Number(validityMinutes) || 60)));
    const slots = Math.max(0, Math.floor(Number(maxSlots) || 0));

    const sale = await prisma.flashSale.create({
        data: {
            productId,
            productName: productName || product.name,
            productCurrency: product.currency || "VND",
            productPrice: Number(product.price) || 0,
            totalDiscount: isTotalDiscountProduct(product),
            targetProfileId: normProfileId,
            discountPct: pct,
            validityMinutes: mins,
            maxSlots: slots,
            status: FLASH_STATUS.SENDING,
            createdBy: adminId ? String(adminId) : null,
            recipientTotal: customerCount,
            secsPerUserUsed: secsPerUser,
            sendStartedAt: startedAt,
            opensAt,
        },
    });
    return sale;
}

export async function getFlashSale(id) {
    if (!id) return null;
    return prisma.flashSale.findUnique({ where: { id } });
}

export async function listFlashSales({ take = 30, status = null } = {}) {
    return prisma.flashSale.findMany({
        where: status ? { status } : {},
        orderBy: { createdAt: "desc" },
        take: Math.max(1, Math.min(200, Number(take) || 30)),
    });
}

/**
 * Đóng đợt: ngừng nhận THÊM, nhưng ưu đãi của người đã nhận VẪN SỐNG tới hết hạn
 * của họ (§8). Đây là khác biệt duy nhất giữa "Đóng" và "Xoá", và là lý do admin
 * nên bấm Đóng chứ không xoá.
 */
export async function closeFlashSale(id, { reason = "admin", now = Date.now() } = {}) {
    const coll = await saleCollection();
    // Atomic: chỉ đợt đang SENDING/OPEN/FULL mới chuyển được. Đợt đã CLOSED thì
    // modifiedCount = 0 và caller biết là không có gì xảy ra.
    const res = await coll.updateOne(
        { _id: toOid(id), status: { $in: [FLASH_STATUS.SENDING, FLASH_STATUS.OPEN, FLASH_STATUS.FULL] } },
        { $set: { status: FLASH_STATUS.CLOSED, closedAt: new Date(now), closeReason: String(reason) } },
    );
    // Dừng vòng gửi trong process này nếu nó đang chạy cho đợt đó.
    _abortSend(String(id));
    return res.modifiedCount > 0;
}

/**
 * Xoá đợt VÀ mọi claim của khách (§8: "ưu đãi đang sống của họ biến mất").
 * Không hoàn tiền, không thu hồi gì — chỉ dừng ưu đãi. Vì vậy admin được khuyến cáo
 * dùng Đóng; hàm này tồn tại cho đợt tạo nhầm.
 */
export async function deleteFlashSale(id) {
    _abortSend(String(id));
    const [removedResponses, removedSale] = await Promise.all([
        prisma.flashSaleResponse.deleteMany({ where: { flashSaleId: String(id) } }),
        prisma.flashSale.deleteMany({ where: { id } }),
    ]);
    invalidateFlashOfferCache();
    return { sale: num(removedSale?.count), responses: num(removedResponses?.count) };
}

// ─── Claim suất (§2, §3) ────────────────────────────────────────────────────────────

/**
 * Chiếm MỘT suất, atomic.
 *
 * `$expr` so `acceptedCount` với `maxSlots` trên CÙNG một document trong CÙNG một
 * update — Mongo đảm bảo filter và modify là một khối, nên 500 người bấm cùng lúc vào
 * suất cuối cùng thì đúng MỘT người qua. `mapWhere` của adapter không diễn đạt được
 * so sánh hai field, vì vậy chỗ này bắt buộc phải xuống raw collection.
 *
 * `maxSlots = 0` nghĩa là KHÔNG GIỚI HẠN (§1) — `$ifNull` để document cũ thiếu field
 * cũng được hiểu là không giới hạn.
 */
export async function claimSlot(saleId) {
    const coll = await saleCollection();
    const res = await coll.updateOne(
        {
            _id: toOid(saleId),
            status: FLASH_STATUS.OPEN,
            $expr: {
                $or: [
                    { $eq: [{ $ifNull: ["$maxSlots", 0] }, 0] },
                    { $lt: [{ $ifNull: ["$acceptedCount", 0] }, "$maxSlots"] },
                ],
            },
        },
        { $inc: { acceptedCount: 1 } },
    );
    if (res.modifiedCount !== 1) return false;

    // Vừa chiếm xong thì đủ suất → chuyển FULL, cũng atomic để hai request song song
    // không cùng ghi. Đợt FULL thì mọi claim sau bị `evaluateClaim` từ chối.
    await coll.updateOne(
        {
            _id: toOid(saleId),
            status: FLASH_STATUS.OPEN,
            maxSlots: { $gt: 0 },
            $expr: { $gte: [{ $ifNull: ["$acceptedCount", 0] }, "$maxSlots"] },
        },
        { $set: { status: FLASH_STATUS.FULL, fullAt: new Date() } },
    ).catch(() => {});
    return true;
}

/**
 * Nhả một suất đã chiếm (dùng khi ghi response thất bại).
 *
 * Kèm việc trả đợt từ FULL về OPEN nếu chính suất vừa nhả làm nó hết FULL — không thì
 * một lượt ghi DB lỗi đóng luôn cả đợt trước mặt mọi khách còn lại.
 */
export async function releaseSlot(saleId) {
    const coll = await saleCollection();
    const res = await coll.updateOne(
        { _id: toOid(saleId), acceptedCount: { $gt: 0 } },
        { $inc: { acceptedCount: -1 } },
    ).catch(() => null);
    if (!res?.modifiedCount) return false;
    await coll.updateOne(
        {
            _id: toOid(saleId),
            status: FLASH_STATUS.FULL,
            maxSlots: { $gt: 0 },
            $expr: { $lt: [{ $ifNull: ["$acceptedCount", 0] }, "$maxSlots"] },
        },
        { $set: { status: FLASH_STATUS.OPEN, fullAt: null } },
    ).catch(() => {});
    return true;
}

/**
 * Khách bấm ✅ Nhận.
 *
 * Thứ tự ở đây NGƯỢC với cách nghĩ thông thường "claim suất trước rồi ghi sau", và
 * ngược mới là đúng:
 *
 *   1. `evaluateClaim` (thuần) quyết định dựa trên dòng response cũ
 *   2. GHI dòng ACCEPT trước, dùng **unique index (flashSaleId, telegramId) làm khoá
 *      idempotency** — `insertOne` chỉ thắng đúng một lần cho mỗi cặp
 *   3. Chỉ khi bước 2 chứng minh được "đây là lượt nhận MỚI" thì mới chiếm suất
 *   4. Chiếm suất thất bại → rollback dòng response về trạng thái cũ
 *
 * Vì sao không claim trước: hai cú bấm song song của CÙNG một khách đều đọc
 * `existing = null`, đều claim → hai suất bị đốt cho một người, và spec đòi "bấm lại
 * chỉ nhắc lại hạn, không ăn thêm suất". Ghi trước thì unique index tự loại request
 * thứ hai: nó ăn E11000, rơi xuống nhánh update có điều kiện `kind != ACCEPT`, và
 * nhánh đó cũng chỉ thắng một lần. Số suất bị đốt vì thế luôn đúng bằng số người
 * thật sự có ưu đãi.
 */
export async function acceptOffer(telegramId, saleId, { now = Date.now() } = {}) {
    const tg = String(telegramId ?? "").trim();
    if (!tg) return { ok: false, reason: "bad_user" };

    const saleIdStr = String(saleId ?? "");
    const sale = await getFlashSale(saleIdStr);
    const existing = await prisma.flashSaleResponse.findFirst({
        where: { flashSaleId: saleIdStr, telegramId: tg },
    });

    const decision = evaluateClaim({ sale, existing, now });
    if (!decision.ok) {
        // Nếu đợt chưa mở (đang SENDING), ghi nhận đăng ký chờ (WAITING) để tự động
        // thông báo + gửi link mua ngay khi đợt chính thức mở.
        if (decision.reason === "not_open" && existing?.kind !== FLASH_RESPONSE.ACCEPT) {
            try {
                if (existing) {
                    await prisma.flashSaleResponse.updateMany({
                        where: { flashSaleId: saleIdStr, telegramId: tg, kind: { not: FLASH_RESPONSE.ACCEPT } },
                        data: { kind: FLASH_RESPONSE.WAITING, respondedAt: new Date(now) },
                    });
                } else {
                    await prisma.flashSaleResponse.create({
                        data: { flashSaleId: saleIdStr, telegramId: tg, kind: FLASH_RESPONSE.WAITING, respondedAt: new Date(now) },
                    });
                }
            } catch (err) {
                // Nuốt lỗi duplicate hoặc log nhẹ
            }
            return { ok: false, reason: "not_open", registered: true, sale, view: sale ? progressOf(sale, now) : null };
        }
        // Kể cả khi từ chối cũng trả tiến độ thật nếu đợt còn đang gửi (§8): khách
        // phải thấy bot đang làm gì, không phải một câu "chưa mở" cộc lốc.
        return { ...decision, sale, view: sale ? progressOf(sale, now) : null };
    }
    if (!decision.consumedSlot) {
        return { ...decision, sale, already: true };
    }

    const prevKind = existing?.kind || null;
    const expiresAt = new Date(decision.expiresAt);
    const respondedAt = new Date(now);
    let isNew = false;

    try {
        await prisma.flashSaleResponse.create({
            data: { flashSaleId: saleIdStr, telegramId: tg, kind: FLASH_RESPONSE.ACCEPT, expiresAt, respondedAt },
        });
        isNew = true;
    } catch (err) {
        // 11000 = unique index chặn. Nghĩa là đã có dòng cho cặp (sale, user) này.
        if (err?.code !== 11000 && !/duplicate key/i.test(err?.message || "")) {
            console.error("[flash-sale] acceptOffer insert failed:", err?.message);
            sendLog("ERROR", `⚡ Flash sale: ghi lượt nhận THẤT BẠI (không phải trùng khoá).\nSale: ${saleIdStr}\nUser: ${tg}\nLỗi: ${err?.message}`);
            return { ok: false, reason: "error", sale };
        }
        // Đổi có điều kiện: chỉ dòng CHƯA phải ACCEPT mới được đổi. Hai request song
        // song thì đúng một cái thấy modifiedCount = 1.
        const flipped = await prisma.flashSaleResponse.updateMany({
            where: { flashSaleId: saleIdStr, telegramId: tg, kind: { not: FLASH_RESPONSE.ACCEPT } },
            data: { kind: FLASH_RESPONSE.ACCEPT, expiresAt, respondedAt },
        }).catch(() => ({ count: 0 }));

        if (num(flipped?.count) !== 1) {
            // Request song song kia đã claim rồi. Đọc lại để trả hạn THẬT cho khách.
            const row = await prisma.flashSaleResponse.findFirst({ where: { flashSaleId: saleIdStr, telegramId: tg } });
            invalidateFlashOfferCache(tg);
            return {
                ok: true, reason: "already", already: true, consumedSlot: false,
                expiresAt: row?.expiresAt || decision.expiresAt, sale,
            };
        }
        isNew = true;
    }

    // Tới đây: dòng ACCEPT là của LƯỢT NÀY. Chiếm suất.
    const claimed = await claimSlot(saleIdStr);
    if (!claimed) {
        // Giữa lúc đọc và lúc claim, đợt đã FULL hoặc bị đóng. Rollback dòng response
        // để không có một ưu đãi mồ côi (có dòng ACCEPT mà không giữ suất).
        if (prevKind) {
            await prisma.flashSaleResponse.updateMany({
                where: { flashSaleId: saleIdStr, telegramId: tg },
                data: { kind: prevKind, expiresAt: null, respondedAt: existing?.respondedAt || null },
            }).catch(() => {});
        } else {
            await prisma.flashSaleResponse.deleteMany({ where: { flashSaleId: saleIdStr, telegramId: tg } }).catch(() => {});
        }
        invalidateFlashOfferCache(tg);
        const fresh = await getFlashSale(saleIdStr);
        // Phân biệt "hết suất" với "đã đóng". Chỉ nhìn `status === FULL` là KHÔNG ĐỦ:
        // `claimSlot` trượt có thể vì `$expr` thấy acceptedCount đã chạm maxSlots mà
        // lệnh chuyển FULL (một updateOne thứ hai) chưa kịp chạy. Báo "closed" cho một
        // đợt chỉ vừa đầy là nói sai với khách — và sai theo hướng khiến họ bỏ đi, trong
        // khi một suất vừa nhả ra là đợt mở lại.
        const filledUp = num(fresh?.maxSlots) > 0 && num(fresh?.acceptedCount) >= num(fresh?.maxSlots);
        const reason = fresh?.status === FLASH_STATUS.FULL || filledUp ? "full" : "closed";
        return { ok: false, reason, sale: fresh };
    }

    invalidateFlashOfferCache(tg);
    return { ...decision, sale, isNew, expiresAt: decision.expiresAt };
}

/**
 * Khách bấm ⏭ Bỏ qua. Ghi nhận, và VẪN cho nhận lại sau nếu còn suất (§2).
 *
 * Cùng khoá idempotency như `acceptOffer` (unique index trên cặp sale+user), nhưng
 * KHÔNG chiếm suất và KHÔNG rollback: bỏ qua chỉ là một con số thống kê, không phải
 * một quyền lợi. Ghi thất bại thì nuốt lỗi — chặn khách ở đây là đổi một dòng số liệu
 * lấy việc khách không bấm Nhận được nữa.
 */
export async function skipOffer(telegramId, saleId, { now = Date.now() } = {}) {
    const tg = String(telegramId ?? "").trim();
    if (!tg) return { ok: false, reason: "bad_user" };

    const saleIdStr = String(saleId ?? "");
    const [sale, existing] = await Promise.all([
        getFlashSale(saleIdStr),
        prisma.flashSaleResponse.findFirst({ where: { flashSaleId: saleIdStr, telegramId: tg } }),
    ]);
    const decision = evaluateSkip({ sale, existing, now });
    if (!decision.ok) return { ...decision, sale };

    const respondedAt = new Date(now);
    try {
        if (existing) {
            // Đã có dòng (thường là ACCEPT) → `evaluateSkip` đã chặn ca ACCEPT ở trên,
            // nên đây là dòng SKIP cũ: chỉ cập nhật mốc thời gian.
            await prisma.flashSaleResponse.updateMany({
                where: { flashSaleId: saleIdStr, telegramId: tg, kind: { not: FLASH_RESPONSE.ACCEPT } },
                data: { kind: FLASH_RESPONSE.SKIP, respondedAt },
            });
        } else {
            await prisma.flashSaleResponse.create({
                data: { flashSaleId: saleIdStr, telegramId: tg, kind: FLASH_RESPONSE.SKIP, respondedAt },
            });
        }
        const coll = await saleCollection();
        await coll.updateOne({ _id: toOid(saleIdStr) }, { $inc: { skippedCount: 1 } }).catch(() => {});
    } catch (err) {
        console.error("[flash-sale] skipOffer write failed:", err?.message);
    }

    invalidateFlashOfferCache(tg);
    return { ...decision, sale };
}

// ─── Vòng gửi (§3) ──────────────────────────────────────────────────────────────────

/** Các đợt đang được gửi trong process này — chặn tick khởi động vòng thứ hai. */
const _liveSends = new Map(); // saleId -> { abort: true }

function _abortSend(saleId) {
    const handle = _liveSends.get(String(saleId));
    if (handle) handle.abort = true;
}

/**
 * Tiến độ để hiện cho khách đang chờ và cho admin.
 * `processed` = đã gửi + đã chặn + đã lỗi, tức "đã xét xong".
 */
export function progressOf(sale, now = Date.now()) {
    const processed = num(sale?.sentCount) + num(sale?.blockedCount) + num(sale?.errorCount);
    const start = sale?.sendStartedAt ? new Date(sale.sendStartedAt).getTime() : Number(now);
    const opens = sale?.opensAt ? new Date(sale.opensAt).getTime() : Number(now);
    return sendProgressView({
        processed,
        total: num(sale?.recipientTotal),
        startedAt: start,
        opensAt: opens,
        now,
    });
}

/**
 * Giành quyền gửi MỘT đợt bằng lease có TTL.
 *
 * `pm2` ở đây chạy một instance, nhưng deploy là restart: bản mới khởi động trong khi
 * bản cũ có thể còn vài trăm ms chưa chết hẳn. Không có lease thì hai process cùng
 * đọc `progressCursor` và cùng gửi — khách nhận hai tin giống hệt nhau.
 *
 * Claim bằng `updateOne` có điều kiện (lease trống HOẶC đã quá hạn) rồi kiểm
 * `modifiedCount`: Mongo đảm bảo chỉ một update thắng.
 */
export async function acquireSendLease(saleId, { owner = "", now = Date.now() } = {}) {
    const coll = await saleCollection();
    const staleBefore = new Date(Number(now) - SEND_LEASE_MS);
    const res = await coll.updateOne(
        {
            _id: toOid(saleId),
            status: FLASH_STATUS.SENDING,
            $or: [{ sendLeaseAt: null }, { sendLeaseAt: { $lt: staleBefore } }],
        },
        { $set: { sendLeaseAt: new Date(now), sendLeaseOwner: String(owner) } },
    );
    return res.modifiedCount === 1;
}

async function renewSendLease(saleId, owner, now = Date.now()) {
    const coll = await saleCollection();
    // Chỉ gia hạn khi lease VẪN của mình — nếu đã bị process khác giành thì phải
    // dừng, không được tiếp tục gửi.
    const res = await coll.updateOne(
        { _id: toOid(saleId), sendLeaseOwner: String(owner) },
        { $set: { sendLeaseAt: new Date(now) } },
    );
    return res.modifiedCount === 1;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Gửi ưu đãi tới mọi khách chưa chặn, rồi mở đợt khi tới giờ đã in.
 *
 * Con trỏ `progressCursor` là `_id` của user cuối cùng ĐÃ XÉT XONG, ghi sau MỖI tin.
 * Spec nói "mỗi 100 người"; ở đây ghi mỗi tin vì một `$set` trên một document ở
 * ~20 tin/giây là không đáng kể với Mongo, và nó làm resume CHÍNH XÁC TUYỆT ĐỐI.
 * Ghi theo lô 100 thì process chết giữa lô sẽ gửi lại tới 100 tin — trùng thì vô hại
 * (claim idempotent qua unique index) nhưng spec đòi "không gửi trùng", nên không lấy.
 *
 * Ngược lại, BỎ SÓT thì không sửa được: khách đó không bao giờ thấy ưu đãi trong khi
 * giờ mở đã trôi qua. Con trỏ chỉ tiến sau khi tin đã đi, nên không thể sót.
 */
export async function runFlashSaleSend(botLike, saleId, { owner = `pid${process.pid}`, now = () => Date.now() } = {}) {
    const telegram = botLike?.telegram;
    if (!telegram) return { ok: false, reason: "no_telegram" };
    if (_liveSends.has(String(saleId))) return { ok: false, reason: "already_running_here" };

    const handle = { abort: false };
    _liveSends.set(String(saleId), handle);
    try {
        if (!(await acquireSendLease(saleId, { owner, now: now() }))) {
            return { ok: false, reason: "lease_held" };
        }

        const sale = await getFlashSale(saleId);
        if (!sale || sale.status !== FLASH_STATUS.SENDING) return { ok: false, reason: "not_sending" };

        const startedLoopAt = now();
        let cursor = sale.progressCursor || null;
        let sent = num(sale.sentCount);
        let blocked = num(sale.blockedCount);
        let errored = num(sale.errorCount);
        let sinceCheckpoint = 0;

        const coll = await saleCollection();
        const userColl = await prisma.user.collection();

        // Giá mỗi 1M token chỉ cần cho đợt giảm-trên-tổng-đơn (sản phẩm API key), và
        // nó KHÔNG đổi giữa vòng gửi. Resolve MỘT lần ở đây thay vì mỗi tin một lần:
        // vòng này chạy ~25 tin/giây, thêm một lượt tra cache mỗi tin là thêm một chỗ
        // để chậm và một chỗ để hỏng mà không được gì.
        const perMUsd = sale.totalDiscount ? await readPerMUsd(sale) : 0;

        // eslint-disable-next-line no-constant-condition
        while (true) {
            if (handle.abort) return { ok: false, reason: "aborted", sent, blocked, errored };

            // Đọc tiếp từ con trỏ. `_id` tăng đơn điệu nên đây là một thứ tự ỔN ĐỊNH:
            // restart thì đọc lại đúng chỗ đã dừng, không lặp, không nhảy.
            const filter = { isBlocked: false };
            if (cursor) filter._id = { $gt: toOid(cursor) };
            const batch = await userColl
                .find(filter)
                .sort({ _id: 1 })
                .limit(SEND_BATCH)
                .project({ telegramId: 1, language: 1 })
                .toArray();
            if (!batch.length) break;

            for (const user of batch) {
                if (handle.abort) return { ok: false, reason: "aborted", sent, blocked, errored };

                let outcome = "sent";
                try {
                    const { text, reply_markup } = await buildOfferMessage({ sale, language: user.language, perMUsd });
                    await sendWithBackoff(telegram, user.telegramId, text, reply_markup);
                } catch (err) {
                    if (err?.code === 403) {
                        // Khách chặn bot. Đây KHÔNG phải lỗi (§8) — đếm riêng, và đánh
                        // dấu isBlocked để mọi broadcast khác khỏi tốn một lần thử.
                        outcome = "blocked";
                        await prisma.user
                            .update({ where: { telegramId: String(user.telegramId) }, data: { isBlocked: true } })
                            .catch(() => {});
                    } else {
                        outcome = "error";
                        console.error(`[flash-sale] send to ${user.telegramId} failed:`, err?.message);
                    }
                }

                if (outcome === "sent") sent += 1;
                else if (outcome === "blocked") blocked += 1;
                else errored += 1;

                cursor = String(user._id);
                sinceCheckpoint += 1;

                // Ghi con trỏ SAU khi tin đã đi. Đây là điểm resume.
                const patch = {
                    progressCursor: cursor,
                    sentCount: sent,
                    blockedCount: blocked,
                    errorCount: errored,
                };
                if (sinceCheckpoint >= LEASE_REFRESH_EVERY) {
                    patch.sendLeaseAt = new Date(now());
                    sinceCheckpoint = 0;
                    if (!(await renewSendLease(saleId, owner, now()))) {
                        // Process khác đã giành lease (lease của mình hết hạn vì một
                        // lần treo dài). Dừng ngay — hai vòng cùng gửi là gửi trùng.
                        console.error(`[flash-sale] mất lease của đợt ${saleId}, dừng vòng gửi`);
                        return { ok: false, reason: "lease_lost", sent, blocked, errored };
                    }
                }
                await coll.updateOne({ _id: toOid(saleId) }, { $set: patch }).catch(() => {});

                if (outcome === "sent") await sleep(SEND_THROTTLE_MS);
            }
        }

        const finishedAt = now();
        await coll.updateOne(
            { _id: toOid(saleId) },
            { $set: { sendFinishedAt: new Date(finishedAt), sendLeaseAt: null, sendLeaseOwner: null } },
        ).catch(() => {});

        const measured = await recordSendMeasurement({
            sentCount: sent + blocked + errored,
            elapsedMs: finishedAt - (sale.sendStartedAt ? new Date(sale.sendStartedAt).getTime() : startedLoopAt),
        });

        // MỞ NGAY nếu đã tới giờ; nếu gửi xong SỚM thì để tick mở đúng giờ đã in (§3:
        // mở sớm là để người bấm nhanh thắng người đọc kỹ rồi chờ).
        await maybeOpenSale(saleId, { now: finishedAt, botLike });

        // `sent`/`blocked`/`errored` là SỐ CỘNG DỒN của cả đợt, khớp ba field cùng tên
        // trên document — KHÔNG phải "số tin của lượt chạy này". Với một lượt resume thì
        // hai cái đó khác nhau, và nhầm là đọc sai tiến độ. Đo tốc độ bên trên cũng dựa
        // vào đúng ngữ nghĩa này: `elapsedMs` tính từ `sendStartedAt` GỐC nên thương số
        // là tốc độ trung bình của cả đợt, kể cả khoảng dừng giữa hai lượt.
        return { ok: true, sent, blocked, errored, secsPerUserNext: measured };
    } finally {
        _liveSends.delete(String(saleId));
    }
}

/**
 * Gửi có backoff thật. broadcast.js chỉ thử lại ĐÚNG MỘT lần sau 429 rồi tính là
 * fail — với vài nghìn người nhận, Telegram sẽ 429 nhiều lần và một lần thử lại là
 * mất oan cả trăm người nhận (họ bị BỎ SÓT, thứ không sửa lại được).
 */
async function sendWithBackoff(telegram, chatId, text, replyMarkup, { attempts = 6 } = {}) {
    let lastErr = null;
    for (let i = 0; i < attempts; i += 1) {
        try {
            await telegram.sendMessage(chatId, text, {
                parse_mode: "HTML",
                disable_web_page_preview: true,
                ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
            });
            return true;
        } catch (err) {
            lastErr = err;
            // 403 = bị chặn, retry vô ích.
            if (err?.code === 403) throw err;
            if (err?.code === 429) {
                const retryAfter = Number(err?.parameters?.retry_after || 0) || 2;
                await sleep(Math.min(30000, retryAfter * 1000));
                continue;
            }
            // Lỗi mạng thoáng qua (ECONNRESET, socket hang up) — thử lại, backoff tăng dần.
            await sleep(Math.min(8000, 250 * 2 ** i));
        }
    }
    throw lastErr || new Error("send failed");
}

/**
 * Chuyển 📤 SENDING → 🟢 OPEN khi (a) đã gửi xong và (b) đã tới giờ in trên tin.
 *
 * Atomic qua `updateOne` có điều kiện để hai nơi cùng gọi (vòng gửi vừa xong, và tick
 * định kỳ) không gửi hai tin "Đã MỞ" cho admin.
 */
export async function maybeOpenSale(saleId, { now = Date.now(), botLike = null, notify = null } = {}) {
    const coll = await saleCollection();
    const res = await coll.updateOne(
        {
            _id: toOid(saleId),
            status: FLASH_STATUS.SENDING,
            sendFinishedAt: { $ne: null },
            opensAt: { $lte: new Date(now) },
        },
        { $set: { status: FLASH_STATUS.OPEN, openedAt: new Date(now) } },
    );
    if (res.modifiedCount !== 1) return false;

    const sale = await getFlashSale(saleId);
    if (sale) {
        // `sendLog` gửi bằng parse_mode MARKDOWN — thẻ <b> sẽ hiện nguyên chữ, và một
        // dấu `_` lạ trong tên sản phẩm có thể làm cả tin nhắn không gửi được.
        sendLog("ORDER", [
            `⚡ FLASH SALE ĐÃ MỞ`,
            `🔓 Đã MỞ nhận ưu đãi — ${md(sale.productName)}`,
            `🏷 Giảm ${num(sale.discountPct)}% · ${num(sale.validityMinutes)} phút kể từ lúc khách nhận`,
            `🎟 Suất: ${num(sale.maxSlots) > 0 ? num(sale.maxSlots) : "không giới hạn"}`,
            `📤 Đã gửi ${num(sale.sentCount)} · 🚫 chặn bot ${num(sale.blockedCount)} · ⚠️ lỗi ${num(sale.errorCount)}`,
        ].join("\n"));

        // Thông báo cho những khách đã bấm "Nhận ưu đãi" trước đó (trạng thái WAITING)
        const telegram = botLike?.telegram;
        if (telegram) {
            (async () => {
                try {
                    const waitingList = await prisma.flashSaleResponse.findMany({
                        where: { flashSaleId: String(saleId), kind: FLASH_RESPONSE.WAITING },
                    });
                    if (waitingList?.length) {
                        const validityMs = Math.max(1, Number(sale.validityMinutes) || 60) * 60 * 1000;
                        const perMUsd = sale.totalDiscount ? await readPerMUsd(sale) : 0;
                        let productUrl = null;
                        try {
                            productUrl = await getProductDeepLink(telegram, sale.productId);
                        } catch {
                            productUrl = null;
                        }

                        for (const item of waitingList) {
                            const tgId = item.telegramId;
                            // Chiếm suất ưu đãi cho khách
                            const claimed = await claimSlot(saleId);
                            if (!claimed) {
                                // Hết suất
                                continue;
                            }
                            const userNow = Date.now();
                            const expiresAt = new Date(userNow + validityMs);
                            await prisma.flashSaleResponse.updateMany({
                                where: { flashSaleId: String(saleId), telegramId: tgId },
                                data: { kind: FLASH_RESPONSE.ACCEPT, expiresAt, respondedAt: new Date(userNow) },
                            }).catch(() => {});
                            invalidateFlashOfferCache(tgId);

                            // Lấy ngôn ngữ của user
                            const u = await prisma.user.findUnique({
                                where: { telegramId: String(tgId) },
                                select: { language: true },
                            }).catch(() => null);
                            const lang = u?.language || "vi";
                            const copy = FLASH_COPY[lang] || FLASH_COPY.vi;
                            const pct = normalizeDiscountPct(sale.discountPct);
                            const priceLine = sale.totalDiscount
                                ? flashPerMLine({ perMUsd, pct, lang, totalDiscount: true })
                                : flashPricePair({
                                    priceBefore: sale.productPrice,
                                    priceAfter: discountedUnitPrice(sale.productPrice, pct),
                                    currency: sale.productCurrency || "VND",
                                    lang,
                                    pct,
                                });

                            const msgLines = [
                                `⚡ <b>${escapeHtml(copy.openNotifyTitle)}</b>`,
                                ``,
                                `📦 <b>${escapeHtml(sale.productName || "")}</b>`,
                                priceLine,
                                `⏱ ${escapeHtml(copy.validity(Number(sale.validityMinutes) || 60))}`,
                                ``,
                                `${escapeHtml(copy.openNotifyBody)}`,
                            ];

                            const inline_keyboard = [];
                            if (productUrl) {
                                inline_keyboard.push([{ text: copy.buyNow, url: productUrl }]);
                            }

                            try {
                                await telegram.sendMessage(tgId, msgLines.filter(Boolean).join("\n"), {
                                    parse_mode: "HTML",
                                    disable_web_page_preview: true,
                                    ...(inline_keyboard.length ? { reply_markup: { inline_keyboard } } : {}),
                                });
                            } catch (err) {
                                if (err?.code === 403) {
                                    await prisma.user.update({
                                        where: { telegramId: String(tgId) },
                                        data: { isBlocked: true },
                                    }).catch(() => {});
                                }
                            }
                            await sleep(50);
                        }
                    }
                } catch (err) {
                    console.error("[flash-sale] notify waiting users failed:", err?.message);
                }
            })().catch(() => {});
        }
    }
    // `Promise.resolve(...)` chứ không gọi thẳng `notify(sale).catch(...)`: một notifier
    // ĐỒNG BỘ trả undefined, và `.catch` trên undefined sẽ ném NGAY SAU khi đợt đã mở
    // xong — tức là mở thành công mà caller thấy lỗi, rồi tick tưởng chưa mở và báo lại.
    if (typeof notify === "function") await Promise.resolve(notify(sale)).catch(() => {});
    return true;
}

/**
 * Tick định kỳ: việc của nó là KHÔNG BAO GIỜ để một đợt kẹt ở SENDING.
 *
 * Ba nhánh, đều atomic:
 *  1. đợt đã gửi xong và tới giờ → MỞ
 *  2. đợt đang gửi mà không process nào giữ lease → tiếp tục gửi (resume sau deploy)
 *  3. đợt OPEN đã đủ suất nhưng chưa kịp FULL (lỗi đâu đó) → FULL
 */
export async function flashSaleTick(botLike, { now = Date.now() } = {}) {
    const opened = [];
    const resumed = [];
    /** Chuẩn hoá về HÀM: caller có thể đưa một mốc cố định (test) hoặc một hàm. */
    const nowFn = typeof now === "function" ? now : () => Number(now);
    try {
        const sending = await prisma.flashSale.findMany({
            where: { status: FLASH_STATUS.SENDING },
            orderBy: { createdAt: "asc" },
            take: TICK_SCAN_MAX,
        });
        for (const sale of sending) {
            if (await maybeOpenSale(sale.id, { now, botLike })) { opened.push(sale.id); continue; }
            if (_liveSends.has(String(sale.id))) continue;
            // Chưa gửi xong và không ai đang gửi → giành lease rồi gửi tiếp.
            // `runFlashSaleSend` tự giành lease nên ở đây không cần kiểm tra trước.
            //
            // `now` của tick là MỘT CON SỐ còn `runFlashSaleSend` nhận một HÀM (nó gọi
            // `now()` nhiều lần trong một vòng chạy hàng phút, để lease và mốc thời gian
            // luôn tươi). Truyền số thẳng vào là `TypeError: now is not a function` —
            // và vì lỗi bị `.catch()` bên dưới nuốt rồi log, vòng resume sẽ KHÔNG BAO
            // GIỜ chạy: mỗi 5 giây log một dòng "resume failed" và đợt kẹt ở SENDING
            // vĩnh viễn. Đây chính là cơ chế resume của §3 nên nó phải có test.
            const result = runFlashSaleSend(botLike, sale.id, { now: nowFn });
            resumed.push(sale.id);
            result.catch((err) => console.error(`[flash-sale] resume ${sale.id} failed:`, err?.message));
        }
        if (sending.length >= TICK_SCAN_MAX) {
            warnOnce("flash-sale-tick-cap", "ERROR", `⚡ Flash sale: ${sending.length} đợt đang SENDING, chạm trần quét ${TICK_SCAN_MAX} — có đợt có thể chưa được xét.`);
        }

        // Nhánh 3: chốt FULL nếu đếm đã đủ (bảo hiểm, không phải đường chính).
        const coll = await saleCollection();
        await coll.updateMany(
            {
                status: FLASH_STATUS.OPEN,
                maxSlots: { $gt: 0 },
                $expr: { $gte: [{ $ifNull: ["$acceptedCount", 0] }, "$maxSlots"] },
            },
            { $set: { status: FLASH_STATUS.FULL, fullAt: new Date(now) } },
        ).catch(() => {});
    } catch (err) {
        console.error("[flash-sale] tick failed:", err?.message);
    }
    return { opened, resumed };
}

// ─── Worker ─────────────────────────────────────────────────────────────────────────

/**
 * Vòng lặp nền. Trả `{ stop() }` — server.js phải gọi nó lúc shutdown.
 *
 * KHÔNG dùng `setInterval` trần như hai chỗ trong server.js (`cancelExpiredOrders`,
 * `processScheduledBroadcasts`): những vòng đó không có handle để clear nên vẫn chạy
 * sau khi shutdown bắt đầu, và một vòng gửi tin nhắn mà vẫn chạy trong lúc process
 * đang tắt là cách tốt nhất để gửi dở rồi mất con trỏ.
 *
 * Chạy MỘT lượt ngay lúc khởi động, không chờ nhịp đầu tiên: đây chính là cơ chế
 * resume sau deploy (§3). Một đợt đang gửi dở nằm ở trạng thái SENDING với
 * `progressCursor` đã lưu, và lượt tick đầu tiên này nhặt nó lên gửi tiếp.
 */
export function startFlashSaleWorker(botLike, { intervalMs = 5000 } = {}) {
    let timer = null;
    let running = false;

    const tick = async () => {
        // `running` chỉ chặn chồng lấn TRONG một process. Hai process khác nhau thì
        // lease trong DB mới là thứ quyết định (xem acquireSendLease).
        if (running) return;
        running = true;
        try {
            await flashSaleTick(botLike);
        } catch (err) {
            console.error("[flash-sale] worker tick failed:", err?.message);
        } finally {
            running = false;
        }
    };

    timer = setInterval(tick, Math.max(1000, Number(intervalMs) || 5000));
    tick();

    return {
        stop() {
            if (timer) clearInterval(timer);
            timer = null;
            // Báo mọi vòng gửi trong process này dừng ở điểm an toàn kế tiếp. Con trỏ
            // đã được ghi sau mỗi tin nên lần khởi động sau nhặt tiếp đúng chỗ.
            for (const id of [..._liveSends.keys()]) _abortSend(id);
        },
    };
}

// ─── Thống kê (§6) ──────────────────────────────────────────────────────────────────

/**
 * Đếm phản hồi của một đợt, gộp trong JS.
 *
 * Một đợt có tối đa `recipientTotal` dòng (= số khách), tức vài nghìn — kéo về đếm
 * trong bộ nhớ rẻ hơn một pipeline aggregate, và adapter này vốn kéo toàn bộ docs vào
 * JS cho cả `aggregate()` lẫn `groupBy()` nên không có gì để tiết kiệm.
 */
export async function flashSaleStats(saleId, { now = Date.now() } = {}) {
    const rows = await prisma.flashSaleResponse.findMany({ where: { flashSaleId: String(saleId) } });
    let accepted = 0;
    let skipped = 0;
    let purchased = 0;
    let expired = 0;
    for (const r of rows) {
        if (r.kind === FLASH_RESPONSE.ACCEPT) {
            accepted += 1;
            if (r.purchased) purchased += 1;
            const exp = r.expiresAt ? new Date(r.expiresAt).getTime() : 0;
            if (exp && exp <= now) expired += 1;
        } else if (r.kind === FLASH_RESPONSE.SKIP) skipped += 1;
    }
    return { accepted, skipped, purchased, expired, live: accepted - expired, responded: rows.length };
}

/**
 * Ghi nhận MỘT đơn đã mua bằng giá flash sale — gọi từ `delivery.js` sau khi giao xong.
 *
 * Nó đọc DẤU VẾT TRÊN ĐƠN (`flashSaleId`, `flashDiscountAmount`) chứ KHÔNG tra lại
 * ưu đãi đang sống. Lý do: đơn QR/USDT chỉ
 * được giao khi poller thấy tiền về, có thể là nhiều phút sau lúc khách bấm mua —
 * tra lại lúc đó thì ưu đãi đã hết hạn và con số thống kê bị hụt đúng những đơn
 * khách đã trả tiền thật.
 *
 * Idempotent theo ĐƠN: claim `flashCountedAt` bằng `updateMany` có điều kiện null.
 * `delivery-recovery` chạy lại tới 7 ngày, không có chốt này thì mỗi lượt giao lại cộng
 * thêm một lần vào "💸 tổng tiền đã giảm".
 */
export async function recordFlashSalePurchase({ prisma: db = prisma, order } = {}) {
    const amount = Math.max(0, Number(order?.flashDiscountAmount) || 0);
    const saleId = order?.flashSaleId;
    if (!saleId || !(Number(order?.flashDiscountPct) > 0)) return { skipped: true };

    const claimed = await db.order.updateMany({
        where: { id: order.id, flashCountedAt: null },
        data: { flashCountedAt: new Date() },
    }).catch((err) => {
        console.error("[flash-sale] recordFlashSalePurchase claim failed:", err?.message);
        return { count: 0 };
    });
    if (num(claimed?.count) !== 1) return { skipped: true, reason: "already_counted" };

    const coll = await saleCollection();
    await coll.updateOne(
        { _id: toOid(saleId) },
        { $inc: { purchasedCount: 1, discountGivenTotal: amount } },
    ).catch((err) => console.error("[flash-sale] recordFlashSalePurchase counter failed:", err?.message));

    // Đánh dấu dòng response của khách này (nếu còn) để màn thống kê đếm được
    // "bao nhiêu người đã nhận RỒI MUA", khác với "bao nhiêu lượt mua".
    await db.flashSaleResponse.updateMany({
        where: { flashSaleId: String(saleId), telegramId: String(order.odelegramId || order.telegramId || "") },
        data: { purchased: true, purchasedAt: new Date(), lastOrderId: String(order.id) },
    }).catch(() => {});

    return { ok: true, saleId, discountAmount: amount };
}

/** Số liệu đầy đủ cho màn admin (Telegram + web). */
export async function flashSaleReport(sale, { now = Date.now() } = {}) {
    if (!sale) return null;
    const stats = await flashSaleStats(sale.id, { now });
    return {
        id: sale.id,
        productName: sale.productName,
        productId: sale.productId,
        targetProfileId: sale.targetProfileId !== null && sale.targetProfileId !== undefined ? Number(sale.targetProfileId) : null,
        discountPct: num(sale.discountPct),
        validityMinutes: num(sale.validityMinutes, 60),
        maxSlots: num(sale.maxSlots),
        status: sale.status,
        opensAt: sale.opensAt,
        recipientTotal: num(sale.recipientTotal),
        sentCount: num(sale.sentCount),
        blockedCount: num(sale.blockedCount),
        errorCount: num(sale.errorCount),
        acceptedCount: num(sale.acceptedCount),
        skippedCount: num(sale.skippedCount),
        purchasedCount: num(sale.purchasedCount),
        discountGivenTotal: num(sale.discountGivenTotal),
        stats,
        // 🤷 "không phản hồi" = đã gửi tới mà chưa bấm gì. Chỉ có nghĩa khi đã gửi xong.
        noResponse: Math.max(0, num(sale.sentCount) - stats.responded),
        // Tiền tệ của `discountGivenTotal`. KHÔNG phải lúc nào cũng là productCurrency:
        // đơn API key lưu `currency: "VND"` và amount bằng VND trong khi sản phẩm ẩn
        // `__API_KEY__` có `currency: "USD"` — gắn nhãn USD cho một con số VND là in ra
        // "$70" cho 70 nghìn đồng. Bot và web admin đều đọc field này, nên nó phải nằm
        // ở đây chứ không phải tự suy ra ở từng màn.
        moneyCurrency: sale.totalDiscount ? "VND" : (sale.productCurrency || "VND"),
        progress: sale.status === FLASH_STATUS.SENDING ? progressOf(sale, now) : null,
        createdAt: sale.createdAt,
        closedAt: sale.closedAt || null,
    };
}
