/**
 * Đối soát giao dịch ngân hàng với đơn hàng để admin THẤY được "tiền vào mà không
 * khớp đơn nào" ngay trên web, thay vì chỉ lộ ra qua kênh log.
 *
 * `classifyBankTx` thuần (không I/O) để test; `reconcileBankTransactions` chỉ lo
 * truy vấn DB rồi gọi nó.
 */

import { buildEventKey, batchAlreadyProcessed } from "./lib/event-idempotency.js";

/** Trạng thái hiển thị cho một giao dịch tiền VÀO. */
export const RECONCILE = {
    MATCHED: "matched",       // đã ghi sổ (đơn/ví mang đúng mã giao dịch này)
    PENDING: "pending",       // có đơn đang chờ — poller sẽ khớp ở lượt kế
    UNMATCHED: "unmatched",   // tiền vào nhưng không có đơn nào nhận → admin phải xử lý
    OTHER: "other",           // không phải đơn/nạp ví của shop
};

const SHOP_RE = /SHOP([A-Z0-9]{8})/;
// Giao dịch nạp ví cũ hơn mốc này mà vẫn chưa ghi sổ thì coi là treo.
const DEPOSIT_STALE_MS = 30 * 60 * 1000;

function txTime(tx) {
    const t = new Date(tx?.when).getTime();
    return Number.isFinite(t) ? t : null;
}

/**
 * @param tx             { amount, content, transactionId, when }
 * @param ctx.processed  Set eventKey đã ghi sổ (batchAlreadyProcessed)
 * @param ctx.ordersByShort  Map<shortId(8, HOA), { id, status, finalAmount }>
 * @param ctx.now        ms
 */
export function classifyBankTx(tx, { processed = new Set(), ordersByShort = new Map(), now = Date.now() } = {}) {
    const amount = Number(tx?.amount || 0);
    const upper = String(tx?.content || "").toUpperCase().replace(/\s+/g, "");
    const shop = upper.match(SHOP_RE);
    const isDeposit = upper.includes("NAP");

    // Chỉ quan tâm tiền VÀO có dấu hiệu của shop.
    if (amount <= 0 || (!shop && !isDeposit)) return { status: RECONCILE.OTHER };
    if (processed.has(buildEventKey(tx))) return { status: RECONCILE.MATCHED };

    if (shop) {
        const order = ordersByShort.get(shop[1]) || null;
        const base = order
            ? { orderId: order.id, orderStatus: order.status, orderAmount: Number(order.finalAmount) || 0 }
            : { orderId: null, orderStatus: null, orderAmount: null };
        if (order && order.status === "PENDING") {
            return { status: RECONCILE.PENDING, ...base, amountMismatch: base.orderAmount !== amount };
        }
        return {
            status: RECONCILE.UNMATCHED,
            ...base,
            reason: order ? `order_${String(order.status || "").toLowerCase()}` : "order_not_found",
            amountMismatch: order ? base.orderAmount !== amount : false,
        };
    }

    // Nạp ví (NAP…): chưa ghi sổ. Mới thì đợi poller, cũ thì coi là treo.
    const t = txTime(tx);
    const stale = t !== null && now - t > DEPOSIT_STALE_MS;
    return stale
        ? { status: RECONCILE.UNMATCHED, reason: "deposit_not_credited" }
        : { status: RECONCILE.PENDING };
}

/** Gắn `reconcile` vào từng giao dịch + tổng kết. `prisma` truyền vào để dễ test. */
export async function reconcileBankTransactions(txns, prisma, { now = Date.now() } = {}) {
    const list = Array.isArray(txns) ? txns : [];
    const keys = list.map((t) => buildEventKey(t)).filter(Boolean);
    const processed = keys.length ? await batchAlreadyProcessed(keys) : new Set();

    // Chỉ tải đơn khi có giao dịch SHOP chưa ghi sổ — phần lớn lần gọi không cần.
    const needOrders = list.some((t) => {
        const up = String(t?.content || "").toUpperCase().replace(/\s+/g, "");
        return SHOP_RE.test(up) && !processed.has(buildEventKey(t));
    });
    const ordersByShort = new Map();
    if (needOrders) {
        const orders = await prisma.order.findMany({
            where: { createdAt: { gte: new Date(now - 30 * 86_400_000) } },
            select: { id: true, status: true, finalAmount: true },
            orderBy: { createdAt: "desc" },
            take: 5000,
        });
        for (const o of orders) ordersByShort.set(String(o.id).slice(-8).toUpperCase(), o);
    }

    const summary = { matched: 0, pending: 0, unmatched: 0, other: 0 };
    const transactions = list.map((tx) => {
        const reconcile = classifyBankTx(tx, { processed, ordersByShort, now });
        summary[reconcile.status] += 1;
        return { ...tx, reconcile };
    });
    return { transactions, summary };
}
