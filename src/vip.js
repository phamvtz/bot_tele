import { prisma } from "./db.js";

/**
 * VIP Membership Module
 * Handles VIP levels, benefits, and upgrades
 */

// Default VIP levels
const DEFAULT_VIP_LEVELS = [
    { level: 0, name: "Thường", minSpent: 0, discountPercent: 0, referralBonus: 5 },
    { level: 1, name: "Bạc", minSpent: 500000, discountPercent: 5, referralBonus: 7 },
    { level: 2, name: "Vàng", minSpent: 2000000, discountPercent: 10, referralBonus: 10 },
    { level: 3, name: "Kim Cương", minSpent: 5000000, discountPercent: 15, referralBonus: 15 },
];

/**
 * Initialize VIP levels in database
 */
export async function initVipLevels() {
    for (const level of DEFAULT_VIP_LEVELS) {
        await prisma.vipLevel.upsert({
            where: { level: level.level },
            update: level,
            create: level,
        });
    }
    console.log("✅ VIP levels initialized");
}

/**
 * Get all VIP levels
 */
export async function getVipLevels() {
    return await prisma.vipLevel.findMany({
        orderBy: { level: "asc" },
    });
}

/**
 * Get user's VIP info
 */
export async function getUserVipInfo(userId) {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) return null;

    const currentLevel = await prisma.vipLevel.findUnique({
        where: { level: user.vipLevel },
    });

    const nextLevel = await prisma.vipLevel.findFirst({
        where: { level: user.vipLevel + 1 },
    });

    return {
        user,
        currentLevel,
        nextLevel,
        progress: nextLevel
            ? Math.min(100, Math.round((user.totalSpent / nextLevel.minSpent) * 100))
            : 100,
        remaining: nextLevel ? Math.max(0, nextLevel.minSpent - user.totalSpent) : 0,
    };
}

/**
 * Check and upgrade user VIP level based on total spent
 */
export async function checkAndUpgradeVip(userId) {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) return null;

    const levels = await getVipLevels();
    let newLevel = 0;

    for (const level of levels) {
        if (user.totalSpent >= level.minSpent) {
            newLevel = level.level;
        }
    }

    if (newLevel > user.vipLevel) {
        await prisma.user.update({
            where: { id: userId },
            data: { vipLevel: newLevel },
        });

        return {
            upgraded: true,
            oldLevel: user.vipLevel,
            newLevel,
            levelInfo: levels.find(l => l.level === newLevel),
        };
    }

    return { upgraded: false };
}

/**
 * Get VIP discount for user
 */
export async function getVipDiscount(userId) {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) return 0;

    const level = await prisma.vipLevel.findUnique({
        where: { level: user.vipLevel },
    });

    return level?.discountPercent || 0;
}

/**
 * Get VIP referral bonus for user
 */
export async function getVipReferralBonus(userId) {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) return 5; // Default 5%

    const level = await prisma.vipLevel.findUnique({
        where: { level: user.vipLevel },
    });

    return level?.referralBonus || 5;
}

/**
 * Add to user's total spent and check upgrade
 */
export async function addSpending(userId, amount) {
    await prisma.user.update({
        where: { id: userId },
        data: { totalSpent: { increment: amount } },
    });

    return await checkAndUpgradeVip(userId);
}

/**
 * Set user VIP level manually (admin)
 */
export async function setVipLevel(userId, level) {
    return await prisma.user.update({
        where: { id: userId },
        data: { vipLevel: level },
    });
}

/**
 * Get VIP level emoji
 */
export function getVipEmoji(level) {
    const emojis = ["👤", "🥈", "🥇", "💎"];
    return emojis[level] || "👤";
}

/**
 * Format VIP info for display
 */
export function formatVipInfo(vipInfo, lang = "vi") {
    const emoji = getVipEmoji(vipInfo.currentLevel?.level || 0);
    const name = vipInfo.currentLevel?.name || "Thường";

    let msg = `${emoji} *Cấp độ VIP: ${name}*\n\n`;
    msg += `💰 Tổng chi tiêu: ${vipInfo.user.totalSpent.toLocaleString()}đ\n`;
    msg += `🎁 Giảm giá: ${vipInfo.currentLevel?.discountPercent || 0}%\n`;
    msg += `👥 Hoa hồng giới thiệu: ${vipInfo.currentLevel?.referralBonus || 5}%\n`;

    if (vipInfo.nextLevel) {
        msg += `\n📊 *Lên ${vipInfo.nextLevel.name}:*\n`;
        msg += `├─ Tiến độ: ${vipInfo.progress}%\n`;
        msg += `└─ Còn thiếu: ${vipInfo.remaining.toLocaleString()}đ`;
    } else {
        msg += `\n🏆 *Bạn đã đạt cấp cao nhất!*`;
    }

    return msg;
}

export default {
    initVipLevels,
    getVipLevels,
    getUserVipInfo,
    checkAndUpgradeVip,
    getVipDiscount,
    getVipReferralBonus,
    addSpending,
    setVipLevel,
    getVipEmoji,
    formatVipInfo,
};
