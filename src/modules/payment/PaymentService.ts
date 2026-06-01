import prisma from '../../infrastructure/db.js';
import { WalletService } from '../wallet/WalletService.js';
import { OrderService } from '../order/OrderService.js';
import eventBus from '../../infrastructure/events.js';
import { createLogger } from '../../infrastructure/logger.js';
import crypto from 'crypto';

const log = createLogger('PaymentService');

export class PaymentService {
  /**
   * Flow 9.6: Create a Deposit Request for User
   * Generates a unique transfer content and saves it.
   */
  static async createDepositRequest(userId: string, amount: number) {
    if (amount <= 0) throw new Error('Amount must be positive');

    const transferContent = `BOT${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
    const requestCode = `REQ-${Date.now().toString().slice(-6)}`;
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000);

    const request = await prisma.paymentRequest.create({
      data: {
        requestCode,
        userId,
        type: 'DEPOSIT',
        amount,
        transferContent,
        expiresAt,
        status: 'PENDING',
      },
    });

    return request;
  }

  /**
   * Tạo PaymentRequest loại ORDER_PAYMENT — thanh toán đơn hàng trực tiếp qua CK ngân hàng.
   * expiresAt đồng bộ với order.reservedUntil; tái sử dụng request PENDING nếu đã có.
   */
  static async createOrderPaymentRequest(userId: string, orderId: string, amount?: number) {
    const order = await prisma.order.findUnique({ where: { id: orderId } });
    if (!order) throw new Error('Không tìm thấy đơn hàng');
    if (order.userId !== userId) throw new Error('Đơn hàng không thuộc về bạn');
    if (order.status !== 'PENDING_PAYMENT') throw new Error('Đơn hàng không ở trạng thái chờ thanh toán');
    if (order.reservedUntil && new Date() > order.reservedUntil) {
      throw new Error('Đơn hàng đã hết hạn thanh toán');
    }

    const payAmount = amount ?? order.finalAmount;
    if (payAmount !== order.finalAmount) throw new Error('Số tiền không khớp đơn hàng');

    const existing = await prisma.paymentRequest.findFirst({
      where: { orderId, userId, type: 'ORDER_PAYMENT', status: 'PENDING' },
    });
    if (existing) return existing;

    const transferContent = `BOT${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
    const requestCode = `ORD-${Date.now().toString().slice(-6)}`;
    const expiresAt = order.reservedUntil ?? new Date(Date.now() + 15 * 60 * 1000);

    const request = await prisma.paymentRequest.create({
      data: {
        requestCode,
        userId,
        type: 'ORDER_PAYMENT',
        orderId,
        amount: payAmount,
        transferContent,
        expiresAt,
        status: 'PENDING',
      },
    });

    return request;
  }

  /**
   * Kiểm tra đơn hàng trước khi xử lý ORDER_PAYMENT từ bank callback.
   */
  private static async validateOrderForPayment(
    request: { orderId: string | null; userId: string; amount: number },
  ): Promise<string | null> {
    if (!request.orderId) return 'FAILED_ORDER_PAYMENT_NO_ORDER_ID';

    const order = await prisma.order.findUnique({ where: { id: request.orderId } });
    if (!order) return 'FAILED_ORDER_NOT_FOUND';
    if (order.userId !== request.userId) return 'FAILED_ORDER_USER_MISMATCH';
    if (order.status !== 'PENDING_PAYMENT') return 'FAILED_ORDER_NOT_PENDING';
    if (order.reservedUntil && new Date() > order.reservedUntil) return 'FAILED_ORDER_EXPIRED';
    if (order.finalAmount !== request.amount) return 'FAILED_ORDER_AMOUNT_MISMATCH';

    return null;
  }

  /**
   * Flow: Process Bank Callback
   * Idempotent logic: checks if callback was already processed.
   * Chỉ đánh dấu PAID sau khi cộng ví / hoàn tất đơn thành công.
   */
  static async processBankCallback(
    provider: string,
    transactionRef: string,
    amount: number,
    transferContent: string,
    rawPayload: string,
  ) {
    const existingCallback = await prisma.bankCallback.findUnique({
      where: { transactionRef },
    });
    if (existingCallback) {
      return { status: 'ALREADY_PROCESSED', callback: existingCallback };
    }

    const match = transferContent.match(/BOT[A-F0-9]{6}/i);
    const extractedCode = match ? match[0].toUpperCase() : null;

    let request = null;
    if (extractedCode) {
      request = await prisma.paymentRequest.findFirst({
        where: { transferContent: extractedCode, status: 'PENDING' },
      });
    }

    const callback = await prisma.bankCallback.create({
      data: {
        provider,
        transactionRef,
        amount,
        transferContent,
        rawPayload,
        matchedRequestId: request?.id,
        status: request ? 'MATCHED' : 'UNMATCHED',
        processedAt: new Date(),
      },
    });

    if (!request) {
      log.info({ transactionRef, extractedCode }, 'Bank callback unmatched');
      return { status: 'UNMATCHED_NO_REQUEST_FOUND', callback };
    }

    if (request.amount !== amount) {
      await prisma.bankCallback.update({ where: { id: callback.id }, data: { status: 'FAILED' } });
      return { status: 'FAILED_AMOUNT_MISMATCH', callback };
    }

    if (new Date() > request.expiresAt) {
      await prisma.bankCallback.update({ where: { id: callback.id }, data: { status: 'FAILED' } });
      await prisma.paymentRequest.updateMany({
        where: { id: request.id, status: 'PENDING' },
        data: { status: 'EXPIRED' },
      });
      return { status: 'FAILED_EXPIRED_REQUEST', callback };
    }

    if (request.type === 'ORDER_PAYMENT') {
      const orderError = await this.validateOrderForPayment(request);
      if (orderError) {
        await prisma.bankCallback.update({ where: { id: callback.id }, data: { status: 'FAILED' } });
        log.warn({ orderError, requestId: request.id, orderId: request.orderId }, 'ORDER_PAYMENT validation failed');
        return { status: orderError, callback };
      }
    }

    // Claim request — chỉ một callback được xử lý
    const claimed = await prisma.paymentRequest.updateMany({
      where: { id: request.id, status: 'PENDING' },
      data: { status: 'PAID', paidAt: new Date(), rawCallbackId: callback.id },
    });
    if (claimed.count === 0) {
      return { status: 'ALREADY_PROCESSED_REQUEST', callback };
    }

    try {
      if (request.type === 'DEPOSIT') {
        await WalletService.adjustBalance({
          userId: request.userId,
          amount,
          type: 'DEPOSIT',
          direction: 'IN',
          referenceType: 'DEPOSIT_REQUEST',
          referenceId: request.id,
          description: `Nạp tiền tự động từ mã QR ${request.transferContent}`,
        });

        const user = await prisma.user.findUnique({
          where: { id: request.userId },
          select: { telegramId: true },
        });
        if (user) {
          eventBus.emitPaymentReceived({
            requestId: request.id,
            userId: request.userId,
            telegramId: user.telegramId,
            amount: request.amount,
            type: 'DEPOSIT',
          });
        }
        return { status: 'SUCCESS_DEPOSIT', callback, request };
      }

      if (request.type === 'ORDER_PAYMENT') {
        await OrderService.payWithBank(request.orderId!, request.userId);
        return { status: 'SUCCESS_ORDER_PAYMENT', callback, request };
      }

      return { status: 'SUCCESS', callback, request };
    } catch (err) {
      log.error({ err, requestId: request.id, type: request.type }, 'Bank callback fulfillment failed');

      await prisma.paymentRequest.update({
        where: { id: request.id },
        data: { status: 'FAILED' },
      });
      await prisma.bankCallback.update({ where: { id: callback.id }, data: { status: 'FAILED' } });

      if (request.type === 'ORDER_PAYMENT') {
        return { status: 'FAILED_ORDER_PAYMENT_COMPLETE', callback };
      }
      return { status: 'FAILED_DEPOSIT', callback };
    }
  }
}
