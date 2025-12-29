/**
 * MoMo Payment Provider
 * 
 * Note: This is a template. You need to register with MoMo to get real credentials.
 */

import crypto from "crypto";

export function createMoMoProvider() {
    const config = {
        accessKey: process.env.MOMO_ACCESS_KEY || "",
        secretKey: process.env.MOMO_SECRET_KEY || "",
        partnerCode: process.env.MOMO_PARTNER_CODE || "",
        endpoint: process.env.MOMO_ENDPOINT || "https://test-payment.momo.vn/v2/gateway/api/create",
        redirectUrl: `${process.env.BASE_URL}/payment/momo/return`,
        ipnUrl: `${process.env.BASE_URL}/payment/momo/ipn`,
    };

    return {
        name: "momo",

        async createCheckout({ orderId, amount, currency, productName, quantity }) {
            const requestId = `${orderId}_${Date.now()}`;
            const orderInfo = `Thanh toan ${productName} x${quantity}`;
            const extraData = Buffer.from(JSON.stringify({ orderId })).toString("base64");

            const rawSignature = [
                `accessKey=${config.accessKey}`,
                `amount=${amount}`,
                `extraData=${extraData}`,
                `ipnUrl=${config.ipnUrl}`,
                `orderId=${orderId}`,
                `orderInfo=${orderInfo}`,
                `partnerCode=${config.partnerCode}`,
                `redirectUrl=${config.redirectUrl}`,
                `requestId=${requestId}`,
                `requestType=payWithMethod`,
            ].join("&");

            const signature = crypto
                .createHmac("sha256", config.secretKey)
                .update(rawSignature)
                .digest("hex");

            const requestBody = {
                partnerCode: config.partnerCode,
                partnerName: "Shop Bot",
                storeId: "ShopBot",
                requestId,
                amount,
                orderId,
                orderInfo,
                redirectUrl: config.redirectUrl,
                ipnUrl: config.ipnUrl,
                lang: "vi",
                requestType: "payWithMethod",
                autoCapture: true,
                extraData,
                signature,
            };

            try {
                const response = await fetch(config.endpoint, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(requestBody),
                });

                const data = await response.json();

                if (data.resultCode !== 0) {
                    throw new Error(data.message || "MoMo error");
                }

                return { checkoutUrl: data.payUrl, paymentRef: orderId };
            } catch (error) {
                console.error("MoMo createCheckout error:", error);
                throw error;
            }
        },

        verifyWebhook(req) {
            const { signature, ...params } = req.body;

            // Verify signature
            const rawSignature = [
                `accessKey=${config.accessKey}`,
                `amount=${params.amount}`,
                `extraData=${params.extraData}`,
                `message=${params.message}`,
                `orderId=${params.orderId}`,
                `orderInfo=${params.orderInfo}`,
                `orderType=${params.orderType}`,
                `partnerCode=${params.partnerCode}`,
                `payType=${params.payType}`,
                `requestId=${params.requestId}`,
                `responseTime=${params.responseTime}`,
                `resultCode=${params.resultCode}`,
                `transId=${params.transId}`,
            ].join("&");

            const expectedSignature = crypto
                .createHmac("sha256", config.secretKey)
                .update(rawSignature)
                .digest("hex");

            if (signature !== expectedSignature) {
                throw new Error("Invalid signature");
            }

            // Decode extraData to get orderId
            const extraData = JSON.parse(
                Buffer.from(params.extraData, "base64").toString()
            );

            return {
                type: params.resultCode === 0 ? "payment.success" : "payment.failed",
                data: {
                    object: {
                        metadata: { orderId: extraData.orderId },
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
