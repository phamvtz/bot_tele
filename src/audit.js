import { prisma } from "./db.js";
import { iconOf } from "./menu-config.js";

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

    const actionIconKey = {
        "ADD_PRODUCT": "ADMIN_ADD",
        "EDIT_PRODUCT": "ADMIN_EDIT",
        "DELETE_PRODUCT": "ADMIN_DELETE",
        "ADD_STOCK": "ADMIN_PRODUCTS",
        "ADD_COUPON": "ADMIN_COUPONS",
        "ADD_GIFTCODE": "ADMIN_GIFTCODES",
        "EDIT_GIFTCODE": "ADMIN_EDIT",
        "TOGGLE_GIFTCODE": "ADMIN_GIFTCODES",
        "DELETE_GIFTCODE": "ADMIN_DELETE",
        "TOGGLE_PRODUCT": "ADMIN_RESET",
        "CONFIRM_ORDER": "STATUS_SUCCESS",
        "BROADCAST": "ADMIN_BROADCAST",
        "BACKUP": "ADMIN_BACKUP",
        "SET_VIP": "ADMIN_VIP",
    };

    const emoji = iconOf(actionIconKey[log.action] || "ADMIN_NOTE");
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
    ADD_GIFTCODE: "ADD_GIFTCODE",
    EDIT_GIFTCODE: "EDIT_GIFTCODE",
    TOGGLE_GIFTCODE: "TOGGLE_GIFTCODE",
    DELETE_GIFTCODE: "DELETE_GIFTCODE",
    TOGGLE_PRODUCT: "TOGGLE_PRODUCT",
    CONFIRM_ORDER: "CONFIRM_ORDER",
    BROADCAST: "BROADCAST",
    BACKUP: "BACKUP",
    SET_VIP: "SET_VIP",
    CHANGE_PRICE: "CHANGE_PRICE",
    CHANGE_PAYLOAD: "CHANGE_PAYLOAD",
    CHANGE_DESC: "CHANGE_DESC",
};

export default {
    logAction,
    getRecentLogs,
    getLogsByAdmin,
    getLogsByAction,
    formatLog,
    Actions,
};
