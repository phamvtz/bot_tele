import test, { mock } from "node:test";
import assert from "node:assert/strict";

const url = (path) => new URL(path, import.meta.url).href;

const wallets = new Map([
    ["wallet-deposit", { id: "wallet-deposit", odelegramId: "1001", balance: 0 }],
    ["wallet-add", { id: "wallet-add", odelegramId: "1002", balance: 100 }],
    ["wallet-deduct", { id: "wallet-deduct", odelegramId: "1003", balance: 500 }],
]);
const txs = new Map();
const orders = new Map();
let failAuditFor = null;

function clone(value) { return value ? { ...value } : value; }

const prisma = {
    wallet: {
        async findUnique({ where }) {
            if (where.id) return clone(wallets.get(where.id));
            return clone([...wallets.values()].find((w) => w.odelegramId === where.odelegramId));
        },
        async create({ data }) {
            const row = { id: `wallet-${data.odelegramId}`, ...data };
            wallets.set(row.id, row);
            return clone(row);
        },
        async update({ where, data }) {
            const row = wallets.get(where.id);
            if (!row) throw new Error("wallet missing");
            row.balance += Number(data.balance?.increment || 0);
            return clone(row);
        },
        async updateMany({ where, data }) {
            const row = wallets.get(where.id);
            if (!row || (where.balance?.gte != null && row.balance < where.balance.gte)) return { count: 0 };
            row.balance += Number(data.balance?.increment || 0);
            return { count: 1 };
        },
    },
    walletTransaction: {
        async create({ data }) {
            const row = { id: `tx-${txs.size + 1}`, createdAt: new Date(), ...data };
            txs.set(row.id, row);
            return clone(row);
        },
        async updateMany({ where, data }) {
            const row = txs.get(where.id);
            if (!row || row.status !== where.status) return { count: 0 };
            Object.assign(row, data);
            return { count: 1 };
        },
        async findUnique({ where, include }) {
            const row = txs.get(where.id);
            if (!row) return null;
            return { ...clone(row), ...(include?.wallet ? { wallet: clone(wallets.get(row.walletId)) } : {}) };
        },
        async findFirst({ where }) {
            return clone([...txs.values()].find((row) =>
                (!where.orderId || row.orderId === where.orderId)
                && (!where.type || row.type === where.type)
                && (!where.status || row.status === where.status)
            ));
        },
        async update({ where, data }) {
            const row = txs.get(where.id);
            if (!row) throw new Error("tx missing");
            if (failAuditFor === row.id && (Object.hasOwn(data, "balanceAfter") || data.status === "SUCCESS")) {
                throw new Error("audit write failed");
            }
            Object.assign(row, data);
            return clone(row);
        },
    },
    order: {
        async updateMany({ where, data }) {
            const row = orders.get(where.id);
            if (!row || row.status !== where.status || row.paymentMethod !== where.paymentMethod) return { count: 0 };
            Object.assign(row, data);
            return { count: 1 };
        },
        async findUnique({ where }) { return clone(orders.get(where.id)); },
    },
};

mock.module(url("../src/db.js"), { namedExports: { prisma }, defaultExport: prisma });
mock.module(url("../src/bank-history.js"), { namedExports: { fetchBankHistory: async () => [] } });
mock.module(url("../src/menu-config.js"), { namedExports: { iconOf: () => "" } });

const { confirmDeposit, adminAddBalance, adminDeductBalance, promoteSettledWalletOrder } = await import("../src/wallet.js");

test("deposit đã cộng ví nhưng audit lỗi không bị mở lại để cộng lần hai", async () => {
    txs.set("dep-1", {
        id: "dep-1", walletId: "wallet-deposit", type: "DEPOSIT", amount: 1000,
        balanceBefore: 0, balanceAfter: 1000, status: "PENDING", paymentRef: null,
    });
    failAuditFor = "dep-1";
    const first = await confirmDeposit("dep-1", "BANK-1");
    assert.equal(first.success, true);
    assert.equal(first.auditPending, true);
    assert.equal(wallets.get("wallet-deposit").balance, 1000);
    assert.equal(txs.get("dep-1").status, "SUCCESS");
    assert.equal(txs.get("dep-1").paymentRef, "BANK-1");

    const second = await confirmDeposit("dep-1", "BANK-1");
    assert.equal(second.success, false);
    assert.equal(wallets.get("wallet-deposit").balance, 1000, "không được cộng lần hai");
    failAuditFor = null;
});

test("admin cộng ví: tiền đã cộng thì audit lỗi vẫn trả success", async () => {
    failAuditFor = "tx-2";
    const result = await adminAddBalance("1002", 250, "admin", "test");
    assert.equal(result.success, true);
    assert.equal(result.auditPending, true);
    assert.equal(wallets.get("wallet-add").balance, 350);
    failAuditFor = null;
});

test("admin trừ ví dùng conditional update và audit lỗi không báo failed giả", async () => {
    failAuditFor = "tx-3";
    const result = await adminDeductBalance("1003", 200, "admin", "test");
    assert.equal(result.success, true);
    assert.equal(result.auditPending, true);
    assert.equal(wallets.get("wallet-deduct").balance, 300);
    failAuditFor = null;
});
test("PURCHASE đã SUCCESS tự promote order PENDING thành PAID", async () => {
    orders.set("order-settle", { id: "order-settle", status: "PENDING", paymentMethod: "wallet" });
    txs.set("purchase-settle", {
        id: "purchase-settle", orderId: "order-settle", walletId: "wallet-add",
        type: "PURCHASE", status: "SUCCESS", amount: -50, createdAt: new Date(),
    });
    const result = await promoteSettledWalletOrder("order-settle", prisma);
    assert.equal(result.promoted, true);
    assert.equal(orders.get("order-settle").status, "PAID");
    assert.equal(orders.get("order-settle").paymentRef, "purchase-settle");
});