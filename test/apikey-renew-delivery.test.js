import test, { mock } from "node:test";
import assert from "node:assert/strict";

/**
 * Giao đơn GIA HẠN. Rủi ro lớn nhất không phải "gia hạn hụt" mà là "gia hạn HAI
 * LẦN": quota_limit bên xpiki là số TUYỆT ĐỐI và ta đọc-rồi-cộng, nên mỗi lượt
 * chạy lại là tặng thêm một lần token trong khi khách chỉ trả tiền một lần.
 * Đơn không được đóng đúng = delivery-recovery quét lại suốt 7 ngày.
 */
const url = (path) => new URL(path, import.meta.url).href;

process.env.ADMIN_IDS = "";

const state = {
    renewCalls: [],
    createCalls: [],
    refunds: [],
    keyUpdates: [],
    renewResult: null,
    cfg: {
        enabled: true, configured: true, rpm: 300, validDays: 30, quotaRefPrice: 15,
        models: ["claude-opus-5"], endpoint: "https://api.example.com/v1",
        usageUrl: "https://api.example.com/key", docUrl: "https://docs.example.com",
    },
};

mock.module(url("../src/gpt2api.js"), {
    namedExports: {
        async getConfig() { return state.cfg; },
        async getProfileConfig(profileId) {
            const id = profileId ?? 1;
            return { ...state.cfg, profileId: id, profileName: `Server ${id}` };
        },
        async getProfiles() { return [{ ...state.cfg, profileId: 1, profileName: "Server 1" }]; },
        async createApiKey(args) {
            state.createCalls.push(args);
            return { ok: true, key: "sk-NEW", id: "ext-new" };
        },
        async renewApiKey(args) {
            state.renewCalls.push(args);
            return state.renewResult;
        },
        isGpt2apiEnabledSync: () => true,
        invalidateGpt2apiConfig: () => {},
        warmGpt2apiConfig: async () => {},
        DEFAULT_MODELS: ["claude-opus-5"],
    },
});

mock.module(url("../src/apikey-store.js"), {
    namedExports: {
        KeySource: { GIFTCODE: "GIFTCODE", PURCHASE: "PURCHASE", ADMIN: "ADMIN" },
        async saveIssuedKey(entry) { return { id: "key-1", ...entry }; },
    },
});
mock.module(url("../src/wallet.js"), {
    namedExports: {
        async refund(tgId, amount, orderId, note) {
            state.refunds.push({ tgId, amount, orderId, note });
            return { success: true };
        },
    },
});
mock.module(url("../src/referral.js"), { namedExports: { processReferralCommission: async () => ({}) } });
mock.module(url("../src/vip.js"), { namedExports: { addSpending: async () => ({}) } });
mock.module(url("../src/inventory.js"), {
    namedExports: { checkStock: async () => {}, invalidateStockCache: () => {} },
});
mock.module(url("../src/broadcast.js"), {
    namedExports: { broadcastNewOrder: async () => {}, maskBuyerName: (v) => v },
});
mock.module(url("../src/lib/logger.js"), { namedExports: { sendLog: () => {} } });
mock.module(url("../src/shop-config.js"), {
    namedExports: {
        isOrderChannelNotifyEnabled: async () => false,
        getOrderNotifyChannel: async () => null,
        getSupportChannelUrlSync: () => "",
        invalidateShopConfig: () => {},
        getBankConfig: async () => ({}),
        getBankConfigSync: () => ({}),
        getSupportChannelUrl: async () => "",
        isOrderBotBroadcastEnabled: async () => false,
        getOrderExpireMinutes: async () => 10,
        getOrderExpireMinutesSync: () => 10,
        getCryptoConfigSync: () => ({}),
        getSepayApiKey: async () => "",
        getSepayApiKeySync: () => "",
        getMaxDeposit: async () => 0,
        getDepositPresets: async () => [],
        warmShopConfig: async () => {},
    },
});

const { deliverOrder } = await import("../src/delivery.js");

const PRODUCT = { id: "prod-key", name: "API Key", deliveryMode: "API_KEY", code: "__API_KEY__" };

/** DB giả CÓ TRẠNG THÁI: chạy deliverOrder hai lượt phải thấy đúng cái lượt trước ghi. */
function makeDb({ orderExtra = {}, key = {} } = {}) {
    const order = {
        id: "order-rn-1", productId: "prod-key", userId: "user-1",
        odelegramId: "777", chatId: "777", quantity: 1,
        finalAmount: 2500, paymentMethod: "wallet", displayFinalUsd: 0.1,
        status: "PAID", deliveryRef: null, deliveryContent: null,
        apikeyRenewKeyId: "key-1", apikeyAddTokens: 50_000_000, apikeyAddDays: 30,
        ...orderExtra,
    };
    const keyRow = {
        id: "key-1", telegramId: "777", key: "sk-old", externalId: "ext-1",
        quotaTokens: 100_000_000, expiresAt: new Date("2026-09-10T00:00:00Z"),
        profileId: 2, renewCount: 0, notifyStage: 3, ...key,
    };
    const matches = (where, row) => Object.entries(where).every(([k, v]) => {
        if (v && typeof v === "object" && Array.isArray(v.in)) return v.in.includes(row[k]);
        return row[k] === v;
    });
    return {
        order, keyRow,
        prisma: {
            order: {
                async updateMany({ where, data }) {
                    if (!matches(where, order)) return { count: 0 };
                    Object.assign(order, data);
                    return { count: 1 };
                },
                async update({ data }) { Object.assign(order, data); return order; },
                async findUnique() { return { ...order }; },
            },
            issuedApiKey: {
                async findUnique({ where }) { return where.id === keyRow.id ? { ...keyRow } : null; },
                async update({ data }) {
                    state.keyUpdates.push(data);
                    Object.assign(keyRow, data);
                    return keyRow;
                },
            },
            product: { async findUnique() { return PRODUCT; } },
            user: { async findUnique() { return { id: "user-1", language: "vi" }; } },
        },
    };
}

const telegram = { sendMessage: async () => ({}), sendDocument: async () => ({}), sendPhoto: async () => ({}) };

function reset(renewResult) {
    state.renewCalls = [];
    state.createCalls = [];
    state.refunds = [];
    state.keyUpdates = [];
    state.renewResult = renewResult ?? {
        ok: true,
        before: { quotaLimit: 15_000_000, expiresAt: "2026-09-10T00:00:00Z" },
        after: { quotaLimit: 22_500_000, expiresAt: "2026-10-10T00:00:00Z" },
        quotaRefPrice: 15, profileId: 2, profileName: "Server 2",
    };
}

test("đơn gia hạn PATCH key cũ, KHÔNG cấp key mới", async () => {
    reset();
    const db = makeDb();
    await deliverOrder({ prisma: db.prisma, telegram, order: { ...db.order } });

    assert.equal(state.createCalls.length, 0, "gia hạn mà lại tạo key mới = khách phải đổi key trong app");
    assert.equal(state.renewCalls.length, 1);
    assert.deepEqual(state.renewCalls[0], {
        externalId: "ext-1", addTokens: 50_000_000, addDays: 30, profileId: 2,
    });
});

test("gia hạn xong thì ĐÓNG ĐƠN — nếu không, recovery sẽ gia hạn lại miễn phí", async () => {
    reset();
    const db = makeDb();
    await deliverOrder({ prisma: db.prisma, telegram, order: { ...db.order } });

    assert.equal(db.order.status, "DELIVERED", "đơn còn PAID/DELIVERING là recovery quét lại trong 7 ngày");
    assert.equal(db.order.deliveryRef, "API_KEY_RENEW");
    assert.ok(db.order.deliveryContent, "thiếu biên nhận để gửi lại khi retry");
});

test("giao lại đơn đã gia hạn: gửi lại biên nhận, TUYỆT ĐỐI không PATCH lần hai", async () => {
    reset();
    const db = makeDb();
    await deliverOrder({ prisma: db.prisma, telegram, order: { ...db.order } });
    assert.equal(state.renewCalls.length, 1);

    // delivery-recovery đẩy đơn về PAID rồi giao lại (kịch bản có thật).
    db.order.status = "PAID";
    await deliverOrder({ prisma: db.prisma, telegram, order: { ...db.order } });

    assert.equal(state.renewCalls.length, 1, "khách được cộng token hai lần mà chỉ trả tiền một lần");
    assert.equal(db.order.status, "DELIVERED");
});

test("chết giữa lúc PATCH: lượt sau KHÔNG gia hạn lại và cũng KHÔNG hoàn tiền", async () => {
    // Cờ WIP còn treo = lượt trước đã gửi lệnh sang provider. Gia hạn lại là mất
    // token; hoàn tiền là khách vừa giữ token vừa lấy lại tiền. Đóng đơn, báo admin.
    reset();
    const db = makeDb({ orderExtra: { deliveryRef: "API_KEY_RENEW_WIP" } });
    await deliverOrder({ prisma: db.prisma, telegram, order: { ...db.order } });

    assert.equal(state.renewCalls.length, 0);
    assert.equal(state.refunds.length, 0);
    assert.equal(db.order.status, "DELIVERED");
});

test("kho key được cập nhật số mới và MỞ LẠI chuỗi nhắc hạn", async () => {
    reset();
    const db = makeDb();
    await deliverOrder({ prisma: db.prisma, telegram, order: { ...db.order } });

    const upd = state.keyUpdates[0];
    assert.ok(upd, "không cập nhật IssuedApiKey → /mykey vẫn hiện số cũ");
    assert.equal(upd.quotaTokens, 150_000_000, "22.5M quota × 100/15 = 150M token hiển thị");
    assert.equal(new Date(upd.expiresAt).toISOString(), "2026-10-10T00:00:00.000Z");
    assert.equal(upd.renewCount, 1);
    assert.equal(upd.notifyStage, 0, "không reset thì key gia hạn rồi sẽ không bao giờ được nhắc nữa");
    assert.equal(upd.notifyAt, null);
});

test("lỗi TRƯỚC khi gửi lệnh → hoàn tiền + huỷ đơn", async () => {
    reset({ ok: false, code: "nothing_to_renew", message: "key vô hạn" });
    const db = makeDb();
    await assert.rejects(() => deliverOrder({ prisma: db.prisma, telegram, order: { ...db.order } }));

    assert.equal(state.refunds.length, 1, "chưa đụng gì tới key mà không hoàn tiền là ăn chặn");
    assert.equal(state.refunds[0].amount, 2500);
    assert.equal(db.order.status, "CANCELED");
});

test("key không còn trong kho → hoàn tiền", async () => {
    reset();
    const db = makeDb({ orderExtra: { apikeyRenewKeyId: "khong-ton-tai" } });
    await assert.rejects(() => deliverOrder({ prisma: db.prisma, telegram, order: { ...db.order } }));

    assert.equal(state.renewCalls.length, 0);
    assert.equal(state.refunds.length, 1);
    assert.equal(db.order.status, "CANCELED");
});

test("lỗi SAU khi đã gửi lệnh → KHÔNG hoàn tự động, và chặn retry", async () => {
    // quota_not_applied nghĩa là lệnh đã bay sang provider rồi mới hỏng. Có thể đã
    // cộng một phần → hoàn tiền là vừa mất token vừa mất tiền. Để admin soát.
    reset({ ok: false, code: "quota_not_applied", message: "provider không nhận" });
    const db = makeDb();
    await assert.rejects(() => deliverOrder({ prisma: db.prisma, telegram, order: { ...db.order } }));

    assert.equal(state.refunds.length, 0, "hoàn tiền cho ca có thể đã cộng quota = shop mất cả hai đầu");
    assert.ok(db.order.deliveryRetryBlockedAt, "không chặn thì recovery PATCH lại lần nữa");
});

test("đơn MUA MỚI không bị nhánh gia hạn nuốt mất", async () => {
    reset();
    const db = makeDb({
        orderExtra: { apikeyRenewKeyId: null, apikeyTokens: 7_000_000, apikeyRpm: 600, apikeyValidDays: 7 },
    });
    await deliverOrder({ prisma: db.prisma, telegram, order: { ...db.order } });

    assert.equal(state.renewCalls.length, 0);
    assert.equal(state.createCalls.length, 1);
    assert.equal(db.order.deliveryRef, "API_KEY");
});
