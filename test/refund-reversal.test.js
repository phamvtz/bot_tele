import test from "node:test";
import assert from "node:assert/strict";
import { reverseRefundTransaction } from "../src/wallet.js";

function createDb({ balance = 150_000, existingReversal = null } = {}) {
    const state = {
        wallet: { id: "wallet-1", odelegramId: "123456", balance },
        refund: {
            id: "refund-abcdef12",
            walletId: "wallet-1",
            type: "REFUND",
            status: "SUCCESS",
            amount: 50_000,
            orderId: "order-1",
        },
        reversal: existingReversal,
        debitCalls: 0,
    };

    return {
        state,
        wallet: {
            async findUnique() { return { ...state.wallet }; },
            async updateMany({ where, data }) {
                state.debitCalls += 1;
                if (state.wallet.balance < where.balance.gte) return { count: 0 };
                state.wallet.balance += data.balance.increment;
                return { count: 1 };
            },
            async update({ data }) {
                state.wallet.balance += data.balance.increment;
                return { ...state.wallet };
            },
        },
        walletTransaction: {
            async findUnique() { return { ...state.refund }; },
            async findFirst() { return state.reversal ? { ...state.reversal } : null; },
            async create({ data }) {
                state.reversal = { id: "reversal-1", ...data };
                return { ...state.reversal };
            },
            async update({ where, data }) {
                if (where.id === state.refund.id) Object.assign(state.refund, data);
                return { ...state.refund };
            },
        },
    };
}

test("reverses one successful refund and records an opposite transaction", async () => {
    const db = createDb();
    const result = await reverseRefundTransaction(db.state.refund.id, "admin-1", db);

    assert.equal(result.success, true);
    assert.equal(result.newBalance, 100_000);
    assert.equal(db.state.wallet.balance, 100_000);
    assert.equal(db.state.reversal.type, "REFUND_REVERSAL");
    assert.equal(db.state.reversal.amount, -50_000);
    assert.equal(db.state.reversal.reversalOfId, db.state.refund.id);
    assert.equal(db.state.refund.reversalTransactionId, "reversal-1");
});

test("does not debit a refund that was already reversed", async () => {
    const existing = {
        id: "reversal-existing",
        type: "REFUND_REVERSAL",
        status: "SUCCESS",
        amount: -50_000,
        balanceAfter: 100_000,
        reversalOfId: "refund-abcdef12",
    };
    const db = createDb({ existingReversal: existing });
    const result = await reverseRefundTransaction(db.state.refund.id, "admin-1", db);

    assert.equal(result.success, true);
    assert.equal(result.alreadyProcessed, true);
    assert.equal(db.state.wallet.balance, 150_000);
    assert.equal(db.state.debitCalls, 0);
});

test("refuses reversal when the customer wallet has insufficient balance", async () => {
    const db = createDb({ balance: 10_000 });
    const result = await reverseRefundTransaction(db.state.refund.id, "admin-1", db);

    assert.equal(result.success, false);
    assert.equal(result.code, "INSUFFICIENT_BALANCE");
    assert.equal(db.state.wallet.balance, 10_000);
    assert.equal(db.state.reversal, null);
});

test("restores the wallet balance when the reversal audit record cannot be created", async () => {
    const db = createDb();
    db.walletTransaction.create = async () => { throw new Error("database write failed"); };

    await assert.rejects(
        reverseRefundTransaction(db.state.refund.id, "admin-1", db),
        /database write failed/,
    );
    assert.equal(db.state.wallet.balance, 150_000);
});
