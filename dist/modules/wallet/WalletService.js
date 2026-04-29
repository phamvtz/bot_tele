import prisma from '../../infrastructure/db.js';
export class WalletService {
    /**
     * Adds or subtracts balance securely within a transaction.
     * Enforces rules:
     * 1. Balance cannot be negative.
     * 2. Must create a wallet transaction log.
     */
    static async adjustBalance(params) {
        const { userId, amount, type, direction, referenceType, referenceId, description } = params;
        if (amount <= 0) {
            throw new Error('Amount must be positive');
        }
        return await prisma.$transaction(async (tx) => {
            // 1. Get current wallet
            const wallet = await tx.wallet.findUnique({
                where: { userId }
            });
            if (!wallet)
                throw new Error('Wallet not found for user');
            // 2. Check negative balance rule
            if (direction === 'OUT' && wallet.balance < amount) {
                throw new Error('Insufficient balance');
            }
            // 3. Calculate new balance
            const balanceBefore = wallet.balance;
            const balanceAfter = direction === 'IN'
                ? balanceBefore + amount
                : balanceBefore - amount;
            // 4. Update wallet balances & stats
            const totalDeposit = direction === 'IN' && type === 'DEPOSIT'
                ? wallet.totalDeposit + amount : wallet.totalDeposit;
            const totalSpent = direction === 'OUT' && type === 'PAYMENT'
                ? wallet.totalSpent + amount : wallet.totalSpent;
            const updatedWallet = await tx.wallet.update({
                where: { id: wallet.id },
                data: {
                    balance: balanceAfter,
                    totalDeposit,
                    totalSpent
                }
            });
            // 5. Create transaction log (MANDATORY RULE)
            await tx.walletTransaction.create({
                data: {
                    userId,
                    walletId: wallet.id,
                    type,
                    direction,
                    amount,
                    balanceBefore,
                    balanceAfter,
                    referenceType,
                    referenceId,
                    description
                }
            });
            return updatedWallet;
        });
    }
    static async getTransactions(userId, limit = 10, page = 0) {
        return prisma.walletTransaction.findMany({
            where: { userId },
            orderBy: { createdAt: 'desc' },
            skip: page * limit,
            take: limit
        });
    }
    static async countTransactions(userId) {
        return prisma.walletTransaction.count({ where: { userId } });
    }
}
