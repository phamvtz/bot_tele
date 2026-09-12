import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { isDuplicateKeyError } from "../src/lib/duplicate-key.js";

// Hàm này quyết định "request này đã có người khác xử lý chưa", tức là CÓ ĐƯỢC ghi
// tiền / cấp key / cộng ví lần nữa hay không. Trước đây nó tồn tại hai bản:
//   - lib/payment-events.js: đủ 11000, P2002, "duplicate key", "unique constraint failed"
//   - giftcode.js:             chỉ 11000 và "E11000|duplicate key"
// Bản giftcode THIẾU `P2002`, nên trên PostgreSQL một lần đổi giftcode trùng sẽ
// không bị phát hiện — hai redemption cùng insert được là khách nhận quà hai lần.
// Test này khoá tập dấu hiệu để không ai thu hẹp nó lại, và khoá luôn việc không
// còn bản sao thứ hai trong repo.

test("nhận đúng lỗi trùng khoá của cả MongoDB lẫn PostgreSQL", () => {
    const positives = [
        { code: 11000 },                                    // Mongo native driver
        { code: "P2002" },                                  // Prisma / PostgreSQL
        { message: "E11000 duplicate key error collection: bot.issuedApiKeys index: clientRef" },
        { message: 'duplicate key value violates unique constraint "giftcoderedemptions_redeemkey_key"' },
        { message: "UNIQUE constraint failed: orders.paymentRef" },
        { code: 11000, message: "" },
        { message: "some text E11000 more text" },
    ];
    for (const err of positives) {
        assert.equal(isDuplicateKeyError(err), true, `phải nhận ra: ${JSON.stringify(err)}`);
    }
});

test("không nhầm lỗi khác thành trùng khoá", () => {
    // Nhận nhầm là nguy hiểm theo chiều ngược lại: một lỗi mạng bị coi là "đã có
    // người xử lý" thì request hợp lệ bị từ chối im lặng.
    const negatives = [
        null, undefined, {},
        new Error("timeout"),
        { code: 12345 },
        { code: "P2025", message: "Record to update not found" },
        { message: "connection refused" },
        { message: "" },
        "E11000",                       // chuỗi trần, không phải Error object
    ];
    for (const err of negatives) {
        assert.equal(isDuplicateKeyError(err), false, `không được nhận nhầm: ${JSON.stringify(err) ?? String(err)}`);
    }
});

test("message không phải chuỗi cũng không làm nổ", () => {
    assert.equal(isDuplicateKeyError({ message: null }), false);
    assert.equal(isDuplicateKeyError({ message: 12345 }), false);
    assert.equal(isDuplicateKeyError({ message: {} }), false);
});

// ─── Chốt: chỉ còn MỘT bản trong repo ───────────────────────────────────────────

test("không module nào tự định nghĩa lại hàm phát hiện trùng khoá", () => {
    // Đây là toàn bộ lý do có file lib/duplicate-key.js. Hai bản sao với hai tập dấu
    // hiệu hơi khác nhau đã tồn tại một lần rồi — cùng lớp bug với
    // isSafeRefundCreateCode trong delivery.js.
    const files = [
        "../src/lib/payment-events.js",
        "../src/giftcode.js",
        "../src/apikey-store.js",
        "../src/wallet.js",
        "../src/seller-api.js",
        "../src/coupon.js",
    ];
    for (const f of files) {
        const src = readFileSync(new URL(f, import.meta.url), "utf8");
        assert.ok(
            !/function\s+(isDuplicateKeyError|duplicateKey)\s*\(/.test(src),
            `${f} không được tự định nghĩa hàm phát hiện trùng khoá — phải import từ lib/duplicate-key.js`,
        );
    }
});

test("cả payment-events lẫn giftcode đều dùng bản DÙNG CHUNG", () => {
    for (const f of ["../src/lib/payment-events.js", "../src/giftcode.js"]) {
        const src = readFileSync(new URL(f, import.meta.url), "utf8");
        assert.ok(
            src.includes('from "./duplicate-key.js"') || src.includes('from "./lib/duplicate-key.js"'),
            `${f} phải import từ lib/duplicate-key.js`,
        );
    }
});
