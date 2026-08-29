import fs from "fs/promises";
import path from "path";
import { request as httpsReq } from "node:https";
import { request as httpReq } from "node:http";
import { checkStock, invalidateStockCache } from "./inventory.js";
import { broadcastNewOrder, maskBuyerName } from "./broadcast.js";
import { sendLog } from "./lib/logger.js";

function httpGet(urlStr, headers = {}) {
    return new Promise((resolve, reject) => {
        const url = new URL(urlStr);
        const mod = url.protocol === "https:" ? httpsReq : httpReq;
        const req = mod({
            hostname: url.hostname,
            port: url.port || (url.protocol === "https:" ? 443 : 80),
            path: url.pathname + url.search,
            method: "GET",
            headers: { Accept: "application/json", ...headers },
            // Xem chú thích ở api-routes.js httpGetJson: request mang apiKey provider,
            // tắt kiểm tra cert là mời kẻ chặn đường mạng lấy key.
        }, (res) => {
            let data = "";
            res.on("data", (c) => data += c);
            res.on("end", () => {
                try { resolve(JSON.parse(data)); }
                catch { reject(new Error(`Invalid JSON from provider`)); }
            });
        });
        req.setTimeout(15000, () => { req.destroy(); reject(new Error("Timeout")); });
        req.on("error", (e) => reject(new Error(e.message)));
        req.end();
    });
}

function httpPost(urlStr, body, headers = {}) {
    return new Promise((resolve, reject) => {
        const url = new URL(urlStr);
        const bodyStr = JSON.stringify(body);
        const mod = url.protocol === "https:" ? httpsReq : httpReq;
        const req = mod({
            hostname: url.hostname,
            port: url.port || (url.protocol === "https:" ? 443 : 80),
            path: url.pathname + url.search,
            method: "POST",
            headers: { ...headers, "Content-Length": Buffer.byteLength(bodyStr) },
            // Xem chú thích ở httpGet phía trên.
        }, (res) => {
            let data = "";
            res.on("data", (c) => data += c);
            res.on("end", () => {
                if (res.statusCode >= 400)
                    return reject(new Error(`HTTP ${res.statusCode} — ${data.slice(0, 200)}`));
                try { resolve(JSON.parse(data)); }
                catch { reject(new Error(`Invalid JSON from provider`)); }
            });
        });
        req.setTimeout(30000, () => { req.destroy(); reject(new Error("Timeout (30s)")); });
        req.on("error", (e) => reject(new Error(e.message)));
        req.write(bodyStr);
        req.end();
    });
}
import { processReferralCommission } from "./referral.js";
import { addSpending } from "./vip.js";
import { refund } from "./wallet.js";
import { getOrderNotifyChannel, getSupportChannelUrlSync, isOrderChannelNotifyEnabled } from "./shop-config.js";
import { getProductDeepLink } from "./telegram-links.js";
import { formatOrderCode } from "./order-code.js";
import { iconOf } from "./menu-config.js";
import { createApiKey, getConfig as getGpt2apiConfig } from "./gpt2api.js";
import { saveIssuedKey, KeySource } from "./apikey-store.js";
import { apiKeyMessage } from "./bot-ui/apikey-messages.js";
import { buildApiKeyDeliveredKeyboard } from "./bot-ui/keyboards.js";

const ADMIN_IDS = (process.env.ADMIN_IDS || "").split(",").map((id) => id.trim()).filter(Boolean);

const DELIVERY_COPY = {
    vi: { delivery: "GIAO HÀNG", order: "Mã đơn", product: "Sản phẩm", description: "Mô tả", content: "Nội dung sản phẩm", time: "Thời gian giao", thanks: "Cảm ơn bạn đã mua hàng.", uploadFallback: "Telegram không nhận file; nội dung đơn được gửi trực tiếp bên dưới" },
    en: { delivery: "DELIVERY", order: "Order", product: "Product", description: "Description", content: "Product content", time: "Delivered at", thanks: "Thank you for your purchase.", uploadFallback: "Telegram could not receive the file; your order content is shown below" },
    zh: { delivery: "发货信息", order: "订单", product: "商品", description: "描述", content: "商品内容", time: "发货时间", thanks: "感谢您的购买。", uploadFallback: "Telegram 无法接收文件，订单内容已直接发送如下" },
};

function deliveryCopy(lang = "vi") {
    return DELIVERY_COPY[lang] || DELIVERY_COPY.vi;
}

// ─── Thời gian giao hàng theo múi giờ Hà Nội (UTC+7) ────────────────────────────
// Bắt buộc chỉ định timeZone: VPS chạy Windows và múi giờ hệ thống không đảm bảo là
// Asia/Ho_Chi_Minh — `toLocaleString("vi-VN")` không kèm timeZone sẽ render theo giờ
// máy chủ, khách xem sẽ thấy sai giờ.
const VN_TIME_FMT = new Intl.DateTimeFormat("vi-VN", {
    timeZone: "Asia/Ho_Chi_Minh",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
});

/** "04/08/2026 21:35 (GMT+7)" — dùng cho mọi tin nhắn/file giao hàng. */
function vnDeliveryTime(date = new Date()) {
    let d;
    try { d = new Date(date); } catch { d = new Date(); }
    if (Number.isNaN(d.getTime())) d = new Date();
    // formatToParts thay vì format(): locale vi-VN trả "21:35 04/08/2026" (giờ trước),
    // ta muốn "04/08/2026 21:35" cho thống nhất với phần còn lại của bot.
    const p = {};
    for (const part of VN_TIME_FMT.formatToParts(d)) p[part.type] = part.value;
    return `${p.day}/${p.month}/${p.year} ${p.hour}:${p.minute} (GMT+7)`;
}

async function notifyAdmins({ telegram, order, product }) {
    if (!ADMIN_IDS.length) return;
    const orderId = formatOrderCode(order.id);
    const msg = `${iconOf("ORDER_NEW_ADMIN")} <b>ĐƠN HÀNG MỚI</b>\n`
        + `${iconOf("ORDER_PRODUCT")} ${escapeHtml(product.name)} x${order.quantity}\n`
        + `${iconOf("ACCOUNT")} User: <code>${escapeHtml(String(order.odelegramId))}</code>\n`
        + `${iconOf("ORDER_TOTAL")} ${(order.finalAmount ?? 0).toLocaleString()}đ\n`
        + `🆔 <code>${orderId}</code>`;
    for (const adminId of ADMIN_IDS) {
        try {
            await telegram.sendMessage(adminId, msg, { parse_mode: "HTML" });
        } catch (err) {
            console.error(`[notifyAdmins] fail to ${adminId}:`, err.message);
        }
    }
}

function escapeHtml(value = "") {
    return String(value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

function splitPlainText(text, maxLength = 3500) {
    const source = String(text || "");
    if (!source) return [];
    const chunks = [];
    let remaining = source;
    while (remaining.length > maxLength) {
        let cut = remaining.lastIndexOf("\n", maxLength);
        if (cut < Math.floor(maxLength * 0.5)) cut = maxLength;
        chunks.push(remaining.slice(0, cut));
        remaining = remaining.slice(cut).replace(/^\n/, "");
    }
    if (remaining) chunks.push(remaining);
    return chunks;
}

function buildAccountMessages({ productName, quantity, description, items, headerNote = "", lang = "vi", deliveredAt = null }) {
    const copy = deliveryCopy(lang);
    const header = `${copy.delivery}\n${copy.product}: ${productName} x ${quantity}${headerNote}`
        + `\n${copy.time}: ${vnDeliveryTime(deliveredAt || new Date())}`
        + (description ? `\n\n${copy.description}:\n${description}` : "");
    const messages = splitPlainText(header);

    items.forEach((item, index) => {
        const itemChunks = splitPlainText(`#${index + 1}\n${item.content}`);
        for (const chunk of itemChunks) {
            const lastIndex = messages.length - 1;
            if (lastIndex >= 0 && messages[lastIndex].length + chunk.length + 2 <= 3500) {
                messages[lastIndex] += `\n\n${chunk}`;
            } else {
                messages.push(chunk);
            }
        }
    });
    return messages;
}

async function sendAccountMessages(telegram, chatId, details, replyMarkup = null) {
    const messages = buildAccountMessages(details);
    for (let index = 0; index < messages.length; index++) {
        const isLast = index === messages.length - 1;
        await telegram.sendMessage(chatId, messages[index], {
            ...(isLast && replyMarkup ? { reply_markup: replyMarkup } : {}),
        });
    }
}

function sendSupplementalDocument(telegram, chatId, document, options, orderId) {
    telegram.sendDocument(chatId, document, options).catch((error) => {
        console.warn(`[deliver] optional attachment skipped for ${orderId}: ${error.message}`);
    });
}

export function buildOrderChannelMessage({ order, product, user }) {
    const buyerName = user?.username || user?.firstName || "customer";
    const maskedName = maskBuyerName(buyerName);
    const amount = (order.finalAmount ?? 0).toLocaleString("vi-VN");
    return `${iconOf("ORDER_NEW_ADMIN")} <b>ĐƠN ${escapeHtml(product.name)} (tự giao)</b>\n`
        + `${iconOf("ACCOUNT")} Khách: <b>${escapeHtml(maskedName)}</b>\n`
        + `${iconOf("ORDER_QTY")} Số lượng: ${order.quantity}\n`
        + `${iconOf("ORDER_TOTAL")} Tổng: ${amount} VND`;
}

async function notifyOrderChannel({ telegram, order, product, user, buyUrlOverride = null }) {
    if (!(await isOrderChannelNotifyEnabled())) return;
    const channelId = await getOrderNotifyChannel();
    if (!channelId) return;
    try {
        // buyUrlOverride (vd deep link Claude Key) ưu tiên hơn deep link sản phẩm —
        // đơn Claude Key dùng Product ẩn nên không có deep link product hợp lệ.
        const productUrl = buyUrlOverride || await getProductDeepLink(telegram, product.id);
        await telegram.sendMessage(
            channelId,
            buildOrderChannelMessage({ order, product, user }),
            {
                parse_mode: "HTML",
                ...(productUrl ? {
                    reply_markup: {
                        inline_keyboard: [[{ text: `${iconOf("LIST_PRODUCTS")} Mua ${product.name}`.slice(0, 40), url: productUrl }]],
                    },
                } : {}),
            }
        );
    } catch (err) {
        console.error(`[notifyOrderChannel] fail to ${channelId}:`, err.message);
    }
}

function channelButton() {
    const url = getSupportChannelUrlSync();
    if (!url) return null;
    return { inline_keyboard: [[{ text: `${iconOf("JOIN_GROUP")} Vào Channel Khách Hàng`, url }]] };
}

// Lỗi mạng TẠM THỜI tới Telegram (VPS chập chờn) — nên retry thay vì fail cả đơn.
function isTransientSendError(err) {
    if (!err) return false;
    if (err.code === 429) return true;
    const m = String(err.message || err.description || "").toLowerCase();
    return /socket hang up|econnreset|etimedout|timed out|timeout|network|eai_again|enotfound|fetch failed|internal server error|bad gateway|gateway time/.test(m);
}

// Bọc lệnh gửi Telegram với retry backoff cho lỗi mạng tạm thời.
async function sendWithRetry(fn, label = "send", attempts = Number(process.env.TELEGRAM_SEND_RETRY_ATTEMPTS || 6)) {
    let lastErr;
    for (let i = 0; i < attempts; i++) {
        try { return await fn(); }
        catch (e) {
            lastErr = e;
            if (i === attempts - 1 || !isTransientSendError(e)) throw e;
            const waitMs = e.code === 429
                ? ((e.parameters?.retry_after || 3) * 1000)
                : Math.min(15000, 1000 * Math.pow(2, i));
            console.warn(`[deliver] ${label} lỗi tạm (${e.message}), thử lại sau ${waitMs}ms (${i + 1}/${attempts})`);
            await new Promise((r) => setTimeout(r, waitMs));
        }
    }
    throw lastErr;
}

// Proxy telegram: các lệnh sendMessage/sendDocument/sendPhoto tự retry khi mạng lỗi.
function wrapTelegramWithRetry(baseTg) {
    const wrapped = new Set(["sendMessage", "sendDocument", "sendPhoto"]);
    return new Proxy(baseTg, {
        get(target, prop, receiver) {
            if (wrapped.has(prop) && typeof target[prop] === "function") {
                return (...args) => {
                    const attempts = prop === "sendDocument"
                        ? Number(process.env.TELEGRAM_DOCUMENT_RETRY_ATTEMPTS || 2)
                        : Number(process.env.TELEGRAM_SEND_RETRY_ATTEMPTS || 6);
                    return sendWithRetry(() => target[prop](...args), prop, attempts);
                };
            }
            const val = Reflect.get(target, prop, receiver);
            return typeof val === "function" ? val.bind(target) : val;
        },
    });
}

export async function deliverOrder({ prisma, telegram, order }) {
    // Allow telegram=null (e.g. API purchases) — wrap to silently skip message sends
    if (!telegram) {
        telegram = { sendMessage: () => Promise.resolve(), sendDocument: () => Promise.resolve(), sendPhoto: () => Promise.resolve() };
    }
    // Bọc retry để lỗi mạng tạm thời (socket hang up/ECONNRESET/429) không làm hỏng cả đơn.
    telegram = wrapTelegramWithRetry(telegram);
    // Atomic gate: chỉ deliver order ở status PAID. Nếu đã CANCELED/CANCELING/DELIVERED → skip.
    // Tránh race khi user cancel ngay lúc bot đang deliver.
    const claimed = await prisma.order.updateMany({
        where: { id: order.id, status: "PAID" },
        data: { status: "DELIVERING" },
    });
    if (claimed.count === 0) {
        const fresh = await prisma.order.findUnique({ where: { id: order.id } });
        console.log(`[deliver] skip ${order.id}, status=${fresh?.status}`);
        return { skipped: true, reason: `status=${fresh?.status}` };
    }

    // product và user độc lập → fetch song song (user chỉ dùng cho lang + notify về sau).
    const [product, user] = await Promise.all([
        prisma.product.findUnique({ where: { id: order.productId } }),
        order.userId
            ? prisma.user.findUnique({ where: { id: order.userId } }).catch(() => null)
            : Promise.resolve(null),
    ]);
    if (!product) {
        // Rollback nếu product biến mất
        await prisma.order.update({
            where: { id: order.id },
            data: { status: "PAID" },
        }).catch(() => {});
        throw new Error("Product not found");
    }

    const chatId = Number(order.chatId);
    const lang = user?.language || "vi";

    let result;
    try {
        switch (product.deliveryMode) {
            case "STOCK_LINES":
                result = await deliverStockLines({ prisma, telegram, order, product, chatId, lang });
                break;
            case "TEXT":
                result = await deliverText({ prisma, telegram, order, product, chatId, lang });
                break;
            case "FILE":
                result = await deliverFile({ prisma, telegram, order, product, chatId, lang });
                break;
            case "CONTACT":
                result = await deliverContact({ prisma, telegram, order, product, chatId, lang });
                break;
            case "API_CALL":
                result = await deliverApiCall({ prisma, telegram, order, product, chatId, lang });
                break;
            case "API_KEY":
                result = await deliverApiKey({ prisma, telegram, order, product, chatId, lang });
                break;
            default:
                throw new Error(`Unknown delivery mode: ${product.deliveryMode}`);
        }
    } catch (err) {
        // Revert DELIVERING → PAID so admin can retry
        const reverted = await prisma.order.updateMany({
            where: { id: order.id, status: "DELIVERING" },
            data: { status: "PAID" },
        }).catch(() => ({ count: 0 }));
        console.error(`[deliver] failed order ${order.id}${reverted.count ? ", reverted to PAID" : ""}:`, err.message);
        throw err;
    }

    // Run post-delivery tasks in parallel — neither blocks the other
    // OUT_OF_STOCK means order was canceled — skip referral/VIP for those
    const delivered = result?.deliveryRef !== "OUT_OF_STOCK";
    // Các việc hậu giao hàng chạy song song, không cái nào chặn cái nào — nhưng
    // KHÔNG được thất bại âm thầm: hoa hồng/VIP/thông báo hỏng mà không ai biết thì
    // khách mất hoa hồng, admin không biết có đơn (M4). Log từng cái rớt kèm orderId.
    const postTasks = [
        order.userId && delivered
            ? ["processReferralCommission", processReferralCommission(order.userId, order.id, order.finalAmount)]
            : null,
        order.userId && delivered
            ? ["addSpending", addSpending(order.userId, order.finalAmount)]
            : null,
        product.deliveryMode === "STOCK_LINES"
            ? ["checkStock", checkStock({ telegram }, product.id)]
            : null,
        ["notifyOrderChannel", notifyOrderChannel({ telegram, order, product, user })],
        ["notifyAdmins", notifyAdmins({ telegram, order, product })],
    ].filter(Boolean);

    const postResults = await Promise.allSettled(postTasks.map(([, promise]) => promise));
    postResults.forEach((outcome, index) => {
        if (outcome.status !== "rejected") return;
        const name = postTasks[index][0];
        const reason = outcome.reason?.message || String(outcome.reason);
        console.error(`[deliver] post-task ${name} failed for order ${order.id}:`, reason);
        sendLog("ERROR", `Hậu giao hàng lỗi: ${name}\nĐơn: ${order.id}\nLỗi: ${reason}`);
    });

    // Thông báo "ĐƠN HÀNG MỚI" tới tất cả user — chạy nền, KHÔNG await để
    // không làm chậm luồng giao hàng cho người mua.
    if (delivered) {
        broadcastNewOrder({ telegram }, {
            productName: product.name,
            productId: product.id,
            quantity: order.quantity,
            price: product.price,
            currency: (product.currency || order.currency || "VND"),
            buyerName: user?.username || user?.firstName || "",
            buyerTelegramId: order.odelegramId || order.telegramId || order.chatId,
            buyUrl: null,
        }).catch((e) => console.error("[broadcastNewOrder]", e.message));
    }

    return result;
}

async function deliverContact({ prisma, telegram, order, product, chatId, lang = "vi" }) {
    const adminUsername = process.env.ADMIN_TELEGRAM || "admin";
    const orderId = formatOrderCode(order.id);

    await prisma.order.update({
        where: { id: order.id },
        data: {
            status: "DELIVERED",
            deliveryRef: "CONTACT",
            deliveryContent: `Liên hệ admin @${adminUsername} để nhận hàng. Mã đơn: ${orderId}`,
        },
    });

    // Notify admin (song song) + báo khách CÙNG LÚC — khách không phải đợi hết admin.
    const adminIds = (process.env.ADMIN_IDS || "").split(",").map(id => id.trim()).filter(Boolean);
    const adminNotify = adminIds.map((adminId) =>
        telegram.sendMessage(
            adminId,
            `${iconOf("ORDER_DELIVERY")} <b>Đơn CONTACT cần xử lý</b>\n\n` +
            `Mã đơn: <code>${escapeHtml(orderId)}</code>\n` +
            `Sản phẩm: ${escapeHtml(product.name)}\n` +
            `User: <code>${escapeHtml(String(order.odelegramId))}</code>\n` +
            `Số tiền: ${order.finalAmount.toLocaleString()}đ`,
            { parse_mode: "HTML" }
        ).catch((err) => console.error(`[deliverContact] notify admin ${adminId} fail:`, err.message))
    );

    const customerNotify = telegram.sendMessage(
        chatId,
        `<b>Đặt hàng thành công</b>\n━━━━━━━━━━━━━━━━\nMã đơn: <code>${escapeHtml(orderId)}</code>\nSản phẩm: <b>${escapeHtml(product.name)}</b>\n${iconOf("ORDER_TIME")} Thời gian: <b>${escapeHtml(vnDeliveryTime())}</b>\n\nAdmin sẽ liên hệ bạn để giao hàng.\nVui lòng liên hệ: @${escapeHtml(adminUsername)}`,
        { parse_mode: "HTML" }
    );

    await Promise.allSettled([...adminNotify, customerNotify]);
    return { deliveryRef: "CONTACT" };
}

async function deliverStockLines({ prisma, telegram, order, product, chatId, lang = "vi" }) {
    const isWallet = order.paymentMethod === "wallet";
    const orderId = formatOrderCode(order.id);
    const copy = deliveryCopy(lang);

    // Partial or full out-of-stock: deliver what's available, refund the rest
    async function handlePartialOrOutOfStock(claimedItems, requested) {
        const delivered = claimedItems.length;
        const missing = requested - delivered;
        const unitPrice = Math.floor(order.finalAmount / requested);
        const refundAmount = missing * unitPrice;

        if (delivered === 0) {
            // Nothing to deliver — full refund + cancel
            if (isWallet && order.finalAmount > 0) {
                const refundResult = await refund(String(order.odelegramId || order.chatId), order.finalAmount, order.id, `Hoàn tiền hết hàng — đơn #${orderId}`);
                if (!refundResult?.success) throw new Error(refundResult?.error || "Refund failed");
            }
            await prisma.order.updateMany({
                where: { id: order.id, status: "DELIVERING" },
                data: { status: "CANCELED", deliveryRef: "OUT_OF_STOCK" },
            });
            await telegram.sendMessage(chatId,
                isWallet
                    ? `${iconOf("STATUS_ERROR")} <b>Hết hàng</b>\nĐơn <code>${orderId}</code> đã bị hủy.\n${iconOf("STATUS_SUCCESS")} Hoàn <b>${order.finalAmount.toLocaleString()}đ</b> vào ví.`
                    : `${iconOf("STATUS_ERROR")} <b>Hết hàng</b>\nĐơn <code>${orderId}</code> đã bị hủy.\nAdmin sẽ liên hệ hoàn tiền.`,
                { parse_mode: "HTML" }
            ).catch((error) => console.warn(`[deliver] order ${order.id} canceled/refunded but customer notification failed: ${error.message}`));
            return { deliveryRef: "OUT_OF_STOCK" };
        }

        // Partial delivery — send what we have + refund missing portion
        if (isWallet && refundAmount > 0) {
            await refund(String(order.odelegramId || order.chatId), refundAmount, order.id, `Hoàn tiền thiếu hàng ${missing}/${requested} — đơn #${orderId}`).catch(console.error);
        }

        // Build and send partial delivery file
        const deliveredAt = new Date();
        const dateStr = vnDeliveryTime(deliveredAt);
        let fileContent = `ĐƠN HÀNG: ${orderId}\n`;
        fileContent += `Sản phẩm: ${product.name} × ${delivered} (giao được ${delivered}/${requested})\n`;
        fileContent += `Ngày: ${dateStr}\n`;
        if (product.description) fileContent += `\n── Hướng dẫn ──\n${product.description}\n`;
        fileContent += `\n── Tài khoản ──\n`;
        claimedItems.forEach((item, i) => { fileContent += `#${i + 1}\n${item.content}\n\n`; });

        const partialNote = isWallet && refundAmount > 0
            ? `\n${iconOf("STATUS_WARNING")} Chỉ còn <b>${delivered}/${requested}</b> sản phẩm. Đã hoàn <b>${refundAmount.toLocaleString()}đ</b> vào ví.`
            : `\n${iconOf("STATUS_WARNING")} Chỉ giao được <b>${delivered}/${requested}</b> sản phẩm.`;

        let caption = `${iconOf("STATUS_SUCCESS")} <b>Giao hàng (một phần)</b>\n━━━━━━━━━━━━━━━━\nMã đơn: <code>${orderId}</code>\nSản phẩm: <b>${escapeHtml(product.name)}</b> × ${delivered}\n${iconOf("ORDER_TIME")} ${copy.time}: <b>${escapeHtml(dateStr)}</b>${partialNote}`;
        if (product.description) caption += `\n\n${iconOf("DELIVERY_DESC")} ${escapeHtml(product.description.slice(0, 200))}`;
        if (caption.length > 1020) caption = caption.slice(0, 1020) + "…";

        const kb = channelButton();
        const filename = `ORD${orderId}_PARTIAL.txt`;
        await sendAccountMessages(telegram, chatId, {
            productName: product.name,
            quantity: delivered,
            description: product.description,
            items: claimedItems,
            headerNote: ` (${delivered}/${requested})`,
            lang,
            deliveredAt,
        }, kb);

        const deliveryContent = fileContent;
        await prisma.order.update({
            where: { id: order.id },
            data: { status: "DELIVERED", deliveryRef: `PARTIAL:${claimedItems.map(i => i.id).join(",")}`, deliveryContent },
        });
        invalidateStockCache(product.id);
        sendSupplementalDocument(
            telegram,
            chatId,
            { source: Buffer.from(fileContent, "utf-8"), filename },
            { caption, parse_mode: "HTML", ...(kb ? { reply_markup: kb } : {}) },
            order.id
        );
        return { deliveryRef: `PARTIAL:${delivered}/${requested}` };
    }

    // Step 1: Find candidates
    const existingItems = await prisma.stockItem.findMany({
        where: { productId: product.id, orderId: order.id },
        orderBy: { createdAt: "asc" },
    });
    const missingQuantity = Math.max(0, order.quantity - existingItems.length);
    const candidates = await prisma.stockItem.findMany({
        where: { productId: product.id, isSold: false },
        take: missingQuantity,
        orderBy: { createdAt: "asc" },
    });

    const candidateIds = candidates.map((c) => c.id);

    // Step 2: Atomic claim — only marks items that are STILL isSold: false
    if (candidateIds.length) {
        await prisma.stockItem.updateMany({
            where: { id: { in: candidateIds }, isSold: false },
            data: { isSold: true, soldAt: new Date(), orderId: order.id },
        });
        // Tồn kho vừa giảm → xóa cache đếm để danh sách hiện số đúng ngay.
        invalidateStockCache(product.id);
    }

    if (existingItems.length + candidateIds.length < order.quantity) {
        // Race condition or partial stock — fetch what we actually claimed
        const claimedItems = await prisma.stockItem.findMany({
            where: { productId: product.id, orderId: order.id },
            orderBy: { createdAt: "asc" },
        });
        return handlePartialOrOutOfStock(claimedItems, order.quantity);
    }

    // Step 3: Fetch the claimed items in order (for delivery content)
    const items = await prisma.stockItem.findMany({
        where: { productId: product.id, orderId: order.id },
        take: order.quantity,
        orderBy: { createdAt: "asc" },
    });
    if (items.length < order.quantity) {
        return handlePartialOrOutOfStock(items, order.quantity);
    }
    const deliveredAt = new Date();
    const dateStr = vnDeliveryTime(deliveredAt);
    let fileContent = "";
    fileContent += `ĐƠN HÀNG: ${orderId}\n`;
    fileContent += `Sản phẩm: ${product.name} × ${order.quantity}\n`;
    fileContent += `Ngày: ${dateStr}\n`;

    if (product.description) {
        fileContent += `\n── Hướng dẫn ──\n${product.description}\n`;
    }

    fileContent += `\n── Tài khoản ──\n`;
    items.forEach((item, index) => {
        fileContent += `#${index + 1}\n${item.content}\n\n`;
    });

    const filename = `ORD${orderId}_DELIVERY.txt`;
    const kb = channelButton();

    let caption = `${iconOf("STATUS_SUCCESS")} <b>Giao hàng thành công</b>\n━━━━━━━━━━━━━━━━\n` +
        `Mã đơn: <code>${orderId}</code>\n` +
        `Sản phẩm: <b>${escapeHtml(product.name)}</b> × ${order.quantity}\n` +
        `${iconOf("ORDER_TIME")} ${copy.time}: <b>${escapeHtml(dateStr)}</b>`;
    if (product.description) {
        const shortDesc = escapeHtml(product.description.slice(0, 300));
        caption += `\n\n${iconOf("DELIVERY_DESC")} ${shortDesc}`;
    }
    // Telegram caption limit is 1024 chars
    if (caption.length > 1020) caption = caption.slice(0, 1020) + "…";

    // Build inline account text for direct display in chat (an toàn, không cắt giữa thẻ HTML)
    await sendAccountMessages(telegram, chatId, {
        productName: product.name,
        quantity: order.quantity,
        description: product.description,
        items,
        lang,
        deliveredAt,
    }, kb);

    await prisma.order.update({
        where: { id: order.id },
        data: {
            status: "DELIVERED",
            deliveryRef: `STOCK:${items.map((item) => item.id).join(",")}`,
            deliveryContent: fileContent,
        },
    });
    invalidateStockCache(product.id);

    sendSupplementalDocument(
        telegram,
        chatId,
        { source: Buffer.from(fileContent, "utf-8"), filename },
        { caption, parse_mode: "HTML", ...(kb ? { reply_markup: kb } : {}) },
        order.id
    );

    return { deliveryRef: `STOCK:${items.map((item) => item.id).join(",")}` };
}

// ─── Giao API key (GPT2API) ─────────────────────────────────────────────────────
// Order dùng Product ẩn code=__API_KEY__, deliveryMode=API_KEY. Lượng token nằm
// TRÊN CHÍNH order (`order.apikeyTokens`) chứ không phải Setting JSON: bản aiplus cũ
// dùng map trong một Setting document, hai đơn đồng thời ghi đè nhau và đơn mất cấu
// hình sẽ kẹt PAID mãi. Adapter Mongo nhận field lạ nên ghi thẳng vào order được.
//
// Tạo key lỗi: thanh toán bằng ví → hoàn tiền + huỷ đơn (khách không mất gì).
// Nguồn khác (QR/crypto — hiện không mở cho key) → giữ PAID để admin xử lý tay.
async function deliverApiKey({ prisma, telegram, order, chatId, lang = "vi" }) {
    const orderId = formatOrderCode(order.id);

    // Đã giao rồi (retry/poller gọi lại) → gửi lại key đã lưu, KHÔNG tạo key mới.
    const persisted = await prisma.order.findUnique({ where: { id: order.id } }).catch(() => null);
    if (persisted?.deliveryRef === "API_KEY" && persisted.deliveryContent) {
        await sendApiKeyDelivery(telegram, chatId, persisted.deliveryContent, lang);
        await prisma.order.update({ where: { id: order.id }, data: { status: "DELIVERED" } }).catch(() => {});
        return { deliveryRef: "API_KEY", reused: true };
    }

    const quotaTokens = Number(order.apikeyTokens ?? persisted?.apikeyTokens ?? 0);
    if (!(quotaTokens > 0)) {
        await prisma.order.update({ where: { id: order.id }, data: { status: "PAID" } }).catch(() => {});
        await notifyApiKeyFailure(telegram, chatId, order, orderId, "Đơn thiếu số token (apikeyTokens)");
        throw new Error(`API_KEY order ${order.id} missing apikeyTokens`);
    }

    const cfg = await getGpt2apiConfig().catch(() => ({}));
    const rpm = Number(order.apikeyRpm ?? persisted?.apikeyRpm ?? cfg.rpm ?? 0);

    const created = await createApiKey({
        quotaTokens,
        name: `order-${orderId}`,
        rpm: rpm > 0 ? rpm : undefined,
    });

    if (!created.ok || !created.key) {
        const isWallet = order.paymentMethod === "wallet";
        if (isWallet && order.finalAmount > 0) {
            await refund(
                String(order.odelegramId || order.chatId),
                order.finalAmount,
                order.id,
                `Hoàn tiền: tạo API key thất bại — đơn #${orderId}`,
            ).catch((e) => console.error(`[deliverApiKey] refund fail ${order.id}:`, e.message));
            await prisma.order.update({
                where: { id: order.id },
                data: { status: "CANCELED", cancelReason: `apikey_fail:${created.code || "?"}` },
            }).catch(() => {});
            await telegram.sendMessage(
                chatId,
                `${iconOf("STATUS_WARNING")} <b>Không tạo được API key</b>\n━━━━━━━━━━━━━━━━\n`
                + `Mã đơn: <code>${escapeHtml(orderId)}</code>\n`
                + `Nhà cung cấp tạm thời không cấp được key.\n\n`
                + `${iconOf("STATUS_SUCCESS")} Đã hoàn <b>${(order.finalAmount || 0).toLocaleString("vi-VN")}đ</b> vào ví của bạn.`,
                { parse_mode: "HTML" },
            ).catch(() => {});
        } else {
            await prisma.order.update({ where: { id: order.id }, data: { status: "PAID" } }).catch(() => {});
            await notifyApiKeyFailure(telegram, chatId, order, orderId, created.message || created.code || "lỗi");
        }
        throw new Error(`API_KEY create fail order ${order.id}: ${created.code} ${created.message || ""}`);
    }

    // Key đã tồn tại bên provider — lưu vào kho key của khách trước khi báo giao xong.
    await saveIssuedKey({
        telegramId: String(order.odelegramId || order.chatId),
        key: created.key,
        quotaTokens,
        rpm,
        source: KeySource.PURCHASE,
        orderId: order.id,
        priceUsd: order.displayFinalUsd ?? null,
        externalId: created.id,
        models: cfg.models || [],
    }).catch((e) => console.error("[deliverApiKey] saveIssuedKey:", e.message));

    const payload = JSON.stringify({
        key: created.key,
        quotaTokens,
        rpm,
        models: cfg.models || [],
        endpoint: cfg.endpoint || "",
        usageUrl: cfg.usageUrl || "",
        docUrl: cfg.docUrl || "",
        priceUsd: order.displayFinalUsd ?? null,
    });

    await prisma.order.update({
        where: { id: order.id },
        data: { status: "DELIVERED", deliveryRef: "API_KEY", deliveryContent: payload },
    });

    await sendApiKeyDelivery(telegram, chatId, payload, lang);
    return { deliveryRef: "API_KEY" };
}

async function sendApiKeyDelivery(telegram, chatId, payload, lang = "vi") {
    let d = {};
    try { d = JSON.parse(payload); } catch { /* payload cũ/lỗi → vẫn gửi phần đọc được */ }

    const text = apiKeyMessage({
        key: d.key || "",
        quotaTokens: d.quotaTokens || 0,
        rpm: d.rpm || 0,
        models: d.models || [],
        endpoint: d.endpoint || "",
        usageUrl: d.usageUrl || "",
        kind: "buy",
        priceUsd: d.priceUsd ?? null,
        lang,
        icon: iconOf,
    });

    await telegram.sendMessage(chatId, text, {
        parse_mode: "HTML",
        disable_web_page_preview: true,
        ...buildApiKeyDeliveredKeyboard({ lang, docUrl: d.docUrl || "" }),
    }).catch((e) => {
        console.error("[sendApiKeyDelivery] gửi tin thất bại:", e.message);
        throw e;
    });
}

async function notifyApiKeyFailure(telegram, chatId, order, orderId, reason) {
    await telegram.sendMessage(
        chatId,
        `${iconOf("STATUS_WARNING")} <b>Đơn API key cần admin xử lý</b>\n━━━━━━━━━━━━━━━━\n`
        + `Mã đơn: <code>${escapeHtml(orderId)}</code>\n`
        + `Chúng tôi đã nhận thanh toán nhưng chưa cấp được key. Admin sẽ xử lý sớm.`,
        { parse_mode: "HTML" },
    ).catch(() => {});

    for (const adminId of ADMIN_IDS) {
        await telegram.sendMessage(
            adminId,
            `${iconOf("STATUS_ERROR")} <b>API_KEY giao lỗi — cần xử lý tay</b>\n\n`
            + `Đơn: <code>${escapeHtml(orderId)}</code>\n`
            + `Khách: <code>${escapeHtml(String(order.odelegramId || ""))}</code>\n`
            + `Số tiền: ${(order.finalAmount || 0).toLocaleString("vi-VN")}đ\n`
            + `Token: ${Number(order.apikeyTokens || 0).toLocaleString("en-US")}\n`
            + `Lý do: ${escapeHtml(String(reason))}`,
            { parse_mode: "HTML" },
        ).catch(() => {});
    }
}

async function deliverText({ prisma, telegram, order, product, chatId, lang = "vi" }) {
    const copy = deliveryCopy(lang);
    let text;
    try {
        const parsed = JSON.parse(product.payload || "{}");
        text = parsed.text || product.payload;
    } catch {
        text = product.payload || "Đã thanh toán thành công.";
    }

    await prisma.order.update({
        where: { id: order.id },
        data: {
            status: "DELIVERED",
            deliveryRef: "TEXT",
            deliveryContent: text,
        },
    });

    const orderId = formatOrderCode(order.id);
    const kb = channelButton();

    const header = `<b>${copy.delivery}</b>\n━━━━━━━━━━━━━━━━\n` +
        `${copy.order}: <code>${orderId}</code>\n` +
        `${copy.product}: <b>${escapeHtml(product.name)}</b>\n` +
        `${iconOf("ORDER_TIME")} ${copy.time}: <b>${escapeHtml(vnDeliveryTime())}</b>\n\n` +
        (product.description ? `${escapeHtml(product.description)}\n\n` : "");

    const fullMsg = header +
        `<b>${copy.content}</b>\n<code>${escapeHtml(text)}</code>\n\n` +
        copy.thanks;

    // Telegram giới hạn 4096 ký tự. Nếu nội dung quá lớn → gửi kèm file để tránh
    // lỗi "can't parse entities" do cắt giữa thẻ <code>.
    if (fullMsg.length > 4000) {
        const chunks = splitPlainText(text);
        await telegram.sendMessage(chatId, header, { parse_mode: "HTML" });
        for (let index = 0; index < chunks.length; index++) {
            await telegram.sendMessage(chatId, chunks[index], {
                ...(index === chunks.length - 1 && kb ? { reply_markup: kb } : {}),
            });
        }
        sendSupplementalDocument(
            telegram,
            chatId,
            { source: Buffer.from(text, "utf-8"), filename: `ORD${orderId}.txt` },
            { caption: `Order ${orderId}` },
            order.id
        );
        return { deliveryRef: "TEXT" };
    }

    await telegram.sendMessage(chatId, fullMsg, { parse_mode: "HTML", ...(kb ? { reply_markup: kb } : {}) });

    return { deliveryRef: "TEXT" };
}

async function deliverFile({ prisma, telegram, order, product, chatId, lang = "vi" }) {
    const copy = deliveryCopy(lang);
    const filePath = product.payload;
    if (!filePath) throw new Error("FILE mode requires payload");

    const absolutePath = path.resolve(filePath);
    await fs.access(absolutePath);

    const buffer = await fs.readFile(absolutePath);
    const filename = path.basename(absolutePath);

    const orderId = formatOrderCode(order.id);
    const kb = channelButton();
    const timeLine = `${iconOf("ORDER_TIME")} ${copy.time}: <b>${escapeHtml(vnDeliveryTime())}</b>`;

    if (product.description) {
        await telegram.sendMessage(
            chatId,
            `<b>Giao hàng thành công</b>\n━━━━━━━━━━━━━━━━\n` +
            `Mã đơn: <code>${orderId}</code>\n` +
            `Sản phẩm: <b>${escapeHtml(product.name)}</b> x${order.quantity}\n` +
            `${timeLine}\n\n` +
            `${iconOf("DELIVERY_DESC")} <b>Mô tả:</b>\n${escapeHtml(product.description)}`,
            { parse_mode: "HTML" }
        );
    }

    let deliveryRef = `FILE:${filePath}`;
    try {
        await telegram.sendDocument(
            chatId,
            { source: buffer, filename },
            {
                caption: product.description
                    ? `${iconOf("DELIVERY_FILE")} File giao hàng — Mã đơn: <code>${orderId}</code>`
                    : `<b>Giao hàng thành công</b>\n━━━━━━━━━━━━━━━━\n` +
                      `Mã đơn: <code>${orderId}</code>\n` +
                      `Sản phẩm: <b>${escapeHtml(product.name)}</b> x${order.quantity}\n` +
                      `${timeLine}`,
                parse_mode: "HTML",
                ...(kb ? { reply_markup: kb } : {}),
            }
        );
    } catch (error) {
        const textExtensions = new Set([".txt", ".csv", ".json", ".log", ".md", ".xml", ".html", ".ini", ".env"]);
        const extension = path.extname(filename).toLowerCase();
        if (!textExtensions.has(extension) || buffer.length > 200_000) throw error;

        const chunks = splitPlainText(buffer.toString("utf-8"));
        await telegram.sendMessage(chatId, `${copy.uploadFallback}. ${copy.order} ${orderId}:`);
        for (let index = 0; index < chunks.length; index++) {
            await telegram.sendMessage(chatId, chunks[index], {
                ...(index === chunks.length - 1 && kb ? { reply_markup: kb } : {}),
            });
        }
        deliveryRef = `FILE_TEXT_FALLBACK:${filePath}`;
    }

    await prisma.order.update({
        where: { id: order.id },
        data: { status: "DELIVERED", deliveryRef },
    });

    return { deliveryRef };
}

async function deliverApiCall({ prisma, telegram, order, product, chatId, lang = "vi" }) {
    const copy = deliveryCopy(lang);
    const orderId = formatOrderCode(order.id);
    let config = {};
    try { config = JSON.parse(product.payload || "{}"); } catch {}
    const { baseUrl = "", purchaseEndpoint = "", apiKey = "", authMode = "bearer", customHeaders = "", providerProductId, listEndpoint = "", idField = "", stockField = "" } = config;

    const kb = channelButton();
    const apiHeader = `<b>${copy.delivery}</b>\n━━━━━━━━━━━━━━━━\n` +
        `${copy.order}: <code>${orderId}</code>\n` +
        `${copy.product}: <b>${escapeHtml(product.name)}</b>\n` +
        `${iconOf("ORDER_TIME")} ${copy.time}: <b>${escapeHtml(vnDeliveryTime())}</b>\n\n` +
        (product.description ? `${iconOf("DELIVERY_DESC")} ${copy.description}: ${escapeHtml(product.description)}\n\n` : "");
    const sendApiContent = async (content) => {
        const value = String(content);
        const fullMessage = apiHeader +
            `<b>${copy.content}:</b>\n<code>${escapeHtml(value)}</code>\n\n` +
            copy.thanks;

        if (fullMessage.length <= 4000) {
            await telegram.sendMessage(chatId, fullMessage, { parse_mode: "HTML", ...(kb ? { reply_markup: kb } : {}) });
            return;
        }

        await telegram.sendMessage(chatId, apiHeader, { parse_mode: "HTML" });
        const chunks = splitPlainText(value);
        for (let index = 0; index < chunks.length; index++) {
            await telegram.sendMessage(chatId, chunks[index], {
                ...(index === chunks.length - 1 && kb ? { reply_markup: kb } : {}),
            });
        }
        sendSupplementalDocument(
            telegram,
            chatId,
            { source: Buffer.from(value, "utf-8"), filename: `ORD${orderId}.txt` },
            { caption: `Order ${orderId}` },
            order.id
        );
    };

    const persistedOrder = await prisma.order.findUnique({ where: { id: order.id } }).catch(() => null);
    if (persistedOrder?.deliveryRef === "API_CALL" && persistedOrder.deliveryContent) {
        await sendApiContent(persistedOrder.deliveryContent);
        await prisma.order.update({ where: { id: order.id }, data: { status: "DELIVERED" } });
        return { deliveryRef: "API_CALL", reused: true };
    }

    try {
        const headers = { "Content-Type": "application/json", "Accept": "application/json" };
        if (apiKey) {
            if (authMode === "bearer")     headers["Authorization"] = `Bearer ${apiKey}`;
            else if (authMode === "plain") headers["Authorization"] = apiKey;
            else if (authMode === "x-api-key") headers["X-Api-Key"] = apiKey;
        }
        if (customHeaders) {
            customHeaders.split("\n").forEach((line) => {
                const [k, ...v] = line.split(":"); if (k && v.length) headers[k.trim()] = v.join(":").trim();
            });
        }

        // Kiểm tra tồn kho thực tế từ API provider trước khi mua
        if (listEndpoint && stockField && providerProductId) {
            let listUrl = `${baseUrl}${listEndpoint}`;
            if (authMode === "query" && apiKey) {
                listUrl += `${listUrl.includes("?") ? "&" : "?"}api_key=${encodeURIComponent(apiKey)}`;
            }
            const listData = await httpGet(listUrl, { ...headers, "Content-Type": undefined }).catch(() => null);
            if (listData) {
                const arr = Array.isArray(listData) ? listData
                    : (listData.data || listData.products || listData.items || listData.result || listData.list || []);
                const pid = String(providerProductId);
                const found = arr.find((p) =>
                    String(p[idField] ?? "") === pid ||
                    String(p._id ?? "") === pid ||
                    String(p.id ?? "") === pid
                );
                if (found) {
                    const sv = found[stockField];
                    const isOut = sv === null || sv === false || sv === "false" || sv === "0"
                        || (typeof sv === "number" && sv <= 0)
                        || (typeof sv === "string" && !isNaN(sv) && Number(sv) <= 0);
                    if (isOut) {
                        // Hoàn tiền nếu thanh toán qua ví
                        if (order.paymentMethod === "wallet" && order.finalAmount > 0) {
                            await refund(String(order.odelegramId || order.chatId), order.finalAmount, order.id, `Hoàn tiền hết hàng — đơn #${orderId}`).catch(() => {});
                        }
                        await prisma.order.update({ where: { id: order.id }, data: { status: "CANCELED" } }).catch(() => {});
                        await telegram.sendMessage(chatId,
                            `${iconOf("OUT_OF_STOCK_SAD")} <b>Hết hàng</b>\n\nSản phẩm <b>${escapeHtml(product.name)}</b> hiện đã hết hàng tại nhà cung cấp.\n\n` +
                            (order.paymentMethod === "wallet" && order.finalAmount > 0
                                ? `${iconOf("STATUS_SUCCESS")} Đã hoàn <b>${order.finalAmount.toLocaleString()}đ</b> vào ví của bạn.`
                                : `Vui lòng liên hệ admin để được hoàn tiền.`),
                            { parse_mode: "HTML" }
                        ).catch(() => {});
                        return { deliveryRef: "OUT_OF_STOCK" };
                    }
                }
            }
        }

        let purchaseUrl = `${baseUrl}${purchaseEndpoint}`;
        if (authMode === "query" && apiKey) {
            const sep = purchaseUrl.includes("?") ? "&" : "?";
            purchaseUrl += `${sep}api_key=${encodeURIComponent(apiKey)}`;
        }
        const data = await httpPost(purchaseUrl,
            { productId: providerProductId, quantity: order.quantity, orderId },
            headers
        );
        const content = data.content || data.key || data.account || data.serial || data.code || data.result || data.data || JSON.stringify(data, null, 2);

        await prisma.order.update({
            where: { id: order.id },
            data: { status: "DELIVERED", deliveryRef: "API_CALL", deliveryContent: String(content) },
        });

        await sendApiContent(content);
        return { deliveryRef: "API_CALL" };
    } catch (e) {
        await prisma.order.update({ where: { id: order.id }, data: { status: "PAID" } }).catch(() => {});
        try {
            const supportSetting = await prisma.setting.findFirst({ where: { key: "SHOP_SUPPORT_USERNAME" } }).catch(() => null);
            const supportUsername = supportSetting?.value || process.env.ADMIN_TELEGRAM || null;
            const contactLine = supportUsername
                ? `\n\n${iconOf("CONTACT_ADMIN")} Liên hệ admin để nhận hàng hoặc được hỗ trợ: <a href="https://t.me/${supportUsername.replace("@", "")}">@${supportUsername.replace("@", "")}</a>`
                : "\n\nVui lòng liên hệ admin để nhận hàng hoặc được hoàn tiền.";
            const kb = supportUsername
                ? { inline_keyboard: [[{ text: `${iconOf("CONTACT_ADMIN")} Liên hệ Admin`, url: `https://t.me/${supportUsername.replace("@", "")}` }]] }
                : null;
            await telegram.sendMessage(
                chatId,
                `${iconOf("STATUS_WARNING")} <b>Đơn hàng #${orderId} chưa được giao tự động</b>\n\nMã đơn: <code>${orderId}</code>\nSản phẩm: <b>${escapeHtml(product.name)}</b>${contactLine}`,
                { parse_mode: "HTML", ...(kb ? { reply_markup: kb } : {}) }
            );
        } catch {}
        throw e;
    }
}

// getStockCount đã được export từ ./inventory.js — import từ đó để tránh duplicate.
