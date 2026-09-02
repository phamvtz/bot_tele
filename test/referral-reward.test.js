import test, { mock } from "node:test";
import assert from "node:assert/strict";

/**
 * Quà mời bạn: mời 1 người → CẢ HAI bên nhận một API key miễn phí.
 *
 * referral.js gọi thẳng prisma + gpt2api + apikey-store (không dependency
 * injection) → mock module. Cần cờ --experimental-test-module-mocks (npm test đã có).
 */
const url = (path) => new URL(path, import.meta.url).href;

// Đặt TRƯỚC khi import referral.js — hằng số quà đọc env lúc load module.
process.env.REFERRAL_REWARD_TOKENS_M = "20";
process.env.REFERRAL_REWARD_DAYS = "1";
process.env.REFERRAL_REWARD_SINCE = "2026-01-01";
// REFERRAL_REWARD_RPM cố tình KHÔNG đặt — để test luôn giá trị mặc định (100).
delete process.env.REFERRAL_REWARD_RPM;

const REFEREE = { id: "u-referee", telegramId: "700000111", language: "vi", referredBy: "u-referrer" };
const REFERRER = { id: "u-referrer", telegramId: "700000222", language: "en", referredBy: null };

function createState({ keyFails = false, referredBy = "u-referrer", createdAt = new Date(), settings = [] } = {}) {
    return {
        // Setting của web admin — rỗng = theo ENV ở trên.
        settings,
        users: [{ ...REFEREE, referredBy }, { ...REFERRER }],
        referral: {
            id: "ref-1",
            referrerId: REFERRER.id,
            refereeId: REFEREE.id,
            status: "REGISTERED",
            commission: 0,
            createdAt,
        },
        createKeyCalls: [],
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
    },
    issuedApiKey: {
        async findMany() { return state.issuedKeys.map((k) => ({ ...k })); },
    },
    user: {
        async findUnique({ where }) {
            const u = state.users.find((x) => (where.id ? x.id === where.id : x.telegramId === where.telegramId));
            return u ? { ...u } : null;
        },
        async findMany({ where } = {}) {
            const ids = where?.id?.in;
            const list = ids ? state.users.filter((u) => ids.includes(u.id)) : state.users;
            return list.map((u) => ({ ...u }));
        },
    },
    referral: {
        async findFirst({ where }) {
            if (!state.referral) return null;
            if (where.refereeId && where.refereeId !== state.referral.refereeId) return null;
            return { ...state.referral };
        },
        async updateMany({ where, data }) {
            const doc = state.referral;
            if (!doc || where.id !== doc.id) return { count: 0 };
            // Mongo: { field: null } khớp cả doc chưa từng có field đó.
            for (const [k, v] of Object.entries(where)) {
                if (k === "id") continue;
                if (v === null && doc[k] != null) return { count: 0 };
            }
            Object.assign(doc, data);
            return { count: 1 };
        },
        async findMany({ where } = {}) {
            if (!state.referral) return [];
            if (where?.referrerId && where.referrerId !== state.referral.referrerId) return [];
            return [{ ...state.referral }];
        },
    },
};

mock.module(url("../src/lib/prisma.js"), {
    defaultExport: new Proxy({}, { get: (_t, prop) => prismaMock[prop] }),
});

mock.module(url("../src/wallet.js"), {
    namedExports: {
        TxType: { ADMIN_ADD: "ADMIN_ADD" },
        invalidateWalletCache() {},
    },
});

mock.module(url("../src/gpt2api.js"), {
    namedExports: {
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
        async createApiKey(args) {
            state.createKeyCalls.push(args);
            if (state.keyFails) return { ok: false, code: "network", message: "provider down" };
            return { ok: true, key: `sk-ref-${state.createKeyCalls.length}`, id: `ext-${state.createKeyCalls.length}` };
        },
    },
});

mock.module(url("../src/apikey-store.js"), {
    namedExports: {
        KeySource: { GIFTCODE: "GIFTCODE", PURCHASE: "PURCHASE", ADMIN: "ADMIN", REFERRAL: "REFERRAL" },
        async saveIssuedKey(entry) {
            const doc = { id: `key-${state.issuedKeys.length + 1}`, ...entry };
            state.issuedKeys.push(doc);
            return doc;
        },
    },
});

const {
    grantReferralReward, getReferralRewardInfo, getReferralStats,
    getReferralConfig, getReferralLeaderboard, invalidateReferralConfig,
} = await import("../src/referral.js");

// Cấu hình cache 30s trong module → mọi test phải bắt đầu từ cache sạch,
// nếu không test sau ăn Setting của test trước.
function reset(opts) {
    state = createState(opts);
    invalidateReferralConfig();
}

test("mời 1 người → cả người mời lẫn người được mời nhận key 20M token, hạn 1 ngày", async () => {
    reset();
    const res = await grantReferralReward(REFEREE.telegramId);

    assert.ok(res, "phải phát quà");
    assert.equal(res.tokens, 20_000_000);
    assert.equal(res.validDays, 1);

    // Hai key riêng biệt, mỗi bên một cái
    assert.equal(state.createKeyCalls.length, 2);
    for (const call of state.createKeyCalls) {
        assert.equal(call.quotaTokens, 20_000_000);
        assert.equal(call.validDays, 1);
        assert.equal(call.rpm, 100, "key quà chạy RPM riêng mặc định 100, không lấy RPM shop");
    }

    assert.equal(res.referee.telegramId, REFEREE.telegramId);
    assert.equal(res.referrer.telegramId, REFERRER.telegramId);
    assert.notEqual(res.referee.key, res.referrer.key);
    // Ngôn ngữ theo từng người để gửi tin đúng thứ tiếng
    assert.equal(res.referee.language, "vi");
    assert.equal(res.referrer.language, "en");
    // Hết hạn suy ra từ số ngày khi provider không trả về
    assert.ok(new Date(res.referee.expiresAt).getTime() > Date.now());

    // Cả hai key vào kho để /mykey thấy, gắn nguồn REFERRAL
    assert.equal(state.issuedKeys.length, 2);
    assert.deepEqual(state.issuedKeys.map((k) => k.source), ["REFERRAL", "REFERRAL"]);
    assert.deepEqual(
        state.issuedKeys.map((k) => k.telegramId).sort(),
        [REFEREE.telegramId, REFERRER.telegramId].sort(),
    );
});

test("gọi lại lần nữa không phát thêm key", async () => {
    reset();
    await grantReferralReward(REFEREE.telegramId);
    const again = await grantReferralReward(REFEREE.telegramId);

    assert.equal(again, null);
    assert.equal(state.createKeyCalls.length, 2, "vẫn đúng 2 key");
    assert.equal(state.issuedKeys.length, 2);
});

test("provider lỗi → nhả mốc, lần sau thử lại vẫn nhận được quà", async () => {
    reset({ keyFails: true });
    const failed = await grantReferralReward(REFEREE.telegramId);

    assert.equal(failed, null);
    assert.equal(state.issuedKeys.length, 0);
    assert.equal(state.referral.rewardRefereeAt, null, "mốc phải được nhả");
    assert.equal(state.referral.rewardReferrerAt, null);

    state.keyFails = false;
    const ok = await grantReferralReward(REFEREE.telegramId);
    assert.ok(ok?.referee && ok?.referrer, "lần sau phát đủ hai bên");
    assert.equal(state.issuedKeys.length, 2);
});

test("user không vào bằng link giới thiệu → không phát gì, không gọi provider", async () => {
    reset({ referredBy: null });
    const res = await grantReferralReward(REFEREE.telegramId);

    assert.equal(res, null);
    assert.equal(state.createKeyCalls.length, 0);
});

test("referral cũ hơn REFERRAL_REWARD_SINCE không được trả bù", async () => {
    reset({ createdAt: new Date("2025-06-01T00:00:00Z") });
    const res = await grantReferralReward(REFEREE.telegramId);

    assert.equal(res, null);
    assert.equal(state.createKeyCalls.length, 0, "không gọi provider cho lượt mời cũ");
});

test("truyền sẵn user object thì không cần query lại", async () => {
    reset();
    // Xoá user khỏi "DB": nếu hàm vẫn chạy được thì nó đã dùng object truyền vào.
    const referee = state.users.shift();
    const res = await grantReferralReward(referee.telegramId, referee);

    assert.ok(res?.referee, "vẫn phát được quà cho người được mời");
});

test("thông số quà đọc từ env và lộ ra cho UI", async () => {
    reset();
    const info = await getReferralRewardInfo();
    assert.deepEqual(info, { tokens: 20_000_000, days: 1, rpm: 100, enabled: true });

    await grantReferralReward(REFEREE.telegramId);
    const stats = await getReferralStats(REFERRER.id);
    assert.equal(stats.rewardedCount, 1, "màn Giới thiệu đếm số lượt đã phát quà");
    assert.deepEqual(stats.reward, info);
});

test("Setting của web admin THẮNG env — đổi số token là ăn ngay", async () => {
    reset({
        settings: [
            { key: "REFERRAL_REWARD_TOKENS_M", value: "50" },
            { key: "REFERRAL_REWARD_DAYS", value: "7" },
            { key: "REFERRAL_REWARD_RPM", value: "600" },
        ],
    });

    const cfg = await getReferralConfig();
    assert.equal(cfg.tokens, 50_000_000);
    assert.equal(cfg.days, 7);
    assert.equal(cfg.rpm, 600);

    const res = await grantReferralReward(REFEREE.telegramId);
    assert.equal(res.tokens, 50_000_000);
    for (const call of state.createKeyCalls) {
        assert.equal(call.quotaTokens, 50_000_000);
        assert.equal(call.validDays, 7);
        assert.equal(call.rpm, 600, "RPM riêng của quà thắng RPM shop");
    }
});

test("đặt RPM = 0 trong panel thì key quà theo RPM cửa hàng API key", async () => {
    reset({ settings: [{ key: "REFERRAL_REWARD_RPM", value: "0" }] });

    const res = await grantReferralReward(REFEREE.telegramId);
    assert.equal(res.referee.rpm, 300, "0 = sentinel lấy RPM shop, không phải RPM bằng 0");
    for (const call of state.createKeyCalls) assert.equal(call.rpm, 300);
});

test("đặt số token = 0 trong panel là tắt hẳn quà", async () => {
    reset({ settings: [{ key: "REFERRAL_REWARD_TOKENS_M", value: "0" }] });

    const res = await grantReferralReward(REFEREE.telegramId);
    assert.equal(res, null);
    assert.equal(state.createKeyCalls.length, 0);
    assert.equal((await getReferralConfig()).enabled, false);
});

test("bảng xếp hạng gộp theo người mời kèm token đã tặng", async () => {
    reset();
    await grantReferralReward(REFEREE.telegramId);

    const { rows, totals } = await getReferralLeaderboard();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].referrerId, REFERRER.id);
    assert.equal(rows[0].telegramId, REFERRER.telegramId);
    assert.equal(rows[0].invited, 1);
    assert.equal(rows[0].rewarded, 1);
    // Chỉ tính key của CHÍNH người mời, không cộng key của người được mời.
    assert.equal(rows[0].tokensEarned, 20_000_000);
    assert.ok(rows[0].lastInviteAt, "phải có mốc mời gần nhất");

    assert.equal(totals.invited, 1);
    assert.equal(totals.rewarded, 1);
    assert.equal(totals.inviters, 1);
    assert.equal(totals.keysGiven, 2, "mỗi lượt mời tốn 2 key");
    assert.equal(totals.tokensGiven, 40_000_000);
});
