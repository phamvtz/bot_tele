import prisma from '../../infrastructure/db.js';
import { ProductService } from '../product/ProductService.js';
import { StockService } from '../stock/StockService.js';
import { WalletService } from '../wallet/WalletService.js';

export class OrderService {
  /**
   * Flow 9.3: Create pending order and reserve stock.
   */
  static async createPendingOrder(userId: string, productId: string, quantity: number, paymentMethod = 'WALLET') {
    // 1. Validate quantity and product
    const product = await ProductService.validatePurchaseQuantity(productId, quantity);

    // Calculate Prices
    const unitPrice = product.basePrice; // Simplified: Add VIP/Coupon logic here later
    const totalAmount = unitPrice * quantity;
    const reserveTimeMs = 15 * 60 * 1000; // 15 mins expiry
    const reservedUntil = new Date(Date.now() + reserveTimeMs);

    const orderCode = `ORD-${Date.now().toString().slice(-6)}-${Math.random().toString(36).substring(2,6).toUpperCase()}`;

    // 2. Create Order in DB
    const order = await prisma.order.create({
      data: {
        orderCode,
        userId,
        productId,
        status: 'PENDING_PAYMENT',
        paymentMethod,
        subtotalAmount: totalAmount,
        finalAmount: totalAmount,
        reservedUntil,
        items: {
          create: {
            productId,
            productNameSnapshot: product.name,
            unitPrice,
            quantity,
            totalPrice: totalAmount
          }
        }
      }
    });

    // 3. Reserve Stock if needed
    if (product.stockMode !== 'UNLIMITED' && product.productType === 'AUTO_DELIVERY') {
      try {
        await StockService.reserveStock(productId, quantity, order.id, reserveTimeMs);
      } catch (error) {
        // Rollback order if stock reservation fails
        await prisma.order.update({
          where: { id: order.id },
          data: { status: 'FAILED', cancelReason: 'OOS_RESERVE_FAIL' }
        });
        throw new Error('Hết hàng trong kho, không thể tạo đơn.');
      }
    }

    return order;
  }

  /**
   * Flow 9.4: Pay order with Wallet balance.
   */
  static async payWithWallet(orderId: string, userId: string) {
    const order = await prisma.order.findUnique({
      where: { id: orderId }
    });

    if (!order) throw new Error('Order not found');
    if (order.status !== 'PENDING_PAYMENT') throw new Error('Order is not in pending state');
    if (order.reservedUntil && new Date() > order.reservedUntil) {
      await this.cancelOrder(orderId, 'PAYMENT_EXPIRED');
      throw new Error('Đơn hàng đã hết hạn thanh toán');
    }

    // 1. Deduct from wallet
    await WalletService.adjustBalance({
      userId,
      amount: order.finalAmount,
      type: 'PAYMENT',
      direction: 'OUT',
      referenceType: 'ORDER',
      referenceId: order.id,
      description: `Thanh toán đơn hàng ${order.orderCode}`
    });

    // 2. Mark order as Paid
    const paidOrder = await prisma.order.update({
      where: { id: orderId },
      data: {
        status: 'PAID',
        paidAt: new Date(),
        paymentMethod: 'WALLET'
      }
    });

    // 3. Deliver Stock
    await StockService.deliverStock(orderId);

    // 4. Update order state to DELIVERED (Assumption: Auto Delivery)
    await prisma.order.update({
      where: { id: orderId },
      data: { status: 'COMPLETED', completedAt: new Date() }
    });

    return paidOrder;
  }

  static async cancelOrder(orderId: string, reason: string) {
    const order = await prisma.order.update({
      where: { id: orderId },
      data: {
        status: 'CANCELLED',
        cancelledAt: new Date(),
        cancelReason: reason
      }
    });

    // Release stock
    await StockService.releaseStock(orderId);

    return order;
  }
}
