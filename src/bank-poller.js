import prisma from "./lib/prisma.js";
import { parseDepositContent, findPendingDeposit, confirmDeposit } from "./wallet.js";
import { isOrderExpired } from "./payment/vietqr.js";
import { deliverOrder } from "./delivery.js";
import { sendLog } from "./lib/logger.js";
import { fetchBankHistory, getBankHistoryConfig } from "./bank-history.js";
import { releaseCoupon } from "./coupon.js";
import { bankAmountsMatch } from "./payment/amounts.js";
// H3: chuyển sang module dùng chung để poller và webhook IPN chia sẻ CÙNG một
// cache. Trước đây chỉ poller có lớp chống replay; webhook gửi lại đi thẳng vào
// luồng xử lý.
import {
    buildEventKey,
    isKeyKnownProcessed,
    markKeysProcessed,
    batchAlreadyProcessed,
} from "./lib/event-idempotency.js";

async function processDeposit({ amount, content, eventKey, telegram, clearPaymentMessages }) {
    const depositInfo = parseDepositContent(content);
    if (!depositInfo) return false;

    const pendingDeposit = await findPendingDeposit(depositInfo.telegramId, depositInfo.transactionIdSuffix);
    if (!pendingDeposit) return false;
    if (!bankAmountsMatch(amount, pendingDeposit.amount)) return false;

    const result = await confirmDeposit(pendingDeposit.id, eventKey);
    if (!result.success) return false;

    await clearPaymentMessages?.(depositInfo.telegramId, `deposit:${pendingDeposit.id}`);

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

async function processOrder({ amount, upperContent, eventKey, telegram, activeOrders, clearPaymentMessages }) {
    for (const order of activeOrders) {
        const shortId = order.id.slice(-8).toUpperCase();
        // Chỉ match khi content chứa prefix SHOP — tránh false-match với content khác
        // (vd nạp ví NAP{telegramId}{xxx} có 8 chars cuối tình cờ trùng shortId).
        if (!upperContent.includes(`SHOP${shortId}`)) {
            continue;
        }

        if (!bankAmountsMatch(amount, order.finalAmount)) {
            continue;
        }

        // Atomic gate: tránh deliver 2 lần nếu poller chạy trùng
        const claimed = await prisma.order.updateMany({
            where: { id: order.id, status: "PENDING" },
            data: { status: "PAID", paymentRef: eventKey },
        });

        if (claimed.count === 0) continue;

        sendLog("ORDER", `✅ *ĐƠN HÀNG ĐÃ THANH TOÁN*\n📦 Order ID: \`${order.id}\`\n💰 Số tiền: ${order.finalAmount.toLocaleString()}đ`);
        await clearPaymentMessages?.(order.chatId || order.odelegramId, `order:${order.id}`);

        // Pass order với fields đã update để deliverOrder không cần findUnique lại.
        // deliverOrder chỉ cần id, productId, chatId, odelegramId, quantity, finalAmount, userId — đã có.
        await deliverOrder({
            prisma,
            telegram,
            order: { ...order, status: "PAID", paymentRef: eventKey },
        });
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
    if (!config.baseUrl || !config.token) {
        return { success: false, error: "Hệ thống kiểm tra ngân hàng chưa được cấu hình" };
    }
    const items = await fetchBankHistory(config);
    const shortId = order.id.slice(-8).toUpperCase();

    const matchedItem = items.find((item) => {
        const amount = Number(item.amount || 0);
        const upperContent = String(item.content || "").toUpperCase().replace(/\s+/g, "");
        // Yêu cầu prefix SHOP để tránh false-match với content khác
        return upperContent.includes(`SHOP${shortId}`)
            && bankAmountsMatch(amount, order.finalAmount);
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

export function startBankPolling({ telegram, clearPaymentMessages = null }) {
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
    // Backoff khi API lỗi (vd 404 thoáng qua) — tạm dừng rồi tự thử lại,
    // KHÔNG dừng vĩnh viễn (trước đây 1 lần 404 là poller chết tới khi restart).
    let pausedUntil = 0;
    let backoffMs = 0;
    const MAX_BACKOFF = 10 * 60 * 1000; // tối đa 10 phút

    const tick = async () => {
        if (running || Date.now() < pausedUntil) return;
        running = true;

        try {
            // Early-return: nếu KHÔNG có đơn vietqr chờ VÀ không có lệnh nạp ví chờ thì
            // khỏi gọi API MB Bank (network ra bên thứ 3 mỗi 3s). Giống crypto-poller.
            // 2 count dùng countDocuments ở tầng Mongo nên rẻ hơn nhiều so với fetch history.
            const [pendingOrderCount, pendingDepositCount] = await Promise.all([
                prisma.order.count({ where: { status: "PENDING", paymentMethod: "vietqr" } }).catch(() => 1),
                prisma.walletTransaction.count({ where: { type: "DEPOSIT", status: "PENDING" } }).catch(() => 1),
            ]);
            if (!pendingOrderCount && !pendingDepositCount) {
                lastError = "";
                return; // không có gì để đối soát → bỏ tick này
            }

            const items = await fetchBankHistory(config);

            // Lọc item hợp lệ
            const validItems = items.filter((item) => {
                const amount = Number(item.amount || 0);
                const content = String(item.content || "");
                return amount && content && buildEventKey(item);
            });

            // Thành công → reset backoff
            backoffMs = 0;
            pausedUntil = 0;

            if (!validItems.length) return;

            // Lọc qua in-memory cache trước, chỉ DB-check những key chưa biết
            const eventKeys = validItems.map(buildEventKey);
            const unknownKeys = eventKeys.filter(k => !isKeyKnownProcessed(k));
            const dbProcessedKeys = unknownKeys.length ? await batchAlreadyProcessed(unknownKeys) : new Set();
            markKeysProcessed([...dbProcessedKeys]); // cache kết quả DB

            const unprocessed = validItems.filter((item) => {
                const k = buildEventKey(item);
                return !isKeyKnownProcessed(k) && !dbProcessedKeys.has(k);
            });
            if (!unprocessed.length) return;

            // Load pending orders 1 lần, cancel expired bulk
            const allPending = await prisma.order.findMany({
                where: { status: "PENDING", paymentMethod: "vietqr" },
                orderBy: { createdAt: "desc" },
                take: 50,
            });

            const expiredOrders = allPending.filter((o) => isOrderExpired(o.createdAt));
            const expiredIds = expiredOrders.map((o) => o.id);
            if (expiredIds.length) {
                // Atomic gate status:"PENDING" — giữa findMany ở trên và update này, IPN
                // webhook (server.js) hoặc confirmOrderByBankScan có thể đã claim đơn sang
                // PAID. Không có gate thì đơn KHÁCH ĐÃ TRẢ TIỀN bị ghi đè thành CANCELED.
                //
                // Release coupon PHẢI theo từng đơn cancel được thật, không theo cả
                // expiredOrders: đơn nào vừa được trả tiền thì coupon của nó vẫn đang dùng,
                // decrement usedCount ở đây là nhả suất dùng miễn phí cho người khác.
                const results = await Promise.allSettled(
                    expiredOrders.map(async (o) => {
                        const cx = await prisma.order.updateMany({
                            where: { id: o.id, status: "PENDING" },
                            data: { status: "CANCELED" },
                        });
                        if (cx.count > 0 && o.couponId) {
                            await releaseCoupon(o.couponId).catch(() => {});
                        }
                        return cx.count;
                    })
                );
                const cancelled = results.reduce((n, r) => n + (r.status === "fulfilled" ? r.value : 0), 0);
                if (cancelled !== expiredIds.length) {
                    console.log(`[bank-poller] expired ${expiredIds.length}, cancelled ${cancelled} (số còn lại đã được thanh toán song song)`);
                }
            }

            const activeOrders = allPending.filter((o) => !isOrderExpired(o.createdAt));

            // Xử lý song song các item chưa được process.
            // Pre-filter: bỏ qua content không bắt đầu bằng SHOP hoặc NAP — không phải nạp/đơn hàng.
            await Promise.all(
                unprocessed.map(async (item) => {
                    const amount = Number(item.amount);
                    const content = String(item.content);
                    const upperContent = content.toUpperCase().replace(/\s+/g, "");
                    const eventKey = buildEventKey(item);

                    const isDeposit = upperContent.includes("NAP");
                    const isOrder = upperContent.includes("SHOP");
                    if (!isDeposit && !isOrder) return; // skip giao dịch không liên quan

                    if (isDeposit) {
                        const deposited = await processDeposit({ amount, content, eventKey, telegram, clearPaymentMessages });
                        if (deposited) { markKeysProcessed([eventKey]); return; }
                    }
                    if (isOrder) {
                        const ordered = await processOrder({ amount, upperContent, eventKey, telegram, activeOrders, clearPaymentMessages });
                        if (ordered) markKeysProcessed([eventKey]);
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
            // Backoff tăng dần khi lỗi (đặc biệt HTTP 404/5xx) — tạm dừng rồi tự thử lại.
            // Không dừng vĩnh viễn để 1 lỗi thoáng qua không làm chết auto-confirm đơn QR.
            backoffMs = backoffMs ? Math.min(backoffMs * 2, MAX_BACKOFF) : 30000;
            pausedUntil = Date.now() + backoffMs;
            console.log(`🏦 Bank polling paused ${Math.round(backoffMs / 1000)}s after error, will retry`);
        } finally {
            running = false;
        }
    };

    timer = setInterval(tick, Math.max(2000, config.intervalMs));
    tick().catch(() => {});

    console.log(`🏦 Bank polling started (${Math.max(2000, config.intervalMs)}ms)`);

    return {
        stop() {
            if (timer) clearInterval(timer);
        },
    };
}
