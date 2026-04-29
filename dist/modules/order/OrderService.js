import prisma from '../../infrastructure/db.js';
import { ProductService } from '../product/ProductService.js';
import { StockService } from '../stock/StockService.js';
import { WalletService } from '../wallet/WalletService.js';
import { ReferralService } from '../referral/ReferralService.js';
import eventBus from '../../infrastructure/events.js';
import { createLogger } from '../../infrastructure/logger.js';
const log = createLogger('OrderService');
export class OrderService {
    // ─── Create Order ──────────────────────────────────────────────────────────
    /**
     * Tạo pending order với VIP discount tự động.
     * Reserve stock nếu product là AUTO_DELIVERY + TRACKED.
     */
    static async createPendingOrder(userId, productId, quantity, paymentMethod = 'WALLET', couponCode) {
        const product = await ProductService.validatePurchaseQuantity(productId, quantity);
        // Load user để check VIP level
        const user = await prisma.user.findUnique({
            where: { id: userId },
            include: { vipLevel: true },
        });
        // Tính giá: VIP price được áp dụng nếu user có VIP level và sản phẩm có vipPrice
        const unitPrice = (user?.vipLevel && product.vipPrice)
            ? product.vipPrice
            : product.basePrice;
        const subtotalAmount = unitPrice * quantity;
        // VIP discount (nếu vipPrice < basePrice)
        const vipDiscount = (product.vipPrice && product.vipPrice < product.basePrice)
            ? (product.basePrice - product.vipPrice) * quantity
            : 0;
        // TODO: Coupon discount — validate và tính ở đây
        const couponDiscount = 0;
        const finalAmount = subtotalAmount - couponDiscount;
        const reserveTimeMs = 15 * 60 * 1000; // 15 phút
        const reservedUntil = new Date(Date.now() + reserveTimeMs);
        const orderCode = `ORD-${Date.now().toString().slice(-6)}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;
        const order = await prisma.order.create({
            data: {
                orderCode,
                userId,
                productId,
                status: 'PENDING_PAYMENT',
                paymentMethod,
                subtotalAmount,
                discountAmount: vipDiscount + couponDiscount,
                finalAmount,
                vipDiscountApplied: vipDiscount > 0,
                reservedUntil,
                items: {
                    create: {
                        productId,
                        productNameSnapshot: product.name,
                        unitPrice,
                        quantity,
                        totalPrice: finalAmount,
                    },
                },
            },
        });
        // Reserve stock nếu cần
        if (product.stockMode !== 'UNLIMITED' && product.productType === 'AUTO_DELIVERY') {
            try {
                await StockService.reserveStock(productId, quantity, order.id, reserveTimeMs);
            }
            catch {
                await prisma.order.update({
                    where: { id: order.id },
                    data: { status: 'FAILED', cancelReason: 'OOS_RESERVE_FAIL' },
                });
                throw new Error('Hết hàng trong kho, không thể tạo đơn.');
            }
        }
        return order;
    }
    // ─── Pay With Wallet ───────────────────────────────────────────────────────
    static async payWithWallet(orderId, userId) {
        const order = await prisma.order.findUnique({
            where: { id: orderId },
            include: { user: true },
        });
        if (!order)
            throw new Error('Order not found');
        if (order.userId !== userId)
            throw new Error('Bạn không có quyền thanh toán đơn hàng này');
        if (order.status !== 'PENDING_PAYMENT')
            throw new Error('Order is not in pending state');
        if (order.reservedUntil && new Date() > order.reservedUntil) {
            await this.cancelOrder(orderId, 'PAYMENT_EXPIRED');
            throw new Error('Đơn hàng đã hết hạn thanh toán');
        }
        // 1. Deduct wallet
        await WalletService.adjustBalance({
            userId,
            amount: order.finalAmount,
            type: 'PAYMENT',
            direction: 'OUT',
            referenceType: 'ORDER',
            referenceId: order.id,
            description: `Thanh toán đơn hàng ${order.orderCode}`,
        });
        // 2. Mark PAID
        await prisma.order.update({
            where: { id: orderId },
            data: { status: 'PAID', paidAt: new Date(), paymentMethod: 'WALLET' },
        });
        // 3. Deliver stock
        await StockService.deliverStock(orderId);
        // 4. Mark COMPLETED
        const completedOrder = await prisma.order.update({
            where: { id: orderId },
            data: { status: 'COMPLETED', completedAt: new Date() },
        });
        // 5. Cập nhật user stats
        await prisma.user.update({
            where: { id: userId },
            data: {
                totalSpent: { increment: order.finalAmount },
                totalOrders: { increment: 1 },
            },
        });
        // 6. Referral commission (non-fatal)
        try {
            await ReferralService.processCommission(orderId);
        }
        catch (err) {
            log.error({ err, orderId }, 'Referral commission failed — non-fatal');
        }
        // 7. Emit ORDER_COMPLETED event → NotificationService sẽ gửi key cho user
        eventBus.emitOrderCompleted({
            order: completedOrder,
            userId,
            telegramId: order.user.telegramId,
        });
        return completedOrder;
    }
    // ─── Pay With Bank ─────────────────────────────────────────────────────────
    static async payWithBank(orderId, userId) {
        const order = await prisma.order.findUnique({
            where: { id: orderId },
            include: { user: true },
        });
        if (!order)
            throw new Error('Order not found');
        if (order.userId !== userId)
            throw new Error('Bạn không có quyền thanh toán đơn hàng này');
        if (order.status !== 'PENDING_PAYMENT')
            throw new Error('Order is not in pending state');
        if (order.reservedUntil && new Date() > order.reservedUntil) {
            await this.cancelOrder(orderId, 'PAYMENT_EXPIRED');
            throw new Error('Đơn hàng đã hết hạn thanh toán');
        }
        // Không trừ tiền từ ví vì đã nạp tiền qua bank thẳng vào đơn hàng
        // 2. Mark PAID
        await prisma.order.update({
            where: { id: orderId },
            data: { status: 'PAID', paidAt: new Date(), paymentMethod: 'BANK_TRANSFER' },
        });
        // 3. Deliver stock
        await StockService.deliverStock(orderId);
        // 4. Mark COMPLETED
        const completedOrder = await prisma.order.update({
            where: { id: orderId },
            data: { status: 'COMPLETED', completedAt: new Date() },
        });
        // 5. Cập nhật user stats
        await prisma.user.update({
            where: { id: userId },
            data: {
                totalSpent: { increment: order.finalAmount },
                totalOrders: { increment: 1 },
            },
        });
        // 6. Referral commission (non-fatal)
        try {
            await ReferralService.processCommission(orderId);
        }
        catch (err) {
            log.error({ err, orderId }, 'Referral commission failed — non-fatal');
        }
        // 7. Emit ORDER_COMPLETED event
        eventBus.emitOrderCompleted({
            order: completedOrder,
            userId,
            telegramId: order.user.telegramId,
        });
        return completedOrder;
    }
    // ─── Cancel Order ──────────────────────────────────────────────────────────
    static async cancelOrder(orderId, reason) {
        const order = await prisma.order.update({
            where: { id: orderId },
            data: {
                status: 'CANCELLED',
                cancelledAt: new Date(),
                cancelReason: reason,
            },
        });
        await StockService.releaseStock(orderId);
        return order;
    }
    // ─── Get Orders ────────────────────────────────────────────────────────────
    static async getUserOrders(userId, page = 0, limit = 10) {
        const [orders, total] = await Promise.all([
            prisma.order.findMany({
                where: { userId },
                orderBy: { createdAt: 'desc' },
                include: { items: true },
                skip: page * limit,
                take: limit,
            }),
            prisma.order.count({ where: { userId } }),
        ]);
        return { orders, total, totalPages: Math.ceil(total / limit), page };
    }
    static async getOrderWithDeliveredItems(orderId) {
        const deliveredItems = await prisma.deliveredItem.findMany({
            where: { orderId },
            include: { orderItem: true },
        });
        return deliveredItems;
    }
    // ─── Admin Orders ──────────────────────────────────────────────────────────
    static async getAllOrdersPaginated(page = 0, limit = 10) {
        const [orders, total] = await Promise.all([
            prisma.order.findMany({
                orderBy: { createdAt: 'desc' },
                include: { user: true, items: true },
                skip: page * limit,
                take: limit,
            }),
            prisma.order.count(),
        ]);
        return { orders, total, totalPages: Math.ceil(total / limit), page };
    }
    // ─── Admin Stats ───────────────────────────────────────────────────────────
    static async getDashboardStats() {
        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);
        const thisMonthStart = new Date();
        thisMonthStart.setDate(1);
        thisMonthStart.setHours(0, 0, 0, 0);
        const [todayOrders, todayRevenue, monthOrders, monthRevenue, totalOrders, totalRevenue, totalUsers, newUsersToday, lowStockProducts, totalProducts] = await Promise.all([
            prisma.order.count({ where: { status: 'COMPLETED', createdAt: { gte: todayStart } } }),
            prisma.order.aggregate({ where: { status: 'COMPLETED', createdAt: { gte: todayStart } }, _sum: { finalAmount: true } }),
            prisma.order.count({ where: { status: 'COMPLETED', createdAt: { gte: thisMonthStart } } }),
            prisma.order.aggregate({ where: { status: 'COMPLETED', createdAt: { gte: thisMonthStart } }, _sum: { finalAmount: true } }),
            prisma.order.count({ where: { status: 'COMPLETED' } }),
            prisma.order.aggregate({ where: { status: 'COMPLETED' }, _sum: { finalAmount: true } }),
            prisma.user.count(),
            prisma.user.count({ where: { createdAt: { gte: todayStart } } }),
            prisma.product.count({
                where: {
                    isActive: true,
                    stockMode: 'TRACKED',
                    stockCount: { lt: parseInt(process.env.LOW_STOCK_THRESHOLD ?? '5', 10) },
                },
            }),
            prisma.product.count({ where: { isActive: true } }),
        ]);
        return {
            todayOrders,
            todayRevenue: todayRevenue._sum.finalAmount ?? 0,
            monthOrders,
            monthRevenue: monthRevenue._sum.finalAmount ?? 0,
            totalOrders,
            totalRevenue: totalRevenue._sum.finalAmount ?? 0,
            totalUsers,
            newUsers: newUsersToday,
            lowStockCount: lowStockProducts,
            totalProducts,
        };
    }
}
