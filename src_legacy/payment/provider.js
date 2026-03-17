/**
 * Payment Provider - VietQR Only
 * Simplified payment with bank transfer + IPN webhook
 */

import {
    createVietQRCheckout,
    formatPaymentMessage,
    ORDER_EXPIRE_MINUTES,
} from "./vietqr.js";

/**
 * Create checkout - VietQR only
 */
export async function createCheckout(params) {
    return await createVietQRCheckout(params);
}

/**
 * Format payment message
 */
export function getPaymentMessage(checkout, lang = "vi") {
    return formatPaymentMessage(checkout, lang);
}

/**
 * Get order expiration time in minutes
 */
export function getExpireMinutes() {
    return ORDER_EXPIRE_MINUTES;
}

export default {
    createCheckout,
    getPaymentMessage,
    getExpireMinutes,
};
