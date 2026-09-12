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
import { createApiKey, getProfileConfig, renewApiKey, invalidateKeyStatusCache, getSourceProfileId, isSafeApiKeyCreateFailure } from "./gpt2api.js";
import { KEY_SOURCES } from "./apikey-profiles.js";
import { saveIssuedKey, KeySource } from "./apikey-store.js";
import { toDisplayTokens } from "./apikey-renew.js";
import { formatTokens } from "./apikey-pricing.js";
import { apiKeyMessage } from "./bot-ui/apikey-messages.js";
import { buildApiKeyDeliveredKeyboard } from "./bot-ui/keyboards.js";

const ADMIN_IDS = (process.env.ADMIN_IDS || "").split(",").map((id) => id.trim()).filter(Boolean);

/** Cờ tạm đánh dấu "đơn gia hạn này đã bắt đầu gọi provider" (xem deliverApiKeyRenewal). */
/**
 * Phương thức mà khách ĐÃ trả tiền trước khi đơn được giao — giao lỗi thì phải
 * hoàn. Ví trừ ngay lúc bấm; QR ngân hàng và USDT chỉ chuyển PAID sau khi poller
 * thấy tiền về. Cả ba đều không đảo ngược được ở đầu kia, nên "hoàn" luôn có
 * nghĩa là cộng vào VÍ của khách.
 */
const PAID_UPFRONT_METHODS = new Set([
    "wallet",
    "vietqr",
    "crypto_trc20",
    "crypto_bep20",
    "crypto_binance_pay",
]);

/**
 * "Đơn này khách ĐÃ trả tiền thật chưa?" — dùng ở MỌI nơi quyết định có hoàn tiền.
 *
 * Xuất ra ngoài vì nút huỷ đơn của khách (`CONFIRM_CANCEL` trong bot.js) từng tự viết
 * luật riêng bằng đúng chuỗi `"wallet"`. Hậu quả: khách trả bằng QR ngân hàng hoặc
 * USDT, đơn đã PAID, bấm huỷ → đơn sang CANCELED, tiền thì đã nằm trong tài khoản
 * shop (chuyển khoản ngân hàng và on-chain đều KHÔNG đảo ngược được), không một
 * khoản hoàn, và log admin chỉ ghi "ĐƠN HÀNG BỊ HUỶ" không kèm dòng hoàn tiền nào để
 * ai đó chú ý. Khách mất tiền thật, im lặng.
 *
 * Một danh sách duy nhất ở đây: thêm phương thức thanh toán mới là sửa một chỗ, và
 * mọi nhánh hoàn tiền tự nhận ra nó. Gác bằng "khác rỗng" thì sai theo hướng ngược
 * lại — đơn admin cấp tay / khuyến mãi 0đ bị hoàn tiền khống.
 */
export function isPaidUpfrontMethod(paymentMethod) {
    return PAID_UPFRONT_METHODS.has(String(paymentMethod || "").toLowerCase());
}

const RENEW_WIP_REF = "API_KEY_RENEW_WIP";
const API_KEY_CREATE_WIP_REF = "API_KEY_CREATE_WIP";
const API_CALL_WIP_REF = "API_CALL_WIP";

// Quyết định "lỗi tạo key này có hoàn tiền được không" nằm ở
// gpt2api.js:isSafeApiKeyCreateFailure — KHÔNG nhân bản nó ở đây.
//
// Bản địa phương cũ (isSafeRefundCreateCode) chỉ nhìn `code` nên mất tín hiệu
// `providerMutationPossible`. Hậu quả: listModelGroups() lỗi mạng thoáng qua →
// createApiKey trả code "network" KÈM providerMutationPossible:false (chưa hề POST
// /keys nên chắc chắn không có key), nhưng code "network" bị coi là "không chắc
// chắn" → đơn đã trừ ví bị treo PAID + deliveryRetryBlockedAt, không hoàn tiền,
// không giao key, chờ admin soát tay. Một cú trục trặc mạng ở bước preflight biến
// thành một khách hàng mất tiền.
//
// isSafeApiKeyCreateFailure đọc providerMutationPossible:false → hoàn tiền ngay,
// trong khi lỗi mạng SAU khi POST /keys (providerMutationPossible:true) vẫn bị coi
// là mơ hồ và vẫn bị chặn — đúng cả hai chiều.
/**
 * Chỉ những mã lỗi phát sinh TRƯỚC khi PATCH được gửi đi mới hoàn tiền tự động.
 * Các mã còn lại (quota_not_applied, expiry_not_applied, network…) có thể đã cộng
 * một phần quota — hoàn tiền là khách vừa giữ token vừa lấy lại tiền.
 */
const SAFE_REFUND_RENEW_CODES = new Set([
    "key_not_found", "not_configured", "nothing_to_renew", "not_found", "40400",
]);

/**
 * Provider trả `code` lúc là number (40400), lúc là string. Chuẩn hoá ở đúng
 * chốt hoàn tiền để lỗi "key đã bị xoá" không bị giữ tiền chỉ vì lệch kiểu.
 */
function isSafeRefundRenewCode(code) {
    return SAFE_REFUND_RENEW_CODES.has(String(code ?? ""));
}

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
    // `skipped` = không thật sự giao gì trong lượt này (đơn gia hạn đã có lượt xử
    // lý trước, đang chờ admin soát). Broadcast nó là khoe một đơn không tồn tại.
    const delivered = result?.deliveryRef !== "OUT_OF_STOCK" && !result?.skipped;
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
        !result?.skipped
            ? ["notifyOrderChannel", notifyOrderChannel({ telegram, order, product, user })]
            : null,
        !result?.skipped
            ? ["notifyAdmins", notifyAdmins({ telegram, order, product })]
            : null,
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
        // product.price là giá NIÊM YẾT của sản phẩm. Với hàng giá cố định thì đúng,
        // nhưng sản phẩm ẩn "API Key" (giá tính theo token, lưu trên đơn) có
        // product.price = 0 → broadcast hiện "$0.00" dù khách trả tiền thật. Khi
        // product.price không dương thì lấy số tiền THẬT của đơn.
        const hasListPrice = Number(product.price) > 0;
        const usesOrderUsd = !hasListPrice && order.displayFinalUsd != null;
        broadcastNewOrder({ telegram }, {
            productName: product.name,
            productId: product.id,
            quantity: order.quantity,
            price: hasListPrice
                ? product.price
                : (order.displayFinalUsd ?? order.finalAmount ?? 0),
            currency: hasListPrice
                ? (product.currency || order.currency || "VND")
                : (usesOrderUsd ? (order.displayCurrency || "USD") : (order.currency || "VND")),
            buyerName: user?.username || user?.firstName || "",
            buyerTelegramId: order.odelegramId || order.telegramId || order.chatId,
            buyUrl: null,
            // Đơn API key: token / RPM / số ngày để tin broadcast hiện chi tiết.
            apikey: result?.apikey || null,
            // Đơn gia hạn: tin có tiêu đề + nút riêng, không phải "vừa mua đơn".
            renew: result?.renewed || null,
        }).catch((e) => console.error("[broadcastNewOrder]", e.message));
    }

    return result;
}

async function deliverContact({ prisma, telegram, order, product, chatId, lang = "vi" }) {
    const adminUsername = process.env.ADMIN_TELEGRAM || "admin";
    const orderId = formatOrderCode(order.id);
    const deliveryContent = `Liên hệ admin @${adminUsername} để nhận hàng. Mã đơn: ${orderId}`;

    // Persist nội dung để retry/manual resend dùng lại, nhưng giữ DELIVERING cho
    // tới khi ít nhất khách hoặc một admin thật sự nhận được thông báo.
    await prisma.order.update({
        where: { id: order.id },
        data: { deliveryRef: "CONTACT", deliveryContent },
    });

    const adminIds = (process.env.ADMIN_IDS || "").split(",").map(id => id.trim()).filter(Boolean);
    const deliveries = [
        ...adminIds.map((adminId) => telegram.sendMessage(
            adminId,
            `${iconOf("ORDER_DELIVERY")} <b>Đơn CONTACT cần xử lý</b>\n\n`
            + `Mã đơn: <code>${escapeHtml(orderId)}</code>\n`
            + `Sản phẩm: ${escapeHtml(product.name)}\n`
            + `User: <code>${escapeHtml(String(order.odelegramId))}</code>\n`
            + `Số tiền: ${order.finalAmount.toLocaleString()}đ`,
            { parse_mode: "HTML" }
        )),
        telegram.sendMessage(
            chatId,
            `<b>Đặt hàng thành công</b>\n━━━━━━━━━━━━━━━━\nMã đơn: <code>${escapeHtml(orderId)}</code>\nSản phẩm: <b>${escapeHtml(product.name)}</b>\n${iconOf("ORDER_TIME")} Thời gian: <b>${escapeHtml(vnDeliveryTime())}</b>\n\nAdmin sẽ liên hệ bạn để giao hàng.\nVui lòng liên hệ: @${escapeHtml(adminUsername)}`,
            { parse_mode: "HTML" }
        ),
    ];
    const outcomes = await Promise.allSettled(deliveries);
    outcomes.forEach((outcome, index) => {
        if (outcome.status === "rejected") {
            console.error(`[deliverContact] notify target ${index} fail:`, outcome.reason?.message || outcome.reason);
        }
    });
    if (!outcomes.some((outcome) => outcome.status === "fulfilled")) {
        throw new Error("Không gửi được thông báo CONTACT cho khách hoặc admin");
    }

    await prisma.order.update({ where: { id: order.id }, data: { status: "DELIVERED" } });
    return { deliveryRef: "CONTACT" };
}

async function deliverStockLines({ prisma, telegram, order, product, chatId, lang = "vi" }) {
    const isPaidUpfront = isPaidUpfrontMethod(order.paymentMethod);
    const orderId = formatOrderCode(order.id);
    const copy = deliveryCopy(lang);

    // Partial or full out-of-stock: deliver what's available, refund the rest
    async function handlePartialOrOutOfStock(claimedItems, requested) {
        const delivered = claimedItems.length;
        const missing = requested - delivered;
        // Phân bổ theo tổng tiền sau giảm giá và dồn phần lẻ vào khoản hoàn để
        // không giữ thừa dù finalAmount không chia hết cho quantity.
        const deliveredCharge = Math.floor(order.finalAmount * delivered / requested);
        const refundAmount = Math.max(0, order.finalAmount - deliveredCharge);

        if (delivered === 0) {
            // Nothing to deliver — full refund + cancel
            if (isPaidUpfront && order.finalAmount > 0) {
                const refundResult = await refund(String(order.odelegramId || order.chatId), order.finalAmount, order.id, `Hoàn tiền hết hàng — đơn #${orderId}`);
                if (!refundResult?.success) throw new Error(refundResult?.error || "Refund failed");
            }
            await prisma.order.updateMany({
                where: { id: order.id, status: "DELIVERING" },
                data: { status: "CANCELED", deliveryRef: "OUT_OF_STOCK" },
            });
            await telegram.sendMessage(chatId,
                isPaidUpfront
                    ? `${iconOf("STATUS_ERROR")} <b>Hết hàng</b>\nĐơn <code>${orderId}</code> đã bị hủy.\n${iconOf("STATUS_SUCCESS")} Hoàn <b>${order.finalAmount.toLocaleString()}đ</b> vào ví.`
                    : `${iconOf("STATUS_ERROR")} <b>Hết hàng</b>\nĐơn <code>${orderId}</code> đã bị hủy.\nAdmin sẽ liên hệ hoàn tiền.`,
                { parse_mode: "HTML" }
            ).catch((error) => console.warn(`[deliver] order ${order.id} canceled/refunded but customer notification failed: ${error.message}`));
            return { deliveryRef: "OUT_OF_STOCK" };
        }

        // Partial delivery — send what we have + refund missing portion
        if (isPaidUpfront && refundAmount > 0) {
            const refundResult = await refund(String(order.odelegramId || order.chatId), refundAmount, order.id, `Hoàn tiền thiếu hàng ${missing}/${requested} — đơn #${orderId}`);
            if (!refundResult?.success) throw new Error(refundResult?.error || "Partial refund failed");
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

        const partialNote = isPaidUpfront && refundAmount > 0
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
        let reusedSpec = null;
        try {
            const d = JSON.parse(persisted.deliveryContent);
            reusedSpec = {
                tokens: Number(d.quotaTokens) || 0, rpm: Number(d.rpm) || 0, validDays: Number(d.validDays) || 0,
                // Payload đơn cũ (trước khi tách nhiều server) không có field này →
                // broadcast tự bỏ dòng server, không hiện tên rỗng.
                server: d.profileName || "",
            };
        } catch { /* payload cũ/lỗi → bỏ qua phần spec cho broadcast */ }
        return { deliveryRef: "API_KEY", reused: true, apikey: reusedSpec };
    }

    // Đơn GIA HẠN: sửa key CŨ chứ không cấp key mới. Nhánh này phải nằm SAU cái
    // gate "đã giao rồi" ở trên — PATCH quota_limit là tuyệt đối (đọc-rồi-cộng)
    // nên chạy lại lần hai là cộng thêm lần nữa mà khách chỉ trả tiền một lần.
    const renewKeyId = order.apikeyRenewKeyId ?? persisted?.apikeyRenewKeyId ?? null;
    // Đơn gia hạn ĐÃ giao rồi → gửi lại biên nhận, tuyệt đối không PATCH lần nữa.
    if (renewKeyId && persisted?.deliveryRef === "API_KEY_RENEW") {
        let renewedSpec = null;
        if (persisted.deliveryContent) {
            try {
                const d = JSON.parse(persisted.deliveryContent);
                await telegram.sendMessage(chatId, renewReceiptText(d), { parse_mode: "HTML" }).catch(() => {});
                renewedSpec = {
                    addTokens: Number(d.addTokens) || 0, addDays: Number(d.addDays) || 0,
                    newTokens: Number(d.newTokens) || 0, server: d.profileName || "",
                };
            } catch { /* payload lỗi → thôi, đơn vẫn đã giao */ }
        }
        await prisma.order.update({ where: { id: order.id }, data: { status: "DELIVERED" } }).catch(() => {});
        return { deliveryRef: "API_KEY_RENEW", reused: true, renewed: renewedSpec };
    }
    if (renewKeyId) {
        return deliverApiKeyRenewal({ prisma, telegram, order, chatId, lang, renewKeyId, persisted, orderId });
    }

    const quotaTokens = Number(order.apikeyTokens ?? persisted?.apikeyTokens ?? 0);
    if (!(quotaTokens > 0)) {
        await prisma.order.update({ where: { id: order.id }, data: { status: "PAID" } }).catch(() => {});
        await notifyApiKeyFailure(telegram, chatId, order, orderId, "Đơn thiếu số token (apikeyTokens)");
        throw new Error(`API_KEY order ${order.id} missing apikeyTokens`);
    }

    // "Server" khách chọn ở bước 0. bot.js ghi apikeyProfile cho MỌI đơn mua (kể
    // cả shop một server), nên nhánh cuối chỉ chạm tới đơn tạo TRƯỚC khi có tính
    // năng nhiều server mà vẫn còn trong hạn giao lại 7 ngày — đó cũng là toàn bộ
    // phạm vi của GPT2API_PROFILE_PURCHASE. Lựa chọn của khách luôn thắng: đơn đã
    // trừ tiền theo giá server nào thì phải giao bằng server đó.
    const profileId = order.apikeyProfile
        ?? persisted?.apikeyProfile
        ?? await getSourceProfileId(KEY_SOURCES.PURCHASE).catch(() => null);
    // cfg phải là cấu hình của ĐÚNG profile đó: giá, RPM mặc định, models và cả
    // endpoint đi kèm tin giao key đều có thể khác nhau giữa các server.
    const cfg = await getProfileConfig(profileId).catch(() => ({}));
    const rpm = Number(order.apikeyRpm ?? persisted?.apikeyRpm ?? cfg.rpm ?? 0);
    // Khách chọn số ngày ở bước 3. 0 = KHÔNG hết hạn theo thời gian → buildCreateKeyBody
    // bỏ hẳn expires_in_days. Chỉ lùi về cfg.validDays khi đơn không mang field
    // (đơn cũ tạo trước khi có bước chọn ngày).
    const orderValidDays = order.apikeyValidDays ?? persisted?.apikeyValidDays;
    const validDays = orderValidDays === undefined || orderValidDays === null
        ? Number(cfg.validDays ?? 0)
        : Number(orderValidDays);

    const createClaim = await prisma.order.updateMany({
        where: { id: order.id, status: "DELIVERING", deliveryRef: { in: [null, ""] } },
        data: { deliveryRef: API_KEY_CREATE_WIP_REF },
    });
    if (!createClaim.count) {
        const reason = `apikey_create_ambiguous:${persisted?.deliveryRef || "wip_exists"}`;
        await prisma.order.update({
            where: { id: order.id },
            data: {
                status: "PAID",
                deliveryRetryBlockedAt: new Date(),
                deliveryError: reason.slice(0, 500),
            },
        }).catch(() => {});
        await notifyApiKeyFailure(
            telegram,
            chatId,
            order,
            orderId,
            "Đơn tạo key đã có cờ WIP; cần kiểm tra provider trước khi chạy lại để tránh cấp hai key",
        ).catch(() => {});
        return { deliveryRef: API_KEY_CREATE_WIP_REF, skipped: true, blocked: true };
    }

    const created = await createApiKey({
        quotaTokens,
        name: `order-${orderId}`,
        rpm: rpm > 0 ? rpm : undefined,
        validDays: validDays > 0 ? validDays : 0,
        profileId,
        // Đơn NÀY đã trừ tiền rồi. Admin tắt server sau đó chỉ có nghĩa "ngừng
        // bán", không phải "huỷ đơn đã bán" — không có cờ này thì nhánh lỗi bên
        // dưới hoàn tiền + huỷ đơn của khách đã trả tiền (kể cả lượt retry của
        // delivery-recovery, chạy tới 7 ngày sau).
        allowDisabledProfile: true,
    });

    if (!created.ok || !created.key) {
        const code = created.code || "unknown";
        // Truyền CẢ result, không chỉ code: providerMutationPossible:false nghĩa là
        // request tạo key chưa rời process nên hoàn tiền là an toàn tuyệt đối.
        const safeToRefund = isSafeApiKeyCreateFailure(created);
        const paid = isPaidUpfrontMethod(order.paymentMethod);

        if (!safeToRefund) {
            // Timeout/5xx/no-key-response có thể xảy ra sau khi provider đã tạo key.
            // Giữ WIP + chặn recovery để không cấp key thứ hai hoặc hoàn tiền nhầm.
            const reason = `apikey_create_ambiguous:${code}`;
            await prisma.order.update({
                where: { id: order.id },
                data: {
                    status: "PAID",
                    deliveryRetryBlockedAt: new Date(),
                    deliveryError: reason.slice(0, 500),
                },
            }).catch(() => {});
            await notifyApiKeyFailure(
                telegram,
                chatId,
                order,
                orderId,
                `Provider trả kết quả không chắc chắn (${code}); cần soát tay trước khi cấp lại/hoàn tiền`,
            ).catch(() => {});
            return { deliveryRef: API_KEY_CREATE_WIP_REF, skipped: true, blocked: true };
        }

        if (paid && order.finalAmount > 0) {
            const refundResult = await refund(
                String(order.odelegramId || order.chatId),
                order.finalAmount,
                order.id,
                `Hoàn tiền: tạo API key thất bại — đơn #${orderId}`,
            );
            if (!refundResult?.success) {
                await prisma.order.update({
                    where: { id: order.id },
                    data: {
                        status: "PAID",
                        deliveryRetryBlockedAt: new Date(),
                        deliveryError: `apikey_create_refund_failed:${refundResult?.error || code}`.slice(0, 500),
                    },
                }).catch(() => {});
                throw new Error(`API_KEY refund failed order ${order.id}: ${refundResult?.error || code}`);
            }
            await prisma.order.update({
                where: { id: order.id },
                data: {
                    status: "CANCELED",
                    deliveryRef: null,
                    cancelReason: `apikey_fail:${code}`,
                },
            });
            await telegram.sendMessage(
                chatId,
                `${iconOf("STATUS_WARNING")} <b>Không tạo được API key</b>\n━━━━━━━━━━━━━━━━\n`
                + `Mã đơn: <code>${escapeHtml(orderId)}</code>\n`
                + `Nhà cung cấp không cấp được key.\n\n`
                + `${iconOf("STATUS_SUCCESS")} Đã hoàn <b>${(order.finalAmount || 0).toLocaleString("vi-VN")}đ</b> vào ví của bạn.`,
                { parse_mode: "HTML" },
            ).catch(() => {});
        } else {
            await prisma.order.update({
                where: { id: order.id },
                data: { status: "PAID", deliveryRef: null, deliveryError: `apikey_create_fail:${code}`.slice(0, 500) },
            }).catch(() => {});
            await notifyApiKeyFailure(telegram, chatId, order, orderId, created.message || code);
        }
        throw new Error(`API_KEY create fail order ${order.id}: ${code} ${created.message || ""}`);
    }

    // Key đã tồn tại bên provider — chốt payload/order trước, rồi đồng bộ kho key local.
    // expiresAt: provider trả về thì tin nó; không thì suy ra từ số ngày khách chọn
    // (validDays = 0 → null = không hết hạn), để /mykey hiện đúng ngày hết hạn.
    const expiresRaw = created.expiresAt
        || (validDays > 0 ? new Date(Date.now() + validDays * 86_400_000) : null);
    const expiresAt = expiresRaw ? new Date(expiresRaw) : null;
    const expiresIso = expiresAt && !Number.isNaN(expiresAt.getTime()) ? expiresAt.toISOString() : null;

    const payload = JSON.stringify({
        key: created.key,
        quotaTokens,
        rpm,
        validDays,
        expiresAt: expiresIso,
        models: cfg.models || [],
        profileName: created.profileName || cfg.profileName || "",
        endpoint: cfg.endpoint || "",
        usageUrl: cfg.usageUrl || "",
        docUrl: cfg.docUrl || "",
        priceUsd: order.displayFinalUsd ?? null,
    });

    // Provider đã tạo key: đóng order trước để mọi retry chỉ gửi lại payload,
    // tuyệt đối không gọi create lần hai dù bước đồng bộ IssuedApiKey bị lỗi.
    await prisma.order.update({
        where: { id: order.id },
        data: {
            status: "DELIVERED",
            deliveryRef: "API_KEY",
            deliveryContent: payload,
            deliveryRetryBlockedAt: null,
            deliveryError: null,
        },
    });

    let storeSyncError = null;
    try {
        await saveIssuedKey({
            telegramId: String(order.odelegramId || order.chatId),
            key: created.key,
            quotaTokens,
            rpm,
            source: KeySource.PURCHASE,
            orderId: order.id,
            priceUsd: order.displayFinalUsd ?? null,
            externalId: created.id,
            expiresAt: expiresIso,
            models: cfg.models || [],
            profileId: created.profileId ?? cfg.profileId ?? null,
            profileName: created.profileName || cfg.profileName || "",
        });
    } catch (error) {
        storeSyncError = error;
        console.error(`[deliverApiKey] provider đã tạo key nhưng saveIssuedKey lỗi order ${order.id}:`, error.message);
        sendLog(
            "ERROR",
            `Tạo key thành công bên provider nhưng chưa lưu IssuedApiKey\nĐơn: ${order.id}\nLỗi: ${error.message}`,
        );
        await prisma.order.update({
            where: { id: order.id },
            data: {
                deliveryRetryBlockedAt: new Date(),
                deliveryError: `apikey_store_sync_failed:${error.message}`.slice(0, 500),
            },
        }).catch(() => {});
    }

    // Key đã tạo ở provider và payload đã chốt trên Order — quyền sở hữu key đã sang tay
    // khách bất kể tin xác nhận có gửi được hay không. KHÔNG rethrow ở đây: nếu để lỗi
    // gửi tin bay lên, caller (bot.js APIKEY_PAY) coi đây là giao hàng thất bại và TỰ
    // ĐỘNG HOÀN TIỀN — khách vừa được hoàn vừa giữ key dùng được, shop mất trắng giá trị
    // key. Gửi tin lỗi thì chỉ báo admin liên hệ gửi lại thủ công.
    try {
        await sendApiKeyDelivery(telegram, chatId, payload, lang);
    } catch (sendErr) {
        console.error(`[deliverApiKey] gửi tin xác nhận thất bại (key đã cấp) — order ${order.id}:`, sendErr.message);
        await notifyApiKeyFailure(telegram, chatId, order, orderId, `Key đã tạo nhưng gửi tin thất bại: ${sendErr.message}`).catch(() => {});
    }
    // Trả spec để broadcast "ĐƠN HÀNG MỚI" hiện token / RPM / số ngày / server.
    return {
        deliveryRef: "API_KEY",
        apikey: {
            tokens: quotaTokens, rpm, validDays,
            server: created.profileName || cfg.profileName || "",
        },
    };
}

/** Biên nhận gia hạn. Tách ra để lần gửi đầu và lượt gửi lại dùng chung một text. */
function renewReceiptText({ key, addTokens, addDays, newTokens, expiresAt }) {
    const expText = expiresAt ? new Date(expiresAt).toLocaleDateString("vi-VN") : "không hết hạn";
    return `${iconOf("STATUS_SUCCESS")} <b>Đã gia hạn key</b>\n${"━".repeat(16)}\n`
        + `<code>${escapeHtml(key)}</code>\n\n`
        + (addTokens > 0 ? `${iconOf("APIKEY_QUOTA")} Nạp thêm: <b>+${formatTokens(addTokens)} token</b>\n` : "")
        + (addDays > 0 ? `${iconOf("APIKEY_DAYS")} Gia hạn thêm: <b>+${addDays} ngày</b>\n` : "")
        + `${iconOf("APIKEY_QUOTA")} Quota hiện tại: <b>${formatTokens(newTokens)} token</b>\n`
        + `${iconOf("APIKEY_EXPIRES")} Hết hạn: <b>${expText}</b>\n\n`
        + `<i>Key giữ nguyên — bạn không phải sửa gì trong ứng dụng.</i>`;
}

/**
 * Giao đơn GIA HẠN: PATCH key cũ thay vì tạo key mới.
 *
 * Thất bại → hoàn tiền + huỷ đơn y như đơn mua mới (refund keyed theo order.id
 * nên idempotent). Thành công → cập nhật lại IssuedApiKey để /mykey hiện số mới
 * và job nhắc hạn thôi coi key này là sắp hết.
 *
 * CHỈ ĐƯỢC CHẠY MỘT LẦN MỖI ĐƠN. `quota_limit` bên xpiki là số TUYỆT ĐỐI, ta
 * đọc-rồi-cộng, nên chạy lại lần hai là cộng thêm một lần token nữa mà khách chỉ
 * trả tiền một lần. Hai lớp chặn:
 *   1. `deliveryRef = "API_KEY_RENEW"` + status DELIVERED ghi NGAY sau khi gia hạn
 *      xong → recovery không quét lại (nó chỉ lấy đơn PAID), và gate đầu
 *      `deliverApiKey` gửi lại biên nhận thay vì gọi provider.
 *   2. Cờ WIP claim atomic TRƯỚC khi gọi provider. Nếu process chết trước hoặc
 *      sau PATCH mà chưa kịp chốt kết quả, lượt sau chặn retry + đánh dấu cần
 *      admin đối chiếu; không được tự suy diễn WIP là DELIVERED.
 */
async function deliverApiKeyRenewal({ prisma, telegram, order, chatId, lang, renewKeyId, persisted, orderId }) {
    const addTokens = Math.max(0, Math.floor(Number(order.apikeyAddTokens ?? persisted?.apikeyAddTokens ?? 0)));
    const addDays = Math.max(0, Math.floor(Number(order.apikeyAddDays ?? persisted?.apikeyAddDays ?? 0)));

    // Giữ chỗ trước khi đụng tới provider. updateMany có điều kiện = atomic trong
    // Mongo: chỉ lượt đầu tiên thấy deliveryRef rỗng mới đi tiếp.
    // Lỗi DB lúc claim phải nổi lên để outer gate trả DELIVERING về PAID. Nuốt lỗi
    // thành count=0 sẽ biến sự cố DB thành một ca "đã gọi provider" giả.
    const claim = await prisma.order.updateMany({
        where: { id: order.id, deliveryRef: { in: [null, ""] } },
        data: { deliveryRef: RENEW_WIP_REF },
    });
    if (!claim?.count) {
        // WIP chỉ chứng minh lượt trước ĐÃ BẮT ĐẦU xử lý, không chứng minh PATCH đã
        // tới provider. Có thể process chết ngay sau lúc ghi WIP nhưng TRƯỚC request.
        // Vì vậy tuyệt đối không được đóng DELIVERED giả. Cũng không tự retry/hoàn
        // tiền vì trường hợp ngược lại (PATCH đã tới nhưng chưa kịp lưu DB) sẽ cộng
        // quota lần hai hoặc khiến khách vừa giữ quota vừa nhận lại tiền.
        const reason = "apikey_renew_ambiguous:wip_exists";
        await prisma.order.update({
            where: { id: order.id },
            data: {
                status: "PAID",
                deliveryRetryBlockedAt: new Date(),
                deliveryError: reason,
            },
        }).catch(() => {});
        await notifyApiKeyFailure(
            telegram, chatId, order, orderId,
            "Đơn gia hạn có cờ WIP — chưa thể biết PATCH đã tới provider hay chưa; cần soát tay, KHÔNG tự chạy lại",
        ).catch(() => {});
        return { deliveryRef: RENEW_WIP_REF, skipped: true, blocked: true };
    }

    const row = await prisma.issuedApiKey.findUnique({ where: { id: String(renewKeyId) } }).catch(() => null);

    const fail = async (reason) => {
        // Chỉ hoàn tiền khi CHẮC CHẮN chưa đụng gì tới key bên provider. Các mã
        // phát sinh SAU khi PATCH đã gửi đi (quota_not_applied / expiry_not_applied
        // / mất mạng giữa chừng) có thể đã cộng một phần — hoàn tiền ở đó là khách
        // vừa giữ token vừa được trả lại tiền. Những ca đó giữ nguyên tiền, chặn
        // retry và đẩy cho admin soát tay.
        const refundable = isSafeRefundRenewCode(reason);
        // Cùng danh sách với đường mua key: gia hạn hiện chỉ trừ ví, nhưng gác bằng
        // đúng một chuỗi "wallet" thì ngày thêm QR/USDT cho gia hạn sẽ âm thầm bỏ
        // qua bước hoàn tiền — lỗi kiểu đó không ai phát hiện cho tới khi khách kêu.
        if (refundable && isPaidUpfrontMethod(order.paymentMethod) && order.finalAmount > 0) {
            const refundResult = await refund(
                String(order.odelegramId || order.chatId), order.finalAmount, order.id,
                `Hoàn tiền: gia hạn API key thất bại — đơn #${orderId}`,
            );
            if (!refundResult?.success) {
                const refundError = refundResult?.error || "unknown";
                await prisma.order.update({
                    where: { id: order.id },
                    data: {
                        status: "PAID",
                        deliveryRetryBlockedAt: new Date(),
                        deliveryError: `apikey_renew_refund_failed:${refundError}`.slice(0, 500),
                    },
                }).catch(() => {});
                await notifyApiKeyFailure(
                    telegram,
                    chatId,
                    order,
                    orderId,
                    `Lỗi đã xác định trước khi PATCH nhưng hoàn ví thất bại: ${refundError}`,
                ).catch(() => {});
                throw new Error(`API_KEY renew refund failed order ${order.id}: ${refundError}`);
            }
            await prisma.order.update({
                where: { id: order.id },
                data: {
                    status: "CANCELED",
                    deliveryRef: null,
                    deliveryRetryBlockedAt: null,
                    deliveryError: null,
                    cancelReason: `apikey_renew_fail:${reason}`,
                },
            });
            await telegram.sendMessage(
                chatId,
                `${iconOf("STATUS_WARNING")} <b>Không gia hạn được key</b>\n${"━".repeat(16)}\n`
                + `Mã đơn: <code>${escapeHtml(orderId)}</code>\n`
                + `Nhà cung cấp tạm thời không nhận lệnh gia hạn.\n\n`
                + `${iconOf("STATUS_SUCCESS")} Đã hoàn <b>${(order.finalAmount || 0).toLocaleString("vi-VN")}đ</b> vào ví của bạn.`,
                { parse_mode: "HTML" },
            ).catch(() => {});
        } else {
            // Không hoàn tự động → cũng đừng để recovery quay lại PATCH lần nữa.
            await prisma.order.update({
                where: { id: order.id },
                data: {
                    status: "PAID",
                    deliveryRetryBlockedAt: new Date(),
                    deliveryError: `apikey_renew_fail:${reason}`.slice(0, 500),
                },
            }).catch(() => {});
            await notifyApiKeyFailure(telegram, chatId, order, orderId, `Gia hạn lỗi: ${reason}`).catch(() => {});
        }
        throw new Error(`API_KEY renew fail order ${order.id}: ${reason}`);
    };

    if (!row || !row.externalId) return fail("key_not_found");

    const res = await renewApiKey({
        externalId: row.externalId, addTokens, addDays, profileId: row.profileId ?? null,
    });
    if (!res.ok) return fail(res.code || "unknown");

    const cfg = await getProfileConfig(row.profileId ?? null).catch(() => ({}));
    const newTokens = toDisplayTokens(res.after.quotaLimit, cfg.quotaRefPrice ?? 0);
    let storeSyncError = null;
    try {
        await prisma.issuedApiKey.update({
            where: { id: row.id },
            data: {
                quotaTokens: newTokens > 0 ? newTokens : row.quotaTokens,
                expiresAt: res.after.expiresAt ? new Date(res.after.expiresAt) : row.expiresAt,
                renewCount: (Number(row.renewCount) || 0) + 1,
                lastRenewAt: new Date(),
                // Key vừa khoẻ lại → mở lại chuỗi nhắc, để lần sau sắp hết vẫn được báo.
                notifyStage: 0,
                notifyAt: null,
            },
        });
    } catch (e) {
        // Provider đã đổi key nên KHÔNG được ném lỗi để recovery PATCH lần nữa.
        // Vẫn đóng đơn với biên nhận thật, nhưng lưu cờ reconciliation rõ ràng để
        // admin biết dữ liệu IssuedApiKey (quota/expiry/notifyStage) đang có thể cũ.
        storeSyncError = e;
        console.error(`[renewApiKey] provider đã gia hạn nhưng đồng bộ IssuedApiKey lỗi order ${order.id}:`, e.message);
        sendLog(
            "ERROR",
            `Gia hạn key đã thành công bên provider nhưng DB chưa đồng bộ\nĐơn: ${order.id}\nKey: ${row.id}\nLỗi: ${e.message}`,
        );
    }

    // Số liệu provider vừa đổi → ném bản cache đi. Không có dòng này thì khách
    // bấm "API key của tôi" ngay sau khi trả tiền vẫn thấy key gạch ngang, "đã
    // dùng 100%", nhãn "đã hết" (cache sống 60s) — đọc y như gia hạn thất bại,
    // và nếu họ đang lọc "Còn dùng" thì key biến mất hẳn khỏi danh sách.
    invalidateKeyStatusCache();

    // ĐÓNG ĐƠN NGAY sau khi provider đã nhận, TRƯỚC khi gửi tin. Gửi tin lỗi thì
    // chỉ mất cái biên nhận; để đơn còn PAID/DELIVERING thì recovery sẽ gia hạn lại.
    const payload = JSON.stringify({
        key: row.key, addTokens, addDays, newTokens,
        expiresAt: res.after.expiresAt || null,
        profileName: res.profileName || cfg.profileName || "",
        priceUsd: order.displayFinalUsd ?? null,
    });
    await prisma.order.update({
        where: { id: order.id },
        data: {
            status: "DELIVERED",
            deliveryRef: "API_KEY_RENEW",
            deliveryContent: payload,
            // DELIVERED là đúng vì provider đã áp dụng. Hai field này chỉ đánh dấu
            // phần dữ liệu local cần reconcile, không cho recovery gọi provider lại.
            deliveryRetryBlockedAt: storeSyncError ? new Date() : null,
            deliveryError: storeSyncError
                ? `apikey_renew_store_sync_failed:${storeSyncError.message}`.slice(0, 500)
                : null,
        },
    });

    await telegram.sendMessage(
        chatId,
        renewReceiptText({ key: row.key, addTokens, addDays, newTokens, expiresAt: res.after.expiresAt }),
        { parse_mode: "HTML" },
    ).catch((e) => console.error(`[renewApiKey] báo khách lỗi (đã gia hạn xong) order ${order.id}:`, e.message));

    return {
        deliveryRef: "API_KEY_RENEW",
        // Cho broadcast "VỪA GIA HẠN KEY" — khách cũ quay lại nạp thêm là bằng
        // chứng xã hội mạnh hơn hẳn một đơn mua mới.
        renewed: {
            addTokens, addDays, newTokens,
            server: res.profileName || cfg.profileName || "",
        },
    };
}

async function sendApiKeyDelivery(telegram, chatId, payload, lang = "vi") {
    let d = {};
    try { d = JSON.parse(payload); } catch { /* payload cũ/lỗi → vẫn gửi phần đọc được */ }

    const text = apiKeyMessage({
        key: d.key || "",
        quotaTokens: d.quotaTokens || 0,
        rpm: d.rpm || 0,
        expiresAt: d.expiresAt || null,
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
        await prisma.order.update({ where: { id: order.id }, data: { status: "DELIVERED" } });
        return { deliveryRef: "TEXT" };
    }

    await telegram.sendMessage(chatId, fullMsg, { parse_mode: "HTML", ...(kb ? { reply_markup: kb } : {}) });
    await prisma.order.update({ where: { id: order.id }, data: { status: "DELIVERED" } });

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
        await prisma.order.update({ where: { id: order.id }, data: { status: "DELIVERED", deliveryRetryBlockedAt: null, deliveryError: null } });
        return { deliveryRef: "API_CALL", reused: true };
    }
    if (persistedOrder?.deliveryRef === API_CALL_WIP_REF) {
        await prisma.order.update({
            where: { id: order.id },
            data: {
                status: "PAID",
                deliveryRetryBlockedAt: new Date(),
                deliveryError: "api_call_ambiguous:wip_exists",
            },
        }).catch(() => {});
        return { deliveryRef: API_CALL_WIP_REF, skipped: true, blocked: true };
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
                        const refundable = isPaidUpfrontMethod(order.paymentMethod) && order.finalAmount > 0;
                        if (refundable) {
                            const refundResult = await refund(
                                String(order.odelegramId || order.chatId),
                                order.finalAmount,
                                order.id,
                                `Hoàn tiền hết hàng — đơn #${orderId}`,
                            );
                            if (!refundResult?.success) throw new Error(refundResult?.error || "Refund failed");
                        }
                        await prisma.order.update({ where: { id: order.id }, data: { status: "CANCELED", deliveryRef: "OUT_OF_STOCK" } });
                        await telegram.sendMessage(chatId,
                            `${iconOf("OUT_OF_STOCK_SAD")} <b>Hết hàng</b>\n\nSản phẩm <b>${escapeHtml(product.name)}</b> hiện đã hết hàng tại nhà cung cấp.\n\n` +
                            (refundable
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
        const providerClaim = await prisma.order.updateMany({
            where: { id: order.id, status: "DELIVERING", deliveryRef: { in: [null, ""] } },
            data: { deliveryRef: API_CALL_WIP_REF },
        });
        if (!providerClaim.count) {
            await prisma.order.update({
                where: { id: order.id },
                data: { status: "PAID", deliveryRetryBlockedAt: new Date(), deliveryError: "api_call_ambiguous:wip_claim_failed" },
            }).catch(() => {});
            return { deliveryRef: API_CALL_WIP_REF, skipped: true, blocked: true };
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
        const fresh = await prisma.order.findUnique({ where: { id: order.id } }).catch(() => null);
        if (fresh?.deliveryRef === "API_CALL" && fresh.deliveryContent) {
            // Provider + local payload đã chốt; chỉ còn gửi Telegram lỗi. Mở retry
            // bình thường vì nhánh persisted ở đầu sẽ không POST provider lần nữa.
            await prisma.order.update({
                where: { id: order.id },
                data: { status: "PAID", deliveryRetryBlockedAt: null, deliveryError: `api_call_send_failed:${e.message}`.slice(0, 500) },
            }).catch(() => {});
        } else if (fresh?.deliveryRef === API_CALL_WIP_REF) {
            // Request có thể đã tới provider nhưng chưa lưu response. Không tự POST
            // lần hai; chặn recovery và yêu cầu admin đối soát.
            await prisma.order.update({
                where: { id: order.id },
                data: { status: "PAID", deliveryRetryBlockedAt: new Date(), deliveryError: `api_call_ambiguous:${e.message}`.slice(0, 500) },
            }).catch(() => {});
            sendLog("ERROR", `API_CALL chưa rõ kết quả provider\nĐơn: ${order.id}\nLỗi: ${e.message}`);
        } else {
            await prisma.order.update({ where: { id: order.id }, data: { status: "PAID" } }).catch(() => {});
        }
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

/**
 * Gửi lại nội dung đã lưu mà không claim kho/gọi provider lần nữa.
 * Throw khi không có kênh gửi nào thành công để API admin không báo thành công giả.
 */
export async function resendStoredOrderDelivery({ telegram, order, product = null, lang = "vi" } = {}) {
    if (!telegram) throw new Error("Telegram client chưa sẵn sàng");
    if (!order) throw new Error("Thiếu order");
    const chatId = Number(order.chatId || order.odelegramId);
    if (!Number.isFinite(chatId) || !chatId) throw new Error("Chat ID không hợp lệ");
    const ref = String(order.deliveryRef || "");
    const payload = String(order.deliveryContent || "");
    const tg = wrapTelegramWithRetry(telegram);

    if (ref === "API_KEY") {
        if (!payload) throw new Error("Đơn API key không có deliveryContent");
        await sendApiKeyDelivery(tg, chatId, payload, lang);
        return { sent: true, mode: "API_KEY" };
    }

    if (ref === "API_KEY_RENEW") {
        if (!payload) throw new Error("Đơn gia hạn không có deliveryContent");
        const parsed = JSON.parse(payload);
        await tg.sendMessage(chatId, renewReceiptText(parsed), { parse_mode: "HTML" });
        return { sent: true, mode: "API_KEY_RENEW" };
    }

    if (ref.startsWith("FILE:") || ref.startsWith("FILE_TEXT_FALLBACK:")) {
        const filePath = product?.payload || ref.slice(ref.indexOf(":") + 1);
        if (!filePath) throw new Error("Đơn FILE thiếu đường dẫn");
        const absolutePath = path.resolve(filePath);
        const buffer = await fs.readFile(absolutePath);
        await tg.sendDocument(chatId, { source: buffer, filename: path.basename(absolutePath) }, {
            caption: `Gửi lại đơn ${formatOrderCode(order.id)}`,
        });
        return { sent: true, mode: "FILE" };
    }

    if (ref === "CONTACT") {
        if (!payload) throw new Error("Đơn CONTACT thiếu nội dung");
        await tg.sendMessage(chatId, payload);
        return { sent: true, mode: "CONTACT" };
    }

    if (!payload) throw new Error("Đơn chưa có nội dung giao để gửi lại");
    const filename = `ORD${formatOrderCode(order.id)}_RESEND.txt`;
    try {
        await tg.sendDocument(
            chatId,
            { source: Buffer.from(payload, "utf-8"), filename },
            { caption: `Gửi lại đơn ${formatOrderCode(order.id)}` },
        );
        return { sent: true, mode: ref || "STORED", channel: "document" };
    } catch (documentError) {
        const chunks = splitPlainText(payload);
        try {
            for (const chunk of chunks) await tg.sendMessage(chatId, chunk);
            return { sent: true, mode: ref || "STORED", channel: "message" };
        } catch (messageError) {
            throw new AggregateError([documentError, messageError], "Không gửi lại được nội dung đơn hàng");
        }
    }
}
// getStockCount đã được export từ ./inventory.js — import từ đó để tránh duplicate.
