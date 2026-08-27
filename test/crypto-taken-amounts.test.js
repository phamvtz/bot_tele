import test from "node:test";
import assert from "node:assert/strict";
import { mock } from "node:test";

// C2: bộ cấp phát số tiền chỉ an toàn nếu tập "đang bị giữ" đọc đúng — gộp cả
// order lẫn giao dịch nạp, bỏ đơn đã hết hạn, và không được ném lỗi ra ngoài.
const url = (path) => new URL(path, import.meta.url).href;

const NOW = Date.now();
const fresh = new Date(NOW - 60_000);
const stale = new Date(NOW - 60 * 60_000);

let orderRows = [];
let depositRows = [];
let failNext = false;

// Mock phải tôn trọng `where.status` và `where.createdAt`: getTakenCryptoAmounts
// giờ chạy BỐN query (PENDING + đã thanh toán trong cửa sổ reserve). Mock trả về
// mọi row cho mọi query sẽ làm row PENDING lọt vào nhánh "đã thanh toán" và test
// không còn kiểm được điều nó muốn kiểm.
function matchesWhere(row, where) {
    if (row.cryptoNetwork !== where.cryptoNetwork) return false;
    if (where.status) {
        const wanted = where.status.in || [where.status];
        if (!wanted.includes(row.status ?? "PENDING")) return false;
    }
    if (where.type && (row.type ?? "DEPOSIT") !== where.type) return false;
    if (where.createdAt?.gte && new Date(row.createdAt) < new Date(where.createdAt.gte)) return false;
    return true;
}

const prismaMock = {
    order: {
        async findMany({ where }) {
            if (failNext) throw new Error("db down");
            return orderRows.filter((row) => matchesWhere(row, where));
        },
    },
    walletTransaction: {
        async findMany({ where }) {
            return depositRows.filter((row) => matchesWhere(row, where));
        },
    },
};

mock.module(url("../src/lib/prisma.js"), {
    defaultExport: new Proxy({}, { get: (_t, prop) => prismaMock[prop] }),
});
mock.module(url("../src/delivery.js"), { namedExports: { deliverOrder: async () => ({}) } });
mock.module(url("../src/coupon.js"), { namedExports: { releaseCoupon: async () => {} } });
mock.module(url("../src/lib/logger.js"), { namedExports: { sendLog: () => {} } });
mock.module(url("../src/wallet.js"), {
    namedExports: {
        confirmDeposit: async () => ({ success: false }),
        TxStatus: { PENDING: "PENDING", SUCCESS: "SUCCESS", FAILED: "FAILED", EXPIRED: "EXPIRED" },
        TxType: { DEPOSIT: "DEPOSIT" },
    },
});
mock.module(url("../src/shop-config.js"), {
    namedExports: {
        getCryptoConfigSync: () => ({ CRYPTO_EXPIRE_MINUTES: 20 }),
        getOrderExpireMinutesSync: () => 10,
    },
});

const { getTakenCryptoAmounts } = await import("../src/crypto-poller.js");

test("collects pending amounts from both orders and deposits on that network", async () => {
    orderRows = [
        { cryptoNetwork: "trc20", cryptoAmount: 10.202181, createdAt: fresh },
        { cryptoNetwork: "trc20", cryptoAmount: 10.203000, createdAt: fresh },
    ];
    depositRows = [{ cryptoNetwork: "trc20", cryptoAmount: 5.001234, createdAt: fresh }];
    failNext = false;

    const taken = await getTakenCryptoAmounts("trc20");
    assert.deepEqual([...taken].sort((a, b) => a - b), [5.001234, 10.202181, 10.203]);
});

test("ignores amounts held by expired payments", async () => {
    orderRows = [
        { cryptoNetwork: "trc20", cryptoAmount: 10.202181, createdAt: stale },
        { cryptoNetwork: "trc20", cryptoAmount: 10.203000, createdAt: fresh },
    ];
    depositRows = [];
    failNext = false;

    const taken = await getTakenCryptoAmounts("trc20");
    assert.deepEqual([...taken], [10.203]);
});

test("ignores rows on another network and rows without an amount", async () => {
    orderRows = [
        { cryptoNetwork: "bep20", cryptoAmount: 1.001, createdAt: fresh },
        { cryptoNetwork: "trc20", cryptoAmount: null, createdAt: fresh },
        { cryptoNetwork: "trc20", cryptoAmount: 0, createdAt: fresh },
    ];
    depositRows = [];
    failNext = false;

    assert.equal((await getTakenCryptoAmounts("trc20")).size, 0);
});

// Không được chặn khách tạo đơn chỉ vì query phụ trợ này hỏng.
test("returns an empty set instead of throwing when the query fails", async () => {
    orderRows = [];
    depositRows = [];
    failNext = true;

    const taken = await getTakenCryptoAmounts("trc20");
    assert.equal(taken.size, 0);
});

// Số USDT lẻ là định danh DUY NHẤT của đơn (Binance Pay không mang nội dung CK).
// Nếu số của đơn ĐÃ thanh toán được cấp lại ngay, một giao dịch cũ cùng số tiền
// còn trong cửa sổ đọc của nhà cung cấp (~34 dòng, không lọc thời gian) có thể bị
// khớp vào đơn mới → giao hàng không ai trả tiền.
test("giữ chỗ cả số tiền của đơn ĐÃ thanh toán trong cửa sổ reserve", async () => {
    orderRows = [
        { cryptoNetwork: "binance_pay", cryptoAmount: 9.001111, createdAt: fresh, status: "PENDING" },
        // Đã giao, và đã HẾT HẠN — vẫn phải giữ chỗ vì tiền đã về thật.
        { cryptoNetwork: "binance_pay", cryptoAmount: 9.002222, createdAt: stale, status: "DELIVERED" },
        { cryptoNetwork: "binance_pay", cryptoAmount: 9.003333, createdAt: stale, status: "PAID" },
        // Hủy thì KHÔNG giữ chỗ: không có tiền nào vào.
        { cryptoNetwork: "binance_pay", cryptoAmount: 9.004444, createdAt: fresh, status: "CANCELED" },
    ];
    depositRows = [{ cryptoNetwork: "binance_pay", cryptoAmount: 9.005555, createdAt: stale, status: "SUCCESS" }];
    failNext = false;

    const taken = await getTakenCryptoAmounts("binance_pay");
    assert.deepEqual([...taken].sort((a, b) => a - b), [9.001111, 9.002222, 9.003333, 9.005555]);
});

test("đơn đã thanh toán QUÁ cửa sổ reserve thì nhả số tiền ra", async () => {
    const longAgo = new Date(NOW - 30 * 24 * 60 * 60_000);
    orderRows = [{ cryptoNetwork: "binance_pay", cryptoAmount: 9.009999, createdAt: longAgo, status: "DELIVERED" }];
    depositRows = [];
    failNext = false;

    assert.equal((await getTakenCryptoAmounts("binance_pay")).size, 0);
});
