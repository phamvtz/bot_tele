import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
    parseTpmAmount,
    formatTpm,
    DEFAULT_TPM_PRESETS,
    MIN_KEY_TPM,
    MAX_KEY_TPM,
} from "../src/apikey-pricing.js";
import {
    buildApiKeyTpmKeyboard,
    buildApiKeyDaysKeyboard,
} from "../src/bot-ui/keyboards.js";

const PID = 2;
const botSource = await readFile(new URL("../src/bot.js", import.meta.url), "utf8");
const registered = [...botSource.matchAll(/bot\.action\(\/(\^APIKEY_[^/]+)\/,/g)]
    .map((m) => new RegExp(m[1]));
const registeredLiterals = new Set(
    [...botSource.matchAll(/bot\.action\("([A-Z_]+)"/g)].map((m) => m[1]),
);

function isHandled(data) {
    if (registeredLiterals.has(data)) return true;
    return registered.some((re) => re.test(data));
}

function callbacksOf(keyboard) {
    return keyboard.reply_markup.inline_keyboard
        .flat()
        .map((b) => b.callback_data)
        .filter(Boolean);
}

test("parseTpmAmount nhận diện chính xác các định dạng TPM", () => {
    assert.deepEqual(parseTpmAmount("0"), { ok: true, tpm: 0 });
    assert.deepEqual(parseTpmAmount("mặc định"), { ok: true, tpm: 0 });
    assert.deepEqual(parseTpmAmount("default"), { ok: true, tpm: 0 });
    assert.deepEqual(parseTpmAmount("group"), { ok: true, tpm: 0 });
    assert.deepEqual(parseTpmAmount("60k"), { ok: true, tpm: 60_000 });
    assert.deepEqual(parseTpmAmount("150k"), { ok: true, tpm: 150_000 });
    assert.deepEqual(parseTpmAmount("300k"), { ok: true, tpm: 300_000 });
    assert.deepEqual(parseTpmAmount("600k"), { ok: true, tpm: 600_000 });
    assert.deepEqual(parseTpmAmount("1m"), { ok: true, tpm: 1_000_000 });
    assert.deepEqual(parseTpmAmount("1.5m"), { ok: true, tpm: 1_500_000 });
    assert.deepEqual(parseTpmAmount("1000000"), { ok: true, tpm: 1_000_000 });
    assert.deepEqual(parseTpmAmount("-10"), { ok: false, error: "INVALID" });
    assert.deepEqual(parseTpmAmount("200000000"), { ok: false, error: "MAX", min: MIN_KEY_TPM, max: MAX_KEY_TPM });
    assert.deepEqual(parseTpmAmount("abc"), { ok: false, error: "INVALID" });
});

test("formatTpm hiển thị nhãn đẹp cho các mốc", () => {
    assert.equal(formatTpm(0), "0 (Mặc định nhóm)");
    assert.equal(formatTpm(0, { lang: "en" }), "0 (Group default)");
    assert.equal(formatTpm(0, { lang: "zh" }), "0 (默认)");
    assert.equal(formatTpm(60_000), "60k");
    assert.equal(formatTpm(150_000), "150k");
    assert.equal(formatTpm(1_000_000), "1M");
});

test("bàn phím chọn TPM tạo đúng nút preset, custom và back", () => {
    const kb = buildApiKeyTpmKeyboard(PID, 5_000_000, 300, DEFAULT_TPM_PRESETS, { lang: "vi", defaultTpm: 0 });
    const datas = callbacksOf(kb);
    assert.ok(datas.includes(`APIKEY_TPM:${PID}:5000000:300:0`));
    assert.ok(datas.includes(`APIKEY_TPM:${PID}:5000000:300:60000`));
    assert.ok(datas.includes(`APIKEY_TPM:${PID}:5000000:300:300000`));
    assert.ok(datas.includes(`APIKEY_TPM:${PID}:5000000:300:1000000`));
    assert.ok(datas.includes(`APIKEY_TPM_CUSTOM:${PID}:5000000:300`));
    assert.ok(datas.includes(`APIKEY_BUY_TOK:${PID}:5000000`));

    for (const d of datas) {
        assert.ok(isHandled(d), `nút "${d}" ở bước TPM không có handler`);
        assert.ok(Buffer.byteLength(d) <= 64, `nút "${d}" vượt quá 64 byte`);
    }
});

test("bàn phím ngày mang TPM và nút back quay về TPM", () => {
    const kb = buildApiKeyDaysKeyboard(PID, 5_000_000, 300, 60_000, [1, 7, 30], { lang: "vi" });
    const datas = callbacksOf(kb);
    assert.ok(datas.includes(`APIKEY_DAYS:${PID}:5000000:300:60000:1`));
    assert.ok(datas.includes(`APIKEY_DAYS:${PID}:5000000:300:60000:7`));
    assert.ok(datas.includes(`APIKEY_DAYS:${PID}:5000000:300:60000:0`));
    assert.ok(datas.includes(`APIKEY_DAYS_CUSTOM:${PID}:5000000:300:60000`));
    assert.ok(datas.includes(`APIKEY_RPM:${PID}:5000000:300`));

    for (const d of datas) {
        assert.ok(isHandled(d), `nút "${d}" ở bước Ngày (có TPM) không có handler`);
        assert.ok(Buffer.byteLength(d) <= 64, `nút "${d}" vượt quá 64 byte`);
    }
});

test("APIKEY_PAY và APIKEY_PAYQR nhận đủ 5 tham số có TPM", () => {
    assert.ok(isHandled(`APIKEY_PAY:${PID}:5000000:300:60000:30`));
    assert.ok(isHandled(`APIKEY_PAY:${PID}:5000000:300:0:30`));
    assert.ok(isHandled(`APIKEY_PAYQR:${PID}:5000000:300:60000:30`));
    assert.ok(isHandled(`APIKEY_PAYQR:${PID}:5000000:300:0:30`));
    assert.ok(isHandled(`APIKEY_UP:${PID}:5000000:500:60000:30`));
    assert.ok(isHandled(`APIKEY_UP:${PID}:5000000:500:0:30`));
});

test("DEFAULT_KEY_TPM được đặt là 100 triệu TPM (100_000_000) và format đẹp", async () => {
    const { DEFAULT_KEY_TPM } = await import("../src/apikey-pricing.js");
    assert.equal(DEFAULT_KEY_TPM, 100_000_000);
    assert.equal(formatTpm(DEFAULT_KEY_TPM), "100M");
});

test("bot.js bỏ bước chọn TPM: APIKEY_RPM chuyển thẳng tới apikeyShowDays với 100M TPM", () => {
    // Kiểm tra handler APIKEY_RPM gọi apikeyShowDays với DEFAULT_KEY_TPM
    assert.ok(botSource.includes("await apikeyShowDays(ctx, pid, tokens, rpm, DEFAULT_KEY_TPM);"));
    // Tổng số bước được giảm xuống (multi ? 4 : 3)
    assert.ok(botSource.includes("const apikeyStep = (uiText, n, multi) => uiText.apikeyStepLabel(multi ? n + 1 : n, multi ? 4 : 3);"));
});
