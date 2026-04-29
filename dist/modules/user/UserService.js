import prisma from '../../infrastructure/db.js';
export class UserService {
    /**
     * Creates a new user or returns an existing one. Also handles wallet creation and referral mapping.
     */
    static async findOrCreateUser(telegramId, options) {
        // Check if user exists
        let user = await prisma.user.findUnique({
            where: { telegramId }
        });
        if (user) {
            // Update basic info if changed (optional optimization: only update if different)
            user = await prisma.user.update({
                where: { id: user.id },
                data: {
                    username: options.username,
                    fullName: options.fullName,
                    firstName: options.firstName,
                    lastName: options.lastName,
                    lastActiveAt: new Date()
                }
            });
            return user;
        }
        // Handle referral (Check if referredByCode exists)
        let referredByUserId = null;
        if (options.referredByCode) {
            const referrer = await prisma.user.findUnique({
                where: { referralCode: options.referredByCode }
            });
            if (referrer) {
                referredByUserId = referrer.id;
            }
        }
        // Generate unique referral code for the new user
        const referralCode = `ref_${Math.random().toString(36).substring(2, 10).toUpperCase()}`;
        // Create new user along with a wallet
        user = await prisma.user.create({
            data: {
                telegramId,
                username: options.username,
                fullName: options.fullName,
                firstName: options.firstName,
                lastName: options.lastName,
                languageCode: options.languageCode || 'vi',
                referralCode,
                referredByUserId,
                wallet: {
                    create: {
                        balance: 0,
                        frozenBalance: 0
                    }
                }
            }
        });
        // If there was a successful referral, log it
        if (referredByUserId) {
            await prisma.referral.create({
                data: {
                    referrerUserId: referredByUserId,
                    referredUserId: user.id,
                    referralCodeSnapshot: options.referredByCode || ''
                }
            });
        }
        return user;
    }
    static async getUserWithWallet(telegramId) {
        return prisma.user.findUnique({
            where: { telegramId },
            include: { wallet: true, vipLevel: true }
        });
    }
}
