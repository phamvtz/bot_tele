import prisma from '../../infrastructure/db.js';

export class ReferralService {
  /**
   * Flow 9.10: Calculate and Pay Referral Commission
   * Called when an Order is COMPLETED.
   */
  static async processCommission(orderId: string) {
    const order = await prisma.order.findUnique({
      where: { id: orderId, status: 'COMPLETED' },
      include: { user: { include: { referredBy: true } } }
    });

    if (!order || !order.user.referredBy) return null;

    const referrerId = order.user.referredBy.id;
    const refereeId = order.user.id;
    
    // Fetch global ref rate from settings (default to 5%)
    let commissionRate = 5; 
    const settingRefRate = await prisma.setting.findUnique({ where: { settingKey: 'referral_commission_rate'} });
    if (settingRefRate) commissionRate = parseInt(settingRefRate.settingValue, 10);

    const commissionAmount = Math.floor(order.finalAmount * (commissionRate / 100));

    if (commissionAmount <= 0) return null;

    return await prisma.$transaction(async (tx) => {
      // Create Commission Record
      const refComm = await tx.referralCommission.create({
        data: {
          referrerUserId: referrerId,
          referredUserId: refereeId,
          orderId,
          commissionRate,
          commissionAmount,
          status: 'PAID',
          paidAt: new Date()
        }
      });

      // Add to Referrer Wallet
      const wallet = await tx.wallet.findUnique({ where: { userId: referrerId } });
      if (wallet) {
        await tx.wallet.update({
          where: { id: wallet.id },
          data: { 
            balance: { increment: commissionAmount },
            totalRefCommission: { increment: commissionAmount }
          }
        });

        await tx.walletTransaction.create({
          data: {
            userId: referrerId,
            walletId: wallet.id,
            type: 'REFERRAL_COMMISSION',
            direction: 'IN',
            amount: commissionAmount,
            balanceBefore: wallet.balance,
            balanceAfter: wallet.balance + commissionAmount,
            referenceType: 'REFERRAL',
            referenceId: refComm.id,
            description: `Hoa hồng giới thiệu từ đơn ${order.orderCode}`
          }
        });
      }

      // Update Order log
      await tx.order.update({
        where: { id: orderId },
        data: { referralCommissionAmount: commissionAmount }
      });

      return refComm;
    });
  }
}
