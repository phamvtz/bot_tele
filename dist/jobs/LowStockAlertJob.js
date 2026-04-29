import cron from 'node-cron';
import prisma from '../infrastructure/db.js';
import { NotificationService } from '../modules/notification/NotificationService.js';
import { createLogger } from '../infrastructure/logger.js';
const log = createLogger('LowStockAlertJob');
export function startLowStockAlertJob() {
    const threshold = parseInt(process.env.LOW_STOCK_THRESHOLD ?? '5', 10);
    const adminIds = (process.env.ADMIN_IDS ?? '').split(',').map(id => id.trim()).filter(Boolean);
    // Chạy mỗi giờ
    cron.schedule('0 * * * *', async () => {
        try {
            const lowStockProducts = await prisma.product.findMany({
                where: {
                    isActive: true,
                    stockMode: 'TRACKED',
                    stockCount: { lt: threshold, gt: 0 }
                },
                select: { id: true, name: true, stockCount: true, thumbnailEmoji: true }
            });
            const outOfStock = await prisma.product.findMany({
                where: {
                    isActive: true,
                    stockMode: 'TRACKED',
                    stockCount: 0
                },
                select: { name: true }
            });
            if (lowStockProducts.length === 0 && outOfStock.length === 0)
                return;
            let alert = `⚠️ *CẢNH BÁO TỒN KHO*\n${'━'.repeat(24)}\n`;
            if (outOfStock.length > 0) {
                alert += `\n❌ *Hết hàng (${outOfStock.length} sản phẩm):*\n`;
                outOfStock.forEach(p => { alert += `• ${p.name}\n`; });
            }
            if (lowStockProducts.length > 0) {
                alert += `\n⚠️ *Tồn kho thấp (< ${threshold}):*\n`;
                lowStockProducts.forEach(p => {
                    alert += `• ${p.thumbnailEmoji ?? '📦'} ${p.name}: *${p.stockCount}* còn lại\n`;
                });
            }
            // Gửi cho tất cả admin
            for (const adminId of adminIds) {
                await NotificationService.sendToUser(adminId, alert);
            }
            log.warn({ lowCount: lowStockProducts.length, outCount: outOfStock.length }, 'Low stock alert sent');
        }
        catch (err) {
            log.error({ err }, 'LowStockAlertJob: error');
        }
    });
    log.info('Low Stock Alert Job started (every hour)');
}
