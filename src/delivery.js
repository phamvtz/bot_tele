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
        await telegram.sendMessage(
            chatId,
            `❌ Hết hàng! Chỉ còn ${items.length}/${order.quantity}.\nAdmin sẽ liên hệ hoàn tiền.`
        );

        await prisma.order.update({
            where: { id: order.id },
            data: { status: "CANCELED", deliveryRef: "OUT_OF_STOCK" },
        });

        return { deliveryRef: "OUT_OF_STOCK" };
    }

    const content = items.map((item, i) => `${i + 1}) ${item.content}`).join("\n");

    await prisma.$transaction(async (tx) => {
        for (const item of items) {
            await tx.stockItem.update({
                where: { id: item.id },
                data: { isSold: true, soldAt: new Date(), orderId: order.id },
            });
        }
        await tx.order.update({
            where: { id: order.id },
            data: { status: "DELIVERED", deliveryRef: `STOCK:${items.map((x) => x.id).join(",")}` },
        });
    });

    await telegram.sendMessage(
        chatId,
        `✅ *Đơn #${order.id.slice(-8)} đã giao!*\n\n` +
        `📦 ${product.name} x${order.quantity}\n\n` +
        `\`\`\`\n${content}\n\`\`\`\n\n` +
        `⚠️ _Vui lòng đổi mật khẩu ngay!_`,
        { parse_mode: "Markdown" }
    );

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
        data: { status: "DELIVERED", deliveryRef: "TEXT" },
    });

    await telegram.sendMessage(
        chatId,
        `✅ *Đơn #${order.id.slice(-8)} đã giao!*\n\n📦 ${product.name}\n\n${text}`,
        { parse_mode: "Markdown" }
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

    await telegram.sendDocument(
        chatId,
        { source: buffer, filename },
        { caption: `✅ *Đơn #${order.id.slice(-8)} đã giao!*\n\n📦 ${product.name}`, parse_mode: "Markdown" }
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
