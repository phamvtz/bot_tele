import test from "node:test";
import assert from "node:assert/strict";
import { claimPaymentEvent, completePaymentEvent } from "../src/lib/payment-events.js";

function makeDb({ legacyOrders = [], legacyTxs = [], duplicateCode = 11000 } = {}) {
    const events = new Map();
    return {
        events,
        order: { async findMany() { return legacyOrders; } },
        walletTransaction: { async findMany() { return legacyTxs; } },
        paymentEvent: {
            async create({ data }) {
                if (events.has(data.eventKey)) {
                    const error = duplicateCode === "P2002"
                        ? new Error("Unique constraint failed on the fields: (`eventKey`)")
                        : new Error("E11000 duplicate key");
                    error.code = duplicateCode;
                    throw error;
                }
                const row = { id: `evt-${events.size + 1}`, createdAt: new Date(), ...data };
                events.set(data.eventKey, row);
                return { ...row };
            },
            async findUnique({ where }) { return events.get(where.eventKey) || null; },
            async update({ where, data }) {
                const row = events.get(where.eventKey);
                Object.assign(row, data);
                return { ...row };
            },
            async delete({ where }) {
                for (const [key, row] of events) if (row.id === where.id) events.delete(key);
            },
        },
    };
}

test("một event chỉ được claim cho đúng một target", async () => {
    const db = makeDb();
    const first = await claimPaymentEvent("CRYPTO:trc20:0x1", { kind: "CRYPTO_ORDER", targetId: "order-1" }, db);
    const same = await claimPaymentEvent("CRYPTO:trc20:0x1", { kind: "CRYPTO_ORDER", targetId: "order-1" }, db);
    const other = await claimPaymentEvent("CRYPTO:trc20:0x1", { kind: "CRYPTO_DEPOSIT", targetId: "deposit-2" }, db);
    assert.equal(first.claimed, true);
    assert.equal(same.alreadyClaimed, true);
    assert.equal(same.conflict, false);
    assert.equal(other.conflict, true);
});

test("Prisma/PostgreSQL P2002 cũng được nhận diện là duplicate claim", async () => {
    const db = makeDb({ duplicateCode: "P2002" });
    await claimPaymentEvent("BANK-PG-1", { kind: "BANK_ORDER", targetId: "order-pg" }, db);

    const same = await claimPaymentEvent("BANK-PG-1", { kind: "BANK_ORDER", targetId: "order-pg" }, db);
    const other = await claimPaymentEvent("BANK-PG-1", { kind: "BANK_DEPOSIT", targetId: "deposit-pg" }, db);

    assert.equal(same.alreadyClaimed, true);
    assert.equal(same.conflict, false);
    assert.equal(other.conflict, true);
});

test("paymentRef cũ trước khi có ledger vẫn chặn replay", async () => {
    const db = makeDb({ legacyOrders: [{ id: "old-order", paymentRef: "BANK-OLD" }] });
    const conflict = await claimPaymentEvent("BANK-OLD", { kind: "BANK_DEPOSIT", targetId: "dep-new" }, db);
    assert.equal(conflict.conflict, true);
    assert.equal(db.events.size, 0);
});

test("event được chốt PROCESSED sau khi nghiệp vụ thành công", async () => {
    const db = makeDb();
    await claimPaymentEvent("BANK-2", { kind: "BANK_ORDER", targetId: "order-2" }, db);
    await completePaymentEvent("BANK-2", { status: "PROCESSED" }, db);
    assert.equal(db.events.get("BANK-2").status, "PROCESSED");
});