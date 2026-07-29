let cachedBotUsername = "";

export function buildProductDeepLink(botUsername, productId) {
    const username = String(botUsername || "").trim().replace(/^@/, "");
    const id = String(productId || "").trim();
    if (!username || !/^[A-Za-z0-9_]{5,32}$/.test(username)) return null;
    // Telegram start parameter is limited to 64 chars; "product_" uses 8.
    if (!id || !/^[A-Za-z0-9_-]{1,56}$/.test(id)) return null;
    return `https://t.me/${username}?start=product_${id}`;
}

export async function getProductDeepLink(telegram, productId) {
    if (!cachedBotUsername) {
        cachedBotUsername = String(process.env.TELEGRAM_BOT_USERNAME || "").trim().replace(/^@/, "");
    }
    if (!cachedBotUsername && telegram?.getMe) {
        try {
            const me = await telegram.getMe();
            cachedBotUsername = me?.username || "";
        } catch {}
    }
    return buildProductDeepLink(cachedBotUsername, productId);
}

// Deep link mở thẳng menu mua Claude API Key (?start=claudekey). Dùng cho thông báo
// đơn API — vì Claude Key không phải Product hiển thị nên không dùng product_<id>.
export function buildClaudeKeyDeepLink(botUsername) {
    const username = String(botUsername || "").trim().replace(/^@/, "");
    if (!username || !/^[A-Za-z0-9_]{5,32}$/.test(username)) return null;
    return `https://t.me/${username}?start=claudekey`;
}

export async function getClaudeKeyDeepLink(telegram) {
    if (!cachedBotUsername) {
        cachedBotUsername = String(process.env.TELEGRAM_BOT_USERNAME || "").trim().replace(/^@/, "");
    }
    if (!cachedBotUsername && telegram?.getMe) {
        try {
            const me = await telegram.getMe();
            cachedBotUsername = me?.username || "";
        } catch {}
    }
    return buildClaudeKeyDeepLink(cachedBotUsername);
}
