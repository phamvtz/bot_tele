import fs from "fs/promises";
import path from "path";
import { checkStock } from "./inventory.js";
import { processReferralCommission } from "./referral.js";

/**
 * Delivery Service v2
 * Handles product delivery with inventory management and referral processing
 */

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

    // Process referral commission
    if (order.userId) {
        await processReferralCommission(order.userId, order.id, order.finalAmount);
    }

    // Check stock levels and send alerts (need to create a bot-like object for checkStock)
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
        try {
            await telegram.sendMessage(
                chatId,
                `❌ Hết hàng! Chỉ còn ${items.length}/${order.quantity}.\nAdmin sẽ liên hệ hoàn tiền.`
            );
        } catch (e) {
            console.error("Could not notify user of out of stock:", e.message);
        }

        await prisma.order.update({
            where: { id: order.id },
            data: { status: "CANCELED", deliveryRef: "OUT_OF_STOCK" },
        });

        return { deliveryRef: "OUT_OF_STOCK" };
    }

    // Build file content with header
    const orderId = order.id.slice(-13);
    let fileContent = `========================================\n`;
    fileContent += `           ĐƠN HÀNG #${orderId}\n`;
    fileContent += `========================================\n\n`;
    fileContent += `📦 Sản phẩm: ${product.name}\n`;
    fileContent += `📊 Số lượng: ${order.quantity}\n`;
    fileContent += `📅 Ngày: ${new Date().toLocaleString("vi-VN")}\n\n`;

    // Add product description/notes if available
    if (product.description) {
        fileContent += `========================================\n`;
        fileContent += `           📝 LƯU Ý QUAN TRỌNG\n`;
        fileContent += `========================================\n\n`;
        fileContent += `${product.description}\n\n`;
    }

    fileContent += `========================================\n`;
    fileContent += `           🎁 DANH SÁCH TÀI KHOẢN\n`;
    fileContent += `========================================\n\n`;

    // Add stock items
    items.forEach((item, i) => {
        fileContent += `TÀI KHOẢN #${i + 1}:\n${item.content}\n\n`;
    });

    fileContent += `========================================\n`;
    fileContent += `⚠️ LƯU Ý BẢO MẬT:\n`;
    fileContent += `- Đổi mật khẩu ngay sau khi nhận\n`;
    fileContent += `- Không chia sẻ thông tin này\n`;
    fileContent += `- Liên hệ admin nếu có vấn đề\n`;
    fileContent += `========================================\n`;

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
                deliveryRef: `STOCK:${items.map((x) => x.id).join(",")}`,
                deliveryContent: fileContent
            },
        });
    });

    // Send as file
    const filename = `ORD${orderId}_DELIVERY.txt`;
    try {
        await telegram.sendDocument(
            chatId,
            { source: Buffer.from(fileContent, 'utf-8'), filename },
            {
                caption:
                    `✅ *GIAO HÀNG THÀNH CÔNG!*\n\n` +
                    `🛍️ Đơn hàng: \`${orderId}\`\n` +
                    `📦 ${product.name} x${order.quantity}\n\n` +
                    `📬 Cảm ơn bạn đã mua hàng!\n` +
                    `Vui lòng nhận file bên dưới 👇\n\n` +
                    `⚠️ _Lưu ý: Hãy đổi mật khẩu ngay sau khi nhận!_`,
                parse_mode: "Markdown"
            }
        );
    } catch (e) {
        console.error("Could not send stock rules to user:", e.message);
    }

    return { deliveryRef: `STOCK:${items.map((x) => x.id).join(",")}` };
}

async function deliverText({ prisma, telegram, order, product, chatId }) {
    let text;
    try {
        const parsed = JSON.parse(product.payload || "{}");
        text = parsed.text || product.payload;
    } catch {
        text = product.payload || "✅ Đã thanh toán thành công!";
    }

    await prisma.order.update({
        where: { id: order.id },
        data: {
            status: "DELIVERED",
            deliveryRef: "TEXT",
            deliveryContent: text
        },
    });

    const orderId = order.id.slice(-13);
    try {
        await telegram.sendMessage(
            chatId,
            `✅ *GIAO HÀNG THÀNH CÔNG!*\n\n` +
            `🛍️ Đơn hàng: \`${orderId}\`\n` +
            `📦 Sản phẩm: ${product.name}\n\n` +
            `📬 *NỘI DUNG:*\n` +
            `\`\`\`\n${text}\n\`\`\`\n\n` +
            `Cảm ơn bạn đã mua hàng! 🎉`,
            { parse_mode: "Markdown" }
        );
    } catch (e) {
        console.error("Could not send text to user:", e.message);
    }

    return { deliveryRef: "TEXT" };
}

async function deliverFile({ prisma, telegram, order, product, chatId }) {
    const filePath = product.payload;
    if (!filePath) throw new Error("FILE mode requires payload");

    const absolutePath = path.resolve(filePath);
    await fs.access(absolutePath);

    const buffer = await fs.readFile(absolutePath);
    const filename = path.basename(absolutePath);

    const orderId = order.id.slice(-13);
    try {
        await telegram.sendDocument(
            chatId,
            { source: buffer, filename },
            {
                caption:
                    `✅ *GIAO HÀNG THÀNH CÔNG!*\n\n` +
                    `🛍️ Đơn hàng: \`${orderId}\`\n` +
                    `📦 ${product.name} x${order.quantity}\n\n` +
                    `📬 Cảm ơn bạn đã mua hàng!\n` +
                    `Vui lòng nhận file bên dưới 👇`,
                parse_mode: "Markdown"
            }
        );
    } catch (e) {
        console.error("Could not send file to user:", e.message);
    }

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
