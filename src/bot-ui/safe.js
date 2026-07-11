/**
 * Helpers an toàn cho Telegraf — không bao giờ throw lên trên,
 * tự xử lý lỗi network/Telegram phổ biến (429, "not modified", "message to edit not found"...)
 */

const RETRY_ERRORS = [
    "ETIMEDOUT",
    "ECONNRESET",
    "ENOTFOUND",
    "ETELEGRAM: 429",
    "EFATAL",
];

const EDIT_FALLBACK_ERRORS = [
    "message to edit not found",
    "message can't be edited",
    "message is not a text message",
    "there is no text in the message",
    "message to delete not found",
];

function shouldRetry(error) {
    const msg = error?.message || error?.code || "";
    return RETRY_ERRORS.some((s) => String(msg).includes(s));
}

async function withRetry(fn, attempts = 2) {
    let lastErr;
    for (let i = 0; i <= attempts; i++) {
        try {
            return await fn();
        } catch (err) {
            lastErr = err;
            if (i === attempts || !shouldRetry(err)) throw err;
            // 429 → tôn trọng retry_after từ Telegram nếu có
            const retryAfter = err?.parameters?.retry_after;
            const wait = retryAfter ? retryAfter * 1000 : 250 * Math.pow(2, i);
            await new Promise((r) => setTimeout(r, wait));
        }
    }
    throw lastErr;
}

/**
 * Trả lời callback query ngay lập tức để Telegram không hiện loading spinner.
 * Có thể truyền text/extra để show alert.
 */
export function answerCallback(ctx, text = undefined, extra = undefined) {
    if (!ctx.callbackQuery) return;
    // Không await — fire and forget
    ctx.answerCbQuery(text, extra).catch(() => {});
}

/**
 * Edit message hiện tại nếu là callback, ngược lại reply.
 * Nếu Telegram trả "message is not modified" → bỏ qua.
 * Nếu lỗi khác (vd "no text in message") → xóa rồi reply mới.
 * Tự retry 2 lần với 429/network glitch.
 */
export async function safeEditOrReply(ctx, text, options = {}) {
    const payload = { parse_mode: "HTML", ...options };
    const sendFreshMessage = () => {
        if (ctx.chat?.id && ctx.telegram?.sendMessage) {
            return ctx.telegram.sendMessage(ctx.chat.id, text, payload);
        }
        return ctx.reply(text, payload);
    };

    try {
        return await withRetry(() => {
            if (ctx.callbackQuery) {
                return ctx.editMessageText(text, payload);
            }
            return ctx.reply(text, payload);
        });
    } catch (error) {
        const message = error?.message || "";
        if (message.includes("message is not modified")) return null;

        const shouldFallback = EDIT_FALLBACK_ERRORS.some((s) => message.includes(s));
        try {
            if (ctx.callbackQuery && shouldFallback) {
                await ctx.deleteMessage().catch(() => {});
            }
            return await withRetry(sendFreshMessage);
        } catch (fallbackError) {
            console.error("[safeEditOrReply] fallback reply failed:", fallbackError?.message || fallbackError);
            throw error;
        }
    }
}

/**
 * Gửi `chat action` (typing/upload) để user thấy bot đang xử lý.
 * Telegram tự xóa indicator sau ~5s nên không cần dọn.
 */
export function sendChatAction(ctx, action = "typing") {
    if (!ctx?.telegram || !ctx.chat?.id) return;
    ctx.telegram.sendChatAction(ctx.chat.id, action).catch(() => {});
}
