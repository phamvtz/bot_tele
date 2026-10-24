import test from "node:test";
import assert from "node:assert/strict";

import { priceUsdForKey, keyPriceFactors } from "../src/apikey-pricing.js";
import {
    priceAddTokens,
    priceAddDays,
    remainingDaysForPricing,
    topUpTimeMult,
    renewPriceBreakdown,
} from "../src/apikey-renew.js";

// Kẽ hở đã sửa: giá nạp token từng KHÔNG xét số ngày còn lại của key. Mua key nhỏ →
// gia hạn một năm (rẻ vì key còn nhỏ) → nạp 999M token (không phụ phí) ra ~$10.73 trong
// khi mua thẳng cùng món là $740 — rẻ hơn ~70 lần chỉ bằng cách đổi thứ tự mua.
// Bất biến cần giữ: TỔNG TIỀN KHÔNG PHỤ THUỘC THỨ TỰ MUA.

const M = 1_000_000;
const USD_PER_M = 0.01;
const factors = (o) => keyPriceFactors(o, {});
const DAY = 86_400_000;
const near = (a, b, cents = 2) => Math.abs(a - b) <= cents / 100 + 1e-9;

const tokens = (n, daysLeft) => priceAddTokens(n * M, { usdPerMtoken: USD_PER_M, rpm: 100, factors, daysLeft });
const days = (n, keyM) => priceAddDays(n, { keyTokens: keyM * M, usdPerMtoken: USD_PER_M, rpm: 100, factors });
const buy = (m, d) => priceUsdForKey({ tokens: m * M, rpm: 100, validDays: d }, USD_PER_M);

test("remainingDaysForPricing: null khi không hết hạn, làm tròn LÊN, 0 khi đã quá hạn", () => {
    const now = Date.UTC(2026, 0, 10, 12, 0, 0);
    assert.equal(remainingDaysForPricing({ expiresAt: null }, now), null);
    assert.equal(remainingDaysForPricing({}, now), null);
    assert.equal(remainingDaysForPricing({ expiresAt: "not-a-date" }, now), null);
    assert.equal(remainingDaysForPricing({ expiresAt: new Date(now + 1.2 * DAY).toISOString() }, now), 2);
    assert.equal(remainingDaysForPricing({ expiresAt: new Date(now + 30 * DAY).toISOString() }, now), 30);
    assert.equal(remainingDaysForPricing({ expiresAt: new Date(now - 5 * DAY).toISOString() }, now), 0);
});

test("topUpTimeMult: undefined = không xét (×1), null = ×noExpiry, số ngày theo luật mua mới", () => {
    assert.equal(topUpTimeMult(undefined, { rpm: 100, factors }), 1);
    assert.equal(topUpTimeMult(null, { rpm: 100, factors }), 1.5);
    assert.equal(topUpTimeMult(0, { rpm: 100, factors }), 1);   // đã quá hạn
    assert.equal(topUpTimeMult(1, { rpm: 100, factors }), 1);   // ngày đầu miễn phụ phí
    assert.equal(topUpTimeMult(2, { rpm: 100, factors }), 1.2);
    assert.ok(Math.abs(topUpTimeMult(30, { rpm: 100, factors }) - 6.8) < 1e-9);
});

test("priceAddTokens: bỏ trống daysLeft thì giữ hành vi cũ (không xét thời gian)", () => {
    assert.equal(tokens(100, undefined), 1);
});

test("nạp token đắt dần theo số ngày còn lại, khớp giá mua mới cùng thời hạn", () => {
    assert.equal(tokens(100, 1), 1);
    assert.equal(tokens(100, 30), buy(100, 30));
    assert.equal(tokens(100, 365), buy(100, 365));
    assert.equal(tokens(100, null), 1.5);
});

test("KẼ HỞ ĐÃ ĐÓNG: mua nhỏ → gia hạn 365 ngày → nạp 999M ra ĐÚNG giá mua thẳng 1B/366 ngày", () => {
    const direct = buy(1000, 366);
    const path = buy(1, 1) + days(365, 1) + tokens(999, 366); // lúc nạp, key còn 366 ngày
    assert.ok(near(path, direct), `đường lách ${path} phải ≈ mua thẳng ${direct}`);
    assert.ok(path > direct * 0.99, "không được rẻ hơn mua thẳng");
});

test("thứ tự ngược: nạp token trước (key còn 1 ngày) rồi gia hạn ngày trên key lớn — cùng tổng", () => {
    const direct = buy(1000, 366);
    const path = buy(1, 1) + tokens(999, 1) + days(365, 1000);
    assert.ok(near(path, direct), `đường ngược ${path} phải ≈ mua thẳng ${direct}`);
});

test("mua 1 ngày rồi gia hạn 29 ngày = mua thẳng 30 ngày (phần ngày không đổi)", () => {
    assert.ok(near(buy(100, 1) + days(29, 100), buy(100, 30), 1));
});

test("renewPriceBreakdown mode tokens: total khớp priceAddTokens và lộ timeMult cho khách", () => {
    const bd = renewPriceBreakdown({ addTokens: 100 * M, keyTokens: 100 * M, usdPerMtoken: USD_PER_M, rpm: 100, factors, daysLeft: 30 });
    assert.equal(bd.mode, "tokens");
    assert.equal(bd.timeApplied, true);
    assert.ok(Math.abs(bd.timeMult - 6.8) < 1e-9);
    assert.equal(bd.timeDays, 30);
    assert.equal(bd.noExpiry, false);
    assert.equal(bd.total, tokens(100, 30));
});

test("renewPriceBreakdown: key không hết hạn → noExpiry và ×1.5", () => {
    const bd = renewPriceBreakdown({ addTokens: 100 * M, keyTokens: 100 * M, usdPerMtoken: USD_PER_M, rpm: 100, factors, daysLeft: null });
    assert.equal(bd.noExpiry, true);
    assert.equal(bd.timeMult, 1.5);
    assert.equal(bd.total, 1.5);
});

test("renewPriceBreakdown mode both: token sống tới hết hạn SAU gia hạn (còn + ngày mua thêm)", () => {
    const bd = renewPriceBreakdown({ addTokens: 100 * M, addDays: 29, keyTokens: 100 * M, usdPerMtoken: USD_PER_M, rpm: 100, factors, daysLeft: 1 });
    assert.equal(bd.mode, "both");
    assert.equal(bd.timeDays, 30);
    assert.equal(bd.tokenTotal, tokens(100, 30));
    assert.equal(bd.dayTotal, days(29, 100));
    // Tổng cả hai = nạp token trước rồi gia hạn trên key lớn hơn? Không — dayTotal tính trên key hiện tại,
    // nên so với mua mới: key (100M + 100M) 30 ngày trừ phần key cũ đã mua 1 ngày.
    assert.ok(near(bd.total + buy(100, 1), buy(100, 1) + buy(100, 30) + days(29, 100)));
});

test("renewPriceBreakdown: không truyền daysLeft thì timeMult = 1 và timeApplied = false (caller cũ)", () => {
    const bd = renewPriceBreakdown({ addTokens: 100 * M, keyTokens: 100 * M, usdPerMtoken: USD_PER_M, rpm: 100, factors });
    assert.equal(bd.timeApplied, false);
    assert.equal(bd.timeMult, 1);
    assert.equal(bd.total, 1);
});
