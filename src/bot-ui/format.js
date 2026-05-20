export const DIVIDER = "━━━━━━━━━━━━━━━━";

/**
 * Sync getter — đọc từ cache đã pre-warm.
 * Để hot-reload khi admin đổi tên shop, gọi invalidateMenuCache() trong menu-config.js.
 */
let _shopNameRef = null;
export function setShopNameRef(getter) { _shopNameRef = getter; }
export function getShopName() {
    if (typeof _shopNameRef === "function") {
        try { return _shopNameRef() || process.env.SHOP_NAME || "Shop Bot Tele"; } catch {}
    }
    return process.env.SHOP_NAME || process.env.BOT_SHOP_NAME || "Shop Bot Tele";
}

export function formatCurrency(amount = 0, currency = "VND") {
    const value = Number(amount || 0);
    if (currency === "VND") {
        return `${new Intl.NumberFormat("vi-VN").format(value)}đ`;
    }

    return new Intl.NumberFormat("vi-VN", {
        style: "currency",
        currency,
    }).format(value);
}

export function formatDateTime(date) {
    if (!date) return "Không rõ";
    return new Intl.DateTimeFormat("vi-VN", {
        timeZone: "Asia/Ho_Chi_Minh",
        hour: "2-digit",
        minute: "2-digit",
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
    }).format(new Date(date));
}

export function escapeHtml(value = "") {
    return String(value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

export function renderTelegramEmoji(icon = "📁", iconEmojiId = null) {
    const fallback = escapeHtml(icon || "📁");
    if (!iconEmojiId) return fallback;
    return `<tg-emoji emoji-id="${escapeHtml(iconEmojiId)}">${fallback}</tg-emoji>`;
}

export function truncateText(value = "", maxLength = 48) {
    const text = String(value || "").trim();
    if (text.length <= maxLength) return text;
    return `${text.slice(0, Math.max(0, maxLength - 1)).trim()}…`;
}

export function statusLabel(status) {
    const labels = {
        PENDING: "Đang chờ thanh toán",
        PAID: "Đã thanh toán",
        DELIVERED: "Đã giao hàng",
        CANCELED: "Đã hủy",
    };
    return labels[status] || status || "Không rõ";
}

export function stockLabel(product, stockCount) {
    if (!product) return "Không rõ";
    if (product.deliveryMode !== "STOCK_LINES") return "Còn hàng";
    if (stockCount <= 0) return "Hết hàng";
    return `Còn ${stockCount}`;
}
