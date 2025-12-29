import { prisma } from "./db.js";

/**
 * Coupon Module
 * Handles discount code validation and application
 */

/**
 * Validate and get coupon details
 * @param {string} code - Coupon code
 * @param {number} orderAmount - Order amount to check minimum
 * @returns {{ valid: boolean, coupon?: object, error?: string }}
 */
export async function validateCoupon(code, orderAmount) {
    const coupon = await prisma.coupon.findUnique({
        where: { code: code.toUpperCase() },
    });

    if (!coupon) {
        return { valid: false, error: "INVALID" };
    }

    if (!coupon.isActive) {
        return { valid: false, error: "INVALID" };
    }

    if (coupon.expiresAt && coupon.expiresAt < new Date()) {
        return { valid: false, error: "EXPIRED" };
    }

    if (coupon.maxUses && coupon.usedCount >= coupon.maxUses) {
        return { valid: false, error: "USED_UP" };
    }

    if (coupon.minOrder && orderAmount < coupon.minOrder) {
        return { valid: false, error: "MIN_ORDER", minOrder: coupon.minOrder };
    }

    return { valid: true, coupon };
}

/**
 * Calculate discount amount
 * @param {object} coupon - Coupon object
 * @param {number} orderAmount - Order amount
 * @returns {number} Discount amount
 */
export function calculateDiscount(coupon, orderAmount) {
    let discount = 0;

    if (coupon.discountType === "PERCENT") {
        discount = Math.floor((orderAmount * coupon.discount) / 100);
    } else {
        discount = coupon.discount;
    }

    // Apply max discount if set
    if (coupon.maxDiscount && discount > coupon.maxDiscount) {
        discount = coupon.maxDiscount;
    }

    // Don't discount more than order amount
    if (discount > orderAmount) {
        discount = orderAmount;
    }

    return discount;
}

/**
 * Apply coupon to order (increment usage)
 */
export async function applyCoupon(couponId) {
    await prisma.coupon.update({
        where: { id: couponId },
        data: { usedCount: { increment: 1 } },
    });
}

/**
 * Create a new coupon
 */
export async function createCoupon(data) {
    return await prisma.coupon.create({
        data: {
            code: data.code.toUpperCase(),
            discount: data.discount,
            discountType: data.discountType || "PERCENT",
            maxUses: data.maxUses,
            minOrder: data.minOrder,
            maxDiscount: data.maxDiscount,
            expiresAt: data.expiresAt,
            isActive: true,
        },
    });
}

/**
 * List all coupons
 */
export async function listCoupons() {
    return await prisma.coupon.findMany({
        orderBy: { createdAt: "desc" },
    });
}

/**
 * Toggle coupon active status
 */
export async function toggleCoupon(code) {
    const coupon = await prisma.coupon.findUnique({ where: { code } });
    if (!coupon) return null;

    return await prisma.coupon.update({
        where: { code },
        data: { isActive: !coupon.isActive },
    });
}

/**
 * Delete coupon
 */
export async function deleteCoupon(code) {
    return await prisma.coupon.delete({ where: { code } });
}

export default {
    validateCoupon,
    calculateDiscount,
    applyCoupon,
    createCoupon,
    listCoupons,
    toggleCoupon,
    deleteCoupon,
};
