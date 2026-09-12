import test from "node:test";
import assert from "node:assert/strict";

import {
    APIKEY_PROCESSING_TTL_MS,
    isApikeyProcessingActive,
    claimApikeyProcessing,
    releaseApikeyProcessing,
} from "../src/lib/apikey-processing-flag.js";

// Cờ này chống bấm đúp tạo hai đơn / trừ ví hai lần. Nhưng session của bot persist
// xuống Mongo (botSessions, TTL 30 ngày), nên một cờ boolean trần có thể bị ghi xuống
// DB ở trạng thái true rồi KHÔNG BAO GIỜ được nhả nếu process chết giữa lúc giao
// hàng — khách bị khoá khỏi cửa hàng key 30 ngày, không có đường tự phục hồi.
//
// Vì vậy cờ phải có TTL, và ca "có cờ mà không có mốc" PHẢI được hiểu là mồ côi.

const NOW = 1_800_000_000_000;

test("claim rồi thì cờ có hiệu lực, và claim ghi cả mốc thời gian", () => {
    const session = {};
    assert.equal(isApikeyProcessingActive(session, NOW), false, "session trắng thì không bận");

    claimApikeyProcessing(session, NOW);
    assert.equal(session.apikeyProcessing, true);
    assert.equal(session.apikeyProcessingAt, NOW, "phải ghi mốc, không thì TTL không có gì để so");
    assert.equal(isApikeyProcessingActive(session, NOW), true);
    assert.equal(isApikeyProcessingActive(session, NOW + 1_000), true, "vẫn còn trong TTL");
});

test("cờ quá TTL là mồ côi → nhả, khách không bị khoá vĩnh viễn", () => {
    const session = {};
    claimApikeyProcessing(session, NOW);

    assert.equal(isApikeyProcessingActive(session, NOW + APIKEY_PROCESSING_TTL_MS - 1), true);
    assert.equal(
        isApikeyProcessingActive(session, NOW + APIKEY_PROCESSING_TTL_MS),
        false,
        "đúng bằng TTL thì hết hiệu lực",
    );
    assert.equal(isApikeyProcessingActive(session, NOW + 30 * 24 * 3600_000), false, "30 ngày sau vẫn phải nhả");
});

test("cờ true mà KHÔNG có mốc (session bản cũ) → nhả, không phải bận", () => {
    // Đây là ca quan trọng nhất: mọi khách đang bị khoá cứng lúc deploy đều mang
    // session dạng này. Trả true ở đây là giữ nguyên bug thêm 30 ngày nữa.
    assert.equal(isApikeyProcessingActive({ apikeyProcessing: true }, NOW), false);
    assert.equal(isApikeyProcessingActive({ apikeyProcessing: true, apikeyProcessingAt: 0 }, NOW), false);
    assert.equal(isApikeyProcessingActive({ apikeyProcessing: true, apikeyProcessingAt: "abc" }, NOW), false);
    assert.equal(isApikeyProcessingActive({ apikeyProcessing: true, apikeyProcessingAt: null }, NOW), false);
    assert.equal(isApikeyProcessingActive({ apikeyProcessing: true, apikeyProcessingAt: -5 }, NOW), false);
});

test("release xoá cả cờ lẫn mốc", () => {
    const session = {};
    claimApikeyProcessing(session, NOW);
    releaseApikeyProcessing(session);

    assert.equal(session.apikeyProcessing, false);
    assert.equal(session.apikeyProcessingAt, 0, "mốc phải về 0 — để lại mốc cũ là ca claim kế tiếp đọc nhầm");
    assert.equal(isApikeyProcessingActive(session, NOW), false);
});

test("claim lại sau khi release thì hoạt động bình thường", () => {
    const session = {};
    claimApikeyProcessing(session, NOW);
    releaseApikeyProcessing(session);
    claimApikeyProcessing(session, NOW + 5_000);

    assert.equal(isApikeyProcessingActive(session, NOW + 5_000), true);
    assert.equal(session.apikeyProcessingAt, NOW + 5_000, "mốc phải được làm mới, không giữ mốc cũ");
});

test("session null/undefined không được ném lỗi", () => {
    // Telegraf có thể không có session (kênh, message không phải private). Handler
    // crash ở đây là crash cả luồng mua.
    assert.equal(isApikeyProcessingActive(null, NOW), false);
    assert.equal(isApikeyProcessingActive(undefined, NOW), false);
    assert.doesNotThrow(() => claimApikeyProcessing(null, NOW));
    assert.doesNotThrow(() => releaseApikeyProcessing(null));
    assert.doesNotThrow(() => releaseApikeyProcessing(undefined));
});

test("TTL hỏng (0/âm/NaN) thì không bao giờ coi là bận — fail open, không khoá khách", () => {
    const session = {};
    claimApikeyProcessing(session, NOW);

    assert.equal(isApikeyProcessingActive(session, NOW, 0), false);
    assert.equal(isApikeyProcessingActive(session, NOW, -1), false);
    assert.equal(isApikeyProcessingActive(session, NOW, NaN), false);
});

test("TTL mặc định phải dài hơn một lượt giao hàng thật nhưng ngắn hơn khoá 30 ngày", () => {
    // createApiKey timeout 30s + gửi tin retry tối đa ~90s. TTL ngắn hơn tổng đó thì
    // một lượt giao chậm bị coi là mồ côi và mở lại cửa cho bấm đúp.
    assert.ok(APIKEY_PROCESSING_TTL_MS > 30_000 + 90_000, "TTL phải phủ được một lượt giao hàng chậm");
    assert.ok(APIKEY_PROCESSING_TTL_MS < 24 * 3600_000, "TTL phải ngắn hơn nhiều lần 30 ngày");
});

test("bot.js dùng helper này cho MỌI handler mua/gia hạn key, không tự đọc cờ trần", async () => {
    // Chốt cấu trúc: bug gốc là cờ boolean trần rải ở 5 handler. Nếu một handler mới
    // đọc thẳng ctx.session.apikeyProcessing thì nó vừa không có TTL vừa lệch với
    // 4 handler kia.
    const { readFileSync } = await import("node:fs");
    const src = readFileSync(new URL("../src/bot.js", import.meta.url), "utf8");

    assert.equal(
        (src.match(/isApikeyBusy\(ctx\.session\)/g) || []).length,
        5,
        "5 handler (PAY/PAYQR/PAYCR/RNPAY/RNpay-later) phải gác bằng helper có TTL",
    );
    assert.equal((src.match(/claimApikeyProcessing\(ctx\.session\)/g) || []).length, 5);
    assert.equal((src.match(/releaseApikeyProcessing\(ctx\.session\)/g) || []).length, 5);

    assert.ok(
        !/if\s*\(\s*ctx\.session\.apikeyProcessing\s*\)/.test(src),
        "không handler nào được đọc cờ trần — cờ đó không có TTL",
    );
    assert.ok(
        !/ctx\.session\.apikeyProcessing\s*=/.test(src),
        "không chỗ nào được gán cờ trực tiếp — phải qua claim/release để mốc thời gian không bị bỏ sót",
    );
});
