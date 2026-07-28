import test from "node:test";
import assert from "node:assert/strict";
import { computeBasePrice, applyMarkup, parseCreateKeyResponse } from "../src/aiplus.js";

// Bảng giá thật lấy từ GET /keys/claude-custom/options của aiplus (2026-07).
const PRICING = {
    currency: "USDT",
    usdtRate: 27000,
    basePerMtokenUsdt: 0.03,
    rpmMult: { 200: 1.1, 500: 1.2, 1000: 1.5, 2000: 1.8, 3000: 2.5 },
    daysMult: { 1: 1.1, 3: 1.15, 7: 1.2, 14: 1.5, 30: 2.5 },
};

test("giá gốc khớp chính xác aiplus cho các mốc preset", () => {
    // Các giá trị priceVnd dưới đây do chính API aiplus trả về (insufficient_balance).
    assert.equal(computeBasePrice({ rpm: 200, tokens: 100e6, days: 1, pricing: PRICING }).vnd, 98280);
    assert.equal(computeBasePrice({ rpm: 3000, tokens: 1000e6, days: 30, pricing: PRICING }).vnd, 5062500);
});

test("nội suy tuyến tính cho số ngày không có mốc (day=10) khớp aiplus", () => {
    // aiplus trả priceVnd=258390 cho rpm500 / 200M / 10 ngày (day 10 nằm giữa 7 và 14).
    assert.equal(computeBasePrice({ rpm: 500, tokens: 200e6, days: 10, pricing: PRICING }).vnd, 258390);
});

test("markup 0% bán đúng giá gốc, không làm tròn", () => {
    assert.equal(applyMarkup(98280, 0), 98280);
    assert.equal(applyMarkup(258390, 0), 258390);
});

test("markup > 0 cộng % rồi làm tròn lên 1.000đ", () => {
    assert.equal(applyMarkup(98280, 20), 118000); // 98280 * 1.2 = 117936 → ceil 118000
    assert.equal(applyMarkup(98280, 50), 148000); // 98280 * 1.5 = 147420 → ceil 148000
});

test("markup âm hoặc không hợp lệ coi như 0%", () => {
    assert.equal(applyMarkup(98280, -5), 98280);
    assert.equal(applyMarkup(98280, NaN), 98280);
    assert.equal(applyMarkup(98280, undefined), 98280);
});

// ─── parseCreateKeyResponse — quyết định thành công/thất bại (→ hoàn tiền) ──────
test("thành công: lấy đúng key từ field apiKey", () => {
    const r = parseCreateKeyResponse(200, {
        code: 0, message: "ok",
        data: { id: 42, apiKey: "sk-ant-xxx", expiresAt: "2026-08-01T00:00:00Z", rpm: 200, tokens: 100e6 },
    }, { rpm: 200, tokens: 100e6 });
    assert.equal(r.ok, true);
    assert.equal(r.key, "sk-ant-xxx");
    assert.equal(r.keyId, 42);
    assert.equal(r.expiresAt, "2026-08-01T00:00:00Z");
});

test("thành công: chấp nhận field name thay thế (key/secret/token/value)", () => {
    for (const field of ["key", "secret", "token", "value"]) {
        const r = parseCreateKeyResponse(200, { code: 0, data: { [field]: "K123" } });
        assert.equal(r.ok, true, `field ${field}`);
        assert.equal(r.key, "K123");
    }
});

test("thất bại: các response lỗi thật của aiplus → ok:false để hoàn tiền", () => {
    // Các payload này lấy trực tiếp từ aiplus khi probe.
    const outOfStock = parseCreateKeyResponse(200, { code: "out_of_stock", message: "out_of_stock", available: 0, requested: 1 });
    assert.equal(outOfStock.ok, false);
    assert.equal(outOfStock.code, "out_of_stock");

    const insufficient = parseCreateKeyResponse(200, { code: "insufficient_balance", message: "insufficient_balance", priceVnd: 98280, balanceVnd: 0 });
    assert.equal(insufficient.ok, false);
    assert.equal(insufficient.priceVnd, 98280);

    const missing = parseCreateKeyResponse(400, { code: "missing_field", message: "Body cần rpm, tokens, days (số)" });
    assert.equal(missing.ok, false);
});

test("thất bại: code=0 nhưng không có key → vẫn hoàn tiền (không giao hàng rỗng)", () => {
    const r = parseCreateKeyResponse(200, { code: 0, message: "ok", data: { id: 7 } });
    assert.equal(r.ok, false);
    assert.equal(r.code, "no_key_in_response");
});

test("thất bại: JSON null / HTTP lỗi không có body", () => {
    const r = parseCreateKeyResponse(502, null);
    assert.equal(r.ok, false);
    assert.equal(r.code, "http_502");
});
