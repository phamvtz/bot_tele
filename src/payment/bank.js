/**
 * Bank Transfer Payment Provider
 * 
 * Generates QR code and bank transfer info for manual payment
 */

import { prisma } from "../db.js";

export function createBankProvider() {
    const config = {
        bankName: process.env.BANK_NAME || "Vietcombank",
        bankCode: process.env.BANK_CODE || "VCB",
        accountNumber: process.env.BANK_ACCOUNT || "1234567890",
        accountName: process.env.BANK_ACCOUNT_NAME || "NGUYEN VAN A",
    };

    return {
        name: "bank",

        async createCheckout({ orderId, amount, currency, productName, quantity }) {
            // Generate transfer content
            const transferContent = `SHOPBOT ${orderId.slice(-8).toUpperCase()}`;

            // VietQR format URL for QR code
            const qrUrl = `https://img.vietqr.io/image/${config.bankCode}-${config.accountNumber}-compact.png?amount=${amount}&addInfo=${encodeURIComponent(transferContent)}&accountName=${encodeURIComponent(config.accountName)}`;

            // Store payment info in order
            const paymentInfo = {
                bank: config.bankName,
                accountNumber: config.accountNumber,
                accountName: config.accountName,
                amount,
                content: transferContent,
                qrUrl,
            };

            // Return special URL that bot will handle
            return {
                checkoutUrl: `bank://${orderId}`,
                paymentRef: orderId,
                paymentInfo,
            };
        },

        // Bank transfer needs manual confirmation by admin
        verifyWebhook(req) {
            // This is called when admin confirms payment
            const { orderId, transactionId } = req.body;

            return {
                type: "payment.success",
                data: {
                    object: {
                        metadata: { orderId },
                        transactionId,
                    },
                },
            };
        },

        getOrderIdFromEvent(event) {
            return event.data.object.metadata?.orderId || null;
        },

        isPaymentSuccess(event) {
            return event.type === "payment.success";
        },

        // Generate bank transfer message for Telegram
        getBankTransferMessage(paymentInfo, lang = "vi") {
            if (lang === "en") {
                return `🏦 *Bank Transfer*\n\n` +
                    `Bank: ${paymentInfo.bank}\n` +
                    `Account: \`${paymentInfo.accountNumber}\`\n` +
                    `Name: ${paymentInfo.accountName}\n` +
                    `Amount: ${formatCurrency(paymentInfo.amount)}\n` +
                    `Content: \`${paymentInfo.content}\`\n\n` +
                    `⚠️ *Important:* Use exact content!\n` +
                    `After transfer, admin will confirm within 5-15 mins.`;
            }

            return `🏦 *Chuyển khoản ngân hàng*\n\n` +
                `Ngân hàng: ${paymentInfo.bank}\n` +
                `Số TK: \`${paymentInfo.accountNumber}\`\n` +
                `Tên TK: ${paymentInfo.accountName}\n` +
                `Số tiền: ${formatCurrency(paymentInfo.amount)}\n` +
                `Nội dung: \`${paymentInfo.content}\`\n\n` +
                `⚠️ *Lưu ý:* Ghi đúng nội dung chuyển khoản!\n` +
                `Sau khi chuyển, admin sẽ xác nhận trong 5-15 phút.`;
        },
    };
}

function formatCurrency(amount) {
    return new Intl.NumberFormat("vi-VN").format(amount) + "đ";
}
