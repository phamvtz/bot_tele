import test, { mock } from "node:test";
import assert from "node:assert/strict";

const url = (p) => new URL(p, import.meta.url).href;

let state;

function resetState() {
    state = {
        settings: [],
        users: [],
        referrals: [],
        redeemRequests: [],
        referralEvents: [],
        coupons: [],
        issuedKeys: [],
        failCreateKeyForUserTg: null,
        failCouponCreateOnce: false,
        simulateDuplicateOnNextCreate: false,
    };
}

resetState();

const prismaMock = {
    setting: {
        async findMany({ where } = {}) {
            const keys = where?.key?.in;
            return keys ? state.settings.filter((s) => keys.includes(s.key)) : [...state.settings];
        },
        async findUnique({ where }) {
            return state.settings.find((s) => s.key === where.key) || null;
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
        async findMany() {
            return state.users.map((u) => ({ ...u }));
        },
        async create({ data }) {
            if (state.simulateDuplicateOnNextCreate) {
                state.simulateDuplicateOnNextCreate = false;
                // Giả lập request song song đã vừa insert user này trước 1ms
                const raceDoc = {
                    id: `u-${state.users.length + 1}`,
                    referralPoints: 0,
                    totalSuccessfulReferrals: 0,
                    totalReferredBuyers: 0,
                    hasJoinedChannel: false,
                    channelPointAwarded: false,
                    referralPurchaseCounted: false,
                    createdAt: new Date(),
                    ...data,
                    referredBy: null,
                };
                state.users.push(raceDoc);
                const err = new Error("E11000 duplicate key error collection: users index: telegramId_1");
                err.code = 11000;
                throw err;
            }
            const doc = {
                id: `u-${state.users.length + 1}`,
                referralPoints: 0,
                totalSuccessfulReferrals: 0,
                totalReferredBuyers: 0,
                hasJoinedChannel: false,
                channelPointAwarded: false,
                referralPurchaseCounted: false,
                createdAt: new Date(),
                ...data,
            };
            state.users.push(doc);
            return { ...doc };
        },
        async update({ where, data }) {
            const u = state.users.find((x) => (where.id && x.id === where.id) || (where.telegramId && String(x.telegramId) === String(where.telegramId)));
            if (!u) return null;
            for (const [k, v] of Object.entries(data)) {
                if (v && typeof v === "object" && "increment" in v) u[k] = (Number(u[k]) || 0) + v.increment;
                else u[k] = v;
            }
            return { ...u };
        },
        async updateMany({ where, data }) {
            const u = state.users.find((x) => x.id === where.id);
            if (!u) return { count: 0 };
            if ("referredBy" in where && where.referredBy === null && u.referredBy != null) return { count: 0 };
            if (where.channelPointAwarded?.not === true && u.channelPointAwarded === true) return { count: 0 };
            if (where.referralPurchaseCounted?.not === true && u.referralPurchaseCounted === true) return { count: 0 };
            for (const [k, v] of Object.entries(data)) {
                if (v && typeof v === "object" && "increment" in v) u[k] = (Number(u[k]) || 0) + v.increment;
                else u[k] = v;
            }
            return { count: 1 };
        },
    },
    referral: {
        async upsert({ where, update, create }) {
            let doc = state.referrals.find((r) => r.refereeId === where.refereeId);
            if (doc) {
                Object.assign(doc, update);
                return { ...doc };
            }
            doc = {
                id: `ref-${state.referrals.length + 1}`,
                commission: 0,
                rewardRefereeAt: null,
                rewardReferrerAt: null,
                createdAt: new Date(),
                ...create,
            };
            state.referrals.push(doc);
            return { ...doc };
        },
        async findFirst({ where }) {
            const doc = state.referrals.find((r) => !where.refereeId || r.refereeId === where.refereeId);
            return doc ? { ...doc } : null;
        },
        async findMany({ where } = {}) {
            return state.referrals
                .filter((r) => !where?.referrerId || r.referrerId === where.referrerId)
                .map((r) => ({ ...r }));
        },
        async update({ where, data }) {
            const doc = state.referrals.find((r) => r.id === where.id);
            if (doc) Object.assign(doc, data);
            return doc ? { ...doc } : null;
        },
        async updateMany({ where, data }) {
            const doc = state.referrals.find((r) => r.id === where.id);
            if (!doc) return { count: 0 };
            if ("rewardRefereeAt" in where && where.rewardRefereeAt === null && doc.rewardRefereeAt != null) return { count: 0 };
            if ("rewardReferrerAt" in where && where.rewardReferrerAt === null && doc.rewardReferrerAt != null) return { count: 0 };
            Object.assign(doc, data);
            return { count: 1 };
        },
    },
    referralEvent: {
        async create({ data }) {
            const row = { id: `ev-${state.referralEvents.length + 1}`, createdAt: data.createdAt || new Date(), ...data };
            state.referralEvents.push(row);
            return row;
        },
        async findMany({ where } = {}) {
            return state.referralEvents.filter((e) => {
                if (where?.eventType && e.eventType !== where.eventType) return false;
                if (where?.createdAt?.gte && new Date(e.createdAt) < where.createdAt.gte) return false;
                if (where?.createdAt?.lt && new Date(e.createdAt) >= where.createdAt.lt) return false;
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
            const row = {
                id: `rr-${state.redeemRequests.length + 1}`,
                retryCount: 0,
                nextRetryAt: null,
                createdAt: new Date(),
                updatedAt: new Date(),
                ...data,
            };
            state.redeemRequests.push(row);
            return { ...row };
        },
        async findFirst({ where }) {
            const row = state.redeemRequests.find((r) => where.lockKey && r.lockKey === where.lockKey);
            return row ? { ...row } : null;
        },
        async update({ where, data }) {
            const row = state.redeemRequests.find((r) => r.id === where.id);
            if (row) Object.assign(row, data, { updatedAt: new Date() });
            return row ? { ...row } : null;
        },
        async updateMany({ where, data }) {
            const row = state.redeemRequests.find((r) => r.id === where.id && (!where.status || r.status === where.status));
            if (!row) return { count: 0 };
            Object.assign(row, data, { updatedAt: new Date() });
            return { count: 1 };
        },
        async findMany({ where, take } = {}) {
            let list = state.redeemRequests.filter((r) => {
                if (where?.rewardType) {
                    if (typeof where.rewardType === "string" && r.rewardType !== where.rewardType) return false;
                    if (where.rewardType.in && !where.rewardType.in.includes(r.rewardType)) return false;
                }
                if (where?.status && r.status !== where.status) return false;
                if (where?.retryCount?.lt !== undefined && (Number(r.retryCount) || 0) >= where.retryCount.lt) return false;
                if (where?.nextRetryAt?.lte) {
                    if (!r.nextRetryAt || new Date(r.nextRetryAt) > where.nextRetryAt.lte) return false;
                }
                return true;
            });
            if (take) list = list.slice(0, take);
            return list.map((r) => ({ ...r }));
        },
        async count({ where } = {}) {
            return (await this.findMany({ where })).length;
        },
    },
    issuedApiKey: {
        async findMany() { return [...state.issuedKeys]; },
        async findUnique({ where }) { return state.issuedKeys.find((k) => k.id === where.id) || null; },
        async updateMany() { return { count: 0 }; },
        async update({ where, data }) {
            const k = state.issuedKeys.find((x) => x.id === where.id);
            if (k) Object.assign(k, data);
            return k || null;
        },
    },
    coupon: {
        async findUnique({ where }) {
            return state.coupons.find((c) => c.code === where.code) || null;
        },
        async create({ data }) {
            if (state.failCouponCreateOnce) {
                state.failCouponCreateOnce = false;
                throw new Error("Transient Mongo network timeout");
            }
            const doc = { id: `cp-${state.coupons.length + 1}`, ...data };
            state.coupons.push(doc);
            return doc;
        },
    },
};

mock.module(url("../src/lib/prisma.js"), {
    defaultExport: new Proxy({}, { get: (_t, p) => prismaMock[p] }),
    namedExports: { prisma: new Proxy({}, { get: (_t, p) => prismaMock[p] }) },
});

mock.module(url("../src/wallet.js"), {
    namedExports: { invalidateWalletCache: () => {} },
});

mock.module(url("../src/delivery.js"), {
    namedExports: { deliverOrder: async () => ({ ok: true }) },
});

mock.module(url("../src/gpt2api.js"), {
    namedExports: {
        isGpt2apiEnabledSync: () => true,
        getConfig: async () => ({ enabled: true, configured: true, rpm: 100, models: [] }),
        getProfiles: async () => [],
        getSourceProfileId: async () => null,
        getProfileConfig: async () => ({ enabled: true, configured: true, rpm: 100, models: [] }),
        async createApiKey(args) {
            if (state.failCreateKeyForUserTg && String(args.name || "").includes(String(state.failCreateKeyForUserTg).slice(-6))) {
                return { ok: false, code: "429", message: "rate limited", providerMutationPossible: false };
            }
            const n = state.issuedKeys.length + 1;
            return { ok: true, key: `sk-test-${n}000000000`, id: `ext-${n}` };
        },
        renewApiKey: async () => ({ ok: true, after: { quotaLimit: 50_000_000 } }),
        getKeyStatus: async () => ({ ok: false, code: 40400 }),
        invalidateKeyStatusCache: () => {},
        isSafeApiKeyCreateFailure: () => true,
    },
});

mock.module(url("../src/apikey-store.js"), {
    namedExports: {
        KeySource: { REFERRAL: "REFERRAL", PURCHASE: "PURCHASE", GIFTCODE: "GIFTCODE", ADMIN: "ADMIN" },
        async saveIssuedKey(entry) {
            const doc = { id: `ik-${state.issuedKeys.length + 1}`, hiddenAt: null, renewWipAt: null, ...entry };
            state.issuedKeys.push(doc);
            return doc;
        },
    },
});

const { userCache } = await import("../src/lib/cache.js");
const {
    getOrCreateUser,
    bindReferrerIfEligible,
    processReferralOnboarding,
    processReferralCommission,
    payReferralDailyTopPrizes,
    resumeStuckReferralGrants,
    invalidateReferralConfig,
    invalidatePeerAgeCache,
} = await import("../src/referral.js");
const { createReferralBotModule } = await import("../src/bot-referral.js");

function cleanAll() {
    resetState();
    userCache.invalidate(null);
    invalidateReferralConfig();
    invalidatePeerAgeCache();
}

test("1. Chặn mời chéo vòng tròn A ↔ B trong 30 phút đầu (Mutual Referral)", async () => {
    cleanAll();
    const userA = await getOrCreateUser({ id: 500000101, first_name: "Alice", is_premium: true });
    const userB = await getOrCreateUser({ id: 500000102, first_name: "Bob", is_premium: true }, `ref${userA.telegramId}`);

    assert.equal(userB.referredBy, userA.id, "B được A mời hợp lệ");

    // Ngay trong phút đầu tiên, A cố bấm ngược vào link của B
    const afterAttempt = await bindReferrerIfEligible(userA, `ref${userB.telegramId}`);
    assert.equal(afterAttempt.referredBy ?? null, null, "A không được phép nhận ngược B làm người mời");
});

test("2. Khách cũ (>30p, referralLateClaim=true) không cày được điểm ⭐, không tính Đua Top ngày và không tính Coupon 49%", async () => {
    cleanAll();
    state.settings.push({ key: "referralBuyerTarget", value: "1" });

    const inviter = await getOrCreateUser({ id: 500000201, first_name: "Host", is_premium: true });
    // Khách cũ đã vào bot từ 10 ngày trước nhưng chưa từng có ref
    const oldCreated = new Date(Date.now() - 10 * 86_400_000);
    state.users.push({
        id: "u-old",
        telegramId: "500000202",
        firstName: "OldMember",
        referralCode: "OLDMEM01",
        referredBy: null,
        referralPoints: 0,
        hasJoinedChannel: false,
        channelPointAwarded: false,
        referralPurchaseCounted: false,
        isTelegramPremium: true,
        createdAt: oldCreated,
    });

    const boundOld = await getOrCreateUser({ id: 500000202, first_name: "OldMember", is_premium: true }, `ref${inviter.telegramId}`);
    assert.equal(boundOld.referralLateClaim, true);

    const onboardOut = await processReferralOnboarding({ id: 500000202, is_premium: true });
    assert.equal(onboardOut.pointsAwarded, null, "khách cũ không được cộng +1⭐ điểm join_channel");
    assert.equal(onboardOut.inviteGrants, null, "khách cũ không được phát cặp key mời bạn");
    assert.equal(state.referralEvents.filter((e) => e.eventType === "join_channel").length, 0, "không được tính vào BXH Đua Top ngày");

    const buyOut = await processReferralCommission("u-old", "order-old-12345678", 300_000);
    assert.equal(buyOut, null, "khách cũ mua hàng không cộng +3⭐ hay tạo Coupon 49%");
    assert.equal(state.coupons.length, 0);
});

test("3. runAndDeliverOnboarding chặn phát thưởng nếu khách chưa join referralChannelId", async () => {
    cleanAll();
    const inviter = await getOrCreateUser({ id: 500000301, first_name: "Host", is_premium: true });
    await getOrCreateUser({ id: 500000302, first_name: "Newbie", is_premium: true }, `ref${inviter.telegramId}`);

    let channelJoined = false;
    const mod = createReferralBotModule({
        getLang: () => "vi",
        editMenu: async () => {},
        cleanReply: async () => {},
        safeDelete: async () => {},
        getBotInfo: async () => ({ username: "ShopBot" }),
        isGroupMember: async () => channelJoined,
        iconOf: () => "🎁",
        iconBtn: (_k, l, c) => ({ text: l, callback_data: c }),
        navBtn: (_k, l, c) => ({ text: l, callback_data: c }),
        buildApiKeyDeliveredKeyboard: () => ({}),
        formatUsdPrimary: (v) => `${v}đ`,
        liveUsdVndRate: () => 26000,
    });

    const fakeCtx = {
        from: { id: 500000302, first_name: "Newbie", is_premium: true },
        telegram: { sendMessage: async () => {} },
    };

    // Chưa vào kênh Referral → trả null, không cộng điểm, không đánh dấu hasJoinedChannel
    const blocked = await mod.runAndDeliverOnboarding(fakeCtx);
    assert.equal(blocked, null);
    assert.equal(state.users.find((u) => u.telegramId === "500000302").hasJoinedChannel, false);

    // Sau khi đã vào kênh Referral → phát thưởng đầy đủ
    channelJoined = true;
    const passed = await mod.runAndDeliverOnboarding(fakeCtx);
    assert.ok(passed?.pointsAwarded);
    assert.ok(passed?.inviteGrants?.referee);
});

test("4. getOrCreateUser chịu được lỗi race E11000 khi khách bấm /start đúp và vẫn gắn được người mời", async () => {
    cleanAll();
    const inviter = await getOrCreateUser({ id: 500000401, first_name: "Host", is_premium: true });
    state.simulateDuplicateOnNextCreate = true;

    const created = await getOrCreateUser({ id: 500000402, first_name: "FastClicker", is_premium: true }, `ref${inviter.telegramId}`);
    assert.ok(created);
    assert.equal(created.telegramId, "500000402");
    assert.equal(created.referredBy, inviter.id, "vẫn gắn được người mời sau khi hồi phục từ E11000");
});

test("5. resumeStuckReferralGrants không bị Head-of-Line Blocking bởi các dòng hết hạn không thể khôi phục", async () => {
    cleanAll();
    const now = Date.now();
    const inviter = await getOrCreateUser({ id: 500000501, first_name: "Host", is_premium: true });

    // Dòng chết ở đầu hàng đợi: user đã quá hạn 10 ngày không có refWelcomeCode
    state.users.push({
        id: "u-expired-friend",
        telegramId: "500000502",
        referredBy: inviter.id,
        referralLateClaim: false,
        refWelcomeCode: null,
        createdAt: new Date(now - 10 * 86_400_000),
    });
    state.redeemRequests.push({
        id: "rr-dead-head",
        telegramId: "500000502",
        referrerTgId: inviter.telegramId,
        referredTgId: "500000502",
        rewardType: "ref_invite_token",
        status: "failed",
        retryCount: 1,
        nextRetryAt: new Date(now - 60_000),
        lockKey: "ref_invite_token|ref_invite|500000502|referred",
        createdAt: new Date(now - 10 * 86_400_000),
    });

    // Dòng lỗi mạng hợp lệ nằm phía sau
    const validFriend = await getOrCreateUser({ id: 500000503, first_name: "Valid", is_premium: true }, `ref${inviter.telegramId}`);
    state.redeemRequests.push({
        id: "rr-valid-tail",
        telegramId: validFriend.telegramId,
        referrerTgId: inviter.telegramId,
        referredTgId: validFriend.telegramId,
        rewardType: "ref_invite_token",
        status: "failed",
        retryCount: 1,
        nextRetryAt: new Date(now - 30_000),
        lockKey: `ref_invite_token|ref_invite|${validFriend.telegramId}|referred`,
        createdAt: new Date(now - 60_000),
    });

    // Với budget = 1: lượt 1 xử lý và ĐÓNG vĩnh viễn dòng chết ở đầu hàng đợi
    await resumeStuckReferralGrants({ now, budget: 1 });
    const deadRow = state.redeemRequests.find((r) => r.id === "rr-dead-head");
    assert.equal(deadRow.nextRetryAt, null, "dòng hết hạn phải được gỡ nextRetryAt để không chặn đầu hàng đợi");

    // Lượt 2 với budget = 1 lập tức tới được dòng hợp lệ phía sau!
    const recovered = await resumeStuckReferralGrants({ now: now + 1000, budget: 1 });
    assert.equal(recovered.length, 1);
    assert.ok(recovered[0].referee);
});

test("6. Đua Top ngày retry an toàn khi 1 hạng lỗi mạng (không phát trùng hạng đã thành công) & Coupon 49% retry khi DB lỗi", async () => {
    cleanAll();
    state.settings.push({ key: "referralBuyerTarget", value: "1" });

    const top1 = await getOrCreateUser({ id: 500000601, first_name: "Top1", is_premium: true });
    const top2 = await getOrCreateUser({ id: 500000602, first_name: "Top2", is_premium: true });
    const friend = await getOrCreateUser({ id: 500000603, first_name: "Buyer", is_premium: true }, `ref${top1.telegramId}`);

    const eventTime = Date.parse("2026-11-17T10:00:00Z"); // thuộc ngày 2026-11-17 giờ VN
    const cronMorning = Date.parse("2026-11-17T17:06:00Z"); // 00:06 sáng 2026-11-18 giờ VN

    state.referralEvents.push(
        { eventType: "join_channel", referrerTgId: top1.telegramId, referredUserId: "9001", createdAt: new Date(eventTime) },
        { eventType: "join_channel", referrerTgId: top1.telegramId, referredUserId: "9002", createdAt: new Date(eventTime + 1000) },
        { eventType: "join_channel", referrerTgId: top2.telegramId, referredUserId: "9003", createdAt: new Date(eventTime + 2000) },
    );

    // Lần chạy lúc 00:05: giả lập Top 2 bị 429 khi tạo key
    state.failCreateKeyForUserTg = top2.telegramId;
    const run1 = await payReferralDailyTopPrizes({ now: cronMorning });
    assert.equal(run1.skipped, "partial_retry_pending", "chưa chốt ngày khi Top 2 bị lỗi mạng");
    assert.equal(run1.winners.length, 1, "Top 1 vẫn nhận giải ngay");
    assert.equal(run1.winners[0].telegramId, top1.telegramId);

    // Phút 00:06 mạng hết lỗi → Top 1 không bị phát trùng, Top 2 nhận bù thành công, chốt ngày!
    state.failCreateKeyForUserTg = null;
    const run2 = await payReferralDailyTopPrizes({ now: cronMorning + 60_000 });
    assert.equal(run2.skipped, null);
    assert.equal(run2.winners.length, 1, "chỉ phát bù đúng cho Top 2, không phát lại Top 1");
    assert.equal(run2.winners[0].telegramId, top2.telegramId);
    assert.equal(run2.winners[0].tokensAdded, 30_000_000);

    // Phút 00:07 → đã chốt ngày nên bỏ qua hoàn toàn
    const run3 = await payReferralDailyTopPrizes({ now: cronMorning + 120_000 });
    assert.equal(run3.skipped, "already_paid");

    // Kiểm thử tạo Coupon 49% khi DB lỗi lần 1: không gửi mã ảo, đơn sau tự tạo bù
    state.failCouponCreateOnce = true;
    const comm1 = await processReferralCommission(friend.id, "ord-buy-11111111", 200_000);
    assert.equal(comm1.pointsAdded, 3);
    assert.equal(comm1.personalCoupon, null, "DB lỗi tạo coupon thì không được trả mã ảo");

    const friend2 = await getOrCreateUser({ id: 500000604, first_name: "Buyer2", is_premium: true }, `ref${top1.telegramId}`);
    const comm2 = await processReferralCommission(friend2.id, "ord-buy-22222222", 200_000);
    assert.ok(comm2.personalCoupon?.code, "đơn tiếp theo tự reclaim lock failed và tạo Coupon 49% thành công");
    assert.equal(state.coupons.length, 1);
});
