import test from "node:test";
import assert from "node:assert/strict";

import { verifyIPNWebhook } from "../src/payment/vietqr.js";

const IPN_KEYS = [
    "IPN_SECRET_TOKEN",
    "THUEAPIBANK_WEBHOOK_SIGNATURE",
    "SEPAY_API_KEY",
    "SEPAY_SECRET_KEY",
    "ALLOW_UNSIGNED_IPN",
];

// Mỗi test chạy trên môi trường sạch: không kế thừa secret thật từ .env.
function withEnv(env, fn) {
    const saved = {};
    for (const key of IPN_KEYS) {
        saved[key] = process.env[key];
        delete process.env[key];
    }
    for (const [key, value] of Object.entries(env)) process.env[key] = value;
    try {
        return fn();
    } finally {
        for (const key of IPN_KEYS) {
            if (saved[key] === undefined) delete process.env[key];
            else process.env[key] = saved[key];
        }
    }
}

const req = (headers = {}) => ({ headers });

// H2: trước khi sửa, thiếu secret → console.warn rồi return true. Một lần deploy
// quên biến môi trường là bất kỳ ai POST đúng format đều nhận hàng miễn phí.
test("rejects a webhook when no IPN secret is configured", () => {
    withEnv({}, () => {
        assert.throws(
            () => verifyIPNWebhook(req({ "secure-token": "anything" }), "casso"),
            /IPN_SECRET_TOKEN/,
        );
    });
});

test("rejects a SePay webhook when no SePay key is configured", () => {
    withEnv({}, () => {
        assert.throws(
            () => verifyIPNWebhook(req({ authorization: "Apikey anything" }), "sepay"),
            /SEPAY_API_KEY/,
        );
    });
});

test("accepts a correctly signed webhook", () => {
    withEnv({ IPN_SECRET_TOKEN: "s3cret" }, () => {
        assert.equal(verifyIPNWebhook(req({ "secure-token": "s3cret" }), "casso"), true);
        assert.equal(verifyIPNWebhook(req({ "x-signature": "s3cret" }), "casso"), true);
    });
});

test("still rejects a wrong signature when a secret is configured", () => {
    withEnv({ IPN_SECRET_TOKEN: "s3cret" }, () => {
        assert.throws(() => verifyIPNWebhook(req({ "secure-token": "wrong" }), "casso"), /Invalid IPN signature/);
        assert.throws(() => verifyIPNWebhook(req(), "casso"), /Invalid IPN signature/);
    });
});

test("accepts SePay keys via Apikey, Bearer, and fallback headers", () => {
    withEnv({ SEPAY_API_KEY: "sepay-key" }, () => {
        assert.equal(verifyIPNWebhook(req({ authorization: "Apikey sepay-key" }), "sepay"), true);
        assert.equal(verifyIPNWebhook(req({ authorization: "Bearer sepay-key" }), "sepay"), true);
        assert.equal(verifyIPNWebhook(req({ "x-api-key": "sepay-key" }), "sepay"), true);
        assert.throws(() => verifyIPNWebhook(req({ authorization: "Apikey nope" }), "sepay"), /Invalid SePay signature/);
    });
});

test("a DB-resolved SePay key satisfies verification without any env var", () => {
    withEnv({}, () => {
        assert.equal(
            verifyIPNWebhook(req({ authorization: "Apikey from-db" }), "sepay", { sepayKey: "from-db" }),
            true,
        );
    });
});

// Cửa thoát cho dev phải tường minh và chỉ mở khi bật đúng cờ.
test("ALLOW_UNSIGNED_IPN=true is the only way to skip verification", () => {
    withEnv({ ALLOW_UNSIGNED_IPN: "true" }, () => {
        assert.equal(verifyIPNWebhook(req(), "casso"), true);
        assert.equal(verifyIPNWebhook(req(), "sepay"), true);
    });
    for (const value of ["false", "1", "yes", ""]) {
        withEnv({ ALLOW_UNSIGNED_IPN: value }, () => {
            assert.throws(() => verifyIPNWebhook(req(), "casso"), /IPN_SECRET_TOKEN/, `must not open on "${value}"`);
        });
    }
});
