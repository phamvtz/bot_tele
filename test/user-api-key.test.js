import test from "node:test";
import assert from "node:assert/strict";

process.env.USER_API_SECRET = "test-user-secret-that-is-not-admin";
const { getUserApiKey } = await import("../src/user-api.js");

test("user API key v2 chứa lookup id và chữ ký HMAC cố định", () => {
    const first = getUserApiKey("123456789");
    const second = getUserApiKey("123456789");
    assert.equal(first, second);
    assert.match(first, /^sk_u_v2_123456789_[a-f0-9]{64}$/);
});

test("không có USER_API_SECRET thì fail closed, không dùng secret mặc định", () => {
    const previous = process.env.USER_API_SECRET;
    delete process.env.USER_API_SECRET;
    assert.throws(() => getUserApiKey("123456789"), /USER_API_SECRET/);
    process.env.USER_API_SECRET = previous;
});