import test from "node:test";
import assert from "node:assert/strict";
import {
    buildFreeQuotaTable,
    rollFreeQuota,
    freeQuotaBandProbabilities,
    parseTokenAmount,
    parseRpmAmount,
    parseDaysAmount,
    priceUsdForTokens,
    priceUsdForKey,
    keyPriceFactors,
    formatTokens,
    formatDays,
    TOKENS_PER_M,
    MIN_BUY_TOKENS,
    MAX_BUY_TOKENS,
    FREE_MIN_M,
    FREE_MAX_M,
    DEFAULT_FREE_ALPHA,
    MIN_KEY_RPM,
    MAX_KEY_RPM,
    MIN_KEY_DAYS,
    MAX_KEY_DAYS,
    DAYS_UNLIMITED,
} from "../src/apikey-pricing.js";

// ─── Bảng quota quà tặng ──────────────────────────────────────────────────────

test("bảng quota trải đúng miền 3M–50M, bước 1M", () => {
    const table = buildFreeQuotaTable();
    assert.equal(table.length, FREE_MAX_M - FREE_MIN_M + 1);
    assert.equal(table[0].tokens, FREE_MIN_M * TOKENS_PER_M);
    assert.equal(table[table.length - 1].tokens, FREE_MAX_M * TOKENS_PER_M);
});

test("xác suất cộng lại bằng 1 và cumulative tăng đơn điệu", () => {
    const table = buildFreeQuotaTable();
    const total = table.reduce((s, r) => s + r.probability, 0);
    assert.ok(Math.abs(total - 1) < 1e-9, `tổng xác suất = ${total}`);

    for (let i = 1; i < table.length; i++) {
        assert.ok(table[i].cumulative > table[i - 1].cumulative, `cumulative phải tăng tại ${i}`);
    }
    assert.ok(Math.abs(table[table.length - 1].cumulative - 1) < 1e-9);
});

test("mốc token càng cao thì xác suất càng thấp (yêu cầu nghiệp vụ)", () => {
    const table = buildFreeQuotaTable();
    for (let i = 1; i < table.length; i++) {
        assert.ok(
            table[i].probability < table[i - 1].probability,
            `${table[i].m}M phải hiếm hơn ${table[i - 1].m}M`,
        );
    }
    // Mốc thấp nhất phải phổ biến hơn mốc cao nhất đúng theo luật lũy thừa:
    // alpha=2 → (FREE_MAX_M/FREE_MIN_M)^2, với 3–50M là (50/3)^2 ≈ 277.8.
    const expected = Math.pow(FREE_MAX_M / FREE_MIN_M, DEFAULT_FREE_ALPHA);
    const ratio = table[0].probability / table[table.length - 1].probability;
    assert.ok(
        Math.abs(ratio - expected) < 1e-6,
        `tỉ lệ ${FREE_MIN_M}M/${FREE_MAX_M}M = ${ratio.toFixed(1)}, phải ≈ ${expected.toFixed(1)}`,
    );
    assert.ok(ratio > 20, `mốc cao phải hiếm hơn mốc thấp rõ rệt, ratio = ${ratio.toFixed(1)}`);
});

test("phân bố theo dải: dải thấp chiếm phần lớn, dải cao rất hiếm", () => {
    const bands = freeQuotaBandProbabilities();
    const byLabel = Object.fromEntries(bands.map((b) => [b.label, b.probability]));

    // Số chốt theo alpha=2 trên miền 3–50M — đổi alpha/miền thì test này đổi theo.
    assert.ok(byLabel["3–5M"] > 0.5, `3–5M = ${byLabel["3–5M"]}, phải > 50%`);
    assert.ok(byLabel["21–50M"] < 0.12, `21–50M = ${byLabel["21–50M"]}, phải < 12%`);
    // Dải càng cao càng nhỏ
    assert.ok(byLabel["3–5M"] > byLabel["6–10M"]);
    assert.ok(byLabel["6–10M"] > byLabel["11–20M"]);
    assert.ok(byLabel["11–20M"] > byLabel["21–50M"]);

    const total = bands.reduce((s, b) => s + b.probability, 0);
    assert.ok(Math.abs(total - 1) < 1e-9, "4 dải phải phủ hết miền");
});

test("rollFreeQuota tất định theo rand, luôn nằm trong miền", () => {
    const table = buildFreeQuotaTable();
    assert.equal(rollFreeQuota(0, table), FREE_MIN_M * TOKENS_PER_M, "rand=0 → mốc thấp nhất");
    assert.equal(rollFreeQuota(0.999999999, table), FREE_MAX_M * TOKENS_PER_M, "rand→1 → mốc cao nhất");

    // Không bao giờ undefined / ngoài miền, kể cả rand ngoài [0,1) hoặc NaN.
    for (const r of [-1, 0, 0.5, 1, 2, NaN, undefined]) {
        const tokens = rollFreeQuota(r, table);
        assert.ok(Number.isFinite(tokens), `rand=${r} phải trả số`);
        assert.ok(tokens >= FREE_MIN_M * TOKENS_PER_M && tokens <= FREE_MAX_M * TOKENS_PER_M, `rand=${r} → ${tokens} ngoài miền`);
    }
});

test("quota luôn là bội số của 1 triệu token", () => {
    const table = buildFreeQuotaTable();
    for (let i = 0; i < 200; i++) {
        const tokens = rollFreeQuota(i / 200, table);
        assert.equal(tokens % TOKENS_PER_M, 0, `${tokens} không phải bội của 1M`);
    }
});

test("miền quota tuỳ chỉnh được, min>max thì không sập", () => {
    const narrow = buildFreeQuotaTable({ minM: 10, maxM: 12 });
    assert.deepEqual(narrow.map((r) => r.m), [10, 11, 12]);

    // maxM < minM → kẹp thành 1 mốc, không trả bảng rỗng (bảng rỗng làm
    // rollFreeQuota trả mốc mặc định và khách nhận quota sai).
    const inverted = buildFreeQuotaTable({ minM: 50, maxM: 10 });
    assert.equal(inverted.length, 1);
    assert.equal(inverted[0].m, 50);
});

// ─── Parser số token ──────────────────────────────────────────────────────────

test("nhận số thuần và mọi kiểu dấu phân cách nghìn", () => {
    for (const input of ["3000000", "3 000 000", "3,000,000", "3.000.000", " 3000000 "]) {
        const r = parseTokenAmount(input);
        assert.equal(r.ok, true, `${input} phải hợp lệ`);
        assert.equal(r.tokens, 3_000_000, `${input} → 3M`);
    }
});

test("nhận hậu tố m/M/tr theo đúng ví dụ trong prompt", () => {
    for (const input of ["3m", "3M", "3 m", "3tr", "3triệu", "3trieu"]) {
        const r = parseTokenAmount(input);
        assert.equal(r.ok, true, `${input} phải hợp lệ`);
        assert.equal(r.tokens, 3_000_000, `${input} → 3M`);
    }
});

test("hậu tố thập phân: 1.5m và 1,5m đều là 1.5M", () => {
    assert.equal(parseTokenAmount("1.5m").tokens, 1_500_000);
    assert.equal(parseTokenAmount("1,5m").tokens, 1_500_000);
    assert.equal(parseTokenAmount("2.5M").tokens, 2_500_000);
});

test("từ chối input không phải số", () => {
    for (const input of ["abc", "3x", "m", "--", "1e9", "3m3", "0x10"]) {
        const r = parseTokenAmount(input);
        assert.equal(r.ok, false, `${input} phải bị từ chối`);
        assert.equal(r.error, "INVALID", `${input} → INVALID`);
    }
});

test("chuỗi rỗng / null trả EMPTY, không phải INVALID", () => {
    for (const input of ["", "   ", null, undefined]) {
        assert.equal(parseTokenAmount(input).error, "EMPTY");
    }
});

test("dưới min trả MIN, trên max trả MAX kèm ngưỡng để hiện cho khách", () => {
    const low = parseTokenAmount("500000");
    assert.equal(low.ok, false);
    assert.equal(low.error, "MIN");
    assert.equal(low.min, MIN_BUY_TOKENS);

    // Trên trần (mặc định 1 nghìn tỷ) → MAX, kèm ngưỡng để hiện cho khách.
    const high = parseTokenAmount(String(MAX_BUY_TOKENS + TOKENS_PER_M));
    assert.equal(high.ok, false);
    assert.equal(high.error, "MAX");
    assert.equal(high.max, MAX_BUY_TOKENS);

    // Đúng hai biên phải HỢP LỆ (inclusive) — off-by-one ở đây chặn oan khách
    // mua đúng gói tối đa.
    assert.equal(parseTokenAmount("1000000").ok, true);
    assert.equal(parseTokenAmount(String(MAX_BUY_TOKENS)).ok, true);
    assert.equal(parseTokenAmount("1m").ok, true);
    assert.equal(parseTokenAmount("200m").ok, true, "200M giờ phải hợp lệ (trần đã nới)");
    assert.equal(parseTokenAmount("2000m").ok, true, "2B giờ phải hợp lệ (khớp gói KEY 2B)");
});

test("số âm và 0 bị từ chối", () => {
    assert.equal(parseTokenAmount("-5000000").ok, false);
    assert.equal(parseTokenAmount("0").ok, false);
    assert.equal(parseTokenAmount("0m").ok, false);
});

// ─── Giá ──────────────────────────────────────────────────────────────────────

test("giá mặc định $0.01 / 1 triệu token", () => {
    assert.equal(priceUsdForTokens(1 * TOKENS_PER_M), 0.01);
    assert.equal(priceUsdForTokens(3 * TOKENS_PER_M), 0.03);
    assert.equal(priceUsdForTokens(100 * TOKENS_PER_M), 1);
});

test("giá làm tròn LÊN cent — không bao giờ bán dưới giá", () => {
    // 1.5M × $0.01/M = $0.015 → phải là $0.02, không phải $0.01.
    assert.equal(priceUsdForTokens(1_500_000), 0.02);
    assert.equal(priceUsdForTokens(1_100_000), 0.02);
});

test("đơn giá tuỳ chỉnh được, giá trị vô lý lùi về mặc định", () => {
    assert.equal(priceUsdForTokens(1 * TOKENS_PER_M, 0.05), 0.05);
    assert.equal(priceUsdForTokens(10 * TOKENS_PER_M, 0.02), 0.2);
    // 0 / âm / NaN → dùng mặc định 0.01 thay vì bán 0 đồng.
    for (const bad of [0, -1, NaN, null, undefined, "abc"]) {
        assert.equal(priceUsdForTokens(1 * TOKENS_PER_M, bad), 0.01, `đơn giá ${bad} phải lùi về mặc định`);
    }
});

test("token <= 0 thì giá là 0", () => {
    assert.equal(priceUsdForTokens(0), 0);
    assert.equal(priceUsdForTokens(-5), 0);
});

// ─── Phụ phí RPM & thời hạn ───────────────────────────────────────────────────

test("keyPriceFactors: RPM <= mức gồm sẵn → hệ số 1", () => {
    for (const rpm of [0, 10, 100, 300]) {
        assert.equal(keyPriceFactors({ rpm, validDays: 7 }).rpmMult, 1, `rpm ${rpm} không được phụ phí`);
    }
});

test("keyPriceFactors: mỗi block 300 RPM vượt mức +20%", () => {
    assert.equal(keyPriceFactors({ rpm: 600 }).rpmPct, 20);
    assert.equal(keyPriceFactors({ rpm: 900 }).rpmPct, 40);
    assert.equal(keyPriceFactors({ rpm: 1200 }).rpmPct, 60);
});

test("keyPriceFactors: +5% mỗi 30 ngày, key không hết hạn ×1.5", () => {
    assert.equal(keyPriceFactors({ validDays: 30 }).daysPct, 5);
    assert.equal(keyPriceFactors({ validDays: 90 }).daysPct, 15);
    assert.equal(keyPriceFactors({ validDays: 365 }).daysPct, 61);
    // validDays = 0 = không hết hạn → ×1.5 (đắt hơn, không phải rẻ hơn)
    assert.equal(keyPriceFactors({ validDays: 0 }).daysMult, 1.5);
    assert.equal(keyPriceFactors({ validDays: 0 }).daysPct, 50);
});

test("priceUsdForKey: token × hệ số RPM × hệ số ngày, làm tròn LÊN cent", () => {
    // 50M token, giá token gốc = $0.50
    assert.equal(priceUsdForKey({ tokens: 50 * TOKENS_PER_M, rpm: 300, validDays: 30 }), 0.53); // 0.50×1.0×1.05
    assert.equal(priceUsdForKey({ tokens: 50 * TOKENS_PER_M, rpm: 600, validDays: 90 }), 0.69); // 0.50×1.2×1.15
    assert.equal(priceUsdForKey({ tokens: 50 * TOKENS_PER_M, rpm: 300, validDays: 0 }), 0.75);  // 0.50×1.0×1.5
    // Không phụ phí (RPM mặc định, 1 ngày) ≈ giá token gốc
    assert.equal(priceUsdForKey({ tokens: 100 * TOKENS_PER_M, rpm: 300, validDays: 1 }), 1.01); // 1.00×1.0×(1+1/30×0.05)→ceil
    assert.equal(priceUsdForKey({ tokens: 0, rpm: 9999, validDays: 999 }), 0);
});

// ─── Phụ phí override được qua tham số knobs (admin chỉnh trong web) ──────────

test("keyPriceFactors: knobs override 4 hằng phụ phí", () => {
    // rpmIncluded=600 → 600 RPM không còn bị phụ phí
    assert.equal(keyPriceFactors({ rpm: 600 }, { rpmIncluded: 600 }).rpmPct, 0);
    // rpmSurchargePct=50 → mỗi block vượt +50% thay vì +20%
    assert.equal(keyPriceFactors({ rpm: 600 }, { rpmSurchargePct: 50 }).rpmPct, 50);
    // daySurchargePct=10 → 30 ngày +10%
    assert.equal(keyPriceFactors({ validDays: 30 }, { daySurchargePct: 10 }).daysPct, 10);
    // noExpiryMult=2 → key vĩnh viễn ×2
    assert.equal(keyPriceFactors({ validDays: 0 }, { noExpiryMult: 2 }).daysMult, 2);
    // Tắt hết phụ phí
    const off = keyPriceFactors({ rpm: 5000, validDays: 0 }, { rpmSurchargePct: 0, noExpiryMult: 1 });
    assert.equal(off.rpmMult, 1);
    assert.equal(off.daysMult, 1);
});

test("keyPriceFactors: knobs vô lý → lùi về hằng mặc định", () => {
    for (const bad of [null, undefined, NaN, -5, "x"]) {
        assert.equal(
            keyPriceFactors({ rpm: 600 }, { rpmSurchargePct: bad }).rpmPct,
            keyPriceFactors({ rpm: 600 }).rpmPct,
            `rpmSurchargePct=${bad} phải lùi về mặc định`,
        );
    }
    // noExpiryMult < 1 vô lý (không bao giờ bán rẻ hơn) → về mặc định 1.5
    assert.equal(keyPriceFactors({ validDays: 0 }, { noExpiryMult: 0.5 }).daysMult, 1.5);
});

test("priceUsdForKey: nhận knobs làm tham số thứ 3", () => {
    // 50M gốc $0.50, rpm 600 với surcharge 50% + 30 ngày mặc định 5%
    // = 0.50 × 1.5 × 1.05 = 0.7875 → ceil 0.79
    assert.equal(
        priceUsdForKey({ tokens: 50 * TOKENS_PER_M, rpm: 600, validDays: 30 }, 0.01, { rpmSurchargePct: 50 }),
        0.79,
    );
    // knobs rỗng = y hệt không truyền
    assert.equal(
        priceUsdForKey({ tokens: 50 * TOKENS_PER_M, rpm: 600, validDays: 90 }, 0.01, {}),
        priceUsdForKey({ tokens: 50 * TOKENS_PER_M, rpm: 600, validDays: 90 }, 0.01),
    );
});

// ─── Nhãn ─────────────────────────────────────────────────────────────────────

test("formatTokens hiển thị gọn", () => {
    assert.equal(formatTokens(1 * TOKENS_PER_M), "1M");
    assert.equal(formatTokens(6 * TOKENS_PER_M), "6M");
    assert.equal(formatTokens(100 * TOKENS_PER_M), "100M");
    assert.equal(formatTokens(1_500_000), "1.5M");
    assert.equal(formatTokens(1000 * TOKENS_PER_M), "1B");
});

// ─── Parser RPM ───────────────────────────────────────────────────────────────

test("parseRpmAmount nhận số nguyên và dấu phân cách nghìn", () => {
    for (const input of ["300", " 300 ", "1000", "1.000", "1,000"]) {
        const r = parseRpmAmount(input);
        assert.equal(r.ok, true, `${input} phải hợp lệ`);
    }
    assert.equal(parseRpmAmount("300").rpm, 300);
    assert.equal(parseRpmAmount("1,000").rpm, 1000);
});

test("parseRpmAmount từ chối input không phải số nguyên", () => {
    // RPM là số request/phút — thập phân vô nghĩa, phải bị từ chối chứ không
    // được làm tròn ngầm.
    for (const input of ["abc", "3x", "1e3", "--", "300rpm"]) {
        assert.equal(parseRpmAmount(input).error, "INVALID", `${input} → INVALID`);
    }
    for (const input of ["", "   ", null, undefined]) {
        assert.equal(parseRpmAmount(input).error, "EMPTY", `${input} → EMPTY`);
    }
});

test("parseRpmAmount chặn ngoài miền, hai biên vẫn hợp lệ", () => {
    const low = parseRpmAmount(String(MIN_KEY_RPM - 1));
    assert.equal(low.error, "MIN");
    assert.equal(low.min, MIN_KEY_RPM);

    const high = parseRpmAmount(String(MAX_KEY_RPM + 1));
    assert.equal(high.error, "MAX");
    assert.equal(high.max, MAX_KEY_RPM);

    assert.equal(parseRpmAmount(String(MIN_KEY_RPM)).ok, true, "biên dưới phải hợp lệ");
    assert.equal(parseRpmAmount(String(MAX_KEY_RPM)).ok, true, "biên trên phải hợp lệ");
    // 0 và số âm không bao giờ là RPM hợp lệ.
    assert.equal(parseRpmAmount("0").ok, false);
    assert.equal(parseRpmAmount("-5").ok, false);
});

// ─── Parser số ngày ───────────────────────────────────────────────────────────

test("parseDaysAmount nhận số ngày kèm đơn vị tuỳ ý", () => {
    for (const input of ["30", " 30 ", "30 ngày", "30ngay", "30d", "30 days"]) {
        const r = parseDaysAmount(input);
        assert.equal(r.ok, true, `${input} phải hợp lệ`);
        assert.equal(r.days, 30, `${input} → 30 ngày`);
    }
});

test("parseDaysAmount coi 0 và chữ 'vĩnh viễn' là KHÔNG hết hạn", () => {
    // validDays = 0 làm buildCreateKeyBody bỏ hẳn expires_in_days → key chỉ hết
    // khi cạn quota. Đây là lựa chọn hợp lệ, không phải lỗi nhập.
    for (const input of ["0", "vĩnh viễn", "vinh vien", "vv", "không", "khong", "ko", "unlimited", "never", "forever"]) {
        const r = parseDaysAmount(input);
        assert.equal(r.ok, true, `${input} phải hợp lệ`);
        assert.equal(r.days, DAYS_UNLIMITED, `${input} → 0 (không hết hạn)`);
    }
});

test("parseDaysAmount từ chối input rác và chặn quá max", () => {
    for (const input of ["abc", "3x", "1e3", "--"]) {
        assert.equal(parseDaysAmount(input).error, "INVALID", `${input} → INVALID`);
    }
    for (const input of ["", "   ", null, undefined]) {
        assert.equal(parseDaysAmount(input).error, "EMPTY", `${input} → EMPTY`);
    }

    const high = parseDaysAmount(String(MAX_KEY_DAYS + 1));
    assert.equal(high.error, "MAX");
    assert.equal(high.max, MAX_KEY_DAYS);

    assert.equal(parseDaysAmount(String(MIN_KEY_DAYS)).ok, true, "biên dưới phải hợp lệ");
    assert.equal(parseDaysAmount(String(MAX_KEY_DAYS)).ok, true, "biên trên phải hợp lệ");
});

test("formatDays hiển thị 0 là không hết hạn", () => {
    assert.equal(formatDays(0), "Không hết hạn");
    assert.equal(formatDays(-1), "Không hết hạn");
    assert.equal(formatDays(30), "30 ngày");
    assert.equal(formatDays(30, { dayLabel: "days" }), "30 days");
    assert.equal(formatDays(0, { unlimitedLabel: "Never expires" }), "Never expires");
});
