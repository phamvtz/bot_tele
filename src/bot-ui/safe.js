export async function answerCallback(ctx, text = undefined, extra = undefined) {
    if (!ctx.callbackQuery) return;
    try {
        await ctx.answerCbQuery(text, extra);
    } catch {
        // Telegram callback may already be answered or expired.
    }
}

export async function safeEditOrReply(ctx, text, options = {}) {
    const payload = { parse_mode: "HTML", ...options };
    try {
        if (ctx.callbackQuery) {
            return await ctx.editMessageText(text, payload);
        }
        return await ctx.reply(text, payload);
    } catch (error) {
        const message = error?.message || "";
        if (message.includes("message is not modified")) return null;

        try {
            return await ctx.reply(text, payload);
        } catch {
            throw error;
        }
    }
}
