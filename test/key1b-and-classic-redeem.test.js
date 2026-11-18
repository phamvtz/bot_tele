import test, { mock } from "node:test";
import assert from "node:assert/strict";

const url = (path) => new URL(path, import.meta.url).href;

const state = {
    settings: new Map(),
    users: [],
    products: [],
    orders: [],
    referrals: [],
    referralEvents: [],
    redeemRequests: [],
    issuedKeys: [],
    stockByProduct: new Map(),
    broadcasts: [],
    channelMessages: [],
    nextRenewResult: null,
};

function resetState() {
    state.settings.clear();
    state.users = [];
    state.products = [];
    state.orders = [];
    state.referrals = [];
    state.referralEvents = [];
    state.redeemRequests = [];
    state.issuedKeys = [];
    state.stockByProduct.clear();
    state.broadcasts = [];
    state.channelMessages = [];
    state.nextRenewResult = null;
}

const prismaMock = {
    setting: {
        async findMany({ where } = {}) {
            const keys = where?.key?.in;
            const out = [];
            for (const [key, value] of state.settings.entries()) {
                if (!keys || keys.includes(key)) out.push({ key, value });
            }
            return out;
        },
        async upsert({ where, update, create }) {
            const k = where.key;
            const v = state.settings.has(k) ? update.value : create.value;
            state.settings.set(k, v);
            return { key: k, value: v };
        },
    },
    user: {
        async findUnique({ where }) {
            const u = state.users.find((x) => {
                if (where.id) return x.id === where.id;
                if (where.telegramId) return String(x.telegramId) === String(where.telegramId);
                if (where.refWelcomeCode) return x.refWelcomeCode === where.refWelcomeCode;
                if (where.referralCode) return x.referralCode === where.referralCode;
                return false;
            });
            return u ? { ...u } : null;
        },
        async findFirst({ where }) {
            if (where?.username?.equals) {
                const want = String(where.username.equals).toLowerCase();
                const found = state.users.find((x) => String(x.username || "").toLowerCase() === want);
                return found ? { ...found } : null;
            }
            return this.findUnique({ where });
        },
        async findMany({ where } = {}) {
            let list = [...state.users];
            if (where?.telegramId?.in) {
                const set = new Set(where.telegramId.in.map(String));
                list = list.filter((u) => set.has(String(u.telegramId)));
            }
            if (where?.referralBonusKeyId?.not === null) {
                list = list.filter((u) => u.referralBonusKeyId != null);
            }
            return list.map((u) => ({ ...u }));
        },
        async update({ where, data }) {
            const u = state.users.find((x) => x.id === where.id);
            if (!u) return null;
            for (const [k, v] of Object.entries(data)) {
                if (v && typeof v === "object" && "increment" in v) {
                    u[k] = (Number(u[k]) || 0) + v.increment;
                } else {
                    u[k] = v;
                }
            }
            return { ...u };
        },
        async updateMany({ where, data }) {
            const u = state.users.find((x) => x.id === where.id);
            if (!u) return { count: 0 };
            if (where.referralPoints?.gte !== undefined && (Number(u.referralPoints) || 0) < where.referralPoints.gte) {
                return { count: 0 };
            }
            if (Array.isArray(where.OR)) {
                const matched = where.OR.some((cond) => {
                    if ("lastTokenRedeemAt" in cond) {
                        if (cond.lastTokenRedeemAt === null) return u.lastTokenRedeemAt == null;
                        if (cond.lastTokenRedeemAt?.lt) return u.lastTokenRedeemAt != null && new Date(u.lastTokenRedeemAt) < cond.lastTokenRedeemAt.lt;
                    }
                    if ("lastRedeemAt" in cond) {
                        if (cond.lastRedeemAt === null) return u.lastRedeemAt == null;
                        if (cond.lastRedeemAt?.lte) return u.lastRedeemAt != null && new Date(u.lastRedeemAt) <= cond.lastRedeemAt.lte;
                    }
                    return true;
                });
                if (!matched) return { count: 0 };
            }
            if (where.refWelcomeRedeemedAt === null && u.refWelcomeRedeemedAt != null) return { count: 0 };
            if (where.channelPointAwarded?.not === true && u.channelPointAwarded === true) return { count: 0 };
            for (const [k, v] of Object.entries(data)) {
                if (v && typeof v === "object" && "increment" in v) {
                    u[k] = (Number(u[k]) || 0) + v.increment;
                } else {
                    u[k] = v;
                }
            }
            return { count: 1 };
        },
    },
    product: {
        async findUnique({ where }) {
            const p = state.products.find((x) => (where.code ? x.code === where.code : x.id === where.id));
            return p ? { ...p } : null;
        },
        async findFirst({ where }) {
            if (where?.code?.equals) {
                const want = String(where.code.equals).toLowerCase();
                const found = state.products.find((x) => String(x.code || "").toLowerCase() === want);
                return found ? { ...found } : null;
            }
            if (where?.OR) {
                for (const cond of where.OR) {
                    if (cond.id) {
                        const found = state.products.find((x) => x.id === cond.id);
                        if (found) return { ...found };
                    }
                    if (cond.code?.contains) {
                        const q = cond.code.contains.toLowerCase();
                        const found = state.products.find((x) => String(x.code || "").toLowerCase().includes(q));
                        if (found) return { ...found };
                    }
                }
            }
            return null;
        },
    },
    order: {
        async create({ data }) {
            const doc = { id: `ord-${state.orders.length + 1}`, createdAt: new Date(), ...data };
            state.orders.push(doc);
            return { ...doc };
        },
        async findUnique({ where }) {
            const doc = state.orders.find((o) => o.id === where.id);
            return doc ? { ...doc } : null;
        },
        async update({ where, data }) {
            const doc = state.orders.find((o) => o.id === where.id);
            if (doc) Object.assign(doc, data);
            return doc ? { ...doc } : null;
        },
    },
    referral: {
        async findFirst({ where }) {
            const r = state.referrals.find((x) => x.refereeId === where.refereeId);
            return r ? { ...r } : null;
        },
        async updateMany({ where, data }) {
            const r = state.referrals.find((x) => x.id === where.id);
            if (!r) return { count: 0 };
            for (const [k, v] of Object.entries(where)) {
                if (k !== "id" && v === null && r[k] != null) return { count: 0 };
            }
            Object.assign(r, data);
            return { count: 1 };
        },
        async findMany({ where } = {}) {
            return state.referrals
                .filter((r) => !where?.referrerId || r.referrerId === where.referrerId)
                .map((r) => ({ ...r }));
        },
    },
    referralEvent: {
        async create({ data }) {
            const doc = { id: `ev-${state.referralEvents.length + 1}`, createdAt: data.createdAt || new Date(), ...data };
            state.referralEvents.push(doc);
            return { ...doc };
        },
        async findMany({ where } = {}) {
            return state.referralEvents.filter((ev) => {
                if (where?.eventType && ev.eventType !== where.eventType) return false;
                if (where?.createdAt?.gte && new Date(ev.createdAt) < where.createdAt.gte) return false;
                if (where?.createdAt?.lt && new Date(ev.createdAt) >= where.createdAt.lt) return false;
                return true;
            });
        },
    },
    redeemRequest: {
        async create({ data }) {
            if (data.lockKey && state.redeemRequests.some((r) => r.lockKey === data.lockKey)) {
                const err = new Error("E11000 duplicate key error");
                err.code = 11000;
                throw err;
            }
            const doc = {
                id: `rr-${state.redeemRequests.length + 1}`,
                createdAt: data.createdAt || new Date(),
                updatedAt: new Date(),
                ...data,
            };
            state.redeemRequests.push(doc);
            return { ...doc };
        },
        async update({ where, data }) {
            const doc = state.redeemRequests.find((r) => r.id === where.id);
            if (doc) Object.assign(doc, data, { updatedAt: new Date() });
            return doc ? { ...doc } : null;
        },
        async updateMany({ where, data }) {
            const doc = state.redeemRequests.find((r) => r.id === where.id && (!where.status || r.status === where.status));
            if (!doc) return { count: 0 };
            Object.assign(doc, data, { updatedAt: new Date() });
            return { count: 1 };
        },
        async findFirst({ where } = {}) {
            const rows = await this.findMany({ where });
            return rows[0] || null;
        },
        async count({ where } = {}) {
            return (await this.findMany({ where })).length;
        },
        async findMany({ where } = {}) {
            return state.redeemRequests
                .filter((r) => {
                    if (where?.lockKey && r.lockKey !== where.lockKey) return false;
                    if (where?.telegramId) {
                        if (typeof where.telegramId === "object" && "not" in where.telegramId) {
                            if (String(r.telegramId) === String(where.telegramId.not)) return false;
                        } else if (String(r.telegramId) !== String(where.telegramId)) {
                            return false;
                        }
                    }
                    if (where?.referrerTgId && String(r.referrerTgId) !== String(where.referrerTgId)) return false;
                    if (where?.rewardType) {
                        if (typeof where.rewardType === "string" && r.rewardType !== where.rewardType) return false;
                        if (where.rewardType.in && !where.rewardType.in.includes(r.rewardType)) return false;
                    }
                    if (where?.status && r.status !== where.status) return false;
                    if (where?.createdAt?.gte && new Date(r.createdAt) < where.createdAt.gte) return false;
                    if (where?.note?.startsWith && !String(r.note || "").startsWith(where.note.startsWith)) return false;
                    return true;
                })
                .map((r) => ({ ...r }));
        },
    },
    issuedApiKey: {
        async findUnique({ where }) {
            const k = state.issuedKeys.find((x) => x.id === where.id);
            return k ? { ...k } : null;
        },
        async findFirst({ where } = {}) {
            const k = state.issuedKeys.find((x) => {
                if (where.id && x.id !== where.id) return false;
                if (where.key && x.key !== where.key) return false;
                if (where.telegramId && String(x.telegramId) !== String(where.telegramId)) return false;
                if ("hiddenAt" in where && (x.hiddenAt ?? null) !== where.hiddenAt) return false;
                return true;
            });
            return k ? { ...k } : null;
        },
        async findMany({ where } = {}) {
            return state.issuedKeys
                .filter((k) => !where?.telegramId || String(k.telegramId) === String(where.telegramId))
                .map((k) => ({ ...k }));
        },
        async updateMany({ where, data }) {
            const k = state.issuedKeys.find((x) => x.id === where.id);
            if (!k) return { count: 0 };
            Object.assign(k, data);
            return { count: 1 };
        },
        async update({ where, data }) {
            const k = state.issuedKeys.find((x) => x.id === where.id);
            if (!k) return null;
            for (const [f, v] of Object.entries(data)) {
                if (v && typeof v === "object" && "increment" in v) k[f] = (Number(k[f]) || 0) + v.increment;
                else k[f] = v;
            }
            return { ...k };
        },
    },
};

mock.module(url("../src/lib/prisma.js"), {
    defaultExport: new Proxy({}, { get: (_t, prop) => prismaMock[prop] }),
    namedExports: { prisma: new Proxy({}, { get: (_t, prop) => prismaMock[prop] }) },
});

mock.module(url("../src/inventory.js"), {
    namedExports: {
        async getStockCount(productId) {
            return state.stockByProduct.get(productId) ?? 0;
        },
        async checkStock() {},
        invalidateStockCache() {},
    },
});

mock.module(url("../src/broadcast.js"), {
    namedExports: {
        async sendBroadcast(_bot, text) {
            state.broadcasts.push(text);
        },
        async broadcastNewOrder() {},
        maskBuyerName: (s) => s,
    },
});

mock.module(url("../src/lib/logger.js"), {
    namedExports: {
        sendLog() {},
    },
});

mock.module(url("../src/wallet.js"), {
    namedExports: {
        TxType: { ADMIN_ADD: "ADMIN_ADD" },
        invalidateWalletCache() {},
    },
});

mock.module(url("../src/gpt2api.js"), {
    namedExports: {
        async getSourceProfileId() { return null; },
        async getConfig() {
            return { enabled: true, configured: true, rpm: 100, validDays: 0, models: ["claude-sonnet-4-5"], endpoint: "https://api.example/v1" };
        },
        async getProfileConfig() {
            return { profileId: 1, profileName: "Main", enabled: true, configured: true, rpm: 100, validDays: 0, models: ["claude-sonnet-4-5"], endpoint: "https://api.example/v1" };
        },
        async createApiKey(args) {
            const idx = state.issuedKeys.length + 1;
            return { ok: true, key: `sk-mint-${idx}abcdef123456`, id: `ext-${idx}`, validDays: args.validDays };
        },
        async getKeyStatus(externalId) {
            const k = state.issuedKeys.find((x) => x.externalId === externalId);
            if (!k) return { ok: false, code: 40400 };
            return { ok: true, externalId, quotaLimit: k.quotaTokens, quotaUsed: 0, expiresAt: k.expiresAt, enabled: true, rpm: k.rpm };
        },
        async renewApiKey({ externalId, addTokens }) {
            if (state.nextRenewResult) {
                const res = state.nextRenewResult;
                state.nextRenewResult = null;
                return res;
            }
            const k = state.issuedKeys.find((x) => x.externalId === externalId);
            const next = (Number(k?.quotaTokens) || 0) + (Number(addTokens) || 0);
            return { ok: true, after: { quotaLimit: next, expiresAt: k?.expiresAt, rpm: k?.rpm || 100 }, quotaRefPrice: 0 };
        },
        invalidateKeyStatusCache() {},
        isSafeApiKeyCreateFailure(res = {}) {
            if (res?.ok) return false;
            if (res?.providerMutationPossible === false) return true;
            const code = String(res?.code ?? "").toLowerCase();
            return Boolean(code) && !["network", "no_key_in_response"].includes(code) && !/^http_5\d\d$/.test(code);
        },
    },
});

mock.module(url("../src/apikey-store.js"), {
    namedExports: {
        KeySource: { GIFTCODE: "GIFTCODE", PURCHASE: "PURCHASE", ADMIN: "ADMIN", REFERRAL: "REFERRAL" },
        async saveIssuedKey(entry) {
            const doc = { id: `ik-${state.issuedKeys.length + 1}`, renewWipAt: null, hiddenAt: null, ...entry };
            state.issuedKeys.push(doc);
            return doc;
        },
    },
});

const {
    validateKey1bIps,
    computeKey1bMilestoneAction,
    evaluateClassicRedeemCooldown,
} = await import("../src/referral-math.js");
const {
    redeemKey1b,
    getKey1bAdminStatus,
    updateKey1bConfig,
    resetKey1bBatch,
    announceKey1bMilestone,
    invalidateKey1bConfig,
} = await import("../src/key1b.js");
const {
    listAvailableClassicRedeemTiers,
    redeemPointsToClassicProduct,
    redeemPointsToNewKey,
    redeemPointsToTopup,
    adminAdjustReferralPoints,
    processReferralOnboarding,
    payReferralDailyTopPrizes,
    collectExpiringReferralBonusWarnings,
    shouldEmitTokenRedeemBroadcast,
    resetTokenBroadcastState,
    invalidateReferralConfig,
    invalidatePeerAgeCache,
} = await import("../src/referral.js");
const { startReferralScheduler } = await import("../src/referral-scheduler.js");
const { maskSettingsForClient } = await import("../src/settings-mask.js");

test("validateKey1bIps bắt buộc 1–2 IPv4/IPv6 hợp lệ không trùng nhau", () => {
    assert.deepEqual(validateKey1bIps("113.161.72.15"), { ok: true, ips: ["113.161.72.15"] });
    assert.deepEqual(
        validateKey1bIps("113.161.72.15, 2001:EE0:4F9B::1"),
        { ok: true, ips: ["113.161.72.15", "2001:ee0:4f9b::1"] },
    );
    assert.equal(validateKey1bIps("").ok, false);
    assert.equal(validateKey1bIps("1.1.1.1, 1.1.1.1").error, "DUPLICATE_IP");
    assert.equal(validateKey1bIps("1.1.1.1, 8.8.8.8, 9.9.9.9").error, "TOO_MANY_IPS");
    assert.equal(validateKey1bIps("not-an-ip").error, "INVALID_IP");
});

test("computeKey1bMilestoneAction báo đúng 25/50/75/90% + sold_out và không báo trùng", () => {
    const m25 = computeKey1bMilestoneAction({ used: 1, limit: 4, unlimited: false, milestoneEnabled: true });
    assert.equal(m25.shouldAnnounce, true);
    assert.equal(m25.kind, "milestone");
    assert.equal(m25.percent, 25);
    assert.deepEqual(m25.nextLog, [25]);

    const dup = computeKey1bMilestoneAction({ used: 1, limit: 4, alreadyLogged: [25] });
    assert.equal(dup.shouldAnnounce, false);

    const sold = computeKey1bMilestoneAction({ used: 4, limit: 4, alreadyLogged: [25, 50, 75, 90] });
    assert.equal(sold.shouldAnnounce, true);
    assert.equal(sold.kind, "sold_out");
    assert.equal(sold.nextSoldOut, true);

    const unlim = computeKey1bMilestoneAction({ used: 50, limit: 4, unlimited: true });
    assert.equal(unlim.shouldAnnounce, false);
});

test("Key 1.5B: che secret key1bKeyValue, khóa 1 lần/đợt, chặn hết slot, rao mốc không lộ số thật & Reset đợt mới mở lại", async () => {
    resetState();
    invalidateKey1bConfig();

    const SECRET = "sk-shared-key1b-ULTRA-SECRET-999999";
    await updateKey1bConfig({
        key1bEnabled: true,
        key1bDisplayName: "Key 1B - KIRO - GA",
        key1bKeyValue: SECRET,
        key1bCost: 1,
        key1bLimit: 2,
        key1bUnlimited: false,
        key1bMilestoneEnabled: true,
        key1bMilestoneChannelEnabled: true,
        key1bMilestoneChannelId: "-100999888777",
        key1bMilestoneBroadcastUsers: true,
    });

    // 1. Kiểm tra che secret trên cả /settings chung lẫn /key1b/status
    const maskedGlobal = maskSettingsForClient({ key1bKeyValue: SECRET, SHOP_NAME: "Shop" });
    assert.ok(!JSON.stringify(maskedGlobal).includes(SECRET), "key1bKeyValue không được lộ qua GET /settings");
    assert.equal(maskedGlobal.key1bKeyValue_SET, "1");

    // Gửi update rỗng key1bKeyValue phải GIỮ NGUYÊN key cũ
    await updateKey1bConfig({ key1bDisplayName: "Key 1B - KIRO - GA", key1bKeyValue: "" });
    const adminStatus = await getKey1bAdminStatus();
    assert.equal(adminStatus.config._key1bKeyValue_configured, true);
    assert.ok(!JSON.stringify(adminStatus).includes(SECRET), "API admin status không được trả key1bKeyValue thô");

    state.users.push(
        { id: "u1", telegramId: "700000001", firstName: "An", referralPoints: 3, createdAt: new Date(Date.now() - 10 * 86_400_000) },
        { id: "u2", telegramId: "700000002", firstName: "Binh", referralPoints: 2, createdAt: new Date(Date.now() - 10 * 86_400_000) },
        { id: "u3", telegramId: "700000003", firstName: "Cuong", referralPoints: 5, createdAt: new Date(Date.now() - 10 * 86_400_000) },
    );

    // 2. User 1 đổi 1/2 slot → trúng mốc 50%
    const r1 = await redeemKey1b("700000001", "113.161.72.15, 2001:ee0:4f9b::1");
    assert.equal(r1.ok, true);
    assert.equal(r1.keyValue, SECRET);
    assert.equal(r1.remainingPoints, 2);
    assert.equal(r1.milestoneAnnouncement?.percent, 50);

    // Rao mốc lên channel không được chứa số lượng thật "1/2"
    const tgFake = {
        async sendMessage(chatId, text, extra) {
            state.channelMessages.push({ chatId, text, extra });
        },
    };
    await announceKey1bMilestone({ telegram: tgFake, botUsername: "ShopBot", announcement: r1.milestoneAnnouncement });
    assert.equal(state.channelMessages.length, 1);
    assert.match(state.channelMessages[0].text, /~50%/);
    assert.doesNotMatch(state.channelMessages[0].text, /1\/2|2 suất/);

    // 3. User 1 bấm đổi lần 2 trong cùng đợt → bị chặn ALREADY_CLAIMED
    const dup1 = await redeemKey1b("700000001", "8.8.8.8");
    assert.equal(dup1.ok, false);
    assert.equal(dup1.error, "ALREADY_CLAIMED");

    // 4. User 2 đổi slot 2/2 → chạm SOLD OUT
    const r2 = await redeemKey1b("700000002", "14.225.204.11");
    assert.equal(r2.ok, true);
    assert.equal(r2.milestoneAnnouncement?.kind, "sold_out");

    // 5. User 3 vào sau khi hết slot → bị chặn SOLD_OUT và KHÔNG bị trừ điểm
    const r3 = await redeemKey1b("700000003", "1.2.3.4");
    assert.equal(r3.ok, false);
    assert.equal(r3.error, "SOLD_OUT");
    assert.equal(state.users.find((u) => u.id === "u3").referralPoints, 5);

    // 6. Admin bấm Reset đợt mới (tương lai +1s) → User 1 được phép đổi lại trong đợt mới!
    const nextBatchNow = Date.now() + 5_000;
    await resetKey1bBatch({ now: nextBatchNow });
    const r1NewBatch = await redeemKey1b("700000001", "113.161.72.15", { now: nextBatchNow + 1_000 });
    assert.equal(r1NewBatch.ok, true);
    assert.equal(r1NewBatch.remainingPoints, 1);
});

test("4 Tier Đổi Account Cổ điển: tự ẩn khi slug rỗng, tạo Order 0đ, cooldown 3 ngày và hoàn điểm khi hết kho", async () => {
    resetState();
    invalidateReferralConfig();

    // Mặc định cả 4 slug = "" → tự ẩn hết
    assert.deepEqual(await listAvailableClassicRedeemTiers(), []);

    // Mở tier basic (1⭐) và bh3d (2⭐)
    state.settings.set("referralRedeemBasicSlug", "ACC-BASIC");
    state.settings.set("referralRedeemBasicPoints", "1");
    state.settings.set("referralRedeemBh3dSlug", "ACC-BH3D");
    state.settings.set("referralRedeemBh3dPoints", "2");
    invalidateReferralConfig();

    state.products.push(
        { id: "p-basic", code: "ACC-BASIC", name: "Tài khoản Basic", price: 50_000, currency: "VND", deliveryMode: "STOCK_LINES", isActive: true },
        { id: "p-bh3d", code: "ACC-BH3D", name: "Tài khoản BH 3 ngày", price: 90_000, currency: "VND", deliveryMode: "STOCK_LINES", isActive: true },
    );
    state.stockByProduct.set("p-basic", 3);
    state.stockByProduct.set("p-bh3d", 2);

    const now = Date.parse("2026-11-18T10:00:00Z");
    state.users.push({
        id: "u-classic",
        telegramId: "712345678",
        referralPoints: 5,
        createdAt: new Date(now - 15 * 86_400_000),
        lastRedeemAt: null,
        lastTokenRedeemAt: new Date(now - 60_000), // Đã đổi /tok hôm nay vẫn KHÔNG chặn đổi Account classic!
    });

    const tiers = await listAvailableClassicRedeemTiers();
    assert.equal(tiers.length, 2);
    assert.equal(tiers[0].key, "basic");

    // 1. Đổi thành công Basic → tạo Order 0đ, trừ 1⭐
    const ok = await redeemPointsToClassicProduct("712345678", "basic", {
        now,
        deliverFn: async ({ orderId }) => {
            await prismaMock.order.update({ where: { id: orderId }, data: { status: "DELIVERED" } });
            return { deliveryRef: "STOCK_LINES" };
        },
    });
    assert.equal(ok.ok, true);
    assert.equal(ok.remainingPoints, 4);
    assert.equal(state.orders.length, 1);
    assert.equal(state.orders[0].finalAmount, 0);
    assert.equal(state.orders[0].paymentMethod, "referral_points");

    // 2. Thử đổi tiếp sau 1 ngày (< 3 ngày) → bị chặn COOLDOWN
    const cdBlock = await redeemPointsToClassicProduct("712345678", "bh3d", { now: now + 24 * 3_600_000 });
    assert.equal(cdBlock.ok, false);
    assert.equal(cdBlock.error, "COOLDOWN");
    assert.equal(evaluateClassicRedeemCooldown(new Date(now), now + 24 * 3_600_000).ready, false);

    // 3. Sau 3 ngày + 1 giờ, nhưng kho vừa cạn lúc deliver (OUT_OF_STOCK) → tự động hoàn điểm & khôi phục lastRedeemAt!
    const after3Days = now + 73 * 3_600_000;
    const oos = await redeemPointsToClassicProduct("712345678", "bh3d", {
        now: after3Days,
        deliverFn: async ({ orderId }) => {
            await prismaMock.order.update({ where: { id: orderId }, data: { status: "CANCELED" } });
            return { deliveryRef: "OUT_OF_STOCK" };
        },
    });
    assert.equal(oos.ok, false);
    assert.equal(oos.error, "OUT_OF_STOCK");
    assert.equal(state.users[0].referralPoints, 4, "phải hoàn lại đủ 2⭐ khi hết hàng");
});

test("processReferralOnboarding: Age Gate hoãn invite gift nhưng vẫn phát Welcome Key lần đầu; đủ tuổi nhận đủ +1⭐ hai bên + Mốc 5 + Top ngày + Cảnh báo hết hạn", async () => {
    resetState();
    invalidateReferralConfig();
    invalidatePeerAgeCache();

    const now = Date.parse("2026-11-18T08:00:00Z");
    // Tạo sẵn người mời đã có 4 lượt mời hoàn tất trước đó → lượt thứ 5 sẽ nổ luôn Mốc 5 (+15M)!
    state.users.push({
        id: "ref-host",
        telegramId: "600000001",
        firstName: "Host",
        referralPoints: 0,
        createdAt: new Date(now - 60 * 86_400_000),
    });
    for (let i = 1; i <= 4; i++) {
        state.redeemRequests.push({
            id: `prev-${i}`,
            telegramId: "600000001",
            referrerTgId: "600000001",
            referredTgId: `60000900${i}`,
            rewardType: "ref_invite_token",
            tokensGranted: 3_000_000,
            status: "completed",
            note: "referrer|topup",
            createdAt: new Date(now - i * 86_400_000),
        });
    }

    // Bạn mới có ID 9.1B mới tạo 5 phút trước → chưa có peer nào > 9.1B nên bị Age Gate (7 ngày) hoãn!
    state.users.push({
        id: "new-friend",
        telegramId: "9100000001",
        firstName: "Newbie",
        referredBy: "ref-host",
        refWelcomeCode: "WEL99887766",
        refWelcomeRedeemedAt: null,
        hasJoinedChannel: false,
        channelPointAwarded: false,
        referralPoints: 0,
        createdAt: new Date(now - 5 * 60_000),
    });
    state.referrals.push({
        id: "rel-5",
        referrerId: "ref-host",
        refereeId: "new-friend",
        status: "REGISTERED",
        commission: 0,
        createdAt: new Date(now - 5 * 60_000),
    });

    // 1. Lần join đầu tiên khi chưa đủ 7 ngày: Welcome Key VẪN được tự động phát, nhưng điểm & invite gift bị hoãn!
    const firstTry = await processReferralOnboarding({ id: "9100000001", is_premium: false }, { now });
    assert.equal(firstTry.welcomeReward?.status, "redeemed");
    assert.equal(firstTry.ageGate?.deferred, true);
    assert.equal(firstTry.ageGate?.firstDeferNotice, true);
    assert.equal(firstTry.inviteGrants, null);

    // 2. 8 ngày sau quay lại bấm Kiểm tra Join: nhờ có refWelcomeCode nên VẪN được tính acc mới, cộng +1⭐ cho cả 2 bên + phát cặp key + nổ Mốc 5 (+15M)!
    const eightDaysLater = now + 8 * 86_400_000;
    const secondTry = await processReferralOnboarding({ id: "9100000001", is_premium: false }, { now: eightDaysLater });
    assert.equal(secondTry.ageGate?.deferred, false);
    assert.equal(secondTry.pointsAwarded?.points, 1);
    assert.equal(state.users.find((u) => u.id === "ref-host").referralPoints, 1);
    assert.equal(state.users.find((u) => u.id === "new-friend").referralPoints, 1);
    assert.ok(secondTry.inviteGrants?.referee);
    assert.ok(secondTry.inviteGrants?.referrer);
    assert.equal(secondTry.inviteGrants?.milestones?.length, 1);
    assert.equal(secondTry.inviteGrants.milestones[0].milestoneCount, 5);
    assert.equal(secondTry.inviteGrants.milestones[0].tokensAdded, 15_000_000);

    // 3. Cron trả thưởng Top ngày của ngày đó (50M cho Top 1)
    const nextMorning = eightDaysLater + 86_400_000;
    const topRes = await payReferralDailyTopPrizes({ now: nextMorning });
    assert.equal(topRes.winners.length, 1);
    assert.equal(topRes.winners[0].telegramId, "600000001");
    assert.equal(topRes.winners[0].tokensAdded, 50_000_000);

    // 4. Cảnh báo Referral Key còn <= 3 ngày (gửi đúng 1 lần, không gửi trùng ở tick kế tiếp)
    const hostUser = state.users.find((u) => u.id === "ref-host");
    const bonusKey = state.issuedKeys.find((k) => k.id === hostUser.referralBonusKeyId);
    const nearExpiryNow = new Date(bonusKey.expiresAt).getTime() - 2 * 86_400_000;
    const warns1 = await collectExpiringReferralBonusWarnings({ now: nearExpiryNow });
    assert.equal(warns1.length, 1);
    assert.equal(warns1[0].thresholdDays, 3);
    const warns2 = await collectExpiringReferralBonusWarnings({ now: nearExpiryNow + 60_000 });
    assert.equal(warns2.length, 0, "cùng ngưỡng 3d không được gửi DM lần 2");
});

test("Social-proof broadcast rate-limit & SECONDARY_INSTANCE scheduler guard", () => {
    resetTokenBroadcastState();
    const cfg = {
        tokenRedeemBroadcastEnabled: true,
        tokenRedeemBroadcastChance: 100,
        tokenRedeemBroadcastCooldownMin: 5,
        tokenRedeemBroadcastWindowMin: 30,
        tokenRedeemBroadcastWindowMax: 2,
    };
    const t0 = 1_700_000_000_000;
    assert.equal(shouldEmitTokenRedeemBroadcast(cfg, { now: t0 }), true);
    assert.equal(shouldEmitTokenRedeemBroadcast(cfg, { now: t0 + 60_000 }), false, "chặn do chưa hết cooldown 5p");
    assert.equal(shouldEmitTokenRedeemBroadcast(cfg, { now: t0 + 6 * 60_000 }), true);
    assert.equal(shouldEmitTokenRedeemBroadcast(cfg, { now: t0 + 12 * 60_000 }), false, "chặn do chạm trần 2 tin / 30p");

    const prevEnv = process.env.SECONDARY_INSTANCE;
    process.env.SECONDARY_INSTANCE = "true";
    try {
        const sched = startReferralScheduler({ telegram: { sendMessage: async () => {} } });
        assert.equal(sched.secondary, true);
        sched.stop();
    } finally {
        if (prevEnv === undefined) delete process.env.SECONDARY_INSTANCE;
        else process.env.SECONDARY_INSTANCE = prevEnv;
    }
});

test("Chống race bấm đúp song song (/tok 1 lần/ngày & Classic 3 ngày) và chống bóng mờ chuỗi con (@an vs @anna, BASIC vs ACC-BASIC-VIP)", async () => {
    resetState();
    invalidateReferralConfig();

    const now = Date.parse("2026-11-18T14:00:00Z");
    // 6 user chứa chuỗi "an" đứng trước chính chủ "@an"
    for (let i = 1; i <= 6; i++) {
        state.users.push({ id: `noise-${i}`, telegramId: `70099900${i}`, username: `anna_clone_${i}`, referralPoints: 0, createdAt: new Date(now - 20 * 86_400_000) });
    }
    state.users.push({
        id: "real-an",
        telegramId: "700999999",
        username: "An",
        referralPoints: 10,
        createdAt: new Date(now - 20 * 86_400_000),
        lastTokenRedeemAt: null,
        lastRedeemAt: null,
    });

    // 1. /refbonus @an vẫn tìm đúng user @An chứ không bị 6 @anna_clone_* che khuất
    const bonusOut = await adminAdjustReferralPoints({ target: "@an", deltaPoints: 2, reason: "test" });
    assert.equal(bonusOut.ok, true);
    assert.equal(bonusOut.user.id, "real-an");
    assert.equal(bonusOut.newPoints, 12);

    // 2. Bắn 2 request redeemPointsToNewKey SONG SONG cùng mili-giây → đúng 1 cái thành công, 1 cái bị chặn DAILY_LIMIT
    const [tokA, tokB] = await Promise.all([
        redeemPointsToNewKey("700999999", 1, { now }),
        redeemPointsToNewKey("700999999", 1, { now }),
    ]);
    const tokSuccesses = [tokA, tokB].filter((x) => x.ok);
    const tokBlocked = [tokA, tokB].filter((x) => !x.ok);
    assert.equal(tokSuccesses.length, 1, "chỉ 1 lượt đổi token được qua trong ngày");
    assert.equal(tokBlocked.length, 1);
    assert.equal(tokBlocked[0].error, "DAILY_LIMIT");

    // 3. Sản phẩm "ACC-BASIC-VIP" đứng trước "BASIC", cấu hình chữ thường "basic" vẫn tìm đúng "BASIC"
    state.products.push(
        { id: "p-shadow", code: "ACC-BASIC-VIP", name: "Shadow VIP", price: 100_000, currency: "VND", deliveryMode: "STOCK_LINES", isActive: true },
        { id: "p-exact", code: "BASIC", name: "Exact Basic", price: 50_000, currency: "VND", deliveryMode: "STOCK_LINES", isActive: true },
    );
    state.stockByProduct.set("p-exact", 5);
    state.settings.set("referralRedeemBasicSlug", "basic");
    state.settings.set("referralRedeemBasicPoints", "1");
    invalidateReferralConfig();

    // Bắn 2 request redeemPointsToClassicProduct SONG SONG → đúng 1 cái thành công, 1 cái bị chặn COOLDOWN
    const [clsA, clsB] = await Promise.all([
        redeemPointsToClassicProduct("700999999", "basic", { now }),
        redeemPointsToClassicProduct("700999999", "basic", { now }),
    ]);
    const clsSuccesses = [clsA, clsB].filter((x) => x.ok);
    const clsBlocked = [clsA, clsB].filter((x) => !x.ok);
    assert.equal(clsSuccesses.length, 1, "chỉ 1 lượt đổi SP cổ điển được qua trong cooldown 3 ngày");
    assert.equal(clsSuccesses[0].productCode, "BASIC");
    assert.equal(clsBlocked.length, 1);
    assert.equal(clsBlocked[0].error, "COOLDOWN");
});

test("Thu hồi khóa minting treo >10p ở Key 1.5B, chặn số thập phân /refbonus và giữ điểm khi lỗi PATCH mơ hồ ở Topup", async () => {
    resetState();
    invalidateKey1bConfig();
    invalidateReferralConfig();

    const now = Date.parse("2026-11-18T16:00:00Z");
    await updateKey1bConfig({
        key1bEnabled: true,
        key1bDisplayName: "Key 1.5B",
        key1bKeyValue: "sk-shared-recovery-test-123456",
        key1bCost: 1,
        key1bLimit: 10,
        key1bUnlimited: false,
    });

    state.users.push({
        id: "u-edge",
        telegramId: "700555111",
        firstName: "Edge",
        referralPoints: 5,
        createdAt: new Date(now - 20 * 86_400_000),
        lastTokenRedeemAt: null,
    });

    // 1. adminAdjustReferralPoints từ chối số thập phân âm/dương (-0.5 không bị Math.floor thành -1)
    const decNeg = await adminAdjustReferralPoints({ target: "700555111", deltaPoints: -0.5 });
    assert.equal(decNeg.ok, false);
    const decPos = await adminAdjustReferralPoints({ target: "700555111", deltaPoints: 1.25 });
    assert.equal(decPos.ok, false);
    assert.equal(state.users[0].referralPoints, 5);

    // 2. Key 1.5B: khóa minting mới 2 phút → BUSY; sau 11 phút (>10p) → tự thu hồi và đổi thành công!
    state.redeemRequests.push({
        id: "rr-stuck",
        telegramId: "700555111",
        rewardType: "key1b",
        pointsUsed: 1,
        tokensGranted: 0,
        status: "minting",
        note: "ips=1.1.1.1",
        lockKey: "key1b|default|700555111",
        createdAt: new Date(now - 2 * 60_000),
        updatedAt: new Date(now - 2 * 60_000),
    });

    const busyRes = await redeemKey1b("700555111", "8.8.8.8", { now });
    assert.equal(busyRes.ok, false);
    assert.equal(busyRes.error, "BUSY");

    const recoveredRes = await redeemKey1b("700555111", "8.8.8.8", { now: now + 11 * 60_000 });
    assert.equal(recoveredRes.ok, true);
    assert.equal(state.users[0].referralPoints, 4);

    // 3. Topup key: lỗi pre-PATCH an toàn (`rate_limited`) hoàn điểm; lỗi post-PATCH mơ hồ (`http_502`) giữ điểm chờ đối soát
    state.issuedKeys.push({
        id: "ik-edge-1",
        telegramId: "700555111",
        key: "sk-edge-topup-key-0001",
        externalId: "ext-edge-1",
        quotaTokens: 10_000_000,
        rpm: 100,
        expiresAt: new Date(now + 10 * 86_400_000),
        hiddenAt: null,
        renewWipAt: null,
    });

    state.nextRenewResult = { ok: false, code: "rate_limited", message: "Too many requests" };
    const safeFail = await redeemPointsToTopup("700555111", 1, { issuedKeyId: "ik-edge-1", now });
    assert.equal(safeFail.ok, false);
    assert.equal(safeFail.error, "GATEWAY_FAILED");
    assert.equal(state.users[0].referralPoints, 4, "lỗi pre-PATCH phải hoàn lại 1⭐");

    state.nextRenewResult = { ok: false, code: "http_502", message: "Bad Gateway after PATCH" };
    const ambigFail = await redeemPointsToTopup("700555111", 1, { issuedKeyId: "ik-edge-1", now });
    assert.equal(ambigFail.ok, false);
    assert.equal(ambigFail.error, "AMBIGUOUS_GATEWAY");
    assert.equal(state.users[0].referralPoints, 3, "lỗi post-PATCH mơ hồ phải giữ điểm để chống nạp đúp");
});
