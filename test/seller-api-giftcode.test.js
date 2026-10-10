import test, { mock } from "node:test";
import assert from "node:assert/strict";

const url = (path) => new URL(path, import.meta.url).href;

const SELLER_KEY = {
    id: "seller_test_1",
    name: "Seller Test Unit",
    key: "sk_seller_unit_test_key_12345",
    active: true,
};

function createState({ gift = {} } = {}) {
    return {
        gift: {
            id: "gift-free2026",
            code: "FREE2026",
            rewardType: "APIKEY",
            amount: 0,
            quotaMinM: 10,
            quotaMaxM: 50,
            quotaAlpha: 0,
            keyRpm: 60,
            keyValidDays: 30,
            maxUses: 100,
            usedCount: 0,
            perUserLimit: 1,
            vipOnly: 0,
            expiresAt: null,
            note: "Chúc mừng bạn nhận key FREE2026",
            isActive: true,
            ...gift,
        },
        redemptions: [],
        issuedKeys: [],
        createApiKeyCalls: [],
    };
}

let state = createState();

const prismaMock = {
    giftCode: {
        async findUnique({ where }) {
            if (where.code && where.code !== state.gift.code) return null;
            if (where.id && where.id !== state.gift.id) return null;
            return { ...state.gift };
        },
        async updateMany({ where, data }) {
            if (where.usedCount?.lt !== undefined && state.gift.usedCount >= where.usedCount.lt) {
                return { count: 0 };
            }
            state.gift.usedCount += data.usedCount.increment;
            return { count: 1 };
        },
    },
    giftCodeRedemption: {
        async count({ where }) {
            return state.redemptions.filter(
                (r) => r.giftCodeId === where.giftCodeId && r.telegramId === where.telegramId,
            ).length;
        },
        async create({ data }) {
            if (state.redemptions.some((r) => r.redeemKey === data.redeemKey)) {
                const err = new Error("E11000 duplicate key error");
                err.code = 11000;
                throw err;
            }
            const doc = { id: `red-${state.redemptions.length + 1}`, ...data };
            state.redemptions.push(doc);
            return doc;
        },
        async update({ where, data }) {
            const doc = state.redemptions.find((r) => r.id === where.id);
            if (doc) Object.assign(doc, data);
            return doc;
        },
        async delete({ where }) {
            state.redemptions = state.redemptions.filter((r) => r.id !== where.id);
            return { count: 1 };
        },
    },
    issuedApiKey: {
        async create({ data }) {
            const doc = {
                id: `iss-${state.issuedKeys.length + 1}`,
                createdAt: new Date(),
                ...data,
            };
            state.issuedKeys.push(doc);
            return doc;
        },
    },
    user: {
        async findUnique() { return null; },
    },
    setting: {
        async findUnique() { return null; },
    },
};

mock.module(url("../src/lib/prisma.js"), {
    defaultExport: new Proxy({}, { get: (_t, prop) => prismaMock[prop] }),
});
mock.module(url("../src/gpt2api.js"), {
    namedExports: {
        async getSourceProfileId() { return null; },
        async getProfileConfig() {
            return {
                freeMinM: 10, freeMaxM: 50, rpm: 60, validDays: 30,
                models: ["gpt-4o-mini"], endpoint: "https://api.example.com", docUrl: "https://docs.example.com",
            };
        },
        async createApiKey(args) {
            state.createApiKeyCalls.push(args);
            return {
                ok: true,
                key: "sk-FREE2026-TESTKEY-ABCXYZ12345",
                id: "prov-id-999",
                profileId: null,
                profileName: "Default Server",
                expiresAt: new Date(Date.now() + 30 * 86_400_000).toISOString(),
            };
        },
    },
});

const { redeemGiftCode } = await import("../src/giftcode.js");

test("Seller đổi mã quà tặng FREE2026 thành công và gán nguồn SELLER", async () => {
    state = createState();

    const res = await redeemGiftCode(`seller:${SELLER_KEY.id}`, "FREE2026", {
        sellerKeyId: SELLER_KEY.id,
        sellerKeyName: SELLER_KEY.name,
        source: "SELLER",
    });

    assert.equal(res.success, true);
    assert.equal(res.code, "FREE2026");
    assert.equal(res.rewardType, "APIKEY");
    assert.equal(res.key, "sk-FREE2026-TESTKEY-ABCXYZ12345");
    assert.ok(res.quotaTokens >= 10_000_000 && res.quotaTokens <= 50_000_000);

    // Kiểm tra đã lưu issuedApiKey có sellerKeyId và source SELLER
    const saved = state.issuedKeys[0];
    assert.ok(saved, "phải có bản ghi issuedApiKey");
    assert.equal(saved.sellerKeyId, SELLER_KEY.id);
    assert.equal(saved.sellerKeyName, SELLER_KEY.name);
    assert.equal(saved.source, "SELLER");

    // Lần 2 cùng seller đổi mã bị từ chối ALREADY_USED (perUserLimit = 1)
    const second = await redeemGiftCode(`seller:${SELLER_KEY.id}`, "FREE2026", {
        sellerKeyId: SELLER_KEY.id,
        sellerKeyName: SELLER_KEY.name,
        source: "SELLER",
    });
    assert.equal(second.success, false);
    assert.equal(second.error, "ALREADY_USED");
});
