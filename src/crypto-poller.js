import prisma from "./lib/prisma.js";
import { deliverOrder } from "./delivery.js";
import { releaseOrderCoupon } from "./coupon.js";
import { sendLog, warnIfScanTruncated } from "./lib/logger.js";
import { confirmDeposit, TxStatus, TxType } from "./wallet.js";
import { getCryptoConfigSync } from "./shop-config.js";
import { claimPaymentEvent, completePaymentEvent, releasePaymentEvent, isOrderSettledBy } from "./lib/payment-events.js";
import {
    cryptoTransferMatchesWalletTransaction,
    cryptoTransferMatchesOrder,
    fetchCryptoTransfers,
    getEnabledCryptoNetworks,
    getWalletTransactionExpectedCrypto,
    getOrderExpectedCrypto,
    isCryptoOrderExpired,
    isCryptoOrderMatchable,
    cryptoExpiryWindows,
} from "./payment/crypto.js";

function buildEventKey(transfer) {
    return `CRYPTO:${transfer.network}:${transfer.txid}`;
}

function matchingPendingPayments(transfer, orders, deposits) {
    return [
        ...orders.filter((order) => cryptoTransferMatchesOrder(transfer, order)).map((order) => `order:${order.id}`),
        ...deposits.filter((tx) => cryptoTransferMatchesWalletTransaction(transfer, tx)).map((tx) => `deposit:${tx.id}`),
    ];
}

// Transfer trùng nhiều đơn cùng lúc: mỗi tick (15s) đều gặp lại. Chỉ báo một lần
// cho mỗi txid, nếu không channel log bị spam và admin bỏ qua cảnh báo thật.
const _reportedConflicts = new Set();
function reportAmbiguousTransfer(eventKey, transfer, matches) {
    if (_reportedConflicts.has(eventKey)) return;
    _reportedConflicts.add(eventKey);
    sendLog(
        "ERROR",
        `⚠️ *TRÙNG SỐ TIỀN USDT — CẦN ĐỐI SOÁT TAY*\n`
        + `🌐 Mạng: ${transfer.network.toUpperCase()}\n`
        + `💵 Số tiền: ${transfer.amount} USDT\n`
        + `🔗 TX: \`${transfer.txid}\`\n`
        + `📌 Khớp: ${matches.join(", ")}\n\n`
        + `Bot KHÔNG tự credit để tránh giao sai đơn. Vui lòng xác nhận tay đơn đúng.`,
    );
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

// Sweeper dọn cache key đã xử lý. unref() để timer này không giữ event loop
// sống mãi — nếu không, import module (vd trong test) sẽ khiến process không thoát.
const _cacheSweeper = setInterval(() => {
    const now = Date.now();
    for (const [key, exp] of _processedKeyCache.entries()) {
        if (exp < now) _processedKeyCache.delete(key);
    }
}, 5 * 60 * 1000);
_cacheSweeper.unref?.();

async function batchAlreadyProcessed(eventKeys) {
    if (!eventKeys.length) return new Set();
    const [orders, walletTxs, events] = await Promise.all([
        prisma.order.findMany({
            where: { paymentRef: { in: eventKeys } },
            select: { paymentRef: true },
        }),
        prisma.walletTransaction.findMany({
            where: { paymentRef: { in: eventKeys } },
            select: { paymentRef: true },
        }),
        prisma.paymentEvent?.findMany
            ? prisma.paymentEvent.findMany({ where: { eventKey: { in: eventKeys }, status: "PROCESSED" }, select: { eventKey: true } })
            : Promise.resolve([]),
    ]);
    return new Set([
        ...orders.map((order) => order.paymentRef),
        ...walletTxs.map((tx) => tx.paymentRef),
        ...events.map((event) => event.eventKey),
    ]);
}

/**
 * Trần quét cho các tập PENDING. Đây là lưới an toàn, KHÔNG phải cách giới hạn tập
 * xét — mọi query dưới đây đều đã chặn theo THỜI GIAN nên kích thước tự nhiên của
 * chúng bị giới hạn bởi tốc độ tạo đơn trong một cửa sổ hết hạn. Chạm trần thì kêu
 * lên một lần (xem warnIfScanTruncated), vì trần quét im lặng đọc y như "đã xét hết".
 */
const PENDING_SCAN_MAX = 500;
const EXPIRE_SWEEP_MAX = 200;

/**
 * Điều kiện query "còn hạn" / "quá hạn" là `cryptoExpiryWindows` trong
 * payment/crypto.js — nằm cạnh `cryptoExpiresAt` vì đó là cùng một luật. Đừng dịch
 * lại luật hết hạn thành `where` ở đây: lệch một dấu là một đơn vừa bị huỷ vừa được
 * khớp giao dịch.
 */
const ORDER_PENDING_WHERE = {
    status: "PENDING",
    paymentMethod: { in: ["crypto_trc20", "crypto_bep20", "crypto_binance_pay"] },
};
const DEPOSIT_PENDING_WHERE = { type: TxType.DEPOSIT, status: TxStatus.PENDING };

/**
 * Đơn crypto CÒN KHỚP ĐƯỢC — tập dùng để khớp giao dịch.
 *
 * Rộng hơn tập QUÁ HẠN một khoảng ân hạn (`CRYPTO_MATCH_GRACE_MS`): khách bấm gửi
 * USDT ở phút cuối của cửa sổ thì khối xác nhận sau đó vài chục giây, và trong tick
 * kế tiếp đơn đã quá hạn nhưng TIỀN ĐÃ VÀO ví shop. Không có khoảng ân hạn thì đơn
 * đó không bao giờ được khớp rồi bị huỷ — chuyển khoản on-chain không đảo ngược được.
 */
async function getMatchableCryptoOrders(now = new Date()) {
    const rows = await prisma.order.findMany({
        where: cryptoExpiryWindows(ORDER_PENDING_WHERE, now).matchable,
        orderBy: { createdAt: "desc" },
        take: PENDING_SCAN_MAX,
    });
    warnIfScanTruncated("đơn USDT cần khớp giao dịch", rows.length, PENDING_SCAN_MAX, "crypto-poller");
    return rows;
}

/**
 * Đơn crypto QUÁ hạn chờ huỷ — CŨ NHẤT TRƯỚC để mỗi tick rút dần tồn đọng thật sự.
 *
 * Trước đây danh sách này được lọc từ CÙNG một cửa sổ `take: 100` xếp MỚI NHẤT TRƯỚC
 * với tập khớp giao dịch. Khi tồn đọng vượt 100 đơn thì cửa sổ chỉ còn toàn đơn mới:
 *   - không đơn nào bị huỷ nữa → tồn đọng chỉ tăng;
 *   - mà tồn đọng tăng lại càng đẩy đơn cũ ra ngoài cửa sổ khớp → khách chuyển USDT
 *     cho đơn đó thì tiền vào mà đơn không bao giờ được xác nhận.
 * Hai lỗi tự khuếch đại nhau và không tự lành.
 */
async function getExpiredCryptoOrders(now = new Date()) {
    const rows = await prisma.order.findMany({
        where: cryptoExpiryWindows(ORDER_PENDING_WHERE, now).expired,
        orderBy: { createdAt: "asc" },
        take: EXPIRE_SWEEP_MAX,
    });
    warnIfScanTruncated("đơn USDT quá hạn cần huỷ", rows.length, EXPIRE_SWEEP_MAX, "crypto-poller");
    return rows;
}

/** Giao dịch nạp ví USDT CÒN KHỚP ĐƯỢC — lý do khoảng ân hạn như đơn hàng. */
async function getMatchableCryptoDeposits(now = new Date()) {
    const deposits = await prisma.walletTransaction.findMany({
        where: cryptoExpiryWindows(DEPOSIT_PENDING_WHERE, now).matchable,
        include: { wallet: true },
        orderBy: { createdAt: "desc" },
        take: PENDING_SCAN_MAX,
    });
    // Trần quét phải so với số dòng DB TRẢ VỀ, không phải số dòng còn lại sau bộ lọc
    // JS — so sau khi lọc là bỏ sót đúng ca cần báo.
    warnIfScanTruncated("giao dịch nạp USDT cần khớp", deposits.length, PENDING_SCAN_MAX, "crypto-poller");
    return deposits.filter((tx) => getWalletTransactionExpectedCrypto(tx).network);
}

/** Giao dịch nạp ví USDT QUÁ hạn chờ đóng — CŨ NHẤT TRƯỚC, lý do như đơn hàng. */
async function getExpiredCryptoDeposits(now = new Date()) {
    const deposits = await prisma.walletTransaction.findMany({
        where: cryptoExpiryWindows(DEPOSIT_PENDING_WHERE, now).expired,
        include: { wallet: true },
        orderBy: { createdAt: "asc" },
        take: EXPIRE_SWEEP_MAX,
    });
    warnIfScanTruncated("giao dịch nạp USDT quá hạn", deposits.length, EXPIRE_SWEEP_MAX, "crypto-poller");
    return deposits.filter((tx) => getWalletTransactionExpectedCrypto(tx).network);
}

async function cancelExpiredOrders(orders) {
    const expired = orders.filter((order) => isCryptoOrderExpired(order));
    if (!expired.length) return [];

    const ids = expired.map((order) => order.id);
    // Release coupon theo từng đơn cancel được thật — đơn vừa được xác nhận thanh toán
    // song song sẽ không cancel được, release coupon của nó là nhả suất dùng oan.
    await Promise.allSettled(
        expired.map(async (order) => {
            const cx = await prisma.order.updateMany({
                where: { id: order.id, status: "PENDING" },
                data: { status: "CANCELED" },
            });
            if (cx.count > 0 && order.couponId) {
                await releaseOrderCoupon(order.id).catch(() => {});
            }
        })
    );
    return ids;
}

async function expireCryptoDeposits(deposits) {
    const expired = deposits.filter((tx) => isCryptoOrderExpired(tx));
    if (!expired.length) return [];

    const ids = expired.map((tx) => tx.id);
    await prisma.walletTransaction.updateMany({
        where: { id: { in: ids }, status: TxStatus.PENDING },
        data: { status: TxStatus.EXPIRED },
    });
    return ids;
}

async function processTransfer({ transfer, orders, telegram, clearPaymentMessages }) {
    const eventKey = buildEventKey(transfer);
    if (isKeyKnownProcessed(eventKey)) return false;

    for (const order of orders) {
        if (!cryptoTransferMatchesOrder(transfer, order)) continue;

        const eventClaim = await claimPaymentEvent(eventKey, {
            kind: "CRYPTO_ORDER",
            targetId: order.id,
            metadata: { network: transfer.network, txid: transfer.txid, amount: transfer.amount },
        });
        if (eventClaim.conflict) {
            markKeysProcessed([eventKey]);
            return false;
        }

        const claimed = await prisma.order.updateMany({
            where: { id: order.id, status: "PENDING" },
            data: {
                status: "PAID",
                paymentRef: eventKey,
            },
        });
        if (claimed.count === 0) {
            const fresh = await prisma.order.findUnique({ where: { id: order.id } }).catch(() => null);
            if (isOrderSettledBy(fresh, eventKey)) {
                await completePaymentEvent(eventKey, { status: "PROCESSED" }).catch(() => {});
                markKeysProcessed([eventKey]);
                return false;
            }
            // Order chưa hề nhận giao dịch này; nhả claim để admin/worker có thể
            // đối soát lại. Không nhả nếu trạng thái đã thể hiện payment thành công.
            await releasePaymentEvent(eventKey, { kind: "CRYPTO_ORDER", targetId: order.id }).catch(() => {});
            continue;
        }

        await completePaymentEvent(eventKey, { status: "PROCESSED" }).catch((error) => {
            console.error(`[crypto] mark event processed failed ${eventKey}:`, error.message);
        });
        markKeysProcessed([eventKey]);
        await clearPaymentMessages?.(order.chatId || order.odelegramId, `order:${order.id}`);

        sendLog(
            "ORDER",
            `✅ *ĐƠN USDT ĐÃ THANH TOÁN*\n📦 Order ID: \`${order.id}\`\n🌐 Mạng: ${transfer.network.toUpperCase()}\n💵 Số tiền: ${transfer.amount} USDT\n🔗 TX: \`${transfer.txid}\``,
        );

        const fresh = await prisma.order.findUnique({ where: { id: order.id } });
        await deliverOrder({
            prisma,
            telegram,
            order: fresh || { ...order, status: "PAID", paymentRef: eventKey },
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

        const eventClaim = await claimPaymentEvent(eventKey, {
            kind: "CRYPTO_DEPOSIT",
            targetId: tx.id,
            metadata: { network: transfer.network, txid: transfer.txid, amount: transfer.amount },
        });
        if (eventClaim.conflict) {
            markKeysProcessed([eventKey]);
            return false;
        }

        const result = await confirmDeposit(tx.id, eventKey);
        if (!result.success) {
            const freshTx = await prisma.walletTransaction.findUnique({ where: { id: tx.id } }).catch(() => null);
            if (freshTx?.status === TxStatus.SUCCESS && freshTx.paymentRef === eventKey) {
                await completePaymentEvent(eventKey, { status: "PROCESSED" }).catch(() => {});
                markKeysProcessed([eventKey]);
                return false;
            }
            await releasePaymentEvent(eventKey, { kind: "CRYPTO_DEPOSIT", targetId: tx.id }).catch(() => {});
            continue;
        }

        await completePaymentEvent(eventKey, { status: "PROCESSED" }).catch((error) => {
            console.error(`[crypto] mark deposit event processed failed ${eventKey}:`, error.message);
        });
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

/**
 * Số ngày giữ lại số tiền của đơn ĐÃ thanh toán, để không cấp lại cho đơn mới.
 *
 * Vì sao cần: số USDT lẻ là định danh DUY NHẤT của đơn (Binance Pay không mang
 * nội dung chuyển khoản). Nếu chỉ giữ chỗ số tiền của đơn PENDING thì số của đơn
 * đã DELIVERED được "giải phóng" ngay — một giao dịch cũ cùng số tiền còn nằm
 * trong cửa sổ đọc của nhà cung cấp (V1 trả ~34 dòng gần nhất, không lọc theo
 * thời gian) có thể bị khớp vào đơn mới và giao hàng không ai trả tiền.
 *
 * 7 ngày là dư so với cửa sổ đó mà vẫn không cạn 9000 slot ở mức đơn hàng bình thường.
 */
function getAmountReserveDays() {
    const value = Number(process.env.CRYPTO_AMOUNT_RESERVE_DAYS || 7);
    return Number.isFinite(value) && value >= 0 ? value : 7;
}

/**
 * Tập `cryptoAmount` KHÔNG được cấp lại cho đơn mới trên cùng network:
 * - đơn/nạp PENDING còn hiệu lực (trùng thì poller không dám credit đơn nào và cả
 *   hai khách bị treo tiền — C2),
 * - đơn/nạp ĐÃ thanh toán trong `CRYPTO_AMOUNT_RESERVE_DAYS` ngày gần đây (xem
 *   getAmountReserveDays: chống khớp lại một giao dịch cũ vào đơn mới).
 *
 * Lỗi đọc DB không được chặn việc tạo đơn: trả về Set rỗng, khi đó số tiền lại
 * chỉ dựa vào hash như trước — kém hơn nhưng không tệ hơn hành vi cũ.
 */
export async function getTakenCryptoAmounts(network) {
    try {
        const reserveSince = new Date(Date.now() - getAmountReserveDays() * 24 * 60 * 60 * 1000);
        const [orders, deposits, settledOrders, settledDeposits] = await Promise.all([
            prisma.order.findMany({
                where: { status: "PENDING", cryptoNetwork: network },
                orderBy: { createdAt: "desc" },
                take: 500,
            }),
            prisma.walletTransaction.findMany({
                where: { type: TxType.DEPOSIT, status: TxStatus.PENDING, cryptoNetwork: network },
                orderBy: { createdAt: "desc" },
                take: 500,
            }),
            prisma.order.findMany({
                where: { status: { in: ["PAID", "DELIVERED"] }, cryptoNetwork: network, createdAt: { gte: reserveSince } },
                orderBy: { createdAt: "desc" },
                take: 500,
            }),
            prisma.walletTransaction.findMany({
                where: { type: TxType.DEPOSIT, status: TxStatus.SUCCESS, cryptoNetwork: network, createdAt: { gte: reserveSince } },
                orderBy: { createdAt: "desc" },
                take: 500,
            }),
        ]);

        // Trần quét ở đây là trần AN TOÀN TIỀN, không phải trần hiệu năng: thiếu một
        // dòng là một `cryptoAmount` đang được giữ chỗ bị coi là trống và cấp lại cho
        // đơn mới. Hai đơn chờ cùng một số USDT thì poller không dám credit đơn nào
        // (matches.length > 1) — cả hai khách đều đã chuyển tiền thật và đều bị treo.
        // Vì vậy chạm trần phải kêu, không được im lặng.
        warnIfScanTruncated("đơn USDT PENDING giữ chỗ số tiền", orders.length, 500, "getTakenCryptoAmounts");
        warnIfScanTruncated("nạp USDT PENDING giữ chỗ số tiền", deposits.length, 500, "getTakenCryptoAmounts");
        warnIfScanTruncated("đơn USDT đã trả giữ chỗ số tiền", settledOrders.length, 500, "getTakenCryptoAmounts");
        warnIfScanTruncated("nạp USDT đã trả giữ chỗ số tiền", settledDeposits.length, 500, "getTakenCryptoAmounts");

        const taken = new Set();
        for (const row of [...orders, ...deposits]) {
            const amount = Number(row.cryptoAmount || 0);
            // Chỉ đơn còn KHỚP ĐƯỢC mới giữ chỗ. Chuẩn ở đây là `isCryptoOrderMatchable`
            // chứ không phải `!isCryptoOrderExpired`: đơn trong dải ân hạn vẫn được trả
            // tiền nên số USDT của nó vẫn phải bị chiếm, nhả ra là cấp trùng cho đơn mới.
            if (amount > 0 && isCryptoOrderMatchable(row)) {
                taken.add(Number(amount.toFixed(6)));
            }
        }
        // Đơn đã thanh toán: giữ chỗ BẤT KỂ hết hạn hay chưa — tiền đã về thật, và
        // giao dịch tương ứng vẫn có thể còn trong cửa sổ đọc của nhà cung cấp.
        for (const row of [...settledOrders, ...settledDeposits]) {
            const amount = Number(row.cryptoAmount || 0);
            if (amount > 0) taken.add(Number(amount.toFixed(6)));
        }
        return taken;
    } catch (error) {
        console.log("getTakenCryptoAmounts failed:", error.message);
        return new Set();
    }
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

    // Chỉ lấy tập CÒN HẠN: đơn/giao dịch đã quá hạn sắp bị huỷ nên không thể được
    // credit, và vì vậy không được chặn một giao dịch hợp lệ của khách khác.
    const [pendingOrders, pendingDeposits] = await Promise.all([getMatchableCryptoOrders(), getMatchableCryptoDeposits()]);
    if (matchingPendingPayments(matched, pendingOrders, pendingDeposits).length !== 1) {
        return { success: false, error: "Số tiền USDT đang trùng với giao dịch khác, vui lòng liên hệ admin để đối soát" };
    }

    const eventKey = buildEventKey(matched);
    const eventClaim = await claimPaymentEvent(eventKey, {
        kind: "CRYPTO_ORDER",
        targetId: orderId,
        metadata: { network: matched.network, txid: matched.txid, amount: matched.amount, source: "manual_scan" },
    });
    if (eventClaim.conflict) {
        markKeysProcessed([eventKey]);
        return { success: false, error: "Giao dịch USDT này đã được dùng cho thanh toán khác" };
    }

    const claimed = await prisma.order.updateMany({
        where: { id: orderId, status: "PENDING" },
        data: { status: "PAID", paymentRef: eventKey },
    });

    if (claimed.count === 0) {
        const updated = await prisma.order.findUnique({ where: { id: orderId } });
        // isOrderSettledBy chứ không phải tự liệt kê: bản cũ ở đây thiếu DELIVERING,
        // nên khách bấm "Tôi đã chuyển, kiểm tra" đúng lúc đơn đang giao sẽ rơi xuống
        // releasePaymentEvent — XOÁ sổ cái của một giao dịch đã hoàn tất và báo khách
        // "không thể xác nhận đơn hàng" trong khi hàng đang trên đường tới.
        if (isOrderSettledBy(updated, eventKey)) {
            await completePaymentEvent(eventKey, { status: "PROCESSED" }).catch(() => {});
            return { success: true, alreadyProcessed: true, order: updated, transfer: matched };
        }
        await releasePaymentEvent(eventKey, { kind: "CRYPTO_ORDER", targetId: orderId }).catch(() => {});
        return { success: false, error: "Không thể xác nhận đơn hàng" };
    }

    await completePaymentEvent(eventKey, { status: "PROCESSED" }).catch(() => {});
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

    // Chỉ lấy tập CÒN HẠN: đơn/giao dịch đã quá hạn sắp bị huỷ nên không thể được
    // credit, và vì vậy không được chặn một giao dịch hợp lệ của khách khác.
    const [pendingOrders, pendingDeposits] = await Promise.all([getMatchableCryptoOrders(), getMatchableCryptoDeposits()]);
    if (matchingPendingPayments(matched, pendingOrders, pendingDeposits).length !== 1) {
        return { success: false, error: "Số tiền USDT đang trùng với giao dịch khác, vui lòng liên hệ admin để đối soát" };
    }

    const eventKey = buildEventKey(matched);
    const eventClaim = await claimPaymentEvent(eventKey, {
        kind: "CRYPTO_DEPOSIT",
        targetId: tx.id,
        metadata: { network: matched.network, txid: matched.txid, amount: matched.amount, source: "manual_scan" },
    });
    if (eventClaim.conflict) {
        markKeysProcessed([eventKey]);
        return { success: false, error: "Giao dịch USDT này đã được dùng cho thanh toán khác" };
    }

    const result = await confirmDeposit(tx.id, eventKey);
    if (!result.success) {
        const freshTx = await prisma.walletTransaction.findUnique({ where: { id: tx.id } }).catch(() => null);
        if (freshTx?.status === TxStatus.SUCCESS && freshTx?.paymentRef === eventKey) {
            await completePaymentEvent(eventKey, { status: "PROCESSED" }).catch(() => {});
            return { success: true, alreadyProcessed: true, newBalance: freshTx.balanceAfter, paymentRef: eventKey, depositAmount: tx.amount };
        }
        await releasePaymentEvent(eventKey, { kind: "CRYPTO_DEPOSIT", targetId: tx.id }).catch(() => {});
        return result;
    }

    await completePaymentEvent(eventKey, { status: "PROCESSED" }).catch(() => {});
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

    // KHÔNG chốt danh sách network ở đây. Trước đây hàm này đọc
    // getEnabledCryptoNetworks() một lần rồi return sớm nếu rỗng: admin bật một
    // mạng qua web admin sau đó thì poller không bao giờ thấy, vì server.js coi
    // object trả về là "đã khởi động" (`if (!cryptoPolling)`) và không gọi lại.
    // Hệ quả: khách trả đúng số tiền mà đơn vẫn bị hủy sau khi hết hạn, cho tới
    // khi ai đó restart process. Giờ timer luôn chạy và mỗi tick tự đọc lại.
    let running = false;
    let timer = null;
    let lastError = "";
    // Lỗi gần nhất theo từng network, để không spam log channel mỗi 15s cho cùng
    // một sự cố mà vẫn báo lại khi nguyên nhân đổi.
    const lastNetworkError = new Map();
    const intervalMs = Math.max(5000, Number(runtime.CRYPTO_POLL_INTERVAL_MS || process.env.CRYPTO_POLL_INTERVAL_MS || 15000));

    const tick = async () => {
        if (running) return;
        const currentRuntime = getCryptoConfigSync();
        if (String(currentRuntime.CRYPTO_POLL_ENABLED || process.env.CRYPTO_POLL_ENABLED) === "false") return;
        // Đọc lại mỗi tick: admin bật/tắt mạng qua web admin có tác dụng trong
        // vòng một interval, không cần restart.
        const networks = getEnabledCryptoNetworks();
        if (!networks.length) return;
        running = true;

        try {
            // MỘT mốc `now` cho cả bốn query: hai tập "còn khớp được" / "đáng huỷ"
            // phải bù nhau tuyệt đối. Tính từ hai mốc khác nhau thì bản ghi ngay tại
            // biên có thể lọt vào cả hai tập rồi bị huỷ trong lúc đang được khớp.
            const now = new Date();
            const [matchableOrders, expiredOrders, matchableDeposits, expiredDeposits] = await Promise.all([
                getMatchableCryptoOrders(now),
                getExpiredCryptoOrders(now),
                getMatchableCryptoDeposits(now),
                getExpiredCryptoDeposits(now),
            ]);
            // Phải xét CẢ tập quá hạn: nếu chỉ còn đơn quá hạn mà return sớm thì không
            // lượt nào huỷ chúng, tồn đọng nằm lại vĩnh viễn và càng đẩy đơn còn hạn
            // ra xa cửa sổ khớp.
            if (!matchableOrders.length && !expiredOrders.length
                && !matchableDeposits.length && !expiredDeposits.length) return;

            // ── KHỚP TRƯỚC, HUỶ SAU ─────────────────────────────────────────────
            // Thứ tự này là một phần của fix, không phải chi tiết trình bày. Hai tập
            // đã rời nhau ngay trong query (xem cryptoExpiryWindows) nên một bản ghi
            // không nằm ở cả hai; nhưng `cancelExpiredOrders` chạy trước vẫn kịp huỷ
            // những đơn mà giao dịch của chúng NẰM TRONG CHÍNH TICK NÀY — khách gửi
            // USDT sát mốc hết hạn thì khối xác nhận sau đó vài chục giây, và tick kế
            // tiếp thấy đơn đã quá hạn. Khớp trước thì `processTransfer` claim đơn sang
            // PAID bằng gate atomic, và sweep chạy sau với cùng gate đó sẽ bỏ qua.
            //
            // KHÔNG lọc lại bằng isCryptoOrderExpired: bộ lọc đó chính là thứ biến dải
            // ân hạn thành vô nghĩa — đơn trong dải ân hạn "đã quá hạn" theo luật cũ,
            // nhưng tiền của nó thì đã vào ví shop thật.
            const activeOrders = matchableOrders;
            const activeDeposits = matchableDeposits;
            if (!activeOrders.length && !activeDeposits.length) {
                // Không còn gì để khớp nhưng vẫn còn đơn đáng huỷ → rơi xuống sweep.
                await cancelExpiredOrders(expiredOrders);
                await expireCryptoDeposits(expiredDeposits);
                return;
            }

            const allCreatedAt = [...activeOrders, ...activeDeposits].map((item) => new Date(item.createdAt).getTime());
            const minCreatedAt = Math.min(...allCreatedAt);
            for (const network of networks) {
                const networkOrders = activeOrders.filter((order) => getOrderExpectedCrypto(order).network === network);
                const networkDeposits = activeDeposits.filter((tx) => getWalletTransactionExpectedCrypto(tx).network === network);
                if (!networkOrders.length && !networkDeposits.length) continue;

                // Mỗi network một try/catch: nguồn đối soát của các mạng là những nhà
                // cung cấp KHÁC nhau (Binance API cho on-chain, thueapibank cho Binance
                // Pay). Trước đây cả vòng lặp nằm trong một try duy nhất nên một nhà
                // cung cấp lỗi là cả tick dừng — mạng còn lại không được quét dù API của
                // nó vẫn sống, và đơn của khách trên mạng đó treo tới hết hạn. Đây không
                // phải giả thiết: token thueapibank đã từng trả 403 liên tục trong khi
                // Binance vẫn 200.
                try {
                    const transfers = await fetchCryptoTransfers(network, { sinceMs: Math.max(0, minCreatedAt - 60_000) });
                    const eventKeys = transfers.map(buildEventKey).filter(Boolean);
                    const unknownKeys = eventKeys.filter((key) => !isKeyKnownProcessed(key));
                    const processedKeys = await batchAlreadyProcessed(unknownKeys);
                    markKeysProcessed([...processedKeys]);

                    for (const transfer of transfers) {
                        const eventKey = buildEventKey(transfer);
                        if (isKeyKnownProcessed(eventKey) || processedKeys.has(eventKey)) continue;
                        const matches = matchingPendingPayments(transfer, networkOrders, networkDeposits);
                        if (matches.length > 1) {
                            reportAmbiguousTransfer(eventKey, transfer, matches);
                            continue;
                        }
                        const deposited = await processDepositTransfer({ transfer, deposits: networkDeposits, telegram, clearPaymentMessages });
                        if (deposited) continue;
                        await processTransfer({ transfer, orders: networkOrders, telegram, clearPaymentMessages });
                    }
                } catch (error) {
                    // Báo lỗi theo từng network để admin biết NGUỒN nào chết, rồi tiếp tục
                    // sang mạng kế tiếp thay vì bỏ cả tick.
                    const errorKey = `${network}: ${error?.message || String(error)}`;
                    console.log("Crypto polling error:", errorKey);
                    if (errorKey !== lastNetworkError.get(network)) {
                        sendLog("ERROR", `Crypto polling failed (${network}): ${error?.message || String(error)}`);
                        lastNetworkError.set(network, errorKey);
                    }
                    continue;
                }
                lastNetworkError.delete(network);
            }

            // ── HUỶ SAU khi đã khớp xong ────────────────────────────────────────
            // Đặt ở đây chứ không phải trước vòng khớp: xem khối "KHỚP TRƯỚC" ở trên.
            // Cả hai hàm đều có gate atomic theo trạng thái nên đơn vừa được trả tiền
            // trong tick này sẽ không bị huỷ.
            await cancelExpiredOrders(expiredOrders);
            await expireCryptoDeposits(expiredDeposits);

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
    const initial = getEnabledCryptoNetworks();
    console.log(
        initial.length
            ? `💵 Crypto polling started (${intervalMs}ms): ${initial.join(", ")}`
            : `💵 Crypto polling started (${intervalMs}ms): chưa cấu hình mạng nào — sẽ tự bật khi admin nhập config`,
    );

    return {
        stop() {
            if (timer) clearInterval(timer);
        },
    };
}

export default {
    confirmOrderByCryptoScan,
    confirmDepositByCryptoScan,
    getTakenCryptoAmounts,
    startCryptoPolling,
};
