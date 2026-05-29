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
    const users = await prisma.user.findMany({
        where: { isBlocked: false },
        select: { telegramId: true },
    });

    // Create broadcast log record — non-fatal if table doesn't exist
    let broadcastId = null;
    try {
        const record = await prisma.broadcast.create({ data: { message, status: "SENDING" } });
        broadcastId = record.id;
    } catch (_) {}

    let sentCount = 0;
    let failCount = 0;

    for (const user of users) {
        try {
            await bot.telegram.sendMessage(user.telegramId, message, {
                parse_mode: "HTML",
                disable_web_page_preview: true,
            });
            sentCount++;
            await sleep(50);
        } catch (error) {
            if (error.code === 429) {
                const retryAfter = (error.parameters?.retry_after || 5) * 1000;
                await sleep(retryAfter);
                try {
                    await bot.telegram.sendMessage(user.telegramId, message, {
                        parse_mode: "HTML",
                        disable_web_page_preview: true,
                    });
                    sentCount++;
                } catch (_) { failCount++; }
                continue;
            }
            failCount++;
            console.log(`[broadcast] Failed to send to ${user.telegramId}:`, error.message);
            if (error.code === 403) {
                await prisma.user.update({
                    where: { telegramId: user.telegramId },
                    data: { isBlocked: true },
                });
            }
        }
    }

    // Update log record — non-fatal
    if (broadcastId) {
        try {
            await prisma.broadcast.update({
                where: { id: broadcastId },
                data: { sentCount, failCount, status: "COMPLETED" },
            });
        } catch (_) {}
    }

    try { await logAction(adminId, Actions.BROADCAST, null, { sentCount, failCount, total: users.length }); } catch (_) {}

    return { sentCount, failCount, total: users.length };
}

/**
 * Broadcast a photo + caption to all users
 */
export async function sendBroadcastPhoto(bot, fileId, caption, adminId) {
    const users = await prisma.user.findMany({
        where: { isBlocked: false },
        select: { telegramId: true },
    });

    let sentCount = 0;
    let failCount = 0;

    for (const user of users) {
        try {
            await bot.telegram.sendPhoto(user.telegramId, fileId, {
                caption: caption || "",
                parse_mode: "HTML",
            });
            sentCount++;
            await sleep(50);
        } catch (error) {
            if (error.code === 429) {
                const retryAfter = (error.parameters?.retry_after || 5) * 1000;
                await sleep(retryAfter);
                try {
                    await bot.telegram.sendPhoto(user.telegramId, fileId, {
                        caption: caption || "",
                        parse_mode: "HTML",
                    });
                    sentCount++;
                } catch (_) { failCount++; }
                continue;
            }
            if (error.code === 403) {
                await prisma.user.update({
                    where: { telegramId: user.telegramId },
                    data: { isBlocked: true },
                });
            }
            failCount++;
        }
    }

    try { await logAction(adminId, Actions.BROADCAST, "PHOTO", { sentCount, failCount, total: users.length }); } catch (_) {}

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
            if (error.code === 429) {
                const retryAfter = (error.parameters?.retry_after || 5) * 1000;
                await sleep(retryAfter);
                try {
                    await bot.telegram.sendMessage(user.telegramId, `👑 *Thông báo VIP*\n\n${message}`, {
                        parse_mode: "Markdown",
                        disable_web_page_preview: true,
                    });
                    sentCount++;
                } catch (_) { failCount++; }
                continue;
            }
            if (error.code === 403) {
                await prisma.user.update({
                    where: { telegramId: user.telegramId },
                    data: { isBlocked: true },
                });
            }
            failCount++;
        }
    }

    await logAction(adminId, Actions.BROADCAST, `VIP_${minLevel}`, { sentCount, failCount });

    return { sentCount, failCount, total: users.length };
}

function escapeHtml(str) {
    return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Broadcast stock restock notification to all users with photo + caption if available
 */
export async function broadcastStockNotify(bot, productName, productId, addedCount, currentStock, imageSource = null) {
    let botUsername = bot.botInfo?.username || process.env.TELEGRAM_BOT_USERNAME || "";
    if (!botUsername) {
        try { const me = await bot.telegram.getMe(); botUsername = me.username || ""; } catch (_) {}
    }
    const shopUrl = botUsername ? `https://t.me/${botUsername}?start=product_${productId}` : null;

    const safeName = escapeHtml(productName);
    const text = `🔄 <b>Kho hàng vừa được bổ sung!</b>\n\n📦 <b>${safeName}</b>\n➕ Thêm: <b>${addedCount}</b> dòng\n📊 Tồn kho hiện tại: <b>${currentStock}</b>`;

    const replyMarkup = shopUrl
        ? { inline_keyboard: [[{ text: "🛒 Mua ngay", url: shopUrl }]] }
        : undefined;

    const users = await prisma.user.findMany({
        where: { isBlocked: false },
        select: { telegramId: true },
    });

    console.log(`[broadcastStockNotify] Bắt đầu gửi tới ${users.length} users — SP: ${productName} — ảnh: ${imageSource ? "có" : "không"}`);

    let sentCount = 0;
    let failCount = 0;
    let firstError = null;

    for (const user of users) {
        try {
            if (imageSource) {
                await bot.telegram.sendPhoto(user.telegramId, imageSource, {
                    caption: text,
                    parse_mode: "HTML",
                    ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
                });
            } else {
                await bot.telegram.sendMessage(user.telegramId, text, {
                    parse_mode: "HTML",
                    ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
                });
            }
            sentCount++;
            await sleep(50);
        } catch (error) {
            if (!firstError) firstError = error;
            if (error.code === 429) {
                const retryAfter = (error.parameters?.retry_after || 5) * 1000;
                await sleep(retryAfter);
                try {
                    if (imageSource) {
                        await bot.telegram.sendPhoto(user.telegramId, imageSource, {
                            caption: text, parse_mode: "HTML",
                            ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
                        });
                    } else {
                        await bot.telegram.sendMessage(user.telegramId, text, {
                            parse_mode: "HTML",
                            ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
                        });
                    }
                    sentCount++;
                } catch (_) { failCount++; }
                continue;
            }
            if (error.code === 403) {
                await prisma.user.update({
                    where: { telegramId: user.telegramId },
                    data: { isBlocked: true },
                });
            }
            failCount++;
        }
    }

    console.log(`[broadcastStockNotify] Xong: sent=${sentCount} fail=${failCount}${firstError ? ` firstError=${firstError.message}` : ""}`);
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
