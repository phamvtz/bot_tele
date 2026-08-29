import test, { mock } from "node:test";
import assert from "node:assert/strict";

// giftcode.js gọi thẳng prisma + wallet, không nhận dependency injection → mock module.
// Chạy file này cần cờ --experimental-test-module-mocks (đã có trong npm test).
const url = (path) => new URL(path, import.meta.url).href;

const TG_ID = "555000111";

function createState({ gift = {}, creditFails = false } = {}) {
    return {
        gift: {
            id: "gift-1",
            code: "TET2026",
            amount: 50_000,
            maxUses: 2,
            usedCount: 0,
            perUserLimit: 1,
            vipOnly: 0,
            expiresAt: null,
            note: null,
            isActive: true,
            ...gift,
        },
        redemptions: [],
        credits: [],
        creditFails,
        balance: 10_000,
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
            // Mô phỏng gate atomic `usedCount < maxUses` của Mongo.
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
            // Mô phỏng unique index trên redeemKey.
            if (state.redemptions.some((r) => r.redeemKey === data.redeemKey)) {
                const err = new Error("E11000 duplicate key error");
                err.code = 11000;
                throw err;
            }
            const doc = { id: `red-${state.redemptions.length + 1}`, ...data };
            state.redemptions.push(doc);
            return { ...doc };
        },
        async update({ where, data }) {
            const doc = state.redemptions.find((r) => r.id === where.id);
            if (doc) Object.assign(doc, data);
            return doc ? { ...doc } : null;
        },
        async delete({ where }) {
            const i = state.redemptions.findIndex((r) => r.id === where.id);
            if (i >= 0) state.redemptions.splice(i, 1);
            return { id: where.id };
        },
        async findMany() {
            return state.redemptions.map((r) => ({ ...r }));
        },
    },
    user: {
        async findUnique() {
            return { vipLevel: state.userVipLevel ?? 0 };
        },
    },
};

mock.module(url("../src/lib/prisma.js"), {
    defaultExport: new Proxy({}, { get: (_t, prop) => prismaMock[prop] }),
});

mock.module(url("../src/wallet.js"), {
    namedExports: {
        TxType: { GIFTCODE: "GIFTCODE", ADMIN_ADD: "ADMIN_ADD" },
        async creditWallet(telegramId, amount, opts) {
            if (state.creditFails) return { success: false, error: "DB down" };
            state.credits.push({ telegramId: String(telegramId), amount, ...opts });
            state.balance += amount;
            return { success: true, newBalance: state.balance, transaction: { id: "tx-1" } };
        },
    },
});

const { redeemGiftCode, GiftCodeError } = await import("../src/giftcode.js");

test("đổi mã hợp lệ thì cộng ví và ghi lịch sử", async () => {
    state = createState();
    const result = await redeemGiftCode(TG_ID, "  tet2026 ");

    assert.equal(result.success, true);
    assert.equal(result.amount, 50_000);
    assert.equal(result.newBalance, 60_000);
    assert.equal(state.gift.usedCount, 1);
    assert.equal(state.credits.length, 1);
    assert.equal(state.credits[0].type, "GIFTCODE");
    assert.equal(state.redemptions.length, 1);
    assert.equal(state.redemptions[0].status, "SUCCESS");
});

test("cùng một user không đổi lại được mã perUserLimit=1", async () => {
    state = createState();
    await redeemGiftCode(TG_ID, "TET2026");
    const second = await redeemGiftCode(TG_ID, "TET2026");

    assert.equal(second.success, false);
    assert.equal(second.error, GiftCodeError.ALREADY_USED);
    assert.equal(state.gift.usedCount, 1, "lượt dùng không được tăng lần hai");
    assert.equal(state.credits.length, 1, "ví chỉ được cộng một lần");
});

test("hai request song song của cùng user chỉ một cái thắng", async () => {
    state = createState();
    const [a, b] = await Promise.all([
        redeemGiftCode(TG_ID, "TET2026"),
        redeemGiftCode(TG_ID, "TET2026"),
    ]);

    const wins = [a, b].filter((r) => r.success);
    assert.equal(wins.length, 1, "chỉ một request được cộng tiền");
    assert.equal(state.credits.length, 1);
    assert.equal(state.gift.usedCount, 1);
    const loser = [a, b].find((r) => !r.success);
    assert.equal(loser.error, GiftCodeError.ALREADY_USED);
});

test("hết lượt dùng toàn cục thì từ chối và không cộng tiền", async () => {
    state = createState({ gift: { maxUses: 1, usedCount: 1 } });
    const result = await redeemGiftCode(TG_ID, "TET2026");

    assert.equal(result.success, false);
    assert.equal(result.error, GiftCodeError.USED_UP);
    assert.equal(state.credits.length, 0);
    assert.equal(state.redemptions.length, 0, "không để lại redemption treo");
});

test("mã đã tắt hoặc hết hạn bị từ chối", async () => {
    state = createState({ gift: { isActive: false } });
    assert.equal((await redeemGiftCode(TG_ID, "TET2026")).error, GiftCodeError.INACTIVE);

    state = createState({ gift: { expiresAt: new Date(Date.now() - 86_400_000) } });
    assert.equal((await redeemGiftCode(TG_ID, "TET2026")).error, GiftCodeError.EXPIRED);
});

test("mã không tồn tại hoặc sai định dạng bị từ chối", async () => {
    state = createState();
    assert.equal((await redeemGiftCode(TG_ID, "KHONGCOMA")).error, GiftCodeError.INVALID);
    assert.equal((await redeemGiftCode(TG_ID, "ab")).error, GiftCodeError.INVALID);
    assert.equal((await redeemGiftCode(TG_ID, "MÃ CÓ DẤU")).error, GiftCodeError.INVALID);
    assert.equal(state.credits.length, 0);
});

test("mã VIP-only từ chối user chưa đủ cấp", async () => {
    state = createState({ gift: { vipOnly: 2 } });
    state.userVipLevel = 1;
    const result = await redeemGiftCode(TG_ID, "TET2026");

    assert.equal(result.success, false);
    assert.equal(result.error, GiftCodeError.VIP_REQUIRED);
    assert.equal(result.vipLevel, 2);
    assert.equal(state.credits.length, 0);
});

test("cộng ví thất bại thì rollback lượt dùng và redemption", async () => {
    state = createState({ creditFails: true });
    const result = await redeemGiftCode(TG_ID, "TET2026");

    assert.equal(result.success, false);
    assert.equal(result.error, GiftCodeError.CREDIT_FAILED);
    assert.equal(state.gift.usedCount, 0, "lượt dùng phải được nhả lại");
    assert.equal(state.redemptions.length, 0, "redemption phải bị xoá để user retry được");

    // Mã chưa bị cháy: lần sau đổi lại phải thành công.
    state.creditFails = false;
    const retry = await redeemGiftCode(TG_ID, "TET2026");
    assert.equal(retry.success, true);
    assert.equal(state.gift.usedCount, 1);
});

test("perUserLimit > 1 cho phép đổi đúng số lần cấu hình", async () => {
    state = createState({ gift: { perUserLimit: 2, maxUses: null } });

    assert.equal((await redeemGiftCode(TG_ID, "TET2026")).success, true);
    assert.equal((await redeemGiftCode(TG_ID, "TET2026")).success, true);
    const third = await redeemGiftCode(TG_ID, "TET2026");

    assert.equal(third.success, false);
    assert.equal(third.error, GiftCodeError.ALREADY_USED);
    assert.equal(state.credits.length, 2);
    assert.equal(state.gift.usedCount, 2);
});
