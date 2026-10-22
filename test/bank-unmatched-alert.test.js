import test, { mock } from "node:test";
import assert from "node:assert/strict";
import { loggerExports } from "./helpers/logger-mock.js";

// `warnOnce` chỉ nhớ trong bộ nhớ nên mỗi lần restart là báo lại cả lịch sử ngân
// hàng. Gặp thật: 45/46 cảnh báo "TIỀN VÀO MÀ KHÔNG KHỚP ĐƠN NÀO" là đơn đã DELIVERED
// từ nhiều ngày trước. Giao dịch đã được ghi sổ thì không phải tiền treo.
const url = (path) => new URL(path, import.meta.url).href;

const warned = [];
const marked = [];
let accounted = new Set();
let dbError = null;

// loggerExports chỉ cho sendLog tuỳ biến → đè warnOnce bằng bản ghi lại lời gọi.
mock.module(url("../src/lib/logger.js"), {
    namedExports: {
        ...loggerExports({}),
        warnOnce: async (key, level, message) => { warned.push({ key, level, message }); return true; },
    },
});
mock.module(url("../src/lib/event-idempotency.js"), {
    namedExports: {
        buildEventKey: (item) => String(item?.transactionId || ""),
        isKeyKnownProcessed: () => false,
        markKeysProcessed: (keys) => { marked.push(...keys); },
        batchAlreadyProcessed: async () => {
            if (dbError) throw new Error(dbError);
            return accounted;
        },
    },
});
mock.module(url("../src/wallet.js"), {
    namedExports: {
        parseDepositContent: () => null,
        findPendingDeposit: async () => null,
        confirmDeposit: async () => ({ success: false }),
    },
});
mock.module(url("../src/delivery.js"), { namedExports: { deliverOrder: async () => {} } });
mock.module(url("../src/bank-history.js"), {
    namedExports: { fetchBankHistory: async () => [], getBankHistoryConfig: () => ({ enabled: false }) },
});
mock.module(url("../src/coupon.js"), { namedExports: { releaseOrderCoupon: async () => {} } });

const { alertUnmatchedBankTransfer } = await import("../src/bank-poller.js");

function reset() {
    warned.length = 0;
    marked.length = 0;
    accounted = new Set();
    dbError = null;
}

test("giao dịch đã ghi sổ (đơn DELIVERED mang paymentRef = eventKey) thì KHÔNG báo tiền treo", async () => {
    reset();
    accounted = new Set(["FT100"]);
    const r = await alertUnmatchedBankTransfer({ eventKey: "FT100", upperContent: "NGUYENVANASHOPC130DC3C", amount: 12908 });
    assert.equal(r, false);
    assert.equal(warned.length, 0);
    assert.deepEqual(marked, ["FT100"], "phải đánh dấu đã xử lý để tick sau khỏi tra DB lại");
});

test("giao dịch CHƯA ghi sổ (đơn đã CANCELED) vẫn báo admin", async () => {
    reset();
    const r = await alertUnmatchedBankTransfer({ eventKey: "FT200", upperContent: "KHACHSHOP66A91B5F", amount: 132449 });
    assert.equal(r, true);
    assert.equal(warned.length, 1);
    assert.equal(warned[0].key, "unmatched-bank:FT200");
    assert.match(warned[0].message, /66A91B5F/);
    assert.match(warned[0].message, /132,449|132\.449/);
    assert.equal(marked.length, 0);
});

test("lỗi DB khi kiểm tra ghi sổ thì vẫn báo — thà báo thừa còn hơn nuốt tiền treo thật", async () => {
    reset();
    dbError = "mongo down";
    const origError = console.error;
    console.error = () => {};
    try {
        const r = await alertUnmatchedBankTransfer({ eventKey: "FT300", upperContent: "XSHOPABCDEF12", amount: 5000 });
        assert.equal(r, true);
        assert.equal(warned.length, 1);
    } finally {
        console.error = origError;
    }
});

test("nội dung không có mã đơn SHOP… thì không báo và không chạm DB", async () => {
    reset();
    dbError = "không được gọi";
    const r = await alertUnmatchedBankTransfer({ eventKey: "FT400", upperContent: "CHUYENTIENANUONG", amount: 5000 });
    assert.equal(r, false);
    assert.equal(warned.length, 0);
});
