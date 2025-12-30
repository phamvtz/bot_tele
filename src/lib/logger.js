
const LOG_BOT_TOKEN = process.env.LOG_BOT_TOKEN;
const LOG_CHANNEL_ID = process.env.LOG_CHANNEL_ID || process.env.ADMIN_IDS?.split(",")[0];

// Simple async logger that doesn't block main flow
export const sendLog = (type, message) => {
    if (!LOG_BOT_TOKEN || !LOG_CHANNEL_ID) {
        // Silent fail if not configured, to not break app
        // console.log("[LOGGER SKIP]", type, message);
        return;
    }

    const typeEmojis = {
        ORDER: "🛒",
        DEPOSIT: "💰",
        ERROR: "❌",
        SYSTEM: "⚙️",
        SPAM: "⚠️"
    };

    const emoji = typeEmojis[type] || "📝";
    const fullMessage = `${emoji} *[${type}]* ${new Date().toLocaleTimeString("vi-VN")}\n${message}`;

    // Use https.request for zero-dependency lightweight request
    // or just fetch if node 18+

    const url = `https://api.telegram.org/bot${LOG_BOT_TOKEN}/sendMessage`;
    const body = JSON.stringify({
        chat_id: LOG_CHANNEL_ID,
        text: fullMessage,
        parse_mode: "Markdown"
    });

    fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: body
    }).catch(err => {
        console.error("LOG BOT ERROR:", err.message);
    });
};
