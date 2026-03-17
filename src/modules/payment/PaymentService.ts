import prisma from '../../infrastructure/db.js';
import { WalletService } from '../wallet/WalletService.js';
import crypto from 'crypto';

export class PaymentService {
  /**
   * Flow 9.6: Create a Deposit Request for User
   * Generates a unique transfer content and saves it.
   */
  static async createDepositRequest(userId: string, amount: number) {
    if (amount <= 0) throw new Error('Amount must be positive');

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
   * Connects bank payload with PaymentRequest and adds to Wallet.
   */
  static async processBankCallback(provider: string, transactionRef: string, amount: number, transferContent: string, rawPayload: string) {
    return await prisma.$transaction(async (tx) => {
      // 1. Idempotency Check
      const existingCallback = await tx.bankCallback.findUnique({
        where: { transactionRef }
      });

      if (existingCallback) {
        return { status: 'ALREADY_PROCESSED', callback: existingCallback };
      }

      // 2. Find matching pending Payment Request
      // Use exact match or contains logic based on your bank webhook standard
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

      // 4. Validate Amount and Expiry
      if (request.amount !== amount) {
        // Amount mismatch - could flag for admin review instead of rejecting totally
        await tx.bankCallback.update({
          where: { id: callback.id },
          data: { status: 'FAILED' }
        });
        return { status: 'FAILED_AMOUNT_MISMATCH', callback };
      }

      if (new Date() > request.expiresAt) {
        await tx.bankCallback.update({
          where: { id: callback.id },
          data: { status: 'FAILED' } // Optionally accept but warn admin
        });
        
        await tx.paymentRequest.update({
          where: { id: request.id },
          data: { status: 'EXPIRED' }
        });

        return { status: 'FAILED_EXPIRED_REQUEST', callback };
      }

      // 5. Valid Match -> Update Request and Add to Wallet
      await tx.paymentRequest.update({
        where: { id: request.id },
        data: {
          status: 'PAID',
          paidAt: new Date(),
          rawCallbackId: callback.id
        }
      });

      if (request.type === 'DEPOSIT') {
        const wallet = await tx.wallet.findUnique({ where: { userId: request.userId } });
        if (wallet) {
           await tx.wallet.update({
             where: { id: wallet.id },
             data: { balance: { increment: amount }, totalDeposit: { increment: amount } }
           });

           // Create Wallet Transaction
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
      }

      return { status: 'SUCCESS', callback, request };
    });
  }
}
