let cachedBotUsername = "";

function buildDeepLink(botUsername, prefix, value) {
    const username = String(botUsername || "").trim().replace(/^@/, "");
    const id = String(value || "").trim();
    if (!/^[A-Za-z0-9_]{5,32}$/.test(username)) return null;
    // Telegram start parameter tối đa 64 ký tự, chỉ nhận base64url alphabet.
    if (!/^[A-Za-z0-9_-]+$/.test(id) || prefix.length + id.length > 64) return null;
    return `https://t.me/${username}?start=${prefix}${id}`;
}

export function buildProductDeepLink(botUsername, productId) {
    return buildDeepLink(botUsername, "product_", productId);
}

export function buildFlashSaleDeepLink(botUsername, saleId) {
    return buildDeepLink(botUsername, "flash_", saleId);
}

async function getBotUsername(telegram) {
    if (!cachedBotUsername) {
        cachedBotUsername = String(process.env.TELEGRAM_BOT_USERNAME || "").trim().replace(/^@/, "");
    }
    if (!cachedBotUsername && telegram?.getMe) {
        try {
            const me = await telegram.getMe();
            cachedBotUsername = me?.username || "";
        } catch {}
    }
    return cachedBotUsername;
}

export async function getProductDeepLink(telegram, productId) {
    return buildProductDeepLink(await getBotUsername(telegram), productId);
}

export async function getFlashSaleDeepLink(telegram, saleId) {
    return buildFlashSaleDeepLink(await getBotUsername(telegram), saleId);
}
