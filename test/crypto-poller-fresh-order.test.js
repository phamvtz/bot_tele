import test from "node:test";
import assert from "node:assert/strict";
import { mock } from "node:test";

// H4: poller lấy danh sách order ở đầu tick. Nếu giao hàng bằng object đó thì
// mọi thay đổi giữa lúc đọc và lúc claim (admin sửa quantity/productId) bị bỏ
// qua — khách nhận sai hàng. Test ghim: deliverOrder phải nhận bản re-fetch.
const url = (path) => new URL(path, import.meta.url).href;

const TRC20_ADDRESS = "TQ3XyZfreshOrderTestAddress000000";
const AMOUNT = 12.303182;
const TXID = "0xfreshordertest";

process.env.TRC20_USDT_ADDRESS = TRC20_ADDRESS;
process.env.CRYPTO_PAY_ENABLED = "true";
process.env.CRYPTO_POLL_ENABLED = "true";

const STALE_ORDER = {
    id: "order-fresh001",
    odelegramId: "12345",
    chatId: "12345",
    status: "PENDING",
    paymentMethod: "crypto_trc20",
    cryptoNetwork: "trc20",
    cryptoAmount: AMOUNT,
    cryptoAddress: TRC20_ADDRESS,
    paymentRef: null,
    couponId: null,
    quantity: 1,
    productId: "product-old",
    createdAt: new Date(Date.now() - 60_000),
};

// findMany trả bản cũ (snapshot đầu tick), findUnique trả bản đã được sửa —
// mô phỏng admin sửa đơn ngay sau khi poller đọc danh sách.
const FRESH_ORDER = { ...STALE_ORDER, status: "PAID", quantity: 3, productId: "product-new" };

const delivered = [];

const prismaMock = {
    order: {
        async findMany({ where }) {
            if (where?.paymentRef?.in) return [];
            return [{ ...STALE_ORDER }];
        },
        async findUnique() {
            return { ...FRESH_ORDER };
        },
        async updateMany() {
            return { count: 1 };
        },
    },
    walletTransaction: {
        async findMany() {
            return [];
        },
        async updateMany() {
            return { count: 0 };
        },
    },
};

const realCrypto = await import("../src/payment/crypto.js");
const { default: _cryptoDefault, ...cryptoNamed } = realCrypto;

mock.module(url("../src/lib/prisma.js"), {
    defaultExport: new Proxy({}, { get: (_t, prop) => prismaMock[prop] }),
});
mock.module(url("../src/delivery.js"), {
    namedExports: {
        deliverOrder: async ({ order }) => {
            delivered.push(order);
            return { deliveryRef: "TEXT" };
        },
    },
});
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
        getCryptoConfigSync: () => ({}),
        getOrderExpireMinutesSync: () => 10,
    },
});
mock.module(url("../src/payment/crypto.js"), {
    namedExports: {
        ...cryptoNamed,
        fetchCryptoTransfers: async () => [{
            network: "trc20",
            txid: TXID,
            to: TRC20_ADDRESS,
            amount: AMOUNT,
            timestamp: Date.now(),
        }],
    },
});

const { startCryptoPolling } = await import("../src/crypto-poller.js");

test("delivers the re-fetched order, not the snapshot read at tick start", async () => {
    const poller = startCryptoPolling({ telegram: { sendMessage: async () => {} } });
    try {
        // tick() chạy ngay lúc start; chờ tới khi deliverOrder được gọi.
        for (let i = 0; i < 100 && !delivered.length; i += 1) {
            await new Promise((resolve) => setTimeout(resolve, 20));
        }
        assert.equal(delivered.length, 1, "order phải được giao đúng một lần");
        const order = delivered[0];
        assert.equal(order.quantity, 3, "phải dùng quantity mới, không phải snapshot");
        assert.equal(order.productId, "product-new", "phải dùng productId mới");
        assert.equal(order.status, "PAID");
    } finally {
        poller.stop();
    }
});
