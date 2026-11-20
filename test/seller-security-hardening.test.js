import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import express from "express";
import prisma from "../src/lib/prisma.js";
import sellerApiRouter, {
    vndAmountForUsd,
    _resetSellerRateLimitersForTests,
} from "../src/seller-api.js";
import { invalidateGpt2apiConfig } from "../src/gpt2api.js";
import { invalidateWalletCache } from "../src/wallet.js";
import { createWebLoginStore, createWebAuthRouter } from "../src/web-login.js";
import { readFileSync } from "node:fs";

function makeHmacKey(telegramId, secret) {
    const mac = createHmac("sha256", secret).update(`user-api:v2:${telegramId}`).digest("hex");
    return `sk_u_v2_${telegramId}_${mac}`;
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

function matchSimple(where = {}, row) {
    return Object.entries(where).every(([key, cond]) => {
        const actual = row[key];
        if (cond === null) return actual === null || actual === undefined;
        if (cond && typeof cond === "object" && !(cond instanceof Date)) {
            if ("in" in cond) return cond.in.includes(actual);
            if ("gte" in cond && !(actual != null && actual >= cond.gte)) return false;
            if ("lt" in cond && !(actual != null && actual < cond.lt)) return false;
            return true;
        }
        const c = cond instanceof Date ? +cond : cond;
        const a = actual instanceof Date ? +actual : actual;
        return a === c;
    });
}

test("vndAmountForUsd: không bao giờ làm tròn số USD dương thành 0đ", () => {
    assert.equal(vndAmountForUsd(0.00001, 25_000), 1);
    assert.equal(vndAmountForUsd(0.01, 25_500), 255);
    assert.equal(vndAmountForUsd(0, 25_500), 0);
    assert.equal(vndAmountForUsd(-1, 25_500), 0);
});

test("user-api.js userAuth kiểm tra isBanned để chặn tài khoản bị khóa", () => {
    const src = readFileSync(new URL("../src/user-api.js", import.meta.url), "utf8");
    assert.match(src, /isBanned:\s*true/, "userAuth phải select isBanned từ DB");
    assert.match(src, /found\.isBanned\s*===\s*true/, "userAuth phải chặn 403 nếu isBanned === true");
});

test("Toàn diện bảo mật Seller API: ban, giới hạn ngày/xoá ẩn, race limit, giftcode spoofing, disabled server, hidden key, ambiguous renew, rate limit", async () => {
    const prevSecret = process.env.USER_API_SECRET;
    process.env.USER_API_SECRET = "seller-hardening-secret-key-001";
    _resetSellerRateLimitersForTests();

    const resellerTg = "700100001";
    const bannedTg = "700100002";
    const victimTg = "700100003";
    const resellerKey = makeHmacKey(resellerTg, process.env.USER_API_SECRET);
    const bannedHmacKey = makeHmacKey(bannedTg, process.env.USER_API_SECRET);
    const disabledSellerKey = "sk_disabled_seller_key_999";
    const bannedSupplierKey = "sk_banned_supplier_key_888";
    const supplierKey = "sk_supplier_hardening_777";

    const storedSellerKeys = [
        {
            id: "sel_reseller_limit",
            name: "Limited Reseller",
            telegramId: resellerTg,
            key: resellerKey,
            active: true,
            role: "RESELLER",
            scopes: ["keys"],
            maxKeysPerDay: 2,
            maxTokensPerDay: 30_000_000,
        },
        {
            id: "sel_banned_supplier",
            name: "Banned Supplier",
            telegramId: bannedTg,
            key: bannedSupplierKey,
            active: true,
            role: "SUPPLIER",
            scopes: ["keys", "stock", "orders", "shop_stats"],
        },
        {
            id: "sel_disabled_key",
            name: "Disabled Seller",
            telegramId: resellerTg,
            key: disabledSellerKey,
            active: false,
            role: "RESELLER",
            scopes: ["keys"],
        },
        {
            id: "sel_active_supplier",
            name: "Active Supplier",
            telegramId: null,
            key: supplierKey,
            active: true,
            role: "SUPPLIER",
            scopes: ["keys", "stock", "orders", "shop_stats"],
            maxKeysPerDay: 0,
            maxTokensPerDay: 0,
        },
    ];

    const users = new Map([
        [resellerTg, { id: "u_res", telegramId: resellerTg, firstName: "Reseller", username: "res1", isBanned: false, vipLevel: 0 }],
        [bannedTg, { id: "u_ban", telegramId: bannedTg, firstName: "Banned", username: "ban1", isBanned: true, vipLevel: 0 }],
        [victimTg, { id: "u_vic", telegramId: victimTg, firstName: "Victim", username: "vic1", isBanned: false, vipLevel: 0 }],
    ]);

    const wallets = new Map([
        [resellerTg, { id: "w_res", odelegramId: resellerTg, balance: 500_000 }],
    ]);
    const walletTxs = [];
    const orders = [];
    const issuedKeys = [];
    const giftRedemptions = [];
    const giftCodes = new Map([
        ["FREE2026", {
            id: "gc_free",
            code: "FREE2026",
            isActive: true,
            expiresAt: null,
            maxUses: 100,
            usedCount: 0,
            perUserLimit: 1,
            vipOnly: 0,
            rewardType: "WALLET",
            amount: 10_000,
        }],
    ]);
    let seq = 0;
    let providerCreateCount = 0;
    let providerRenewMode = "ok"; // "ok" | "ambiguous_quota" | "unlimited_fail"
    const providerKeys = new Map();

    const { createServer } = await import("node:http");
    const providerServer = createServer((req, res) => {
        let rawBody = "";
        req.on("data", (c) => { rawBody += c; });
        req.on("end", () => {
            const sendJson = (status, payload) => {
                res.writeHead(status, { "Content-Type": "application/json" });
                res.end(JSON.stringify(payload));
            };
            const urlPath = String(req.url || "").split("?")[0];
            if (req.method === "GET" && urlPath === "/model-groups") {
                return sendJson(200, { code: 0, data: { list: [{ id: 1, name: "Default" }] } });
            }
            if (req.method === "POST" && urlPath === "/keys") {
                providerCreateCount += 1;
                const body = JSON.parse(rawBody || "{}");
                const extId = `ext-${providerCreateCount}`;
                const keyVal = `sk-provider-created-${providerCreateCount}`;
                providerKeys.set(extId, {
                    id: extId,
                    public_id: extId,
                    key: keyVal,
                    quota_limit: body.quota_limit ?? 500_000,
                    quota_used: 0,
                    expires_at: new Date(Date.now() + 30 * 86_400_000).toISOString(),
                    enabled: true,
                    rpm: body.rpm || 100,
                });
                return sendJson(200, { code: 0, data: providerKeys.get(extId) });
            }
            const getMatch = /^\/keys\/([^/?]+)$/.exec(urlPath);
            if (req.method === "GET" && getMatch) {
                const extId = decodeURIComponent(getMatch[1]);
                const row = providerKeys.get(extId);
                if (!row) return sendJson(404, { code: 40400, message: "Key not found" });
                return sendJson(200, { code: 0, data: row });
            }
            if (req.method === "PATCH" && getMatch) {
                const extId = decodeURIComponent(getMatch[1]);
                const row = providerKeys.get(extId);
                if (!row) return sendJson(404, { code: 40400, message: "Key not found" });
                const patch = JSON.parse(rawBody || "{}");
                if (patch.enabled !== undefined) {
                    row.enabled = patch.enabled;
                    return sendJson(200, { code: 0, data: row });
                }
                if (providerRenewMode === "ambiguous_quota") {
                    // Simulate provider silently ignoring quota_limit (post-PATCH mismatch!)
                    return sendJson(200, { code: 0, data: row });
                }
                if (patch.quota_limit !== undefined) row.quota_limit = patch.quota_limit;
                if (patch.expires_at !== undefined) row.expires_at = patch.expires_at;
                return sendJson(200, { code: 0, data: row });
            }
            return sendJson(200, { code: 0, data: { list: [...providerKeys.values()], total: providerKeys.size } });
        });
    });
    await new Promise((resolve) => providerServer.listen(0, "127.0.0.1", resolve));
    const providerBase = `http://127.0.0.1:${providerServer.address().port}`;

    const profilesJson = JSON.stringify([
        {
            profileId: 1,
            profileName: "Active Server",
            enabled: true,
            shopEnabled: true,
            base: providerBase,
            adminToken: "tok",
            userId: "1",
            usdPerMtoken: 0.02,
            rpm: 100,
            validDays: 30,
            maxBuyTokens: 1_000_000_000_000,
            fallbackGroups: [1],
        },
        {
            profileId: 2,
            profileName: "Disabled Server",
            enabled: false,
            shopEnabled: true,
            base: providerBase,
            adminToken: "tok",
            userId: "1",
            usdPerMtoken: 0.02,
            rpm: 100,
            validDays: 30,
            maxBuyTokens: 1_000_000_000_000,
            fallbackGroups: [1],
        },
    ]);

    const orig = {
        settingFindUnique: prisma.setting.findUnique,
        settingFindMany: prisma.setting.findMany,
        settingUpsert: prisma.setting.upsert,
        userFindUnique: prisma.user.findUnique,
        walletFindUnique: prisma.wallet.findUnique,
        walletCreate: prisma.wallet.create,
        walletUpdate: prisma.wallet.update,
        walletUpdateMany: prisma.wallet.updateMany,
        txFindFirst: prisma.walletTransaction.findFirst,
        txCreate: prisma.walletTransaction.create,
        txUpdate: prisma.walletTransaction.update,
        productFindUnique: prisma.product.findUnique,
        productCreate: prisma.product.create,
        orderCreate: prisma.order.create,
        orderUpdate: prisma.order.update,
        keyCreate: prisma.issuedApiKey.create,
        keyFindFirst: prisma.issuedApiKey.findFirst,
        keyFindMany: prisma.issuedApiKey.findMany,
        keyCount: prisma.issuedApiKey.count,
        keyUpdate: prisma.issuedApiKey.update,
        keyUpdateMany: prisma.issuedApiKey.updateMany,
        keyDelete: prisma.issuedApiKey.delete,
        giftFindUnique: prisma.giftCode.findUnique,
        giftUpdateMany: prisma.giftCode.updateMany,
        giftUpdate: prisma.giftCode.update,
        redemptionCount: prisma.giftCodeRedemption.count,
        redemptionCreate: prisma.giftCodeRedemption.create,
        redemptionUpdate: prisma.giftCodeRedemption.update,
        redemptionDelete: prisma.giftCodeRedemption.delete,
        auditCreate: prisma.auditLog.create,
    };

    try {
        invalidateWalletCache(resellerTg);
        invalidateWalletCache(bannedTg);
        invalidateGpt2apiConfig();

        prisma.setting.findUnique = async ({ where }) => {
            if (where?.key === "seller_api_keys") {
                return { key: "seller_api_keys", value: JSON.stringify(storedSellerKeys) };
            }
            return null;
        };
        prisma.setting.findMany = async () => [
            { key: "GPT2API_ENABLED", value: "true" },
            { key: "GPT2API_PROFILES", value: profilesJson },
            { key: "GPT2API_BASE", value: providerBase },
            { key: "GPT2API_ADMIN_TOKEN", value: "tok" },
            { key: "GPT2API_USER_ID", value: "1" },
            { key: "GPT2API_USD_PER_MTOKEN", value: "0.02" },
            { key: "GPT2API_FALLBACK_GROUPS", value: "[1]" },
        ];
        prisma.setting.upsert = async ({ where, update }) => {
            if (where?.key === "seller_api_keys" && update?.value) {
                const parsed = JSON.parse(update.value);
                storedSellerKeys.splice(0, storedSellerKeys.length, ...parsed);
            }
            return null;
        };
        prisma.user.findUnique = async ({ where }) => users.get(String(where.telegramId)) || null;
        prisma.wallet.findUnique = async ({ where }) => {
            if (where?.odelegramId) return wallets.get(String(where.odelegramId)) || null;
            if (where?.id) return [...wallets.values()].find((w) => w.id === where.id) || null;
            return null;
        };
        prisma.wallet.create = async ({ data }) => {
            const w = { id: `w_${++seq}`, balance: 0, ...data };
            wallets.set(String(w.odelegramId), w);
            return { ...w };
        };
        prisma.wallet.update = async ({ where, data }) => {
            const w = [...wallets.values()].find((x) => x.id === where.id);
            if (!w) return null;
            if (data.balance?.increment) w.balance += data.balance.increment;
            return { ...w };
        };
        prisma.wallet.updateMany = async ({ where, data }) => {
            const w = [...wallets.values()].find((x) => x.id === where.id);
            if (!w) return { count: 0 };
            if (where.balance?.gte !== undefined && w.balance < where.balance.gte) return { count: 0 };
            if (data.balance?.increment) w.balance += data.balance.increment;
            return { count: 1 };
        };
        prisma.walletTransaction.findFirst = async ({ where }) => walletTxs.find((t) => matchSimple(where, t)) || null;
        prisma.walletTransaction.create = async ({ data }) => {
            const tx = { id: `tx_${++seq}`, createdAt: new Date(), ...data };
            walletTxs.push(tx);
            return { ...tx };
        };
        prisma.walletTransaction.update = async ({ where, data }) => {
            const tx = walletTxs.find((t) => t.id === where.id);
            if (tx) Object.assign(tx, data);
            return tx || null;
        };
        prisma.product.findUnique = async () => ({ id: "prod_apikey", code: "__API_KEY__", name: "API Key" });
        prisma.product.create = async ({ data }) => ({ id: "prod_apikey", ...data });
        prisma.order.create = async ({ data }) => {
            const o = { id: `ord_${++seq}`, createdAt: new Date(), ...data };
            orders.push(o);
            return { ...o };
        };
        prisma.order.update = async ({ where, data }) => {
            const o = orders.find((x) => x.id === where.id);
            if (o) Object.assign(o, data);
            return o || null;
        };
        prisma.issuedApiKey.create = async ({ data }) => {
            if (data.clientRef && issuedKeys.some((k) => k.clientRef === data.clientRef)) {
                throw Object.assign(new Error("E11000 duplicate key clientRef"), { code: 11000 });
            }
            const k = { id: `ik_${++seq}`, renewCount: 0, lastRenewAt: null, renewWipAt: null, createdAt: new Date(), ...data };
            issuedKeys.push(k);
            return { ...k };
        };
        prisma.issuedApiKey.findFirst = async ({ where }) => issuedKeys.find((k) => matchSimple(where, k)) || null;
        prisma.issuedApiKey.findMany = async ({ where, select } = {}) => {
            let list = issuedKeys.filter((k) => matchSimple(where, k));
            if (select) list = list.map((r) => Object.fromEntries(Object.keys(select).map((key) => [key, r[key]])));
            return list;
        };
        prisma.issuedApiKey.count = async ({ where }) => issuedKeys.filter((k) => matchSimple(where, k)).length;
        prisma.issuedApiKey.update = async ({ where, data }) => {
            const k = issuedKeys.find((x) => matchSimple(where, x));
            if (!k) return null;
            for (const [f, v] of Object.entries(data)) {
                if (v && typeof v === "object" && !(v instanceof Date) && "increment" in v) {
                    k[f] = (Number(k[f]) || 0) + Number(v.increment);
                } else {
                    k[f] = v;
                }
            }
            return { ...k };
        };
        prisma.issuedApiKey.updateMany = async ({ where, data }) => {
            const hit = issuedKeys.filter((k) => matchSimple(where, k));
            for (const k of hit) Object.assign(k, data);
            return { count: hit.length };
        };
        prisma.issuedApiKey.delete = async ({ where }) => {
            const i = issuedKeys.findIndex((k) => k.id === where.id);
            return i >= 0 ? issuedKeys.splice(i, 1)[0] : null;
        };
        prisma.giftCode.findUnique = async ({ where }) => giftCodes.get(where.code) || null;
        prisma.giftCode.updateMany = async ({ where, data }) => {
            const g = [...giftCodes.values()].find((x) => x.id === where.id);
            if (!g) return { count: 0 };
            if (where.usedCount?.lt !== undefined && g.usedCount >= where.usedCount.lt) return { count: 0 };
            if (data.usedCount?.increment) g.usedCount += data.usedCount.increment;
            return { count: 1 };
        };
        prisma.giftCode.update = async ({ where, data }) => {
            const g = [...giftCodes.values()].find((x) => x.id === where.id);
            if (g && data.usedCount?.increment) g.usedCount += data.usedCount.increment;
            return g || null;
        };
        prisma.giftCodeRedemption.count = async ({ where }) => giftRedemptions.filter((r) => matchSimple(where, r)).length;
        prisma.giftCodeRedemption.create = async ({ data }) => {
            if (giftRedemptions.some((r) => r.redeemKey === data.redeemKey)) {
                throw Object.assign(new Error("E11000 dup redeemKey"), { code: 11000 });
            }
            const r = { id: `gcr_${++seq}`, ...data };
            giftRedemptions.push(r);
            return { ...r };
        };
        prisma.giftCodeRedemption.update = async ({ where, data }) => {
            const r = giftRedemptions.find((x) => x.id === where.id);
            if (r) Object.assign(r, data);
            return r || null;
        };
        prisma.giftCodeRedemption.delete = async ({ where }) => {
            const i = giftRedemptions.findIndex((x) => x.id === where.id);
            return i >= 0 ? giftRedemptions.splice(i, 1)[0] : null;
        };
        prisma.auditLog.create = async () => null;

        const app = express();
        app.use("/api/seller", express.json(), sellerApiRouter);
        app.use("/api/shop/auth", express.json(), createWebAuthRouter({
            store: createWebLoginStore(),
            prisma,
            getBotToken: () => "123456:TEST_BOT_TOKEN",
            getBotUsername: () => "TestBot",
            getSellerKeys: async () => storedSellerKeys,
        }));

        await withServer(app, async (base) => {
            const hRes = { Authorization: `Bearer ${resellerKey}`, "Content-Type": "application/json" };
            const hSup = { Authorization: `Bearer ${supplierKey}`, "Content-Type": "application/json" };

            // 1. Banned user (cả HMAC sk_u_v2 mới & SUPPLIER sk_ có telegramId bị ban) phải bị chặn 403
            const resBanSup = await fetch(`${base}/api/seller/me`, {
                headers: { Authorization: `Bearer ${bannedSupplierKey}` },
            });
            assert.equal(resBanSup.status, 403);
            assert.equal((await resBanSup.json()).code, "ACCOUNT_BANNED");

            const keysBefore = storedSellerKeys.length;
            const resBanHmac = await fetch(`${base}/api/seller/me`, {
                headers: { Authorization: `Bearer ${bannedHmacKey}` },
            });
            assert.equal(resBanHmac.status, 403);
            assert.equal(storedSellerKeys.length, keysBefore, "User bị ban không được auto-tạo seller key");

            // Disabled Seller key bị chặn ở /api/shop/auth/apikey even when valid key
            const loginDisabled = await fetch(`${base}/api/shop/auth/apikey`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ apiKey: disabledSellerKey }),
            });
            assert.equal(loginDisabled.status, 403);

            // 2. Disabled server (profileId=2) & unknown profile (profileId=999) bị chặn TRƯỚC khi đụng ví/Order
            const ordersBeforeDisabled = orders.length;
            const resBadProf = await fetch(`${base}/api/seller/keys`, {
                method: "POST",
                headers: hRes,
                body: JSON.stringify({ profileId: 999, tokens: "10m", validDays: 30 }),
            });
            assert.equal(resBadProf.status, 400);
            assert.equal((await resBadProf.json()).code, "invalid_profile");

            const resDisQuote = await fetch(`${base}/api/seller/quote`, {
                method: "POST",
                headers: hRes,
                body: JSON.stringify({ profileId: 2, tokens: "10m", validDays: 30 }),
            });
            assert.equal(resDisQuote.status, 409);

            const resDisCreate = await fetch(`${base}/api/seller/keys`, {
                method: "POST",
                headers: hRes,
                body: JSON.stringify({ profileId: 2, tokens: "10m", validDays: 30 }),
            });
            assert.equal(resDisCreate.status, 409);
            assert.equal(orders.length, ordersBeforeDisabled, "Profile tắt không được tạo Order");

            // 3. RESELLER không được gán telegramId / notify cho người khác, nhưng SUPPLIER được phép
            const resSpoofCreate = await fetch(`${base}/api/seller/keys`, {
                method: "POST",
                headers: hRes,
                body: JSON.stringify({ profileId: 1, tokens: "10m", telegramId: victimTg, notify: true }),
            });
            assert.equal(resSpoofCreate.status, 403);
            assert.equal((await resSpoofCreate.json()).code, "INSUFFICIENT_SCOPE");

            // SUPPLIER vẫn cấp key cho khách thành công (không phá flow partner)
            const supCreate = await fetch(`${base}/api/seller/keys`, {
                method: "POST",
                headers: hSup,
                body: JSON.stringify({ profileId: 1, tokens: "10m", telegramId: victimTg, clientRef: "sup_1" }),
            });
            assert.equal(supCreate.status, 200);

            // 4. RESELLER không được dùng /giftcode/redeem với telegramId của người khác; bỏ trống dùng đúng sellerTelegramId (chặn double-dip)
            const gcSpoof = await fetch(`${base}/api/seller/giftcode/redeem`, {
                method: "POST",
                headers: hRes,
                body: JSON.stringify({ code: "FREE2026", telegramId: victimTg }),
            });
            assert.equal(gcSpoof.status, 403);

            const gcOk = await fetch(`${base}/api/seller/giftcode/redeem`, {
                method: "POST",
                headers: hRes,
                body: JSON.stringify({ code: "FREE2026" }),
            });
            assert.equal(gcOk.status, 200);

            // Thử đổi lại cùng giftcode bằng chính resellerTg phải báo ALREADY_USED (409)
            const gcDup = await fetch(`${base}/api/seller/giftcode/redeem`, {
                method: "POST",
                headers: hRes,
                body: JSON.stringify({ code: "FREE2026", telegramId: resellerTg }),
            });
            assert.equal(gcDup.status, 409);

            // 5. Tạo key #1 thành công, test DELETE ?revoke=false KHÔNG reset được trần ngày
            const k1Res = await fetch(`${base}/api/seller/keys`, {
                method: "POST",
                headers: hRes,
                body: JSON.stringify({ profileId: 1, tokens: "10m", validDays: 30, clientRef: "res_k1" }),
            });
            assert.equal(k1Res.status, 200);
            const k1Data = await k1Res.json();

            // Ẩn key #1 không revoke -> key vẫn sống nhưng MUST NOT reset maxKeysPerDay/maxTokensPerDay!
            const delHideRes = await fetch(`${base}/api/seller/keys/${k1Data.id}?revoke=false`, {
                method: "DELETE",
                headers: hRes,
            });
            assert.equal(delHideRes.status, 200);

            // Key đã ẩn (hiddenAt) không được phép renew, bật/tắt lại hay báo giá renew
            const hidRenew = await fetch(`${base}/api/seller/keys/${k1Data.id}`, {
                method: "PATCH",
                headers: hRes,
                body: JSON.stringify({ addTokens: 1_000_000 }),
            });
            assert.equal(hidRenew.status, 409);
            assert.equal((await hidRenew.json()).code, "key_hidden");

            const hidToggle = await fetch(`${base}/api/seller/keys/${k1Data.id}/enabled`, {
                method: "PATCH",
                headers: hRes,
                body: JSON.stringify({ enabled: true }),
            });
            assert.equal(hidToggle.status, 409);

            // 6. Race test: maxKeysPerDay = 2, đã dùng 1 (#1 ẩn vẫn tính 1!), gửi 4 request song song -> chỉ 1 cái qua!
            const parallelCreates = await Promise.all([1, 2, 3, 4].map((idx) =>
                fetch(`${base}/api/seller/keys`, {
                    method: "POST",
                    headers: hRes,
                    body: JSON.stringify({ profileId: 1, tokens: "10m", validDays: 30, clientRef: `race_${idx}` }),
                }).then(async (r) => ({ status: r.status, body: await r.json() })),
            ));
            const okRace = parallelCreates.filter((x) => x.status === 200);
            const limitRace = parallelCreates.filter((x) => x.status === 429);
            assert.equal(okRace.length, 1, `Chỉ được phép tạo thêm tối đa 1 key khi đã dùng 1/2 (${JSON.stringify(parallelCreates)})`);
            assert.equal(limitRace.length, 3, "3 request song song còn lại phải bị chặn 429");

            const liveKeyId = okRace[0].body.id;

            // 7. PATCH /keys/:id: validate âm, non-bool /enabled, kiểm tra maxTokensPerDay, và ambiguous renew không tự hoàn tiền
            const negPatch = await fetch(`${base}/api/seller/keys/${liveKeyId}`, {
                method: "PATCH",
                headers: hRes,
                body: JSON.stringify({ addTokens: -5000, addDays: 1 }),
            });
            assert.equal(negPatch.status, 400);

            const badEnable = await fetch(`${base}/api/seller/keys/${liveKeyId}/enabled`, {
                method: "PATCH",
                headers: hRes,
                body: JSON.stringify({}),
            });
            assert.equal(badEnable.status, 400);

            // Hiện đã dùng 10M + 10M = 20M / 30M tokens/ngày -> xin +15M phải bị chặn 429!
            const overTokenRenew = await fetch(`${base}/api/seller/keys/${liveKeyId}`, {
                method: "PATCH",
                headers: hRes,
                body: JSON.stringify({ addTokens: 15_000_000 }),
            });
            assert.equal(overTokenRenew.status, 429);

            // Lỗi mơ hồ sau khi đã gửi PATCH (`quota_not_applied`): giữ tiền chờ đối soát & khoá renewWipAt!
            const balBeforeAmb = wallets.get(resellerTg).balance;
            providerRenewMode = "ambiguous_quota";
            const ambRes = await fetch(`${base}/api/seller/keys/${liveKeyId}`, {
                method: "PATCH",
                headers: hRes,
                body: JSON.stringify({ addTokens: 5_000_000, clientRef: "amb_1" }),
            });
            assert.equal(ambRes.status, 502);
            const ambBody = await ambRes.json();
            assert.equal(ambBody.renewBlocked, true);
            assert.equal(ambBody.refundPendingReconcile, true);
            assert.ok(wallets.get(resellerTg).balance < balBeforeAmb, "Không tự động hoàn tiền khi provider PATCH mơ hồ");

            // Gửi lại khi cờ WIP đang giữ -> trả 409 trước khi đụng ví thêm lần nữa
            const balAfterAmb = wallets.get(resellerTg).balance;
            const wipRetry = await fetch(`${base}/api/seller/keys/${liveKeyId}`, {
                method: "PATCH",
                headers: hRes,
                body: JSON.stringify({ addTokens: 5_000_000, clientRef: "amb_2" }),
            });
            assert.equal(wipRetry.status, 409);
            assert.equal((await wipRetry.json()).code, "renew_in_progress");
            assert.equal(wallets.get(resellerTg).balance, balAfterAmb, "renew_in_progress không được trừ ví lần hai");

            // 8. Rate limit khi spam giftcode sai (>10 lần) -> 429 GIFTCODE_RATE_LIMITED
            let gcLimited = false;
            for (let i = 0; i < 12; i++) {
                const r = await fetch(`${base}/api/seller/giftcode/redeem`, {
                    method: "POST",
                    headers: hSup,
                    body: JSON.stringify({ code: `BADCODE${i}` }),
                });
                if (r.status === 429) {
                    gcLimited = true;
                    assert.equal((await r.json()).code, "GIFTCODE_RATE_LIMITED");
                    break;
                }
            }
            assert.equal(gcLimited, true, "Spam mã giftcode sai phải bị khóa tạm 429");

            // 9. Brute-force Bearer API key sai (>30 lần) -> 429 AUTH_RATE_LIMITED
            let authLimited = false;
            for (let i = 0; i < 35; i++) {
                const r = await fetch(`${base}/api/seller/me`, {
                    headers: { Authorization: `Bearer sk_wrong_guess_${i}` },
                });
                if (r.status === 429) {
                    authLimited = true;
                    assert.equal((await r.json()).code, "AUTH_RATE_LIMITED");
                    break;
                }
            }
            assert.equal(authLimited, true, "Brute-force API key sai phải bị khóa tạm 429");
        });
    } finally {
        _resetSellerRateLimitersForTests();
        providerServer.closeAllConnections?.();
        await new Promise((resolve) => providerServer.close(resolve));
        if (prevSecret === undefined) delete process.env.USER_API_SECRET;
        else process.env.USER_API_SECRET = prevSecret;
        prisma.setting.findUnique = orig.settingFindUnique;
        prisma.setting.findMany = orig.settingFindMany;
        prisma.setting.upsert = orig.settingUpsert;
        invalidateGpt2apiConfig();
        invalidateWalletCache(resellerTg);
        invalidateWalletCache(bannedTg);
        prisma.user.findUnique = orig.userFindUnique;
        prisma.wallet.findUnique = orig.walletFindUnique;
        prisma.wallet.create = orig.walletCreate;
        prisma.wallet.update = orig.walletUpdate;
        prisma.wallet.updateMany = orig.walletUpdateMany;
        prisma.walletTransaction.findFirst = orig.txFindFirst;
        prisma.walletTransaction.create = orig.txCreate;
        prisma.walletTransaction.update = orig.txUpdate;
        prisma.product.findUnique = orig.productFindUnique;
        prisma.product.create = orig.productCreate;
        prisma.order.create = orig.orderCreate;
        prisma.order.update = orig.orderUpdate;
        prisma.issuedApiKey.create = orig.keyCreate;
        prisma.issuedApiKey.findFirst = orig.keyFindFirst;
        prisma.issuedApiKey.findMany = orig.keyFindMany;
        prisma.issuedApiKey.count = orig.keyCount;
        prisma.issuedApiKey.update = orig.keyUpdate;
        prisma.issuedApiKey.updateMany = orig.keyUpdateMany;
        prisma.issuedApiKey.delete = orig.keyDelete;
        prisma.giftCode.findUnique = orig.giftFindUnique;
        prisma.giftCode.updateMany = orig.giftCodeUpdateMany || orig.giftUpdateMany;
        prisma.giftCode.update = orig.giftUpdate;
        prisma.giftCodeRedemption.count = orig.redemptionCount;
        prisma.giftCodeRedemption.create = orig.redemptionCreate;
        prisma.giftCodeRedemption.update = orig.redemptionUpdate;
        prisma.giftCodeRedemption.delete = orig.redemptionDelete;
        prisma.auditLog.create = orig.auditCreate;
    }
});
