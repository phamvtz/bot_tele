import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import express from "express";
import prisma from "../src/lib/prisma.js";
import { createTmaApiRouter } from "../src/tma-api.js";
import {
    resolveDeveloperApiPayload,
    SELLER_API_ENDPOINTS,
    USER_API_ENDPOINTS,
} from "../src/developer-api.js";

prisma.setting.findUnique = async () => null;
prisma.setting.findMany = async () => [];

const TEST_BOT_TOKEN = "1234567890:AAH_test_bot_token_for_developer_api_unit";

function buildSignedInitData({ user = { id: 777123456, first_name: "Dev", username: "devshop" } } = {}) {
    const params = new URLSearchParams();
    params.set("auth_date", String(Math.floor(Date.now() / 1000)));
    params.set("query_id", "AAHdF6IQAAAAAN0XohDevApi01");
    params.set("user", JSON.stringify(user));
    const pairs = [...params.entries()].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
    const checkStr = pairs.map(([k, v]) => `${k}=${v}`).join("\n");
    const secretKey = createHmac("sha256", "WebAppData").update(TEST_BOT_TOKEN).digest();
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

test("resolveDeveloperApiPayload xử lý key HMAC dùng chung và key Seller tách biệt", async () => {
    const user = { telegramId: "777123456", firstName: "An", username: "an_dev" };
    const hmacKey = `sk_u_v2_777123456_${"a".repeat(64)}`;

    const shared = await resolveDeveloperApiPayload({
        user,
        requestOrigin: "https://fallback.example.com",
        deps: {
            getOrCreateSellerKeyFn: async () => ({
                id: "sel_1",
                name: "An (@an_dev)",
                key: hmacKey,
                active: true,
                maxKeysPerDay: 50,
                maxTokensPerDay: 0,
            }),
            getUserApiKeyFn: () => hmacKey,
            resolvePublicBaseUrlFn: () => "https://viesop.hcjx125.workers.dev",
            getBalanceFn: async () => 250_000,
            sellerUsageSinceFn: async () => ({ keys: 3, tokens: 3_000_000 }),
        },
    });

    assert.equal(shared.ok, true);
    assert.equal(shared.apiKey, hmacKey);
    assert.equal(shared.hasDistinctUserKey, false);
    assert.equal(shared.supportsUserApi, true);
    assert.equal(shared.sellerBase, "https://viesop.hcjx125.workers.dev/api/seller");
    assert.equal(shared.userBase, "https://viesop.hcjx125.workers.dev/api/user");
    assert.equal(shared.balanceVnd, 250_000);
    assert.deepEqual(shared.limits, { maxKeysPerDay: 50, maxTokensPerDay: 0 });
    assert.deepEqual(shared.usageToday, { keys: 3, tokens: 3_000_000 });
    assert.match(shared.curls.createKey, /"tokens": 1000000/);
    assert.equal(shared.sellerEndpoints, SELLER_API_ENDPOINTS);
    assert.equal(shared.userEndpoints, USER_API_ENDPOINTS);

    const distinct = await resolveDeveloperApiPayload({
        user,
        requestOrigin: "https://req-origin.example.com",
        deps: {
            getOrCreateSellerKeyFn: async () => ({
                id: "sel_2",
                name: "Custom Seller",
                key: "sk_custom_seller_secret_key_123456",
                active: true,
            }),
            getUserApiKeyFn: () => hmacKey,
            resolvePublicBaseUrlFn: () => "",
            getBalanceFn: async () => 10_000,
            sellerUsageSinceFn: async () => ({ keys: 0, tokens: 0 }),
        },
    });

    assert.equal(distinct.hasDistinctUserKey, true);
    assert.equal(distinct.apiKey, "sk_custom_seller_secret_key_123456");
    assert.equal(distinct.personalUserKey, hmacKey);
    assert.equal(distinct.sellerBase, "https://req-origin.example.com/api/seller");
});

test("GET /api/tma/developer-api yêu cầu xác thực và trả đủ thông tin cho Mini App", async () => {
    const hmacKey = `sk_u_v2_777123456_${"b".repeat(64)}`;
    const app = express();
    app.use(
        "/api/tma",
        express.json(),
        createTmaApiRouter({
            prisma,
            getBotToken: () => TEST_BOT_TOKEN,
            getOrCreateUser: async () => ({
                id: "u_dev",
                telegramId: "777123456",
                firstName: "Dev",
                username: "devshop",
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
            getOrCreateSellerKeyFn: async () => ({
                id: "sel_dev",
                key: hmacKey,
                active: true,
            }),
            getUserApiKeyFn: () => hmacKey,
            resolvePublicBaseUrlFn: () => "https://viesop.hcjx125.workers.dev",
            getBalanceFn: async () => 500_000,
            sellerUsageSinceFn: async () => ({ keys: 1, tokens: 1_000_000 }),
        }),
    );

    await withServer(app, async (base) => {
        const guestRes = await fetch(`${base}/api/tma/developer-api`);
        assert.equal(guestRes.status, 401);

        const initData = buildSignedInitData();
        const authedRes = await fetch(`${base}/api/tma/developer-api`, {
            headers: { Authorization: `tma ${initData}` },
        });
        assert.equal(authedRes.status, 200);
        const body = await authedRes.json();
        assert.equal(body.ok, true);
        assert.equal(body.apiKey, hmacKey);
        assert.equal(body.sellerBase, "https://viesop.hcjx125.workers.dev/api/seller");
        assert.equal(body.userBase, "https://viesop.hcjx125.workers.dev/api/user");
        assert.ok(Array.isArray(body.sellerEndpoints) && body.sellerEndpoints.length >= 9);
        assert.ok(Array.isArray(body.userEndpoints) && body.userEndpoints.length >= 3);
    });
});

test("Mini App và build miniapp/dist chứa đầy đủ phần API Kết nối", () => {
    const apiKeysPage = readFileSync(new URL("../miniapp/src/pages/ApiKeysPage.jsx", import.meta.url), "utf8");
    const devPanel = readFileSync(new URL("../miniapp/src/components/DeveloperApiPanel.jsx", import.meta.url), "utf8");
    const appJsx = readFileSync(new URL("../miniapp/src/App.jsx", import.meta.url), "utf8");
    const distHtml = readFileSync(new URL("../miniapp/dist/index.html", import.meta.url), "utf8");

    assert.match(apiKeysPage, /DeveloperApiPanel/);
    assert.match(apiKeysPage, /id:\s*"api"/);
    assert.match(devPanel, /\/developer-api/);
    assert.match(devPanel, /\/api\/seller\/me/);
    assert.match(appJsx, /sp === "api"/);

    // Đảm bảo file asset trong miniapp/dist/index.html tồn tại sau Vite build
    const jsMatch = /src="\/app\/(assets\/[^"]+)"/.exec(distHtml);
    const cssMatch = /href="\/app\/(assets\/[^"]+)"/.exec(distHtml);
    assert.ok(jsMatch, "miniapp/dist/index.html thiếu bundle JS");
    assert.ok(cssMatch, "miniapp/dist/index.html thiếu bundle CSS");

    const jsBundlePath = path.join(process.cwd(), "miniapp", "dist", jsMatch[1]);
    const cssBundlePath = path.join(process.cwd(), "miniapp", "dist", cssMatch[1]);
    assert.equal(existsSync(jsBundlePath), true);
    assert.equal(existsSync(cssBundlePath), true);
    assert.match(readFileSync(jsBundlePath, "utf8"), /\/developer-api/);
});
