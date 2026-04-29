import { createLogger } from '../../infrastructure/logger.js';
const log = createLogger('NotificationService');
let _bot = null;
/**
 * NotificationService — gửi tin nhắn chủ động từ bot tới user.
 *
 * Phải gọi NotificationService.init(bot) khi khởi động server.
 */
export class NotificationService {
    static init(bot) {
        _bot = bot;
    }
    /**
     * Gửi plain text đến một user theo telegramId
     */
    static async sendToUser(telegramId, message, options) {
        if (!_bot) {
            log.warn('NotificationService not initialized — message not sent');
            return false;
        }
        try {
            await _bot.telegram.sendMessage(telegramId, message, {
                parse_mode: options?.parse_mode ?? 'Markdown',
                disable_notification: options?.disable_notification,
            });
            return true;
        }
        catch (err) {
            const code = err.code;
            if (code === 403) {
                // User blocked the bot
                log.warn({ telegramId }, 'User has blocked the bot');
            }
            else {
                log.error({ err, telegramId }, 'Failed to send notification');
            }
            return false;
        }
    }
    /**
     * Broadcast tin nhắn đến danh sách telegramIds.
     * Trả về số tin nhắn đã gửi thành công.
     */
    static async broadcast(telegramIds, message, delayMs = 50 // Tránh flood Telegram API
    ) {
        let sent = 0;
        let failed = 0;
        for (const telegramId of telegramIds) {
            const ok = await NotificationService.sendToUser(telegramId, message);
            if (ok)
                sent++;
            else
                failed++;
            // Rate limit Telegram: max 30 msg/sec
            if (delayMs > 0) {
                await new Promise(res => setTimeout(res, delayMs));
            }
        }
        log.info({ sent, failed, total: telegramIds.length }, 'Broadcast complete');
        return { sent, failed };
    }
    /**
     * Gửi ảnh QR code đến user
     */
    static async sendPhoto(telegramId, photoUrl, caption) {
        if (!_bot)
            return false;
        try {
            await _bot.telegram.sendPhoto(telegramId, photoUrl, {
                caption,
                parse_mode: 'Markdown',
            });
            return true;
        }
        catch (err) {
            log.error({ err, telegramId }, 'Failed to send photo notification');
            return false;
        }
    }
    /**
     * Broadcast thông báo sản phẩm mới đến TẤT CẢ user ACTIVE trong bot.
     * Gửi trực tiếp qua bot, không cần kênh Telegram.
     */
    static async notifyNewStock(opts) {
        if (!_bot) {
            log.warn('NotificationService not initialized — stock notification skipped');
            return false;
        }
        const { productName, productEmoji, addedCount, newStockTotal, botUsername, productId } = opts;
        const text = `🔔 <b>SẢN PHẨM VỪA LÊN HÀNG!</b>\n\n` +
            `${productEmoji} <b>${productName}</b>\n` +
            `💲 Vừa thêm: <b>${addedCount}</b> items\n` +
            `📦 Tồn kho hiện tại: <b>${newStockTotal}</b>\n\n` +
            `<i>Bấm nút bên dưới để mua ngay!</i>`;
        const deepLink = `https://t.me/${botUsername}?start=prod_${productId}`;
        // Lấy tất cả user ACTIVE từ DB
        const prisma = (await import('../../infrastructure/db.js')).default;
        const users = await prisma.user.findMany({
            where: { status: 'ACTIVE' },
            select: { telegramId: true },
        });
        if (users.length === 0) {
            log.info('No active users to notify');
            return false;
        }
        log.info({ productName, addedCount, userCount: users.length }, 'Broadcasting stock notification to all users');
        let sent = 0;
        let failed = 0;
        for (const user of users) {
            try {
                await _bot.telegram.sendMessage(user.telegramId, text, {
                    parse_mode: 'HTML',
                    reply_markup: {
                        inline_keyboard: [[{ text: '🛒 Mua ngay', url: deepLink }]],
                    },
                });
                sent++;
            }
            catch (err) {
                // 403 = user block bot, 400 = chat not found — bỏ qua bình thường
                if (err?.response?.error_code !== 403 && err?.response?.error_code !== 400) {
                    log.warn({ telegramId: user.telegramId, err: err?.message }, 'Failed to send stock notification');
                }
                failed++;
            }
            // Tránh flood Telegram API (30 msg/giây)
            await new Promise(res => setTimeout(res, 40));
        }
        log.info({ sent, failed, total: users.length }, 'Stock broadcast complete');
        return sent > 0;
    }
    /**
     * Gửi tin nhắn đến tất cả Admin theo ADMIN_IDS trong .env
     */
    static async sendToAdmins(message, parseMode = 'HTML') {
        const adminIds = (process.env.ADMIN_IDS ?? '').split(',').map(s => s.trim()).filter(Boolean);
        for (const adminId of adminIds) {
            await NotificationService.sendToUser(adminId, message, { parse_mode: parseMode });
        }
    }
    /**
     * Alias: Gửi đến Admin group (dùng ADMIN_GROUP_ID nếu có, fallback sang ADMIN_IDS)
     */
    static async sendToAdminGroup(message, parseMode = 'HTML') {
        const groupId = process.env.ADMIN_GROUP_ID?.trim();
        if (groupId) {
            await NotificationService.sendToUser(groupId, message, { parse_mode: parseMode });
        }
        else {
            // Fallback: gửi trực tiếp cho từng admin
            await NotificationService.sendToAdmins(message, parseMode);
        }
    }
}
