/**
 * VietQR Payment Provider
 * 
 * Tạo QR chuyển khoản tự động với IPN webhook
 * Hỗ trợ: Casso, SePay, hoặc bank API trực tiếp
 */

import { getBankConfigSync, getOrderExpireMinutesSync } from "../shop-config.js";

// Bank config đọc động từ shop-config (DB → fallback env). Dùng sync getter
// vì cache đã được warm lúc startup; nếu chưa warm thì tự fallback về env.
function bankConfig() {
    return getBankConfigSync();
}

// SePay config
const SEPAY_CONFIG = {
    merchantId: process.env.SEPAY_MERCHANT_ID || "",
    secretKey: process.env.SEPAY_SECRET_KEY || "",
};

function escapeHtml(value = "") {
    return String(value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

// Order expiration time mặc định (phút) — fallback khi DB chưa cấu hình.
export const ORDER_EXPIRE_MINUTES = 10;

function expireMinutes() {
    return getOrderExpireMinutesSync() || ORDER_EXPIRE_MINUTES;
}

/**
 * Generate VietQR URL with amount
 */
export function generateQRUrl(amount, content) {
    const { bankCode, accountNumber, accountName } = bankConfig();

    // VietQR compact format with amount and content
    const qrUrl = `https://img.vietqr.io/image/${bankCode}-${accountNumber}-compact2.png?amount=${amount}&addInfo=${encodeURIComponent(content)}&accountName=${encodeURIComponent(accountName)}`;

    return qrUrl;
}

/**
 * Generate unique transfer content for order
 */
export function generateTransferContent(orderId) {
    // Short format: SHOP + last 8 chars of order ID
    const shortId = orderId.slice(-8).toUpperCase();
    return `SHOP${shortId}`;
}

/**
 * Create checkout with VietQR
 */
export async function createVietQRCheckout({ orderId, amount, productName, quantity }) {
    const transferContent = generateTransferContent(orderId);
    const qrUrl = generateQRUrl(amount, transferContent);
    const bank = bankConfig();

    const expiresAt = new Date(Date.now() + expireMinutes() * 60 * 1000);

    return {
        qrUrl,
        transferContent,
        amount,
        expiresAt,
        bankInfo: {
            bankName: bank.bankName,
            bankCode: bank.bankCode,
            accountNumber: bank.accountNumber,
            accountName: bank.accountName,
        },
        productInfo: {
            name: productName,
            quantity,
            total: amount,
        },
    };
}

/**
 * Format payment message for Telegram
 */
export function formatPaymentMessage(checkout, lang = "vi") {
    const { bankInfo, productInfo, transferContent, amount, expiresAt } = checkout;

    const money = amount.toLocaleString("vi-VN") + "đ";
    const remainMs = new Date(expiresAt) - Date.now();
    const remainMin = Math.max(1, Math.ceil(remainMs / 60000));

    const DIVIDER = "─────────────────────";
    const productLine = productInfo?.name
        ? `🛒 Sản phẩm: <b>${escapeHtml(productInfo.name)}</b>${productInfo.quantity > 1 ? ` x${productInfo.quantity}` : ""}\n`
        : "";

    return `🏦 <b>Thanh toán đơn hàng</b>\n${DIVIDER}\n`
        + productLine
        + `💰 Số tiền: <b>${money}</b>\n`
        + `📝 Nội dung CK: <code>${escapeHtml(transferContent)}</code>\n\n`
        + `⚠️ Chuyển đúng số tiền và đúng nội dung. Hết hạn sau <b>${remainMin} phút</b>.`;
}

/**
 * Verify IPN webhook from payment gateway
 * Supports: Casso, SePay, or custom webhook
 */
export function verifyIPNWebhook(req, provider = "casso") {
    const signature = req.headers["signature"]
        || req.headers["x-signature"]
        || req.headers["secure-token"]
        || req.headers["x-api-key"];
    const expectedToken = process.env.THUEAPIBANK_WEBHOOK_SIGNATURE
        || process.env.IPN_SECRET_TOKEN;

    if (!expectedToken) {
        console.warn("IPN_SECRET_TOKEN not set, skipping signature verification");
        return true;
    }

    if (signature !== expectedToken) {
        throw new Error("Invalid IPN signature");
    }

    return true;
}

/**
 * Parse IPN data to extract order info
 * Different formats for different providers
 */
export function parseIPNItems(body, provider = "casso") {
    if (Array.isArray(body?.transactions) && body.transactions.length) {
        return body.transactions
            .filter((item) => String(item.type || "").toUpperCase() !== "OUT")
            .map((item) => ({
                amount: Number(item.amount || item.creditAmount || 0),
                content: item.description || item.content || item.memo || "",
                transactionId: item.transactionID || item.transactionId || item.tranId || item.refNo || item.id || "",
                when: item.transactionDate || item.postingDate || item.when || item.date || null,
            }));
    }

    if (Array.isArray(body?.TranList) && body.TranList.length) {
        return body.TranList
            .filter((item) => Number(item.creditAmount || item.amount || 0) > 0)
            .map((item) => ({
                amount: Number(item.creditAmount || item.amount || 0),
                content: item.description || item.content || item.memo || "",
                transactionId: item.tranId || item.refNo || item.id || "",
                when: item.transactionDate || item.postingDate || item.when || item.date || null,
            }));
    }

    if (provider === "casso") {
        const items = Array.isArray(body.data) ? body.data : [body.data || body];
        return items.filter(Boolean).map((item) => ({
            amount: Number(item.amount || item.creditAmount || 0),
            content: item.description || item.content || item.memo || "",
            transactionId: item.tid || item.id || item.tranId || "",
            when: item.when || item.transactionDate || item.date || null,
        }));
    }

    if (provider === "sepay") {
        return [{
            amount: Number(body.transferAmount || body.amount || 0),
            content: body.content || body.description || "",
            transactionId: body.referenceCode || body.transactionId || body.id || "",
            when: body.transactionDate || body.when || body.date || null,
        }];
    }

    return [{
        amount: Number(body.amount || body.creditAmount || 0),
        content: body.content || body.description || body.memo || "",
        transactionId: body.transactionId || body.id || body.tranId || body.refNo || "",
        when: body.when || body.date || body.transactionDate || body.postingDate || null,
    }];
}

export function parseIPNData(body, provider = "casso") {
    return parseIPNItems(body, provider)[0] || {
        amount: 0,
        content: "",
        transactionId: "",
        when: null,
    };
}

/**
/**
 * Extract order ID from transfer content.
 * Yêu cầu chính xác prefix SHOP{shortId} để tránh false-match.
 */
export function extractOrderIdFromContent(content, orderId) {
    if (!content) return null;

    const upperContent = content.toUpperCase().replace(/\s+/g, "");
    const shortId = orderId.slice(-8).toUpperCase();

    if (upperContent.includes(`SHOP${shortId}`)) {
        return orderId;
    }

    return null;
}

/**
 * Check if order is expired
 */
export function isOrderExpired(createdAt) {
    const expireTime = expireMinutes() * 60 * 1000;
    return Date.now() - new Date(createdAt).getTime() > expireTime;
}

export default {
    generateQRUrl,
    generateTransferContent,
    createVietQRCheckout,
    formatPaymentMessage,
    parseIPNItems,
    verifyIPNWebhook,
    parseIPNData,
    extractOrderIdFromContent,
    isOrderExpired,
    ORDER_EXPIRE_MINUTES,
};
