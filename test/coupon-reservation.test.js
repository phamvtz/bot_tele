import test, { mock } from "node:test";
import assert from "node:assert/strict";

const url = (path) => new URL(path, import.meta.url).href;
const coupon = { id: "coupon-1", isActive: true, maxUses: 1, usedCount: 0, expiresAt: null };
const order = { id: "order-1", couponId: coupon.id, couponReservedAt: null, couponReleasedAt: null };
const prisma = {
    coupon: {
        async findUnique() { return { ...coupon }; },
        async updateMany({ where, data }) {
            if (where.usedCount?.lt != null && coupon.usedCount >= where.usedCount.lt) return { count: 0 };
            if (where.usedCount?.gt != null && coupon.usedCount <= where.usedCount.gt) return { count: 0 };
            coupon.usedCount += Number(data.usedCount?.increment || 0);
            return { count: 1 };
        },
    },
    order: {
        async findUnique() { return { ...order }; },
        async update({ data }) { Object.assign(order, data); return { ...order }; },
        async updateMany({ where, data }) {
            if (where.couponId != null && order.couponId !== where.couponId) return { count: 0 };
            if (where.couponReservedAt === null && order.couponReservedAt != null) return { count: 0 };
            if (where.couponReservedAt?.not === null && order.couponReservedAt == null) return { count: 0 };
            if (where.couponReleasedAt === null && order.couponReleasedAt != null) return { count: 0 };
            if (where.couponReleasedAt instanceof Date && order.couponReleasedAt !== where.couponReleasedAt) return { count: 0 };
            Object.assign(order, data);
            return { count: 1 };
        },
    },
};
mock.module(url("../src/db.js"), { namedExports: { prisma }, defaultExport: prisma });
const { reserveCouponForOrder, releaseOrderCoupon } = await import("../src/coupon.js");

test("lượt coupon cuối được reserve atomically và lượt kế tiếp bị từ chối", async () => {
    const first = await reserveCouponForOrder(order.id, coupon.id);
    assert.equal(first.reserved, true);
    assert.equal(coupon.usedCount, 1);
    assert.ok(order.couponReservedAt);

    const secondOrder = { ...order, id: "order-2", couponReservedAt: null, couponReleasedAt: null };
    Object.assign(order, secondOrder);
    const second = await reserveCouponForOrder(order.id, coupon.id);
    assert.equal(second.reserved, false);
    assert.equal(coupon.usedCount, 1);
});

test("hai callback cùng order chỉ giữ đúng một lượt coupon", async () => {
    Object.assign(coupon, { maxUses: 2, usedCount: 0 });
    Object.assign(order, { id: "order-race", couponId: coupon.id, couponReservedAt: null, couponReleasedAt: null });

    const [first, second] = await Promise.all([
        reserveCouponForOrder(order.id, coupon.id),
        reserveCouponForOrder(order.id, coupon.id),
    ]);

    assert.equal(first.reserved, true);
    assert.equal(second.reserved, true);
    assert.equal(Number(first.alreadyReserved || false) + Number(second.alreadyReserved || false), 1);
    assert.equal(coupon.usedCount, 1);
    assert.ok(order.couponReservedAt);
});

test("release theo marker chỉ decrement đúng một lần", async () => {
    Object.assign(order, { id: "order-3", couponId: coupon.id, couponReservedAt: new Date(), couponReleasedAt: null });
    coupon.usedCount = 1;
    assert.equal(await releaseOrderCoupon(order.id), true);
    assert.equal(await releaseOrderCoupon(order.id), false);
    assert.equal(coupon.usedCount, 0);
});