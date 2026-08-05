import test from "node:test";
import assert from "node:assert/strict";
import { mock } from "node:test";

// H3: webhook IPN trước đây không có lớp chống replay nào — nhà cung cấp gửi lại
// (timeout/retry) hoặc bank-poller đã xử lý cùng giao dịch 15s trước là cộng ví
// hai lần. Test này ghim hành vi của module dùng chung giữa poller và webhook.
// Cần cờ --experimental-test-module-mocks (đã có trong npm test).

const walletTxRows = [];
const orderRows = [];

mock.module(new URL("../src/lib/prisma.js", import.meta.url).href, {
    defaultExport: {
        walletTransaction: {
            findMany: async ({ where }) => walletTxRows.filter((r) => where.paymentRef.in.includes(r.paymentRef)),
        },
        order: {
            findMany: async ({ where }) => orderRows.filter((r) => where.paymentRef.in.includes(r.paymentRef)),
        },
    },
});

const {
    buildEventKey,
    isKeyKnownProcessed,
    markKeysProcessed,
    batchAlreadyProcessed,
    filterUnprocessed,
    _resetProcessedKeyCache,
} = await import("../src/lib/event-idempotency.js");

function reset() {
    walletTxRows.length = 0;
    orderRows.length = 0;
    _resetProcessedKeyCache();
}

test("buildEventKey uu tien id ngan hang, fallback amount:content:when", () => {
    reset();
    assert.equal(buildEventKey({ transactionId: "TX1", refNo: "R1", amount: 5 }), "TX1");
    assert.equal(buildEventKey({ refNo: "R1", amount: 5 }), "R1");
    assert.equal(buildEventKey({ amount: 50000, content: "NAP123", when: "2026-01-01" }), "50000:NAP123:2026-01-01");
    // Cùng một giao dịch gửi lại phải ra cùng key, nếu không thì lớp chặn vô dụng.
    const item = { amount: 50000, content: "NAP123", when: "2026-01-01" };
    assert.equal(buildEventKey(item), buildEventKey({ ...item }));
});

test("cache in-memory chan lai key da danh dau", () => {
    reset();
    assert.equal(isKeyKnownProcessed("TX-A"), false);
    markKeysProcessed(["TX-A"]);
    assert.equal(isKeyKnownProcessed("TX-A"), true);
    assert.equal(isKeyKnownProcessed("TX-B"), false);
});

test("batchAlreadyProcessed tim thay paymentRef o ca wallet lan order", async () => {
    reset();
    walletTxRows.push({ paymentRef: "TX-WALLET" });
    orderRows.push({ paymentRef: "TX-ORDER" });

    const found = await batchAlreadyProcessed(["TX-WALLET", "TX-ORDER", "TX-NEW"]);
    assert.equal(found.has("TX-WALLET"), true);
    assert.equal(found.has("TX-ORDER"), true);
    assert.equal(found.has("TX-NEW"), false);
});

test("batchAlreadyProcessed voi mang rong khong cham DB", async () => {
    reset();
    const found = await batchAlreadyProcessed([]);
    assert.equal(found.size, 0);
});

test("filterUnprocessed bo giao dich da co trong DB", async () => {
    reset();
    walletTxRows.push({ paymentRef: "TX-OLD" });

    const items = [
        { transactionId: "TX-OLD", amount: 50000, content: "NAP1" },
        { transactionId: "TX-NEW", amount: 60000, content: "NAP2" },
    ];
    const fresh = await filterUnprocessed(items);
    assert.deepEqual(fresh.map((i) => i.transactionId), ["TX-NEW"]);
});

test("filterUnprocessed bo giao dich vua xu ly trong cung process (webhook gui lai)", async () => {
    reset();
    const item = { transactionId: "TX-RETRY", amount: 50000, content: "NAP1" };

    // Lần đầu: chưa ai biết → đi tiếp.
    assert.equal((await filterUnprocessed([item])).length, 1);

    // Handler xử lý xong thì đánh dấu. Lần gửi lại ngay sau đó phải bị chặn,
    // kể cả khi DB chưa kịp thấy bản ghi (replica lag).
    markKeysProcessed([buildEventKey(item)]);
    assert.equal((await filterUnprocessed([item])).length, 0);
});

test("ket qua tra DB duoc dua vao cache de lan sau khong tra lai", async () => {
    reset();
    orderRows.push({ paymentRef: "TX-CACHED" });

    await filterUnprocessed([{ transactionId: "TX-CACHED", amount: 1, content: "SHOP1" }]);
    assert.equal(isKeyKnownProcessed("TX-CACHED"), true);
});
