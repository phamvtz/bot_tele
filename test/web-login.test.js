import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import prisma from "../src/lib/prisma.js";
import { verifyTmaSessionToken, signTmaSessionToken } from "../src/middleware/tmaAuth.js";
import { createWebLoginStore, createWebAuthRouter } from "../src/web-login.js";
import { createTmaApiRouter } from "../src/tma-api.js";

process.env.USER_API_SECRET = process.env.USER_API_SECRET || "test-web-login-user-secret";
const { getUserApiKey } = await import("../src/user-api.js");

const TEST_BOT_TOKEN = "9988776655:AAH_test_bot_token_web_login_and_export";

async function withServer(app, fn) {
    const server = await new Promise((resolve) => {
        const s = app.listen(0, "127.0.0.1", () => resolve(s));
    });
    const { port } = server.address();
    try {
        await fn(`http://127.0.0.1:${port}`);
    } finally {
        server.closeAllConnections?.();
        await new Promise((resolve) => server.close(resolve));
    }
}

test("createWebLoginStore cấp challenge, duyệt 1 lần và tự huỷ sau khi poll hoặc hết hạn", () => {
    let now = 1_800_000_000_000;
    const store = createWebLoginStore({ ttlMs: 60_000, nowFn: () => now });

    const { token, expiresAt } = store.startSession();
    assert.ok(token.length >= 16);
    assert.equal(expiresAt, now + 60_000);
    assert.equal(store.getChallenge(token)?.status, "pending");
    assert.equal(store.poll(token).status, "pending");

    // Duyệt thành công -> poll 1 lần nhận sessionToken, poll lần 2 đã hết/bị xóa
    const approved = store.approve(token, { telegramId: "555111222", sessionToken: "tma_sess_v1.abc.def" });
    assert.equal(approved.ok, true);
    assert.equal(store.getChallenge(token), null);

    const firstPoll = store.poll(token);
    assert.equal(firstPoll.status, "approved");
    assert.equal(firstPoll.sessionToken, "tma_sess_v1.abc.def");

    const secondPoll = store.poll(token);
    assert.equal(secondPoll.status, "expired");

    // Token khác bị hủy qua reject()
    const s2 = store.startSession();
    assert.equal(store.reject(s2.token).ok, true);
    assert.equal(store.poll(s2.token).status, "rejected");
    assert.equal(store.poll(s2.token).status, "expired");

    // Token quá hạn tự dọn
    const s3 = store.startSession();
    now += 61_000;
    assert.equal(store.getChallenge(s3.token), null);
    assert.equal(store.poll(s3.token).status, "expired");
});

test("Web auth (/start -> bot approve -> /poll) và /apikey cấp sessionToken hợp lệ để gọi /api/tma/apikey/my-keys/export", async () => {
    const prevSettingUnique = prisma.setting.findUnique;
    const prevSettingMany = prisma.setting.findMany;
    const prevKeyFindMany = prisma.issuedApiKey.findMany;
    prisma.setting.findUnique = async () => null;
    prisma.setting.findMany = async () => [];

    const now = Date.now();
    const fakeKeys = [
        {
            id: "k_active_1",
            telegramId: "112233445",
            key: "sk-proj-fullsecret-active-001",
            quotaTokens: 50_000_000,
            rpm: 100,
            source: "PURCHASE",
            profileId: 1,
            profileName: "Server 1",
            externalId: null,
            expiresAt: new Date(now + 86_400_000 * 10),
            createdAt: new Date(now - 3600_000),
            hiddenAt: null,
        },
        {
            id: "k_expired_2",
            telegramId: "112233445",
            key: "sk-proj-fullsecret-expired-002",
            quotaTokens: 10_000_000,
            rpm: 60,
            source: "REFERRAL",
            profileId: 2,
            profileName: "Server 2",
            externalId: null,
            expiresAt: new Date(now - 86_400_000),
            createdAt: new Date(now - 86_400_000 * 40),
            hiddenAt: null,
        },
    ];
    prisma.issuedApiKey.findMany = async () => fakeKeys;

    const users = new Map([
        ["112233445", { id: "u1", telegramId: "112233445", firstName: "WebTester", username: "webtester", isBanned: false, isTelegramPremium: false }],
        ["999000111", { id: "u2", telegramId: "999000111", firstName: "BannedUser", isBanned: true }],
    ]);
    const mockPrisma = {
        ...prisma,
        user: {
            findUnique: async ({ where }) => users.get(String(where.telegramId)) || null,
        },
    };

    const store = createWebLoginStore();
    const app = express();
    app.use(
        "/api/shop/auth",
        express.json(),
        createWebAuthRouter({
            store,
            prisma: mockPrisma,
            getBotToken: () => TEST_BOT_TOKEN,
            getBotUsername: () => "ShopAccountsPreBot",
            getSellerKeys: async () => [
                { key: "sk_seller_custom_123456", telegramId: "112233445", active: true },
            ],
        }),
    );
    app.use(
        "/api/tma",
        express.json(),
        createTmaApiRouter({
            prisma: mockPrisma,
            getBotToken: () => TEST_BOT_TOKEN,
            channelConfigFn: () => ({ enabled: false, requiredGroup: "", joinUrl: "" }),
        }),
    );

    try {
        await withServer(app, async (base) => {
            // 1. Không token bị chặn 401
            const unauth = await fetch(`${base}/api/tma/apikey/my-keys/export`);
            assert.equal(unauth.status, 401);

            // 2. Đăng nhập 1 chạm Telegram
            const startRes = await fetch(`${base}/api/shop/auth/start`, { method: "POST" });
            assert.equal(startRes.status, 200);
            const startData = await startRes.json();
            assert.equal(startData.deepLink, `https://t.me/ShopAccountsPreBot?start=weblogin_${startData.token}`);

            const pollPending = await fetch(`${base}/api/shop/auth/poll?token=${startData.token}`).then((r) => r.json());
            assert.equal(pollPending.status, "pending");

            const signedFromBot = signTmaSessionToken({ telegramId: "112233445", isPremium: false }, TEST_BOT_TOKEN);
            assert.equal(store.approve(startData.token, { telegramId: "112233445", sessionToken: signedFromBot }).ok, true);

            const pollDone = await fetch(`${base}/api/shop/auth/poll?token=${startData.token}`).then((r) => r.json());
            assert.equal(pollDone.status, "approved");
            const verified = verifyTmaSessionToken(pollDone.sessionToken, TEST_BOT_TOKEN);
            assert.equal(verified.ok, true);
            assert.equal(verified.telegramId, "112233445");

            // 3. Xuất toàn bộ key trên Web qua /api/tma/apikey/my-keys/export
            const exportAll = await fetch(`${base}/api/tma/apikey/my-keys/export?filter=all`, {
                headers: { Authorization: `Bearer ${pollDone.sessionToken}` },
            });
            assert.equal(exportAll.status, 200);
            const expAllBody = await exportAll.json();
            assert.equal(expAllBody.ok, true);
            assert.equal(expAllBody.total, 2);
            assert.deepEqual(
                expAllBody.keys.map((k) => k.key),
                ["sk-proj-fullsecret-active-001", "sk-proj-fullsecret-expired-002"],
            );

            // Lọc active chỉ xuất key còn hạn
            const exportActive = await fetch(`${base}/api/tma/apikey/my-keys/export?filter=active`, {
                headers: { Authorization: `Bearer ${pollDone.sessionToken}` },
            }).then((r) => r.json());
            assert.equal(exportActive.total, 1);
            assert.equal(exportActive.keys[0].key, "sk-proj-fullsecret-active-001");

            // 4. Đăng nhập trực tiếp bằng API key cá nhân sk_u_v2_...
            const userKey = getUserApiKey("112233445");
            const apiKeyLogin = await fetch(`${base}/api/shop/auth/apikey`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ apiKey: userKey }),
            });
            assert.equal(apiKeyLogin.status, 200);
            const apiKeyData = await apiKeyLogin.json();
            assert.equal(verifyTmaSessionToken(apiKeyData.sessionToken, TEST_BOT_TOKEN).telegramId, "112233445");

            // Đăng nhập bằng seller key
            const sellerLogin = await fetch(`${base}/api/shop/auth/apikey`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ apiKey: "sk_seller_custom_123456" }),
            });
            assert.equal(sellerLogin.status, 200);

            // Key giả mạo -> 401
            const badLogin = await fetch(`${base}/api/shop/auth/apikey`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ apiKey: `${userKey.slice(0, -1)}0` }),
            });
            assert.equal(badLogin.status, 401);

            // Tài khoản bị banned -> 403
            const bannedKey = getUserApiKey("999000111");
            const bannedLogin = await fetch(`${base}/api/shop/auth/apikey`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ apiKey: bannedKey }),
            });
            assert.equal(bannedLogin.status, 403);
        });
    } finally {
        prisma.setting.findUnique = prevSettingUnique;
        prisma.setting.findMany = prevSettingMany;
        prisma.issuedApiKey.findMany = prevKeyFindMany;
    }
});
