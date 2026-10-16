/**
 * Crypto Pay API Integration (Crypto Bot)
 * Official Documentation: https://help.send.tg/en/articles/10279948-crypto-pay-api
 * API Endpoints:
 *   Production: https://pay.crypt.bot/api
 *   Testnet:    https://testnet-pay.crypt.bot/api
 */

import crypto from "node:crypto";
import { getCryptoConfigSync, getOrderExpireMinutesSync, getCryptoPayConfigSync } from "../shop-config.js";
import { getUsdVndRate } from "./crypto.js";
import { escapeHtml } from "../bot-ui/format.js";
import { claimPaymentEvent, completePaymentEvent, SETTLED_ORDER_STATUSES } from "../lib/payment-events.js";
import { deliverOrder } from "../delivery.js";
import { confirmDeposit } from "../wallet.js";
import { sendLog } from "../lib/logger.js";

export const CRYPTOPAY_NETWORKS = {
    MAINNET: "https://pay.crypt.bot/api",
    TESTNET: "https://testnet-pay.crypt.bot/api",
};

export const DEFAULT_ASSET = "USDT";
export const DEFAULT_EXPIRE_MINUTES = 30;

/**
 * Lấy cấu hình runtime của Crypto Pay
 */
export function getCryptoPayConfig() {
    const shopCfg = getCryptoPayConfigSync?.() || {};
    const token = String(shopCfg.token || process.env.CRYPTOPAY_API_TOKEN || "").trim();
    const isTestnet = String(process.env.CRYPTOPAY_NETWORK || "").toLowerCase() === "testnet"
        || String(process.env.CRYPTOPAY_TESTNET || "").toLowerCase() === "true";
    const apiBase = String(shopCfg.apiBase || process.env.CRYPTOPAY_API_BASE || (isTestnet ? CRYPTOPAY_NETWORKS.TESTNET : CRYPTOPAY_NETWORKS.MAINNET))
        .trim().replace(/\/+$/, "");
    const asset = String(shopCfg.asset || process.env.CRYPTOPAY_ASSET || DEFAULT_ASSET).trim().toUpperCase();
    const enabled = shopCfg.enabled !== false && String(process.env.CRYPTOPAY_ENABLED || "true").toLowerCase() !== "false";
    const expireMinutes = Number(process.env.CRYPTOPAY_EXPIRE_MINUTES || getOrderExpireMinutesSync?.() || DEFAULT_EXPIRE_MINUTES);

    return {
        token,
        apiBase,
        asset,
        enabled,
        expireMinutes,
    };
}

/**
 * Kiểm tra xem Crypto Pay đã được cấu hình và bật hay chưa
 */
export function isCryptoPayConfigured() {
    const cfg = getCryptoPayConfig();
    return Boolean(cfg.token && cfg.enabled);
}

/**
 * Gọi request tới Crypto Pay API
 */
async function callCryptoPayApi(endpoint, { method = "GET", body = null, tokenOverride = null, timeoutMs = 12000 } = {}) {
    const cfg = getCryptoPayConfig();
    const token = tokenOverride || cfg.token;
    if (!token) {
        throw new Error("CRYPTOPAY_API_TOKEN is not configured");
    }

    const url = endpoint.startsWith("http") ? endpoint : `${cfg.apiBase}/${endpoint.replace(/^\//, "")}`;
    const headers = {
        "Crypto-Pay-API-Token": token,
        Accept: "application/json",
    };

    const options = {
        method,
        headers,
        signal: AbortSignal.timeout(timeoutMs),
    };

    if (body && (method === "POST" || method === "PUT" || method === "PATCH")) {
        headers["Content-Type"] = "application/json";
        options.body = JSON.stringify(body);
    }

    const response = await fetch(url, options);
    let data;
    try {
        data = await response.json();
    } catch {
        throw new Error(`Invalid JSON response from Crypto Pay API (HTTP ${response.status})`);
    }

    if (!response.ok || !data.ok) {
        const errorDetail = data?.error ? JSON.stringify(data.error) : `HTTP ${response.status}`;
        throw new Error(`Crypto Pay API Error: ${errorDetail}`);
    }

    return data.result;
}

/**
 * Lấy thông tin ứng dụng Crypto Pay (kiểm tra token)
 */
export async function getCryptoPayMe(tokenOverride = null) {
    return await callCryptoPayApi("getMe", { tokenOverride });
}

/**
 * Tạo hóa đơn thanh toán trên Crypto Bot
 * @param {Object} params
 * @param {string} [params.orderId] - Mã đơn hàng
 * @param {string} [params.depositId] - Mã nạp ví
 * @param {number|string} params.amount - Số tiền tài sản (ví dụ 1.50)
 * @param {string} [params.asset] - USDT, TON, BTC,...
 * @param {string} [params.description] - Mô tả hiển thị
 * @param {string} [params.hiddenMessage] - Tin nhắn hiện sau khi trả
 * @param {string} [params.paidBtnUrl] - URL nút sau khi thanh toán
 * @param {number} [params.expiresIn] - Thời hạn hóa đơn tính theo giây
 */
export async function createCryptoPayInvoice({
    orderId = null,
    depositId = null,
    amount,
    asset = null,
    description = "",
    hiddenMessage = "",
    paidBtnUrl = null,
    expiresIn = null,
} = {}) {
    const cfg = getCryptoPayConfig();
    const tokenAsset = asset || cfg.asset || DEFAULT_ASSET;
    const expiresSec = expiresIn || (cfg.expireMinutes * 60);

    const payload = orderId ? `order:${orderId}` : depositId ? `deposit:${depositId}` : "";

    const body = {
        asset: tokenAsset,
        amount: String(amount),
        description: description ? description.slice(0, 1024) : undefined,
        hidden_message: hiddenMessage ? hiddenMessage.slice(0, 2048) : undefined,
        payload: payload || undefined,
        expires_in: Math.max(60, Math.min(2678400, Number(expiresSec) || 1800)),
    };

    if (paidBtnUrl) {
        body.paid_btn_name = "openBot";
        body.paid_btn_url = paidBtnUrl;
    }

    return await callCryptoPayApi("createInvoice", {
        method: "POST",
        body,
    });
}

/**
 * Tra cứu danh sách hóa đơn theo ID hoặc trạng thái
 */
export async function getCryptoPayInvoices({ invoiceIds = null, status = null } = {}) {
    const params = new URLSearchParams();
    if (invoiceIds) {
        const ids = Array.isArray(invoiceIds) ? invoiceIds.join(",") : String(invoiceIds);
        params.set("invoice_ids", ids);
    }
    if (status) {
        params.set("status", status);
    }

    const endpoint = params.toString() ? `getInvoices?${params.toString()}` : "getInvoices";
    return await callCryptoPayApi(endpoint, { method: "GET" });
}

/**
 * Xóa/hủy hóa đơn
 */
export async function deleteCryptoPayInvoice(invoiceId) {
    return await callCryptoPayApi("deleteInvoice", {
        method: "POST",
        body: { invoice_id: Number(invoiceId) },
    });
}

/**
 * Xác thực chữ ký webhook từ Crypto Pay
 * Theo tài liệu Crypto Pay:
 * secret = SHA256(api_token)
 * signature = HMAC-SHA256(raw_request_body, secret)
 * Compare header 'crypto-pay-api-signature' với signature
 * @param {Buffer|string} rawBody - Raw body buffer hoặc string nhận từ Express
 * @param {string} signatureHeader - Header crypto-pay-api-signature
 * @param {string} [tokenOverride]
 * @returns {boolean}
 */
export function verifyCryptoPayWebhook(rawBody, signatureHeader, tokenOverride = null) {
    const cfg = getCryptoPayConfig();
    const token = tokenOverride || cfg.token;
    if (!token || !signatureHeader || !rawBody) return false;

    try {
        const secret = crypto.createHash("sha256").update(token).digest();
        const computedSignature = crypto.createHmac("sha256", secret)
            .update(Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(String(rawBody), "utf8"))
            .digest("hex");

        const computedBuf = Buffer.from(computedSignature, "hex");
        const receivedBuf = Buffer.from(String(signatureHeader).trim(), "hex");

        if (computedBuf.length !== receivedBuf.length) {
            return false;
        }

        return crypto.timingSafeEqual(computedBuf, receivedBuf);
    } catch (err) {
        console.error("Crypto Pay signature verification error:", err.message);
        return false;
    }
}

/**
 * Xử lý sự kiện invoice_paid (từ Webhook, Nút kiểm tra, hoặc Polling đối soát)
 * Đảm bảo Idempotency tuyệt đối bằng claimPaymentEvent.
 */
export async function processCryptoPayInvoicePaid({
    invoice,
    prisma,
    telegram = null,
    deliverOrderFn = null,
    confirmDepositFn = null,
}) {
    if (!invoice || !invoice.invoice_id) {
        return { success: false, error: "Invalid invoice data" };
    }

    if (invoice.status && String(invoice.status).toLowerCase() !== "paid") {
        return { success: false, error: `Invoice is not in paid status (${invoice.status})` };
    }

    const cfg = getCryptoPayConfig();
    const invoiceId = String(invoice.invoice_id);
    const eventKey = `CRYPTOPAY:INVOICE:${invoiceId}`;
    const payloadStr = String(invoice.payload || "").trim();

    let isOrder = payloadStr.startsWith("order:");
    let isDeposit = payloadStr.startsWith("deposit:");
    let targetId = "";
    let payloadTelegramId = null;

    if (isOrder) {
        targetId = payloadStr.replace(/^order:/, "").trim();
    } else if (isDeposit) {
        targetId = payloadStr.replace(/^deposit:/, "").trim();
    } else if (payloadStr.startsWith("{")) {
        try {
            const data = JSON.parse(payloadStr);
            if (data.kind === "ORDER" || data.orderId) {
                isOrder = true;
                targetId = String(data.orderId || data.targetId || "").trim();
            } else if (data.kind === "DEPOSIT" || data.txId || data.depositId) {
                isDeposit = true;
                targetId = String(data.txId || data.depositId || data.targetId || "").trim();
            }
            if (data.telegramId) payloadTelegramId = String(data.telegramId);
        } catch {
            // Ignore JSON parse error, fallback below
        }
    }

    if (!targetId) {
        // Fallback: Tìm theo paymentRef lưu lúc tạo hóa đơn
        const [matchedOrder, matchedTx] = await Promise.all([
            prisma.order.findFirst?.({ where: { paymentRef: eventKey } })
                || prisma.order.findMany?.({ where: { paymentRef: eventKey }, take: 1 }).then((res) => res?.[0] || null),
            prisma.walletTransaction.findFirst?.({ where: { paymentRef: eventKey } })
                || prisma.walletTransaction.findMany?.({ where: { paymentRef: eventKey }, take: 1 }).then((res) => res?.[0] || null),
        ]);
        if (matchedOrder) {
            isOrder = true;
            targetId = matchedOrder.id;
        } else if (matchedTx) {
            isDeposit = true;
            targetId = matchedTx.id;
        }
    }

    if (!targetId) {
        sendLog("ERROR", `⚠️ Crypto Pay: Không tìm thấy đơn hàng hay giao dịch ví cho invoice #${invoiceId}`);
        return { success: false, error: "Target order/deposit not found" };
    }

    // --- 1. XỬ LÝ ĐƠN HÀNG SẢN PHẨM ---
    if (isOrder) {
        const order = await prisma.order.findUnique({
            where: { id: targetId },
            include: { product: true },
        });

        if (!order) {
            return { success: false, error: `Order ${targetId} not found` };
        }

        // Kiểm tra người sở hữu nếu có thông tin đối chiếu
        if (payloadTelegramId) {
            const orderUser = String(order.telegramId || order.chatId || order.userId || "");
            if (orderUser && orderUser !== payloadTelegramId) {
                return { success: false, reason: `Telegram ID mismatch: expected ${orderUser}, got ${payloadTelegramId}` };
            }
        }

        // Kiểm tra loại tài sản (USDT)
        if (invoice.asset && cfg.asset && invoice.asset.toUpperCase() !== cfg.asset.toUpperCase()) {
            return { success: false, error: `Asset mismatch: expected ${cfg.asset}, got ${invoice.asset}` };
        }

        // Kiểm tra số tiền nhận được
        if (order.cryptoAmount && Number(invoice.amount) < Number(order.cryptoAmount) - 0.001) {
            return { success: false, error: `Insufficient payment: received ${invoice.amount}, required ${order.cryptoAmount}` };
        }

        // Kiểm tra xem đơn đã được giải quyết chưa
        if (SETTLED_ORDER_STATUSES.includes(order.status) || order.status === "PAID" || order.status === "DELIVERING") {
            await completePaymentEvent(eventKey, { status: "PROCESSED" }, prisma).catch(() => {});
            return { success: true, alreadySettled: true, orderId: order.id };
        }

        // Khóa giao dịch chống xử lý lặp lại
        const claim = await claimPaymentEvent(eventKey, {
            kind: "CRYPTOPAY_ORDER",
            targetId: order.id,
            metadata: {
                invoiceId,
                amount: invoice.amount,
                asset: invoice.asset,
                paidAt: invoice.paid_at,
            },
        }, prisma);

        if (!claim.claimed) {
            if (claim.alreadyClaimed) {
                return { success: true, duplicate: true, orderId: order.id };
            }
            return { success: false, reason: "Already claimed or conflict" };
        }

        // Chuyển trạng thái đơn sang PAID
        const updated = await prisma.order.update({
            where: { id: order.id },
            data: {
                status: "PAID",
                paymentRef: eventKey,
            },
        });

        sendLog("ORDER", `✅ *ĐƠN HÀNG ĐÃ THANH TOÁN QUA CRYPTO BOT*\n📦 Mã đơn: \`${order.id}\`\n💵 Số tiền: ${invoice.amount} ${invoice.asset || "USDT"}\n🧾 Invoice ID: \`${invoiceId}\``);

        // Gọi logic giao hàng tự động
        const deliver = deliverOrderFn || deliverOrder;
        await deliver({
            prisma,
            telegram,
            order: updated,
        });

        // Gửi thông báo tới người mua trên Telegram
        try {
            if (telegram && (order.chatId || order.telegramId)) {
                await telegram.sendMessage(
                    Number(order.chatId || order.telegramId),
                    `🎉 <b>Thanh toán thành công qua Crypto Bot!</b>\n`
                    + `─────────────────────\n`
                    + `📦 Đơn hàng: <b>${escapeHtml(order.product?.name || "Sản phẩm")}</b>\n`
                    + `🆔 Mã đơn: <code>${order.id.slice(-8).toUpperCase()}</code>\n`
                    + `💵 Số tiền đã trả: <b>${invoice.amount} ${invoice.asset || "USDT"}</b>\n\n`
                    + `✅ Sản phẩm của bạn đã được hệ thống kích hoạt / giao hàng!`,
                    { parse_mode: "HTML" }
                );
            }
        } catch (notifyErr) {
            console.warn("[cryptopay] Gửi tin thông báo đơn hàng cho khách thất bại:", notifyErr.message);
        }

        await completePaymentEvent(eventKey, { status: "PROCESSED" }, prisma).catch(() => {});
        return { success: true, orderId: order.id };
    }

    // --- 2. XỬ LÝ NẠP VÍ ---
    if (isDeposit) {
        const tx = await prisma.walletTransaction.findUnique({
            where: { id: targetId },
            include: { wallet: true },
        });

        if (!tx) {
            return { success: false, error: `Wallet transaction ${targetId} not found` };
        }

        if (payloadTelegramId) {
            const txUser = String(tx.wallet?.odelegramId || tx.telegramId || "");
            if (txUser && txUser !== payloadTelegramId) {
                return { success: false, reason: `Telegram ID mismatch: expected ${txUser}, got ${payloadTelegramId}` };
            }
        }

        // Kiểm tra loại tài sản
        if (invoice.asset && cfg.asset && invoice.asset.toUpperCase() !== cfg.asset.toUpperCase()) {
            return { success: false, error: `Asset mismatch: expected ${cfg.asset}, got ${invoice.asset}` };
        }

        // Kiểm tra số tiền nạp
        if (tx.cryptoAmount && Number(invoice.amount) < Number(tx.cryptoAmount) - 0.001) {
            return { success: false, error: `Insufficient deposit: received ${invoice.amount}, required ${tx.cryptoAmount}` };
        }

        if (tx.status === "SUCCESS") {
            await completePaymentEvent(eventKey, { status: "PROCESSED" }, prisma).catch(() => {});
            return { success: true, alreadySettled: true, transactionId: tx.id };
        }

        const claim = await claimPaymentEvent(eventKey, {
            kind: "CRYPTOPAY_DEPOSIT",
            targetId: tx.id,
            metadata: {
                invoiceId,
                amount: invoice.amount,
                asset: invoice.asset,
                paidAt: invoice.paid_at,
            },
        }, prisma);

        if (!claim.claimed) {
            if (claim.alreadyClaimed) {
                return { success: true, duplicate: true, transactionId: tx.id };
            }
            return { success: false, reason: "Already claimed or conflict" };
        }

        const confirm = confirmDepositFn || confirmDeposit;
        const confirmResult = await confirm(tx.id, eventKey);
        if (!confirmResult.success) {
            console.error("[cryptopay] confirmDeposit thất bại:", confirmResult.error);
            return { success: false, error: confirmResult.error };
        }

        sendLog("DEPOSIT", `✅ *NẠP VÍ QUA CRYPTO BOT THÀNH CÔNG*\n👤 User: \`${tx.wallet?.odelegramId}\`\n💵 Số tiền: ${invoice.amount} ${invoice.asset || "USDT"} (~${tx.amount.toLocaleString("vi-VN")}đ)\n🧾 Invoice ID: \`${invoiceId}\``);

        // Gửi thông báo tới người dùng
        try {
            if (telegram && tx.wallet?.odelegramId) {
                await telegram.sendMessage(
                    Number(tx.wallet.odelegramId),
                    `🎉 <b>Nạp tiền ví thành công qua Crypto Bot!</b>\n`
                    + `─────────────────────\n`
                    + `💵 Số tiền nạp: <b>${invoice.amount} ${invoice.asset || "USDT"}</b>\n`
                    + `💰 Số dư cộng vào ví: <b>+${tx.amount.toLocaleString("vi-VN")}đ</b>\n`
                    + `👛 Số dư ví hiện tại: <b>${confirmResult.newBalance.toLocaleString("vi-VN")}đ</b>`,
                    { parse_mode: "HTML" }
                );
            }
        } catch (notifyErr) {
            console.warn("[cryptopay] Gửi thông báo nạp ví cho user thất bại:", notifyErr.message);
        }

        await completePaymentEvent(eventKey, { status: "PROCESSED" }, prisma).catch(() => {});
        return { success: true, transactionId: tx.id, newBalance: confirmResult.newBalance };
    }

    return { success: false, error: "Unknown payload format" };
}

/**
 * Format tin nhắn hiển thị hóa đơn Crypto Pay khi mua hàng
 */
export function formatCryptoPayOrderMessage({ order, invoice, usdVndRate, productName = "", quantity = 1, lang = "vi" } = {}) {
    const remainMin = Math.max(1, Math.round((new Date(order.expiresAt) - Date.now()) / 60000));
    const asset = invoice.asset || "USDT";
    const amount = invoice.amount;
    const finalVnd = Number(order.finalAmount || 0).toLocaleString("vi-VN");

    if (lang === "en") {
        return `🤖 <b>Crypto Bot Invoice (#${escapeHtml(order.id.slice(-8).toUpperCase())})</b>\n`
            + `─────────────────────\n`
            + `🛒 Product: <b>${escapeHtml(productName || order.product?.name || "Product")}</b>${quantity > 1 ? ` x${quantity}` : ""}\n`
            + `💵 Amount: <b>${amount} ${asset}</b> (~ ${finalVnd} VND)\n`
            + `💱 Rate: 1 ${asset} ≈ ${Number(usdVndRate).toLocaleString("vi-VN")} VND\n`
            + `⏳ Expires in: <b>${remainMin} minutes</b>\n\n`
            + `📌 <i>Tap the button below to complete payment in @CryptoBot. Your product will be delivered automatically!</i>`;
    }

    if (lang === "zh") {
        return `🤖 <b>Crypto Bot 账单 (#${escapeHtml(order.id.slice(-8).toUpperCase())})</b>\n`
            + `─────────────────────\n`
            + `🛒 商品: <b>${escapeHtml(productName || order.product?.name || "商品")}</b>${quantity > 1 ? ` x${quantity}` : ""}\n`
            + `💵 金额: <b>${amount} ${asset}</b> (~ ${finalVnd} VND)\n`
            + `💱 汇率: 1 ${asset} ≈ ${Number(usdVndRate).toLocaleString("vi-VN")} VND\n`
            + `⏳ 有效期: <b>${remainMin} 分钟</b>\n\n`
            + `📌 <i>请点击下方按钮前往 @CryptoBot 完成支付，支付成功后系统将自动发货！</i>`;
    }

    return `🤖 <b>HÓA ĐƠN CRYPTO BOT (#${escapeHtml(order.id.slice(-8).toUpperCase())})</b>\n`
        + `─────────────────────\n`
        + `🛒 Sản phẩm: <b>${escapeHtml(productName || order.product?.name || "Sản phẩm")}</b>${quantity > 1 ? ` x${quantity}` : ""}\n`
        + `💵 Số tiền: <b>${amount} ${asset}</b> (~ ${finalVnd}đ)\n`
        + `💱 Tỷ giá quy đổi: <b>1 ${asset} ≈ ${Number(usdVndRate).toLocaleString("vi-VN")}đ</b>\n`
        + `⏳ Hạn thanh toán: <b>${remainMin} phút</b>\n\n`
        + `📌 <i>Nhấn vào nút "Thanh toán qua Crypto Bot" bên dưới để mở bot thanh toán. Sau khi chuyển tiền, hệ thống sẽ tự động giao hàng ngay lập tức!</i>`;
}

/**
 * Format tin nhắn hiển thị hóa đơn nạp ví Crypto Pay
 */
export function formatCryptoPayDepositMessage({ tx, invoice, usdVndRate, lang = "vi" } = {}) {
    const remainMin = Math.max(1, Math.round((new Date(tx.expiresAt) - Date.now()) / 60000));
    const asset = invoice.asset || "USDT";
    const amount = invoice.amount;
    const creditVnd = Number(tx.amount || 0).toLocaleString("vi-VN");

    if (lang === "en") {
        return `🤖 <b>Top Up via Crypto Bot (#${escapeHtml(tx.id.slice(-8).toUpperCase())})</b>\n`
            + `─────────────────────\n`
            + `💵 Deposit Amount: <b>${amount} ${asset}</b>\n`
            + `💰 Wallet Credit: <b>+${creditVnd} VND</b>\n`
            + `💱 Rate: 1 ${asset} ≈ ${Number(usdVndRate).toLocaleString("vi-VN")} VND\n`
            + `⏳ Expires in: <b>${remainMin} minutes</b>\n\n`
            + `📌 <i>Tap the button below to pay via @CryptoBot. Your balance will be credited instantly upon confirmation!</i>`;
    }

    if (lang === "zh") {
        return `🤖 <b>通过 Crypto Bot 充值 (#${escapeHtml(tx.id.slice(-8).toUpperCase())})</b>\n`
            + `─────────────────────\n`
            + `💵 充值金额: <b>${amount} ${asset}</b>\n`
            + `💰 充值到账: <b>+${creditVnd} VND</b>\n`
            + `💱 汇率: 1 ${asset} ≈ ${Number(usdVndRate).toLocaleString("vi-VN")} VND\n`
            + `⏳ 有效期: <b>${remainMin} 分钟</b>\n\n`
            + `📌 <i>请点击下方按钮前往 @CryptoBot 完成支付，支付成功后系统将自动为您的钱包入账！</i>`;
    }

    return `🤖 <b>NẠP VÍ QUA CRYPTO BOT (#${escapeHtml(tx.id.slice(-8).toUpperCase())})</b>\n`
        + `─────────────────────\n`
        + `💵 Số tiền nạp: <b>${amount} ${asset}</b>\n`
        + `💰 Số dư cộng ví: <b>+${creditVnd}đ</b>\n`
        + `💱 Tỷ giá quy đổi: <b>1 ${asset} ≈ ${Number(usdVndRate).toLocaleString("vi-VN")}đ</b>\n`
        + `⏳ Hạn thanh toán: <b>${remainMin} phút</b>\n\n`
        + `📌 <i>Nhấn vào nút "Nạp qua Crypto Bot" bên dưới để hoàn tất. Sau khi thanh toán, tiền sẽ tự động vào ví của bạn ngay lập tức!</i>`;
}

let cryptopayPollingTimer = null;

/**
 * Polling kiểm tra và đối soát tự động các đơn / giao dịch Crypto Pay PENDING
 * Chạy nền để đảm bảo giao dịch luôn được hoàn tất kể cả khi webhook không tới được máy chủ (ví dụ dev trên localhost)
 */
export function startCryptoPayPolling({ prisma, telegram, intervalMs = 20000 }) {
    if (cryptopayPollingTimer) return { stop: () => clearInterval(cryptopayPollingTimer) };

    const tick = async () => {
        if (!isCryptoPayConfigured()) return;
        try {
            // Tìm các đơn hàng PENDING có paymentMethod là cryptopay
            const pendingOrders = await prisma.order.findMany({
                where: {
                    status: "PENDING",
                    paymentMethod: "cryptopay",
                    createdAt: { gte: new Date(Date.now() - 60 * 60 * 1000) },
                },
                select: { id: true, paymentRef: true, expiresAt: true },
                take: 50,
            });

            // Tìm các giao dịch nạp ví PENDING có cryptoNetwork là cryptopay
            const pendingDeposits = await prisma.walletTransaction.findMany({
                where: {
                    status: "PENDING",
                    cryptoNetwork: "cryptopay",
                    createdAt: { gte: new Date(Date.now() - 60 * 60 * 1000) },
                },
                select: { id: true, paymentRef: true, expiresAt: true },
                take: 50,
            });

            const invoiceIds = [];
            for (const o of pendingOrders) {
                const id = o.paymentRef?.replace("CRYPTOPAY:INVOICE:", "");
                if (id) invoiceIds.push(id);
            }
            for (const d of pendingDeposits) {
                const id = d.paymentRef?.replace("CRYPTOPAY:INVOICE:", "");
                if (id) invoiceIds.push(id);
            }

            if (!invoiceIds.length) return;

            const invoicesData = await getCryptoPayInvoices({ invoiceIds });
            const items = Array.isArray(invoicesData?.items) ? invoicesData.items : [];

            for (const inv of items) {
                if (inv.status === "paid") {
                    await processCryptoPayInvoicePaid({
                        invoice: inv,
                        prisma,
                        telegram,
                    }).catch((err) => console.error("[cryptopay-poller] Xử lý đơn thất bại:", err.message));
                }
            }
        } catch (err) {
            if (!err.message?.includes("Timeout") && !err.message?.includes("fetch failed")) {
                console.warn("[cryptopay-poller] Poller tick error:", err.message);
            }
        }
    };

    cryptopayPollingTimer = setInterval(tick, intervalMs);
    setTimeout(tick, 3000);

    console.log(`🤖 Crypto Pay poller started (${intervalMs}ms)`);
    return {
        stop() {
            if (cryptopayPollingTimer) {
                clearInterval(cryptopayPollingTimer);
                cryptopayPollingTimer = null;
            }
        },
    };
}
