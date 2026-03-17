import cron from 'node-cron';
import prisma from '../infrastructure/db.js';
import { OrderService } from '../modules/order/OrderService.js';

export function startOrderExpiryJob() {
  // Chạy mỗi 1 phút
  cron.schedule('* * * * *', async () => {
    try {
      // Tìm các đơn hàng PENDING_PAYMENT đã quá hạn reservedUntil
      const expiredOrders = await prisma.order.findMany({
        where: {
          status: 'PENDING_PAYMENT',
          reservedUntil: {
            // Lấy các đơn có reservedUntil nhỏ hơn giờ hiện tại
            lt: new Date()
          }
        },
        select: { id: true }
      });

      if (expiredOrders.length === 0) return;

      console.log(`[JOB] Found ${expiredOrders.length} expired orders. Canceling...`);

      for (const order of expiredOrders) {
        try {
          await OrderService.cancelOrder(order.id, 'SYSTEM_AUTO_EXPIRED');
          console.log(`[JOB] Canceled order: ${order.id}`);
        } catch (err) {
          console.error(`[JOB] Failed to cancel order ${order.id}:`, err);
        }
      }
    } catch (error) {
       console.error('[JOB] Error in OrderExpiryJob:', error);
    }
  });

  console.log('✅ Order Expiry Cron Job started (Runs every 1 minute).');
}
