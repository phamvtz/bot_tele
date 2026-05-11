import fs from "fs/promises";
import path from "path";
import { checkStock } from "./inventory.js";
import { processReferralCommission } from "./referral.js";

function escapeHtml(value = "") {
    return String(value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

export async function deliverOrder({ prisma, telegram, order }) {
    const product = await prisma.product.findUnique({ where: { id: order.productId } });
    if (!product) throw new Error("Product not found");

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
        default:
            throw new Error(`Unknown delivery mode: ${product.deliveryMode}`);
    }

    if (order.userId) {
        await processReferralCommission(order.userId, order.id, order.finalAmount);
    }

    if (product.deliveryMode === "STOCK_LINES") {
        await checkStock({ telegram }, product.id);
    }

    return result;
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

    if (product.description) {
        fileContent += "========================================\n";
        fileContent += "           LƯU Ý QUAN TRỌNG\n";
        fileContent += "========================================\n\n";
        fileContent += `${product.description}\n\n`;
    }

    fileContent += "========================================\n";
    fileContent += "           DANH SÁCH TÀI KHOẢN\n";
    fileContent += "========================================\n\n";

    items.forEach((item, index) => {
        fileContent += `TÀI KHOẢN #${index + 1}:\n${item.content}\n\n`;
    });

    fileContent += "========================================\n";
    fileContent += "LƯU Ý BẢO MẬT:\n";
    fileContent += "- Đổi mật khẩu ngay sau khi nhận.\n";
    fileContent += "- Không chia sẻ thông tin này.\n";
    fileContent += "- Liên hệ admin nếu có vấn đề.\n";
    fileContent += "========================================\n";

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

    const filename = `ORD${orderId}_DELIVERY.txt`;
    await telegram.sendDocument(
        chatId,
        { source: Buffer.from(fileContent, "utf-8"), filename },
        {
            caption:
                `<b>Giao hàng thành công</b>\n━━━━━━━━━━━━━━━━\n` +
                `Mã đơn: <code>${orderId}</code>\n` +
                `Sản phẩm: <b>${escapeHtml(product.name)}</b> x${order.quantity}\n\n` +
                `File giao hàng nằm bên dưới. Hãy đổi mật khẩu ngay sau khi nhận.`,
            parse_mode: "HTML",
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
    await telegram.sendMessage(
        chatId,
        `<b>Giao hàng thành công</b>
━━━━━━━━━━━━━━━━
Mã đơn: <code>${orderId}</code>
Sản phẩm: <b>${escapeHtml(product.name)}</b>

<b>Nội dung sản phẩm</b>
<code>${escapeHtml(text)}</code>

Cảm ơn bạn đã mua hàng.`,
        { parse_mode: "HTML" }
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
    await telegram.sendDocument(
        chatId,
        { source: buffer, filename },
        {
            caption:
                `<b>Giao hàng thành công</b>\n━━━━━━━━━━━━━━━━\n` +
                `Mã đơn: <code>${orderId}</code>\n` +
                `Sản phẩm: <b>${escapeHtml(product.name)}</b> x${order.quantity}\n\n` +
                `File giao hàng nằm bên dưới.`,
            parse_mode: "HTML",
        }
    );

    await prisma.order.update({
        where: { id: order.id },
        data: { status: "DELIVERED", deliveryRef: `FILE:${filePath}` },
    });

    return { deliveryRef: `FILE:${filePath}` };
}

export async function getStockCount(productId) {
    const { prisma } = await import("./db.js");
    return await prisma.stockItem.count({ where: { productId, isSold: false } });
}
