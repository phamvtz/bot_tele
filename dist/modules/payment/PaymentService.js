import prisma from '../../infrastructure/db.js';
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
    static async createDepositRequest(userId, amount) {
        if (amount <= 0)
            throw new Error('Amount must be positive');
        // Generate unique transfer content: BOT + 6 random chars
        const transferContent = `BOT${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
        const requestCode = `REQ-${Date.now().toString().slice(-6)}`;
        // Default expiry: 30 minutes
        const expiresAt = new Date(Date.now() + 30 * 60 * 1000);
        const request = await prisma.paymentRequest.create({
            data: {
                requestCode,
                userId,
                type: 'DEPOSIT',
                amount,
                transferContent,
                expiresAt,
                status: 'PENDING'
            }
        });
        return request;
    }
    /**
     * Tạo PaymentRequest loại ORDER_PAYMENT — thanh toán đơn hàng trực tiếp qua CK ngân hàng
     * Không cần nạp ví, khi nhận tiền sẽ tự complete order.
     */
    static async createOrderPaymentRequest(userId, orderId, amount) {
        if (amount <= 0)
            throw new Error('Amount must be positive');
        const transferContent = `BOT${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
        const requestCode = `ORD-${Date.now().toString().slice(-6)}`;
        const expiresAt = new Date(Date.now() + 30 * 60 * 1000); // 30 phút
        const request = await prisma.paymentRequest.create({
            data: {
                requestCode,
                userId,
                type: 'ORDER_PAYMENT',
                orderId,
                amount,
                transferContent,
                expiresAt,
                status: 'PENDING'
            }
        });
        return request;
    }
    /**
     * Flow: Process Bank Callback
     * Idempotent logic: checks if callback was already processed.
     * Connects bank payload with PaymentRequest and adds to Wallet or completes Order.
     */
    static async processBankCallback(provider, transactionRef, amount, transferContent, rawPayload) {
        // 1. Idempotency Check — không dùng transaction để tránh MongoDB deadlock
        const existingCallback = await prisma.bankCallback.findUnique({
            where: { transactionRef }
        });
        if (existingCallback) {
            return { status: 'ALREADY_PROCESSED', callback: existingCallback };
        }
        // 2. Tìm PaymentRequest khớp mã BOT
        const match = transferContent.match(/BOT[A-F0-9]{6}/i);
        const extractedCode = match ? match[0].toUpperCase() : null;
        let request = null;
        if (extractedCode) {
            request = await prisma.paymentRequest.findFirst({
                where: { transferContent: extractedCode, status: 'PENDING' }
            });
        }
        // 3. Tạo BankCallback log
        const callback = await prisma.bankCallback.create({
            data: {
                provider,
                transactionRef,
                amount,
                transferContent,
                rawPayload,
                matchedRequestId: request?.id,
                status: request ? 'MATCHED' : 'UNMATCHED',
                processedAt: new Date()
            }
        });
        if (!request) {
            log.info({ transactionRef, extractedCode }, 'Bank callback unmatched');
            return { status: 'UNMATCHED_NO_REQUEST_FOUND', callback };
        }
        // 4. Validate Amount
        if (request.amount !== amount) {
            await prisma.bankCallback.update({ where: { id: callback.id }, data: { status: 'FAILED' } });
            return { status: 'FAILED_AMOUNT_MISMATCH', callback };
        }
        // 5. Validate Expiry
        if (new Date() > request.expiresAt) {
            await prisma.bankCallback.update({ where: { id: callback.id }, data: { status: 'FAILED' } });
            await prisma.paymentRequest.update({ where: { id: request.id }, data: { status: 'EXPIRED' } });
            return { status: 'FAILED_EXPIRED_REQUEST', callback };
        }
        // 6. Mark request PAID
        await prisma.paymentRequest.update({
            where: { id: request.id },
            data: { status: 'PAID', paidAt: new Date(), rawCallbackId: callback.id }
        });
        // 7. Xử lý theo loại
        if (request.type === 'DEPOSIT') {
            const wallet = await prisma.wallet.findUnique({ where: { userId: request.userId } });
            if (wallet) {
                await prisma.wallet.update({
                    where: { id: wallet.id },
                    data: { balance: { increment: amount }, totalDeposit: { increment: amount } }
                });
                await prisma.walletTransaction.create({
                    data: {
                        userId: request.userId,
                        walletId: wallet.id,
                        type: 'DEPOSIT',
                        direction: 'IN',
                        amount,
                        balanceBefore: wallet.balance,
                        balanceAfter: wallet.balance + amount,
                        referenceType: 'DEPOSIT_REQUEST',
                        referenceId: request.id,
                        description: `Nạp tiền tự động từ mã QR ${request.transferContent}`
                    }
                });
            }
            // Emit event sau khi xong
            const user = await prisma.user.findUnique({
                where: { id: request.userId },
                select: { telegramId: true }
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
        else if (request.type === 'ORDER_PAYMENT') {
            if (!request.orderId) {
                return { status: 'FAILED_ORDER_PAYMENT_NO_ORDER_ID', callback };
            }
            // Hoàn thành đơn hàng sau khi bank confirm
            try {
                await OrderService.payWithBank(request.orderId, request.userId);
                return { status: 'SUCCESS_ORDER_PAYMENT', callback, request };
            }
            catch (err) {
                log.error({ err, orderId: request.orderId }, 'ORDER_PAYMENT auto-complete failed');
                return { status: 'FAILED_ORDER_PAYMENT_COMPLETE', callback };
            }
        }
        return { status: 'SUCCESS', callback, request };
    }
}
