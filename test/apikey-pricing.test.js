import test from "node:test";
import assert from "node:assert/strict";
import {
    buildFreeQuotaTable,
    rollFreeQuota,
    freeQuotaBandProbabilities,
    parseTokenAmount,
    priceUsdForTokens,
    formatTokens,
    TOKENS_PER_M,
    MIN_BUY_TOKENS,
    MAX_BUY_TOKENS,
    FREE_MIN_M,
    FREE_MAX_M,
} from "../src/apikey-pricing.js";

// ─── Bảng quota quà tặng ──────────────────────────────────────────────────────

test("bảng quota trải đúng miền 5M–100M, bước 1M", () => {
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
    // 5M phải phổ biến hơn 100M ít nhất 100 lần (alpha=2 → (100/5)^2 = 400).
    const ratio = table[0].probability / table[table.length - 1].probability;
    assert.ok(ratio > 100, `tỉ lệ 5M/100M = ${ratio.toFixed(1)}, phải > 100`);
});

test("phân bố theo dải: dải thấp chiếm phần lớn, dải cao rất hiếm", () => {
    const bands = freeQuotaBandProbabilities();
    const byLabel = Object.fromEntries(bands.map((b) => [b.label, b.probability]));

    // Số chốt theo alpha=2 mặc định — đổi alpha thì test này phải đổi theo.
    assert.ok(byLabel["5–10M"] > 0.5, `5–10M = ${byLabel["5–10M"]}, phải > 50%`);
    assert.ok(byLabel["51–100M"] < 0.08, `51–100M = ${byLabel["51–100M"]}, phải < 8%`);
    // Dải càng cao càng nhỏ
    assert.ok(byLabel["5–10M"] > byLabel["11–20M"]);
    assert.ok(byLabel["11–20M"] > byLabel["21–50M"]);
    assert.ok(byLabel["21–50M"] > byLabel["51–100M"]);

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

    const high = parseTokenAmount("200000000");
    assert.equal(high.ok, false);
    assert.equal(high.error, "MAX");
    assert.equal(high.max, MAX_BUY_TOKENS);

    // Đúng hai biên phải HỢP LỆ (inclusive) — off-by-one ở đây chặn oan khách
    // mua đúng gói tối đa.
    assert.equal(parseTokenAmount("1000000").ok, true);
    assert.equal(parseTokenAmount("100000000").ok, true);
    assert.equal(parseTokenAmount("1m").ok, true);
    assert.equal(parseTokenAmount("100m").ok, true);
    assert.equal(parseTokenAmount("101m").error, "MAX");
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

// ─── Nhãn ─────────────────────────────────────────────────────────────────────

test("formatTokens hiển thị gọn", () => {
    assert.equal(formatTokens(1 * TOKENS_PER_M), "1M");
    assert.equal(formatTokens(6 * TOKENS_PER_M), "6M");
    assert.equal(formatTokens(100 * TOKENS_PER_M), "100M");
    assert.equal(formatTokens(1_500_000), "1.5M");
    assert.equal(formatTokens(1000 * TOKENS_PER_M), "1B");
});
