import { createLogger } from '../../infrastructure/logger.js';
const log = createLogger('RateLimit');
// ─── Config ───────────────────────────────────────────────────────────────────
const WINDOW_MS = 60_000; // 1 phút
const MAX_ACTIONS = 30; // Tối đa 30 action/phút/user
const buckets = new Map();
// Dọn dẹp bucket hết hạn mỗi 5 phút để tránh memory leak
setInterval(() => {
    const now = Date.now();
    for (const [key, bucket] of buckets) {
        if (bucket.resetAt <= now)
            buckets.delete(key);
    }
}, 5 * 60_000);
// ─── Middleware ────────────────────────────────────────────────────────────────
export const rateLimitMiddleware = async (ctx, next) => {
    const userId = ctx.from?.id?.toString();
    if (!userId)
        return next();
    const now = Date.now();
    let bucket = buckets.get(userId);
    if (!bucket || bucket.resetAt <= now) {
        bucket = { count: 0, resetAt: now + WINDOW_MS };
        buckets.set(userId, bucket);
    }
    bucket.count++;
    if (bucket.count > MAX_ACTIONS) {
        log.warn({ userId, count: bucket.count }, 'Rate limit exceeded');
        if (ctx.callbackQuery) {
            await ctx.answerCbQuery('⏳ Bạn thao tác quá nhanh! Vui lòng đợi một chút.', { show_alert: true });
        }
        else {
            await ctx.reply('⏳ Bạn thao tác quá nhanh! Vui lòng đợi một chút.');
        }
        return; // Không tiếp tục xử lý
    }
    return next();
};
