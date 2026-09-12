
const LOG_BOT_TOKEN = process.env.LOG_BOT_TOKEN;
const LOG_CHANNEL_ID = process.env.LOG_CHANNEL_ID || process.env.ADMIN_IDS?.split(",")[0];

// Simple async logger that doesn't block main flow
export const sendLog = (type, message) => {
    if (!LOG_BOT_TOKEN || !LOG_CHANNEL_ID) {
        // Silent fail if not configured, to not break app
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

/**
 * Log một cảnh báo ĐÚNG MỘT LẦN mỗi `key` trong đời process.
 *
 * Các poller chạy mỗi 15s nên một cảnh báo lặp lại mỗi tick sẽ đè bẹp channel log và
 * admin học cách bỏ qua — đúng lúc đó thì cảnh báo thật bị nuốt. Một lần là đủ.
 */
const _warnedOnce = new Set();

export const warnOnce = (key, type, message) => {
    if (_warnedOnce.has(key)) return false;
    _warnedOnce.add(key);
    console.warn(`[warnOnce] ${key}: ${message}`);
    sendLog(type, message);
    return true;
};

/**
 * Trần quét KHÔNG ĐƯỢC im lặng.
 *
 * Một query có `take: N` mà trả về đúng N dòng nghĩa là có thể còn dữ liệu chưa được
 * xét — với poller thanh toán thì phần bị bỏ qua chính là đơn của khách đã chuyển
 * tiền. Im lặng ở đây đọc y như "đã quét hết", nên phải kêu.
 */
export const warnIfScanTruncated = (label, count, cap, where = "") => {
    if (!(Number(count) >= Number(cap))) return false;
    return warnOnce(
        `scan-cap:${label}`,
        "ERROR",
        `⚠️ Quét ${label} chạm trần ${cap} dòng${where ? ` (${where})` : ""} — có bản ghi CHƯA được xét. `
        + `Tồn đọng đang vượt khả năng quét mỗi tick; nâng trần hoặc kiểm tra vì sao đơn không được huỷ đúng hạn.`,
    );
};

/** Cho test: xoá trạng thái đã-cảnh-báo. */
export const resetWarnOnce = () => { _warnedOnce.clear(); };
