import test from "node:test";
import assert from "node:assert/strict";

import { formatUsdPrimary, liveUsdVndRate, orderDisplayRate } from "../src/money-display.js";

// H5: số tiền của một đơn phải hiển thị theo tỷ giá đã chốt, không phải tỷ giá
// live lúc render — nếu không, cùng một đơn ra số USD khác nhau ở từng màn hình.
function withEnv(values, fn) {
    const saved = {};
    for (const [key, value] of Object.entries(values)) {
        saved[key] = process.env[key];
        if (value === undefined) delete process.env[key];
        else process.env[key] = String(value);
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

test("orderDisplayRate uses the rate locked on the order", () => {
    assert.equal(orderDisplayRate({ cryptoUsdVndRate: 26000 }), 26000);
    // Draft checkout trong memory dùng tên field khác.
    assert.equal(orderDisplayRate({ usdVndRate: 27000 }), 27000);
});

test("orderDisplayRate falls back to the configured static rate, not the live rate", () => {
    withEnv({ CRYPTO_USD_VND_RATE_AUTO: "false", CRYPTO_USD_VND_RATE: 25500 }, () => {
        assert.equal(orderDisplayRate({}), 25500);
        assert.equal(orderDisplayRate({ cryptoUsdVndRate: null }), 25500);
        assert.equal(orderDisplayRate({ cryptoUsdVndRate: 0 }), 25500);
    });
});

test("the same order renders the same USD amount regardless of the live rate", () => {
    const order = { finalAmount: 265000, currency: "VND", cryptoUsdVndRate: 26000 };
    const render = () => formatUsdPrimary(order.finalAmount, order.currency, {
        lang: "vi",
        rate: orderDisplayRate(order),
    });

    const a = withEnv({ CRYPTO_USD_VND_RATE_AUTO: "false", CRYPTO_USD_VND_RATE: 26000 }, render);
    const b = withEnv({ CRYPTO_USD_VND_RATE_AUTO: "false", CRYPTO_USD_VND_RATE: 30000 }, render);
    assert.equal(a, b);
});

// Không còn default: quên truyền rate là lỗi to tiếng, không phải hiển thị sai âm thầm.
test("formatUsdPrimary throws when the caller forgets to pass a rate", () => {
    assert.throws(() => formatUsdPrimary(265000, "VND", { lang: "vi" }), /rate/i);
});

test("liveUsdVndRate is still available for amounts not tied to an order", () => {
    withEnv({ CRYPTO_USD_VND_RATE_AUTO: "false", CRYPTO_USD_VND_RATE: 25500 }, () => {
        assert.equal(liveUsdVndRate(), 25500);
    });
});
