/**
 * Rate Limiter Module
 * Prevents spam by limiting requests per user
 */

const userRequests = new Map();

const config = {
    windowMs: 60000, // 1 minute window
    maxRequests: 30, // max requests per window
    blockDuration: 60000, // block for 1 minute if exceeded
};

/**
 * Check if user is rate limited
 * @param {string} odelegramId - Telegram user ID
 * @returns {{ limited: boolean, retryAfter?: number }}
 */
export function checkRateLimit(telegramId) {
    const now = Date.now();
    const userId = String(telegramId);

    let userData = userRequests.get(userId);

    if (!userData) {
        userData = { requests: [], blockedUntil: 0 };
        userRequests.set(userId, userData);
    }

    // Check if blocked
    if (userData.blockedUntil > now) {
        return {
            limited: true,
            retryAfter: Math.ceil((userData.blockedUntil - now) / 1000)
        };
    }

    // Clean old requests
    userData.requests = userData.requests.filter(
        (time) => now - time < config.windowMs
    );

    // Check limit
    if (userData.requests.length >= config.maxRequests) {
        userData.blockedUntil = now + config.blockDuration;
        return {
            limited: true,
            retryAfter: Math.ceil(config.blockDuration / 1000)
        };
    }

    // Add request
    userData.requests.push(now);

    return { limited: false };
}

/**
 * Rate limit middleware for Telegraf
 */
export function rateLimitMiddleware() {
    return async (ctx, next) => {
        if (!ctx.from) return next();

        const result = checkRateLimit(ctx.from.id);

        if (result.limited) {
            // Import t dynamically to avoid circular dependency
            const { t } = await import("./i18n/index.js");
            const lang = ctx.session?.language || "vi";

            return ctx.reply(t("rateLimited", lang, { seconds: result.retryAfter }));
        }

        return next();
    };
}

/**
 * Clear rate limit data for a user
 */
export function clearRateLimit(telegramId) {
    userRequests.delete(String(telegramId));
}

/**
 * Clean up expired entries periodically
 */
setInterval(() => {
    const now = Date.now();
    for (const [userId, data] of userRequests.entries()) {
        if (data.requests.length === 0 && data.blockedUntil < now) {
            userRequests.delete(userId);
        }
    }
}, 300000); // Clean every 5 minutes

export default { checkRateLimit, rateLimitMiddleware, clearRateLimit };
