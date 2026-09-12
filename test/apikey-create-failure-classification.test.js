import test from "node:test";
import assert from "node:assert/strict";

import { isSafeApiKeyCreateFailure } from "../src/gpt2api.js";

// isSafeApiKeyCreateFailure là CHỐT DUY NHẤT quyết định một ca tạo key hỏng có được
// hoàn tiền tự động hay không. Nó là hàm thuần nên test trực tiếp bằng bảng, không
// cần mock gì.
//
// Hai chiều đều phải đúng, và hai chiều đều tốn tiền nếu sai:
//   - Nói "an toàn" cho một ca provider CÓ THỂ đã tạo key → khách vừa giữ key vừa
//     được hoàn tiền, shop mất trắng.
//   - Nói "mơ hồ" cho một ca chắc chắn chưa tạo key → khách đã trả tiền bị treo đơn,
//     không key không hoàn tiền, chờ admin soát tay.
//
// `providerMutationPossible` là tín hiệu phân biệt: createApiKey đặt false cho mọi
// lỗi xảy ra TRƯỚC khi POST /keys rời process (chưa cấu hình, server tắt, preflight
// listModelGroups hỏng), và true cho mọi lỗi xảy ra sau đó.

const SAFE_TO_REFUND = [
    // Chưa POST /keys — provider không thể đã tạo key, dù code trùng với ca mơ hồ.
    ["preflight model-groups lỗi mạng", { ok: false, code: "network", providerMutationPossible: false }],
    ["preflight lỗi mạng, không code", { ok: false, providerMutationPossible: false }],
    // POST rồi nhưng provider từ chối rõ ràng — payload/auth/scope, không có key.
    ["payload sai (40000 dạng number)", { ok: false, code: 40000, providerMutationPossible: true }],
    ["payload sai (40000 dạng chuỗi)", { ok: false, code: "40000", providerMutationPossible: true }],
    ["token admin hỏng (401)", { ok: false, code: "invalid_admin_key", providerMutationPossible: true }],
    ["thiếu scope key:write (403)", { ok: false, code: "scope_denied", providerMutationPossible: true }],
    ["bị giới hạn tốc độ (429)", { ok: false, code: "rate_limited", providerMutationPossible: true }],
    ["không lấy được fallback group", { ok: false, code: "no_fallback_groups", providerMutationPossible: false }],
    ["chưa cấu hình GPT2API", { ok: false, code: "not_configured", providerMutationPossible: false }],
    ["server / cả shop đang tắt", { ok: false, code: "disabled", providerMutationPossible: false }],
    ["4xx không phải JSON", { ok: false, code: "http_400", providerMutationPossible: true }],
];

const AMBIGUOUS = [
    // Request đã rời process: provider CÓ THỂ đã tạo key rồi mới đứt.
    ["timeout sau khi POST", { ok: false, code: "network", providerMutationPossible: true }],
    ["lỗi mạng, không khai báo mutation", { ok: false, code: "network" }],
    ["code 0 mà không có key", { ok: false, code: "no_key_in_response", providerMutationPossible: true }],
    ["5xx", { ok: false, code: "http_500", providerMutationPossible: true }],
    ["502 Bad Gateway", { ok: false, code: "http_502", providerMutationPossible: true }],
    ["503 (provider quá tải)", { ok: false, code: "http_503", providerMutationPossible: true }],
    ["không có code gì để phân loại", { ok: false, providerMutationPossible: true }],
    ["result rỗng", {}],
    // providerMutationPossible:false CHỈ thắng khi ca đó thật sự chưa POST. Một result
    // ok:true thì không phải thất bại, không được đem đi hoàn tiền.
    ["ok:true không phải là thất bại", { ok: true, key: "sk-x", providerMutationPossible: false }],
];

test("mọi mã lỗi chắc chắn CHƯA tạo key đều được hoàn tiền tự động", () => {
    for (const [name, result] of SAFE_TO_REFUND) {
        assert.equal(
            isSafeApiKeyCreateFailure(result),
            true,
            `${name} phải được coi là an toàn để hoàn tiền — result: ${JSON.stringify(result)}`,
        );
    }
});

test("mọi mã lỗi có thể ĐÃ tạo key đều bị giữ lại chờ đối soát", () => {
    for (const [name, result] of AMBIGUOUS) {
        assert.equal(
            isSafeApiKeyCreateFailure(result),
            false,
            `${name} KHÔNG được hoàn tiền tự động — result: ${JSON.stringify(result)}`,
        );
    }
});

test("providerMutationPossible:false thắng mã lỗi mơ hồ như 'network'", () => {
    // Đây chính là ca bug: cùng một code "network", hai kết luận ngược nhau tuỳ vào
    // việc request đã rời process hay chưa. Ai phân loại bằng riêng `code` sẽ gộp hai
    // ca này làm một và treo đơn của khách oan.
    assert.equal(isSafeApiKeyCreateFailure({ ok: false, code: "network", providerMutationPossible: false }), true);
    assert.equal(isSafeApiKeyCreateFailure({ ok: false, code: "network", providerMutationPossible: true }), false);
    assert.equal(isSafeApiKeyCreateFailure({ ok: false, code: "network" }), false);
});

test("chuẩn hoá hoa/thường — provider trả mã lỗi không nhất quán kiểu", () => {
    // CLAUDE.md ghi rõ 40400 có thể về dưới dạng number. Chuẩn hoá phải xử cả hai.
    assert.equal(isSafeApiKeyCreateFailure({ ok: false, code: "NETWORK", providerMutationPossible: true }), false);
    assert.equal(isSafeApiKeyCreateFailure({ ok: false, code: "HTTP_500", providerMutationPossible: true }), false);
    assert.equal(isSafeApiKeyCreateFailure({ ok: false, code: 40000, providerMutationPossible: true }), true);
    assert.equal(isSafeApiKeyCreateFailure({ ok: false, code: "40000", providerMutationPossible: true }), true);
});

test("delivery.js không được tự định nghĩa lại bộ phân loại này", async () => {
    // Chốt cấu trúc: bug gốc là delivery.js chép logic vào isSafeRefundCreateCode rồi
    // để nó lệch với bản ở gpt2api.js. Hai nguồn sự thật cho một quyết định tài chính
    // là thứ sẽ lệch lại lần nữa.
    const { readFileSync } = await import("node:fs");
    const src = readFileSync(new URL("../src/delivery.js", import.meta.url), "utf8");
    assert.ok(
        src.includes("isSafeApiKeyCreateFailure"),
        "delivery.js phải dùng bộ phân loại của gpt2api.js",
    );
    assert.ok(
        !/function\s+isSafeRefundCreateCode/.test(src),
        "delivery.js không được định nghĩa lại bộ phân loại hoàn tiền tại chỗ",
    );
});
