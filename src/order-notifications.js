export const ORDER_NOTIFY_DISABLED_UNTIL = 8640000000000000;

export function getOrderNotificationMode(notifyMutedUntil, now = Date.now()) {
    const mutedUntil = Number(notifyMutedUntil || 0);
    if (!Number.isFinite(mutedUntil) || mutedUntil <= now) return "enabled";
    if (mutedUntil >= ORDER_NOTIFY_DISABLED_UNTIL) return "disabled";
    return "muted_24h";
}

export function getOrderNotificationMutedUntil(mode, now = Date.now()) {
    if (mode === "enabled") return null;
    if (mode === "muted_24h") return now + 24 * 60 * 60 * 1000;
    if (mode === "disabled") return ORDER_NOTIFY_DISABLED_UNTIL;
    throw new Error("Trạng thái thông báo đơn không hợp lệ");
}

export function isOrderNotificationMuted(notifyMutedUntil, now = Date.now()) {
    return getOrderNotificationMode(notifyMutedUntil, now) !== "enabled";
}
