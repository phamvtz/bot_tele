import fs from "fs/promises";
import path from "path";
import { request as httpsReq } from "node:https";
import { request as httpReq } from "node:http";
import { checkStock, invalidateStockCache } from "./inventory.js";

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

const ADMIN_IDS = (process.env.ADMIN_IDS || "").split(",").map((id) => id.trim()).filter(Boolean);

async function notifyAdmins({ telegram, order, product }) {
    if (!ADMIN_IDS.length) return;
    const orderId = order.id.slice(-8).toUpperCase();
    const msg = `🛒 *ĐƠN HÀNG MỚI*\n`
        + `📦 ${product.name} x${order.quantity}\n`
        + `👤 User: \`${order.odelegramId}\`\n`
        + `💰 ${(order.finalAmount ?? 0).toLocaleString()}đ\n`
        + `🆔 \`${orderId}\``;
    for (const adminId of ADMIN_IDS) {
        try {
            await telegram.sendMessage(adminId, msg, { parse_mode: "Markdown" });
        } catch {}
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

async function notifyOrderChannel({ telegram, order, product, user }) {
    const channelId = process.env.ORDER_NOTIFY_CHANNEL;
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
    } catch {}
}

function channelButton() {
    const url = process.env.SUPPORT_CHANNEL_URL;
    if (!url) return null;
    return { inline_keyboard: [[{ text: "📢 Vào Channel Khách Hàng", url }]] };
}

export async function deliverOrder({ prisma, telegram, order }) {
    // Allow telegram=null (e.g. API purchases) — wrap to silently skip message sends
    if (!telegram) {
        telegram = { sendMessage: () => Promise.resolve(), sendDocument: () => Promise.resolve(), sendPhoto: () => Promise.resolve() };
    }
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

    let result;
    switch (product.deliveryMode) {
        case "STOCK_LINES":
            result = await deliverStockLines({ prisma, telegram, order, product, chatId });
            break;
        case "TEXT":
            result = await deliverText({ prisma, telegram, order, product, chatId });
            break;
        case "FILE":
            result = await deliverFile({ prisma, telegram, order, product, chatId });
            break;
        case "CONTACT":
            result = await deliverContact({ prisma, telegram, order, product, chatId });
            break;
        case "API_CALL":
            result = await deliverApiCall({ prisma, telegram, order, product, chatId });
            break;
        default:
            throw new Error(`Unknown delivery mode: ${product.deliveryMode}`);
    }

    // Run post-delivery tasks in parallel — neither blocks the other
    // OUT_OF_STOCK means order was canceled — skip referral/VIP for those
    const delivered = result?.deliveryRef !== "OUT_OF_STOCK";
    const user = order.userId ? await prisma.user.findUnique({ where: { id: order.userId } }).catch(() => null) : null;
    await Promise.allSettled([
        order.userId && delivered ? processReferralCommission(order.userId, order.id, order.finalAmount) : null,
        order.userId && delivered ? addSpending(order.userId, order.finalAmount) : null,
        product.deliveryMode === "STOCK_LINES" ? checkStock({ telegram }, product.id) : null,
        notifyOrderChannel({ telegram, order, product, user }),
        notifyAdmins({ telegram, order, product }),
    ].filter(Boolean));

    return result;
}

async function deliverContact({ prisma, telegram, order, product, chatId }) {
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
                `📬 *Đơn CONTACT cần xử lý*\n\n` +
                `Mã đơn: \`${orderId}\`\n` +
                `Sản phẩm: ${product.name}\n` +
                `User: ${order.odelegramId}\n` +
                `Số tiền: ${order.finalAmount.toLocaleString()}đ`,
                { parse_mode: "Markdown" }
            );
        } catch {}
    }

    await telegram.sendMessage(
        chatId,
        `<b>Đặt hàng thành công</b>\n━━━━━━━━━━━━━━━━\nMã đơn: <code>${escapeHtml(orderId)}</code>\nSản phẩm: <b>${escapeHtml(product.name)}</b>\n\nAdmin sẽ liên hệ bạn để giao hàng.\nVui lòng liên hệ: @${escapeHtml(adminUsername)}`,
        { parse_mode: "HTML" }
    );

    return { deliveryRef: "CONTACT" };
}

async function deliverStockLines({ prisma, telegram, order, product, chatId }) {
    const isWallet = order.paymentMethod === "wallet";
    const orderId = order.id.slice(-13).toUpperCase();

    async function handleOutOfStock(available) {
        if (isWallet && order.finalAmount > 0) {
            try {
                await refund(String(order.odelegramId || order.chatId), order.finalAmount, order.id, `Hoàn tiền hết hàng — đơn #${orderId}`);
            } catch (e) {
                console.error("[OUT_OF_STOCK refund]", e);
            }
        }
        await telegram.sendMessage(
            chatId,
            isWallet
                ? `❌ <b>Hết hàng</b>\nHiện chỉ còn ${available}/${order.quantity} sản phẩm.\n✅ Đã hoàn <b>${order.finalAmount.toLocaleString()}đ</b> vào ví của bạn.`
                : `❌ <b>Hết hàng</b>\nHiện chỉ còn ${available}/${order.quantity} sản phẩm.\nAdmin sẽ liên hệ xử lý hoặc hoàn tiền.`,
            { parse_mode: "HTML" }
        );
        await prisma.order.update({ where: { id: order.id }, data: { status: "CANCELED", deliveryRef: "OUT_OF_STOCK" } });
        return { deliveryRef: "OUT_OF_STOCK" };
    }

    // Step 1: Find candidates (may be stale — race condition handled below)
    const candidates = await prisma.stockItem.findMany({
        where: { productId: product.id, isSold: false },
        take: order.quantity,
        orderBy: { createdAt: "asc" },
    });

    if (candidates.length < order.quantity) {
        return handleOutOfStock(candidates.length);
    }

    const candidateIds = candidates.map((c) => c.id);

    // Step 2: Atomic claim — only marks items that are STILL isSold: false
    // Prevents two concurrent deliveries from claiming the same stock item
    const claimed = await prisma.stockItem.updateMany({
        where: { id: { in: candidateIds }, isSold: false },
        data: { isSold: true, soldAt: new Date(), orderId: order.id },
    });

    if (claimed.count < order.quantity) {
        // Race condition: another concurrent delivery got some of our candidates first
        if (claimed.count > 0) {
            await prisma.stockItem.updateMany({
                where: { id: { in: candidateIds }, orderId: order.id },
                data: { isSold: false, soldAt: null, orderId: null },
            }).catch((e) => console.error("[stock rollback]", e));
        }
        return handleOutOfStock(claimed.count);
    }

    // Step 3: Fetch the claimed items in order (for delivery content)
    const items = await prisma.stockItem.findMany({
        where: { id: { in: candidateIds }, orderId: order.id },
        orderBy: { createdAt: "asc" },
    });
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

    await prisma.order.update({
        where: { id: order.id },
        data: {
            status: "DELIVERED",
            deliveryRef: `STOCK:${items.map((item) => item.id).join(",")}`,
            deliveryContent: fileContent,
        },
        /* Note: stock items already claimed atomically via updateMany above */
    });
    invalidateStockCache(product.id);

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

    // Build inline account text for direct display in chat
    let accountText = `📦 <b>${escapeHtml(product.name)}</b> × ${order.quantity}\n`;
    if (product.description) {
        accountText += `\n📋 ${escapeHtml(product.description)}\n`;
    }
    accountText += `\n`;
    items.forEach((item, index) => {
        accountText += `<b>#${index + 1}</b>\n<code>${escapeHtml(item.content)}</code>\n\n`;
    });
    accountText = accountText.trimEnd();
    // Telegram message limit 4096 chars
    if (accountText.length > 4000) accountText = accountText.slice(0, 4000) + "\n…";

    // Send both simultaneously
    await Promise.all([
        telegram.sendDocument(
            chatId,
            { source: Buffer.from(fileContent, "utf-8"), filename },
            { caption, parse_mode: "HTML", ...(kb ? { reply_markup: kb } : {}) }
        ),
        telegram.sendMessage(chatId, accountText, { parse_mode: "HTML" }),
    ]);

    return { deliveryRef: `STOCK:${items.map((item) => item.id).join(",")}` };
}

async function deliverText({ prisma, telegram, order, product, chatId }) {
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
    await telegram.sendMessage(
        chatId,
        `<b>Giao hàng thành công</b>\n━━━━━━━━━━━━━━━━\n` +
        `Mã đơn: <code>${orderId}</code>\n` +
        `Sản phẩm: <b>${escapeHtml(product.name)}</b>\n\n` +
        (product.description ? `${escapeHtml(product.description)}\n\n` : "") +
        `<b>Nội dung sản phẩm</b>\n<code>${escapeHtml(text)}</code>\n\n` +
        `Cảm ơn bạn đã mua hàng.`,
        { parse_mode: "HTML", ...(kb ? { reply_markup: kb } : {}) }
    );

    return { deliveryRef: "TEXT" };
}

async function deliverFile({ prisma, telegram, order, product, chatId }) {
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

    await prisma.order.update({
        where: { id: order.id },
        data: { status: "DELIVERED", deliveryRef: `FILE:${filePath}` },
    });

    return { deliveryRef: `FILE:${filePath}` };
}

async function deliverApiCall({ prisma, telegram, order, product, chatId }) {
    const orderId = order.id.slice(-13).toUpperCase();
    let config = {};
    try { config = JSON.parse(product.payload || "{}"); } catch {}
    const { baseUrl = "", purchaseEndpoint = "", apiKey = "", authMode = "bearer", customHeaders = "", providerProductId, listEndpoint = "", idField = "", stockField = "" } = config;

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

        const kb = channelButton();
        await telegram.sendMessage(
            chatId,
            `<b>Giao hàng thành công</b>\n━━━━━━━━━━━━━━━━\n` +
            `Mã đơn: <code>${orderId}</code>\n` +
            `Sản phẩm: <b>${escapeHtml(product.name)}</b>\n\n` +
            (product.description ? `📋 ${escapeHtml(product.description)}\n\n` : "") +
            `<b>Nội dung sản phẩm:</b>\n<code>${escapeHtml(String(content))}</code>\n\n` +
            `Cảm ơn bạn đã mua hàng.`,
            { parse_mode: "HTML", ...(kb ? { reply_markup: kb } : {}) }
        );
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
