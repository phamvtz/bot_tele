/**
 * VietQR Payment Provider
 * 
 * Tạo QR chuyển khoản tự động với IPN webhook
 * Hỗ trợ: Casso, SePay, hoặc bank API trực tiếp
 */

const BANK_CONFIG = {
    bankCode: process.env.BANK_CODE || "MB",
    bankName: process.env.BANK_NAME || "MBBank",
    accountNumber: process.env.BANK_ACCOUNT || "321336",
    accountName: process.env.BANK_ACCOUNT_NAME || "PHAM VAN VIET",
};

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

// Order expiration time (10 minutes)
export const ORDER_EXPIRE_MINUTES = 10;

/**
 * Generate VietQR URL with amount
 */
export function generateQRUrl(amount, content) {
    const { bankCode, accountNumber, accountName } = BANK_CONFIG;

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

    const expiresAt = new Date(Date.now() + ORDER_EXPIRE_MINUTES * 60 * 1000);

    return {
        qrUrl,
        transferContent,
        amount,
        expiresAt,
        bankInfo: {
            bankName: BANK_CONFIG.bankName,
            bankCode: BANK_CONFIG.bankCode,
            accountNumber: BANK_CONFIG.accountNumber,
            accountName: BANK_CONFIG.accountName,
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

    const expireTime = Math.ceil((expiresAt - Date.now()) / 60000);

    const money = `${amount.toLocaleString("vi-VN")}đ`;

    return `🏦 <b>Thanh toán chuyển khoản</b>

━━━━━━━━━━━━━━
Sản phẩm: <b>${escapeHtml(productInfo.name)}</b>
Số lượng: <b>${productInfo.quantity}</b>
Tổng tiền: <b>${money}</b>

━━━━━━━━━━━━━━
Ngân hàng: <b>${escapeHtml(bankInfo.bankName)}</b>
Số TK: <code>${escapeHtml(bankInfo.accountNumber)}</code>
Chủ TK: <b>${escapeHtml(bankInfo.accountName)}</b>
Số tiền: <b>${money}</b>
Nội dung: <code>${escapeHtml(transferContent)}</code>

⚠️ <b>Lưu ý quan trọng</b>
Chuyển đúng số tiền và ghi đúng nội dung.
Đơn hết hạn sau <b>${expireTime} phút</b>.

Sau khi chuyển khoản, hệ thống sẽ tự xác nhận và giao hàng trong 1-3 phút.`;
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
 * Extract order ID from transfer content
 */
export function extractOrderIdFromContent(content, orderId) {
    if (!content) return null;

    const upperContent = content.toUpperCase().replace(/\s+/g, "");
    const shortId = orderId.slice(-8).toUpperCase();

    // Check if content contains order ID
    if (upperContent.includes(`SHOP${shortId}`) || upperContent.includes(shortId)) {
        return orderId;
    }

    return null;
}

/**
 * Check if order is expired
 */
export function isOrderExpired(createdAt) {
    const expireTime = ORDER_EXPIRE_MINUTES * 60 * 1000;
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
