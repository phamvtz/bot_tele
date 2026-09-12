import prisma from "./lib/prisma.js";
import { parseDepositContent, findPendingDeposit, confirmDeposit } from "./wallet.js";
import { orderCancelCutoff } from "./payment/vietqr.js";
import { deliverOrder } from "./delivery.js";
import { sendLog, warnIfScanTruncated, warnOnce } from "./lib/logger.js";
import { fetchBankHistory, getBankHistoryConfig } from "./bank-history.js";
import { releaseOrderCoupon } from "./coupon.js";
import { bankAmountsMatch } from "./payment/amounts.js";
import { claimPaymentEvent, completePaymentEvent, releasePaymentEvent, isOrderSettledBy } from "./lib/payment-events.js";
// H3: chuyển sang module dùng chung để poller và webhook IPN chia sẻ CÙNG một
// cache. Trước đây chỉ poller có lớp chống replay; webhook gửi lại đi thẳng vào
// luồng xử lý.
import {
    buildEventKey,
    isKeyKnownProcessed,
    markKeysProcessed,
    batchAlreadyProcessed,
} from "./lib/event-idempotency.js";

/**
 * Trần quét cho HAI tập đơn PENDING. Đây là lưới an toàn, KHÔNG phải cách giới hạn
 * tập xét — cả hai query đều đã chặn theo THỜI GIAN (xem trong tick) nên kích thước
 * tự nhiên của chúng bị giới hạn bởi tốc độ tạo đơn trong một cửa sổ hết hạn.
 *
 * Chạm trần thì `warnIfScanTruncated` kêu lên một lần: trần quét mà im lặng thì đọc y
 * như "đã xét hết", trong khi phần bị bỏ qua là đơn của khách đã chuyển tiền.
 */
const ACTIVE_ORDER_SCAN_MAX = 1000;
const EXPIRE_SWEEP_MAX = 200;

/**
 * Khoảng ÂN HẬN giữa "đã quá hạn" và "đáng huỷ" là `VIETQR_MATCH_GRACE_MS` trong
 * payment/vietqr.js — CÙNG một luật với IPN webhook trong server.js. Đọc giải thích
 * đầy đủ ở đó.
 *
 * Tóm tắt: khách bấm chuyển tiền ở giây 590 của cửa sổ 600 giây là chuyện bình
 * thường, và ngân hàng ghi nhận giao dịch sau đó 20–30 giây. Bản cũ huỷ đơn ngay khi
 * quá hạn và tập khớp chỉ gồm đơn còn hạn, nên giao dịch đó không khớp được với đơn
 * nào — tiền vào mà hàng không giao, và chuyển khoản ngân hàng thì không đảo ngược
 * được. Luật ở đây: tiền đã vào thì thắng mốc hết hạn, trong một khoảng hữu hạn.
 *
 * Giao dịch tới SAU khi đơn đã huỷ thì không đường tự động nào cứu được — đường đó
 * phải là admin hoàn tiền, và `alertUnmatchedBankTransfer` bên dưới báo cho họ.
 */

async function processDeposit({ amount, content, eventKey, telegram, clearPaymentMessages }) {
    const depositInfo = parseDepositContent(content);
    if (!depositInfo) return false;

    const pendingDeposit = await findPendingDeposit(depositInfo.telegramId, depositInfo.transactionIdSuffix);
    if (!pendingDeposit || !bankAmountsMatch(amount, pendingDeposit.amount)) return false;

    const eventClaim = await claimPaymentEvent(eventKey, {
        kind: "BANK_DEPOSIT",
        targetId: pendingDeposit.id,
        metadata: { amount, content },
    });
    if (eventClaim.conflict) return false;

    const result = await confirmDeposit(pendingDeposit.id, eventKey);
    if (!result.success) {
        const freshTx = await prisma.walletTransaction.findUnique({ where: { id: pendingDeposit.id } }).catch(() => null);
        if (freshTx?.status === "SUCCESS" && freshTx.paymentRef === eventKey) {
            await completePaymentEvent(eventKey, { status: "PROCESSED" }).catch(() => {});
            return false;
        }
        await releasePaymentEvent(eventKey, { kind: "BANK_DEPOSIT", targetId: pendingDeposit.id }).catch(() => {});
        return false;
    }

    await completePaymentEvent(eventKey, { status: "PROCESSED" }).catch((error) => {
        console.error(`[bank] mark deposit event failed ${eventKey}:`, error.message);
    });
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

/**
 * Giao dịch CÓ mã đơn (`SHOP…`) mà không khớp được đơn PENDING nào.
 *
 * Đây là lưới an toàn cuối cho tiền thật: dải ân hạn chỉ phủ được độ trễ ghi nhận
 * của ngân hàng. Một lệnh chuyển tới SAU khi đơn đã huỷ thì không đường tự động nào
 * cứu được — đơn đã CANCELED thì không endpoint nào hồi sinh, và giao hàng cho một
 * đơn đã huỷ là làm khách lẫn shop rối. Việc đúng là admin hoàn tiền bằng tay, và
 * muốn vậy thì họ phải BIẾT. Bản cũ im lặng hoàn toàn: giao dịch không khớp thì
 * `processOrder` trả false, tick sau quét lại, mãi mãi.
 *
 * Chỉ báo khi nội dung thật sự chứa mã đơn 8 ký tự — một lệnh chuyển không nội dung
 * hoặc sai cú pháp là chuyện của khách, không phải một khoản tiền đang treo.
 * `warnOnce` theo eventKey để không spam mỗi 15 giây: giao dịch nằm lại trong lịch
 * sử ngân hàng nhiều ngày.
 */
export async function alertUnmatchedBankTransfer({ eventKey, upperContent, amount }) {
    const m = String(upperContent || "").match(/SHOP([A-Z0-9]{8})/);
    if (!m) return false;
    const shortId = m[1];
    return warnOnce(
        `unmatched-bank:${eventKey}`,
        "ERROR",
        `⚠️ *TIỀN VÀO MÀ KHÔNG KHỚP ĐƠN NÀO*\n`
        + `🔢 Mã đơn: \`${shortId}\`\n`
        + `💰 Số tiền: ${Number(amount || 0).toLocaleString()}đ\n`
        + `📝 Nội dung: \`${upperContent}\`\n`
        + `Đơn có thể đã bị huỷ vì hết hạn TRƯỚC khi ngân hàng ghi nhận giao dịch. `
        + `Tra mã đơn trong bảng admin để hoàn tiền hoặc giao bù — bot sẽ KHÔNG tự xử lý.`,
    );
}

/**
 * Khớp một giao dịch ngân hàng với một đơn PENDING.
 *
 * @returns {Promise<"matched"|"raced"|"nomatch">}
 *   - `matched`  — đơn đã được claim sang PAID và đang giao.
 *   - `raced`    — giao dịch này đã có đường khác xử lý (IPN webhook, một worker
 *                  khác, hoặc đơn đã PAID trước đó). KHÔNG phải tiền treo.
 *   - `nomatch`  — không đơn PENDING nào khớp. Đây mới là ca cần báo admin.
 *
 * Trả ba trạng thái thay vì boolean vì caller phải phân biệt được "tiền đang treo"
 * với "có người xử lý rồi" — gộp làm một thì hoặc bỏ sót tiền treo, hoặc báo động
 * giả mỗi khi IPN webhook thắng cuộc đua.
 */
async function processOrder({ amount, upperContent, eventKey, telegram, activeOrders, clearPaymentMessages }) {
    for (const order of activeOrders) {
        const shortId = order.id.slice(-8).toUpperCase();
        if (!upperContent.includes(`SHOP${shortId}`) || !bankAmountsMatch(amount, order.finalAmount)) continue;

        const eventClaim = await claimPaymentEvent(eventKey, {
            kind: "BANK_ORDER",
            targetId: order.id,
            metadata: { amount, content: upperContent },
        });
        if (eventClaim.conflict) return "raced";

        const claimed = await prisma.order.updateMany({
            where: { id: order.id, status: "PENDING" },
            data: { status: "PAID", paymentRef: eventKey },
        });

        if (claimed.count === 0) {
            const fresh = await prisma.order.findUnique({ where: { id: order.id } }).catch(() => null);
            if (isOrderSettledBy(fresh, eventKey)) {
                await completePaymentEvent(eventKey, { status: "PROCESSED" }).catch(() => {});
                return "raced";
            }
            await releasePaymentEvent(eventKey, { kind: "BANK_ORDER", targetId: order.id }).catch(() => {});
            continue;
        }

        await completePaymentEvent(eventKey, { status: "PROCESSED" }).catch((error) => {
            console.error(`[bank] mark order event failed ${eventKey}:`, error.message);
        });
        sendLog("ORDER", `✅ *ĐƠN HÀNG ĐÃ THANH TOÁN*\n📦 Order ID: \`${order.id}\`\n💰 Số tiền: ${order.finalAmount.toLocaleString()}đ`);
        await clearPaymentMessages?.(order.chatId || order.odelegramId, `order:${order.id}`);

        await deliverOrder({
            prisma,
            telegram,
            order: { ...order, status: "PAID", paymentRef: eventKey },
        });
        return "matched";
    }

    return "nomatch";
}

/**
 * Manual bank scan for a specific order — called when user taps "Tôi đã chuyển, kiểm tra"
 */
export async function confirmOrderByBankScan(orderId, telegramId) {
    const order = await prisma.order.findUnique({ where: { id: orderId } });
    if (!order) return { success: false, error: "Không tìm thấy đơn hàng" };
    if (String(order.odelegramId) !== String(telegramId)) return { success: false, error: "Không có quyền" };
    if (["DELIVERED", "PAID"].includes(order.status)) return { success: true, alreadyProcessed: true, order };
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
        return upperContent.includes(`SHOP${shortId}`) && bankAmountsMatch(amount, order.finalAmount);
    });
    if (!matchedItem) return { success: false, error: "Chưa tìm thấy giao dịch trong lịch sử ngân hàng" };

    const eventKey = buildEventKey(matchedItem);
    const eventClaim = await claimPaymentEvent(eventKey, {
        kind: "BANK_ORDER",
        targetId: orderId,
        metadata: { amount: matchedItem.amount, content: matchedItem.content, source: "manual_scan" },
    });
    if (eventClaim.conflict) return { success: false, error: "Giao dịch ngân hàng này đã được dùng cho thanh toán khác" };

    const claimed = await prisma.order.updateMany({
        where: { id: orderId, status: "PENDING" },
        data: { status: "PAID", paymentRef: eventKey },
    });

    if (claimed.count === 0) {
        const updated = await prisma.order.findUnique({ where: { id: orderId } });
        if (["PAID", "DELIVERED"].includes(updated?.status) && updated?.paymentRef === eventKey) {
            await completePaymentEvent(eventKey, { status: "PROCESSED" }).catch(() => {});
            return { success: true, alreadyProcessed: true, order: updated };
        }
        await releasePaymentEvent(eventKey, { kind: "BANK_ORDER", targetId: orderId }).catch(() => {});
        return { success: false, error: "Không thể xác nhận đơn hàng" };
    }

    await completePaymentEvent(eventKey, { status: "PROCESSED" }).catch(() => {});
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

            // Hai tập đơn PENDING, phân chia theo THỜI GIAN chứ không theo số lượng,
            // tính từ CÙNG một mốc `now` với hai toán tử bù nhau (gte / lt) nên một
            // đơn không thể lọt vào cả hai tập.
            //
            // Trước đây cả hai được lọc ra từ MỘT cửa sổ `take: 50` xếp MỚI NHẤT
            // TRƯỚC. Khi tồn đọng vượt 50 đơn thì cửa sổ chỉ còn toàn đơn mới, và hai
            // lỗi sau tự khuếch đại nhau, không tự lành:
            //   - expiredOrders rỗng → KHÔNG đơn nào bị huỷ nữa → tồn đọng chỉ tăng;
            //   - activeOrders thiếu mọi đơn cũ hơn đơn thứ 50 → khách chuyển tiền
            //     cho đơn đó thì tiền vào mà đơn không bao giờ được xác nhận, rồi
            //     bị huỷ vì hết hạn. Shop giữ tiền, khách không có hàng.
            const now = Date.now();
            // Mốc ĐÁNG HUỶ = mốc hết hạn lùi thêm một khoảng ân hạn. Hai tập dưới
            // đây chia nhau theo mốc này nên vẫn bù nhau tuyệt đối, và tập khớp là
            // tập "chưa đáng huỷ" — rộng hơn tập "còn hạn trả" đúng bằng dải ân hạn.
            // Luật nằm ở payment/vietqr.js để webhook IPN dùng CHUNG một mốc.
            const cancelCutoff = orderCancelCutoff(now);
            const [matchableOrders, expiredOrders] = await Promise.all([
                // Đơn còn khớp được: còn hạn trả CỘNG dải ân hạn. Tiền đã vào tài
                // khoản shop thì mốc hết hạn không được thắng.
                prisma.order.findMany({
                    where: { status: "PENDING", paymentMethod: "vietqr", createdAt: { gte: cancelCutoff } },
                    orderBy: { createdAt: "desc" },
                    take: ACTIVE_ORDER_SCAN_MAX,
                }),
                // Đơn QUÁ dải ân hạn, quét riêng và CŨ NHẤT TRƯỚC để mỗi tick rút dần
                // tồn đọng thật sự thay vì nhìn đi nhìn lại 50 đơn mới nhất.
                prisma.order.findMany({
                    where: { status: "PENDING", paymentMethod: "vietqr", createdAt: { lt: cancelCutoff } },
                    orderBy: { createdAt: "asc" },
                    take: EXPIRE_SWEEP_MAX,
                }),
            ]);
            warnIfScanTruncated("đơn VietQR cần khớp giao dịch", matchableOrders.length, ACTIVE_ORDER_SCAN_MAX);
            warnIfScanTruncated("đơn VietQR quá hạn cần huỷ", expiredOrders.length, EXPIRE_SWEEP_MAX);

            // ── KHỚP TRƯỚC, HUỶ SAU ──────────────────────────────────────────────
            // Thứ tự này là một phần của fix, không phải chi tiết: một đơn nằm trong
            // khoảng ân hạn thuộc CẢ HAI tập. Khớp trước thì nếu có giao dịch thật,
            // `processOrder` đã claim nó sang PAID bằng gate atomic `status:"PENDING"`;
            // sweep chạy sau với cùng gate đó sẽ nhận count=0 và bỏ qua. Huỷ trước thì
            // đơn khách ĐÃ TRẢ TIỀN bị ghi đè thành CANCELED và giao dịch khớp không
            // bao giờ tìm thấy đơn — tiền vào mà hàng không giao.
            //
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
                        const outcome = await processOrder({ amount, upperContent, eventKey, telegram, activeOrders: matchableOrders, clearPaymentMessages });
                        if (outcome === "matched") markKeysProcessed([eventKey]);
                        // `raced` nghĩa là IPN webhook hoặc một worker khác đã xử lý —
                        // không phải tiền treo, báo ở đó là báo động giả mỗi lần thua đua.
                        else if (outcome === "nomatch") await alertUnmatchedBankTransfer({ eventKey, upperContent, amount });
                    }
                }),
            );

            if (expiredOrders.length) {
                // Atomic gate status:"PENDING" — giữa findMany ở trên và update này, IPN
                // webhook (server.js), confirmOrderByBankScan HOẶC chính vòng khớp vừa
                // chạy có thể đã claim đơn sang PAID. Không có gate thì đơn KHÁCH ĐÃ
                // TRẢ TIỀN bị ghi đè thành CANCELED.
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
                            await releaseOrderCoupon(o.id).catch(() => {});
                        }
                        return cx.count;
                    })
                );
                const cancelled = results.reduce((n, r) => n + (r.status === "fulfilled" ? r.value : 0), 0);
                if (cancelled !== expiredOrders.length) {
                    console.log(`[bank-poller] expired ${expiredOrders.length}, cancelled ${cancelled} (số còn lại đã được thanh toán song song)`);
                }
            }

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
