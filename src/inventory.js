import { prisma } from "./db.js";

/**
 * Inventory Manager Module
 * Handles stock alerts and auto-disable
 */

const ADMIN_IDS = (process.env.ADMIN_IDS || "").split(",").map(id => id.trim()).filter(Boolean);

/**
 * Check stock levels and send alerts
 * @param {Telegraf} bot - Bot instance
 * @param {string} productId - Product ID to check
 */
export async function checkStock(bot, productId) {
    const product = await prisma.product.findUnique({ where: { id: productId } });
    if (!product || product.deliveryMode !== "STOCK_LINES") return;

    const stockCount = await prisma.stockItem.count({
        where: { productId, isSold: false },
    });

    // Auto-disable if stock is 0 (autoHideWhenEmpty flag OR legacy autoDisableAt===0)
    if (stockCount === 0 && (product.autoHideWhenEmpty || product.autoDisableAt === 0) && product.isActive) {
        await prisma.product.update({
            where: { id: productId },
            data: { isActive: false },
        });

        // Notify all admins in parallel
        await Promise.allSettled(
            ADMIN_IDS.map(id => bot.telegram.sendMessage(
                id,
                `🚨 *Hết hàng!*\n\n📦 ${product.name} đã được tự động tắt.`,
                { parse_mode: "Markdown" }
            ))
        );
        return;
    }

    // Low stock alert
    if (stockCount > 0 && stockCount <= product.stockAlertAt) {
        await Promise.allSettled(
            ADMIN_IDS.map(id => bot.telegram.sendMessage(
                id,
                `⚠️ *Cảnh báo tồn kho thấp*\n\n📦 ${product.name}: còn ${stockCount} sản phẩm`,
                { parse_mode: "Markdown" }
            ))
        );
    }
}

/**
 * Get stock count for a product
 */
export async function getStockCount(productId) {
    return await prisma.stockItem.count({
        where: { productId, isSold: false },
    });
}

/**
 * Check all products stock levels
 */
export async function checkAllStock(bot) {
    const products = await prisma.product.findMany({
        where: { deliveryMode: "STOCK_LINES", isActive: true },
    });

    // Run alerts in parallel — Promise.allSettled to keep going if some fail
    await Promise.allSettled(products.map((p) => checkStock(bot, p.id)));
}

export async function autoEnableOnStock(productId) {
    const product = await prisma.product.findUnique({ where: { id: productId } });
    if (!product || product.isActive) return;
    if (!product.autoHideWhenEmpty && product.autoDisableAt !== 0) return;

    const stockCount = await prisma.stockItem.count({ where: { productId, isSold: false } });
    if (stockCount > 0) {
        await prisma.product.update({ where: { id: productId }, data: { isActive: true } });
    }
}

export default { checkStock, getStockCount, checkAllStock, autoEnableOnStock };
