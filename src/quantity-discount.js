import { prisma } from "./db.js";

/**
 * Quantity discount module
 *
 * Tiers được admin cấu hình per-product, lưu trong Setting key "quantity_discounts":
 *   { [productId]: [{ minQty, discountPercent }, ...] }
 *
 * Khi mua >= minQty → áp dụng discountPercent. Mức cao nhất phù hợp (minQty lớn nhất
 * mà <= quantity) sẽ được dùng.
 */

const QTY_DISCOUNT_KEY = "quantity_discounts";

let _cache = null;
let _cacheTs = 0;
const CACHE_TTL = 30000; // 30s

async function getMap() {
    if (_cache && Date.now() - _cacheTs < CACHE_TTL) return _cache;
    try {
        const s = await prisma.setting.findUnique({ where: { key: QTY_DISCOUNT_KEY } });
        _cache = s ? (JSON.parse(s.value) || {}) : {};
    } catch {
        _cache = {};
    }
    _cacheTs = Date.now();
    return _cache;
}

export function invalidateQuantityDiscountCache() {
    _cache = null;
    _cacheTs = 0;
}

/**
 * Lấy % giảm áp dụng cho 1 product với 1 quantity nhất định.
 * @returns {number} 0..100
 */
export async function getQuantityDiscountPercent(productId, quantity) {
    if (!productId || !quantity || quantity < 2) return 0;
    const map = await getMap();
    const tiers = map[productId];
    if (!Array.isArray(tiers) || !tiers.length) return 0;

    let best = 0;
    for (const t of tiers) {
        const minQty = Number(t.minQty) || 0;
        const pct = Number(t.discountPercent) || 0;
        if (quantity >= minQty && pct > best) best = pct;
    }
    return Math.min(100, Math.max(0, best));
}

/**
 * Tính số tiền sau giảm giá số lượng.
 * @returns {{ amount, discount, finalAmount, discountPercent }}
 */
export async function applyQuantityDiscount(productId, unitPrice, quantity) {
    const amount = unitPrice * quantity;
    const percent = await getQuantityDiscountPercent(productId, quantity);
    const discount = Math.floor((amount * percent) / 100);
    return {
        amount,
        discount,
        finalAmount: amount - discount,
        discountPercent: percent,
    };
}

export default { getQuantityDiscountPercent, applyQuantityDiscount, invalidateQuantityDiscountCache };
