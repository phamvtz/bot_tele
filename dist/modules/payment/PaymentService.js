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
     * Flow: Process Bank Callback
     * Idempotent logic: checks if callback was already processed.
     * Connects bank payload with PaymentRequest and adds to Wallet or completes Order.
     */
    static async processBankCallback(provider, transactionRef, amount, transferContent, rawPayload) {
        return await prisma.$transaction(async (tx) => {
            // 1. Idempotency Check
            const existingCallback = await tx.bankCallback.findUnique({
                where: { transactionRef }
            });
            if (existingCallback) {
                return { status: 'ALREADY_PROCESSED', callback: existingCallback };
            }
            // 2. Find matching pending Payment Request by transferContent
            const request = await tx.paymentRequest.findFirst({
                where: {
                    transferContent: { contains: transferContent },
                    status: 'PENDING'
                }
            });
            // 3. Create the Bank Callback Log
            const callback = await tx.bankCallback.create({
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
                return { status: 'UNMATCHED_NO_REQUEST_FOUND', callback };
            }
            // 4. Validate Amount
            if (request.amount !== amount) {
                await tx.bankCallback.update({
                    where: { id: callback.id },
                    data: { status: 'FAILED' }
                });
                return { status: 'FAILED_AMOUNT_MISMATCH', callback };
            }
            // 5. Validate Expiry
            if (new Date() > request.expiresAt) {
                await tx.bankCallback.update({
                    where: { id: callback.id },
                    data: { status: 'FAILED' }
                });
                await tx.paymentRequest.update({
                    where: { id: request.id },
                    data: { status: 'EXPIRED' }
                });
                return { status: 'FAILED_EXPIRED_REQUEST', callback };
            }
            // 6. Mark request as PAID
            await tx.paymentRequest.update({
                where: { id: request.id },
                data: {
                    status: 'PAID',
                    paidAt: new Date(),
                    rawCallbackId: callback.id
                }
            });
            // 7. BUG FIX: Handle by request type separately
            if (request.type === 'DEPOSIT') {
                // DEPOSIT: add money to wallet
                const wallet = await tx.wallet.findUnique({ where: { userId: request.userId } });
                if (wallet) {
                    await tx.wallet.update({
                        where: { id: wallet.id },
                        data: { balance: { increment: amount }, totalDeposit: { increment: amount } }
                    });
                    await tx.walletTransaction.create({
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
                return { status: 'SUCCESS_DEPOSIT', callback, request };
            }
            else if (request.type === 'ORDER_PAYMENT') {
                // BUG FIX: ORDER_PAYMENT - must complete the linked order, not top-up wallet
                if (!request.orderId) {
                    return { status: 'FAILED_ORDER_PAYMENT_NO_ORDER_ID', callback };
                }
                // We must run outside the outer transaction to avoid nested transaction issues
                // Mark the callback first, then trigger order completion after the transaction
                // Return a signal so the caller can trigger payWithWallet
                return { status: 'SUCCESS_ORDER_PAYMENT_PENDING', callback, request, orderId: request.orderId };
            }
            return { status: 'SUCCESS', callback, request };
        }).then(async (result) => {
            // Emit events AFTER transaction commits
            if (result.status === 'SUCCESS_DEPOSIT' && result.request) {
                // Load user telegramId để emit event
                const user = await prisma.user.findUnique({
                    where: { id: result.request.userId },
                    select: { telegramId: true }
                });
                if (user) {
                    eventBus.emitPaymentReceived({
                        requestId: result.request.id,
                        userId: result.request.userId,
                        telegramId: user.telegramId,
                        amount: result.request.amount,
                        type: 'DEPOSIT',
                    });
                }
            }
            // After transaction commits: if it was an ORDER_PAYMENT, complete the order
            if (result.status === 'SUCCESS_ORDER_PAYMENT_PENDING' && result.orderId && result.request) {
                try {
                    await OrderService.payWithWallet(result.orderId, result.request.userId);
                    return { ...result, status: 'SUCCESS_ORDER_PAYMENT' };
                }
                catch (err) {
                    log.error({ err, orderId: result.orderId }, 'ORDER_PAYMENT auto-complete failed');
                    return { ...result, status: 'FAILED_ORDER_PAYMENT_COMPLETE', error: String(err) };
                }
            }
            return result;
        });
    }
}
