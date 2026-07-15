import fs from "fs/promises";
import path from "path";
import { request as httpsReq } from "node:https";
import { request as httpReq } from "node:http";
import { checkStock, invalidateStockCache } from "./inventory.js";
import { broadcastNewOrder } from "./broadcast.js";

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
            rejectUnauthorized: false,
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
            rejectUnauthorized: false,
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
import { getOrderNotifyChannel, getSupportChannelUrlSync } from "./shop-config.js";

const ADMIN_IDS = (process.env.ADMIN_IDS || "").split(",").map((id) => id.trim()).filter(Boolean);

const DELIVERY_COPY = {
    vi: { delivery: "GIAO HÀNG", order: "Mã đơn", product: "Sản phẩm", description: "Mô tả", content: "Nội dung sản phẩm", thanks: "Cảm ơn bạn đã mua hàng.", uploadFallback: "Telegram không nhận file; nội dung đơn được gửi trực tiếp bên dưới" },
    en: { delivery: "DELIVERY", order: "Order", product: "Product", description: "Description", content: "Product content", thanks: "Thank you for your purchase.", uploadFallback: "Telegram could not receive the file; your order content is shown below" },
    zh: { delivery: "发货信息", order: "订单", product: "商品", description: "描述", content: "商品内容", thanks: "感谢您的购买。", uploadFallback: "Telegram 无法接收文件，订单内容已直接发送如下" },
};

function deliveryCopy(lang = "vi") {
    return DELIVERY_COPY[lang] || DELIVERY_COPY.vi;
}

async function notifyAdmins({ telegram, order, product }) {
    if (!ADMIN_IDS.length) return;
    const orderId = order.id.slice(-8).toUpperCase();
    const msg = `🛒 <b>ĐƠN HÀNG MỚI</b>\n`
        + `📦 ${escapeHtml(product.name)} x${order.quantity}\n`
        + `👤 User: <code>${escapeHtml(String(order.odelegramId))}</code>\n`
        + `💰 ${(order.finalAmount ?? 0).toLocaleString()}đ\n`
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

function buildAccountMessages({ productName, quantity, description, items, headerNote = "", lang = "vi" }) {
    const copy = deliveryCopy(lang);
    const header = `${copy.delivery}\n${copy.product}: ${productName} x ${quantity}${headerNote}`
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

async function notifyOrderChannel({ telegram, order, product, user }) {
    const channelId = await getOrderNotifyChannel();
    if (!channelId) return;
    const orderId = order.id.slice(-13).toUpperCase();
    const username = user?.username ? `@${user.username}` : `#${order.telegramId || order.chatId}`;
    const amount = (order.finalAmount ?? 0).toLocaleString("vi-VN");
    try {
        await telegram.sendMessage(
            channelId,
            `🔔 <b>ĐƠN ${escapeHtml(product.name)} (tự giao)</b>\n` +
            `👤 User: <code>${order.telegramId || order.chatId}</code>\n` +
            `🏷️ Tên: ${escapeHtml(username)}\n` +
            `📦 Số lượng: ${order.quantity}\n` +
            `💰 Tổng: ${amount} VND`,
            { parse_mode: "HTML" }
        );
    } catch (err) {
        console.error(`[notifyOrderChannel] fail to ${channelId}:`, err.message);
    }
}

function channelButton() {
    const url = getSupportChannelUrlSync();
    if (!url) return null;
    return { inline_keyboard: [[{ text: "📢 Vào Channel Khách Hàng", url }]] };
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

    const product = await prisma.product.findUnique({ where: { id: order.productId } });
    if (!product) {
        // Rollback nếu product biến mất
        await prisma.order.update({
            where: { id: order.id },
            data: { status: "PAID" },
        }).catch(() => {});
        throw new Error("Product not found");
    }

    const chatId = Number(order.chatId);
    const user = order.userId
        ? await prisma.user.findUnique({ where: { id: order.userId } }).catch(() => null)
        : null;
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
            default:
                throw new Error(`Unknown delivery mode: ${product.deliveryMode}`);
        }
    } catch (err) {
        // Revert DELIVERING → PAID so admin can retry
        await prisma.order.update({ where: { id: order.id }, data: { status: "PAID" } }).catch(() => {});
        console.error(`[deliver] failed order ${order.id}, reverted to PAID:`, err.message);
        throw err;
    }

    // Run post-delivery tasks in parallel — neither blocks the other
    // OUT_OF_STOCK means order was canceled — skip referral/VIP for those
    const delivered = result?.deliveryRef !== "OUT_OF_STOCK";
    await Promise.allSettled([
        order.userId && delivered ? processReferralCommission(order.userId, order.id, order.finalAmount) : null,
        order.userId && delivered ? addSpending(order.userId, order.finalAmount) : null,
        product.deliveryMode === "STOCK_LINES" ? checkStock({ telegram }, product.id) : null,
        notifyOrderChannel({ telegram, order, product, user }),
        notifyAdmins({ telegram, order, product }),
    ].filter(Boolean));

    // Thông báo "ĐƠN HÀNG MỚI" tới tất cả user — chạy nền, KHÔNG await để
    // không làm chậm luồng giao hàng cho người mua.
    if (delivered) {
        broadcastNewOrder({ telegram }, {
            productName: product.name,
            productId: product.id,
            quantity: order.quantity,
            price: product.price,
            currency: product.currency || order.currency || "VND",
            buyerName: user?.username || user?.firstName || "",
            buyerTelegramId: order.odelegramId || order.telegramId || order.chatId,
        }).catch((e) => console.error("[broadcastNewOrder]", e.message));
    }

    return result;
}

async function deliverContact({ prisma, telegram, order, product, chatId, lang = "vi" }) {
    const adminUsername = process.env.ADMIN_TELEGRAM || "admin";
    const orderId = order.id.slice(-13).toUpperCase();

    await prisma.order.update({
        where: { id: order.id },
        data: {
            status: "DELIVERED",
            deliveryRef: "CONTACT",
            deliveryContent: `Liên hệ admin @${adminUsername} để nhận hàng. Mã đơn: ${orderId}`,
        },
    });

    const adminIds = (process.env.ADMIN_IDS || "").split(",").map(id => id.trim()).filter(Boolean);
    for (const adminId of adminIds) {
        try {
            await telegram.sendMessage(
                adminId,
                `📬 <b>Đơn CONTACT cần xử lý</b>\n\n` +
                `Mã đơn: <code>${escapeHtml(orderId)}</code>\n` +
                `Sản phẩm: ${escapeHtml(product.name)}\n` +
                `User: <code>${escapeHtml(String(order.odelegramId))}</code>\n` +
                `Số tiền: ${order.finalAmount.toLocaleString()}đ`,
                { parse_mode: "HTML" }
            );
        } catch (err) {
            console.error(`[deliverContact] notify admin ${adminId} fail:`, err.message);
        }
    }

    await telegram.sendMessage(
        chatId,
        `<b>Đặt hàng thành công</b>\n━━━━━━━━━━━━━━━━\nMã đơn: <code>${escapeHtml(orderId)}</code>\nSản phẩm: <b>${escapeHtml(product.name)}</b>\n\nAdmin sẽ liên hệ bạn để giao hàng.\nVui lòng liên hệ: @${escapeHtml(adminUsername)}`,
        { parse_mode: "HTML" }
    );

    return { deliveryRef: "CONTACT" };
}

async function deliverStockLines({ prisma, telegram, order, product, chatId, lang = "vi" }) {
    const isWallet = order.paymentMethod === "wallet";
    const orderId = order.id.slice(-13).toUpperCase();

    // Partial or full out-of-stock: deliver what's available, refund the rest
    async function handlePartialOrOutOfStock(claimedItems, requested) {
        const delivered = claimedItems.length;
        const missing = requested - delivered;
        const unitPrice = Math.floor(order.finalAmount / requested);
        const refundAmount = missing * unitPrice;

        if (delivered === 0) {
            // Nothing to deliver — full refund + cancel
            if (isWallet && order.finalAmount > 0) {
                await refund(String(order.odelegramId || order.chatId), order.finalAmount, order.id, `Hoàn tiền hết hàng — đơn #${orderId}`).catch(console.error);
            }
            await telegram.sendMessage(chatId,
                isWallet
                    ? `❌ <b>Hết hàng</b>\nĐơn <code>${orderId}</code> đã bị hủy.\n✅ Hoàn <b>${order.finalAmount.toLocaleString()}đ</b> vào ví.`
                    : `❌ <b>Hết hàng</b>\nĐơn <code>${orderId}</code> đã bị hủy.\nAdmin sẽ liên hệ hoàn tiền.`,
                { parse_mode: "HTML" }
            );
            await prisma.order.update({ where: { id: order.id }, data: { status: "CANCELED", deliveryRef: "OUT_OF_STOCK" } });
            return { deliveryRef: "OUT_OF_STOCK" };
        }

        // Partial delivery — send what we have + refund missing portion
        if (isWallet && refundAmount > 0) {
            await refund(String(order.odelegramId || order.chatId), refundAmount, order.id, `Hoàn tiền thiếu hàng ${missing}/${requested} — đơn #${orderId}`).catch(console.error);
        }

        // Build and send partial delivery file
        const dateStr = new Date().toLocaleString("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
        let fileContent = `ĐƠN HÀNG: ${orderId}\n`;
        fileContent += `Sản phẩm: ${product.name} × ${delivered} (giao được ${delivered}/${requested})\n`;
        fileContent += `Ngày: ${dateStr}\n`;
        if (product.description) fileContent += `\n── Hướng dẫn ──\n${product.description}\n`;
        fileContent += `\n── Tài khoản ──\n`;
        claimedItems.forEach((item, i) => { fileContent += `#${i + 1}\n${item.content}\n\n`; });

        const partialNote = isWallet && refundAmount > 0
            ? `\n⚠️ Chỉ còn <b>${delivered}/${requested}</b> sản phẩm. Đã hoàn <b>${refundAmount.toLocaleString()}đ</b> vào ví.`
            : `\n⚠️ Chỉ giao được <b>${delivered}/${requested}</b> sản phẩm.`;

        let caption = `✅ <b>Giao hàng (một phần)</b>\n━━━━━━━━━━━━━━━━\nMã đơn: <code>${orderId}</code>\nSản phẩm: <b>${escapeHtml(product.name)}</b> × ${delivered}${partialNote}`;
        if (product.description) caption += `\n\n📋 ${escapeHtml(product.description.slice(0, 200))}`;
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
    const dateStr = new Date().toLocaleString("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
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

    let caption = `✅ <b>Giao hàng thành công</b>\n━━━━━━━━━━━━━━━━\n` +
        `Mã đơn: <code>${orderId}</code>\n` +
        `Sản phẩm: <b>${escapeHtml(product.name)}</b> × ${order.quantity}`;
    if (product.description) {
        const shortDesc = escapeHtml(product.description.slice(0, 300));
        caption += `\n\n📋 ${shortDesc}`;
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

    const orderId = order.id.slice(-13).toUpperCase();
    const kb = channelButton();

    const header = `<b>${copy.delivery}</b>\n━━━━━━━━━━━━━━━━\n` +
        `${copy.order}: <code>${orderId}</code>\n` +
        `${copy.product}: <b>${escapeHtml(product.name)}</b>\n\n` +
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

    const orderId = order.id.slice(-13).toUpperCase();
    const kb = channelButton();

    if (product.description) {
        await telegram.sendMessage(
            chatId,
            `<b>Giao hàng thành công</b>\n━━━━━━━━━━━━━━━━\n` +
            `Mã đơn: <code>${orderId}</code>\n` +
            `Sản phẩm: <b>${escapeHtml(product.name)}</b> x${order.quantity}\n\n` +
            `📋 <b>Mô tả:</b>\n${escapeHtml(product.description)}`,
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
                    ? `📦 File giao hàng — Mã đơn: <code>${orderId}</code>`
                    : `<b>Giao hàng thành công</b>\n━━━━━━━━━━━━━━━━\n` +
                      `Mã đơn: <code>${orderId}</code>\n` +
                      `Sản phẩm: <b>${escapeHtml(product.name)}</b> x${order.quantity}`,
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
    const orderId = order.id.slice(-13).toUpperCase();
    let config = {};
    try { config = JSON.parse(product.payload || "{}"); } catch {}
    const { baseUrl = "", purchaseEndpoint = "", apiKey = "", authMode = "bearer", customHeaders = "", providerProductId, listEndpoint = "", idField = "", stockField = "" } = config;

    const kb = channelButton();
    const apiHeader = `<b>${copy.delivery}</b>\n━━━━━━━━━━━━━━━━\n` +
        `${copy.order}: <code>${orderId}</code>\n` +
        `${copy.product}: <b>${escapeHtml(product.name)}</b>\n\n` +
        (product.description ? `📋 ${copy.description}: ${escapeHtml(product.description)}\n\n` : "");
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
                            `😔 <b>Hết hàng</b>\n\nSản phẩm <b>${escapeHtml(product.name)}</b> hiện đã hết hàng tại nhà cung cấp.\n\n` +
                            (order.paymentMethod === "wallet" && order.finalAmount > 0
                                ? `✅ Đã hoàn <b>${order.finalAmount.toLocaleString()}đ</b> vào ví của bạn.`
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
                ? `\n\n📩 Liên hệ admin để nhận hàng hoặc được hỗ trợ: <a href="https://t.me/${supportUsername.replace("@", "")}">@${supportUsername.replace("@", "")}</a>`
                : "\n\nVui lòng liên hệ admin để nhận hàng hoặc được hoàn tiền.";
            const kb = supportUsername
                ? { inline_keyboard: [[{ text: "💬 Liên hệ Admin", url: `https://t.me/${supportUsername.replace("@", "")}` }]] }
                : null;
            await telegram.sendMessage(
                chatId,
                `⚠️ <b>Đơn hàng #${orderId} chưa được giao tự động</b>\n\nMã đơn: <code>${orderId}</code>\nSản phẩm: <b>${escapeHtml(product.name)}</b>${contactLine}`,
                { parse_mode: "HTML", ...(kb ? { reply_markup: kb } : {}) }
            );
        } catch {}
        throw e;
    }
}

// getStockCount đã được export từ ./inventory.js — import từ đó để tránh duplicate.
