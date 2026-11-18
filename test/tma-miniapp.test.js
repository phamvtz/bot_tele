import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import express from "express";
import prisma from "../src/lib/prisma.js";
import {
    verifyTelegramInitData,
    signTmaSessionToken,
    verifyTmaSessionToken,
    createTmaAuthMiddleware,
    createChannelGateMiddleware,
    invalidateChannelGateCache,
} from "../src/middleware/tmaAuth.js";
import { createTmaApiRouter } from "../src/tma-api.js";
import { buildMainMenuKeyboard } from "../src/bot-ui/keyboards.js";
import { invalidateShopConfig } from "../src/shop-config.js";

// Tránh các hàm sync helper nền (như refreshHiddenMenuActions) mở kết nối Mongo thật khi chạy unit test
prisma.setting.findUnique = async () => null;
prisma.setting.findMany = async () => [];

const TEST_BOT_TOKEN = "1234567890:AAH_test_bot_token_for_miniapp_hmac_verify";

function buildSignedInitData({
    user = { id: 888999111, first_name: "Minh", username: "minh_tma", language_code: "vi" },
    authDate = Math.floor(Date.now() / 1000),
    startParam = "",
    queryId = "AAHdF6IQAAAAAN0XohDhrOrc",
    botToken = TEST_BOT_TOKEN,
} = {}) {
    const params = new URLSearchParams();
    params.set("auth_date", String(authDate));
    params.set("query_id", queryId);
    params.set("user", JSON.stringify(user));
    if (startParam) params.set("start_param", startParam);

    const pairs = [...params.entries()].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
    const checkStr = pairs.map(([k, v]) => `${k}=${v}`).join("\n");
    const secretKey = createHmac("sha256", "WebAppData").update(botToken).digest();
    const hash = createHmac("sha256", secretKey).update(checkStr).digest("hex");
    params.set("hash", hash);
    return params.toString();
}

async function withServer(app, fn) {
    const server = await new Promise((resolve) => {
        const s = app.listen(0, "127.0.0.1", () => resolve(s));
    });
    const { port } = server.address();
    const baseUrl = `http://127.0.0.1:${port}`;
    try {
        await fn(baseUrl);
    } finally {
        server.closeAllConnections?.();
        await new Promise((resolve) => server.close(resolve));
    }
}

test("verifyTelegramInitData chấp nhận initData ký đúng HMAC và từ chối giả mạo / quá hạn", () => {
    const now = 1_800_000_000_000;
    const nowSec = Math.floor(now / 1000);

    const validRaw = buildSignedInitData({
        authDate: nowSec - 60,
        startParam: "ref_ABC123",
    });
    const okRes = verifyTelegramInitData(validRaw, TEST_BOT_TOKEN, { now, maxAgeSec: 3600 });
    assert.equal(okRes.ok, true);
    assert.equal(okRes.telegramId, "888999111");
    assert.equal(okRes.startParam, "ref_ABC123");

    // Giả mạo user.id mà giữ nguyên hash cũ -> phải bị từ chối
    const tampered = validRaw.replace("888999111", "999999999");
    const badRes = verifyTelegramInitData(tampered, TEST_BOT_TOKEN, { now, maxAgeSec: 3600 });
    assert.equal(badRes.ok, false);
    assert.equal(badRes.code, "BAD_SIGNATURE");

    // Quá hạn auth_date -> phải bị từ chối
    const expiredRaw = buildSignedInitData({ authDate: nowSec - 7200 });
    const expRes = verifyTelegramInitData(expiredRaw, TEST_BOT_TOKEN, { now, maxAgeSec: 3600 });
    assert.equal(expRes.ok, false);
    assert.equal(expRes.code, "EXPIRED_INIT_DATA");
});

test("signTmaSessionToken và verifyTmaSessionToken ký/kiểm tra hạn chính xác", () => {
    const now = 1_800_000_000_000;
    const token = signTmaSessionToken({ telegramId: "888999111", isPremium: true }, TEST_BOT_TOKEN, {
        ttlSec: 600,
        now,
    });

    const valid = verifyTmaSessionToken(token, TEST_BOT_TOKEN, { now: now + 300_000 });
    assert.equal(valid.ok, true);
    assert.equal(valid.telegramId, "888999111");
    assert.equal(valid.isPremium, true);

    const expired = verifyTmaSessionToken(token, TEST_BOT_TOKEN, { now: now + 601_000 });
    assert.equal(expired.ok, false);
    assert.equal(expired.code, "SESSION_EXPIRED");
});

test("tmaAuth cho phép user chỉ bị isBlocked (lỗi 403 bot) nhưng chặn user bị Admin khóa isBanned", async () => {
    const users = new Map([
        ["1001", { id: "u1", telegramId: "1001", firstName: "MutedBot", isBlocked: true, isBanned: false }],
        ["1002", { id: "u2", telegramId: "1002", firstName: "BannedUser", isBlocked: true, isBanned: true }],
    ]);

    const app = express();
    app.use(createTmaAuthMiddleware({
        getBotToken: () => TEST_BOT_TOKEN,
        prisma: {
            user: {
                findUnique: async ({ where }) => users.get(String(where.telegramId)) || null,
            },
        },
        getOrCreateUser: async (tgUser) => users.get(String(tgUser.id)) || null,
    }));
    app.get("/ping", (req, res) => res.json({ ok: true, id: req.tmaUser.telegramId }));

    await withServer(app, async (base) => {
        const initMuted = buildSignedInitData({ user: { id: 1001, first_name: "MutedBot" } });
        const res1 = await fetch(`${base}/ping`, {
            headers: { Authorization: `tma ${initMuted}` },
        });
        assert.equal(res1.status, 200);

        const initBanned = buildSignedInitData({ user: { id: 1002, first_name: "BannedUser" } });
        const res2 = await fetch(`${base}/ping`, {
            headers: { Authorization: `tma ${initBanned}` },
        });
        assert.equal(res2.status, 403);
        const body2 = await res2.json();
        assert.equal(body2.code, "ACCOUNT_BANNED");
    });
});

test("Channel Gate cho xem tự do nhưng chặn thao tác mua khi chưa vào kênh", async () => {
    invalidateChannelGateCache();
    let isMember = false;

    const app = express();
    app.use((req, _res, next) => {
        req.tmaUser = { id: "u1", telegramId: "555666777" };
        next();
    });
    const requireJoin = createChannelGateMiddleware({
        getTelegram: () => ({
            getChatMember: async () => ({ status: isMember ? "member" : "left" }),
        }),
        configFn: () => ({
            requiredGroup: "@shop_channel",
            joinUrl: "https://t.me/shop_channel",
            enabled: true,
            failOpen: false,
            adminBypass: false,
            adminIds: [],
        }),
    });

    app.get("/browse", (_req, res) => res.json({ ok: true }));
    app.post("/buy", requireJoin, (_req, res) => res.json({ ok: true }));

    await withServer(app, async (base) => {
        // Xem tự do khi chưa join
        const browseRes = await fetch(`${base}/browse`);
        assert.equal(browseRes.status, 200);

        // Mua bị chặn 403 CHANNEL_JOIN_REQUIRED
        const buyBlocked = await fetch(`${base}/buy`, { method: "POST" });
        assert.equal(buyBlocked.status, 403);
        const blockedBody = await buyBlocked.json();
        assert.equal(blockedBody.code, "CHANNEL_JOIN_REQUIRED");
        assert.equal(blockedBody.joinUrl, "https://t.me/shop_channel");

        // Sau khi tham gia kênh -> mua thành công
        invalidateChannelGateCache("555666777");
        isMember = true;
        const buyOk = await fetch(`${base}/buy`, { method: "POST" });
        assert.equal(buyOk.status, 200);
    });
});

test("clientRef chống tạo đơn trùng trên /api/tma/orders/checkout", async () => {
    const orders = [];
    const mockPrisma = {
        user: {
            findUnique: async () => ({ id: "u1", telegramId: "777888999", vipLevel: 0, isBanned: false }),
        },
        order: {
            findFirst: async ({ where }) =>
                orders.find(
                    (o) =>
                        o.odelegramId === where.odelegramId &&
                        o.source === where.source &&
                        o.oderId === where.oderId,
                ) || null,
        },
    };

    // Seed sẵn 1 đơn DELIVERED có clientRef = "ord_dup_1"
    orders.push({
        id: "ord_12345678",
        odelegramId: "777888999",
        source: "miniapp",
        oderId: "ord_dup_1",
        status: "DELIVERED",
        deliveryContent: "acc@test.com|pass123",
    });

    const app = express();
    app.use(
        "/api/tma",
        express.json(),
        createTmaApiRouter({
            prisma: mockPrisma,
            getBotToken: () => TEST_BOT_TOKEN,
            getOrCreateUser: async () => ({
                id: "u1",
                telegramId: "777888999",
                vipLevel: 0,
                isBanned: false,
            }),
            channelConfigFn: () => ({
                requiredGroup: "",
                joinUrl: "",
                enabled: false,
                failOpen: true,
                adminBypass: false,
                adminIds: [],
            }),
        }),
    );

    await withServer(app, async (base) => {
        const initData = buildSignedInitData({ user: { id: 777888999, first_name: "DupTest" } });
        const res = await fetch(`${base}/api/tma/orders/checkout`, {
            method: "POST",
            headers: {
                Authorization: `tma ${initData}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                productId: "prod_1",
                quantity: 1,
                paymentMethod: "wallet",
                clientRef: "ord_dup_1",
            }),
        });
        assert.equal(res.status, 200);
        const data = await res.json();
        assert.equal(data.ok, true);
        assert.equal(data.duplicate, true);
        assert.equal(data.deliveryContent, "acc@test.com|pass123");
    });
});

test("buildMainMenuKeyboard chỉ gắn nút web_app Mini App khi MINI_APP_URL là https hợp lệ", () => {
    const prev = process.env.MINI_APP_URL;
    try {
        delete process.env.MINI_APP_URL;
        invalidateShopConfig();
        const kbWithout = buildMainMenuKeyboard({ lang: "vi" });
        const flatWithout = kbWithout.reply_markup.inline_keyboard.flat();
        assert.equal(flatWithout.some((b) => b.web_app), false);

        process.env.MINI_APP_URL = "https://shop.example.com/app";
        invalidateShopConfig();
        const kbWith = buildMainMenuKeyboard({ lang: "vi" });
        const firstBtn = kbWith.reply_markup.inline_keyboard[0][0];
        assert.deepEqual(firstBtn.web_app, { url: "https://shop.example.com/app" });
        assert.match(firstBtn.text, /Mini App/);
    } finally {
        if (prev === undefined) delete process.env.MINI_APP_URL;
        else process.env.MINI_APP_URL = prev;
        invalidateShopConfig();
    }
});

test("tmaAuth truyền đúng chuỗi startParam ref<tgId> (không phải [object Object]) vào getOrCreateUser", async () => {
    let capturedRefArg = undefined;
    const app = express();
    app.use(
        createTmaAuthMiddleware({
            getBotToken: () => TEST_BOT_TOKEN,
            prisma: { user: { findUnique: async () => null } },
            getOrCreateUser: async (tgUser, refParam) => {
                capturedRefArg = refParam;
                return { id: "u-new", telegramId: String(tgUser.id), isBanned: false };
            },
        }),
    );
    app.get("/check", (req, res) => res.json({ ok: true, id: req.tmaUser.telegramId }));

    await withServer(app, async (base) => {
        const initWithRef = buildSignedInitData({
            user: { id: 999888777, first_name: "NewFriend" },
            startParam: "ref8548644671",
        });
        const res = await fetch(`${base}/check`, {
            headers: { Authorization: `tma ${initWithRef}` },
        });
        assert.equal(res.status, 200);
        assert.equal(capturedRefArg, "ref8548644671");
    });
});
