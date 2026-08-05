import test from "node:test";
import assert from "node:assert/strict";

import { createCryptoCheckout, restoreCryptoCheckout } from "../src/payment/crypto.js";
import { getCryptoAmountTolerance } from "../src/payment/amounts.js";

const TRC20_ADDRESS = "TQ3XyZrestoreTestAddress000000000";

function withEnv(rate, fn) {
    const saved = {};
    const set = {
        CRYPTO_USD_VND_RATE_AUTO: "false",
        CRYPTO_USD_VND_RATE: String(rate),
        TRC20_USDT_ADDRESS: TRC20_ADDRESS,
        CRYPTO_PAY_ENABLED: "true",
    };
    for (const [key, value] of Object.entries(set)) {
        saved[key] = process.env[key];
        process.env[key] = value;
    }
    try {
        return fn();
    } finally {
        for (const [key, value] of Object.entries(saved)) {
            if (value === undefined) delete process.env[key];
            else process.env[key] = value;
        }
    }
}

function persistedOrder(checkout, overrides = {}) {
    // Đúng những field mà sendCryptoCheckout ghi vào DB lúc tạo đơn.
    return {
        id: "order-abc12345",
        status: "PENDING",
        paymentMethod: "crypto_trc20",
        finalAmount: 265000,
        quantity: 1,
        createdAt: new Date(),
        cryptoNetwork: checkout.network,
        cryptoAmount: checkout.amountToken,
        cryptoAddress: checkout.address,
        cryptoToken: checkout.token,
        cryptoUsdVndRate: checkout.usdVndRate,
        paymentRef: null,
        ...overrides,
    };
}

// C1: đây là bug gốc. Trước khi sửa, xem lại màn thanh toán gọi lại
// createCryptoCheckout → tỷ giá live mới → số USDT mới → transfer khách đã gửi
// không bao giờ khớp. restoreCryptoCheckout phải giữ nguyên con số đã chốt.
test("restoring a checkout keeps the amount fixed even after the rate moves", () => {
    const original = withEnv(26000, () => createCryptoCheckout({
        orderId: "order-abc12345",
        amount: 265000,
        productName: "Test product",
        quantity: 1,
        network: "trc20",
    }));
    assert.equal(original.amountToken, 10.202181);

    const order = persistedOrder(original);
    const restored = withEnv(27000, () => restoreCryptoCheckout(order, { productName: "Test product" }));

    assert.ok(restored);
    assert.equal(restored.restored, true);
    assert.equal(restored.amountToken, original.amountToken);
    assert.equal(restored.usdVndRate, original.usdVndRate);
    assert.equal(restored.address, original.address);
    assert.equal(restored.network, original.network);
    assert.equal(restored.token, original.token);

    // Chứng minh sự khác biệt: tạo mới ở tỷ giá mới ra số khác hẳn.
    const regenerated = withEnv(27000, () => createCryptoCheckout({
        orderId: "order-abc12345",
        amount: 265000,
        productName: "Test product",
        quantity: 1,
        network: "trc20",
    }));
    assert.ok(Math.abs(regenerated.amountToken - original.amountToken) > getCryptoAmountTolerance());
    assert.equal(restored.amountToken, original.amountToken);
});

test("restored checkout carries the order product info for rendering", () => {
    const original = withEnv(26000, () => createCryptoCheckout({
        orderId: "order-abc12345", amount: 265000, productName: "X", quantity: 3, network: "trc20",
    }));
    const order = persistedOrder(original, { quantity: 3 });
    const restored = withEnv(26000, () => restoreCryptoCheckout(order, { productName: "X" }));

    assert.equal(restored.productInfo.name, "X");
    assert.equal(restored.productInfo.quantity, 3);
    assert.equal(restored.productInfo.total, 265000);
    assert.equal(restored.amountVnd, 265000);
});

test("restores from paymentRef when the crypto columns are missing (legacy orders)", () => {
    const original = withEnv(26000, () => createCryptoCheckout({
        orderId: "order-abc12345", amount: 265000, productName: "X", quantity: 1, network: "trc20",
    }));
    const legacy = persistedOrder(original, {
        cryptoNetwork: null,
        cryptoAmount: null,
        cryptoAddress: null,
        cryptoToken: null,
        cryptoUsdVndRate: null,
        paymentRef: `CRYPTO:${JSON.stringify({
            network: original.network,
            amountToken: original.amountToken,
            amountUsd: original.amountUsd,
            address: original.address,
            token: original.token,
            rate: original.usdVndRate,
        })}`,
    });

    const restored = withEnv(27000, () => restoreCryptoCheckout(legacy, { productName: "X" }));
    assert.ok(restored);
    assert.equal(restored.amountToken, original.amountToken);
    assert.equal(restored.usdVndRate, original.usdVndRate);
    assert.equal(restored.address, original.address);
});

test("returns null when the order never had a locked crypto amount", () => {
    withEnv(26000, () => {
        assert.equal(restoreCryptoCheckout({
            id: "order-x", paymentMethod: "crypto_trc20", finalAmount: 1000, createdAt: new Date(),
        }), null);

        assert.equal(restoreCryptoCheckout({
            id: "order-y", paymentMethod: "vietqr", finalAmount: 1000, createdAt: new Date(),
        }), null);
    });
});

test("restored expiry derives from createdAt, not from now", () => {
    const saved = process.env.CRYPTO_EXPIRE_MINUTES;
    process.env.CRYPTO_EXPIRE_MINUTES = "10";
    try {
        const original = withEnv(26000, () => createCryptoCheckout({
            orderId: "order-abc12345", amount: 265000, productName: "X", quantity: 1, network: "trc20",
        }));
        const createdAt = new Date(Date.now() - 9 * 60 * 1000);
        const order = persistedOrder(original, { createdAt });

        const restored = withEnv(26000, () => restoreCryptoCheckout(order, { productName: "X" }));
        const remainMs = new Date(restored.expiresAt) - Date.now();
        assert.ok(remainMs < 2 * 60 * 1000, `expiry must reflect the original order, got ${remainMs}ms left`);
        assert.ok(remainMs > 0);
    } finally {
        if (saved === undefined) delete process.env.CRYPTO_EXPIRE_MINUTES;
        else process.env.CRYPTO_EXPIRE_MINUTES = saved;
    }
});

test("restored expiry prefers the persisted expiresAt when present", () => {
    const original = withEnv(26000, () => createCryptoCheckout({
        orderId: "order-abc12345", amount: 265000, productName: "X", quantity: 1, network: "trc20",
    }));
    const expiresAt = new Date(Date.now() + 4 * 60 * 1000);
    const order = persistedOrder(original, { expiresAt });

    const restored = withEnv(26000, () => restoreCryptoCheckout(order, { productName: "X" }));
    assert.equal(new Date(restored.expiresAt).getTime(), expiresAt.getTime());
});
