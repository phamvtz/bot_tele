/**
 * In-memory cache với TTL.
 * Dùng cho dữ liệu hot path: user info, wallet balance, settings...
 *
 * API:
 *   const cache = createCache(ttlMs)
 *   cache.get(key)               → value | undefined
 *   cache.set(key, value)
 *   cache.invalidate(key | null) → clear 1 key, hoặc clear hết nếu null
 *   cache.getOrLoad(key, loader) → cache-aside pattern (auto load + cache)
 */

export function createCache(ttlMs = 30000) {
    const store = new Map();

    function get(key) {
        const entry = store.get(key);
        if (!entry) return undefined;
        if (Date.now() - entry.ts > ttlMs) {
            store.delete(key);
            return undefined;
        }
        return entry.value;
    }

    function set(key, value) {
        store.set(key, { value, ts: Date.now() });
    }

    function invalidate(key) {
        if (key === null || key === undefined) {
            store.clear();
        } else {
            store.delete(key);
        }
    }

    async function getOrLoad(key, loader) {
        const cached = get(key);
        if (cached !== undefined) return cached;
        const value = await loader();
        if (value !== undefined && value !== null) set(key, value);
        return value;
    }

    function size() {
        return store.size;
    }

    // Periodic cleanup (mỗi 5 phút)
    const cleanupTimer = setInterval(() => {
        const now = Date.now();
        for (const [key, entry] of store.entries()) {
            if (now - entry.ts > ttlMs) store.delete(key);
        }
    }, 5 * 60 * 1000);
    cleanupTimer.unref?.();

    return { get, set, invalidate, getOrLoad, size };
}

// Caches dùng chung cho bot
export const userCache = createCache(60_000); // 60s — user info
export const balanceCache = createCache(60_000); // 60s — wallet balance (invalidated explicitly on every tx)
export const settingsCache = createCache(120_000); // 2 min — shop settings

export default { createCache, userCache, balanceCache, settingsCache };
