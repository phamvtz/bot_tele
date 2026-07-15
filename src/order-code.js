export const ORDER_CODE_LENGTH = 8;

export function formatOrderCode(orderId) {
    const value = String(orderId || "").trim();
    if (!value) return "";
    return value.slice(-ORDER_CODE_LENGTH).toUpperCase();
}
