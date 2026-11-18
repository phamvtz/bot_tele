import test from "node:test";
import assert from "node:assert/strict";
import {
    rollReferrerInviteTokens,
    shouldTriggerLuckyProtect,
    rollWelcomeTokens,
    estimateTelegramAgeDays,
    evaluateAgeGate,
    isLateClaim,
    isBrandNewForInvite,
    isTooNewForRedeem,
    dueMilestones,
    nextMilestoneProgress,
    rankDailyTopReferrers,
    vnDayKey,
    vnDayStartUtc,
    isSameVnDay,
    parseReferralStartParam,
} from "../src/referral-math.js";

test("parseReferralStartParam nhận cả link mới ref<tgId> lẫn link cũ ref_<code>", () => {
    assert.deepEqual(parseReferralStartParam("ref7368118922"), { kind: "telegramId", value: "7368118922" });
    assert.deepEqual(parseReferralStartParam("ref_7368118922"), { kind: "telegramId", value: "7368118922" });
    assert.deepEqual(parseReferralStartParam("ref_a1b2c3d4"), { kind: "code", value: "A1B2C3D4" });
    assert.equal(parseReferralStartParam("product_123"), null);
    assert.equal(parseReferralStartParam(""), null);
});

test("rollReferrerInviteTokens tuân thủ trọng số 2M-7M và kích hoạt Lucky Protect ở lượt thứ 4", () => {
    // rng = 0 → bậc đầu tiên (2M, weight 25/100)
    const rLow = rollReferrerInviteTokens({ rng: () => 0.01 });
    assert.equal(rLow.tokens, 2_000_000);
    assert.equal(rLow.lucky, false);

    // rng = 0.98 → bậc cuối cùng (7M, weight 5/100)
    const rHigh = rollReferrerInviteTokens({ rng: () => 0.98 });
    assert.equal(rHigh.tokens, 7_000_000);
    assert.equal(rHigh.lucky, false);

    // 3 lượt gần nhất đều < 6M → lượt 4 bắt buộc >= 6M và gắn cờ lucky = true
    assert.equal(shouldTriggerLuckyProtect([2_000_000, 5_000_000, 3_000_000], 6_000_000), true);
    assert.equal(shouldTriggerLuckyProtect([2_000_000, 6_000_000, 3_000_000], 6_000_000), false);

    const lucky6 = rollReferrerInviteTokens({
        recent3Tokens: [2_000_000, 4_000_000, 5_000_000],
        rng: () => 0.1, // nhóm [6M(w=10), 7M(w=5)] → 0.1 rơi vào 6M
    });
    assert.equal(lucky6.tokens, 6_000_000);
    assert.equal(lucky6.lucky, true);

    const lucky7 = rollReferrerInviteTokens({
        recent3Tokens: [2_000_000, 4_000_000, 5_000_000],
        rng: () => 0.9, // rơi vào 7M
    });
    assert.equal(lucky7.tokens, 7_000_000);
    assert.equal(lucky7.lucky, true);
});

test("rollWelcomeTokens trả số nguyên triệu trong khoảng [5M, 10M]", () => {
    assert.equal(rollWelcomeTokens({ minM: 5, maxM: 10, rng: () => 0 }).tokens, 5_000_000);
    assert.equal(rollWelcomeTokens({ minM: 5, maxM: 10, rng: () => 0.999 }).tokens, 10_000_000);
});

test("Peer Envelope so sánh telegramId theo SỐ (không so chuỗi) và miễn lọc cho Telegram Premium", () => {
    const now = Date.parse("2026-11-18T12:00:00Z");
    const peers = [
        { telegramId: "1500000000", createdAt: new Date(now - 90 * 86_400_000) },
        { telegramId: "5000000000", createdAt: new Date(now - 60 * 86_400_000) },
        { telegramId: "6000000000", createdAt: new Date(now - 45 * 86_400_000) },
        { telegramId: "7000000000", createdAt: new Date(now - 30 * 86_400_000) },
    ];

    // ID 989775494 (9 chữ số, bắt đầu bằng '9' nhưng nhỏ hơn 1.5B về mặt số!)
    const oldAcc = estimateTelegramAgeDays({
        telegramId: "989775494",
        userCreatedAt: new Date(now - 60_000), // vừa vào shop 1 phút trước
        peers,
        now,
    });
    assert.equal(oldAcc.higherPeerCount, 4);
    // Peer cũ thứ 3 trong [90d, 60d, 45d, 30d] (xếp createdAt tăng dần: -90d, -60d, -45d, -30d) là 45 ngày
    assert.ok(Math.abs(oldAcc.peerAgeDays - 45) < 0.01);
    assert.equal(evaluateAgeGate({ estimatedAgeDays: oldAcc.estimatedAgeDays, minTgAgeDays: 7 }).passed, true);

    // Clone mới tinh ID 8999999999 (lớn hơn mọi peer trong shop)
    const brandNewClone = estimateTelegramAgeDays({
        telegramId: "8999999999",
        userCreatedAt: new Date(now - 10 * 60_000),
        peers,
        now,
    });
    assert.equal(brandNewClone.higherPeerCount, 0);
    const gateFail = evaluateAgeGate({ estimatedAgeDays: brandNewClone.estimatedAgeDays, minTgAgeDays: 7 });
    assert.equal(gateFail.passed, false);
    assert.equal(gateFail.remainingDays, 7);

    // Nhưng nếu có Telegram Premium → miễn lọc ngay lập tức
    const gatePrem = evaluateAgeGate({ estimatedAgeDays: 0, minTgAgeDays: 7, isPremium: true });
    assert.equal(gatePrem.passed, true);
});

test("Late Claim (>30p), giữ quyền nhận quà sau Age Gate nhờ refWelcomeCode, và chặn clone tự đổi điểm", () => {
    const now = Date.now();
    assert.equal(isLateClaim(new Date(now - 10 * 60_000), now), false);
    assert.equal(isLateClaim(new Date(now - 31 * 60_000), now), true);

    // User bị Age Gate hoãn 8 ngày nhưng có refWelcomeCode lúc đầu → vẫn nhận được ref_invite_token!
    const deferredUser = {
        createdAt: new Date(now - 8 * 86_400_000),
        refWelcomeCode: "WEL1234ABCD",
        referralLateClaim: false,
    };
    assert.equal(isBrandNewForInvite(deferredUser, now), true);

    // Late claim user → không nhận ref_invite_token
    const lateUser = {
        createdAt: new Date(now - 2 * 3_600_000),
        refWelcomeCode: null,
        referralLateClaim: true,
    };
    assert.equal(isBrandNewForInvite(lateUser, now), false);

    // Chặn clone đổi điểm: ID > 8.5B và tuổi shop < 3 ngày
    assert.equal(isTooNewForRedeem({ telegramId: "8600000001", createdAt: new Date(now - 1 * 86_400_000) }, now), true);
    assert.equal(isTooNewForRedeem({ telegramId: "8600000001", createdAt: new Date(now - 4 * 86_400_000) }, now), false);
    assert.equal(isTooNewForRedeem({ telegramId: "7368118922", createdAt: new Date(now - 1 * 3_600_000) }, now), false);
});

test("Mốc 5/10/20 và Xếp hạng Đua Top ngày (tie-break ai đạt sớm hơn thắng)", () => {
    const cfg = {
        milestoneEnabled: true,
        milestone5Tokens: 15_000_000,
        milestone10Tokens: 25_000_000,
        milestone20Tokens: 50_000_000,
    };
    assert.equal(dueMilestones(4, cfg).length, 0);
    assert.deepEqual(dueMilestones(5, cfg).map((m) => m.count), [5]);
    assert.deepEqual(dueMilestones(12, cfg).map((m) => m.count), [5, 10]);

    const prog = nextMilestoneProgress(4, cfg);
    assert.equal(prog.target, 5);
    assert.equal(prog.bonusTokens, 15_000_000);

    // A và B cùng mời 2 người, nhưng B đạt người thứ 2 lúc 10:00, A đạt lúc 11:00 → B xếp hạng 1
    const ranked = rankDailyTopReferrers([
        { eventType: "join_channel", referrerTgId: "100", referredUserId: "901", createdAt: "2026-11-18T02:00:00Z" },
        { eventType: "join_channel", referrerTgId: "100", referredUserId: "902", createdAt: "2026-11-18T04:00:00Z" },
        { eventType: "join_channel", referrerTgId: "200", referredUserId: "801", createdAt: "2026-11-18T02:30:00Z" },
        { eventType: "join_channel", referrerTgId: "200", referredUserId: "802", createdAt: "2026-11-18T03:00:00Z" },
        // Bản ghi trùng cùng referredUserId không được đếm 2 lần
        { eventType: "join_channel", referrerTgId: "100", referredUserId: "902", createdAt: "2026-11-18T05:00:00Z" },
    ]);
    assert.equal(ranked.length, 2);
    assert.equal(ranked[0].referrerTgId, "200");
    assert.equal(ranked[0].count, 2);
    assert.equal(ranked[1].referrerTgId, "100");
    assert.equal(ranked[1].count, 2);
});

test("Múi giờ Việt Nam UTC+7 tính đúng biên ngày 00:00+07:00", () => {
    // 2026-11-18 00:30 giờ VN = 2026-11-17 17:30 UTC
    const a = Date.parse("2026-11-17T17:30:00Z");
    const b = Date.parse("2026-11-18T16:59:00Z");
    assert.equal(vnDayKey(a), "2026-11-18");
    assert.equal(isSameVnDay(a, b), true);
    assert.equal(vnDayStartUtc("2026-11-18").toISOString(), "2026-11-17T17:00:00.000Z");
});
