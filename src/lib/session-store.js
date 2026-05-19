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
export function createMongoSessionStore() {
    return {
        async get(key) {
            try {
                const coll = await getCollection();
                const doc = await coll.findOne({ _id: key });
                return doc?.data;
            } catch (err) {
                console.warn("[session.get] failed:", err.message);
                return undefined;
            }
        },

        async set(key, value) {
            try {
                const coll = await getCollection();
                await coll.updateOne(
                    { _id: key },
                    { $set: { data: value, updatedAt: new Date() } },
                    { upsert: true },
                );
            } catch (err) {
                console.warn("[session.set] failed:", err.message);
            }
        },

        async delete(key) {
            try {
                const coll = await getCollection();
                await coll.deleteOne({ _id: key });
            } catch (err) {
                console.warn("[session.delete] failed:", err.message);
            }
        },
    };
}

export default { createMongoSessionStore };
