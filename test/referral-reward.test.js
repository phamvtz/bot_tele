import test, { mock } from "node:test";
import assert from "node:assert/strict";

/**
 * Kiểm thử toàn diện luồng Referral v2:
 *   - Mời bạn thứ 1: Bạn mới nhận key riêng 20M/1d, Người mời nhận Referral Key 30d (2M–7M)
 *   - Mời bạn thứ 2: Người mời được NẠP CỘNG DỒN (topup, addDays=0) vào chính Referral Key 30d đang giữ
 *   - Mã quà chào mừng WEL... (5M–10M / 3d)
 *   - Đơn mua đầu tiên (+3⭐ điểm) & Mốc 3 người mua tặng Coupon cá nhân 49%
 *   - Đổi điểm lấy Token API (tạo key mới & nạp vào key cũ, hoàn điểm nếu provider lỗi)
 */
const url = (path) => new URL(path, import.meta.url).href;

process.env.REFERRAL_REWARD_TOKENS_M = "20";
process.env.REFERRAL_REWARD_DAYS = "1";
process.env.REFERRAL_REWARD_SINCE = "2026-01-01";
delete process.env.REFERRAL_REWARD_RPM;

const REFEREE = {
    id: "u-referee",
    telegramId: "700000111",
    language: "vi",
    referredBy: "u-referrer",
    createdAt: new Date(),
    refWelcomeCode: "WELAABBCC11",
    refWelcomeRedeemedAt: null,
    hasJoinedChannel: true,
};
const REFEREE_2 = {
    id: "u-referee-2",
    telegramId: "700000333",
    language: "vi",
    referredBy: "u-referrer",
    createdAt: new Date(),
    refWelcomeCode: "WELAABBCC22",
    hasJoinedChannel: true,
};
const REFERRER = {
    id: "u-referrer",
    telegramId: "700000222",
    language: "en",
    referredBy: null,
    referralPoints: 0,
    totalReferredBuyers: 0,
    referralBonusKeyId: null,
    createdAt: new Date(Date.now() - 30 * 86_400_000),
};

function createState({ keyFails = false, referredBy = "u-referrer", createdAt = new Date(), settings = [] } = {}) {
    return {
        settings,
        users: [
            { ...REFEREE, referredBy, createdAt },
            { ...REFEREE_2, createdAt },
            { ...REFERRER },
        ],
        referrals: [
            {
                id: "ref-1",
                referrerId: REFERRER.id,
                refereeId: REFEREE.id,
                status: "REGISTERED",
                commission: 0,
                createdAt,
                rewardRefereeAt: null,
                rewardReferrerAt: null,
            },
            {
                id: "ref-2",
                referrerId: REFERRER.id,
                refereeId: REFEREE_2.id,
                status: "REGISTERED",
                commission: 0,
                createdAt,
                rewardRefereeAt: null,
                rewardReferrerAt: null,
            },
        ],
        redeemRequests: [],
        referralEvents: [],
        coupons: [],
        createKeyCalls: [],
        renewKeyCalls: [],
        sourceAsks: [],
        sourceProfileId: null,
        profileAsks: [],
        profileCfgs: {},
        issuedKeys: [],
        keyFails,
    };
}

let state = createState();

const prismaMock = {
    setting: {
        async findMany({ where }) {
            const keys = where?.key?.in || [];
            return state.settings.filter((s) => keys.includes(s.key)).map((s) => ({ ...s }));
        },
        async upsert({ where, update, create }) {
            const idx = state.settings.findIndex((s) => s.key === where.key);
            if (idx >= 0) {
                state.settings[idx] = { ...state.settings[idx], ...update };
                return state.settings[idx];
            }
            const doc = { id: `set-${state.settings.length + 1}`, ...create };
            state.settings.push(doc);
            return doc;
        },
    },
    issuedApiKey: {
        async findMany({ where } = {}) {
            return state.issuedKeys
                .filter((k) => {
                    if (where?.telegramId && String(k.telegramId) !== String(where.telegramId)) return false;
                    if (where?.source && k.source !== where.source) return false;
                    if (where?.hiddenAt === null && k.hiddenAt != null) return false;
                    return true;
                })
                .map((k) => ({ ...k }));
        },
        async findUnique({ where }) {
            const k = state.issuedKeys.find((x) => x.id === where.id);
            return k ? { ...k } : null;
        },
        async findFirst({ where }) {
            const k = state.issuedKeys.find((x) => {
                if (where.id && x.id !== where.id) return false;
                if (where.key && x.key !== where.key) return false;
                if (where.telegramId && String(x.telegramId) !== String(where.telegramId)) return false;
                if (where.hiddenAt === null && x.hiddenAt != null) return false;
                return true;
            });
            return k ? { ...k } : null;
        },
        async updateMany({ where, data }) {
            const k = state.issuedKeys.find((x) => x.id === where.id);
            if (!k) return { count: 0 };
            if (where.renewWipAt === null && k.renewWipAt != null) return { count: 0 };
            if (where.renewWipAt?.lt && !(k.renewWipAt && new Date(k.renewWipAt) < where.renewWipAt.lt)) return { count: 0 };
            Object.assign(k, data);
            return { count: 1 };
        },
        async update({ where, data }) {
            const k = state.issuedKeys.find((x) => x.id === where.id);
            if (!k) return null;
            for (const [field, val] of Object.entries(data)) {
                if (val && typeof val === "object" && "increment" in val) {
                    k[field] = (Number(k[field]) || 0) + val.increment;
                } else {
                    k[field] = val;
                }
            }
            return { ...k };
        },
    },
    user: {
        async findUnique({ where }) {
            const u = state.users.find((x) => {
                if (where.id) return x.id === where.id;
                if (where.telegramId) return String(x.telegramId) === String(where.telegramId);
                if (where.referralCode) return x.referralCode === where.referralCode;
                if (where.refWelcomeCode) return x.refWelcomeCode === where.refWelcomeCode;
                return false;
            });
            return u ? { ...u } : null;
        },
        async findFirst({ where }) {
            return this.findUnique({ where });
        },
        async findMany({ where } = {}) {
            const ids = where?.id?.in;
            let list = ids ? state.users.filter((u) => ids.includes(u.id)) : state.users;
            if (where?.referralPoints?.gt !== undefined) {
                list = list.filter((u) => (Number(u.referralPoints) || 0) > where.referralPoints.gt);
            }
            return list.map((u) => ({ ...u }));
        },
        async update({ where, data }) {
            const u = state.users.find((x) => x.id === where.id);
            if (!u) return null;
            for (const [field, val] of Object.entries(data)) {
                if (val && typeof val === "object" && "increment" in val) {
                    u[field] = (Number(u[field]) || 0) + val.increment;
                } else {
                    u[field] = val;
                }
            }
            return { ...u };
        },
        async updateMany({ where, data }) {
            const u = state.users.find((x) => x.id === where.id);
            if (!u) return { count: 0 };
            if (where.refWelcomeRedeemedAt === null && u.refWelcomeRedeemedAt != null) return { count: 0 };
            if (where.referralPurchaseCounted?.not === true && u.referralPurchaseCounted === true) return { count: 0 };
            if (where.channelPointAwarded?.not === true && u.channelPointAwarded === true) return { count: 0 };
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
            for (const [field, val] of Object.entries(data)) {
                if (val && typeof val === "object" && "increment" in val) {
                    u[field] = (Number(u[field]) || 0) + val.increment;
                } else {
                    u[field] = val;
                }
            }
            return { count: 1 };
        },
    },
    referral: {
        async findFirst({ where }) {
            const doc = state.referrals.find((r) => !where.refereeId || r.refereeId === where.refereeId);
            return doc ? { ...doc } : null;
        },
        async updateMany({ where, data }) {
            const doc = state.referrals.find((r) => r.id === where.id);
            if (!doc) return { count: 0 };
            for (const [k, v] of Object.entries(where)) {
                if (k === "id") continue;
                if (v === null && doc[k] != null) return { count: 0 };
            }
            Object.assign(doc, data);
            return { count: 1 };
        },
        async update({ where, data }) {
            const doc = state.referrals.find((r) => r.id === where.id);
            if (doc) Object.assign(doc, data);
            return doc ? { ...doc } : null;
        },
        async findMany({ where } = {}) {
            const list = where?.referrerId
                ? state.referrals.filter((r) => r.referrerId === where.referrerId)
                : state.referrals;
            return list.map((r) => ({ ...r }));
        },
    },
    redeemRequest: {
        async create({ data }) {
            if (data.lockKey && state.redeemRequests.some((r) => r.lockKey === data.lockKey)) {
                const err = new Error("E11000 duplicate key error");
                err.code = 11000;
                throw err;
            }
            const row = { id: `rr-${state.redeemRequests.length + 1}`, createdAt: new Date(), updatedAt: new Date(), ...data };
            state.redeemRequests.push(row);
            return { ...row };
        },
        async findFirst({ where }) {
            const row = state.redeemRequests.find((r) => r.lockKey === where.lockKey);
            return row ? { ...row } : null;
        },
        async updateMany({ where, data }) {
            const row = state.redeemRequests.find((r) => r.id === where.id && (!where.status || r.status === where.status));
            if (!row) return { count: 0 };
            Object.assign(row, data, { updatedAt: new Date() });
            return { count: 1 };
        },
        async update({ where, data }) {
            const row = state.redeemRequests.find((r) => r.id === where.id);
            if (row) Object.assign(row, data, { updatedAt: new Date() });
            return row ? { ...row } : null;
        },
        async count({ where } = {}) {
            return (await this.findMany({ where })).length;
        },
        async findMany({ where } = {}) {
            return state.redeemRequests.filter((r) => {
                if (where?.telegramId && String(r.telegramId) !== String(where.telegramId)) return false;
                if (where?.referrerTgId && String(r.referrerTgId) !== String(where.referrerTgId)) return false;
                if (where?.rewardType) {
                    if (typeof where.rewardType === "string" && r.rewardType !== where.rewardType) return false;
                    if (where.rewardType.in && !where.rewardType.in.includes(r.rewardType)) return false;
                }
                if (where?.status && r.status !== where.status) return false;
                if (where?.note?.startsWith && !String(r.note || "").startsWith(where.note.startsWith)) return false;
                return true;
            });
        },
    },
    referralEvent: {
        async create({ data }) {
            const row = { id: `ev-${state.referralEvents.length + 1}`, createdAt: new Date(), ...data };
            state.referralEvents.push(row);
            return row;
        },
        async findMany() { return [...state.referralEvents]; },
    },
    coupon: {
        async findUnique({ where }) {
            return state.coupons.find((c) => c.code === where.code) || null;
        },
        async create({ data }) {
            const doc = { id: `cp-${state.coupons.length + 1}`, ...data };
            state.coupons.push(doc);
            return doc;
        },
    },
};

mock.module(url("../src/lib/prisma.js"), {
    defaultExport: new Proxy({}, { get: (_t, prop) => prismaMock[prop] }),
    namedExports: { prisma: new Proxy({}, { get: (_t, prop) => prismaMock[prop] }) },
});

mock.module(url("../src/wallet.js"), {
    namedExports: {
        TxType: { ADMIN_ADD: "ADMIN_ADD" },
        invalidateWalletCache() {},
    },
});

mock.module(url("../src/gpt2api.js"), {
    namedExports: {
        async getSourceProfileId(source) { state.sourceAsks.push(source); return state.sourceProfileId; },
        async getConfig() {
            return {
                enabled: true,
                configured: true,
                rpm: 300,
                validDays: 0,
                models: ["claude-opus-5"],
                endpoint: "https://api.example.com/v1",
                docUrl: "https://docs.example.com",
                usageUrl: "https://api.example.com/key",
            };
        },
        async getProfileConfig(pid) {
            state.profileAsks.push(pid ?? null);
            const shop = {
                profileId: 1, profileName: "Server 1",
                enabled: true, configured: true,
                rpm: 300, validDays: 0,
                models: ["claude-opus-5"],
                endpoint: "https://api.example.com/v1",
                docUrl: "https://docs.example.com",
                usageUrl: "https://api.example.com/key",
            };
            return pid === null || pid === undefined ? shop : { ...shop, ...(state.profileCfgs[pid] || {}) };
        },
        async createApiKey(args) {
            state.createKeyCalls.push(args);
            if (state.keyFails) return { ok: false, code: "network", message: "provider down", providerMutationPossible: false };
            const n = state.createKeyCalls.length;
            return { ok: true, key: `sk-ref-${n}0000000000`, id: `ext-${n}` };
        },
        async getKeyStatus(externalId) {
            const k = state.issuedKeys.find((x) => x.externalId === externalId);
            if (!k) return { ok: false, code: 40400, message: "not found" };
            return {
                ok: true,
                externalId,
                quotaLimit: k.quotaTokens,
                quotaUsed: 0,
                expiresAt: k.expiresAt ? new Date(k.expiresAt).toISOString() : null,
                enabled: true,
                rpm: k.rpm || 100,
            };
        },
        async renewApiKey(args) {
            state.renewKeyCalls.push(args);
            if (state.keyFails) return { ok: false, code: "network", message: "provider down" };
            const k = state.issuedKeys.find((x) => x.externalId === args.externalId);
            const nextLimit = (Number(k?.quotaTokens) || 0) + (Number(args.addTokens) || 0);
            return {
                ok: true,
                before: { quotaLimit: k?.quotaTokens || 0, expiresAt: k?.expiresAt, rpm: k?.rpm || 100 },
                after: { quotaLimit: nextLimit, expiresAt: k?.expiresAt, rpm: k?.rpm || 100 },
                quotaRefPrice: 0,
            };
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
            const doc = { id: `key-${state.issuedKeys.length + 1}`, renewWipAt: null, hiddenAt: null, ...entry };
            state.issuedKeys.push(doc);
            return doc;
        },
    },
});

const {
    grantReferralReward,
    processReferralOnboarding,
    payReferralDailyTopPrizes,
    redeemWelcomeCode,
    processReferralCommission,
    redeemPointsToNewKey,
    redeemPointsToTopup,
    getReferralConfig,
    getReferralLeaderboard,
    invalidateReferralConfig,
    invalidatePeerAgeCache,
} = await import("../src/referral.js");

function reset(opts) {
    state = createState(opts);
    invalidateReferralConfig();
    invalidatePeerAgeCache();
}

test("lượt mời 1 tạo Referral Key 30 ngày cho người mời + key 20M/1d cho bạn mới; lượt mời 2 nạp cộng dồn vào chính Referral Key đó", async () => {
    reset();

    // Lượt 1: rng = 0.5 → quay trúng 4M cho người mời
    const res1 = await grantReferralReward(REFEREE.telegramId, null, { rng: () => 0.5 });
    assert.ok(res1);
    assert.equal(res1.referee.quotaTokens, 20_000_000);
    assert.equal(res1.referee.mode, "new");
    assert.equal(res1.referrer.tokensAdded, 4_000_000);
    assert.equal(res1.referrer.mode, "new");
    assert.equal(state.createKeyCalls.length, 2);
    assert.equal(state.createKeyCalls[0].validDays, 1);
    assert.equal(state.createKeyCalls[1].validDays, 30, "Referral Key của người mời sống 30 ngày");

    const refUser = state.users.find((u) => u.id === REFERRER.id);
    assert.ok(refUser.referralBonusKeyId, "phải gắn referralBonusKeyId vào User");

    // Lượt 2: bạn mới thứ 2 vào → người mời KHÔNG tạo key mới mà cộng dồn vào Referral Key cũ!
    const res2 = await grantReferralReward(REFEREE_2.telegramId, null, { rng: () => 0.98 }); // 7M
    assert.ok(res2);
    assert.equal(res2.referee.quotaTokens, 20_000_000);
    assert.equal(res2.referrer.mode, "topup", "lượt 2 phải nạp cộng dồn tại chỗ");
    assert.equal(res2.referrer.tokensAdded, 7_000_000);
    assert.equal(res2.referrer.totalTokens, 11_000_000, "4M + 7M = 11M trên cùng 1 Referral Key");
    assert.equal(state.renewKeyCalls.length, 1);
    assert.equal(state.renewKeyCalls[0].addDays, 0, "nạp cộng dồn không đẩy ngày hết hạn");
});

test("provider lỗi → nhả mốc, lần sau thử lại vẫn nhận đủ cả 2 bên", async () => {
    reset({ keyFails: true });
    const failed = await grantReferralReward(REFEREE.telegramId);
    assert.equal(failed, null);
    assert.equal(state.issuedKeys.length, 0);

    state.keyFails = false;
    const ok = await grantReferralReward(REFEREE.telegramId);
    assert.ok(ok?.referee && ok?.referrer);
    assert.equal(state.issuedKeys.length, 2);
});

test("cả hai key quà mời bạn cấp trên ĐÚNG server admin đã trỏ", async () => {
    reset();
    state.sourceProfileId = 3;
    const res = await grantReferralReward(REFEREE.telegramId);
    assert.ok(res);
    for (const call of state.createKeyCalls) {
        assert.equal(call.profileId, 3);
        assert.equal(call.allowDisabledProfile, true);
    }
});

test("đổi mã quà chào mừng WEL... cấp key 5M–10M (3 ngày) và chặn đổi lần 2", async () => {
    reset();
    const res = await redeemWelcomeCode(REFEREE.telegramId, "welaabbcc11", { rng: () => 0.5 });
    assert.equal(res.ok, true);
    assert.ok(res.tokens >= 5_000_000 && res.tokens <= 10_000_000);
    assert.equal(res.validDays, 3);

    const again = await redeemWelcomeCode(REFEREE.telegramId, "WELAABBCC11");
    assert.equal(again.ok, false);
    assert.equal(again.error, "ALREADY_REDEEMED");
});

test("đơn mua đầu tiên cộng +3⭐ điểm cho người mời và đủ 3 người mua tặng Coupon cá nhân 49%", async () => {
    reset({
        settings: [{ key: "referralBuyerTarget", value: "1" }], // Đặt mốc 1 người mua để kiểm tra sinh coupon ngay
    });

    const out = await processReferralCommission(REFEREE.id, "order-first-12345678", 250_000);
    assert.ok(out);
    assert.equal(out.pointsAdded, 3);
    assert.ok(out.personalCoupon);
    assert.equal(out.personalCoupon.percent, 49);
    assert.match(out.personalCoupon.code, /^REF49-700000222/);
    assert.equal(state.coupons.length, 1);

    // Mua đơn thứ 2 từ cùng người được mời → KHÔNG cộng điểm lần 2
    const second = await processReferralCommission(REFEREE.id, "order-second-87654321", 500_000);
    assert.equal(second, null);
});

test("đổi điểm lấy Token API: tạo key mới, chặn lần 2 trong ngày, nạp vào key cũ và hoàn điểm nếu provider sập", async () => {
    reset();
    const refUser = state.users.find((u) => u.id === REFERRER.id);
    refUser.referralPoints = 10;

    // 1. Đổi 2⭐ → 20M key mới
    const r1 = await redeemPointsToNewKey(REFERRER.telegramId, 2);
    assert.equal(r1.ok, true);
    assert.equal(r1.tokensGranted, 20_000_000);
    assert.equal(r1.remainingPoints, 8);

    // 2. Đổi tiếp ngay trong cùng ngày → bị chặn DAILY_LIMIT
    const sameDay = await redeemPointsToNewKey(REFERRER.telegramId, 1);
    assert.equal(sameDay.ok, false);
    assert.equal(sameDay.error, "DAILY_LIMIT");

    // 3. Qua ngày hôm sau, provider sập → tự động hoàn điểm & khôi phục lastTokenRedeemAt
    const tomorrow = Date.now() + 2 * 86_400_000;
    state.keyFails = true;
    const failed = await redeemPointsToNewKey(REFERRER.telegramId, 3, { now: tomorrow });
    assert.equal(failed.ok, false);
    assert.equal(refUser.referralPoints, 8, "phải hoàn đủ 3⭐ khi tạo key lỗi");

    // 4. Provider sống lại → đổi 3⭐ nạp cộng dồn vào chính key vừa tạo hôm trước!
    state.keyFails = false;
    const targetKey = state.issuedKeys[0];
    const topup = await redeemPointsToTopup(REFERRER.telegramId, 3, { issuedKeyId: targetKey.id, now: tomorrow });
    assert.equal(topup.ok, true);
    assert.equal(topup.tokensGranted, 30_000_000);
    assert.equal(topup.totalTokens, 50_000_000);
    assert.equal(refUser.referralPoints, 5);
});

test("bảng xếp hạng gộp theo người mời kèm điểm ⭐, người mua và phân rã token", async () => {
    reset();
    await grantReferralReward(REFEREE.telegramId, null, { rng: () => 0.01 }); // 2M cho referrer
    const cfg = await getReferralConfig();
    assert.equal(cfg.inviteTokenAmount, 20_000_000);

    const { rows, totals } = await getReferralLeaderboard();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].telegramId, REFERRER.telegramId);
    assert.equal(rows[0].rewarded, 1);
    assert.equal(rows[0].tokensEarned, 2_000_000);
    assert.equal(totals.keysGiven, 2);
    assert.equal(totals.tokensGiven, 22_000_000);
});
