import { UserService } from '../../modules/user/UserService.js';
import { createLogger } from '../../infrastructure/logger.js';
const log = createLogger('AuthMiddleware');
/**
 * Auth Middleware — tự động inject `ctx.user` vào mọi request.
 *
 * - Nếu user chưa tồn tại → tự động tạo (findOrCreate)
 * - Wallet + VipLevel được include sẵn
 * - Cập nhật lastActiveAt mỗi lần request
 *
 * Note: formatVND helper cũng được inject ở đây.
 */
export const authMiddleware = async (ctx, next) => {
    const from = ctx.from;
    if (!from)
        return next();
    try {
        // 1. Tạo user nếu chưa tồn tại (không có wallet/vip include)
        await UserService.findOrCreateUser(from.id.toString(), {
            username: from.username,
            firstName: from.first_name,
            lastName: from.last_name,
            languageCode: from.language_code,
        });
        // 2. Load đầy đủ với wallet + vipLevel
        const user = await UserService.getUserWithWallet(from.id.toString());
        if (!user)
            return next();
        ctx.user = user;
        // Inject formatVND helper
        ctx.formatVND = (amount) => `${amount.toLocaleString('vi-VN')}đ`;
        return next();
    }
    catch (err) {
        log.error({ err, telegramId: from.id }, 'AuthMiddleware: failed to resolve user');
        return next();
    }
};
