import fs from "fs/promises";
import path from "path";
import { checkStock, invalidateStockCache } from "./inventory.js";
import { processReferralCommission } from "./referral.js";

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
        default:
            throw new Error(`Unknown delivery mode: ${product.deliveryMode}`);
    }

    // Run post-delivery tasks in parallel — neither blocks the other
    const user = order.userId ? await prisma.user.findUnique({ where: { id: order.userId } }).catch(() => null) : null;
    await Promise.allSettled([
        order.userId ? processReferralCommission(order.userId, order.id, order.finalAmount) : null,
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
    const items = await prisma.stockItem.findMany({
        where: { productId: product.id, isSold: false },
        take: order.quantity,
        orderBy: { createdAt: "asc" },
    });

    if (items.length < order.quantity) {
        await telegram.sendMessage(
            chatId,
            `Hết hàng. Hiện chỉ còn ${items.length}/${order.quantity} sản phẩm.\nAdmin sẽ liên hệ xử lý hoặc hoàn tiền.`
        );

        await prisma.order.update({
            where: { id: order.id },
            data: { status: "CANCELED", deliveryRef: "OUT_OF_STOCK" },
        });

        return { deliveryRef: "OUT_OF_STOCK" };
    }

    const orderId = order.id.slice(-13).toUpperCase();
    let fileContent = "";
    fileContent += "========================================\n";
    fileContent += `           ĐƠN HÀNG #${orderId}\n`;
    fileContent += "========================================\n\n";
    fileContent += `Sản phẩm: ${product.name}\n`;
    fileContent += `Số lượng: ${order.quantity}\n`;
    fileContent += `Ngày: ${new Date().toLocaleString("vi-VN")}\n\n`;

    // Mô tả sản phẩm (description) — admin nhập riêng cho từng sản phẩm.
    // Sản phẩm nào có ghi chú riêng (đổi pass / không đổi pass...) thì admin
    // nhập trong description, hiển thị y nguyên trong file giao hàng.
    if (product.description) {
        fileContent += "========================================\n";
        fileContent += "           MÔ TẢ SẢN PHẨM\n";
        fileContent += "========================================\n\n";
        fileContent += `${product.description}\n\n`;
    }

    fileContent += "========================================\n";
    fileContent += "           DANH SÁCH TÀI KHOẢN\n";
    fileContent += "========================================\n\n";

    items.forEach((item, index) => {
        fileContent += `TÀI KHOẢN #${index + 1}:\n${item.content}\n\n`;
    });

    await prisma.$transaction(async (tx) => {
        for (const item of items) {
            await tx.stockItem.update({
                where: { id: item.id },
                data: { isSold: true, soldAt: new Date(), orderId: order.id },
            });
        }
        await tx.order.update({
            where: { id: order.id },
            data: {
                status: "DELIVERED",
                deliveryRef: `STOCK:${items.map((item) => item.id).join(",")}`,
                deliveryContent: fileContent,
            },
        });
    });
    invalidateStockCache(product.id);

    const filename = `ORD${orderId}_DELIVERY.txt`;
    const kb = channelButton();

    // Send product description as a separate message first (no caption limit issues)
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

    // Send the delivery file
    await telegram.sendDocument(
        chatId,
        { source: Buffer.from(fileContent, "utf-8"), filename },
        {
            caption: product.description
                ? `📦 File tài khoản của bạn — Mã đơn: <code>${orderId}</code>`
                : `<b>Giao hàng thành công</b>\n━━━━━━━━━━━━━━━━\n` +
                  `Mã đơn: <code>${orderId}</code>\n` +
                  `Sản phẩm: <b>${escapeHtml(product.name)}</b> x${order.quantity}`,
            parse_mode: "HTML",
            ...(kb ? { reply_markup: kb } : {}),
        }
    );

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

// getStockCount đã được export từ ./inventory.js — import từ đó để tránh duplicate.
