import test from "node:test";
import assert from "node:assert/strict";

import { secretEquals } from "../src/lib/secret-compare.js";
import { verifyIPNWebhook } from "../src/payment/vietqr.js";
import { adminAuth } from "../src/middleware/adminAuth.js";

// M7: mọi so sánh bí mật đi qua secretEquals. `!==` của JS thoát ra ở byte đầu tiên
// khác nhau, nên với một endpoint public gọi được tuỳ ý (webhook IPN, /admin/*),
// thời gian phản hồi rò rỉ độ dài prefix đúng — đủ để dò token theo từng byte.
// Test này không đo thời gian (không đáng tin trên CI); nó ghim ĐÚNG ĐẮN, để
// việc đổi sang timingSafeEqual không âm thầm làm hỏng xác thực.

test("equal strings match, different strings do not", () => {
    assert.equal(secretEquals("s3cr3t", "s3cr3t"), true);
    assert.equal(secretEquals("s3cr3t", "s3cr3T"), false);
});

test("different lengths return false instead of throwing", () => {
    // timingSafeEqual ném khi hai buffer khác độ dài — hash trước để luôn 32 byte.
    assert.equal(secretEquals("short", "a-much-longer-secret"), false);
    assert.doesNotThrow(() => secretEquals("a", "bb"));
});

test("missing or non-string values never authenticate", () => {
    for (const bad of ["", null, undefined, 0, 123, {}, [], NaN]) {
        assert.equal(secretEquals(bad, "secret"), false, `${String(bad)} không được coi là hợp lệ`);
        assert.equal(secretEquals("secret", bad), false, `secret vs ${String(bad)}`);
    }
    // Không cấu hình secret thì không ai được vào.
    assert.equal(secretEquals("", ""), false);
});

function withEnv(env, fn) {
    const saved = {};
    for (const [k, v] of Object.entries(env)) {
        saved[k] = process.env[k];
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
    }
    try {
        return fn();
    } finally {
        for (const [k, v] of Object.entries(saved)) {
            if (v === undefined) delete process.env[k];
            else process.env[k] = v;
        }
    }
}

test("IPN webhook still accepts the right token and rejects a wrong one", () => {
    withEnv({ IPN_SECRET_TOKEN: "ipn-token-abc", THUEAPIBANK_WEBHOOK_SIGNATURE: undefined, ALLOW_UNSIGNED_IPN: undefined }, () => {
        assert.equal(verifyIPNWebhook({ headers: { "secure-token": "ipn-token-abc" } }), true);
        assert.throws(() => verifyIPNWebhook({ headers: { "secure-token": "ipn-token-abd" } }), /Invalid IPN signature/);
        // Thiếu header hoàn toàn: trước đây undefined !== token nên vẫn chặn — phải giữ.
        assert.throws(() => verifyIPNWebhook({ headers: {} }), /Invalid IPN signature/);
    });
});

test("SePay webhook still accepts the right Apikey and rejects a wrong one", () => {
    withEnv({ SEPAY_API_KEY: "sepay-key-xyz", ALLOW_UNSIGNED_IPN: undefined }, () => {
        assert.equal(verifyIPNWebhook({ headers: { authorization: "Apikey sepay-key-xyz" } }, "sepay"), true);
        assert.throws(() => verifyIPNWebhook({ headers: { authorization: "Apikey nope" } }, "sepay"), /Invalid SePay signature/);
        assert.throws(() => verifyIPNWebhook({ headers: {} }, "sepay"), /Invalid SePay signature/);
    });
});

test("adminAuth passes the right token and 401s everything else", () => {
    withEnv({ ADMIN_SECRET: "admin-secret-1" }, () => {
        const run = (headers) => {
            let status = null; let body = null; let nexted = false;
            adminAuth(
                { headers },
                { status(code) { status = code; return this; }, json(payload) { body = payload; return this; } },
                () => { nexted = true; },
            );
            return { status, body, nexted };
        };
        assert.equal(run({ "x-admin-token": "admin-secret-1" }).nexted, true);
        assert.equal(run({ "x-admin-token": "admin-secret-2" }).status, 401);
        assert.equal(run({}).status, 401);
    });
    // Không cấu hình ADMIN_SECRET → không được cho qua kể cả khi client gửi rỗng.
    withEnv({ ADMIN_SECRET: undefined }, () => {
        let status = null;
        adminAuth(
            { headers: { "x-admin-token": "" } },
            { status(code) { status = code; return this; }, json() { return this; } },
            () => { status = "nexted"; },
        );
        assert.equal(status, 401);
    });
});
