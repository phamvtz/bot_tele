import test, { mock } from "node:test";
import assert from "node:assert/strict";

const url = (p) => new URL(p, import.meta.url).href;

const mockUsers = [
    {
        id: "u-inviter",
        telegramId: "111222333",
        username: "baongochup",
        firstName: "Bao Ngoc",
        referralCode: "INVITER1",
        referralPoints: 5,
        createdAt: new Date("2026-01-01T00:00:00Z"),
    },
    {
        id: "u-me",
        telegramId: "8548644671",
        username: "blueky",
        firstName: "Blueky",
        referralCode: "BLUEKY01",
        referredBy: "u-inviter",
        referralPoints: 0,
        hasJoinedChannel: true,
        channelPointAwarded: true,
        totalSuccessfulReferrals: 0,
        totalReferredBuyers: 0,
        createdAt: new Date("2026-11-18T00:00:00Z"),
    },
];

const prismaStub = {
    setting: { findMany: async () => [], findUnique: async () => null },
    user: {
        findUnique: async ({ where }) =>
            mockUsers.find((u) => (where.id && u.id === where.id) || (where.telegramId && String(u.telegramId) === String(where.telegramId))) || null,
        findMany: async () => [],
    },
    referral: { findMany: async () => [] },
    referralEvent: { findMany: async () => [] },
    redeemRequest: { findMany: async () => [], count: async () => 0, findFirst: async () => null },
    issuedApiKey: { findUnique: async () => null, findMany: async () => [] },
};

mock.module(url("../src/lib/prisma.js"), {
    defaultExport: prismaStub,
    namedExports: { prisma: prismaStub },
});

mock.module(url("../src/gpt2api.js"), {
    namedExports: {
        isGpt2apiEnabledSync: () => true,
        getConfig: async () => ({ enabled: true, configured: true, rpm: 100 }),
        getProfiles: async () => [],
        getSourceProfileId: async () => 2,
        getProfileConfig: async () => ({ profileId: 2, profileName: "Claude-Kiro", enabled: true, configured: true, rpm: 100 }),
        createApiKey: async () => ({ ok: false }),
        renewApiKey: async () => ({ ok: false }),
        getKeyStatus: async () => ({ ok: false }),
        invalidateKeyStatusCache: () => {},
        isSafeApiKeyCreateFailure: () => true,
    },
});

mock.module(url("../src/delivery.js"), {
    namedExports: {
        deliverOrder: async () => ({ ok: true }),
    },
});

const { DEFAULT_ICONS } = await import("../src/menu-config.js");
const { buildMainMenuKeyboard, navBtn } = await import("../src/bot-ui/keyboards.js");
const { mainMenuMessage } = await import("../src/bot-ui/messages.js");
const { createReferralBotModule } = await import("../src/bot-referral.js");

test("Menu chính hiển thị khối hướng dẫn Mời bạn + link ref khi bật và ẩn gọn khi tắt", () => {
    const withGuide = mainMenuMessage({
        firstName: "Blueky",
        balance: 3_000_701,
        productCount: 12,
        vipEmoji: "👑",
        vipName: "Bạch kim",
        lang: "vi",
        referralGuide: {
            enabled: true,
            inviteReferrerMinTokens: 2_000_000,
            inviteReferrerMaxTokens: 7_000_000,
            inviteTokenAmount: 20_000_000,
            inviteReferrerKeyDays: 30,
            inviteTokenDays: 1,
            milestoneEnabled: true,
            milestone5Tokens: 15_000_000,
            milestone10Tokens: 25_000_000,
            milestone20Tokens: 50_000_000,
            dailyTopEnabled: true,
            dailyTop1Tokens: 50_000_000,
            dailyTop2Tokens: 30_000_000,
            dailyTop3Tokens: 15_000_000,
            pointJoinChannel: 1,
            link: "https://t.me/Yingzshopbot?start=ref8548644671",
        },
    });

    assert.match(withGuide, /MỜI BẠN — KEY THƯỞNG 2M–7M \+ KEY BẠN BÈ 20M/);
    assert.match(withGuide, /1 key thưởng hạn <b>30 ngày<\/b>/);
    assert.match(withGuide, /Bonus mốc <b>5 người: \+15M · 10 người: \+25M · 20 người: \+50M<\/b>/);
    assert.match(withGuide, /Top 1–2–3 mỗi ngày: <b>50M \/ 30M \/ 15M token<\/b>/);
    assert.match(withGuide, /https:\/\/t\.me\/Yingzshopbot\?start=ref8548644671/);
    assert.match(withGuide, /🏅 <b>Hạng thành viên<\/b>:/);

    const withoutGuide = mainMenuMessage({
        firstName: "Blueky",
        balance: 3_000_701,
        productCount: 12,
        lang: "vi",
        referralGuide: { enabled: false },
    });
    assert.doesNotMatch(withoutGuide, /MỜI BẠN — KEY THƯỞNG/);
});

test("Nút trên Menu chính hiển thị nhãn 'Giới thiệu & Điểm' cùng icon 🎉", () => {
    const kbVi = buildMainMenuKeyboard({ icons: DEFAULT_ICONS, lang: "vi" }).reply_markup.inline_keyboard.flat();
    const refBtnVi = kbVi.find((b) => b.callback_data === "REFERRAL");
    assert.ok(refBtnVi);
    assert.equal(refBtnVi.text, "🎉 Giới thiệu & Điểm");

    const kbEn = buildMainMenuKeyboard({ icons: DEFAULT_ICONS, lang: "en" }).reply_markup.inline_keyboard.flat();
    const refBtnEn = kbEn.find((b) => b.callback_data === "REFERRAL");
    assert.equal(refBtnEn.text, "🎉 Referral & Points");
});

test("Màn 'Giới thiệu & Điểm thưởng' hiển thị đầy đủ Pipeline mời, người giới thiệu và 7 hàng nút bấm", async () => {
    let renderedText = "";
    let renderedExtra = null;

    const mod = createReferralBotModule({
        getLang: () => "vi",
        editMenu: async (_ctx, text, extra) => {
            renderedText = text;
            renderedExtra = extra;
        },
        cleanReply: async (_ctx, text, extra) => {
            renderedText = text;
            renderedExtra = extra;
        },
        safeDelete: async () => {},
        getBotInfo: async () => ({ username: "Yingzshopbot", first_name: "Shop" }),
        isGroupMember: async () => true,
        iconOf: (k) => DEFAULT_ICONS[k] || "🎁",
        iconBtn: (_k, label, cb) => ({ text: label, callback_data: cb }),
        navBtn,
        buildApiKeyDeliveredKeyboard: () => ({}),
        formatUsdPrimary: (v) => `${v}đ`,
        liveUsdVndRate: () => 26000,
    });

    await mod.showReferralMenu({ from: { id: 8548644671 } }, { edit: true });

    assert.match(renderedText, /🎁 <b>Giới thiệu &amp; Điểm thưởng<\/b>/);
    assert.match(renderedText, /https:\/\/t\.me\/Yingzshopbot\?start=ref8548644671/);
    assert.match(renderedText, /📭 Chưa có key thưởng/);
    assert.match(renderedText, /📈 Tiến độ mời: <code>░░░░░░░░░░<\/code> <b>0\/5<\/b>/);
    assert.match(renderedText, /🤝 Bạn được giới thiệu bởi: <b>@baongochup<\/b>/);
    assert.match(renderedText, /📊 <b>Pipeline mời:<\/b>/);
    assert.match(renderedText, /👥 Đã \/start qua link: <b>0<\/b>/);
    assert.match(renderedText, /✅ Đã join channel \(đã \+1đ\): <b>0<\/b>/);
    assert.match(renderedText, /🛒 Người mua giới thiệu: <b>0<\/b>/);
    assert.match(renderedText, /🔋 Đổi điểm lấy token API Claude-Kiro: <b>1 điểm = 10M<\/b> \(trần <b>100M<\/b>\/user\)\./);

    const rows = renderedExtra.reply_markup.inline_keyboard;
    assert.equal(rows.length, 7);
    const callbacks = rows.flat().map((b) => b.callback_data || "URL");
    assert.deepEqual(callbacks, [
        "URL",
        "REF:LINK",
        "REF:COPY_KEY",
        "REF:HISTORY",
        "REF:DETAILS",
        "REF:LB",
        "REF:REDEEM_MENU",
        "REF:RULES",
        "BACK_HOME",
    ]);
});
