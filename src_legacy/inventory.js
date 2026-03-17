import { prisma } from "./db.js";

/**
 * Inventory Manager Module
 * Handles stock alerts and auto-disable
 */

const ADMIN_IDS = (process.env.ADMIN_IDS || "").split(",").map(id => id.trim()).filter(Boolean);

const availableFilter = (productId, now = new Date()) => ({
    productId,
    isSold: false,
    OR: [
        { isReserved: false },
        { reservedUntil: null },
        { reservedUntil: { lt: now } }
    ],
});

/**
 * Check stock levels and send alerts
 * @param {Telegraf} bot - Bot instance
 * @param {string} productId - Product ID to check
 */
export async function checkStock(bot, productId) {
    const product = await prisma.product.findUnique({ where: { id: productId } });
    if (!product || product.deliveryMode !== "STOCK_LINES") return;

    const stockCount = await prisma.stockItem.count({
        where: availableFilter(productId),
    });

    // Auto-disable if stock is 0
    if (stockCount === 0 && product.autoDisableAt === 0 && product.isActive) {
        await prisma.product.update({
            where: { id: productId },
            data: { isActive: false },
        });

        // Notify admins
        for (const adminId of ADMIN_IDS) {
            try {
                await bot.telegram.sendMessage(
                    adminId,
                    `🚨 *Hết hàng!*\n\n📦 ${product.name} đã được tự động tắt.`,
                    { parse_mode: "Markdown" }
                );
            } catch (e) {
                console.error("Failed to notify admin:", e);
            }
        }
        return;
    }

    // Low stock alert
    if (stockCount > 0 && stockCount <= product.stockAlertAt) {
        for (const adminId of ADMIN_IDS) {
            try {
                await bot.telegram.sendMessage(
                    adminId,
                    `⚠️ *Cảnh báo tồn kho thấp*\n\n📦 ${product.name}: còn ${stockCount} sản phẩm`,
                    { parse_mode: "Markdown" }
                );
            } catch (e) {
                console.error("Failed to notify admin:", e);
            }
        }
    }
}

/**
 * Get stock count for a product
 */
export async function getStockCount(productId) {
    return await prisma.stockItem.count({
        where: availableFilter(productId),
    });
}

/**
 * Check all products stock levels
 */
export async function checkAllStock(bot) {
    const products = await prisma.product.findMany({
        where: { deliveryMode: "STOCK_LINES", isActive: true },
    });

    for (const product of products) {
        await checkStock(bot, product.id);
    }
}

/**
 * Reserve stock items for an order with expiry
 * Returns { ok, reserved, available, expireAt }
 */
export async function reserveStock(productId, quantity, orderId, expireMinutes = 10) {
    const now = new Date();
    const expireAt = new Date(now.getTime() + expireMinutes * 60 * 1000);

    // Keep existing reservations for this order
    const existing = await prisma.stockItem.findMany({
        where: { productId, reservedOrderId: orderId, isSold: false },
    });

    if (existing.length >= quantity) {
        return { ok: true, reserved: existing.length, expireAt };
    }

    const needed = quantity - existing.length;

    const candidates = await prisma.stockItem.findMany({
        where: availableFilter(productId, now),
        orderBy: { createdAt: "asc" },
        take: needed,
    });

    if (candidates.length < needed) {
        return { ok: false, reserved: existing.length + candidates.length, available: existing.length + candidates.length };
    }

    await prisma.$transaction(
        candidates.map((item) =>
            prisma.stockItem.update({
                where: { id: item.id },
                data: {
                    isReserved: true,
                    reservedUntil: expireAt,
                    reservedOrderId: orderId,
                },
            })
        )
    );

    return { ok: true, reserved: quantity, expireAt };
}

/**
 * Release all reserved (but unsold) stock for an order
 */
export async function releaseReservedStock(orderId) {
    await prisma.stockItem.updateMany({
        where: { reservedOrderId: orderId, isSold: false },
        data: {
            isReserved: false,
            reservedUntil: null,
            reservedOrderId: null,
        },
    });
}

/**
 * Release reservations that are expired globally
 */
export async function releaseExpiredReservations() {
    const now = new Date();
    await prisma.stockItem.updateMany({
        where: {
            isReserved: true,
            reservedUntil: { lt: now },
            isSold: false,
        },
        data: {
            isReserved: false,
            reservedUntil: null,
            reservedOrderId: null,
        },
    });
}

export default {
    checkStock,
    getStockCount,
    checkAllStock,
    reserveStock,
    releaseReservedStock,
    releaseExpiredReservations
};
