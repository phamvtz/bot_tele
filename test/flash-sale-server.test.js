import test, { mock } from "node:test";
import assert from "node:assert/strict";
import { makeFlashDb } from "./helpers/flash-sale-db.js";

const url = (path) => new URL(path, import.meta.url).href;

const NOW = 1_700_000_000_000;

let CURRENT = null;
const prismaProxy = new Proxy({}, {
    get: (_t, prop) => (CURRENT ? CURRENT[prop] : undefined),
    has: (_t, prop) => Boolean(CURRENT && prop in CURRENT),
});
mock.module(url("../src/db.js"), { namedExports: { prisma: prismaProxy }, defaultExport: prismaProxy });
mock.module(url("../src/lib/logger.js"), {
    namedExports: { sendLog: () => Promise.resolve(), warnOnce: () => {} },
});

const mod = await import("../src/flash-sale.js");

const saleDoc = (over = {}) => ({
    _id: "sale-1",
    id: "sale-1",
    productId: "prod-apikey",
    productName: "API Key",
    productPrice: 0,
    totalDiscount: true,
    targetProfileId: null,
    discountPct: 30,
    validityMinutes: 60,
    maxSlots: 0,
    status: "OPEN",
    acceptedCount: 0,
    skippedCount: 0,
    purchasedCount: 0,
    recipientTotal: 100,
    opensAt: new Date(NOW - 60000),
    ...over,
});

const responseDoc = (over = {}) => ({
    _id: "resp-1",
    id: "resp-1",
    flashSaleId: "sale-1",
    telegramId: "user-1",
    kind: "ACCEPT",
    expiresAt: new Date(NOW + 3600000),
    respondedAt: new Date(NOW),
    ...over,
});

test("getActiveFlashOffer: đợt sale gắn targetProfileId chỉ giảm giá cho đúng server đó", async () => {
    // Đợt sale chỉ dành cho Server 1 (Claude)
    const saleClaude = saleDoc({
        id: "sale-claude",
        _id: "sale-claude",
        productName: "API Key (Server Claude)",
        targetProfileId: 1,
        discountPct: 30,
    });
    const resp = responseDoc({ flashSaleId: "sale-claude", telegramId: "user-1" });

    CURRENT = makeFlashDb({ sales: [saleClaude], responses: [resp] });
    mod.invalidateFlashOfferCache();

    // Khách mua Server 1 (Claude) -> được giảm giá 30%
    const offerForClaude = await mod.getActiveFlashOffer("user-1", "prod-apikey", { profileId: 1, now: NOW });
    assert.ok(offerForClaude, "phải nhận được ưu đãi khi chọn Server 1");
    assert.equal(offerForClaude.discountPct, 30);
    assert.equal(offerForClaude.targetProfileId, 1);

    // Khách mua Server 2 (Codex) -> KHÔNG được giảm giá (trả về null)
    const offerForCodex = await mod.getActiveFlashOffer("user-1", "prod-apikey", { profileId: 2, now: NOW });
    assert.equal(offerForCodex, null, "không được áp giảm giá khi mua Server 2");
});

test("getActiveFlashOffer: đợt sale Tất cả Server (targetProfileId = null) áp dụng cho mọi server", async () => {
    const saleAll = saleDoc({
        id: "sale-all",
        _id: "sale-all",
        targetProfileId: null,
        discountPct: 20,
    });
    const resp = responseDoc({ flashSaleId: "sale-all", telegramId: "user-1" });

    CURRENT = makeFlashDb({ sales: [saleAll], responses: [resp] });
    mod.invalidateFlashOfferCache();

    const offerForClaude = await mod.getActiveFlashOffer("user-1", "prod-apikey", { profileId: 1, now: NOW });
    assert.ok(offerForClaude);
    assert.equal(offerForClaude.discountPct, 20);

    const offerForCodex = await mod.getActiveFlashOffer("user-1", "prod-apikey", { profileId: 2, now: NOW });
    assert.ok(offerForCodex);
    assert.equal(offerForCodex.discountPct, 20);
});

test("getActiveFlashOffer: ưu tiên mức giảm tốt nhất giữa sale riêng server và sale chung", async () => {
    const saleAll = saleDoc({
        id: "sale-all",
        _id: "sale-all",
        targetProfileId: null,
        discountPct: 20,
    });
    const saleClaude = saleDoc({
        id: "sale-claude",
        _id: "sale-claude",
        targetProfileId: 1,
        discountPct: 35,
    });

    const resp1 = responseDoc({ _id: "r1", id: "r1", flashSaleId: "sale-all", telegramId: "user-1" });
    const resp2 = responseDoc({ _id: "r2", id: "r2", flashSaleId: "sale-claude", telegramId: "user-1" });

    CURRENT = makeFlashDb({ sales: [saleAll, saleClaude], responses: [resp1, resp2] });
    mod.invalidateFlashOfferCache();

    // Server 1 (Claude) hưởng 35% (tốt hơn 20% chung)
    const offerClaude = await mod.getActiveFlashOffer("user-1", "prod-apikey", { profileId: 1, now: NOW });
    assert.ok(offerClaude);
    assert.equal(offerClaude.discountPct, 35);

    // Server 2 (Codex) chỉ hưởng 20% chung
    const offerCodex = await mod.getActiveFlashOffer("user-1", "prod-apikey", { profileId: 2, now: NOW });
    assert.ok(offerCodex);
    assert.equal(offerCodex.discountPct, 20);
});

test("createFlashSale: hai đợt sale cho hai server khác nhau được phép chạy song song", async () => {
    const existingClaudeSale = saleDoc({
        id: "sale-claude",
        _id: "sale-claude",
        status: "OPEN",
        targetProfileId: 1,
    });

    const product = {
        id: "prod-apikey",
        name: "API Key",
        price: 0,
        currency: "USD",
        deliveryMode: "API_KEY",
    };

    CURRENT = makeFlashDb({
        sales: [existingClaudeSale],
        products: [product],
        users: [{ telegramId: "u1", isBlocked: false }],
    });
    // mock Prisma.product
    CURRENT.product = {
        findUnique: async () => product,
    };

    // Tạo đợt cho Server 2 (Codex) -> KHÔNG bị conflict
    const codexSale = await mod.createFlashSale({
        productId: "prod-apikey",
        targetProfileId: 2,
        productName: "API Key (Codex)",
        discountPct: 25,
        now: NOW,
    });
    assert.equal(codexSale.targetProfileId, 2);
    assert.equal(codexSale.productName, "API Key (Codex)");

    // Tạo tiếp đợt nữa cho Server 1 (Claude) -> PHẢI báo lỗi already_running
    await assert.rejects(
        () => mod.createFlashSale({
            productId: "prod-apikey",
            targetProfileId: 1,
            discountPct: 40,
            now: NOW,
        }),
        (err) => err?.code === "already_running"
    );
});

test("readPerMUsd: lấy đúng giá $/1M token theo server profile", async () => {
    const priceAll = await mod.readPerMUsd({ targetProfileId: null });
    assert.equal(typeof priceAll, "number");

    const priceSpecific = await mod.readPerMUsd({ targetProfileId: 1 });
    assert.equal(typeof priceSpecific, "number");
});

