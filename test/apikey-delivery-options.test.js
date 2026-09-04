import test, { mock } from "node:test";
import assert from "node:assert/strict";

// Khách chọn RPM + số ngày ở bước 2/3 của luồng mua. Trước đây deliverApiKey lấy
// rpm/validDays từ CẤU HÌNH SHOP, nên khách chọn gì cũng ra mặc định. Test này ghim
// hợp đồng: đơn mang gì thì gửi provider đúng cái đó, và ngày hết hạn được lưu lại
// để /mykey hiện được.
const url = (path) => new URL(path, import.meta.url).href;

process.env.ADMIN_IDS = "";

const state = {
    createCalls: [],
    savedKeys: [],
    refunds: [],
    // profileId mà deliverApiKey hỏi cấu hình — chốt rằng nó đọc từ ĐƠN chứ không
    // rơi về cấu hình chung của shop.
    profileAsks: [],
    createResult: { ok: true, key: "sk-test-1", id: "ext-1" },
    // Cấu hình shop CỐ TÌNH khác lựa chọn của khách để phân biệt được hai nguồn.
    cfg: {
        enabled: true,
        configured: true,
        rpm: 300,
        validDays: 30,
        models: ["claude-opus-5"],
        endpoint: "https://api.example.com/v1",
        usageUrl: "https://api.example.com/key",
        docUrl: "https://docs.example.com",
    },
};

mock.module(url("../src/gpt2api.js"), {
    namedExports: {
        async getConfig() { return state.cfg; },
        // Mỗi "server" là cfg chung + nhóm fallback/giá riêng. Mock trả kèm tên để
        // test kiểm được key lưu đúng nguồn.
        async getProfileConfig(profileId) {
            state.profileAsks.push(profileId);
            const id = profileId === null || profileId === undefined ? 1 : Number(profileId);
            return { ...state.cfg, profileId: id, profileName: `Server ${id}` };
        },
        async getProfiles() { return [{ ...state.cfg, profileId: 1, profileName: "Server 1" }]; },
        async createApiKey(args) {
            state.createCalls.push(args);
            return { ...state.createResult, profileId: args?.profileId ?? 1, profileName: `Server ${args?.profileId ?? 1}` };
        },
        // keyboards.js import cả hàm này — mock.module thay cả module nên thiếu là gãy.
        isGpt2apiEnabledSync: () => true,
        invalidateGpt2apiConfig: () => {},
        warmGpt2apiConfig: async () => {},
        DEFAULT_MODELS: ["claude-opus-5"],
    },
});

mock.module(url("../src/apikey-store.js"), {
    namedExports: {
        KeySource: { GIFTCODE: "GIFTCODE", PURCHASE: "PURCHASE", ADMIN: "ADMIN" },
        async saveIssuedKey(entry) {
            state.savedKeys.push(entry);
            return { id: "key-1", ...entry };
        },
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

mock.module(url("../src/referral.js"), {
    namedExports: { processReferralCommission: async () => ({}) },
});
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

function makeOrder(extra = {}) {
    return {
        id: "order-key-1",
        productId: "prod-key",
        userId: "user-1",
        odelegramId: "777",
        chatId: "777",
        quantity: 1,
        finalAmount: 2500,
        paymentMethod: "wallet",
        displayFinalUsd: 0.1,
        apikeyTokens: 7_000_000,
        ...extra,
    };
}

function makePrisma(order) {
    const updates = [];
    return {
        updates,
        order: {
            async updateMany() { return { count: 1 }; },
            async update(args) { updates.push(args); return {}; },
            // Đơn trong DB chưa có deliveryRef → không phải nhánh "giao lại".
            async findUnique() { return { ...order, status: "DELIVERING" }; },
        },
        product: { async findUnique() { return PRODUCT; } },
        user: { async findUnique() { return { id: "user-1", language: "vi" }; } },
    };
}

const telegram = {
    sendMessage: async () => ({}),
    sendDocument: async () => ({}),
    sendPhoto: async () => ({}),
};

function reset() {
    state.createCalls = [];
    state.savedKeys = [];
    state.refunds = [];
    state.profileAsks = [];
    state.createResult = { ok: true, key: "sk-test-1", id: "ext-1" };
}

function deliveredPayload(prisma) {
    const hit = prisma.updates.find((u) => u.data?.deliveryRef === "API_KEY");
    assert.ok(hit, "đơn không được ghi deliveryContent");
    return JSON.parse(hit.data.deliveryContent);
}

test("RPM và số ngày KHÁCH CHỌN được gửi cho provider, không phải mặc định của shop", async () => {
    reset();
    const order = makeOrder({ apikeyRpm: 1200, apikeyValidDays: 7 });
    await deliverOrder({ prisma: makePrisma(order), telegram, order: { ...order } });

    assert.equal(state.createCalls.length, 1);
    assert.equal(state.createCalls[0].rpm, 1200, "phải dùng RPM khách chọn (1200), không phải cfg.rpm 300");
    assert.equal(state.createCalls[0].validDays, 7, "phải dùng 7 ngày khách chọn, không phải cfg 30");
    assert.equal(state.createCalls[0].quotaTokens, 7_000_000);
});

test("chọn 'không hết hạn' (0 ngày) không bị hiểu thành mặc định của shop", async () => {
    // Đây là cái bẫy: 0 là falsy nên `order.apikeyValidDays || cfg.validDays` sẽ
    // âm thầm biến "không hết hạn" thành "30 ngày" — khách mất key sau một tháng.
    reset();
    const order = makeOrder({ apikeyRpm: 600, apikeyValidDays: 0 });
    const prisma = makePrisma(order);
    await deliverOrder({ prisma, telegram, order: { ...order } });

    assert.equal(state.createCalls[0].validDays, 0, "0 ngày phải giữ nguyên là 0");
    assert.equal(state.savedKeys[0].expiresAt, null, "không hết hạn thì không lưu ngày hết hạn");
    assert.equal(deliveredPayload(prisma).expiresAt, null);
});

test("server KHÁCH CHỌN đi theo đơn tới tận provider", async () => {
    // Giá và nhóm model fallback thuộc về từng server. Cấp nhầm server = khách trả
    // tiền server này nhưng nhận key chạy nhóm model khác.
    reset();
    const order = makeOrder({ apikeyRpm: 600, apikeyValidDays: 7, apikeyProfile: 3 });
    await deliverOrder({ prisma: makePrisma(order), telegram, order: { ...order } });

    assert.equal(state.createCalls[0].profileId, 3, "createApiKey phải nhận server của đơn");
    assert.ok(state.profileAsks.includes(3), "cấu hình phải đọc theo server của đơn, không phải cfg chung");
    assert.equal(state.savedKeys[0].profileId, 3, "kho key phải ghi lại server đã cấp");
    assert.equal(state.savedKeys[0].profileName, "Server 3");
});

test("đơn cũ (chưa có field server) không gãy — lùi về server mặc định", async () => {
    // Đơn tạo trước khi có nhiều server vẫn phải giao được key.
    reset();
    const order = makeOrder({ apikeyRpm: 600, apikeyValidDays: 7 }); // apikeyProfile vắng hẳn
    await deliverOrder({ prisma: makePrisma(order), telegram, order: { ...order } });

    assert.equal(state.createCalls.length, 1, "vẫn phải cấp được key");
    assert.equal(state.createCalls[0].profileId, null);
});

test("đơn cũ (chưa có field ngày) mới lùi về cấu hình shop", async () => {
    reset();
    const order = makeOrder({ apikeyRpm: 600 }); // apikeyValidDays vắng hẳn
    await deliverOrder({ prisma: makePrisma(order), telegram, order: { ...order } });

    assert.equal(state.createCalls[0].validDays, 30, "đơn thiếu field mới dùng cfg.validDays");
});

test("ngày hết hạn được lưu vào kho key để /mykey hiện được", async () => {
    reset();
    const order = makeOrder({ apikeyRpm: 300, apikeyValidDays: 10 });
    const before = Date.now();
    const prisma = makePrisma(order);
    await deliverOrder({ prisma, telegram, order: { ...order } });

    const saved = state.savedKeys[0];
    assert.equal(saved.source, "PURCHASE");
    assert.equal(saved.rpm, 300);
    assert.ok(saved.expiresAt, "phải lưu expiresAt");
    const ms = new Date(saved.expiresAt).getTime() - before;
    // 10 ngày ±1 phút cho thời gian chạy test.
    assert.ok(Math.abs(ms - 10 * 86_400_000) < 60_000, `lệch ${ms}ms so với 10 ngày`);

    // Payload gửi khách mang cùng một mốc — không được lệch với kho key.
    assert.equal(deliveredPayload(prisma).expiresAt, new Date(saved.expiresAt).toISOString());
    assert.equal(deliveredPayload(prisma).validDays, 10);
});

test("provider trả về expires_at thì tin nó thay vì tự cộng ngày", async () => {
    reset();
    state.createResult = { ok: true, key: "sk-test-2", id: "ext-2", expiresAt: "2030-01-15T00:00:00.000Z" };
    const order = makeOrder({ apikeyRpm: 300, apikeyValidDays: 10 });
    const prisma = makePrisma(order);
    await deliverOrder({ prisma, telegram, order: { ...order } });

    assert.equal(state.savedKeys[0].expiresAt, "2030-01-15T00:00:00.000Z");
    assert.equal(deliveredPayload(prisma).expiresAt, "2030-01-15T00:00:00.000Z");
});

test("provider không cấp được key → hoàn tiền, không lưu key nào", async () => {
    reset();
    state.createResult = { ok: false, code: "network", message: "provider down" };
    const order = makeOrder({ apikeyRpm: 600, apikeyValidDays: 7 });

    await assert.rejects(
        deliverOrder({ prisma: makePrisma(order), telegram, order: { ...order } }),
        /API_KEY create fail/,
    );
    assert.equal(state.savedKeys.length, 0, "thất bại thì không được lưu key");
    assert.equal(state.refunds.length, 1, "khách trả ví phải được hoàn tiền");
    assert.equal(state.refunds[0].amount, 2500);
    assert.equal(state.refunds[0].orderId, "order-key-1", "refund keyed theo order → idempotent");
});

test("đơn thiếu số token bị chặn trước khi gọi provider", async () => {
    reset();
    const order = makeOrder({ apikeyTokens: 0, apikeyRpm: 300, apikeyValidDays: 7 });

    await assert.rejects(
        deliverOrder({ prisma: makePrisma(order), telegram, order: { ...order } }),
        /missing apikeyTokens/,
    );
    assert.equal(state.createCalls.length, 0);
});
