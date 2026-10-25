import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { priceUsdForKey, keyPriceFactors } from "../src/apikey-pricing.js";
import {
    computeRenewal,
    priceUpgradeRpm,
    priceAddTokens,
    priceAddDays,
    renewPriceBreakdown,
    renewability,
} from "../src/apikey-renew.js";
import { buildApiKeyRenewKeyboard } from "../src/bot-ui/keyboards.js";

// Gia hạn từng KHÔNG có "nâng RPM": RPM cố định suốt đời key, khách cần RPM cao hơn
// phải mua key mới. Bất biến cần giữ: tổng tiền KHÔNG phụ thuộc thứ tự mua — mua thẳng
// RPM cao phải ra bằng mua RPM thấp rồi nâng.

const M = 1_000_000;
const RATE = 0.01;
const f = (o) => keyPriceFactors(o, {});
const near = (a, b, cents = 2) => Math.abs(a - b) <= cents / 100 + 1e-9;
const buy = (m, rpm, d) => priceUsdForKey({ tokens: m * M, rpm, validDays: d }, RATE);
const upgrade = (remM, from, to, daysLeft) => priceUpgradeRpm({
    remainingTokens: remM * M, usdPerMtoken: RATE, fromRpm: from, toRpm: to, factors: f, daysLeft,
});

test("computeRenewal: chỉ NÂNG RPM — hạ hoặc đặt lại đúng số cũ không tạo PATCH", () => {
    assert.deepEqual(computeRenewal({ current: { rpm: 100 }, newRpm: 500 }), { rpm: 500 });
    assert.equal(computeRenewal({ current: { rpm: 500 }, newRpm: 500 }), null);
    assert.equal(computeRenewal({ current: { rpm: 500 }, newRpm: 200 }), null);
    assert.equal(computeRenewal({ current: { rpm: 100 }, newRpm: 0 }), null);
    // RPM 0 trên provider = theo mức tài khoản → mọi số dương đều là nâng
    assert.deepEqual(computeRenewal({ current: { rpm: 0 }, newRpm: 300 }), { rpm: 300 });
});

test("computeRenewal: RPM đi chung PATCH với token và ngày", () => {
    const now = Date.UTC(2026, 0, 1);
    const patch = computeRenewal({
        current: { quotaLimit: 100, expiresAt: new Date(now + 86_400_000).toISOString(), rpm: 100 },
        addTokens: 1000, addDays: 7, newRpm: 500, now,
    });
    assert.equal(patch.rpm, 500);
    assert.ok(patch.quota_limit > 100);
    assert.ok(patch.expires_at);
});

test("renewability: nâng RPM mở cả với key vô hạn quota / không hết hạn", () => {
    assert.equal(renewability({ quotaLimit: 0, expiresAt: null }).canUpgradeRpm, true);
});

test("priceUpgradeRpm: bằng 0 khi không có gì để trả (nâng xuống/bằng, hết token, thiếu hàm tính)", () => {
    assert.equal(upgrade(100, 500, 500, 30), 0);
    assert.equal(upgrade(100, 500, 200, 30), 0);
    assert.equal(upgrade(0, 100, 500, 30), 0, "không còn token thì không có gì để nâng tốc độ");
    assert.equal(priceUpgradeRpm({ remainingTokens: 100 * M, usdPerMtoken: RATE, fromRpm: 100, toRpm: 500 }), 0);
});

test("BẤT BIẾN: mua key RPM thấp rồi nâng ngay = mua thẳng RPM cao (cùng thời hạn)", () => {
    for (const d of [1, 2, 7, 30, 90]) {
        for (const [from, to] of [[100, 500], [100, 3000], [300, 1000]]) {
            const direct = buy(100, to, d);
            const path = buy(100, from, d) + upgrade(100, from, to, d);
            assert.ok(near(path, direct), `${from}→${to}, ${d} ngày: đường nâng ${path} ≠ mua thẳng ${direct}`);
        }
    }
});

test("khớp ví dụ đã báo khách: 100M, RPM 100→500, còn 30 ngày = $6.80 + $8.16 = $14.96", () => {
    assert.equal(buy(100, 100, 30), 6.8);
    assert.equal(upgrade(100, 100, 500, 30), 8.16);
    assert.equal(buy(100, 500, 30), 14.96);
});

test("chỉ tính trên token CÒN LẠI: dùng 90% thì chỉ trả 10% phần chênh", () => {
    const full = upgrade(100, 100, 500, 30);
    const tenth = upgrade(10, 100, 500, 30);
    assert.ok(near(tenth * 10, full, 10), `${tenth} × 10 phải ≈ ${full}`);
});

test("không có kẽ hở: dùng cạn token rồi nâng RPM (gần như miễn phí) và nạp lại — tổng vẫn khớp mua thẳng", () => {
    // Mua 100M RPM100/30d, dùng hết, nâng RPM khi còn 0 token, nạp 100M ở RPM mới.
    const path = buy(100, 100, 30) + upgrade(0, 100, 500, 30)
        + priceAddTokens(100 * M, { usdPerMtoken: RATE, rpm: 500, factors: f, daysLeft: 30 });
    // Đường này tiêu 100M ở RPM thấp rồi 100M ở RPM cao: bằng đúng giá hai key tương ứng.
    assert.ok(near(path, buy(100, 100, 30) + buy(100, 500, 30)));
});

test("nâng RPM rồi nạp token: token mới tính theo RPM MỚI", () => {
    const bd = renewPriceBreakdown({
        addTokens: 100 * M, keyTokens: 100 * M, usdPerMtoken: RATE, rpm: 100, factors: f,
        daysLeft: 30, newRpm: 500, remainingTokens: 100 * M,
    });
    assert.equal(bd.mode, "bundle");
    assert.equal(bd.rpmFrom, 100);
    assert.equal(bd.rpmTo, 500);
    assert.equal(bd.tokenTotal, priceAddTokens(100 * M, { usdPerMtoken: RATE, rpm: 500, factors: f, daysLeft: 30 }));
    assert.equal(bd.rpmUpgradeTotal, upgrade(100, 100, 500, 30));
    assert.ok(near(bd.total, bd.tokenTotal + bd.rpmUpgradeTotal + bd.dayTotal, 0));
});

test("renewPriceBreakdown mode rpm: tổng = phần nâng, kèm đủ trường để giải thích cho khách", () => {
    const bd = renewPriceBreakdown({
        keyTokens: 100 * M, usdPerMtoken: RATE, rpm: 100, factors: f, daysLeft: 30,
        newRpm: 500, remainingTokens: 100 * M,
    });
    assert.equal(bd.mode, "rpm");
    assert.equal(bd.upgradeRpm, true);
    assert.equal(bd.total, bd.rpmUpgradeTotal);
    assert.equal(bd.total, 8.16);
    assert.equal(bd.timeDays, 30);
    assert.ok(Math.abs(bd.rpmTimeMult - 6.8) < 1e-9);
    assert.ok(bd.rpmMult > bd.rpmFromMult);
});

test("mode gộp + nâng RPM: token và ngày đều theo RPM mới, thời hạn token = còn + ngày mua thêm", () => {
    const bd = renewPriceBreakdown({
        addTokens: 100 * M, addDays: 29, keyTokens: 100 * M, usdPerMtoken: RATE, rpm: 100, factors: f,
        daysLeft: 1, newRpm: 500, remainingTokens: 50 * M,
    });
    assert.equal(bd.mode, "bundle");
    assert.equal(bd.timeDays, 30);
    assert.equal(bd.dayTotal, priceAddDays(29, { keyTokens: 100 * M, usdPerMtoken: RATE, rpm: 500, factors: f }));
    assert.equal(bd.rpmUpgradeTotal, upgrade(50, 100, 500, 30));
});

test("không nâng (newRpm ≤ hiện tại) thì breakdown y như cũ — không đổi giá các đường cũ", () => {
    const withNo = renewPriceBreakdown({ addTokens: 100 * M, keyTokens: 100 * M, usdPerMtoken: RATE, rpm: 300, factors: f, daysLeft: 30 });
    const withLower = renewPriceBreakdown({ addTokens: 100 * M, keyTokens: 100 * M, usdPerMtoken: RATE, rpm: 300, factors: f, daysLeft: 30, newRpm: 200, remainingTokens: 50 * M });
    assert.equal(withNo.upgradeRpm, false);
    assert.equal(withLower.upgradeRpm, false);
    assert.equal(withNo.total, withLower.total);
    assert.equal(withNo.mode, "tokens");
});

// ─── Bàn phím ↔ handler: nút chết im lặng là lỗi hay gặp nhất ────────────────

const botSource = readFileSync(new URL("../src/bot.js", import.meta.url), "utf8");
const registered = [...botSource.matchAll(/bot\.action\(\/(\^APIKEY_RN[^/]+)\/i?,/g)].map((m) => new RegExp(m[1]));
const callbacksOf = (kb) => kb.reply_markup.inline_keyboard.flat().map((b) => b.callback_data).filter(Boolean);

test("mọi nút của màn gia hạn (kể cả nâng RPM, hồi sinh, nhập tay) đều có handler và ≤ 64 byte", () => {
    const kb = buildApiKeyRenewKeyboard("6adc54a784ceeca8c293e146", {
        lang: "vi",
        tokenOpts: [{ v: 100, label: "t" }],
        dayOpts: [{ v: 30, label: "d" }],
        rpmOpts: [{ v: 500, label: "r" }],
        bundleOpts: [{ m: 500, d: 90, label: "b" }],
        customTokens: true, customDays: true, customRpm: true,
    });
    const datas = callbacksOf(kb);
    for (const prefix of ["APIKEY_RNT:", "APIKEY_RND:", "APIKEY_RNR:", "APIKEY_RNB:", "APIKEY_RNTC:", "APIKEY_RNDC:", "APIKEY_RNRC:"]) {
        assert.ok(datas.some((d) => d.startsWith(prefix)), `thiếu nút ${prefix}`);
    }
    for (const d of datas.filter((x) => x.startsWith("APIKEY_RN"))) {
        assert.ok(registered.some((re) => re.test(d)), `nút "${d}" không có handler`);
        assert.ok(Buffer.byteLength(d) <= 64, `nút "${d}" vượt 64 byte`);
    }
});

test("callback thanh toán gia hạn nhận 3 tham số (đời cũ) lẫn 4 tham số (có RPM)", () => {
    for (const d of [
        "APIKEY_RNPAY:6adc54a784ceeca8c293e146:100:0",
        "APIKEY_RNPAY:6adc54a784ceeca8c293e146:0:0:500",
        "APIKEY_RNQR:6adc54a784ceeca8c293e146:100:30",
        "APIKEY_RNQR:6adc54a784ceeca8c293e146:100:30:1000",
    ]) {
        assert.ok(registered.some((re) => re.test(d)), `không handler nào nhận "${d}"`);
        assert.ok(Buffer.byteLength(d) <= 64, `"${d}" vượt 64 byte`);
    }
});

test("bàn phím không nút tùy ý thì không sinh nút nhập tay", () => {
    const datas = callbacksOf(buildApiKeyRenewKeyboard("k1", { tokenOpts: [{ v: 50, label: "t" }] }));
    assert.ok(!datas.some((d) => /^APIKEY_RN[TDR]C:/.test(d)));
    assert.ok(!datas.some((d) => d.startsWith("APIKEY_RNB:") || d.startsWith("APIKEY_RNR:")));
});

test("bot.js chặn đúng: key hết hạn không bán nạp token/nâng RPM đơn lẻ, và chỉ nâng trong trần", () => {
    assert.match(botSource, /life\.expired && days === 0 && \(addTokens > 0 \|\| newRpm > 0\)/);
    assert.match(botSource, /newRpm <= curRpm \|\| newRpm > MAX_KEY_RPM/);
    assert.match(botSource, /apikeyNewRpm: newRpm/);
});
