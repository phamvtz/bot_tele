/**
 * Telegraf session store backed by MongoDB.
 * Giữ session qua restart (pendingOrder, language, processingPayment...).
 *
 * Session document schema (collection `botSessions`):
 *   { _id: "<chatId:userId>", data: <session object>, updatedAt: Date }
 */

import prisma from "./prisma.js";

const COLLECTION = "botSessions";

let _coll = null;
async function getCollection() {
    if (_coll) return _coll;
    // Reuse adapter's connect logic — settings collection is always loaded
    const settingDelegate = prisma.setting;
    const settingsCol = await settingDelegate.collection();
    _coll = settingsCol.s.db.collection(COLLECTION);
    // Index để cleanup session cũ (TTL)
    try {
        await _coll.createIndex({ updatedAt: 1 }, { expireAfterSeconds: 30 * 24 * 3600 });
    } catch {
        // Already exists or conflicting — ignore
    }
    return _coll;
}

/**
 * Telegraf-compatible session store.
 * Telegraf docs: https://telegraf.js.org/#/?id=session
 */
// In-memory cache — eliminates MongoDB read on every callback (~150ms saved per request)
const _memCache = new Map();
const _memCacheTs = new Map(); // key → timestamp for TTL cleanup
const SESSION_TTL_MS = 30 * 60 * 1000; // 30 min
setInterval(() => {
    const cutoff = Date.now() - SESSION_TTL_MS;
    for (const [k, ts] of _memCacheTs.entries()) {
        if (ts < cutoff) { _memCache.delete(k); _memCacheTs.delete(k); }
    }
}, 10 * 60 * 1000).unref?.();

export function createMongoSessionStore() {
    return {
        async get(key) {
            // Return from memory instantly if available
            if (_memCache.has(key)) return _memCache.get(key);
            try {
                const coll = await getCollection();
                const doc = await coll.findOne({ _id: key });
                const data = doc?.data;
                if (data !== undefined) { _memCache.set(key, data); _memCacheTs.set(key, Date.now()); }
                return data;
            } catch (err) {
                console.warn("[session.get] failed:", err.message);
                return undefined;
            }
        },

        async set(key, value) {
            // Update memory immediately — user gets instant response
            _memCache.set(key, value); _memCacheTs.set(key, Date.now());
            // Persist to MongoDB async (non-blocking)
            getCollection().then(coll =>
                coll.updateOne(
                    { _id: key },
                    { $set: { data: value, updatedAt: new Date() } },
                    { upsert: true },
                )
            ).catch(err => console.warn("[session.set] failed:", err.message));
        },

        async delete(key) {
            _memCache.delete(key); _memCacheTs.delete(key);
            getCollection().then(coll => coll.deleteOne({ _id: key }))
                .catch(err => console.warn("[session.delete] failed:", err.message));
        },
    };
}

export default { createMongoSessionStore };
