import { prisma } from "./db.js";
import { userCache, balanceCache } from "./lib/cache.js";
import { invalidateWalletCache } from "./wallet.js";
import crypto from "crypto";

/**
 * Referral Module
 * Handles referral code generation and commission tracking
 */

const REFERRAL_COMMISSION_PERCENT = parseInt(process.env.REFERRAL_COMMISSION || "5");

/**
 * Generate a unique referral code
 */
function generateCode() {
    return crypto.randomBytes(4).toString("hex").toUpperCase();
}

/**
 * Get or create user with referral code (cached 60s)
 */
export async function getOrCreateUser(telegramUser, referredByCode = null) {
    const telegramId = String(telegramUser.id);
    const cacheKey = `user:${telegramId}`;

    let user = userCache.get(cacheKey);
    if (!user) {
        user = await prisma.user.findUnique({ where: { telegramId } });
        if (user) userCache.set(cacheKey, user);
    }

    if (!user) {
        // Create new user
        let referralCode = generateCode();

        // Ensure unique code
        while (await prisma.user.findUnique({ where: { referralCode } })) {
            referralCode = generateCode();
        }

        // Find referrer if code provided
        let referredBy = null;
        if (referredByCode) {
            const referrer = await prisma.user.findUnique({
                where: { referralCode: referredByCode },
            });
            if (referrer && referrer.telegramId !== telegramId) {
                referredBy = referrer.id;
            }
        }

        user = await prisma.user.create({
            data: {
                telegramId,
                username: telegramUser.username,
                firstName: telegramUser.first_name,
                referralCode,
                referredBy,
            },
        });
        userCache.set(cacheKey, user);

        // Create referral record if referred by someone
        if (referredBy) {
            await prisma.referral.create({
                data: {
                    referrerId: referredBy,
                    refereeId: user.id,
                    status: "REGISTERED",
                },
            });
        }
    } else {
        // Chỉ update nếu username/firstName đổi để tránh write DB không cần thiết
        const usernameChanged = (user.username || null) !== (telegramUser.username || null);
        const nameChanged = (user.firstName || null) !== (telegramUser.first_name || null);
        if (usernameChanged || nameChanged) {
            await prisma.user.update({
                where: { id: user.id },
                data: {
                    username: telegramUser.username,
                    firstName: telegramUser.first_name,
                },
            });
            user = { ...user, username: telegramUser.username, firstName: telegramUser.first_name };
            userCache.set(cacheKey, user);
        }
    }

    return user;
}

/**
 * Process referral commission for an order
 */
export async function processReferralCommission(userId, orderId, orderAmount) {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user || !user.referredBy) return null;

    const referral = await prisma.referral.findFirst({ where: { refereeId: userId } });
    if (!referral) return null;

    const commission = Math.floor((orderAmount * REFERRAL_COMMISSION_PERCENT) / 100);
    if (commission <= 0) return null;

    const referrer = await prisma.user.findUnique({ where: { id: user.referredBy } });
    if (!referrer) return null;

    // Get or create referrer wallet
    let wallet = await prisma.wallet.findUnique({ where: { odelegramId: referrer.telegramId } });
    if (!wallet) {
        wallet = await prisma.wallet.create({ data: { odelegramId: referrer.telegramId, balance: 0 } });
    }

    // Idempotency: skip if this orderId already has a commission transaction
    const alreadyPaid = await prisma.walletTransaction.findFirst({
        where: { walletId: wallet.id, orderId, type: "ADMIN_ADD" },
    });
    if (alreadyPaid) return null;

    const newBalance = wallet.balance + commission;

    await prisma.$transaction([
        prisma.wallet.update({
            where: { id: wallet.id },
            data: { balance: newBalance },
        }),
        prisma.walletTransaction.create({
            data: {
                walletId: wallet.id,
                type: "ADMIN_ADD",
                amount: commission,
                balanceBefore: wallet.balance,
                balanceAfter: newBalance,
                description: `Hoa hồng giới thiệu #${orderId.slice(-8).toUpperCase()}`,
                status: "SUCCESS",
                orderId,
            },
        }),
    ]);

    balanceCache.invalidate(referrer.telegramId);
    invalidateWalletCache(referrer.telegramId);

    await prisma.referral.update({
        where: { id: referral.id },
        data: {
            orderId,
            commission: { increment: commission },
            status: "COMPLETED",
        },
    });

    return { commission, referrerId: user.referredBy };
}

/**
 * Get user's referral stats
 */
export async function getReferralStats(userId) {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) return null;

    const referrals = await prisma.referral.findMany({
        where: { referrerId: userId },
    });

    const totalCommission = referrals.reduce((sum, r) => sum + r.commission, 0);
    const referralCount = referrals.length;
    const completedCount = referrals.filter((r) => r.status === "COMPLETED").length;

    return {
        referralCode: user.referralCode,
        balance: user.balance,
        totalCommission,
        referralCount,
        completedCount,
        commissionPercent: REFERRAL_COMMISSION_PERCENT,
    };
}

/**
 * Get referral link
 */
export function getReferralLink(botUsername, referralCode) {
    return `https://t.me/${botUsername}?start=ref_${referralCode}`;
}

/**
 * Get top referrers
 */
export async function getTopReferrers(limit = 10) {
    const referrers = await prisma.user.findMany({
        where: { balance: { gt: 0 } },
        orderBy: { balance: "desc" },
        take: limit,
        select: {
            telegramId: true,
            username: true,
            firstName: true,
            balance: true,
        },
    });

    return referrers;
}

export default {
    getOrCreateUser,
    processReferralCommission,
    getReferralStats,
    getReferralLink,
    getTopReferrers,
};
