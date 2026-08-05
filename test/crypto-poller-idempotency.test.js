import test from "node:test";
import assert from "node:assert/strict";
import { mock } from "node:test";

// crypto-poller.js không nhận dependency injection, nên phải mock module.
// Chạy file này cần cờ --experimental-test-module-mocks (đã có trong npm test).
const url = (path) => new URL(path, import.meta.url).href;

const TRC20_ADDRESS = "TQ3XyZpollerTestAddress0000000000";
const AMOUNT = 10.202181;
const TXID = "0xdeadbeefpollertest";
const EVENT_KEY = `CRYPTO:trc20:${TXID}`;

function baseOrder(overrides = {}) {
    return {
        id: "order-abc12345",
        odelegramId: "12345",
        chatId: "12345",
        status: "PENDING",
        paymentMethod: "crypto_trc20",
        cryptoNetwork: "trc20",
        cryptoAmount: AMOUNT,
        cryptoAddress: TRC20_ADDRESS,
        paymentRef: null,
        couponId: null,
        createdAt: new Date(Date.now() - 60_000),
        ...overrides,
    };
}

const transfer = {
    network: "trc20",
    txid: TXID,
    to: TRC20_ADDRESS,
    amount: AMOUNT,
    timestamp: Date.now(),
};

// Prisma giả: order lưu trong Map, updateMany là compare-and-swap đúng như
// MongoDB thật (chỉ đổi khi where khớp), nên nó bắt được double-credit.
function makePrisma(orders) {
    const store = new Map(orders.map((o) => [o.id, { ...o }]));
    const calls = { updateMany: 0, claimed: 0 };

    return {
        calls,
        store,
        order: {
            async findUnique({ where }) {
                const found = store.get(where.id);
                return found ? { ...found } : null;
            },
            async findMany({ where }) {
                return [...store.values()]
                    .filter((o) => (where.status ? o.status === where.status : true))
                    .filter((o) => (where.paymentMethod?.in ? where.paymentMethod.in.includes(o.paymentMethod) : true))
                    .filter((o) => (where.paymentRef?.in ? where.paymentRef.in.includes(o.paymentRef) : true))
                    .map((o) => ({ ...o }));
            },
            async updateMany({ where, data }) {
                calls.updateMany += 1;
                const found = store.get(where.id);
                if (!found) return { count: 0 };
                if (where.status && found.status !== where.status) return { count: 0 };
                Object.assign(found, data);
                calls.claimed += 1;
                return { count: 1 };
            },
            async update() {
                throw new Error("Unexpected order.update");
            },
        },
        walletTransaction: {
            async findMany() {
                return [];
            },
        },
    };
}

let prismaMock = makePrisma([]);
let transfersToReturn = [transfer];

const realCrypto = await import("../src/payment/crypto.js");
const { default: _cryptoDefault, ...cryptoNamed } = realCrypto;

mock.module(url("../src/lib/prisma.js"), {
    defaultExport: new Proxy({}, { get: (_t, prop) => prismaMock[prop] }),
});
mock.module(url("../src/delivery.js"), {
    namedExports: { deliverOrder: async () => ({ deliveryRef: "TEXT" }) },
});
mock.module(url("../src/coupon.js"), {
    namedExports: { releaseCoupon: async () => {} },
});
mock.module(url("../src/lib/logger.js"), {
    namedExports: { sendLog: () => {} },
});
mock.module(url("../src/wallet.js"), {
    namedExports: {
        confirmDeposit: async () => ({ success: false, error: "not used" }),
        TxStatus: { PENDING: "PENDING", SUCCESS: "SUCCESS", FAILED: "FAILED" },
        TxType: { DEPOSIT: "DEPOSIT" },
    },
});
mock.module(url("../src/shop-config.js"), {
    namedExports: {
        getCryptoConfigSync: () => ({}),
        getOrderExpireMinutesSync: () => 10,
    },
});
mock.module(url("../src/payment/crypto.js"), {
    namedExports: {
        ...cryptoNamed,
        fetchCryptoTransfers: async () => transfersToReturn.map((t) => ({ ...t })),
    },
});

const { confirmOrderByCryptoScan } = await import("../src/crypto-poller.js");

test("credits an order once and reports the repeat as already processed", async () => {
    prismaMock = makePrisma([baseOrder()]);
    transfersToReturn = [transfer];

    const first = await confirmOrderByCryptoScan("order-abc12345", "12345");
    assert.equal(first.success, true);
    assert.equal(first.alreadyProcessed, undefined);
    assert.equal(first.order.status, "PAID");
    assert.equal(first.order.paymentRef, EVENT_KEY);
    assert.equal(prismaMock.calls.claimed, 1);

    // Cùng txid, quét lần hai: gate status PENDING phải chặn, không cộng lần nữa.
    const second = await confirmOrderByCryptoScan("order-abc12345", "12345");
    assert.equal(second.success, true);
    assert.equal(second.alreadyProcessed, true);
    assert.equal(prismaMock.calls.claimed, 1, "order must be claimed exactly once");
    assert.equal(prismaMock.store.get("order-abc12345").paymentRef, EVENT_KEY);
});

test("refuses to confirm an order for a different telegram user", async () => {
    prismaMock = makePrisma([baseOrder()]);
    transfersToReturn = [transfer];

    const result = await confirmOrderByCryptoScan("order-abc12345", "99999");
    assert.equal(result.success, false);
    assert.equal(prismaMock.calls.claimed, 0);
    assert.equal(prismaMock.store.get("order-abc12345").status, "PENDING");
});

test("does not claim anything when no matching transfer exists", async () => {
    prismaMock = makePrisma([baseOrder()]);
    transfersToReturn = [{ ...transfer, amount: AMOUNT + 0.5 }];

    const result = await confirmOrderByCryptoScan("order-abc12345", "12345");
    assert.equal(result.success, false);
    assert.equal(prismaMock.calls.claimed, 0);
    assert.equal(prismaMock.store.get("order-abc12345").status, "PENDING");
});

// C2: hai đơn PENDING cùng amountToken -> một transfer khớp cả hai. Hiện tại
// hệ thống từ chối cả hai (an toàn nhưng khách bị treo tiền). Test ghim hành vi
// "không bao giờ credit nhầm"; fix C2 phải làm tình huống này không xảy ra nữa.
test("refuses to credit when two pending orders share the same unique amount", async () => {
    prismaMock = makePrisma([
        baseOrder(),
        baseOrder({ id: "order-collision", odelegramId: "12345", chatId: "12345" }),
    ]);
    transfersToReturn = [transfer];

    const result = await confirmOrderByCryptoScan("order-abc12345", "12345");
    assert.equal(result.success, false);
    assert.match(result.error, /trùng/i);
    assert.equal(prismaMock.calls.claimed, 0);
    assert.equal(prismaMock.store.get("order-abc12345").status, "PENDING");
    assert.equal(prismaMock.store.get("order-collision").status, "PENDING");
});
