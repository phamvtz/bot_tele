/**
 * Chống xử lý lại (replay) giao dịch ngân hàng — H3.
 *
 * Một giao dịch có thể đến từ NHIỀU nguồn: bank-poller (15s/lần) và webhook IPN
 * (nhà cung cấp retry khi timeout, hoặc bị gửi lại có chủ đích). Nếu cùng một
 * giao dịch được xử lý hai lần thì ví bị cộng tiền hai lần / đơn được giao hai lần.
 *
 * Ba lớp chặn, từ rẻ tới đắt:
 *   1. cache in-memory (TTL 120s) — chặn burst retry mà không chạm DB
 *   2. `batchAlreadyProcessed` — tra `paymentRef` trong walletTransaction + order
 *   3. gate điều kiện `updateMany({ status: "PENDING" })` ở tầng dưới (wallet.js /
 *      server.js) — lớp cuối cùng, đúng cả khi hai process chạy song song
 *
 * Lớp 1–2 là best-effort (cache theo process, DB có độ trễ); chỉ lớp 3 mới bảo đảm
 * tuyệt đối. Nhưng lớp 3 chỉ bảo vệ bản ghi đã tồn tại, nên vẫn cần 1–2 để một
 * webhook gửi lại không đi hết luồng và gửi lại tin nhắn cho khách.
 *
 * Cache dùng chung giữa poller và webhook — cùng process, cùng giao dịch.
 */

import prisma from "./prisma.js";

/**
 * Khoá định danh một giao dịch. Ưu tiên id do ngân hàng cấp; không có thì ghép
 * số tiền + nội dung + thời điểm — đủ phân biệt trong thực tế và ổn định giữa
 * các lần gửi lại cùng một giao dịch.
 */
export function buildEventKey(item) {
    return String(
        item?.transactionId
        || item?.refNo
        || `${item?.amount}:${item?.content}:${item?.when || ""}`,
    );
}

const _processedKeyCache = new Map();

export function isKeyKnownProcessed(key) {
    const exp = _processedKeyCache.get(key);
    if (!exp) return false;
    if (exp < Date.now()) { _processedKeyCache.delete(key); return false; }
    return true;
}

export function markKeysProcessed(keys) {
    const exp = Date.now() + 120000;
    for (const k of keys) _processedKeyCache.set(k, exp);
}

// Chỉ dùng trong test — cache là state toàn cục theo process.
export function _resetProcessedKeyCache() {
    _processedKeyCache.clear();
}

// Dọn key hết hạn mỗi 5 phút để Map không phình vô hạn.
// unref: timer này không được giữ process sống (quan trọng khi chạy test).
const _sweep = setInterval(() => {
    const now = Date.now();
    for (const [k, exp] of _processedKeyCache.entries()) {
        if (exp < now) _processedKeyCache.delete(k);
    }
}, 5 * 60 * 1000);
_sweep.unref?.();

/**
 * Trả về tập các eventKey đã được ghi nhận trong DB (paymentRef của
 * walletTransaction hoặc order).
 */
export async function batchAlreadyProcessed(eventKeys) {
    if (!eventKeys.length) return new Set();

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

/**
 * Lọc ra những item chưa từng được xử lý. Kết quả DB được đưa vào cache để lần
 * gọi kế tiếp trong 120s không phải tra lại.
 */
export async function filterUnprocessed(items) {
    const keys = items.map(buildEventKey);
    const unknown = keys.filter((k) => !isKeyKnownProcessed(k));
    const dbProcessed = await batchAlreadyProcessed(unknown);
    markKeysProcessed([...dbProcessed]);

    return items.filter((item) => {
        const k = buildEventKey(item);
        return !isKeyKnownProcessed(k) && !dbProcessed.has(k);
    });
}

export default {
    buildEventKey,
    isKeyKnownProcessed,
    markKeysProcessed,
    batchAlreadyProcessed,
    filterUnprocessed,
};
