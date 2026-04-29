import { createLogger } from './logger.js';
const log = createLogger('Cache');
class MemoryCache {
    store = new Map();
    get(key) {
        const entry = this.store.get(key);
        if (!entry)
            return null;
        if (Date.now() > entry.expiresAt) {
            this.store.delete(key);
            return null;
        }
        return entry.data;
    }
    set(key, data, ttlMs) {
        this.store.set(key, { data, expiresAt: Date.now() + ttlMs });
    }
    invalidate(key) {
        this.store.delete(key);
    }
    invalidatePrefix(prefix) {
        for (const key of this.store.keys()) {
            if (key.startsWith(prefix))
                this.store.delete(key);
        }
    }
    clear() {
        this.store.clear();
        log.info('Cache cleared');
    }
    get size() {
        return this.store.size;
    }
}
// Dọn dẹp entries hết hạn mỗi 10 phút
const cache = new MemoryCache();
setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of cache.store) {
        if (now > entry.expiresAt)
            cache.store.delete(key);
    }
}, 10 * 60_000);
export default cache;
// ─── Cache Keys & TTLs ───────────────────────────────────────────────────────
export const CacheKeys = {
    CATEGORIES: 'categories:active',
    FEATURED: 'products:featured',
    categoryProducts: (catId, page) => `products:cat:${catId}:${page}`,
    productDetail: (id) => `product:${id}`,
};
export const CacheTTL = {
    CATEGORIES: 30 * 60_000, // 30 phút (admin invalidate khi sửa)
    PRODUCTS: 15 * 60_000, // 15 phút
    PRODUCT_DETAIL: 20 * 60_000, // 20 phút
};
