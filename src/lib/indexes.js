/**
 * MongoDB index setup
 *
 * Tạo các compound index cho các query nóng. Chạy 1 lần lúc khởi động,
 * idempotent (Mongo bỏ qua nếu index đã tồn tại).
 */

import prisma from "./prisma.js";

// Map từ tên collection → model delegate trong adapter prisma
const COLLECTION_TO_MODEL = {
    users: "user",
    categories: "category",
    products: "product",
    stockItems: "stockItem",
    orders: "order",
    coupons: "coupon",
    referrals: "referral",
    settings: "setting",
    auditLogs: "auditLog",
    vipLevels: "vipLevel",
    wallets: "wallet",
    walletTransactions: "walletTransaction",
};

const INDEXES = [
    // users — lookup by telegramId rất nhiều
    { collection: "users", spec: { telegramId: 1 }, options: { unique: true } },
    { collection: "users", spec: { referralCode: 1 }, options: { unique: true, sparse: true } },
    { collection: "users", spec: { vipLevel: 1 } },

    // categories — list active by order
    { collection: "categories", spec: { isActive: 1, order: 1 } },

    // products — filter by category + active
    { collection: "products", spec: { categoryId: 1, isActive: 1 } },
    { collection: "products", spec: { code: 1 }, options: { unique: true } },
    { collection: "products", spec: { isActive: 1, createdAt: -1 } },

    // stockItems — get available stock for product
    { collection: "stockItems", spec: { productId: 1, isSold: 1 } },
    { collection: "stockItems", spec: { orderId: 1 } },

    // orders — frequent listing/filter
    { collection: "orders", spec: { odelegramId: 1, createdAt: -1 } },
    { collection: "orders", spec: { status: 1, createdAt: -1 } },
    { collection: "orders", spec: { status: 1, paymentMethod: 1 } },
    { collection: "orders", spec: { productId: 1, status: 1 } },
    { collection: "orders", spec: { paymentRef: 1 }, options: { sparse: true } },

    // coupons
    { collection: "coupons", spec: { code: 1 }, options: { unique: true } },

    // referrals
    { collection: "referrals", spec: { referrerId: 1 } },
    { collection: "referrals", spec: { refereeId: 1 }, options: { unique: true } },

    // wallets
    { collection: "wallets", spec: { odelegramId: 1 }, options: { unique: true } },

    // walletTransactions
    { collection: "walletTransactions", spec: { walletId: 1, createdAt: -1 } },
    { collection: "walletTransactions", spec: { type: 1, status: 1 } },
    { collection: "walletTransactions", spec: { paymentRef: 1 }, options: { sparse: true } },
    { collection: "walletTransactions", spec: { reversalOfId: 1 }, options: { unique: true, sparse: true } },
    { collection: "walletTransactions", spec: { refundKey: 1 }, options: { unique: true, sparse: true } },

    // settings
    { collection: "settings", spec: { key: 1 }, options: { unique: true } },

    // auditLogs
    { collection: "auditLogs", spec: { adminId: 1, createdAt: -1 } },
    { collection: "auditLogs", spec: { action: 1, createdAt: -1 } },

    // vipLevels
    { collection: "vipLevels", spec: { level: 1 }, options: { unique: true } },
];

export async function ensureIndexes() {
    let created = 0;
    let skipped = 0;
    let failed = 0;

    for (const { collection, spec, options = {} } of INDEXES) {
        const modelName = COLLECTION_TO_MODEL[collection];
        if (!modelName || !prisma[modelName]?.collection) {
            console.warn(`[indexes] unknown collection: ${collection}`);
            continue;
        }

        try {
            const coll = await prisma[modelName].collection();
            await coll.createIndex(spec, options);
            created++;
        } catch (err) {
            // Existing conflicting index → safe to skip
            if (err?.code === 85 || err?.code === 86 || /already exists|already exist/i.test(err?.message || "")) {
                skipped++;
            } else {
                failed++;
                console.warn(`[indexes] ${collection} ${JSON.stringify(spec)}: ${err.message}`);
            }
        }
    }

    console.log(`📑 Indexes: ${created} created/ok, ${skipped} skipped, ${failed} failed`);
}

export default { ensureIndexes };
