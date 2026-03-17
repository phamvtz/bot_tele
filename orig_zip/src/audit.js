import { prisma } from "./db.js";

/**
 * Audit Log Module
 * Tracks all admin actions for security and accountability
 */

/**
 * Log an admin action
 */
export async function logAction(adminId, action, target = null, details = null) {
    try {
        await prisma.auditLog.create({
            data: {
                adminId: String(adminId),
                action,
                target,
                details: details ? JSON.stringify(details) : null,
            },
        });
    } catch (error) {
        console.error("Failed to log action:", error);
    }
}

/**
 * Get recent audit logs
 */
export async function getRecentLogs(limit = 50) {
    return await prisma.auditLog.findMany({
        orderBy: { createdAt: "desc" },
        take: limit,
    });
}

/**
 * Get logs by admin
 */
export async function getLogsByAdmin(adminId, limit = 50) {
    return await prisma.auditLog.findMany({
        where: { adminId: String(adminId) },
        orderBy: { createdAt: "desc" },
        take: limit,
    });
}

/**
 * Get logs by action type
 */
export async function getLogsByAction(action, limit = 50) {
    return await prisma.auditLog.findMany({
        where: { action },
        orderBy: { createdAt: "desc" },
        take: limit,
    });
}

/**
 * Format log for display
 */
export function formatLog(log) {
    const date = log.createdAt.toLocaleString("vi-VN", {
        day: "2-digit",
        month: "2-digit",
        hour: "2-digit",
        minute: "2-digit"
    });

    const actionEmoji = {
        "ADD_PRODUCT": "➕",
        "EDIT_PRODUCT": "✏️",
        "DELETE_PRODUCT": "🗑️",
        "ADD_STOCK": "📦",
        "ADD_COUPON": "🎫",
        "TOGGLE_PRODUCT": "🔄",
        "CONFIRM_ORDER": "✅",
        "BROADCAST": "📢",
        "BACKUP": "💾",
        "SET_VIP": "👑",
    };

    const emoji = actionEmoji[log.action] || "📝";
    return `${emoji} ${date} | ${log.action} | ${log.target || "-"}`;
}

/**
 * Action types
 */
export const Actions = {
    ADD_PRODUCT: "ADD_PRODUCT",
    EDIT_PRODUCT: "EDIT_PRODUCT",
    DELETE_PRODUCT: "DELETE_PRODUCT",
    ADD_STOCK: "ADD_STOCK",
    ADD_COUPON: "ADD_COUPON",
    TOGGLE_PRODUCT: "TOGGLE_PRODUCT",
    CONFIRM_ORDER: "CONFIRM_ORDER",
    BROADCAST: "BROADCAST",
    BACKUP: "BACKUP",
    SET_VIP: "SET_VIP",
    CHANGE_PRICE: "CHANGE_PRICE",
    CHANGE_PAYLOAD: "CHANGE_PAYLOAD",
};

export default {
    logAction,
    getRecentLogs,
    getLogsByAdmin,
    getLogsByAction,
    formatLog,
    Actions,
};
