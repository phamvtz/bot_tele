import test from "node:test";
import assert from "node:assert/strict";
import { buildAdminOrderNotification } from "../src/delivery.js";

test("buildAdminOrderNotification: đơn hàng STOCK_LINES chi tiết đầy đủ", async () => {
    const mockOrder = {
        id: "order-test-12345678",
        odelegramId: "987654321",
        quantity: 2,
        amount: 200_000,
        discount: 20_000,
        finalAmount: 180_000,
        paymentMethod: "vietqr",
        paymentRef: "ORDER12345678",
        deliveryRef: "STOCK:item1,item2",
        deliveryContent: "ĐƠN HÀNG: 12345678\nSản phẩm: Netflix 1 Tháng × 2\n── Tài khoản ──\n#1\nnet1@gmail.com|pass1\n\n#2\nnet2@gmail.com|pass2",
        createdAt: new Date("2026-10-25T13:15:00+07:00"),
    };

    const mockProduct = {
        id: "prod-netflix",
        code: "NETFLIX_1M",
        name: "Netflix Premium 1 Tháng",
        price: 100_000,
        deliveryMode: "STOCK_LINES",
        stockAlertAt: 5,
        category: { name: "Tài Khoản Giải Trí" },
    };

    const mockUser = {
        id: "user-1",
        telegramId: "987654321",
        firstName: "Nguyen",
        lastName: "Van A",
        username: "nguyenvana",
        vipLevel: 2,
        balance: 50_000,
        totalSpent: 1_500_000,
        referredBy: "REF_VIP",
    };

    const mockPrisma = {
        user: { findUnique: async () => mockUser, findFirst: async () => mockUser },
        category: { findUnique: async () => ({ name: "Tài Khoản Giải Trí" }) },
        order: { findUnique: async () => mockOrder },
        stockItem: { count: async () => 3 }, // tồn kho còn 3 (< 5 -> cảnh báo sắp hết)
        coupon: { findUnique: async () => null },
    };

    const { text, replyMarkup } = await buildAdminOrderNotification({
        order: mockOrder,
        product: mockProduct,
        user: mockUser,
        prisma: mockPrisma,
    });

    // 1. Header
    assert.match(text, /ĐƠN HÀNG MỚI THÀNH CÔNG/);
    assert.match(text, /12345678/);

    // 2. Khách hàng
    assert.match(text, /Nguyen Van A/);
    assert.match(text, /@nguyenvana/);
    assert.match(text, /987654321/);
    assert.match(text, /VIP 2 \(Vàng\)/);
    assert.match(text, /50\.000đ/);
    assert.match(text, /1\.500\.000đ/);
    assert.match(text, /REF_VIP/);

    // 3. Sản phẩm
    assert.match(text, /Netflix Premium 1 Tháng/);
    assert.match(text, /Tài Khoản Giải Trí/);
    assert.match(text, /NETFLIX_1M/);
    assert.match(text, /x2/);

    // 4. Chi tiết kho hàng
    assert.match(text, /Tồn kho hiện tại:/);
    assert.match(text, /3 cái/);
    assert.match(text, /Sắp hết/);
    assert.match(text, /net1@gmail\.com\|pass1/);
    assert.match(text, /net2@gmail\.com\|pass2/);

    // 5. Thanh toán
    assert.match(text, /Đơn giá:.*100\.000đ/);
    assert.match(text, /Tổng tiền gốc:.*200\.000đ/);
    assert.match(text, /Mã giảm giá:.*-20\.000đ/);
    assert.match(text, /Thực thanh toán:.*180\.000đ/);
    assert.match(text, /Chuyển khoản VietQR/);
    assert.match(text, /ORDER12345678/);

    // 6. Buttons
    assert.ok(replyMarkup?.inline_keyboard);
    const row = replyMarkup.inline_keyboard[0];
    assert.equal(row[0].url, "tg://user?id=987654321");
    assert.equal(row[1].url, "https://t.me/nguyenvana");
});

test("buildAdminOrderNotification: đơn hàng API Key cấp mới", async () => {
    const payload = JSON.stringify({
        key: "sk-ant-api03-testkey-123456",
        quotaTokens: 100_000_000,
        rpm: 60,
        tpm: 1_000_000,
        validDays: 30,
        expiresAt: "2026-11-24T13:15:00.000Z",
        profileName: "Server 1 API Claude Private Server",
    });

    const mockOrder = {
        id: "order-apikey-new",
        odelegramId: "2127534563",
        quantity: 1,
        amount: 175_000,
        flashDiscountAmount: 52_355,
        finalAmount: 122_645,
        displayUnitPrice: 0.007,
        displayFinalUsd: 5.0,
        paymentMethod: "wallet",
        deliveryRef: "API_KEY",
        deliveryContent: payload,
        apikeyTokens: 100_000_000,
        apikeyRpm: 60,
        apikeyValidDays: 30,
        apikeyProfile: "Server 1 API Claude Private Server",
    };

    const mockProduct = {
        id: "prod-apikey",
        code: "__API_KEY__",
        name: "API Key",
        price: 0,
        deliveryMode: "API_KEY",
    };

    const mockUser = {
        id: "user-2",
        telegramId: "2127534563",
        username: "clientbot",
        vipLevel: 0,
        balance: 10_000,
        totalSpent: 300_000,
    };

    const { text, replyMarkup } = await buildAdminOrderNotification({
        order: mockOrder,
        product: mockProduct,
        user: mockUser,
        result: {
            deliveryRef: "API_KEY",
            apikey: {
                tokens: 100_000_000,
                rpm: 60,
                tpm: 1_000_000,
                validDays: 30,
                server: "Server 1 API Claude Private Server",
            },
        },
    });

    assert.match(text, /ĐƠN HÀNG MỚI THÀNH CÔNG/);
    assert.match(text, /API Key/);
    assert.match(text, /Server 1 API Claude Private Server/);
    assert.match(text, /100M token/);
    assert.match(text, /RPM 60/);
    assert.match(text, /TPM 1M/);
    assert.match(text, /30 ngày/);
    assert.match(text, /sk-ant-api03-testkey-123456/);
    assert.match(text, /Giảm Flash Sale:.*-52\.355đ/);
    assert.match(text, /122\.645đ/);
    assert.match(text, /\$5\.00/);
    assert.match(text, /Ví nội bộ/);

    assert.ok(replyMarkup?.inline_keyboard);
    assert.equal(replyMarkup.inline_keyboard[0][0].url, "tg://user?id=2127534563");
});

test("buildAdminOrderNotification: đơn hàng API Key gia hạn (RENEW)", async () => {
    const payload = JSON.stringify({
        key: "sk-ant-api03-renew-9999",
        addTokens: 50_000_000,
        addDays: 15,
        newTokens: 85_000_000,
        profileName: "Server 2 Claude VIP",
    });

    const mockOrder = {
        id: "order-apikey-renew",
        odelegramId: "5802735340",
        quantity: 1,
        finalAmount: 70_000,
        paymentMethod: "crypto_trc20",
        cryptoToken: "USDT",
        cryptoNetwork: "TRC20",
        cryptoAmount: 2.7,
        deliveryRef: "API_KEY_RENEW",
        apikeyRenewKeyId: "key-record-1",
        deliveryContent: payload,
    };

    const mockProduct = {
        id: "prod-apikey",
        code: "__API_KEY__",
        name: "API Key",
        price: 0,
        deliveryMode: "API_KEY",
    };

    const { text } = await buildAdminOrderNotification({
        order: mockOrder,
        product: mockProduct,
        user: { telegramId: "5802735340", firstName: "Customer" },
    });

    assert.match(text, /Gia hạn API Key/);
    assert.match(text, /Server 2 Claude VIP/);
    assert.match(text, /\+50M token/);
    assert.match(text, /Tổng sau nạp:.*85M token/);
    assert.match(text, /\+15 ngày/);
    assert.match(text, /sk-ant-api03-renew-9999/);
    assert.match(text, /USDT \(Mạng TRC20\)/);
    assert.match(text, /2\.7 USDT/);
});

test("buildAdminOrderNotification: dùng custom emoji khi menu_button_ids được cấu hình", async () => {
    const prevEnv = process.env.CUSTOM_EMOJI_ICONS;
    process.env.CUSTOM_EMOJI_ICONS = "true";
    const { setCachedMenuIconIds } = await import("../src/menu-config.js");
    setCachedMenuIconIds({
        ORDER_NEW_ADMIN: "5368324101",
        ADMIN_NOTIF_ORDER_ID: "5368324102",
        ADMIN_NOTIF_TIME: "5368324103",
        ADMIN_NOTIF_STATUS: "5368324104",
        ADMIN_NOTIF_CUSTOMER: "5368324105",
        ADMIN_NOTIF_PRODUCT: "5368324106",
        ADMIN_NOTIF_DELIVERY: "5368324107",
        ADMIN_NOTIF_PAYMENT: "5368324108",
        ADMIN_NOTIF_PAID: "5368324109",
        ADMIN_NOTIF_METHOD: "5368324110",
    });

    const mockOrder = {
        id: "order-custom-emoji",
        amount: 50_000,
        finalAmount: 50_000,
        quantity: 1,
        paymentMethod: "vietqr",
    };
    const mockProduct = {
        id: "prod-1",
        name: "Test Product",
        price: 50_000,
        deliveryMode: "STOCK_LINES",
    };

    const { text } = await buildAdminOrderNotification({
        order: mockOrder,
        product: mockProduct,
        user: { telegramId: "123456", firstName: "Test" },
        prisma: {
            user: { findUnique: async () => null, findFirst: async () => null },
            category: { findUnique: async () => null },
            stockItem: { count: async () => 0 },
        },
    });

    assert.match(text, /emoji-id="5368324101"/, "Tiêu đề ORDER_NEW_ADMIN phải có custom emoji");
    assert.match(text, /emoji-id="5368324102"/, "Mã đơn ADMIN_NOTIF_ORDER_ID phải có custom emoji");
    assert.match(text, /emoji-id="5368324103"/, "Thời gian ADMIN_NOTIF_TIME phải có custom emoji");
    assert.match(text, /emoji-id="5368324104"/, "Trạng thái ADMIN_NOTIF_STATUS phải có custom emoji");
    assert.match(text, /emoji-id="5368324105"/, "Khách hàng ADMIN_NOTIF_CUSTOMER phải có custom emoji");
    assert.match(text, /emoji-id="5368324106"/, "Sản phẩm ADMIN_NOTIF_PRODUCT phải có custom emoji");
    assert.match(text, /emoji-id="5368324107"/, "Bàn giao ADMIN_NOTIF_DELIVERY phải có custom emoji");
    assert.match(text, /emoji-id="5368324108"/, "Thanh toán ADMIN_NOTIF_PAYMENT phải có custom emoji");
    assert.match(text, /emoji-id="5368324109"/, "Thực thanh toán ADMIN_NOTIF_PAID phải có custom emoji");
    assert.match(text, /emoji-id="5368324110"/, "Phương thức ADMIN_NOTIF_METHOD phải có custom emoji");

    setCachedMenuIconIds(null);
    process.env.CUSTOM_EMOJI_ICONS = prevEnv;
});
