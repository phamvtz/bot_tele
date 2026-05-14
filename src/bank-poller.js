import prisma from "./lib/prisma.js";
import { parseDepositContent, findPendingDeposit, confirmDeposit } from "./wallet.js";
import { isOrderExpired } from "./payment/vietqr.js";
import { deliverOrder } from "./delivery.js";
import { sendLog } from "./lib/logger.js";
import { fetchBankHistory, getBankHistoryConfig } from "./bank-history.js";

function buildEventKey(item) {
    return String(
        item.transactionId
        || item.refNo
        || `${item.amount}:${item.content}:${item.when || ""}`,
    );
}

async function batchAlreadyProcessed(eventKeys) {
    const [walletTxs, orders] = await Promise.all([
        prisma.walletTransaction.findMany({
            where: { paymentRef: { in: eventKeys } },
            select: { paymentRef: true },
        }),
        prisma.order.findMany({
            where: { paymentRef: { in: eventKeys } },
            select: { paymentRef: true },
        }),
    ]);

    return new Set([
        ...walletTxs.map((t) => t.paymentRef),
        ...orders.map((o) => o.paymentRef),
    ]);
}

async function processDeposit({ amount, content, eventKey, telegram }) {
    const depositInfo = parseDepositContent(content);
    if (!depositInfo) return false;

    const pendingDeposit = await findPendingDeposit(depositInfo.telegramId, depositInfo.transactionIdSuffix);
    if (!pendingDeposit) return false;
    if (Math.abs(amount - pendingDeposit.amount) > 1000) return false;

    const result = await confirmDeposit(pendingDeposit.id, eventKey);
    if (!result.success) return false;

    try {
        await telegram.sendMessage(
            depositInfo.telegramId,
            `✅ *NẠP TIỀN THÀNH CÔNG*\n\n`
            + `💰 Số tiền: +${amount.toLocaleString()}đ\n`
            + `💵 Số dư mới: ${result.newBalance.toLocaleString()}đ\n\n`
            + `Cảm ơn bạn đã nạp tiền!`,
            { parse_mode: "Markdown" },
        );
    } catch (error) {
        console.log("Could not notify user:", error.message);
    }

    sendLog("DEPOSIT", `✅ *TIỀN VÀO VÍ*\n👤 User: \`${depositInfo.telegramId}\`\n💰 Số tiền: +${amount.toLocaleString()}đ\n💵 Số dư mới: ${result.newBalance.toLocaleString()}đ`);
    return true;
}

async function processOrder({ amount, upperContent, eventKey, telegram, activeOrders }) {
    for (const order of activeOrders) {
        const shortId = order.id.slice(-8).toUpperCase();
        if (!upperContent.includes(`SHOP${shortId}`) && !upperContent.includes(shortId)) {
            continue;
        }

        if (Math.abs(amount - order.finalAmount) > 1000) {
            continue;
        }

        // Atomic gate: tránh deliver 2 lần nếu poller chạy trùng
        const claimed = await prisma.order.updateMany({
            where: { id: order.id, status: "PENDING" },
            data: { status: "PAID", paymentRef: eventKey },
        });

        if (claimed.count === 0) continue;

        sendLog("ORDER", `✅ *ĐƠN HÀNG ĐÃ THANH TOÁN*\n📦 Order ID: \`${order.id}\`\n💰 Số tiền: ${order.finalAmount.toLocaleString()}đ`);
        const updatedOrder = await prisma.order.findUnique({ where: { id: order.id } });
        await deliverOrder({ prisma, telegram, order: updatedOrder });
        return true;
    }

    return false;
}

/**
 * Manual bank scan for a specific order — called when user taps "Tôi đã chuyển, kiểm tra"
 */
export async function confirmOrderByBankScan(orderId, telegramId) {
    const order = await prisma.order.findUnique({ where: { id: orderId } });
    if (!order) return { success: false, error: "Không tìm thấy đơn hàng" };
    if (String(order.odelegramId) !== String(telegramId)) return { success: false, error: "Không có quyền" };
    if (order.status === "DELIVERED") return { success: true, alreadyProcessed: true, order };
    if (order.status === "PAID") return { success: true, alreadyProcessed: true, order };
    if (order.status !== "PENDING") return { success: false, error: `Đơn hàng đang ở trạng thái ${order.status}` };

    const config = getBankHistoryConfig();
    const items = await fetchBankHistory(config);
    const shortId = order.id.slice(-8).toUpperCase();

    const matchedItem = items.find((item) => {
        const amount = Number(item.amount || 0);
        const upperContent = String(item.content || "").toUpperCase().replace(/\s+/g, "");
        return (upperContent.includes(`SHOP${shortId}`) || upperContent.includes(shortId))
            && Math.abs(amount - order.finalAmount) <= 1000;
    });

    if (!matchedItem) return { success: false, error: "Chưa tìm thấy giao dịch trong lịch sử ngân hàng" };

    const eventKey = buildEventKey(matchedItem);
    const claimed = await prisma.order.updateMany({
        where: { id: orderId, status: "PENDING" },
        data: { status: "PAID", paymentRef: eventKey },
    });

    if (claimed.count === 0) {
        const updated = await prisma.order.findUnique({ where: { id: orderId } });
        if (updated?.status === "PAID" || updated?.status === "DELIVERED") {
            return { success: true, alreadyProcessed: true, order: updated };
        }
        return { success: false, error: "Không thể xác nhận đơn hàng" };
    }

    const updatedOrder = await prisma.order.findUnique({ where: { id: orderId } });
    return { success: true, order: updatedOrder };
}

export function startBankPolling({ telegram }) {
    const config = getBankHistoryConfig();
    if (!config.enabled) {
        console.log("🏦 Bank polling disabled");
        return { stop() {} };
    }

    if (!config.baseUrl || !config.token) {
        console.log("🏦 Bank polling skipped: missing MBBANK_HISTORY_BASE or MBBANK_API_TOKEN");
        return { stop() {} };
    }

    let running = false;
    let timer = null;
    let lastError = "";
    let disabledBy404 = false;

    const tick = async () => {
        if (running || disabledBy404) return;
        running = true;

        try {
            const items = await fetchBankHistory(config);

            // Lọc item hợp lệ
            const validItems = items.filter((item) => {
                const amount = Number(item.amount || 0);
                const content = String(item.content || "");
                return amount && content && buildEventKey(item);
            });

            if (!validItems.length) return;

            // 1 lần query cho tất cả eventKeys thay vì per-item
            const eventKeys = validItems.map(buildEventKey);
            const processedKeys = await batchAlreadyProcessed(eventKeys);

            const unprocessed = validItems.filter((item) => !processedKeys.has(buildEventKey(item)));
            if (!unprocessed.length) return;

            // Load pending orders 1 lần, cancel expired bulk
            const allPending = await prisma.order.findMany({
                where: { status: "PENDING", paymentMethod: "vietqr" },
                orderBy: { createdAt: "desc" },
                take: 50,
            });

            const expiredIds = allPending.filter((o) => isOrderExpired(o.createdAt)).map((o) => o.id);
            if (expiredIds.length) {
                await prisma.order.updateMany({
                    where: { id: { in: expiredIds } },
                    data: { status: "CANCELED" },
                });
            }

            const activeOrders = allPending.filter((o) => !isOrderExpired(o.createdAt));

            // Xử lý song song các item chưa được process
            await Promise.all(
                unprocessed.map(async (item) => {
                    const amount = Number(item.amount);
                    const content = String(item.content);
                    const upperContent = content.toUpperCase().replace(/\s+/g, "");
                    const eventKey = buildEventKey(item);

                    const deposited = await processDeposit({ amount, content, eventKey, telegram });
                    if (!deposited) {
                        await processOrder({ amount, upperContent, eventKey, telegram, activeOrders });
                    }
                }),
            );

            lastError = "";
        } catch (error) {
            const errorKey = error?.message || String(error);
            console.log("Bank polling error:", errorKey);
            if (errorKey !== lastError) {
                sendLog("ERROR", `Bank polling failed: ${errorKey}`);
                lastError = errorKey;
            }
            if (String(errorKey).includes("HTTP 404")) {
                disabledBy404 = true;
                if (timer) clearInterval(timer);
                console.log("🏦 Bank polling stopped because the configured MBBANK_HISTORY_BASE returned 404");
            }
        } finally {
            running = false;
        }
    };

    timer = setInterval(tick, Math.max(5000, config.intervalMs));
    tick().catch(() => {});

    console.log(`🏦 Bank polling started (${Math.max(5000, config.intervalMs)}ms)`);

    return {
        stop() {
            if (timer) clearInterval(timer);
        },
    };
}
