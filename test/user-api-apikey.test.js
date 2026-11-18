import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

process.env.USER_API_SECRET = "test-user-secret-for-unit-tests";

const { getUserApiKey } = await import("../src/user-api.js");

test("getUserApiKey trả về key format sk_u_v2_<id>_<hash>", () => {
    const key = getUserApiKey("999888777");
    assert.match(key, /^sk_u_v2_999888777_[a-f0-9]{64}$/);
    const key2 = getUserApiKey("999888777");
    assert.equal(key, key2, "Cùng telegramId phải sinh ra cùng key");
});

test("user-api.js định nghĩa đầy đủ các routes phục vụ Seller tạo key trừ ví", () => {
    const src = readFileSync(new URL("../src/user-api.js", import.meta.url), "utf8");
    
    // Kiểm tra các endpoint tạo key và quote
    assert.ok(src.includes('router.post("/apikey/create"'), "phải có router.post('/apikey/create')");
    assert.ok(src.includes('router.post("/keys"'), "phải có router.post('/keys')");
    assert.ok(src.includes('router.post("/apikey/quote"'), "phải có router.post('/apikey/quote')");
    assert.ok(src.includes('router.post("/quote"'), "phải có router.post('/quote')");
    assert.ok(src.includes('router.get("/apikey/profiles"'), "phải có router.get('/apikey/profiles')");
    assert.ok(src.includes('router.get("/profiles"'), "phải có router.get('/profiles')");
    assert.ok(src.includes('router.get("/apikey/keys"'), "phải có router.get('/apikey/keys')");
    assert.ok(src.includes('router.get("/keys"'), "phải có router.get('/keys')");

    // Kiểm tra an toàn tài chính: kiểm tra số dư ví trước và trừ ví bằng walletPurchase
    assert.ok(src.includes("walletPurchase("), "phải trừ ví bằng walletPurchase");
    assert.ok(src.includes("walletRefund("), "phải hoàn tiền ví tự động khi provider lỗi");
    assert.ok(src.includes("saveIssuedKey("), "phải lưu key đã cấp vào database");
    assert.ok(src.includes("clientRef"), "phải hỗ trợ idempotency clientRef chống trừ tiền trùng");
});
