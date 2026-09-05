import test from "node:test";
import assert from "node:assert/strict";
import {
    toProviderQuota, toDisplayTokens, keyLifecycle, nextNotifyStage,
    computeRenewal, renewability,
    STAGE_NONE, STAGE_LOW, STAGE_CRITICAL, STAGE_DEAD,
    priceAddTokens, priceAddDays,
} from "../src/apikey-renew.js";

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 8, 5, 12, 0, 0);
const at = (days) => new Date(NOW + days * DAY).toISOString();

// === Quy đổi quota =========================================================

test("quy đổi token ↔ quota_limit khớp buildCreateKeyBody", () => {
    // giá tham chiếu Opus 5 = 15 → 100M token = quota_limit 15.000.000.
    assert.equal(toProviderQuota(100_000_000, 15), 15_000_000);
    assert.equal(toDisplayTokens(15_000_000, 15), 100_000_000);
    // Tắt quy đổi (giá = 0) → token thô, cả hai chiều.
    assert.equal(toProviderQuota(10_000_000, 0), 10_000_000);
    assert.equal(toDisplayTokens(10_000_000, 0), 10_000_000);
});

test("token bé tí KHÔNG được làm tròn về 0 — 0 là vô hạn trên xpiki", () => {
    // 1 token × 15/100 = 0,15 → round = 0 = key vô hạn. Phải kẹp sàn 1.
    assert.equal(toProviderQuota(1, 15), 1);
    assert.equal(toProviderQuota(3, 15), 1);
});

// === Vòng đời ==============================================================

const alive = { quotaLimit: 1000, quotaUsed: 0, expiresAt: at(30) };

test("key khoẻ mạnh không ở mốc nhắc nào", () => {
    const s = keyLifecycle(alive, NOW);
    assert.equal(s.stage, STAGE_NONE);
    assert.equal(s.dead, false);
});

test("quota: 80% → LOW, 95% → CRITICAL, cạn → DEAD", () => {
    assert.equal(keyLifecycle({ ...alive, quotaUsed: 800 }, NOW).stage, STAGE_LOW);
    assert.equal(keyLifecycle({ ...alive, quotaUsed: 950 }, NOW).stage, STAGE_CRITICAL);
    assert.equal(keyLifecycle({ ...alive, quotaUsed: 1000 }, NOW).stage, STAGE_DEAD);
    assert.equal(keyLifecycle({ ...alive, quotaUsed: 1000 }, NOW).exhausted, true);
});

test("dùng quá hạn mức vẫn kẹp 100%, không hiện 112%", () => {
    assert.equal(keyLifecycle({ ...alive, quotaUsed: 1120 }, NOW).usedPct, 100);
});

test("ngày: còn 3 → LOW, còn 1 → CRITICAL, quá hạn → DEAD", () => {
    assert.equal(keyLifecycle({ ...alive, expiresAt: at(3) }, NOW).stage, STAGE_LOW);
    assert.equal(keyLifecycle({ ...alive, expiresAt: at(1) }, NOW).stage, STAGE_CRITICAL);
    assert.equal(keyLifecycle({ ...alive, expiresAt: at(-1) }, NOW).stage, STAGE_DEAD);
    assert.equal(keyLifecycle({ ...alive, expiresAt: at(-1) }, NOW).expired, true);
});

test("lấy trục NẶNG hơn trong hai trục quota / ngày", () => {
    // Quota mới 80% nhưng ngày chỉ còn nửa ngày → phải là CRITICAL.
    const s = keyLifecycle({ quotaLimit: 1000, quotaUsed: 800, expiresAt: at(0.5) }, NOW);
    assert.equal(s.stage, STAGE_CRITICAL);
    assert.equal(s.reason, "time", "phải nói đúng lý do để chọn câu chữ tin nhắn");
});

test("quota_limit = 0 là VÔ HẠN, không phải cạn sạch", () => {
    // Đọc nhầm chiều này là spam tin 'key đã hết' cho mọi key vô hạn.
    const s = keyLifecycle({ quotaLimit: 0, quotaUsed: 999_999, expiresAt: null }, NOW);
    assert.equal(s.stage, STAGE_NONE);
    assert.equal(s.unlimitedQuota, true);
    assert.equal(s.exhausted, false);
});

test("không có ngày hết hạn thì trục ngày im lặng", () => {
    const s = keyLifecycle({ quotaLimit: 1000, quotaUsed: 10, expiresAt: null }, NOW);
    assert.equal(s.stage, STAGE_NONE);
    assert.equal(s.hasExpiry, false);
    assert.equal(s.daysLeft, null);
});

test("provider tắt key → coi như chết dù quota còn", () => {
    const s = keyLifecycle({ ...alive, enabled: false }, NOW);
    assert.equal(s.stage, STAGE_DEAD);
    assert.equal(s.reason, "disabled");
});

// === Chọn mốc nhắc =========================================================

test("mỗi mốc nhắc đúng MỘT lần", () => {
    assert.equal(nextNotifyStage(STAGE_LOW, 0), STAGE_LOW);
    assert.equal(nextNotifyStage(STAGE_LOW, STAGE_LOW), STAGE_NONE, "đã nhắc rồi thì thôi");
    assert.equal(nextNotifyStage(STAGE_CRITICAL, STAGE_LOW), STAGE_CRITICAL);
    assert.equal(nextNotifyStage(STAGE_DEAD, STAGE_CRITICAL), STAGE_DEAD);
    assert.equal(nextNotifyStage(STAGE_DEAD, STAGE_DEAD), STAGE_NONE, "hết rồi thì không nhắc nữa");
});

test("tụt thẳng từ khoẻ sang chết chỉ nhận MỘT tin, không nhận bù cả ba", () => {
    // Khách đốt sạch quota trong một đêm, job quét lần sau mới thấy.
    assert.equal(nextNotifyStage(STAGE_DEAD, STAGE_NONE), STAGE_DEAD);
});

test("key được gia hạn (khoẻ lại) thì không nhắc lùi", () => {
    assert.equal(nextNotifyStage(STAGE_NONE, STAGE_DEAD), STAGE_NONE);
});

// === Tính gia hạn ==========================================================

test("nạp thêm token = CỘNG vào quota_limit hiện tại, không ghi đè", () => {
    // quota_limit của provider là tuyệt đối — ghi đè là xoá sạch phần khách đã mua.
    const p = computeRenewal({
        current: { quotaLimit: 15_000_000, expiresAt: at(10) },
        addTokens: 100_000_000, quotaRefPrice: 15, now: NOW,
    });
    assert.equal(p.quota_limit, 15_000_000 + 15_000_000);
    assert.equal("expires_at" in p, false, "không gia hạn ngày thì đừng đụng vào ngày");
});

test("gia hạn ngày cộng vào mốc CŨ khi key còn hạn", () => {
    const p = computeRenewal({ current: { quotaLimit: 100, expiresAt: at(10) }, addDays: 30, now: NOW });
    assert.equal(p.expires_at, new Date(NOW + 40 * DAY).toISOString());
    assert.equal("quota_limit" in p, false);
});

test("key ĐÃ quá hạn thì tính từ BÂY GIỜ, không cộng vào quá khứ", () => {
    // Cộng 30 ngày vào mốc tháng trước = khách trả tiền mua thời gian đã trôi qua.
    const p = computeRenewal({ current: { quotaLimit: 100, expiresAt: at(-20) }, addDays: 30, now: NOW });
    assert.equal(p.expires_at, new Date(NOW + 30 * DAY).toISOString());
});

test("KHÔNG gắn hạn cho key vốn không hết hạn", () => {
    // Khách mua key vĩnh viễn (đắt hơn ×1.5). Cộng ngày vào là hạ cấp.
    const p = computeRenewal({ current: { quotaLimit: 100, expiresAt: null }, addDays: 30, now: NOW });
    assert.equal(p, null);
});

test("KHÔNG biến key quota vô hạn thành hữu hạn", () => {
    const p = computeRenewal({ current: { quotaLimit: 0, expiresAt: at(10) }, addTokens: 5_000_000, quotaRefPrice: 15, now: NOW });
    assert.equal(p, null);
});

test("gia hạn cả hai thì PATCH cả hai field", () => {
    const p = computeRenewal({
        current: { quotaLimit: 1_000_000, expiresAt: at(5) },
        addTokens: 10_000_000, addDays: 7, quotaRefPrice: 15, now: NOW,
    });
    assert.equal(p.quota_limit, 1_000_000 + 1_500_000);
    assert.equal(p.expires_at, new Date(NOW + 12 * DAY).toISOString());
});

test("không chọn gì thì không PATCH gì", () => {
    assert.equal(computeRenewal({ current: { quotaLimit: 100, expiresAt: at(5) }, now: NOW }), null);
});

// === Giá gia hạn ===========================================================
// Dùng ĐÚNG keyPriceFactors của module bán key — giá gia hạn không được lệch
// khỏi giá mua mới, nếu không admin chỉnh knob một đằng giá chạy một nẻo.
const { keyPriceFactors, priceUsdForKey } = await import("../src/apikey-pricing.js");
const F = (o) => keyPriceFactors(o);

test("giá nạp token = token × $/1M × hệ số RPM, KHÔNG nhân hệ số ngày", () => {
    // 100M token, $0.01/1M, RPM 300 (= mức gồm sẵn → hệ số 1) → đúng $1.00.
    assert.equal(priceAddTokens(100_000_000, { usdPerMtoken: 0.01, rpm: 300, factors: F }), 1);
    // RPM 600 (gấp đôi mức gồm sẵn, +20%) → $1.20.
    assert.equal(priceAddTokens(100_000_000, { usdPerMtoken: 0.01, rpm: 600, factors: F }), 1.2);
});

test("nạp token cho key VĨNH VIỄN không bị tính ×1.5 lần nữa", () => {
    // Hệ số 'không hết hạn' đã thu một lần lúc mua key. Thu lại mỗi lần nạp là sai.
    const p = priceAddTokens(100_000_000, { usdPerMtoken: 0.01, rpm: 300, factors: F });
    const muaMoi = priceUsdForKey({ tokens: 100_000_000, rpm: 300, validDays: 0 }, 0.01);
    assert.equal(p, 1);
    assert.equal(muaMoi, 1.5, "mua mới key vĩnh viễn thì vẫn ×1.5");
});

test("giá gia hạn ngày = đúng phần phụ phí ngày của công thức bán key", () => {
    // Mặc định +5%/30 ngày. Key 100M token, $0.01/1M, RPM 300 → gốc $1.
    // Gia hạn 30 ngày = $1 × 5% = $0.05.
    assert.equal(priceAddDays(30, { keyTokens: 100_000_000, usdPerMtoken: 0.01, rpm: 300, factors: F }), 0.05);
    // 60 ngày = gấp đôi.
    assert.equal(priceAddDays(60, { keyTokens: 100_000_000, usdPerMtoken: 0.01, rpm: 300, factors: F }), 0.1);
});

test("mua key 30 ngày đắt hơn key 1 ngày bao nhiêu thì gia hạn 29 ngày bấy nhiêu", () => {
    const k = { tokens: 100_000_000, rpm: 300 };
    const chenhLech = priceUsdForKey({ ...k, validDays: 30 }, 0.01) - priceUsdForKey({ ...k, validDays: 1 }, 0.01);
    const giaGiaHan = priceAddDays(30, { keyTokens: k.tokens, usdPerMtoken: 0.01, rpm: 300, factors: F })
        - priceAddDays(1, { keyTokens: k.tokens, usdPerMtoken: 0.01, rpm: 300, factors: F });
    assert.ok(Math.abs(chenhLech - giaGiaHan) < 0.02, `lệch quá nhiều: ${chenhLech} vs ${giaGiaHan}`);
});

test("số 0 / âm không sinh ra giá âm", () => {
    assert.equal(priceAddTokens(0, { usdPerMtoken: 0.01, rpm: 300, factors: F }), 0);
    assert.equal(priceAddTokens(-5, { usdPerMtoken: 0.01, rpm: 300, factors: F }), 0);
    assert.equal(priceAddDays(0, { keyTokens: 1e8, usdPerMtoken: 0.01, rpm: 300, factors: F }), 0);
    assert.equal(priceAddDays(-3, { keyTokens: 1e8, usdPerMtoken: 0.01, rpm: 300, factors: F }), 0);
});

test("renewability cho UI biết trước cái gì gia hạn được", () => {
    assert.deepEqual(renewability({ quotaLimit: 100, expiresAt: at(5) }), { canAddTokens: true, canAddDays: true });
    assert.deepEqual(renewability({ quotaLimit: 0, expiresAt: at(5) }), { canAddTokens: false, canAddDays: true });
    assert.deepEqual(renewability({ quotaLimit: 100, expiresAt: null }), { canAddTokens: true, canAddDays: false });
});
