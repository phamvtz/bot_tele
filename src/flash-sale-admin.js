import { Markup } from "telegraf";
import { prisma } from "./db.js";
import { iconOf } from "./menu-config.js";
import { escapeHtml, formatCurrency } from "./bot-ui/format.js";
import { safeEditOrReply } from "./bot-ui/safe.js";
import { logAction, Actions } from "./audit.js";
import { sendLog } from "./lib/logger.js";
import {
    createFlashSale, listFlashSales, getFlashSale, closeFlashSale, deleteFlashSale,
    flashSaleReport, runFlashSaleSend, getSendSecsPerUser,
    FLASH_STATUS, LIVE_STATUSES, isTotalDiscountProduct, estimateOpensAt,
    normalizeDiscountPct, discountedUnitPrice,
} from "./flash-sale.js";
import { buildAdminPreview, formatClock } from "./flash-sale-text.js";

/**
 * Panel admin của Flash Sale (§1) — wizard 5 bước trong bot, danh sách, chi tiết,
 * thống kê, và hai nút dừng.
 *
 * Tách khỏi `admin.js` vì file đó đã ~3200 dòng; nhưng NHÁNH ĐIỀU PHỐI text vẫn nằm
 * trong router `bot.on("text")` của admin.js (`handleFlashSaleWizardText` được gọi từ
 * đó). Lý do không đăng ký một `bot.on("text")` riêng ở đây: thứ tự middleware của
 * Telegraf là thứ tự đăng ký, và bot.js nhường đường bằng `if (hasAdminSession(...))
 * return next()`. Một handler text đăng ký sau bot.js sẽ chỉ chạy được nhờ đúng câu
 * nhường đó — hoạt động, nhưng hỏng ngay khi ai đổi thứ tự đăng ký. Gọi thẳng từ
 * router thì thứ tự là hiển nhiên.
 *
 * `sessions` được TRUYỀN VÀO chứ không import ngược từ admin.js: import vòng
 * admin.js ⇄ flash-sale-admin.js sẽ khiến một trong hai bên nhận `undefined` lúc
 * module đang khởi tạo, và lỗi đó chỉ nổ khi admin bấm nút — tức là trên production.
 */

/** Số sản phẩm tối đa hiện ở bước chọn. Mỗi sản phẩm là MỘT nút nên đây là số nút. */
const PRODUCT_PICKER_MAX = 30;
/** Số đợt tối đa trên màn danh sách. */
const SALE_LIST_MAX = 20;
/** Số nút đợt gần nhất trên màn danh sách (mỗi đợt một nút). */
const SALE_BUTTONS_MAX = 10;

const STATUS_ICON = {
    [FLASH_STATUS.SENDING]: "📤",
    [FLASH_STATUS.OPEN]: "🟢",
    [FLASH_STATUS.FULL]: "🟠",
    [FLASH_STATUS.CLOSED]: "⚪",
};

const statusIcon = (s) => STATUS_ICON[s] || "❔";
const statusText = (s) => ({
    SENDING: "đang gửi", OPEN: "đang mở", FULL: "hết suất", CLOSED: "đã đóng",
}[s] || s);

const formatDateTime = (d) => new Date(d).toLocaleString("vi-VN", {
    timeZone: "Asia/Ho_Chi_Minh", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
});

/**
 * Text nút là PLAIN TEXT — không escape. `escapeHtml` ở đây sẽ hiện nguyên `&amp;`
 * trên nút của sản phẩm tên "A & B", và cắt theo số ký tự sau khi escape còn cắt
 * nhầm vào giữa một thực thể.
 */
const btnLabel = (s, max) => String(s ?? "").slice(0, max);

/** Nhãn sản phẩm trong wizard: tên + giá, và đánh dấu hàng giảm-trên-tổng-đơn. */
function productLabel(p) {
    const price = formatCurrency(Number(p.price) || 0, p.currency || "VND");
    return `${p.name} (${price}${isTotalDiscountProduct(p) ? " · API key" : ""})`;
}

/** Số khách sẽ nhận tin — cùng một định nghĩa với `createFlashSale` dùng. */
const countRecipients = () => prisma.user.count({ where: { isBlocked: false } }).catch(() => 0);

/**
 * Ước lượng giờ mở cho màn XEM TRƯỚC.
 *
 * Gọi đúng `estimateOpensAt` mà `createFlashSale` sẽ gọi, với cùng đầu vào — hai chỗ
 * tự ước lượng theo hai cách là preview hứa một giờ và tin gửi đi in một giờ khác.
 */
async function previewEstimate(now = Date.now()) {
    const [customerCount, secsPerUser] = await Promise.all([countRecipients(), getSendSecsPerUser()]);
    return {
        customerCount,
        secsPerUser,
        opensAt: new Date(estimateOpensAt({ startedAt: now, customerCount, secsPerUser })),
    };
}

// ─── Danh sách ─────────────────────────────────────────────────────────────────────

export async function showFlashSaleList(ctx) {
    const sales = await listFlashSales({ take: SALE_LIST_MAX });
    const rows = [];
    if (!sales.length) {
        rows.push(`${iconOf("ADMIN_EMPTY")} Chưa có đợt flash sale nào.`);
    } else {
        rows.push(`⚡ <b>FLASH SALE</b> — ${sales.length} đợt gần nhất\n`);
        for (const s of sales) {
            const slots = Number(s.maxSlots) > 0 ? `${Number(s.acceptedCount) || 0}/${s.maxSlots}` : `${Number(s.acceptedCount) || 0}✓`;
            rows.push(
                `${statusIcon(s.status)} <b>${escapeHtml(s.productName || "?")}</b> −${Number(s.discountPct) || 0}%`
                + ` · ${escapeHtml(statusText(s.status))}\n`
                + `   📨 ${Number(s.sentCount) || 0}/${Number(s.recipientTotal) || 0}`
                + ` · ✅ ${slots} · ⏭ ${Number(s.skippedCount) || 0}`
                + ` · 🛒 ${Number(s.purchasedCount) || 0}`,
            );
        }
    }
    await safeEditOrReply(ctx, rows.join("\n"), Markup.inlineKeyboard([
        [Markup.button.callback(`${iconOf("ADMIN_ADD")} Tạo đợt mới`, "ADMIN:FLASHSALE_NEW")],
        ...sales.slice(0, SALE_BUTTONS_MAX).map((s) => [
            Markup.button.callback(
                `${statusIcon(s.status)} ${btnLabel(s.productName || "?", 22)} −${Number(s.discountPct) || 0}%`,
                `ADMIN:FLASHSALE_VIEW:${s.id}`,
            ),
        ]),
        [Markup.button.callback(`${iconOf("NAV_BACK")} Về admin`, "ADMIN:PANEL")],
    ]));
}

// ─── Chi tiết một đợt (§1, §6) ─────────────────────────────────────────────────────

function detailText(rep) {
    const p = rep.progress;
    const lines = [
        `${statusIcon(rep.status)} <b>${escapeHtml(rep.productName || "?")}</b>`,
        `${escapeHtml(statusText(rep.status).toUpperCase())} · giảm <b>${rep.discountPct}%</b>`,
        ``,
        `⏱ Hiệu lực: <b>${rep.validityMinutes} phút</b> kể từ lúc khách nhận`,
        `🎟 Suất: <b>${rep.maxSlots > 0 ? rep.maxSlots : "không giới hạn"}</b>`,
        `🔔 Mở nhận lúc: <b>${formatClock(rep.opensAt)}</b>`,
    ];
    if (p) {
        // Tiến độ THẬT, không phải một câu "đang gửi" — admin cần biết bot còn bao lâu
        // nữa và có đang kẹt hay không (§3: màn chi tiết hiện thanh + số + ETA).
        lines.push(``, `📤 Đang gửi: ${p.bar} <b>${p.pct}%</b>`, `⏳ Còn lại: ~${Math.max(0, p.etaSeconds)}s`);
    }
    lines.push(
        ``,
        `<b>Thống kê (§6)</b>`,
        `📤 Đã gửi: <b>${rep.sentCount}</b> · 🚫 Chặn bot: <b>${rep.blockedCount}</b> · ⚠️ Lỗi: <b>${rep.errorCount}</b>`,
        `✅ Đã nhận: <b>${rep.acceptedCount}</b>${rep.maxSlots > 0 ? ` / ${rep.maxSlots} suất` : ""}`,
        `⏭ Bỏ qua: <b>${rep.skippedCount}</b> · 🤷 Không phản hồi: <b>${rep.noResponse}</b>`,
        `🛒 Đã mua giá giảm: <b>${rep.purchasedCount}</b>`,
        `💸 Tổng tiền đã giảm: <b>${formatCurrency(rep.discountGivenTotal, rep.moneyCurrency)}</b>`,
    );
    if (rep.status === FLASH_STATUS.CLOSED && rep.closedAt) {
        lines.push(``, `⚪ Đóng lúc ${formatDateTime(rep.closedAt)}`);
    }
    return lines.join("\n");
}

/**
 * Nút hành động, theo TRẠNG THÁI.
 *
 * §1: đang mở thì hiện 🔒 Ngừng nhận thêm; đang gửi thì hiện 🛑 Dừng gửi & đóng.
 * Cả hai đều gọi `closeFlashSale` — khác nhau ở chỗ 🛑 còn phải cắt vòng gửi đang chạy,
 * việc mà `_abortSend` bên trong `closeFlashSale` đã làm sẵn cho cả hai. Tách hai nút
 * là vì admin cần biết mình đang làm gì: ngừng nhận thêm trên một đợt ĐANG GỬI là vô
 * nghĩa (chưa ai nhận được), và dừng gửi trên một đợt ĐÃ MỞ là đóng luôn ưu đãi của
 * những người đã nhận.
 */
function actionButtons(rep) {
    const rows = [];
    if (rep.status === FLASH_STATUS.SENDING) {
        rows.push([Markup.button.callback("🛑 Dừng gửi & đóng", `ADMIN:FLASHSALE_STOP:${rep.id}`)]);
    } else if (rep.status === FLASH_STATUS.OPEN || rep.status === FLASH_STATUS.FULL) {
        rows.push([Markup.button.callback("🔒 Ngừng nhận thêm", `ADMIN:FLASHSALE_CLOSE:${rep.id}`)]);
    }
    rows.push([
        Markup.button.callback(`${iconOf("ADMIN_RESET")} Làm mới`, `ADMIN:FLASHSALE_VIEW:${rep.id}`),
        Markup.button.callback(`${iconOf("ADMIN_DELETE")} Xoá đợt`, `ADMIN:FLASHSALE_DEL:${rep.id}`),
    ]);
    rows.push([Markup.button.callback(`${iconOf("NAV_BACK")} Danh sách`, "ADMIN:FLASHSALE")]);
    return Markup.inlineKeyboard(rows);
}

export async function showFlashSaleDetail(ctx, saleId) {
    const sale = await getFlashSale(saleId);
    if (!sale) {
        return safeEditOrReply(ctx, `${iconOf("STATUS_ERROR")} Không tìm thấy đợt này.`, Markup.inlineKeyboard([
            [Markup.button.callback(`${iconOf("NAV_BACK")} Danh sách`, "ADMIN:FLASHSALE")],
        ]));
    }
    const rep = await flashSaleReport(sale);
    await safeEditOrReply(ctx, detailText(rep), actionButtons(rep));
}

// ─── Wizard 5 bước (§1) ────────────────────────────────────────────────────────────

/**
 * Danh sách sản phẩm cho bước 1.
 *
 * Sản phẩm API key (`__API_KEY__`) bị cố tình `isActive: false, unlisted: true` vì nó
 * không phải một mặt hàng khách chọn được — nó là chỗ treo đơn mua key. Lọc theo
 * `isActive` như mọi màn quản lý sản phẩm khác sẽ LOẠI NÓ RA, và admin không thể tạo
 * flash sale cho API key: đúng ca mà §4 dành cả một mục để giải thích tại sao phải
 * giảm trên tổng đơn. Vì vậy lấy cả hàng `deliveryMode === "API_KEY"` bất kể cờ active.
 */
export async function pickableProducts() {
    const [active, apikey] = await Promise.all([
        prisma.product.findMany({ where: { isActive: true }, orderBy: { createdAt: "desc" } }),
        prisma.product.findMany({ where: { deliveryMode: "API_KEY" }, orderBy: { createdAt: "desc" } }),
    ]);
    const byId = new Map();
    for (const p of [...apikey, ...active]) byId.set(String(p.id), p);
    // Hàng API key lên đầu: nó là ca dễ chọn nhầm nhất (giảm tổng đơn, không giảm giá/1M).
    return [...byId.values()].sort(
        (a, b) => Number(isTotalDiscountProduct(b)) - Number(isTotalDiscountProduct(a)),
    );
}

async function showProductPicker(ctx) {
    const [products, sales] = await Promise.all([pickableProducts(), listFlashSales({ take: 200 })]);
    const busy = new Set(sales.filter((s) => LIVE_STATUSES.includes(s.status)).map((s) => String(s.productId)));
    const shown = products.slice(0, PRODUCT_PICKER_MAX);

    const notes = [
        `⚡ <b>Bước 1/5 — Chọn sản phẩm</b>`,
        ``,
        products.length > shown.length ? `<i>Hiện ${shown.length}/${products.length} sản phẩm.</i>` : null,
        `🔒 = đang có đợt chưa kết thúc; chọn sẽ bị từ chối (§8: một sản phẩm chỉ nên có một đợt đang mở).`,
    ].filter(Boolean);

    await safeEditOrReply(ctx, notes.join("\n"), Markup.inlineKeyboard([
        ...shown.map((p) => [
            Markup.button.callback(
                `${busy.has(String(p.id)) ? "🔒 " : ""}${btnLabel(p.name, 26)}`,
                `ADMIN:FLASHSALE_PROD:${p.id}`,
            ),
        ]),
        [Markup.button.callback(`${iconOf("NAV_BACK")} Về admin`, "ADMIN:PANEL")],
    ]));
}

/**
 * Màn XEM TRƯỚC (bước 5).
 *
 * Không tạo đợt ở đây — chỉ khi admin bấm 🚀 Gửi ngay. Đây là chốt cuối trước một
 * hành động không rút lại được (nhắn cho toàn bộ khách hàng), nên màn này in đủ mọi
 * con số mà §1 yêu cầu, kể cả những con số admin không tự nhập vào (số khách, thời
 * gian gửi, giờ mở).
 */
async function showFlashSalePreview(ctx, session) {
    const est = await previewEstimate();
    const text = buildAdminPreview({
        productName: session.productName,
        priceBefore: session.productPrice,
        priceAfter: session.priceAfter,
        currency: session.productCurrency,
        discountPct: session.discountPct,
        validityMinutes: session.validityMinutes,
        maxSlots: session.maxSlots,
        customerCount: est.customerCount,
        opensAt: est.opensAt,
        secsPerUser: est.secsPerUser,
        perMUsd: session.perMUsd,
        totalDiscount: session.totalDiscount,
    });
    await ctx.reply(text, {
        parse_mode: "HTML",
        ...Markup.inlineKeyboard([
            [Markup.button.callback("🚀 Gửi ngay", "ADMIN:FLASHSALE_SEND")],
            [Markup.button.callback(`${iconOf("ADMIN_CANCEL")} Huỷ`, "ADMIN:FLASHSALE_CANCEL")],
        ]),
    });
}

/**
 * Xử lý text của wizard — gọi từ router `bot.on("text")` trong admin.js.
 *
 * Mỗi bước chỉ nhận ĐÚNG loại dữ liệu của nó và hỏi lại khi sai, không tự sửa: admin
 * gõ "300" mà bot âm thầm kẹp về 90 thì con số trên tin gửi cho toàn bộ khách hàng
 * khác con số admin nghĩ mình đã đặt.
 */
export async function handleFlashSaleWizardText(ctx, session, text, { sessions } = {}) {
    void sessions; // giữ chữ ký ổn định nếu về sau cần xoá session giữa chừng
    const step = Number(session.step) || 0;
    const again = (msg) => ctx.reply(`${iconOf("STATUS_ERROR")} ${msg}`, { parse_mode: "HTML" });

    if (step === 2) {
        const pct = normalizeDiscountPct(text);
        if (!pct) return await again("% giảm phải là số nguyên từ 1 đến 90. Nhập lại:"), true;
        session.discountPct = pct;
        // Giá mới tính NGAY ở đây và dùng lại cho cả preview: preview tự tính lần hai
        // là hai chỗ có thể lệch nhau, mà lệch ở màn chốt cuối trước khi nhắn toàn bộ
        // khách hàng thì không có lượt kiểm tra nào sau đó.
        session.priceAfter = session.totalDiscount
            ? session.productPrice
            : discountedUnitPrice(session.productPrice, pct);
        session.step = 3;
        await ctx.reply("Bước 3/5: Số phút hiệu lực <b>kể từ lúc khách nhận</b> (1–1440, mặc định 60):", { parse_mode: "HTML" });
        return true;
    }

    if (step === 3) {
        const mins = parseInt(String(text).replace(/[^\d]/g, ""), 10);
        if (!Number.isFinite(mins) || mins < 1 || mins > 1440) {
            return await again("Số phút phải từ 1 đến 1440 (24 giờ). Nhập lại:"), true;
        }
        session.validityMinutes = mins;
        session.step = 4;
        await ctx.reply("Bước 4/5: Số suất tối đa (gõ <b>0</b> = không giới hạn):", { parse_mode: "HTML" });
        return true;
    }

    if (step === 4) {
        const slots = parseInt(String(text).replace(/[^\d]/g, ""), 10);
        if (!Number.isFinite(slots) || slots < 0) {
            return await again("Số suất phải là số nguyên ≥ 0 (0 = không giới hạn). Nhập lại:"), true;
        }
        session.maxSlots = slots;
        session.step = 5;
        await showFlashSalePreview(ctx, session);
        return true;
    }

    // Đang ở bước 5: tin nhắn tiếp theo không phải một bước nào cả. KHÔNG xoá session
    // ở đây — admin gõ thừa một chữ là mất cả 4 bước vừa nhập. Chỉ nhắc họ dùng nút.
    await ctx.reply(`${iconOf("ADMIN_NOTE")} Đang ở bước xem trước. Bấm 🚀 Gửi ngay hoặc ${iconOf("ADMIN_CANCEL")} Huỷ.`);
    return true;
}

// ─── Đăng ký handler ───────────────────────────────────────────────────────────────

export function registerFlashSaleAdmin(bot, { sessions, isAdmin }) {
    bot.action("ADMIN:FLASHSALE", async (ctx) => {
        if (!isAdmin(ctx.from?.id)) return ctx.answerCbQuery();
        await ctx.answerCbQuery();
        await showFlashSaleList(ctx);
    });

    bot.action("ADMIN:FLASHSALE_NEW", async (ctx) => {
        if (!isAdmin(ctx.from?.id)) return ctx.answerCbQuery();
        await ctx.answerCbQuery();
        await showProductPicker(ctx);
    });

    bot.action(/^ADMIN:FLASHSALE_PROD:(.+)$/, async (ctx) => {
        if (!isAdmin(ctx.from?.id)) return ctx.answerCbQuery();
        const product = await prisma.product.findUnique({ where: { id: ctx.match[1] } });
        if (!product) {
            await ctx.answerCbQuery("Không tìm thấy sản phẩm", { show_alert: true });
            return showProductPicker(ctx);
        }
        // Chặn ngay ở bước chọn thay vì để tới lúc bấm Gửi: admin điền xong 4 bước rồi
        // mới bị từ chối là 4 bước vứt đi, và dễ khiến họ bấm lại lần nữa tạo đợt trùng.
        const sales = await listFlashSales({ take: 200 });
        const clash = sales.find((s) => String(s.productId) === String(product.id) && LIVE_STATUSES.includes(s.status));
        if (clash) {
            await ctx.answerCbQuery(`Sản phẩm này đang ${statusText(clash.status)}. Đóng đợt đó trước.`, { show_alert: true });
            return;
        }
        await ctx.answerCbQuery();

        // Giảm trên TỔNG ĐƠN cho hàng API key (§4): giá mỗi 1M là 1 cent, nhân 0.7 ra
        // 0.7 cent rồi làm tròn lên cent lại về đúng 1 cent — khách mua 100M token vẫn
        // trả đủ tiền và ưu đãi biến mất không dấu vết.
        const totalDiscount = isTotalDiscountProduct(product);
        sessions.set(ctx.from.id, {
            action: "CREATE_FLASHSALE",
            step: 2,
            productId: product.id,
            productName: product.name,
            productPrice: Number(product.price) || 0,
            productCurrency: product.currency || "VND",
            totalDiscount,
            perMUsd: 0,
            discountPct: 0,
            priceAfter: Number(product.price) || 0,
            validityMinutes: 60,
            maxSlots: 0,
        });

        if (totalDiscount) {
            // Đọc MỘT lần lúc mở wizard. Không đọc lại ở màn preview: giá $/1M đổi giữa
            // hai màn thì preview hiện một con số và tin gửi đi hiện con số khác.
            let perM = 0;
            try {
                const mod = await import("./gpt2api.js");
                perM = Number((await mod.getConfig())?.usdPerMtoken) || 0;
            } catch { /* chưa cấu hình cửa hàng API key → preview chỉ nêu %, không bịa số */ }
            const s = sessions.get(ctx.from.id);
            if (s) s.perMUsd = perM;
        }

        await ctx.reply(
            `⚡ <b>Bước 2/5 — % giảm giá</b>\n\n`
            + `📦 <b>${escapeHtml(productLabel(product))}</b>\n`
            + (totalDiscount ? `<i>Hàng API key: giảm trên TỔNG ĐƠN, không giảm giá mỗi 1M token (§4).</i>\n` : ``)
            + `\nNhập số nguyên từ 1 đến 90:`,
            { parse_mode: "HTML" },
        );
    });

    bot.action("ADMIN:FLASHSALE_CANCEL", async (ctx) => {
        if (!isAdmin(ctx.from?.id)) return ctx.answerCbQuery();
        sessions.delete(ctx.from.id);
        await ctx.answerCbQuery("Đã huỷ");
        await ctx.reply(`${iconOf("ADMIN_CANCEL")} Đã huỷ tạo flash sale.`);
    });

    /**
     * 🚀 Gửi ngay — điểm KHÔNG QUAY LẠI ĐƯỢC.
     *
     * Tạo đợt ở trạng thái 📤 SENDING với giờ mở đã tính sẵn, rồi khởi động vòng gửi
     * mà KHÔNG await: vòng đó chạy hàng nghìn tin, await nó là treo callback của admin
     * hàng phút và Telegram sẽ báo nút chết.
     *
     * Session được đọc lại chứ không tin vào closure: TTL session là 15 phút, admin để
     * màn preview quá lâu rồi mới bấm thì phải nói rõ là hết phiên — KHÔNG được tạo một
     * đợt với % giảm bằng 0 chỉ vì session rỗng.
     */
    bot.action("ADMIN:FLASHSALE_SEND", async (ctx) => {
        if (!isAdmin(ctx.from?.id)) return ctx.answerCbQuery();
        const session = sessions.get(ctx.from.id);
        if (!session || session.action !== "CREATE_FLASHSALE" || !session.productId || !session.discountPct) {
            await ctx.answerCbQuery("Phiên tạo đã hết hạn, vui lòng tạo lại", { show_alert: true });
            return showProductPicker(ctx);
        }
        await ctx.answerCbQuery();
        // Xoá TRƯỚC khi tạo: nếu `createFlashSale` ném lỗi, session đã nhập vẫn nên hết
        // hiệu lực — để lại là admin bấm Gửi ngay lần nữa và tạo hai đợt giống hệt nhau.
        sessions.delete(ctx.from.id);

        let sale;
        try {
            sale = await createFlashSale({
                productId: session.productId,
                discountPct: session.discountPct,
                validityMinutes: session.validityMinutes,
                maxSlots: session.maxSlots,
                adminId: ctx.from.id,
            });
        } catch (err) {
            if (err?.code === "already_running") {
                return ctx.reply(
                    `${iconOf("STATUS_ERROR")} Sản phẩm này đang có đợt chưa kết thúc. Đóng đợt cũ rồi tạo lại.`,
                    Markup.inlineKeyboard([[Markup.button.callback("Danh sách flash sale", "ADMIN:FLASHSALE")]]),
                );
            }
            console.error("[flash-sale-admin] createFlashSale:", err);
            return ctx.reply(`${iconOf("STATUS_ERROR")} Không tạo được đợt: ${escapeHtml(err?.message || "?")}`, { parse_mode: "HTML" });
        }

        await logAction(ctx.from.id, Actions.FLASHSALE_CREATE, sale.productName, {
            saleId: sale.id,
            discountPct: sale.discountPct,
            validityMinutes: sale.validityMinutes,
            maxSlots: sale.maxSlots,
            recipientTotal: sale.recipientTotal,
            opensAt: sale.opensAt,
        });

        await ctx.reply(
            `⚡ <b>Đã tạo đợt flash sale</b>\n\n`
            + `📦 ${escapeHtml(sale.productName)} · −${sale.discountPct}%\n`
            + `📤 Đang gửi tới <b>${Number(sale.recipientTotal).toLocaleString("vi-VN")}</b> khách\n`
            + `🔔 Mở nhận lúc <b>${formatClock(sale.opensAt)}</b>\n\n`
            + `<i>Khách bấm Nhận trước giờ đó sẽ thấy thanh tiến độ thật. Bot sẽ báo khi gửi xong.</i>`,
            {
                parse_mode: "HTML",
                ...Markup.inlineKeyboard([
                    [Markup.button.callback("Xem chi tiết đợt", `ADMIN:FLASHSALE_VIEW:${sale.id}`)],
                    [Markup.button.callback(`${iconOf("NAV_BACK")} Về admin`, "ADMIN:PANEL")],
                ]),
            },
        );

        // Chạy nền. Nếu vòng gửi chết giữa chừng thì `flashSaleTick` (chạy mỗi 5s từ
        // server.js) nhặt lại từ con trỏ đã lưu — đây chính là cơ chế resume của §3.
        runFlashSaleSend(bot, sale.id).catch((err) => {
            console.error("[flash-sale-admin] runFlashSaleSend:", err?.message);
            sendLog("ERROR", `Flash sale gửi lỗi\nĐợt: ${sale.id}\nLỗi: ${err?.message}`).catch(() => {});
        });
    });

    bot.action(/^ADMIN:FLASHSALE_VIEW:(.+)$/, async (ctx) => {
        if (!isAdmin(ctx.from?.id)) return ctx.answerCbQuery();
        await ctx.answerCbQuery();
        await showFlashSaleDetail(ctx, ctx.match[1]);
    });

    /** 🔒 Ngừng nhận thêm — giữ nguyên ưu đãi của người đã nhận (§8). */
    bot.action(/^ADMIN:FLASHSALE_CLOSE:(.+)$/, async (ctx) => {
        if (!isAdmin(ctx.from?.id)) return ctx.answerCbQuery();
        const saleId = ctx.match[1];
        const changed = await closeFlashSale(saleId, { reason: "admin_close" });
        await ctx.answerCbQuery(changed ? "Đã đóng" : "Đợt này đã đóng rồi");
        if (changed) {
            const sale = await getFlashSale(saleId);
            await logAction(ctx.from.id, Actions.FLASHSALE_CLOSE, sale?.productName || saleId, { saleId, reason: "admin_close" });
        }
        await showFlashSaleDetail(ctx, saleId);
    });

    /** 🛑 Dừng gửi & đóng — cắt vòng gửi VĨNH VIỄN, đợt này không bao giờ mở (§3). */
    bot.action(/^ADMIN:FLASHSALE_STOP:(.+)$/, async (ctx) => {
        if (!isAdmin(ctx.from?.id)) return ctx.answerCbQuery();
        const saleId = ctx.match[1];
        const changed = await closeFlashSale(saleId, { reason: "admin_stop_sending" });
        await ctx.answerCbQuery(changed ? "Đã dừng gửi & đóng" : "Không còn gì để dừng");
        if (changed) {
            const sale = await getFlashSale(saleId);
            await logAction(ctx.from.id, Actions.FLASHSALE_CLOSE, sale?.productName || saleId, { saleId, reason: "admin_stop_sending" });
            sendLog("SYSTEM", `⚡ Flash sale: admin dừng gửi & đóng đợt ${saleId} (${sale?.productName || "?"})`).catch(() => {});
        }
        await showFlashSaleDetail(ctx, saleId);
    });

    /**
     * 🗑 Xoá — hỏi lại trước, vì xoá đợt là XOÁ CẢ claim của khách (§8): ưu đãi đang
     * sống của họ biến mất ngay lập tức. Đây là lý do màn xác nhận nói thẳng ra hậu
     * quả đó và khuyên dùng Đóng.
     */
    bot.action(/^ADMIN:FLASHSALE_DEL:(.+)$/, async (ctx) => {
        if (!isAdmin(ctx.from?.id)) return ctx.answerCbQuery();
        await ctx.answerCbQuery();
        const sale = await getFlashSale(ctx.match[1]);
        if (!sale) return showFlashSaleList(ctx);
        const live = LIVE_STATUSES.includes(sale.status);
        await safeEditOrReply(ctx, [
            `${iconOf("ADMIN_DELETE")} <b>Xoá đợt flash sale?</b>`,
            ``,
            `📦 ${escapeHtml(sale.productName)} · −${Number(sale.discountPct)}% · ${statusIcon(sale.status)} ${escapeHtml(statusText(sale.status))}`,
            `✅ Đã có <b>${Number(sale.acceptedCount) || 0}</b> khách nhận ưu đãi này.`,
            ``,
            live
                ? `⚠️ Đợt này ĐANG CHẠY. Xoá là ưu đãi của những khách đã nhận <b>biến mất ngay</b> — họ bấm mua sẽ trả giá gốc.`
                : `Xoá sẽ gỡ ưu đãi của những khách đã nhận (nếu chưa hết hạn).`,
            ``,
            `<i>Muốn chỉ ngừng nhận THÊM mà giữ ưu đãi đã phát ra? Dùng 🔒 Ngừng nhận thêm, đừng xoá.</i>`,
        ].join("\n"), Markup.inlineKeyboard([
            [Markup.button.callback(`${iconOf("ADMIN_DELETE")} Xoá hẳn đợt này`, `ADMIN:FLASHSALE_DELCONF:${sale.id}`)],
            [Markup.button.callback(`${iconOf("ADMIN_CANCEL")} Không xoá`, `ADMIN:FLASHSALE_VIEW:${sale.id}`)],
        ]));
    });

    bot.action(/^ADMIN:FLASHSALE_DELCONF:(.+)$/, async (ctx) => {
        if (!isAdmin(ctx.from?.id)) return ctx.answerCbQuery();
        const saleId = ctx.match[1];
        const sale = await getFlashSale(saleId);
        const removed = await deleteFlashSale(saleId);
        await ctx.answerCbQuery("Đã xoá");
        await logAction(ctx.from.id, Actions.FLASHSALE_DELETE, sale?.productName || saleId, {
            saleId, responsesDeleted: removed.responses,
        });
        sendLog("SYSTEM", `⚡ Flash sale: admin XOÁ đợt ${saleId} (${sale?.productName || "?"}) — ${removed.responses} claim đã bị gỡ`).catch(() => {});
        await showFlashSaleList(ctx);
    });
}

export default {
    registerFlashSaleAdmin,
    handleFlashSaleWizardText,
    showFlashSaleList,
    showFlashSaleDetail,
    previewEstimate,
    pickableProducts,
};
