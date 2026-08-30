import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
    buildApiKeyBuyKeyboard,
    buildApiKeyRpmKeyboard,
    buildApiKeyDaysKeyboard,
} from "../src/bot-ui/keyboards.js";
import {
    parseRpmAmount,
    parseDaysAmount,
    DEFAULT_RPM_PRESETS,
    DEFAULT_DAYS_PRESETS,
    MIN_KEY_RPM,
    MAX_KEY_RPM,
    MAX_KEY_DAYS,
    MIN_BUY_TOKENS,
    MAX_BUY_TOKENS,
} from "../src/apikey-pricing.js";

// Luồng mua key có 3 bước, mỗi bước là MỘT tin nhắn riêng nên trạng thái đi trong
// callback data chứ không trong session (session mất khi bot restart). Nghĩa là
// keyboard và regex `bot.action` phải khớp nhau tuyệt đối — lệch một dấu hai chấm
// là nút chết im lặng, khách bấm không có gì xảy ra. Test này đọc chính source
// bot.js để so, nên đổi format một bên mà quên bên kia là fail ngay.
const botSource = await readFile(new URL("../src/bot.js", import.meta.url), "utf8");

// Rút mọi regex đã đăng ký qua bot.action(/.../) để so với callback data thật.
const registered = [...botSource.matchAll(/bot\.action\(\/(\^APIKEY_[^/]+)\/,/g)]
    .map((m) => new RegExp(m[1]));
// Cả nút cố định dạng chuỗi (APIKEY_BUY, APIKEY_BUY_CUSTOM…) cũng là handler hợp lệ.
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

test("bot.js thật sự đăng ký handler cho 4 callback mới của luồng RPM/ngày", () => {
    // Nếu regex bị xoá/đổi tên thì mấy assert dưới vô nghĩa — chốt trước.
    assert.ok(registered.length >= 4, `chỉ tìm thấy ${registered.length} regex APIKEY_*`);
    for (const sample of [
        "APIKEY_BUY_TOK:5000000",
        "APIKEY_RPM:5000000:300",
        "APIKEY_RPM_CUSTOM:5000000",
        "APIKEY_DAYS:5000000:300:30",
        "APIKEY_DAYS_CUSTOM:5000000:300",
        "APIKEY_PAY:5000000:300:30",
    ]) {
        assert.ok(isHandled(sample), `không handler nào nhận "${sample}"`);
    }
});

test("mọi nút ở bước chọn RPM đều có handler", () => {
    const kb = buildApiKeyRpmKeyboard(5_000_000, DEFAULT_RPM_PRESETS, { lang: "vi", defaultRpm: 300 });
    const datas = callbacksOf(kb);
    assert.ok(datas.length >= DEFAULT_RPM_PRESETS.length + 1);
    for (const d of datas) {
        assert.ok(isHandled(d), `nút "${d}" ở bước RPM không có handler`);
    }
});

test("mọi nút ở bước chọn số ngày đều có handler, kể cả 'không hết hạn'", () => {
    const kb = buildApiKeyDaysKeyboard(5_000_000, 300, DEFAULT_DAYS_PRESETS, { lang: "vi" });
    const datas = callbacksOf(kb);
    for (const d of datas) {
        assert.ok(isHandled(d), `nút "${d}" ở bước ngày không có handler`);
    }
    // days=0 là lựa chọn hợp lệ (chỉ hết khi cạn quota) — phải có nút riêng.
    assert.ok(datas.includes("APIKEY_DAYS:5000000:300:0"), "thiếu nút không hết hạn");
});

test("nút quay lại của bước 3 trở về đúng bước 2, không nhảy về đầu", () => {
    const datas = callbacksOf(buildApiKeyDaysKeyboard(7_000_000, 600, DEFAULT_DAYS_PRESETS, { lang: "vi" }));
    assert.ok(
        datas.includes("APIKEY_BUY_TOK:7000000"),
        "bước ngày phải quay về bước RPM của cùng lượng token",
    );
});

test("bước 1 (chọn gói token) dẫn sang bước RPM chứ không sang xác nhận", () => {
    const datas = callbacksOf(buildApiKeyBuyKeyboard([1, 5, 10], () => "$0.05", { lang: "vi" }));
    const tokenBtns = datas.filter((d) => d.startsWith("APIKEY_BUY_TOK:"));
    assert.ok(tokenBtns.length >= 3, "thiếu nút gói token");
    // APIKEY_BUY_TOK phải là handler đi tới apikeyShowRpm — kiểm qua source.
    const handler = botSource.match(/bot\.action\(\/\^APIKEY_BUY_TOK[\s\S]{0,600}?\n {4}\}\);/);
    assert.ok(handler, "không tìm thấy handler APIKEY_BUY_TOK");
    assert.match(handler[0], /apikeyShowRpm/, "chọn token xong phải sang bước chọn RPM");
});

test("callback data chỉ chứa số nguyên — regex \\d+ không nhận số thập phân", () => {
    // Nếu preset lẻ (vd 0.5 ngày) lọt vào keyboard thì nút sẽ chết vì regex là \d+.
    for (const d of callbacksOf(buildApiKeyRpmKeyboard(5_000_000, DEFAULT_RPM_PRESETS, { lang: "vi" }))) {
        const nums = d.split(":").slice(1);
        for (const n of nums) assert.match(n, /^\d+$/, `"${d}" chứa phần không phải số nguyên`);
    }
    for (const d of callbacksOf(buildApiKeyDaysKeyboard(5_000_000, 300, DEFAULT_DAYS_PRESETS, { lang: "vi" }))) {
        const nums = d.split(":").slice(1);
        for (const n of nums) assert.match(n, /^\d+$/, `"${d}" chứa phần không phải số nguyên`);
    }
});

test("preset mặc định nằm trong miền hợp lệ mà handler chấp nhận", () => {
    for (const rpm of DEFAULT_RPM_PRESETS) {
        assert.ok(rpm >= MIN_KEY_RPM && rpm <= MAX_KEY_RPM, `RPM preset ${rpm} ngoài miền`);
    }
    for (const d of DEFAULT_DAYS_PRESETS) {
        assert.ok(d >= 1 && d <= MAX_KEY_DAYS, `preset ${d} ngày ngoài miền`);
    }
});

test("số khách tự nhập đi qua parser rồi vẫn ghép được callback hợp lệ", () => {
    // Luồng tự nhập: parser → callback data → regex. Cả ba phải cùng miền số.
    const rpm = parseRpmAmount("1.200");
    assert.equal(rpm.ok, true);
    assert.ok(isHandled(`APIKEY_DAYS_CUSTOM:5000000:${rpm.rpm}`), "RPM tự nhập không ghép được callback bước 3");

    const days = parseDaysAmount("vĩnh viễn");
    assert.equal(days.ok, true);
    assert.equal(days.days, 0);
    assert.ok(isHandled(`APIKEY_PAY:5000000:${rpm.rpm}:${days.days}`), "days=0 phải qua được APIKEY_PAY");
});

test("APIKEY_PAY ghi lựa chọn của khách lên order chứ không dùng cfg", () => {
    // Đơn phải mang tokens/rpm/validDays để deliverApiKey đọc lại sau restart —
    // bản cũ đọc cfg nên khách chọn gì cũng ra RPM mặc định của shop.
    const pay = botSource.match(/bot\.action\(\/\^APIKEY_PAY[\s\S]*?apikeyValidDays: validDays/);
    assert.ok(pay, "APIKEY_PAY không ghi apikeyValidDays lên order");
    assert.match(pay[0], /apikeyTokens: tokens/);
    assert.match(pay[0], /apikeyRpm: rpm/);
    // validDays = 0 hợp lệ → không được chặn bằng `< MIN_KEY_DAYS`.
    assert.match(pay[0], /validDays < 0/, "APIKEY_PAY phải cho phép validDays = 0");
});

test("miền token dùng chung cho cả ba bước", () => {
    // Ba handler đều tự validate lại tokens; nếu ai đó nới miền ở một chỗ thôi thì
    // khách sẽ kẹt ở bước sau. Chốt rằng cả ba dùng đúng hằng số này.
    const uses = [...botSource.matchAll(/tokens < MIN_BUY_TOKENS \|\| tokens > MAX_BUY_TOKENS/g)];
    assert.ok(uses.length >= 4, `chỉ ${uses.length} chỗ validate miền token, cần ≥ 4`);
    assert.ok(MIN_BUY_TOKENS < MAX_BUY_TOKENS);
});
