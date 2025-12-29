/**
 * VNPay Payment Provider
 * 
 * Note: This is a template. You need to register with VNPay to get real credentials.
 */

import crypto from "crypto";
import querystring from "querystring";

export function createVNPayProvider() {
    const config = {
        vnp_TmnCode: process.env.VNPAY_TMN_CODE || "",
        vnp_HashSecret: process.env.VNPAY_HASH_SECRET || "",
        vnp_Url: process.env.VNPAY_URL || "https://sandbox.vnpayment.vn/paymentv2/vpcpay.html",
        vnp_ReturnUrl: `${process.env.BASE_URL}/payment/vnpay/return`,
    };

    return {
        name: "vnpay",

        async createCheckout({ orderId, amount, currency, productName, quantity }) {
            const date = new Date();
            const createDate = formatDate(date);
            const expireDate = formatDate(new Date(date.getTime() + 15 * 60 * 1000));

            const vnp_Params = {
                vnp_Version: "2.1.0",
                vnp_Command: "pay",
                vnp_TmnCode: config.vnp_TmnCode,
                vnp_Locale: "vn",
                vnp_CurrCode: "VND",
                vnp_TxnRef: orderId,
                vnp_OrderInfo: `Thanh toan ${productName} x${quantity}`,
                vnp_OrderType: "other",
                vnp_Amount: amount * 100, // VNPay uses smallest unit * 100
                vnp_ReturnUrl: config.vnp_ReturnUrl,
                vnp_IpAddr: "127.0.0.1",
                vnp_CreateDate: createDate,
                vnp_ExpireDate: expireDate,
            };

            // Sort params
            const sortedParams = sortObject(vnp_Params);

            // Create signature
            const signData = querystring.stringify(sortedParams, { encode: false });
            const hmac = crypto.createHmac("sha512", config.vnp_HashSecret);
            const signed = hmac.update(Buffer.from(signData, "utf-8")).digest("hex");

            sortedParams.vnp_SecureHash = signed;

            const checkoutUrl = `${config.vnp_Url}?${querystring.stringify(sortedParams, { encode: false })}`;

            return { checkoutUrl, paymentRef: orderId };
        },

        verifyWebhook(req) {
            const vnp_Params = { ...req.query };
            const secureHash = vnp_Params.vnp_SecureHash;

            delete vnp_Params.vnp_SecureHash;
            delete vnp_Params.vnp_SecureHashType;

            const sortedParams = sortObject(vnp_Params);
            const signData = querystring.stringify(sortedParams, { encode: false });
            const hmac = crypto.createHmac("sha512", config.vnp_HashSecret);
            const signed = hmac.update(Buffer.from(signData, "utf-8")).digest("hex");

            if (secureHash !== signed) {
                throw new Error("Invalid signature");
            }

            return {
                type: "payment.success",
                data: {
                    object: {
                        metadata: { orderId: vnp_Params.vnp_TxnRef },
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
    };
}

function sortObject(obj) {
    const sorted = {};
    const keys = Object.keys(obj).sort();
    for (const key of keys) {
        sorted[key] = obj[key];
    }
    return sorted;
}

function formatDate(date) {
    const pad = (n) => String(n).padStart(2, "0");
    return (
        date.getFullYear().toString() +
        pad(date.getMonth() + 1) +
        pad(date.getDate()) +
        pad(date.getHours()) +
        pad(date.getMinutes()) +
        pad(date.getSeconds())
    );
}
