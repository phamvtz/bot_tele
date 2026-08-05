import test from "node:test";
import assert from "node:assert/strict";
import { mock } from "node:test";

// M4: các việc hậu giao hàng chạy trong Promise.allSettled. Trước đây kết quả bị
// vứt đi, nên hoa hồng referral / cộng VIP hỏng mà không ai biết. Test này ghim
// yêu cầu: mỗi task rớt phải được log ERROR kèm tên task và orderId.
const url = (path) => new URL(path, import.meta.url).href;

process.env.ADMIN_IDS = "";

const logs = [];
let referralError = null;
let spendingError = null;

mock.module(url("../src/referral.js"), {
    namedExports: {
        processReferralCommission: async () => {
            if (referralError) throw new Error(referralError);
            return {};
        },
    },
});
mock.module(url("../src/vip.js"), {
    namedExports: {
        addSpending: async () => {
            if (spendingError) throw new Error(spendingError);
            return {};
        },
    },
});
mock.module(url("../src/inventory.js"), {
    namedExports: { checkStock: async () => {}, invalidateStockCache: () => {} },
});
mock.module(url("../src/broadcast.js"), {
    namedExports: { broadcastNewOrder: async () => {}, maskBuyerName: (v) => v },
});
mock.module(url("../src/lib/logger.js"), {
    namedExports: {
        sendLog: (type, message) => logs.push({ type, message }),
    },
});
mock.module(url("../src/shop-config.js"), {
    namedExports: {
        // Tắt kênh thông báo để test chỉ còn tập trung vào referral/VIP.
        isOrderChannelNotifyEnabled: async () => false,
        getOrderNotifyChannel: async () => null,
        getSupportChannelUrlSync: () => "",
        // Các export còn lại: mock.module thay thế cả module, thiếu là cả cây import gãy.
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

const ORDER = {
    id: "order-m4-1",
    productId: "prod-1",
    userId: "user-1",
    odelegramId: "123",
    chatId: "123",
    quantity: 1,
    finalAmount: 265000,
};
const PRODUCT = { id: "prod-1", name: "Kiro Power", deliveryMode: "TEXT", payload: "ACCOUNT-XYZ" };

function makePrisma() {
    return {
        order: {
            async updateMany() { return { count: 1 }; },
            async update() { return {}; },
            async findUnique() { return { ...ORDER, status: "DELIVERING" }; },
        },
        product: { async findUnique() { return PRODUCT; } },
        user: { async findUnique() { return { id: "user-1", language: "vi" }; } },
    };
}

const telegram = { sendMessage: async () => ({}), sendDocument: async () => ({}), sendPhoto: async () => ({}) };

test("logs an ERROR naming the task and order when a post-delivery task fails", async () => {
    logs.length = 0;
    referralError = "referral db down";
    spendingError = null;

    const result = await deliverOrder({ prisma: makePrisma(), telegram, order: { ...ORDER } });

    // Giao hàng vẫn thành công — task phụ hỏng không được nuốt cả đơn.
    assert.equal(result.deliveryRef, "TEXT");

    const errors = logs.filter((entry) => entry.type === "ERROR");
    assert.equal(errors.length, 1);
    assert.match(errors[0].message, /processReferralCommission/);
    assert.match(errors[0].message, /order-m4-1/);
    assert.match(errors[0].message, /referral db down/);
});

test("reports every failed task, not just the first", async () => {
    logs.length = 0;
    referralError = "referral down";
    spendingError = "vip down";

    await deliverOrder({ prisma: makePrisma(), telegram, order: { ...ORDER } });

    const errors = logs.filter((entry) => entry.type === "ERROR");
    assert.equal(errors.length, 2);
    assert.ok(errors.some((entry) => /processReferralCommission/.test(entry.message)));
    assert.ok(errors.some((entry) => /addSpending/.test(entry.message)));
});

test("stays silent when every post-delivery task succeeds", async () => {
    logs.length = 0;
    referralError = null;
    spendingError = null;

    await deliverOrder({ prisma: makePrisma(), telegram, order: { ...ORDER } });

    assert.equal(logs.filter((entry) => entry.type === "ERROR").length, 0);
});
