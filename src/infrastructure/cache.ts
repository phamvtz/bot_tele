import { createLogger } from './logger.js';

const log = createLogger('Cache');

// ─── Simple in-memory TTL Cache ──────────────────────────────────────────────

interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

class MemoryCache {
  private store = new Map<string, CacheEntry<unknown>>();

  get<T>(key: string): T | null {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return null;
    }
    return entry.data as T;
  }

  set<T>(key: string, data: T, ttlMs: number): void {
    this.store.set(key, { data, expiresAt: Date.now() + ttlMs });
  }

  invalidate(key: string): void {
    this.store.delete(key);
  }

  invalidatePrefix(prefix: string): void {
    for (const key of this.store.keys()) {
      if (key.startsWith(prefix)) this.store.delete(key);
    }
  }

  clear(): void {
    this.store.clear();
    log.info('Cache cleared');
  }

  get size(): number {
    return this.store.size;
  }
}

// Dọn dẹp entries hết hạn mỗi 10 phút
const cache = new MemoryCache();

setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of (cache as any).store) {
    if (now > entry.expiresAt) (cache as any).store.delete(key);
  }
}, 10 * 60_000);

export default cache;

// ─── Cache Keys & TTLs ───────────────────────────────────────────────────────

export const CacheKeys = {
  CATEGORIES: 'categories:active',
  FEATURED:   'products:featured',
  categoryProducts: (catId: string, page: number) => `products:cat:${catId}:${page}`,
  productDetail: (id: string) => `product:${id}`,
} as const;

export const CacheTTL = {
  CATEGORIES:       30 * 60_000,   // 30 phút (admin invalidate khi sửa)
  PRODUCTS:         15 * 60_000,   // 15 phút
  PRODUCT_DETAIL:   20 * 60_000,   // 20 phút
} as const;
