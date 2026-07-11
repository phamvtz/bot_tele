import prisma from "./lib/prisma.js";
import { deliverOrder } from "./delivery.js";
import { releaseCoupon } from "./coupon.js";
import { sendLog } from "./lib/logger.js";
import { confirmDeposit, TxStatus, TxType } from "./wallet.js";
import { getCryptoConfigSync } from "./shop-config.js";
import {
    cryptoTransferMatchesWalletTransaction,
    cryptoTransferMatchesOrder,
    fetchCryptoTransfers,
    getEnabledCryptoNetworks,
    getWalletTransactionExpectedCrypto,
    getOrderExpectedCrypto,
    isCryptoOrderExpired,
} from "./payment/crypto.js";

function buildEventKey(transfer) {
    return `CRYPTO:${transfer.network}:${transfer.txid}`;
}

const _processedKeyCache = new Map();
function isKeyKnownProcessed(key) {
    const exp = _processedKeyCache.get(key);
    if (!exp) return false;
    if (exp < Date.now()) {
        _processedKeyCache.delete(key);
        return false;
    }
    return true;
}

function markKeysProcessed(keys) {
    const exp = Date.now() + 5 * 60 * 1000;
    for (const key of keys) _processedKeyCache.set(key, exp);
}

setInterval(() => {
    const now = Date.now();
    for (const [key, exp] of _processedKeyCache.entries()) {
        if (exp < now) _processedKeyCache.delete(key);
    }
}, 5 * 60 * 1000);

async function batchAlreadyProcessed(eventKeys) {
    if (!eventKeys.length) return new Set();
    const [orders, walletTxs] = await Promise.all([
        prisma.order.findMany({
            where: { paymentRef: { in: eventKeys } },
            select: { paymentRef: true },
        }),
        prisma.walletTransaction.findMany({
            where: { paymentRef: { in: eventKeys } },
            select: { paymentRef: true },
        }),
    ]);
    return new Set([
        ...orders.map((order) => order.paymentRef),
        ...walletTxs.map((tx) => tx.paymentRef),
    ]);
}

async function getPendingCryptoOrders() {
    return prisma.order.findMany({
        where: {
            status: "PENDING",
            paymentMethod: { in: ["crypto_trc20", "crypto_bep20"] },
        },
        orderBy: { createdAt: "desc" },
        take: 100,
    });
}

async function getPendingCryptoDeposits() {
    const deposits = await prisma.walletTransaction.findMany({
        where: {
            type: TxType.DEPOSIT,
            status: TxStatus.PENDING,
        },
        include: { wallet: true },
        orderBy: { createdAt: "desc" },
        take: 100,
    });

    return deposits.filter((tx) => getWalletTransactionExpectedCrypto(tx).network);
}

async function cancelExpiredOrders(orders) {
    const expired = orders.filter((order) => isCryptoOrderExpired(order.createdAt));
    if (!expired.length) return [];

    const ids = expired.map((order) => order.id);
    await prisma.order.updateMany({
        where: { id: { in: ids }, status: "PENDING" },
        data: { status: "CANCELED" },
    });
    await Promise.allSettled(expired.filter((order) => order.couponId).map((order) => releaseCoupon(order.couponId)));
    return ids;
}

async function expireCryptoDeposits(deposits) {
    const expired = deposits.filter((tx) => isCryptoOrderExpired(tx.createdAt));
    if (!expired.length) return [];

    const ids = expired.map((tx) => tx.id);
    await prisma.walletTransaction.updateMany({
        where: { id: { in: ids }, status: TxStatus.PENDING },
        data: { status: "EXPIRED" },
    });
    return ids;
}

async function processTransfer({ transfer, orders, telegram, clearPaymentMessages }) {
    const eventKey = buildEventKey(transfer);
    if (isKeyKnownProcessed(eventKey)) return false;

    for (const order of orders) {
        if (!cryptoTransferMatchesOrder(transfer, order)) continue;

        const claimed = await prisma.order.updateMany({
            where: { id: order.id, status: "PENDING" },
            data: {
                status: "PAID",
                paymentRef: eventKey,
            },
        });
        if (claimed.count === 0) continue;

        markKeysProcessed([eventKey]);
        await clearPaymentMessages?.(order.chatId || order.odelegramId, `order:${order.id}`);

        sendLog(
            "ORDER",
            `✅ *ĐƠN USDT ĐÃ THANH TOÁN*\n📦 Order ID: \`${order.id}\`\n🌐 Mạng: ${transfer.network.toUpperCase()}\n💵 Số tiền: ${transfer.amount} USDT\n🔗 TX: \`${transfer.txid}\``,
        );

        await deliverOrder({
            prisma,
            telegram,
            order: { ...order, status: "PAID", paymentRef: eventKey },
        });
        return true;
    }

    return false;
}

async function processDepositTransfer({ transfer, deposits, telegram, clearPaymentMessages }) {
    const eventKey = buildEventKey(transfer);
    if (isKeyKnownProcessed(eventKey)) return false;

    for (const tx of deposits) {
        if (!cryptoTransferMatchesWalletTransaction(transfer, tx)) continue;

        const result = await confirmDeposit(tx.id, eventKey);
        if (!result.success) continue;

        markKeysProcessed([eventKey]);
        const telegramId = tx.wallet?.odelegramId;
        if (telegramId) {
            await clearPaymentMessages?.(telegramId, `deposit:${tx.id}`);
            try {
                await telegram.sendMessage(
                    telegramId,
                    `✅ <b>Nạp ví USDT thành công</b>\n\n`
                    + `💰 Số tiền: <b>+${Number(tx.amount).toLocaleString("vi-VN")}đ</b>\n`
                    + `💵 Đã nhận: <b>${transfer.amount} USDT</b>\n`
                    + `💳 Số dư mới: <b>${Number(result.newBalance || 0).toLocaleString("vi-VN")}đ</b>`,
                    { parse_mode: "HTML" },
                );
            } catch (error) {
                console.log("Could not notify crypto deposit user:", error.message);
            }
        }

        sendLog(
            "DEPOSIT",
            `✅ *NẠP VÍ USDT THÀNH CÔNG*\n👤 User: \`${telegramId || "unknown"}\`\n🌐 Mạng: ${transfer.network.toUpperCase()}\n💵 USDT: ${transfer.amount}\n💰 VND: +${Number(tx.amount).toLocaleString("vi-VN")}đ\n🔗 TX: \`${transfer.txid}\``,
        );
        return true;
    }

    return false;
}

export async function confirmOrderByCryptoScan(orderId, telegramId) {
    const order = await prisma.order.findUnique({ where: { id: orderId } });
    if (!order) return { success: false, error: "Không tìm thấy đơn hàng" };
    if (String(order.odelegramId) !== String(telegramId)) return { success: false, error: "Không có quyền" };
    if (order.status === "DELIVERED" || order.status === "PAID") {
        return { success: true, alreadyProcessed: true, order };
    }
    if (order.status !== "PENDING") return { success: false, error: `Đơn hàng đang ở trạng thái ${order.status}` };

    const expected = getOrderExpectedCrypto(order);
    if (!expected.network) return { success: false, error: "Đơn hàng không phải thanh toán crypto" };

    const sinceMs = Math.max(0, new Date(order.createdAt).getTime() - 60_000);
    const transfers = await fetchCryptoTransfers(expected.network, { sinceMs });
    const matched = transfers.find((transfer) => cryptoTransferMatchesOrder(transfer, order));
    if (!matched) return { success: false, error: "Chưa tìm thấy giao dịch USDT phù hợp" };

    const eventKey = buildEventKey(matched);
    const claimed = await prisma.order.updateMany({
        where: { id: orderId, status: "PENDING" },
        data: { status: "PAID", paymentRef: eventKey },
    });

    if (claimed.count === 0) {
        const updated = await prisma.order.findUnique({ where: { id: orderId } });
        if (updated?.status === "PAID" || updated?.status === "DELIVERED") {
            return { success: true, alreadyProcessed: true, order: updated, transfer: matched };
        }
        return { success: false, error: "Không thể xác nhận đơn hàng" };
    }

    markKeysProcessed([eventKey]);
    const updatedOrder = await prisma.order.findUnique({ where: { id: orderId } });
    return { success: true, order: updatedOrder, transfer: matched };
}

export async function confirmDepositByCryptoScan(transactionId, telegramId) {
    const tx = await prisma.walletTransaction.findUnique({
        where: { id: transactionId },
        include: { wallet: true },
    });

    if (!tx) return { success: false, error: "Không tìm thấy giao dịch nạp" };
    if (tx.type !== TxType.DEPOSIT) return { success: false, error: "Không phải giao dịch nạp ví" };
    if (!tx.wallet) return { success: false, error: "Không tìm thấy ví" };
    if (String(tx.wallet.odelegramId) !== String(telegramId)) return { success: false, error: "Không có quyền" };
    if (tx.status === TxStatus.SUCCESS) {
        return { success: true, alreadyProcessed: true, newBalance: tx.wallet.balance, paymentRef: tx.paymentRef || null, depositAmount: tx.amount };
    }

    const expected = getWalletTransactionExpectedCrypto(tx);
    if (!expected.network) return { success: false, error: "Giao dịch này không phải nạp USDT" };

    const sinceMs = Math.max(0, new Date(tx.createdAt).getTime() - 60_000);
    const transfers = await fetchCryptoTransfers(expected.network, { sinceMs });
    const matched = transfers.find((transfer) => cryptoTransferMatchesWalletTransaction(transfer, tx));
    if (!matched) return { success: false, error: "Chưa tìm thấy giao dịch USDT phù hợp" };

    const eventKey = buildEventKey(matched);
    const result = await confirmDeposit(tx.id, eventKey);
    if (!result.success) return result;

    markKeysProcessed([eventKey]);
    return {
        ...result,
        matched,
        paymentRef: eventKey,
        depositAmount: tx.amount,
    };
}

export function startCryptoPolling({ telegram, clearPaymentMessages = null } = {}) {
    const runtime = getCryptoConfigSync();
    if (String(runtime.CRYPTO_POLL_ENABLED || process.env.CRYPTO_POLL_ENABLED) === "false") {
        console.log("💵 Crypto polling disabled");
        return { stop() {} };
    }

    const networks = getEnabledCryptoNetworks();
    if (!networks.length) {
        console.log("💵 Crypto polling skipped: missing TRC20/BEP20 receiving address");
        return { stop() {} };
    }

    let running = false;
    let timer = null;
    let lastError = "";
    const intervalMs = Math.max(5000, Number(runtime.CRYPTO_POLL_INTERVAL_MS || process.env.CRYPTO_POLL_INTERVAL_MS || 15000));

    const tick = async () => {
        if (running) return;
        const currentRuntime = getCryptoConfigSync();
        if (String(currentRuntime.CRYPTO_POLL_ENABLED || process.env.CRYPTO_POLL_ENABLED) === "false") return;
        running = true;

        try {
            const [pendingOrders, pendingDeposits] = await Promise.all([
                getPendingCryptoOrders(),
                getPendingCryptoDeposits(),
            ]);
            if (!pendingOrders.length && !pendingDeposits.length) return;

            const expiredIds = await cancelExpiredOrders(pendingOrders);
            const expiredDepositIds = await expireCryptoDeposits(pendingDeposits);
            const activeOrders = pendingOrders.filter((order) => !expiredIds.includes(order.id) && !isCryptoOrderExpired(order.createdAt));
            const activeDeposits = pendingDeposits.filter((tx) => !expiredDepositIds.includes(tx.id) && !isCryptoOrderExpired(tx.createdAt));
            if (!activeOrders.length && !activeDeposits.length) return;

            const allCreatedAt = [...activeOrders, ...activeDeposits].map((item) => new Date(item.createdAt).getTime());
            const minCreatedAt = Math.min(...allCreatedAt);
            for (const network of networks) {
                const networkOrders = activeOrders.filter((order) => getOrderExpectedCrypto(order).network === network);
                const networkDeposits = activeDeposits.filter((tx) => getWalletTransactionExpectedCrypto(tx).network === network);
                if (!networkOrders.length && !networkDeposits.length) continue;

                const transfers = await fetchCryptoTransfers(network, { sinceMs: Math.max(0, minCreatedAt - 60_000) });
                const eventKeys = transfers.map(buildEventKey).filter(Boolean);
                const unknownKeys = eventKeys.filter((key) => !isKeyKnownProcessed(key));
                const processedKeys = await batchAlreadyProcessed(unknownKeys);
                markKeysProcessed([...processedKeys]);

                for (const transfer of transfers) {
                    const eventKey = buildEventKey(transfer);
                    if (isKeyKnownProcessed(eventKey) || processedKeys.has(eventKey)) continue;
                    const deposited = await processDepositTransfer({ transfer, deposits: networkDeposits, telegram, clearPaymentMessages });
                    if (deposited) continue;
                    await processTransfer({ transfer, orders: networkOrders, telegram, clearPaymentMessages });
                }
            }

            lastError = "";
        } catch (error) {
            const errorKey = error?.message || String(error);
            console.log("Crypto polling error:", errorKey);
            if (errorKey !== lastError) {
                sendLog("ERROR", `Crypto polling failed: ${errorKey}`);
                lastError = errorKey;
            }
        } finally {
            running = false;
        }
    };

    timer = setInterval(tick, intervalMs);
    tick().catch(() => {});
    console.log(`💵 Crypto polling started (${intervalMs}ms): ${networks.join(", ")}`);

    return {
        stop() {
            if (timer) clearInterval(timer);
        },
    };
}

export default {
    confirmOrderByCryptoScan,
    confirmDepositByCryptoScan,
    startCryptoPolling,
};
