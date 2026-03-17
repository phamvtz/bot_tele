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

    return `🏦 *THANH TOÁN CHUYỂN KHOẢN*

━━━━━━━━━━━━━━━━━
📦 *Sản phẩm:* ${productInfo.name}
📊 *Số lượng:* ${productInfo.quantity}
💰 *Tổng tiền:* ${amount.toLocaleString()}đ
━━━━━━━━━━━━━━━━━

🏦 *Ngân hàng:* ${bankInfo.bankName}
🔢 *Số TK:* \`${bankInfo.accountNumber}\`
👤 *Chủ TK:* ${bankInfo.accountName}
💵 *Số tiền:* ${amount.toLocaleString()}đ
📝 *Nội dung:* \`${transferContent}\`

━━━━━━━━━━━━━━━━━
⚠️ *LƯU Ý QUAN TRỌNG:*
• Chuyển *ĐÚNG SỐ TIỀN*
• Ghi *ĐÚNG NỘI DUNG*
• Đơn hết hạn sau *${expireTime} phút*

✅ Sau khi chuyển khoản, đơn hàng sẽ được xử lý *TỰ ĐỘNG* trong 1-3 phút.`;
}

/**
 * Verify IPN webhook from payment gateway
 * Supports: Casso, SePay, or custom webhook
 */
export function verifyIPNWebhook(req, provider = "casso") {
    const signature = req.headers["secure-token"] || req.headers["x-api-key"];
    const expectedToken = process.env.IPN_SECRET_TOKEN;

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
export function parseIPNData(body, provider = "casso") {
    let amount, content, transactionId, when;

    if (provider === "casso") {
        // Casso format
        const data = body.data?.[0] || body;
        amount = data.amount;
        content = data.description || data.content;
        transactionId = data.tid || data.id;
        when = data.when;
    } else if (provider === "sepay") {
        // SePay format
        amount = body.transferAmount;
        content = body.content;
        transactionId = body.referenceCode;
        when = body.transactionDate;
    } else {
        // Generic format
        amount = body.amount;
        content = body.content || body.description || body.memo;
        transactionId = body.transactionId || body.id;
        when = body.when || body.date;
    }

    return { amount, content, transactionId, when };
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
    verifyIPNWebhook,
    parseIPNData,
    extractOrderIdFromContent,
    isOrderExpired,
    ORDER_EXPIRE_MINUTES,
};
