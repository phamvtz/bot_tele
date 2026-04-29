import { createLogger } from '../../infrastructure/logger.js';
const log = createLogger('RateLimit');
// ─── Config ───────────────────────────────────────────────────────────────────
// Navigation actions (xem menu, bấm nút) — cho phép nhiều hơn
const NAV_WINDOW_MS = 60_000; // 1 phút
const NAV_MAX_ACTIONS = 60; // 60 action/phút — rất thoải mái
// Heavy actions (tạo order, thanh toán, nạp tiền) — giới hạn chặt hơn
const HEAVY_WINDOW_MS = 60_000;
const HEAVY_MAX_ACTIONS = 10; // 10 action nặng/phút
// Patterns mà được coi là "heavy" — tiêu tốn tài nguyên DB/tài chính
const HEAVY_PATTERNS = [
    /^pay:/,
    /^deposit:amount:/,
    /^deposit:custom$/,
    /^order:cancel:/,
    /^admin:broadcast/,
    /^checkout/,
];
const navBuckets = new Map();
const heavyBuckets = new Map();
// Dọn dẹp bucket hết hạn mỗi 5 phút
setInterval(() => {
    const now = Date.now();
    for (const [key, bucket] of navBuckets) {
        if (bucket.resetAt <= now)
            navBuckets.delete(key);
    }
    for (const [key, bucket] of heavyBuckets) {
        if (bucket.resetAt <= now)
            heavyBuckets.delete(key);
    }
}, 5 * 60_000);
// ─── Helper ───────────────────────────────────────────────────────────────────
function isHeavyAction(callbackData) {
    if (!callbackData)
        return false;
    return HEAVY_PATTERNS.some(p => p.test(callbackData));
}
function checkBucket(buckets, userId, windowMs, maxActions) {
    const now = Date.now();
    let bucket = buckets.get(userId);
    if (!bucket || bucket.resetAt <= now) {
        bucket = { count: 0, resetAt: now + windowMs };
        buckets.set(userId, bucket);
    }
    bucket.count++;
    return bucket.count <= maxActions;
}
// ─── Middleware ────────────────────────────────────────────────────────────────
export const rateLimitMiddleware = async (ctx, next) => {
    const userId = ctx.from?.id?.toString();
    if (!userId)
        return next();
    const callbackData = ctx.callbackQuery && 'data' in ctx.callbackQuery
        ? ctx.callbackQuery.data
        : undefined;
    // Heavy action check
    if (isHeavyAction(callbackData)) {
        if (!checkBucket(heavyBuckets, userId, HEAVY_WINDOW_MS, HEAVY_MAX_ACTIONS)) {
            log.warn({ userId, action: callbackData }, 'Heavy rate limit exceeded');
            if (ctx.callbackQuery) {
                await ctx.answerCbQuery('⏳ Bạn thao tác quá nhanh! Đợi một chút rồi thử lại.', { show_alert: true });
            }
            return;
        }
    }
    // General nav check
    if (!checkBucket(navBuckets, userId, NAV_WINDOW_MS, NAV_MAX_ACTIONS)) {
        log.warn({ userId, count: navBuckets.get(userId)?.count }, 'Nav rate limit exceeded');
        if (ctx.callbackQuery) {
            await ctx.answerCbQuery('⏳ Bạn bấm quá nhanh! Đợi một chút.', { show_alert: true });
        }
        return;
    }
    return next();
};
