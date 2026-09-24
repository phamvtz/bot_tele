/**
 * Flash Sale — PHẦN TOÁN THUẦN. Không I/O, không DB, không đồng hồ ẩn.
 *
 * Tách khỏi `flash-sale.js` vì hai lý do:
 *
 *  1. `flash-sale.js` import `./db.js`, mà `bot-ui/messages.js` lại cần các hàm format
 *     giá ở đây. Để messages.js kéo theo Mongo client là biến một module format thuần
 *     thành thứ không test được nếu thiếu .env.
 *  2. Đây là phần quyết định TIỀN. Test phải nhắm vào nó trực tiếp, không qua mock
 *     prisma — mock càng mỏng thì khoảng cách giữa test và production càng rộng.
 *
 * Mọi hàm ở đây nhận `now` như một tham số, không bao giờ tự gọi `Date.now()`.
 */

export const FLASH_STATUS = {
    SENDING: "SENDING", // 📤 đang gửi, CHƯA mở — khách bấm nhận sẽ thấy thanh tiến độ
    OPEN: "OPEN",       // 🟢 đã gửi xong và đã tới giờ — nhận được nếu còn suất
    FULL: "FULL",       // 🟠 hết suất
    CLOSED: "CLOSED",   // ⚪ admin đóng / dừng
};

/** Trạng thái "đợt còn sống" — dùng để lọc và để chặn hai đợt trên cùng sản phẩm. */
export const LIVE_STATUSES = [FLASH_STATUS.SENDING, FLASH_STATUS.OPEN];

export const FLASH_RESPONSE = { ACCEPT: "ACCEPT", SKIP: "SKIP", WAITING: "WAITING" };

/**
 * Lần gửi ĐẦU TIÊN chưa có gì để đo, nên phải có một con số mặc định. 0.05s/người
 * = 20 người/giây, khớp `await sleep(50)` mà broadcast.js đang dùng thật.
 */
export const DEFAULT_SECS_PER_USER = 0.05;

/** Hệ số an toàn khi dự đoán lần sau từ lần trước — thà mở trễ còn hơn mở sớm. */
export const MEASURE_BUFFER = 1.15;

/**
 * Cộng thêm vào ước lượng mở. Gửi hàng nghìn tin luôn gặp 429 và phải chờ
 * `retry_after`, nên tốc độ trung bình thực tế thấp hơn tốc độ lý thuyết.
 */
export const OPEN_SAFETY_MS = 20000;

// ─── Hàm thuần: số học giá (§4) ──────────────────────────────────────────────────────

/**
 * % giảm hợp lệ: số nguyên 1–90. Trả 0 cho mọi giá trị rác.
 *
 * Trả 0 (chứ không ném) vì đây là hàm dùng ở đường tiền: một con số lạ phải dẫn tới
 * "không giảm giá" chứ không phải "giảm giá sai" hay crash giữa lúc khách bấm mua.
 * Trần 90 vì giảm 100% là tặng hàng, không phải flash sale.
 */
export function normalizeDiscountPct(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return 0;
    const pct = Math.floor(n);
    if (pct < 1 || pct > 90) return 0;
    return pct;
}

/**
 * Giá đơn vị sau giảm — FLOOR phần giảm, tức làm tròn về phía CÓ LỢI CHO SHOP.
 *
 * `Product.price` là `Int` (prisma.js / schema.prisma), nên số học ở đây là số nguyên
 * thuần: 99đ giảm 30% → 99 − floor(29.7) = 70đ. Khách thấy 70đ, không phải 69.3đ.
 */
export function discountedUnitPrice(price, discountPct) {
    const base = Number(price);
    if (!Number.isFinite(base) || base <= 0) return Number.isFinite(base) ? base : 0;
    const pct = normalizeDiscountPct(discountPct);
    if (!pct) return base;
    const result = base - Math.floor((base * pct) / 100);
    // Không bao giờ âm, và không bao giờ CAO HƠN giá gốc (pct=0 đã chặn ở trên,
    // nhưng floor của một base âm thì không ai đoán được).
    return Math.max(0, Math.min(base, result));
}

// Luật làm tròn lên cent dùng CHUNG với gia hạn API key, không phải một bản copy.
//
// Bản đầu của file này tự viết một `ceilCents` riêng và viết SAI thứ tự (toFixed trên
// đô-la rồi mới nhân 100), khiến `ceilCents(0.07)` ra 0.08 — thu oan 1 cent. Test
// bắt được. Hai bản copy của một hàm quyết định tiền tệ sớm hay muộn cũng trôi nhau,
// nên import thẳng bản gốc: `apikey-renew.js` không import gì, vì vậy tính "thuần,
// không I/O" của file này vẫn nguyên vẹn.
//
// PHẢI là `import` + `export` riêng, KHÔNG phải `export ... from`: dạng đó chỉ chuyển
// tiếp mà không tạo binding cục bộ, và `discountedUsdTotal` bên dưới gọi thẳng
// `ceilCents` — nó sẽ ném ReferenceError ngay lần đầu khách mua API key có ưu đãi.
import { ceilCents } from "./apikey-renew.js";

export { ceilCents };

/**
 * TỔNG đơn API key sau giảm, theo cent.
 *
 * Đây là chỗ §4 của spec cảnh báo: giảm vào GIÁ MỖI 1M TOKEN thì 0.01 × 0.7 = 0.007
 * bị `ceilCents` đẩy ngược về 0.01 — ưu đãi tồn tại trên giấy và biến mất ở chỗ thu
 * tiền. Giảm vào TỔNG thì 100M token (100 cent) còn đúng 70 cent.
 *
 * Vẫn ceil (không floor/round) vì apikey-pricing.js ceil toàn bộ đường giá; đổi luật
 * làm tròn ở một mình nhánh flash sale là hai đơn cùng cấu hình ra hai số tiền.
 */
export function discountedUsdTotal(priceUsd, discountPct) {
    const base = Number(priceUsd);
    if (!Number.isFinite(base) || base <= 0) return Number.isFinite(base) ? base : 0;
    const pct = normalizeDiscountPct(discountPct);
    if (!pct) return ceilCents(base);
    const result = ceilCents((base * (100 - pct)) / 100);
    return Math.max(0, Math.min(ceilCents(base), result));
}

/**
 * Giá $/1M token sau giảm — CHỈ ĐỂ HIỂN THỊ trong tin ưu đãi.
 *
 * Con số này cố tình KHÔNG làm tròn (spec: "0.007"): nó giải thích cho khách vì sao
 * tổng đơn của họ rẻ hơn. Tiền thật vẫn là `discountedUsdTotal`.
 */
export function discountedUsdPerM(basePerM, discountPct) {
    const base = Number(basePerM);
    if (!Number.isFinite(base) || base <= 0) return 0;
    const pct = normalizeDiscountPct(discountPct);
    if (!pct) return base;
    return (base * (100 - pct)) / 100;
}

/**
 * Sản phẩm này giảm trên TỔNG đơn hay trên GIÁ ĐƠN VỊ?
 *
 * API key không có "giá đơn vị" theo nghĩa thông thường — `Product.price` của nó là
 * giá niêm yết còn giá thật tính từ token × $/1M × hệ số RPM × hệ số ngày. Vì vậy
 * nó phải đi luật kia.
 */
export function isTotalDiscountProduct(product) {
    if (!product) return false;
    return String(product.deliveryMode || "").toUpperCase() === "API_KEY"
        || String(product.code || "") === "__API_KEY__";
}

/**
 * Luật giá cho MỘT product + MỘT offer. Trả `mode` để caller biết phải làm gì:
 * - `"unit"`  → `price` đã là giá sau giảm, cứ dùng.
 * - `"total"` → `price` GIỮ NGUYÊN; giảm phải áp lên báo giá tổng đơn.
 * - `"none"`  → không có ưu đãi.
 *
 * Tách ra như vậy để không chỗ nào vừa giảm giá đơn vị vừa giảm tổng (nhân đôi).
 */
export function flashPriceFor(product, offer) {
    const base = Number(product?.price) || 0;
    const pct = normalizeDiscountPct(offer?.discountPct);
    if (!product || !offer || !pct) return { price: base, pct: 0, mode: "none", offer: null };
    if (isTotalDiscountProduct(product)) {
        return { price: base, pct, mode: "total", offer };
    }
    return { price: discountedUnitPrice(base, pct), pct, mode: "unit", offer };
}

// ─── Hàm thuần: thời điểm mở (§3) ────────────────────────────────────────────────────

/** Làm tròn LÊN phút nguyên. */
export function roundUpToMinute(ts) {
    const n = Number(ts);
    if (!Number.isFinite(n)) return 0;
    return Math.ceil(n / 60000) * 60000;
}

/**
 * Dự đoán giờ mở để IN VÀO tin ưu đãi.
 *
 * `customerCount × secsPerUser` là thời gian gửi lý thuyết; `OPEN_SAFETY_MS` bù cho
 * 429 và retry; làm tròn lên phút để con số hiện ra là "18:06" chứ không phải
 * "18:06:23" — khách không canh được giây, và một giờ mở lẻ giây là một lời hứa
 * không ai kiểm chứng được.
 */
export function estimateOpensAt({ startedAt, customerCount, secsPerUser, safetyMs = OPEN_SAFETY_MS } = {}) {
    const start = Number(startedAt);
    if (!Number.isFinite(start)) return 0;
    const n = Math.max(0, Number(customerCount) || 0);
    const s = Number(secsPerUser) > 0 ? Number(secsPerUser) : DEFAULT_SECS_PER_USER;
    return roundUpToMinute(start + n * s * 1000 + Math.max(0, Number(safetyMs) || 0));
}

/**
 * Thanh tiến độ + ETA cho khách bấm nhận SỚM.
 *
 * `Math.max(etaFromSpeed, etaFromOpens)` chính là câu "không bao giờ sớm hơn giờ đã
 * in" của spec: tốc độ đo được có thể nói "còn 10 giây nữa" trong khi tin ưu đãi đã
 * hứa 18:06. Hứa một đằng báo một nẻo là cách nhanh nhất để khách nghĩ bot bị treo.
 *
 * KHÔNG trả về `total` cho tầng tin nhắn — §2 cấm tiết lộ số khách.
 */
export function sendProgressView({ processed = 0, total = 0, startedAt = 0, opensAt = 0, now = Date.now() } = {}) {
    const done = Math.max(0, Number(processed) || 0);
    const all = Math.max(0, Number(total) || 0);
    const pct = all > 0 ? Math.min(100, Math.floor((done / all) * 100)) : 100;
    const elapsedMs = Math.max(1, Number(now) - Number(startedAt));
    // Tốc độ đo TỪ LÚC BẮT ĐẦU ĐỢT NÀY — không phải hằng số cấu hình. Khách đang chờ
    // cần biết "còn bao lâu nữa" theo tốc độ thật, không phải theo dự đoán ban đầu.
    const secsPerUser = done > 0 ? elapsedMs / 1000 / done : null;
    const remaining = Math.max(0, all - done);
    const etaFromSpeed = secsPerUser ? remaining * secsPerUser * 1000 : 0;
    const etaFromOpens = Math.max(0, Number(opensAt) - Number(now));
    const etaMs = Math.max(etaFromSpeed, etaFromOpens);
    return { pct, bar: progressBar(pct), etaMs, etaSeconds: Math.ceil(etaMs / 1000), secsPerUser };
}

/** `▓▓▓▓▓▓░░░░░░` — ký tự khác thanh `█/░` của stats.js để không đọc nhầm thành tồn kho. */
export function progressBar(pct, width = 12) {
    const p = Math.max(0, Math.min(100, Number(pct) || 0));
    const w = Math.max(1, Number(width) || 12);
    const filled = Math.round((p / 100) * w);
    return "▓".repeat(filled) + "░".repeat(Math.max(0, w - filled));
}

// ─── Hàm thuần: quyết định claim (§2, §5) ────────────────────────────────────────────

/**
 * Toàn bộ luật "khách này bấm Nhận thì sao", ở MỘT chỗ và THUẦN — không I/O, không
 * đồng hồ ẩn. Đây là hàm mà test nhắm vào nhiều nhất vì nó quyết định ai được giá rẻ.
 *
 * `existing` là dòng response cũ của CHÍNH khách này cho CHÍNH đợt này (hoặc null).
 *
 * Trả `{ ok, reason }`; khi ok thì kèm `expiresAt` và `consumedSlot` để caller biết
 * có phải claim suất hay không.
 */
export function evaluateClaim({ sale, existing = null, now = Date.now() } = {}) {
    if (!sale) return { ok: false, reason: "not_found" };

    const status = String(sale.status || "");
    if (status === FLASH_STATUS.CLOSED) return { ok: false, reason: "closed" };

    // Đã nhận rồi → nhắc lại hạn, KHÔNG ăn thêm suất. Khách bấm lại vì lo lắng là
    // chuyện thường; nếu mỗi lần bấm đốt một suất thì 10 người bấm lại đã hết đợt.
    if (existing && existing.kind === FLASH_RESPONSE.ACCEPT) {
        const exp = existing.expiresAt ? new Date(existing.expiresAt).getTime() : 0;
        if (exp && exp <= Number(now)) return { ok: false, reason: "expired" };
        return { ok: true, reason: "already", expiresAt: existing.expiresAt, consumedSlot: false };
    }

    // Hết suất. ĐẶT SAU nhánh "đã nhận": người đã kịp nhận trước đó vẫn dùng được
    // ưu đãi tới hết hạn của riêng họ (§5), dù đợt đã FULL.
    if (status === FLASH_STATUS.FULL) return { ok: false, reason: "full" };

    // Chưa mở — trả tiến độ thật để khách biết bot không treo (§8).
    if (status === FLASH_STATUS.SENDING) return { ok: false, reason: "not_open" };

    if (status !== FLASH_STATUS.OPEN) return { ok: false, reason: "closed" };

    const validityMinutes = Number(sale.validityMinutes) > 0 ? Number(sale.validityMinutes) : 60;
    return {
        ok: true,
        reason: "accepted",
        consumedSlot: true,
        expiresAt: new Date(Number(now) + validityMinutes * 60000).toISOString(),
        validityMinutes,
    };
}

/** Luật "bỏ qua": luôn ghi nhận, luôn cho phép nhận lại sau (§2). */
export function evaluateSkip({ sale, existing = null, now = Date.now() } = {}) {
    if (!sale) return { ok: false, reason: "not_found" };
    if (String(sale.status || "") === FLASH_STATUS.CLOSED) return { ok: false, reason: "closed" };
    if (existing?.kind === FLASH_RESPONSE.ACCEPT) {
        return { ok: false, reason: "already_accepted", expiresAt: existing.expiresAt };
    }
    return { ok: true, reason: "skipped", recordedAt: new Date(Number(now)).toISOString() };
}

/**
 * Chọn MỘT ưu đãi khi khách lỡ có nhiều trên cùng sản phẩm (§8: không cộng dồn).
 * Lấy % lớn nhất; bằng nhau thì lấy hạn muộn hơn. Tất định, và có lợi cho khách.
 */
export function pickBestOffer(offers = []) {
    const list = (Array.isArray(offers) ? offers : []).filter(Boolean);
    if (!list.length) return null;
    return list.reduce((best, cur) => {
        const bp = normalizeDiscountPct(best.discountPct);
        const cp = normalizeDiscountPct(cur.discountPct);
        if (cp !== bp) return cp > bp ? cur : best;
        const be = best.expiresAt ? new Date(best.expiresAt).getTime() : 0;
        const ce = cur.expiresAt ? new Date(cur.expiresAt).getTime() : 0;
        return ce > be ? cur : best;
    });
}

/** Số phút còn lại của một ưu đãi, làm tròn LÊN (còn 0.2 phút vẫn là "1 phút"). */
export function offerMinutesLeft(expiresAt, now = Date.now()) {
    const exp = expiresAt ? new Date(expiresAt).getTime() : 0;
    if (!exp) return 0;
    return Math.max(0, Math.ceil((exp - Number(now)) / 60000));
}
