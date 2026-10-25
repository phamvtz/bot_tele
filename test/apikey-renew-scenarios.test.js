import test from "node:test";
import assert from "node:assert/strict";

import { priceUsdForKey, keyPriceFactors } from "../src/apikey-pricing.js";
import {
    keyLifecycle,
    renewBlockReason,
    renewDayBasis,
    renewPriceBreakdown,
    priceAddTokens,
    priceAddDays,
} from "../src/apikey-renew.js";

// Ma trận trạng thái key × hành động gia hạn. Hai lỗi đã sửa ở đây:
//  1. Hồi sinh key ĐÃ CHẾT từng đắt hơn mua mới tới 88% vì giá ngày tính trên hạn mức
//     cũ đã dùng hết → giờ key hết hạn tính ngày trên token CÒN LẠI.
//  2. Không ai kiểm tra key bị admin tắt/khoá: khách trả tiền gia hạn một key đã thu
//     hồi và key vẫn không dùng được (gia hạn không bật lại key).

const M = 1_000_000;
const RATE = 0.01;
const NOW = Date.UTC(2026, 9, 24, 0, 0, 0);
const DAY = 86_400_000;
const f = (o) => keyPriceFactors(o, {});
const buy = (m, rpm, d) => priceUsdForKey({ tokens: m * M, rpm, validDays: d }, RATE);
const near = (a, b, cents = 1) => Math.abs(a - b) <= cents / 100 + 1e-9;

// Dựng trạng thái key. limitM = hạn mức, usedM = đã dùng, expInDays: null = không hết hạn.
function keyState({ limitM = 100, usedM = 0, expInDays = 20, enabled = true, lockReason = "" } = {}) {
    const status = {
        quotaLimit: limitM * M, quotaUsed: usedM * M, enabled, lockReason,
        expiresAt: expInDays === null ? null : new Date(NOW + expInDays * DAY).toISOString(),
    };
    const life = keyLifecycle(status, NOW);
    const daysLeft = expInDays === null ? null : Math.max(0, Math.ceil(expInDays));
    const remaining = life.unlimitedQuota ? 0 : Math.max(0, limitM - usedM);
    return { status, life, daysLeft, remaining, keyTokens: limitM * M };
}

function breakdown(k, { addM = 0, days = 0, rpm = 100, newRpm = 0 } = {}) {
    const basis = renewDayBasis({ life: k.life, keyTokens: k.keyTokens, remainingTokens: k.remaining * M });
    const bd = renewPriceBreakdown({
        addTokens: addM * M, addDays: days, keyTokens: basis.tokens, usdPerMtoken: RATE, rpm, factors: f,
        daysLeft: k.daysLeft, newRpm, remainingTokens: k.remaining * M,
    });
    bd.dayBasisRemaining = basis.remaining; // bot.js gắn cờ này sau khi tính, để chữ giải thích đổi nhãn
    return bd;
}

const reason = (k, over = {}) => renewBlockReason({
    status: k.status, life: k.life, addTokens: 0, days: 0, newRpm: 0, curRpm: 100, maxRpm: 3000, maxTokens: 0, ...over,
});

// ─── renewDayBasis ────────────────────────────────────────────────────────────

test("renewDayBasis: key còn hạn tính trên HẠN MỨC; key hết hạn tính trên token CÒN LẠI", () => {
    const alive = keyState({ usedM: 40, expInDays: 20 });
    assert.deepEqual(renewDayBasis({ life: alive.life, keyTokens: 100 * M, remainingTokens: 60 * M }), { tokens: 100 * M, remaining: false });
    const expired = keyState({ usedM: 40, expInDays: -3 });
    assert.deepEqual(renewDayBasis({ life: expired.life, keyTokens: 100 * M, remainingTokens: 60 * M }), { tokens: 60 * M, remaining: true });
});

test("renewDayBasis: quota vô hạn không có 'token còn lại' → giữ hạn mức đã lưu", () => {
    const unlimited = keyState({ limitM: 0, expInDays: -1 });
    assert.equal(unlimited.life.unlimitedQuota, true);
    assert.deepEqual(renewDayBasis({ life: unlimited.life, keyTokens: 50 * M, remainingTokens: 0 }), { tokens: 50 * M, remaining: false });
});

// ─── Các trạng thái của key ───────────────────────────────────────────────────

test("A. còn hạn + còn token: giá gia hạn ngày giữ NGUYÊN (tính trên hạn mức) — không mất doanh thu", () => {
    const k = keyState({ usedM: 40, expInDays: 20 });
    const days = breakdown(k, { days: 30 });
    assert.equal(days.total, 6.0, "100M × 0.01 × 20% × 30 ngày");
    assert.equal(days.dayBasisRemaining, false);
    assert.equal(reason(k, { days: 30 }), null);
    assert.equal(reason(k, { addTokens: 100 * M }), null);
    assert.equal(reason(k, { newRpm: 500 }), null);
});

test("B. hết hạn + còn 60M token: ngày tính trên 60M (không trả cho 40M đã dùng)", () => {
    const k = keyState({ usedM: 40, expInDays: -3 });
    const days = breakdown(k, { days: 30 });
    assert.equal(days.total, 3.6, "60M × 0.01 × 20% × 30 ngày");
    assert.equal(days.dayBasisRemaining, true);
    assert.equal(reason(k, { days: 30 }), null, "gia hạn ngày một mình là hợp lệ — nó làm key sống lại");
    assert.equal(reason(k, { addTokens: 100 * M }), "expired_no_days");
    assert.equal(reason(k, { newRpm: 500 }), "expired_no_days");
});

test("C. còn hạn + CẠN token: nạp token được, thêm ngày một mình bị chặn", () => {
    const k = keyState({ usedM: 100, expInDays: 20 });
    assert.equal(k.life.exhausted, true);
    assert.equal(reason(k, { addTokens: 100 * M }), null);
    assert.equal(reason(k, { days: 30 }), "exhausted_days_only");
    assert.equal(priceAddTokens(100 * M, { usdPerMtoken: RATE, rpm: 100, factors: f, daysLeft: 20 }), 4.8);
});

test("D. CHẾT HẲN: hồi sinh 100M + 30 ngày bằng ĐÚNG giá mua key mới (trước đây đắt hơn 88%)", () => {
    const k = keyState({ usedM: 100, expInDays: -10 });
    assert.equal(k.life.exhausted, true);
    assert.equal(k.life.expired, true);
    const bundle = breakdown(k, { addM: 100, days: 30 });
    assert.equal(bundle.dayTotal, 0, "không còn token cũ nên không có gì để tính tiền ngày");
    assert.equal(bundle.total, buy(100, 100, 30));
    assert.equal(bundle.total, 6.8);
    assert.equal(reason(k, { addTokens: 100 * M, days: 30 }), null, "gói gộp là lối duy nhất và phải đi được");
});

test("D. hồi sinh gói lớn 500M/90 ngày cũng bằng mua mới", () => {
    const k = keyState({ usedM: 100, expInDays: -10 });
    assert.equal(breakdown(k, { addM: 500, days: 90 }).total, buy(500, 100, 90));
});

test("D. chết hẳn mà chỉ chọn riêng ngày / token / RPM thì đều bị chặn với lý do rõ", () => {
    const k = keyState({ usedM: 100, expInDays: -10 });
    assert.equal(reason(k, { days: 30 }), "exhausted_days_only");
    assert.equal(reason(k, { addTokens: 100 * M }), "expired_no_days");
    assert.equal(reason(k, { newRpm: 500 }), "expired_no_days");
});

test("hồi sinh key hết hạn còn token: gói gộp = giá mua mới trừ phần token cũ còn lại tính theo ngày", () => {
    const k = keyState({ usedM: 40, expInDays: -3 });
    const bundle = breakdown(k, { addM: 100, days: 30 });
    assert.equal(bundle.tokenTotal, priceAddTokens(100 * M, { usdPerMtoken: RATE, rpm: 100, factors: f, daysLeft: 30 }));
    assert.equal(bundle.dayTotal, priceAddDays(30, { keyTokens: 60 * M, usdPerMtoken: RATE, rpm: 100, factors: f }));
    assert.equal(bundle.dayTotal, 3.6);
});

test("E. quota vô hạn, còn hạn: không nâng RPM, vẫn thêm ngày", () => {
    const k = keyState({ limitM: 0, expInDays: 20 });
    assert.equal(reason(k, { newRpm: 500 }), "rpm_unlimited");
    assert.equal(reason(k, { days: 30 }), null);
});

test("F. không hết hạn, hữu hạn quota: nạp token ×1.5, không có hạn để cộng ngày", () => {
    const k = keyState({ usedM: 30, expInDays: null });
    assert.equal(k.daysLeft, null);
    assert.equal(priceAddTokens(100 * M, { usdPerMtoken: RATE, rpm: 100, factors: f, daysLeft: null }), 1.5);
    assert.equal(reason(k, { addTokens: 100 * M }), null);
});

// ─── Chốt chặn chung ──────────────────────────────────────────────────────────

test("key bị admin TẮT hoặc KHOÁ: chặn mọi gia hạn (gia hạn không bật lại key)", () => {
    const disabled = keyState({ enabled: false });
    for (const over of [{ addTokens: 50 * M }, { days: 30 }, { newRpm: 500 }, { addTokens: 50 * M, days: 30 }]) {
        assert.equal(reason(disabled, over), "disabled");
    }
    const locked = keyState({ lockReason: "abuse" });
    assert.equal(reason(locked, { days: 30 }), "locked");
    assert.equal(reason(keyState({ enabled: false, lockReason: "x" }), { days: 1 }), "disabled", "tắt đứng trước khoá");
});

test("lockedAt cũng được coi là khoá dù lockReason rỗng", () => {
    const k = keyState();
    k.status.lockedAt = "2026-10-01T00:00:00Z";
    assert.equal(reason(k, { days: 30 }), "locked");
});

test("RPM: chỉ nâng, trong trần; bằng/thấp hơn hoặc vượt trần đều chặn với lý do riêng", () => {
    const k = keyState({ usedM: 10 });
    assert.equal(reason(k, { newRpm: 100 }), "rpm_not_higher");
    assert.equal(reason(k, { newRpm: 50 }), "rpm_not_higher");
    assert.equal(reason(k, { newRpm: 3001 }), "rpm_over_max");
    assert.equal(reason(k, { newRpm: 500 }), null);
});

test("trần token mỗi lần nạp", () => {
    const k = keyState();
    assert.equal(reason(k, { addTokens: 600 * M, maxTokens: 500 * M }), "tokens_over_max");
    assert.equal(reason(k, { addTokens: 500 * M, maxTokens: 500 * M }), null);
    assert.equal(reason(k, { addTokens: 5000 * M, maxTokens: 0 }), null, "0 = không giới hạn");
});

test("không chọn gì → nothing", () => {
    assert.equal(reason(keyState()), "nothing");
});

test("thứ tự ưu tiên: tắt/khoá thắng mọi lý do khác", () => {
    const k = keyState({ usedM: 100, expInDays: -5, enabled: false });
    assert.equal(reason(k, { days: 30 }), "disabled");
});

// ─── Nhất quán giá ────────────────────────────────────────────────────────────

test("gia hạn key CÒN HẠN không đổi so với trước: ngày vẫn tính trên hạn mức, token theo ngày còn lại", () => {
    const k = keyState({ usedM: 90, expInDays: 10 });
    assert.equal(breakdown(k, { days: 30 }).total, 6.0, "dù chỉ còn 10M token, key còn hạn vẫn tính trên 100M");
    assert.equal(breakdown(k, { addM: 100 }).total, priceAddTokens(100 * M, { usdPerMtoken: RATE, rpm: 100, factors: f, daysLeft: 10 }));
});

test("không có kẽ hở mới: gia hạn ngày rẻ lúc key hết hạn rồi nạp token vẫn trả đủ theo ngày còn lại", () => {
    // Key 100M, dùng gần hết, để hết hạn; gia hạn 365 ngày (rẻ vì còn ~0 token), rồi nạp 100M.
    const k = keyState({ usedM: 100, expInDays: -1 });
    const extend = breakdown({ ...k, remaining: 0 }, { days: 365 }).dayTotal; // = 0 (không còn token)
    const topUp = priceAddTokens(100 * M, { usdPerMtoken: RATE, rpm: 100, factors: f, daysLeft: 365 });
    assert.ok(near(extend + topUp, buy(100, 100, 366), 400), `${extend + topUp} phải ≈ mua thẳng 100M/366 ngày ${buy(100, 100, 366)}`);
    assert.equal(topUp, 73.8, "nạp ở mốc còn 365 ngày phải trả đủ phụ phí 364 ngày: 100M × 0.01 × (1 + 364 × 20%)");
});

// ─── Nút gia hạn ngày + nâng RPM (key đã hết hạn) ─────────────────────────────

import { readFileSync } from "node:fs";
import { buildApiKeyRenewKeyboard } from "../src/bot-ui/keyboards.js";

test("nút APIKEY_RNX có handler, ≤ 64 byte và nằm đầu bàn phím", () => {
    const src = readFileSync(new URL("../src/bot.js", import.meta.url), "utf8");
    const registered = [...src.matchAll(/bot\.action\(\/(\^APIKEY_RN[^/]+)\/i?,/g)].map((m) => new RegExp(m[1]));
    const kb = buildApiKeyRenewKeyboard("6adc54a784ceeca8c293e146", {
        comboOpts: [{ d: 30, r: 500, label: "combo" }], dayOpts: [{ v: 7, label: "d" }],
    });
    const datas = kb.reply_markup.inline_keyboard.flat().map((b) => b.callback_data);
    assert.equal(datas[0], "APIKEY_RNX:6adc54a784ceeca8c293e146:30:500");
    for (const d of datas.filter((x) => x.startsWith("APIKEY_RN"))) {
        assert.ok(registered.some((re) => re.test(d)), `nút "${d}" không có handler`);
        assert.ok(Buffer.byteLength(d) <= 64);
    }
});
