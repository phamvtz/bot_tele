import test, { mock } from "node:test";
import assert from "node:assert/strict";

// Tiền vào mà đơn đã bị huỷ (đơn 66A91B5F, 132.449đ) từng chỉ lộ ra qua kênh log —
// trang BankMonitor chỉ liệt kê giao dịch thô. Bộ phân loại này gắn trạng thái đối soát
// để admin thấy ngay trên web.
const url = (path) => new URL(path, import.meta.url).href;

let processedKeys = new Set();
let batchCalls = 0;
mock.module(url("../src/lib/event-idempotency.js"), {
    namedExports: {
        buildEventKey: (item) => String(item?.transactionId || ""),
        batchAlreadyProcessed: async (keys) => {
            batchCalls += 1;
            return new Set(keys.filter((k) => processedKeys.has(k)));
        },
    },
});

const { classifyBankTx, reconcileBankTransactions, RECONCILE } = await import("../src/bank-reconcile.js");

const NOW = Date.UTC(2026, 9, 24, 10, 0, 0);
const orders = new Map([
    ["66A91B5F", { id: "6ad4bf02da10dc5266a91b5f", status: "CANCELED", finalAmount: 132449 }],
    ["C130DC3C", { id: "6ad4bf02da10dc50c130dc3c", status: "DELIVERED", finalAmount: 12908 }],
    ["AAAA1111", { id: "6ad4bf02da10dc50aaaa1111", status: "PENDING", finalAmount: 50000 }],
]);
const tx = (over = {}) => ({ transactionId: "FT1", amount: 12908, content: "KHACH SHOPC130DC3C", when: new Date(NOW - 3600_000).toISOString(), ...over });

function reset() { processedKeys = new Set(); batchCalls = 0; }

test("giao dịch đã ghi sổ → matched (không báo động giả)", () => {
    const r = classifyBankTx(tx(), { processed: new Set(["FT1"]), ordersByShort: orders, now: NOW });
    assert.equal(r.status, RECONCILE.MATCHED);
});

test("TIỀN VÀO cho đơn đã HUỶ → unmatched, kèm đơn và lý do để admin hoàn tiền", () => {
    const r = classifyBankTx(tx({ transactionId: "FT2", amount: 132449, content: "KHACHSHOP66A91B5F" }), { ordersByShort: orders, now: NOW });
    assert.equal(r.status, RECONCILE.UNMATCHED);
    assert.equal(r.orderId, "6ad4bf02da10dc5266a91b5f");
    assert.equal(r.orderStatus, "CANCELED");
    assert.equal(r.reason, "order_canceled");
    assert.equal(r.amountMismatch, false);
});

test("mã đơn không tồn tại → unmatched order_not_found", () => {
    const r = classifyBankTx(tx({ content: "SHOPZZZZ9999" }), { ordersByShort: orders, now: NOW });
    assert.equal(r.status, RECONCILE.UNMATCHED);
    assert.equal(r.reason, "order_not_found");
    assert.equal(r.orderId, null);
});

test("đơn đã giao bằng đường khác (mã giao dịch khác paymentRef) → vẫn báo để kiểm tra trả hai lần", () => {
    const r = classifyBankTx(tx(), { processed: new Set(), ordersByShort: orders, now: NOW });
    assert.equal(r.status, RECONCILE.UNMATCHED);
    assert.equal(r.reason, "order_delivered");
});

test("đơn đang PENDING → pending; lệch tiền thì cờ amountMismatch (poller sẽ không tự khớp)", () => {
    const ok = classifyBankTx(tx({ amount: 50000, content: "SHOPAAAA1111" }), { ordersByShort: orders, now: NOW });
    assert.equal(ok.status, RECONCILE.PENDING);
    assert.equal(ok.amountMismatch, false);
    const bad = classifyBankTx(tx({ amount: 49000, content: "SHOPAAAA1111" }), { ordersByShort: orders, now: NOW });
    assert.equal(bad.status, RECONCILE.PENDING);
    assert.equal(bad.amountMismatch, true);
    assert.equal(bad.orderAmount, 50000);
});

test("nội dung có khoảng trắng/chữ thường vẫn nhận ra mã đơn", () => {
    const r = classifyBankTx(tx({ amount: 50000, content: "shop aaaa 1111" }), { ordersByShort: orders, now: NOW });
    assert.equal(r.status, RECONCILE.PENDING);
});

test("nạp ví NAP…: mới thì pending, quá 30 phút chưa cộng thì unmatched", () => {
    const fresh = classifyBankTx(tx({ content: "NAP123456", when: new Date(NOW - 5 * 60_000).toISOString() }), { now: NOW });
    assert.equal(fresh.status, RECONCILE.PENDING);
    const stale = classifyBankTx(tx({ content: "NAP123456", when: new Date(NOW - 45 * 60_000).toISOString() }), { now: NOW });
    assert.equal(stale.status, RECONCILE.UNMATCHED);
    assert.equal(stale.reason, "deposit_not_credited");
    const noTime = classifyBankTx(tx({ content: "NAP123456", when: undefined }), { now: NOW });
    assert.equal(noTime.status, RECONCILE.PENDING, "không rõ thời gian thì không báo động");
});

test("tiền RA và giao dịch không liên quan shop → other", () => {
    assert.equal(classifyBankTx(tx({ amount: -5000 }), { now: NOW }).status, RECONCILE.OTHER);
    assert.equal(classifyBankTx(tx({ content: "CHUYEN TIEN AN UONG" }), { now: NOW }).status, RECONCILE.OTHER);
    assert.equal(classifyBankTx(tx({ amount: 0 }), { now: NOW }).status, RECONCILE.OTHER);
});

test("reconcileBankTransactions: gắn reconcile + tổng kết, tải đơn khi có SHOP chưa ghi sổ", async () => {
    reset();
    processedKeys = new Set(["FT_DONE"]);
    let orderQueries = 0;
    const prisma = {
        order: {
            findMany: async () => {
                orderQueries += 1;
                return [
                    { id: "6ad4bf02da10dc5266a91b5f", status: "CANCELED", finalAmount: 132449 },
                    { id: "6ad4bf02da10dc50aaaa1111", status: "PENDING", finalAmount: 50000 },
                ];
            },
        },
    };
    const txns = [
        tx({ transactionId: "FT_DONE", content: "SHOPC130DC3C" }),
        tx({ transactionId: "FT_BAD", amount: 132449, content: "SHOP66A91B5F" }),
        tx({ transactionId: "FT_PEND", amount: 50000, content: "SHOPAAAA1111" }),
        tx({ transactionId: "FT_OUT", amount: -1000, content: "RUT TIEN" }),
    ];
    const { transactions, summary } = await reconcileBankTransactions(txns, prisma, { now: NOW });
    assert.deepEqual(summary, { matched: 1, pending: 1, unmatched: 1, other: 1 });
    assert.equal(transactions.find((t) => t.transactionId === "FT_BAD").reconcile.orderStatus, "CANCELED");
    assert.equal(transactions[0].content, "SHOPC130DC3C", "giữ nguyên field gốc");
    assert.equal(orderQueries, 1);
    assert.equal(batchCalls, 1, "tra ghi sổ đúng một lần cho cả lô");
});

test("reconcileBankTransactions: mọi SHOP đã ghi sổ thì KHÔNG tải đơn (rẻ)", async () => {
    reset();
    processedKeys = new Set(["A", "B"]);
    let orderQueries = 0;
    const prisma = { order: { findMany: async () => { orderQueries += 1; return []; } } };
    const { summary } = await reconcileBankTransactions(
        [tx({ transactionId: "A", content: "SHOPC130DC3C" }), tx({ transactionId: "B", content: "SHOPAAAA1111" })],
        prisma, { now: NOW },
    );
    assert.equal(summary.matched, 2);
    assert.equal(orderQueries, 0);
});

test("reconcileBankTransactions: danh sách rỗng/không hợp lệ không nổ", async () => {
    reset();
    const prisma = { order: { findMany: async () => [] } };
    assert.deepEqual((await reconcileBankTransactions([], prisma)).summary, { matched: 0, pending: 0, unmatched: 0, other: 0 });
    assert.deepEqual((await reconcileBankTransactions(null, prisma)).transactions, []);
    assert.equal(batchCalls, 0);
});
