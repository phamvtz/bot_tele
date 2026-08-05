import test from "node:test";
import assert from "node:assert/strict";

import { computeBasePrice, validateKeyConfig } from "../src/aiplus.js";

// M8: callback data (CK_RPM/CK_TOK/CK_DAYS) và session có thể mang giá trị ngoài
// miền aiplus công bố. interp() clamp ở hai đầu nên giá KHÔNG vọt lên — nó ra một
// mức giá rẻ cho cấu hình aiplus sẽ từ chối tạo, tức là trừ ví rồi mới hỏng.
const OPTIONS = {
    range: {
        rpm: { min: 10, max: 1000 },
        tokenM: { min: 10, max: 1000 },
        days: { min: 1, max: 90 },
    },
    presets: { rpm: [200], tokenM: [100], days: [1] },
    pricing: {
        usdtRate: 27000,
        basePerMtokenUsdt: 0.03,
        rpmMult: { 100: 1, 200: 1.2, 1000: 2 },
        daysMult: { 1: 1, 30: 3 },
    },
};

const cfg = (over) => ({ rpm: 200, tokens: 100e6, days: 1, ...over });

test("accepts a config inside the published range", () => {
    assert.deepEqual(validateKeyConfig(cfg(), OPTIONS), { ok: true });
});

test("accepts a custom value that is not a preset but is in range", () => {
    // Nút "Nhập số khác" tồn tại để làm việc này — ràng theo presets sẽ giết nó.
    assert.equal(validateKeyConfig(cfg({ rpm: 333, days: 7 }), OPTIONS).ok, true);
});

test("rejects each field above its max", () => {
    assert.equal(validateKeyConfig(cfg({ rpm: 999999 }), OPTIONS).field, "rpm");
    assert.equal(validateKeyConfig(cfg({ tokens: 5000e6 }), OPTIONS).field, "tokens");
    assert.equal(validateKeyConfig(cfg({ days: 3650 }), OPTIONS).field, "days");
});

test("rejects each field below its min", () => {
    assert.equal(validateKeyConfig(cfg({ rpm: 1 }), OPTIONS).field, "rpm");
    assert.equal(validateKeyConfig(cfg({ tokens: 1e6 }), OPTIONS).field, "tokens");
    assert.equal(validateKeyConfig(cfg({ days: 0 }), OPTIONS).field, "days");
});

test("rejects non-numeric and negative values", () => {
    assert.equal(validateKeyConfig(cfg({ rpm: NaN }), OPTIONS).ok, false);
    assert.equal(validateKeyConfig(cfg({ days: -5 }), OPTIONS).ok, false);
    assert.equal(validateKeyConfig(cfg({ tokens: undefined }), OPTIONS).ok, false);
});

test("the error message is user-facing and names the bound", () => {
    const result = validateKeyConfig(cfg({ days: 3650 }), OPTIONS);
    assert.match(result.error, /1–90/);
});

test("falls back to a positive-number check when range is missing", () => {
    // aiplus đổi schema → không được khoá cả tính năng, chỉ chặn giá trị vô lý.
    assert.equal(validateKeyConfig(cfg(), { presets: {} }).ok, true);
    assert.equal(validateKeyConfig(cfg({ rpm: 0 }), { presets: {} }).ok, false);
});

test("interp clamps instead of extrapolating past the table edges", () => {
    // Ghim hành vi mà validate dựa vào: rpm ngoài bảng bị kẹp về mốc gần nhất,
    // nên giá KHÔNG phản ánh cấu hình khách chọn — đó là lý do phải chặn từ trước.
    const atMax = computeBasePrice({ rpm: 1000, tokens: 100e6, days: 1, pricing: OPTIONS.pricing });
    const beyond = computeBasePrice({ rpm: 999999, tokens: 100e6, days: 1, pricing: OPTIONS.pricing });
    assert.equal(beyond.vnd, atMax.vnd);

    const atMin = computeBasePrice({ rpm: 100, tokens: 100e6, days: 1, pricing: OPTIONS.pricing });
    const below = computeBasePrice({ rpm: 1, tokens: 100e6, days: 1, pricing: OPTIONS.pricing });
    assert.equal(below.vnd, atMin.vnd);
});
