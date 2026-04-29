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
     * Gửi tin nhắn đến Group Admin (Cấu hình qua ADMIN_GROUP_ID)
     */
    static async sendToAdminGroup(message, options) {
        const adminGroupId = process.env.ADMIN_GROUP_ID;
        if (!adminGroupId) {
            log.warn('ADMIN_GROUP_ID is not configured. Admin notification skipped.');
            return false;
        }
        if (!_bot) {
            log.warn('NotificationService not initialized — admin message not sent');
            return false;
        }
        try {
            await _bot.telegram.sendMessage(adminGroupId, message, {
                parse_mode: options?.parse_mode ?? 'HTML',
            });
            return true;
        }
        catch (err) {
            log.error({ err, adminGroupId }, 'Failed to send message to Admin Group');
            return false;
        }
    }
}
