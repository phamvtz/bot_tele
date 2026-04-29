import cron from 'node-cron';
import prisma from '../infrastructure/db.js';
import { OrderService } from '../modules/order/OrderService.js';
import { NotificationService } from '../modules/notification/NotificationService.js';
import { createLogger } from '../infrastructure/logger.js';
const log = createLogger('OrderExpiryJob');
export function startOrderExpiryJob() {
    // Chạy mỗi 1 phút
    cron.schedule('* * * * *', async () => {
        try {
            const expiredOrders = await prisma.order.findMany({
                where: {
                    status: 'PENDING_PAYMENT',
                    reservedUntil: { lt: new Date() }
                },
                include: { user: { select: { telegramId: true } } },
            });
            if (expiredOrders.length === 0)
                return;
            log.info({ count: expiredOrders.length }, 'Found expired orders, canceling...');
            for (const order of expiredOrders) {
                try {
                    await OrderService.cancelOrder(order.id, 'SYSTEM_AUTO_EXPIRED');
                    // Thông báo cho user
                    if (order.user?.telegramId) {
                        await NotificationService.sendToUser(order.user.telegramId, `⏰ Đơn hàng \`${order.orderCode}\` đã *hết hạn thanh toán* và bị hủy tự động.\n\nVui lòng tạo đơn mới nếu bạn vẫn muốn mua.`);
                    }
                    log.info({ orderId: order.id }, 'Order expired and canceled');
                }
                catch (err) {
                    log.error({ err, orderId: order.id }, 'Failed to cancel expired order');
                }
            }
        }
        catch (err) {
            log.error({ err }, 'OrderExpiryJob: fatal error');
        }
    });
    log.info('Order Expiry Job started (every 1 minute)');
}
