import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";

import {
    verifyCryptoPayWebhook,
    processCryptoPayInvoicePaid,
    formatCryptoPayOrderMessage,
    formatCryptoPayDepositMessage,
} from "../src/payment/cryptopay.js";

// Helper để tạo chữ ký chuẩn theo Crypto Bot spec:
// secret = SHA256(token)
// signature = HMAC-SHA256(rawBody, secret).hex
function signBody(rawBody, token) {
    const secret = crypto.createHash("sha256").update(token).digest();
    return crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
}

test("verifyCryptoPayWebhook accepts valid HMAC-SHA256 signature", () => {
    const token = "12345:TEST_TOKEN_SECRET";
    const body = JSON.stringify({ update_id: 1, update_type: "invoice_paid", payload: { invoice_id: 999 } });
    const signature = signBody(body, token);

    const isValid = verifyCryptoPayWebhook(body, signature, token);
    assert.equal(isValid, true);
});

test("verifyCryptoPayWebhook rejects tampered body or forged signature", () => {
    const token = "12345:TEST_TOKEN_SECRET";
    const body = JSON.stringify({ update_id: 1, invoice_id: 999 });
    const signature = signBody(body, token);

    // Tampered body
    assert.equal(verifyCryptoPayWebhook(body + "tamper", signature, token), false);

    // Tampered signature
    const forgedSig = signature.slice(0, -4) + "0000";
    assert.equal(verifyCryptoPayWebhook(body, forgedSig, token), false);

    // Malformed / wrong length signature (must not crash, must return false)
    assert.equal(verifyCryptoPayWebhook(body, "not-a-valid-hex", token), false);
    assert.equal(verifyCryptoPayWebhook(body, "", token), false);
    assert.equal(verifyCryptoPayWebhook(body, null, token), false);
});

test("verifyCryptoPayWebhook returns false when unconfigured or token is empty", () => {
    const body = JSON.stringify({ update_id: 1 });
    assert.equal(verifyCryptoPayWebhook(body, "any-sig", ""), false);
    assert.equal(verifyCryptoPayWebhook(body, "any-sig", null), false);
    assert.equal(verifyCryptoPayWebhook(null, "any-sig", "some-token"), false);
    assert.equal(verifyCryptoPayWebhook(body, null, "some-token"), false);
});

test("formatCryptoPayOrderMessage and DepositMessage include essential details", () => {
    const orderMsg = formatCryptoPayOrderMessage({
        order: { id: "ORD-9999", totalVND: 150000, finalPrice: 150000, finalAmount: 150000, expiresAt: new Date(Date.now() + 1800000) },
        invoice: { invoice_id: 8888, amount: "6.0", asset: "USDT" },
        productName: "Tài khoản Premium",
        usdVndRate: 25000,
    });
    assert.match(orderMsg, /ORD-9999/);
    assert.match(orderMsg, /6\.0 USDT/);
    assert.match(orderMsg, /Tài khoản Premium/);
    assert.match(orderMsg, /25[.,]000/);

    const depositMsg = formatCryptoPayDepositMessage({
        tx: { id: "TX-7777", amount: 254000, expiresAt: new Date(Date.now() + 1800000) },
        invoice: { invoice_id: 7777, amount: "10.0", asset: "USDT" },
        usdVndRate: 25400,
    });
    assert.match(depositMsg, /10\.0 USDT/);
    assert.match(depositMsg, /254[.,]000/);
    assert.match(depositMsg, /7777/);
});

// Mock database builder for processCryptoPayInvoicePaid
function makeMockDb({ order = null, tx = null } = {}) {
    const events = new Map();
    const orders = new Map();
    const txs = new Map();
    if (order) orders.set(order.id, { ...order });
    if (tx) txs.set(tx.id, { ...tx });

    return {
        events,
        orders,
        txs,
        order: {
            async findUnique({ where }) {
                return orders.get(where.id) || null;
            },
            async findFirst({ where }) {
                if (where?.paymentRef) {
                    for (const o of orders.values()) {
                        if (o.paymentRef === where.paymentRef) return o;
                    }
                }
                return orders.get(where?.id) || null;
            },
            async update({ where, data }) {
                const existing = orders.get(where.id);
                if (!existing) throw new Error("Order not found");
                Object.assign(existing, data);
                return { ...existing };
            },
            async findMany({ where } = {}) {
                if (where?.paymentRef?.in) {
                    const set = new Set(where.paymentRef.in);
                    return Array.from(orders.values()).filter((o) => set.has(o.paymentRef));
                }
                return Array.from(orders.values());
            },
        },
        walletTransaction: {
            async findUnique({ where }) {
                return txs.get(where.id) || null;
            },
            async findFirst({ where }) {
                if (where?.paymentRef) {
                    for (const t of txs.values()) {
                        if (t.paymentRef === where.paymentRef) return t;
                    }
                }
                return txs.get(where?.id) || null;
            },
            async update({ where, data }) {
                const existing = txs.get(where.id);
                if (!existing) throw new Error("Transaction not found");
                Object.assign(existing, data);
                return { ...existing };
            },
            async findMany({ where } = {}) {
                if (where?.paymentRef?.in) {
                    const set = new Set(where.paymentRef.in);
                    return Array.from(txs.values()).filter((t) => set.has(t.paymentRef));
                }
                return Array.from(txs.values());
            },
        },
        paymentEvent: {
            async create({ data }) {
                if (events.has(data.eventKey)) {
                    const err = new Error("Unique constraint failed");
                    err.code = "P2002";
                    throw err;
                }
                const row = { id: `evt-${events.size + 1}`, createdAt: new Date(), ...data };
                events.set(data.eventKey, row);
                return row;
            },
            async findUnique({ where }) {
                return events.get(where.eventKey) || null;
            },
            async update({ where, data }) {
                const row = events.get(where.eventKey);
                if (row) Object.assign(row, data);
                return row;
            },
            async delete({ where }) {
                for (const [k, v] of events) {
                    if (v.id === where.id) events.delete(k);
                }
            },
        },
    };
}

test("processCryptoPayInvoicePaid settles order and prevents double delivery", async () => {
    let delivered = 0;
    const mockOrder = {
        id: "order-test-1",
        telegramId: "user-100",
        chatId: "user-100",
        status: "PENDING",
        productId: "prod-1",
        finalPrice: 100000,
        totalVND: 100000,
        cryptoToken: "USDT",
        cryptoAmount: 3.94,
        product: { name: "Test Product" },
    };
    const mockDb = makeMockDb({ order: mockOrder });

    const invoice = {
        invoice_id: 123456,
        status: "paid",
        amount: "3.94",
        asset: "USDT",
        payload: "order:order-test-1",
    };

    // First call: delivery must succeed
    const res1 = await processCryptoPayInvoicePaid({
        invoice,
        prisma: mockDb,
        telegram: {
            async sendMessage() {},
        },
        deliverOrderFn: async ({ order }) => {
            delivered += 1;
            return { success: true };
        },
    });

    assert.equal(res1.success, true);
    assert.equal(delivered, 1);
    assert.equal(mockDb.orders.get("order-test-1").status, "PAID");

    // Second call: duplicate webhook event -> must NOT deliver again
    const res2 = await processCryptoPayInvoicePaid({
        invoice,
        prisma: mockDb,
        telegram: {
            async sendMessage() {},
        },
        deliverOrderFn: async ({ order }) => {
            delivered += 1;
            return { success: true };
        },
    });

    assert.equal(res2.success, true);
    assert.equal(delivered, 1, "Must not trigger deliverOrder twice");
});

test("processCryptoPayInvoicePaid credits wallet deposit and prevents double credit", async () => {
    let depositConfirmed = 0;
    const mockTx = {
        id: "tx-test-1",
        amount: 254000,
        status: "PENDING",
        cryptoToken: "USDT",
        cryptoAmount: 10,
        wallet: { odelegramId: "user-200" },
    };
    const mockDb = makeMockDb({ tx: mockTx });

    const invoice = {
        invoice_id: 654321,
        status: "paid",
        amount: "10.0",
        asset: "USDT",
        payload: "deposit:tx-test-1",
    };

    const res1 = await processCryptoPayInvoicePaid({
        invoice,
        prisma: mockDb,
        telegram: {
            async sendMessage() {},
        },
        confirmDepositFn: async (txId, eventKey) => {
            depositConfirmed += 1;
            mockDb.txs.get(txId).status = "SUCCESS";
            return { success: true, newBalance: 254000 };
        },
    });

    assert.equal(res1.success, true);
    assert.equal(depositConfirmed, 1);

    // Duplicate call with same invoice
    const res2 = await processCryptoPayInvoicePaid({
        invoice,
        prisma: mockDb,
        telegram: {
            async sendMessage() {},
        },
        confirmDepositFn: async (txId, eventKey) => {
            depositConfirmed += 1;
            return { success: true, newBalance: 254000 };
        },
    });

    assert.equal(res2.success, true);
    assert.equal(depositConfirmed, 1, "Must not credit wallet twice");
});

test("processCryptoPayInvoicePaid rejects mismatched user ID for order", async () => {
    const mockOrder = {
        id: "order-mismatch",
        telegramId: "user-real",
        chatId: "user-real",
        status: "PENDING",
        cryptoToken: "USDT",
        cryptoAmount: 5.0,
    };
    const mockDb = makeMockDb({ order: mockOrder });

    const invoice = {
        invoice_id: 999999,
        status: "paid",
        amount: "5.0",
        asset: "USDT",
        payload: JSON.stringify({
            kind: "ORDER",
            orderId: "order-mismatch",
            telegramId: "user-attacker",
        }),
    };

    const res = await processCryptoPayInvoicePaid({
        invoice,
        prisma: mockDb,
        telegram: { async sendMessage() {} },
    });

    assert.equal(res.success, false);
    assert.match(res.reason, /Telegram ID mismatch/);
    assert.equal(mockDb.orders.get("order-mismatch").status, "PENDING");
});

test("processCryptoPayInvoicePaid rejects underpayment or wrong asset", async () => {
    const mockOrder = {
        id: "order-underpay",
        telegramId: "user-1",
        status: "PENDING",
        cryptoToken: "USDT",
        cryptoAmount: 10.0,
    };
    const mockDb = makeMockDb({ order: mockOrder });

    // Underpayment: pays 5 USDT for a 10 USDT order
    const resUnderpay = await processCryptoPayInvoicePaid({
        invoice: {
            invoice_id: 111111,
            status: "paid",
            amount: "5.0",
            asset: "USDT",
            payload: "order:order-underpay",
        },
        prisma: mockDb,
    });
    assert.equal(resUnderpay.success, false);
    assert.match(resUnderpay.error, /Insufficient payment/);

    // Wrong asset: pays TON instead of USDT
    const resAsset = await processCryptoPayInvoicePaid({
        invoice: {
            invoice_id: 222222,
            status: "paid",
            amount: "10.0",
            asset: "TON",
            payload: "order:order-underpay",
        },
        prisma: mockDb,
    });
    assert.equal(resAsset.success, false);
    assert.match(resAsset.error, /Asset mismatch/);
});
