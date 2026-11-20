import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import express from "express";
import prisma from "../src/lib/prisma.js";
import sellerApiRouter, {
    adminRouter as sellerAdminRouter,
    SELLER_SCOPES,
    resolveSellerRoleAndScopes,
    hasSellerScope,
} from "../src/seller-api.js";
import { resolveDeveloperApiPayload } from "../src/developer-api.js";
import { invalidateGpt2apiConfig } from "../src/gpt2api.js";

const TEST_USER_SECRET = "test-user-api-secret-for-seller-rbac-check";

function makeHmacKey(tid, secret = TEST_USER_SECRET) {
    const sig = createHmac("sha256", secret).update(`user-api:v2:${tid}`).digest("hex");
    return `sk_u_v2_${tid}_${sig}`;
}

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

test("resolveSellerRoleAndScopes phân biệt RESELLER (sk_u_v2) và SUPPLIER (sk_ admin)", () => {
    const hmacKey = makeHmacKey("888777666");
    const autoReseller = resolveSellerRoleAndScopes({ key: hmacKey });
    assert.equal(autoReseller.role, "RESELLER");
    assert.deepEqual(autoReseller.scopes, ["keys"]);
    assert.equal(hasSellerScope({ key: hmacKey }, SELLER_SCOPES.KEYS), true);
    assert.equal(hasSellerScope({ key: hmacKey }, SELLER_SCOPES.STOCK), false);
    assert.equal(hasSellerScope({ key: hmacKey }, SELLER_SCOPES.ORDERS), false);
    assert.equal(hasSellerScope({ key: hmacKey }, SELLER_SCOPES.SHOP_STATS), false);

    const legacySupplier = resolveSellerRoleAndScopes({ key: "sk_0123456789abcdef0123456789abcdef0123456789abcdef" });
    assert.equal(legacySupplier.role, "SUPPLIER");
    assert.equal(hasSellerScope(legacySupplier, SELLER_SCOPES.STOCK), true);
    assert.equal(hasSellerScope(legacySupplier, SELLER_SCOPES.ORDERS), true);
    assert.equal(hasSellerScope(legacySupplier, SELLER_SCOPES.SHOP_STATS), true);
});

test("Phương án A RBAC: RESELLER bị chặn 403 trên route shop (/stock, /orders, /stats), nhưng dùng được /me, /keys, /stats/keys, /quote", async () => {
    const prevSecret = process.env.USER_API_SECRET;
    process.env.USER_API_SECRET = TEST_USER_SECRET;

    const resellerKey = makeHmacKey("111222333");
    const supplierKey = "sk_supplier_manual_admin_key_1234567890abcdef";
    const storedKeys = [
        {
            id: "sel_reseller_1",
            name: "Reseller Test",
            telegramId: "111222333",
            key: resellerKey,
            active: true,
            role: "RESELLER",
            scopes: ["keys"],
            maxKeysPerDay: 20,
            maxTokensPerDay: 0,
        },
        {
            id: "sel_supplier_1",
            name: "Supplier Alpha",
            telegramId: null,
            key: supplierKey,
            active: true,
            role: "SUPPLIER",
            scopes: ["keys", "stock", "orders", "shop_stats"],
        },
    ];

    const orig = {
        settingFind: prisma.setting.findUnique,
        settingFindMany: prisma.setting.findMany,
        settingUpsert: prisma.setting.upsert,
        userFind: prisma.user.findUnique,
        walletFind: prisma.wallet.findUnique,
        orderFindMany: prisma.order.findMany,
        orderFindUnique: prisma.order.findUnique,
        orderCount: prisma.order.count,
        productCount: prisma.product.count,
        keyFindMany: prisma.issuedApiKey.findMany,
        keyCount: prisma.issuedApiKey.count,
        keyFindFirst: prisma.issuedApiKey.findFirst,
        auditCreate: prisma.auditLog.create,
    };

    const mockProfilesJson = JSON.stringify([{
        profileId: 1,
        profileName: "Server 1",
        enabled: true,
        shopEnabled: true,
        base: "https://provider.invalid",
        adminToken: "tok",
        userId: "1",
        usdPerMtoken: 0.02,
        rpm: 100,
        validDays: 30,
        maxBuyTokens: 1_000_000_000_000,
    }]);

    invalidateGpt2apiConfig();
    prisma.setting.findUnique = async ({ where }) => {
        if (where?.key === "seller_api_keys") return { key: "seller_api_keys", value: JSON.stringify(storedKeys) };
        return null;
    };
    prisma.setting.findMany = async () => [
        { key: "GPT2API_ENABLED", value: "true" },
        { key: "GPT2API_PROFILES", value: mockProfilesJson },
        { key: "GPT2API_BASE", value: "https://provider.invalid" },
        { key: "GPT2API_ADMIN_TOKEN", value: "tok" },
        { key: "GPT2API_USER_ID", value: "1" },
        { key: "GPT2API_USD_PER_MTOKEN", value: "0.02" },
    ];
    prisma.setting.upsert = async ({ update }) => {
        if (update?.value) {
            const parsed = JSON.parse(update.value);
            storedKeys.splice(0, storedKeys.length, ...parsed);
        }
        return null;
    };
    prisma.user.findUnique = async () => ({ id: "u1", telegramId: "111222333", firstName: "Reseller", vipLevel: 0 });
    prisma.wallet.findUnique = async () => ({ balance: 200_000 });
    prisma.order.findMany = async () => [];
    prisma.order.count = async () => 5;
    prisma.product.count = async () => 2;
    prisma.issuedApiKey.findMany = async ({ where }) => {
        assert.ok(["sel_reseller_1", "sel_supplier_1"].includes(where.sellerKeyId));
        return [];
    };
    prisma.issuedApiKey.count = async ({ where }) => {
        assert.ok(["sel_reseller_1", "sel_supplier_1"].includes(where.sellerKeyId));
        return 0;
    };
    prisma.issuedApiKey.findFirst = async ({ where }) => {
        if (where?.id === "other_seller_key") return null;
        return null;
    };
    prisma.auditLog.create = async () => null;

    try {
        const app = express();
        app.use("/api/seller", express.json(), sellerApiRouter);
        app.use("/api/admin-seller", express.json(), sellerAdminRouter);

        await withServer(app, async (base) => {
            const rHeaders = { Authorization: `Bearer ${resellerKey}`, "Content-Type": "application/json" };
            const sHeaders = { Authorization: `Bearer ${supplierKey}`, "Content-Type": "application/json" };

            // 1. RESELLER vào được /me và thấy role + scopes
            const meRes = await fetch(`${base}/api/seller/me`, { headers: rHeaders });
            assert.equal(meRes.status, 200);
            const me = await meRes.json();
            assert.equal(me.role, "RESELLER");
            assert.deepEqual(me.scopes, ["keys"]);

            // 2. RESELLER bị chặn 403 INSUFFICIENT_SCOPE trên mọi endpoint toàn shop
            for (const [method, endpoint, body] of [
                ["POST", "/api/seller/stock", { productId: "p1", lines: ["a:b"] }],
                ["POST", "/api/seller/stock/text", { productId: "p1", text: "a:b" }],
                ["GET", "/api/seller/orders"],
                ["GET", "/api/seller/orders/ord_1"],
                ["GET", "/api/seller/stats"],
                ["GET", "/api/seller/stats/users/daily"],
            ]) {
                const resp = await fetch(`${base}${endpoint}`, {
                    method,
                    headers: rHeaders,
                    body: body ? JSON.stringify(body) : undefined,
                });
                assert.equal(resp.status, 403, `${method} ${endpoint} phải chặn 403 cho RESELLER`);
                const errBody = await resp.json();
                assert.equal(errBody.code, "INSUFFICIENT_SCOPE");
            }

            // 3. RESELLER dùng được /keys, /stats/keys và /quote của chính mình
            const keysRes = await fetch(`${base}/api/seller/keys?live=0`, { headers: rHeaders });
            assert.equal(keysRes.status, 200);

            const statsKeysRes = await fetch(`${base}/api/seller/stats/keys`, { headers: rHeaders });
            assert.equal(statsKeysRes.status, 200);

            const quoteRes = await fetch(`${base}/api/seller/quote`, {
                method: "POST",
                headers: rHeaders,
                body: JSON.stringify({ profileId: 1, tokens: "100m", rpm: 100, validDays: 30 }),
            });
            assert.equal(quoteRes.status, 200);
            const qData = await quoteRes.json();
            assert.equal(qData.ok, true);
            assert.equal(qData.mode, "create");
            assert.ok(qData.priceUsd > 0 && qData.priceVnd > 0);

            // Quote gia hạn key của seller khác -> phải 404
            const otherQuoteRes = await fetch(`${base}/api/seller/quote`, {
                method: "POST",
                headers: rHeaders,
                body: JSON.stringify({ keyId: "other_seller_key", addTokens: 10_000_000 }),
            });
            assert.equal(otherQuoteRes.status, 404);

            // 4. SUPPLIER vẫn vào được /orders và /stats
            const supOrders = await fetch(`${base}/api/seller/orders`, { headers: sHeaders });
            assert.equal(supOrders.status, 200);
            const supStats = await fetch(`${base}/api/seller/stats`, { headers: sHeaders });
            assert.equal(supStats.status, 200);

            // 5. Admin có thể đổi role từ RESELLER -> SUPPLIER qua PUT /keys/:id
            const upd = await fetch(`${base}/api/admin-seller/keys/sel_reseller_1`, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ role: "SUPPLIER" }),
            });
            assert.equal(upd.status, 200);
            const updJson = await upd.json();
            assert.equal(updJson.key.role, "SUPPLIER");

            const supAfterPromote = await fetch(`${base}/api/seller/orders`, { headers: rHeaders });
            assert.equal(supAfterPromote.status, 200);
        });
    } finally {
        if (prevSecret === undefined) delete process.env.USER_API_SECRET;
        else process.env.USER_API_SECRET = prevSecret;
        prisma.setting.findUnique = orig.settingFind;
        prisma.setting.findMany = orig.settingFindMany;
        prisma.setting.upsert = orig.settingUpsert;
        invalidateGpt2apiConfig();
        prisma.user.findUnique = orig.userFind;
        prisma.wallet.findUnique = orig.walletFind;
        prisma.order.findMany = orig.orderFindMany;
        prisma.order.count = orig.orderCount;
        prisma.product.count = orig.productCount;
        prisma.issuedApiKey.findMany = orig.keyFindMany;
        prisma.issuedApiKey.count = orig.keyCount;
        prisma.issuedApiKey.findFirst = orig.keyFindFirst;
        prisma.auditLog.create = orig.auditCreate;
    }
});

test("resolveDeveloperApiPayload trả kèm role & scopes và UI Quản lý Seller có mặt trong Mini App build", async () => {
    const hmacKey = makeHmacKey("444555666");
    const dev = await resolveDeveloperApiPayload({
        user: { telegramId: "444555666", firstName: "Seller" },
        requestOrigin: "https://viesop.hcjx125.workers.dev",
        deps: {
            getOrCreateSellerKeyFn: async () => ({ id: "k1", key: hmacKey, active: true, role: "RESELLER", scopes: ["keys"] }),
            getUserApiKeyFn: () => hmacKey,
            resolvePublicBaseUrlFn: () => "https://viesop.hcjx125.workers.dev",
            getBalanceFn: async () => 100_000,
            sellerUsageSinceFn: async () => ({ keys: 0, tokens: 0 }),
        },
    });
    assert.equal(dev.role, "RESELLER");
    assert.deepEqual(dev.scopes, ["keys"]);

    const distHtml = readFileSync(new URL("../miniapp/dist/index.html", import.meta.url), "utf8");
    const jsMatch = /src="\/app\/(assets\/[^"]+)"/.exec(distHtml);
    assert.ok(jsMatch);
    const bundle = readFileSync(path.join(process.cwd(), "miniapp", "dist", jsMatch[1]), "utf8");
    assert.match(bundle, /Quản lý Seller/);
    assert.match(bundle, /\/api\/seller/);
});
