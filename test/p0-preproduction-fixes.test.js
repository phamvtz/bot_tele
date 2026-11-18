import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import express from "express";
import { createHmac } from "node:crypto";

import { resolveSafeDeliveryFilePath } from "../src/delivery.js";
import { claimPaymentEvent } from "../src/lib/payment-events.js";
import { processCryptoPayInvoicePaid } from "../src/payment/cryptopay.js";
import { isSecretSettingKey, isMaskedOrEmptySecretValue } from "../src/settings-mask.js";
import { createTmaAuthMiddleware, signTmaSessionToken } from "../src/middleware/tmaAuth.js";
import { validateCouponObject } from "../src/coupon.js";
import { FLASH_COPY } from "../src/flash-sale-text.js";

test("resolveSafeDeliveryFilePath confines FILE delivery to files/ and public/uploads/", () => {
    const okFiles = resolveSafeDeliveryFilePath("files/guide.pdf");
    assert.equal(okFiles, path.resolve(process.cwd(), "files", "guide.pdf"));

    const okUploads = resolveSafeDeliveryFilePath("public/uploads/products/item.zip");
    assert.equal(okUploads, path.resolve(process.cwd(), "public", "uploads", "products", "item.zip"));

    assert.throws(() => resolveSafeDeliveryFilePath(".env"), /must reside inside/);
    assert.throws(() => resolveSafeDeliveryFilePath("../.env"), /must reside inside/);
    assert.throws(() => resolveSafeDeliveryFilePath("src/server.js"), /must reside inside/);
});

test("claimPaymentEvent allows PENDING target with pre-saved paymentRef but blocks other targets", async () => {
    const events = new Map();
    const db = {
        order: {
            async findMany() {
                return [{ id: "ord-pending-1", paymentRef: "CRYPTOPAY:INVOICE:999", status: "PENDING" }];
            },
        },
        walletTransaction: { async findMany() { return []; } },
        paymentEvent: {
            async create({ data }) {
                const row = { id: "evt-1", ...data };
                events.set(data.eventKey, row);
                return row;
            },
        },
    };

    const selfClaim = await claimPaymentEvent(
        "CRYPTOPAY:INVOICE:999",
        { kind: "CRYPTOPAY_ORDER", targetId: "ord-pending-1" },
        db,
    );
    assert.equal(selfClaim.claimed, true);

    const otherTargetClaim = await claimPaymentEvent(
        "CRYPTOPAY:INVOICE:999",
        { kind: "CRYPTOPAY_ORDER", targetId: "ord-other-2" },
        db,
    );
    assert.equal(otherTargetClaim.claimed, false);
    assert.equal(otherTargetClaim.conflict, true);
});

test("processCryptoPayInvoicePaid refuses to resurrect CANCELED order", async () => {
    let delivered = 0;
    const mockDb = {
        order: {
            async findUnique() {
                return {
                    id: "ord-canceled-1",
                    odelegramId: "100",
                    status: "CANCELED",
                    cryptoToken: "USDT",
                    cryptoAmount: 5,
                };
            },
        },
    };

    const res = await processCryptoPayInvoicePaid({
        invoice: {
            invoice_id: 777888,
            status: "paid",
            amount: "5.0",
            asset: "USDT",
            payload: "order:ord-canceled-1",
        },
        prisma: mockDb,
        deliverOrderFn: async () => { delivered += 1; },
    });

    assert.equal(res.success, false);
    assert.equal(delivered, 0);
});

test("settings-mask protects BINANCE_API_KEY and blocks empty/masked secret overwrites", () => {
    assert.equal(isSecretSettingKey("BINANCE_API_KEY"), true);
    assert.equal(isSecretSettingKey("CUSTOM_PROVIDER_API_KEY"), true);
    assert.equal(isMaskedOrEmptySecretValue(""), true);
    assert.equal(isMaskedOrEmptySecretValue("   "), true);
    assert.equal(isMaskedOrEmptySecretValue("***abcd"), true);
    assert.equal(isMaskedOrEmptySecretValue("sk-123…xyz"), true);
    assert.equal(isMaskedOrEmptySecretValue("real_secret_token_123"), false);
});

test("tmaAuth ignores untrusted body startParam and rejects mismatched fallback session user", async () => {
    const botToken = "123456:TEST_BOT_TOKEN_SECRET";
    const now = 1_800_000_000_000;
    const nowSec = Math.floor(now / 1000);

    function signInit({ user, authDate, startParam = "" }) {
        const params = new URLSearchParams();
        params.set("auth_date", String(authDate));
        params.set("query_id", "Q1");
        params.set("user", JSON.stringify(user));
        if (startParam) params.set("start_param", startParam);
        const checkStr = [...params.entries()]
            .sort((a, b) => (a[0] < b[0] ? -1 : 1))
            .map(([k, v]) => `${k}=${v}`)
            .join("\n");
        const secretKey = createHmac("sha256", "WebAppData").update(botToken).digest();
        const hash = createHmac("sha256", secretKey).update(checkStr).digest("hex");
        params.set("hash", hash);
        return params.toString();
    }

    let capturedRef = "not-called";
    const app = express();
    app.use(express.json());
    app.use(
        createTmaAuthMiddleware({
            getBotToken: () => botToken,
            nowFn: () => now,
            maxAgeSec: 3600,
            prisma: {
                user: {
                    findUnique: async ({ where }) => ({ id: "u-b", telegramId: String(where.telegramId), isBanned: false }),
                },
            },
            getOrCreateUser: async (tgUser, refParam) => {
                capturedRef = refParam;
                return { id: "u-a", telegramId: String(tgUser.id), isBanned: false };
            },
        }),
    );
    app.post("/auth", (req, res) => res.json({ ok: true, tid: req.tmaUser.telegramId }));

    const server = await new Promise((resolve) => {
        const s = app.listen(0, "127.0.0.1", () => resolve(s));
    });
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    try {
        // 1. Forged body.startParam must be ignored when initData has no start_param
        const validInitNoRef = signInit({ user: { id: 111222333, first_name: "A" }, authDate: nowSec - 30 });
        const r1 = await fetch(`${baseUrl}/auth`, {
            method: "POST",
            headers: { Authorization: `tma ${validInitNoRef}`, "Content-Type": "application/json" },
            body: JSON.stringify({ startParam: "ref999999999" }),
        });
        assert.equal(r1.status, 200);
        assert.equal(capturedRef, null);

        // 2. Expired initData for user 111222333 + valid session token for user 444555666 -> must 401
        const expiredInitUserA = signInit({ user: { id: 111222333, first_name: "A" }, authDate: nowSec - 7200 });
        const sessionUserB = signTmaSessionToken({ telegramId: "444555666" }, botToken, { now, ttlSec: 3600 });
        const r2 = await fetch(`${baseUrl}/auth`, {
            method: "POST",
            headers: {
                Authorization: `tma ${expiredInitUserA}`,
                "x-tma-session": sessionUserB,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({}),
        });
        assert.equal(r2.status, 401);
    } finally {
        server.closeAllConnections?.();
        await new Promise((resolve) => server.close(resolve));
    }
});

test("validateCouponObject fails closed when vipOnly coupon is checked without userId", async () => {
    const res = await validateCouponObject(
        { id: "c1", code: "VIP20", isActive: true, vipOnly: 1, discount: 20, discountType: "PERCENT" },
        100_000,
        null,
    );
    assert.equal(res.valid, false);
    assert.equal(res.error, "VIP_REQUIRED");
    assert.equal(res.vipLevel, 1);
});

test("FLASH_COPY defines skipOk across all supported languages (vi, en, zh)", () => {
    for (const lang of ["vi", "en", "zh"]) {
        assert.equal(typeof FLASH_COPY[lang]?.skipOk, "string");
        assert.ok(FLASH_COPY[lang].skipOk.length > 0);
    }
});
