import { prisma } from "./db.js";
import { logAction, Actions } from "./audit.js";

/**
 * Broadcast Module
 * Send mass notifications to all users
 */

const ADMIN_IDS = (process.env.ADMIN_IDS || "").split(",").map(id => id.trim()).filter(Boolean);

/**
 * Send broadcast message to all users
 */
export async function sendBroadcast(bot, message, adminId) {
    // Get all users
    const users = await prisma.user.findMany({
        where: { isBlocked: false },
        select: { telegramId: true },
    });

    // Create broadcast record
    const broadcast = await prisma.broadcast.create({
        data: {
            message,
            status: "SENDING",
        },
    });

    let sentCount = 0;
    let failCount = 0;

    // Send to each user with delay to avoid rate limits
    for (const user of users) {
        try {
            await bot.telegram.sendMessage(user.telegramId, message, {
                parse_mode: "HTML",
                disable_web_page_preview: true,
            });
            sentCount++;

            // Rate limit: 30 messages per second max
            await sleep(50);
        } catch (error) {
            failCount++;
            console.log(`Failed to send to ${user.telegramId}:`, error.message);

            // Mark user as blocked if they blocked the bot
            if (error.code === 403) {
                await prisma.user.update({
                    where: { telegramId: user.telegramId },
                    data: { isBlocked: true },
                });
            }
        }
    }

    // Update broadcast record
    await prisma.broadcast.update({
        where: { id: broadcast.id },
        data: {
            sentCount,
            failCount,
            status: "COMPLETED",
        },
    });

    // Log action
    await logAction(adminId, Actions.BROADCAST, null, { sentCount, failCount, total: users.length });

    return { sentCount, failCount, total: users.length };
}

/**
 * Get broadcast history
 */
export async function getBroadcastHistory(limit = 10) {
    return await prisma.broadcast.findMany({
        orderBy: { createdAt: "desc" },
        take: limit,
    });
}

/**
 * Send targeted broadcast to VIP users only
 */
export async function sendVipBroadcast(bot, message, minLevel = 1, adminId) {
    const users = await prisma.user.findMany({
        where: {
            isBlocked: false,
            vipLevel: { gte: minLevel },
        },
        select: { telegramId: true },
    });

    let sentCount = 0;
    let failCount = 0;

    for (const user of users) {
        try {
            await bot.telegram.sendMessage(user.telegramId, `👑 *Thông báo VIP*\n\n${message}`, {
                parse_mode: "Markdown",
                disable_web_page_preview: true,
            });
            sentCount++;
            await sleep(50);
        } catch (error) {
            failCount++;
        }
    }

    await logAction(adminId, Actions.BROADCAST, `VIP_${minLevel}`, { sentCount, failCount });

    return { sentCount, failCount, total: users.length };
}

/**
 * Notify admins
 */
export async function notifyAdmins(bot, message) {
    for (const adminId of ADMIN_IDS) {
        try {
            await bot.telegram.sendMessage(adminId, message, {
                parse_mode: "Markdown",
                disable_web_page_preview: true,
            });
        } catch (error) {
            console.log(`Failed to notify admin ${adminId}`);
        }
    }
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

export default {
    sendBroadcast,
    getBroadcastHistory,
    sendVipBroadcast,
    notifyAdmins,
};
