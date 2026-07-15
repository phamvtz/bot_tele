import test from "node:test";
import assert from "node:assert/strict";
import { recoverPaidOrdersOnce } from "../src/delivery-recovery.js";

function fakePrisma(orders) {
    return {
        order: {
            async findMany(query) {
                assert.deepEqual(query.where, { status: "PAID" });
                return orders.slice(0, query.take);
            },
        },
    };
}

test("retries a paid order after a temporary delivery failure", async () => {
    const order = { id: "order-1", status: "PAID", createdAt: new Date() };
    const retryState = new Map();
    let calls = 0;
    const deliver = async () => {
        calls += 1;
        if (calls === 1) throw new Error("socket hang up");
        return { deliveryRef: "TEXT" };
    };

    const first = await recoverPaidOrdersOnce({
        prisma: fakePrisma([order]), telegram: {}, deliver, retryState, now: 1_000,
    });
    assert.equal(first.failed, 1);
    assert.equal(retryState.get(order.id).nextAttemptAt, 61_000);

    const tooSoon = await recoverPaidOrdersOnce({
        prisma: fakePrisma([order]), telegram: {}, deliver, retryState, now: 60_999,
    });
    assert.equal(tooSoon.skipped, 1);
    assert.equal(calls, 1);

    const recovered = await recoverPaidOrdersOnce({
        prisma: fakePrisma([order]), telegram: {}, deliver, retryState, now: 61_000,
    });
    assert.equal(recovered.delivered, 1);
    assert.equal(calls, 2);
    assert.equal(retryState.has(order.id), false);
});

test("only scans paid orders in bounded batches", async () => {
    const orders = Array.from({ length: 12 }, (_, index) => ({
        id: `order-${index}`,
        status: "PAID",
        createdAt: new Date(index),
    }));
    let calls = 0;

    const result = await recoverPaidOrdersOnce({
        prisma: fakePrisma(orders),
        telegram: {},
        batchSize: 3,
        deliver: async () => {
            calls += 1;
            return { deliveryRef: "TEXT" };
        },
    });

    assert.equal(result.found, 3);
    assert.equal(result.delivered, 3);
    assert.equal(calls, 3);
});
