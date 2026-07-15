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
