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
    const now = new Date();

    // Prefer reserved items for this order
    const reservedItems = await prisma.stockItem.findMany({
        where: { productId: product.id, isSold: false, reservedOrderId: order.id },
        orderBy: { createdAt: "asc" },
    });

    let items = [...reservedItems];

    if (items.length < order.quantity) {
        const need = order.quantity - items.length;
        const extras = await prisma.stockItem.findMany({
            where: {
                productId: product.id,
                isSold: false,
                OR: [
                    { isReserved: false },
                    { reservedUntil: null },
                    { reservedUntil: { lt: now } },
                ],
            },
            take: need,
            orderBy: { createdAt: "asc" },
        });
        items = items.concat(extras);
    }

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
            data: { status: "FAILED", deliveryRef: "OUT_OF_STOCK" },
        });

        return { deliveryRef: "OUT_OF_STOCK" };
    }

    // Build file content with header
    const orderId = order.id.slice(-8).toUpperCase();
    let fileContent = `================================================\n`;
    fileContent += `          BIÊN LAI GIAO HÀNG / INVOICE          \n`;
    fileContent += `================================================\n\n`;
    fileContent += `🆔 Mã Đơn Hàng:  ${orderId}\n`;
    fileContent += `📦 Sản Phẩm:     ${product.name}\n`;
    fileContent += `📊 Số Lượng:     ${order.quantity}\n`;
    fileContent += `💰 Tổng Thanh Toán: ${order.finalAmount.toLocaleString()} VNĐ\n`;
    fileContent += `📅 Ngày Mua:     ${new Date().toLocaleString("vi-VN")}\n\n`;

    // Add product description/notes if available
    if (product.description) {
        fileContent += `------------------------------------------------\n`;
        fileContent += `📝 LƯU Ý / HƯỚNG DẪN SỬ DỤNG:\n`;
        fileContent += `------------------------------------------------\n`;
        fileContent += `${product.description}\n\n`;
    }

    fileContent += `------------------------------------------------\n`;
    fileContent += `🎁 DANH SÁCH DỮ LIỆU ĐÃ MUA:\n`;
    fileContent += `------------------------------------------------\n\n`;

    // Add stock items
    items.forEach((item, i) => {
        fileContent += `👉 Dòng #${i + 1}:\n${item.content}\n\n`;
    });

    fileContent += `------------------------------------------------\n`;
    fileContent += `⚠️ CHÍNH SÁCH BẢO HÀNH & BẢO MẬT:\n`;
    fileContent += `- Vui lòng đổi mật khẩu (nếu có) ngay sau khi nhận.\n`;
    fileContent += `- Không chia sẻ nội dung này cho bên thứ ba.\n`;
    fileContent += `- Liên hệ Admin ngay nếu có lỗi trong vòng 24h.\n`;
    fileContent += `\nCảm ơn bạn đã tin tưởng và sử dụng dịch vụ!\n`;
    fileContent += `================================================\n`;

    await prisma.$transaction(async (tx) => {
        for (const item of items) {
            await tx.stockItem.update({
                where: { id: item.id },
                data: {
                    isSold: true,
                    isReserved: false,
                    reservedUntil: null,
                    reservedOrderId: null,
                    soldAt: new Date(),
                    orderId: order.id,
                },
            });
        }
        await tx.order.update({
            where: { id: order.id },
            data: {
                status: "DELIVERED",
                deliveryRef: `STOCK:${items.map((x) => x.id).join(",")}`,
                deliveryContent: fileContent,
                deliveredAt: new Date(),
                completedAt: new Date(),
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
            deliveryContent: text,
            deliveredAt: new Date(),
            completedAt: new Date(),
        },
    });

    const orderId = order.id.slice(-8).toUpperCase();
    try {
        await telegram.sendMessage(
            chatId,
            `🎉 *GIAO HÀNG THÀNH CÔNG* 🎉\n` +
            `━━━━━━━━━━━━━━━━━━━━━━\n\n` +
            `🆔 Mã đơn: \`${orderId}\`\n` +
            `📦 Sản phẩm: *${product.name}*\n\n` +
            `📬 *NỘI DUNG SẢN PHẨM:*\n` +
            `\`\`\`\n${text}\n\`\`\`\n\n` +
            `🙏 Cảm ơn bạn đã tin tưởng dịch vụ!\n` +
            `💎 Chúc bạn một ngày tốt lành.`,
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

    const orderId = order.id.slice(-8).toUpperCase();
    try {
        await telegram.sendDocument(
            chatId,
            { source: buffer, filename },
            {
                caption:
                    `🎉 *GIAO HÀNG THÀNH CÔNG* 🎉\n` +
                    `━━━━━━━━━━━━━━━━━━━━━━\n\n` +
                    `🆔 Mã đơn: \`${orderId}\`\n` +
                    `📦 Sản phẩm: *${product.name}*\n\n` +
                    `📬 Vui lòng nhận file đính kèm bên dưới 👇\n\n` +
                    `💎 Cảm ơn bạn rất nhiều!`,
                parse_mode: "Markdown"
            }
        );
    } catch (e) {
        console.error("Could not send file to user:", e.message);
    }

    await prisma.order.update({
        where: { id: order.id },
        data: {
            status: "DELIVERED",
            deliveryRef: `FILE:${filePath}`,
            deliveredAt: new Date(),
            completedAt: new Date(),
        },
    });

    return { deliveryRef: `FILE:${filePath}` };
}

export async function getStockCount(productId) {
    const { prisma } = await import("./db.js");
    return await prisma.stockItem.count({ where: { productId, isSold: false } });
}
