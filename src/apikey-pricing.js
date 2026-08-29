/**
 * API key pricing + quota — TOÀN BỘ là hàm THUẦN, không I/O.
 *
 * Tách riêng khỏi gpt2api.js (HTTP) và bot.js (UI) để test được không cần
 * mạng/DB — máy dev không kết nối được Atlas nên đây là tầng duy nhất
 * kiểm chứng tự động được.
 */

export const TOKENS_PER_M = 1_000_000;

// Miền MUA (khách trả tiền). Khớp text prompt: "min 1,000,000 — max 100,000,000".
export const MIN_BUY_TOKENS = 1 * TOKENS_PER_M;
export const MAX_BUY_TOKENS = 100 * TOKENS_PER_M;

// Miền QUÀ TẶNG (giftcode free key): 5M–100M, số càng lớn càng hiếm.
export const FREE_MIN_M = 5;
export const FREE_MAX_M = 100;

// Số mũ của luật lũy thừa nghịch: weight(n) ∝ 1/n^ALPHA với n = số triệu token.
// ALPHA càng lớn thì mốc cao càng hiếm. 2.0 cho phân bố: 5–10M ≈ 60%,
// 11–20M ≈ 22%, 21–50M ≈ 13.7%, 51–100M ≈ 4.7% (xem test).
export const DEFAULT_FREE_ALPHA = 2;

// Giá mặc định: $0.01 cho 1 triệu token.
export const DEFAULT_USD_PER_MTOKEN = 0.01;

/**
 * Gói mua sẵn (triệu token). Khách bấm 1 nút là xong, không phải nhập số.
 */
export const DEFAULT_BUY_PRESETS_M = [1, 5, 10, 20, 50, 100];

/**
 * Bảng trọng số tích lũy cho quà tặng. Trả mảng [{ tokens, weight, cumulative }]
 * với cumulative chuẩn hoá về [0, 1].
 *
 * Bước nhảy 1 triệu token: khách nhận được số "đẹp" (6M, 23M) chứ không phải
 * 6.437.291 — vẫn là random trong 5–100M như yêu cầu.
 */
export function buildFreeQuotaTable({ minM = FREE_MIN_M, maxM = FREE_MAX_M, alpha = DEFAULT_FREE_ALPHA } = {}) {
    const lo = Math.max(1, Math.floor(minM));
    const hi = Math.max(lo, Math.floor(maxM));
    const a = Number.isFinite(alpha) && alpha >= 0 ? alpha : DEFAULT_FREE_ALPHA;

    const rows = [];
    let total = 0;
    for (let m = lo; m <= hi; m++) {
        const weight = 1 / Math.pow(m, a);
        total += weight;
        rows.push({ tokens: m * TOKENS_PER_M, m, weight });
    }

    let acc = 0;
    return rows.map((r) => {
        acc += r.weight;
        return { ...r, probability: r.weight / total, cumulative: acc / total };
    });
}

/**
 * Quay số quà tặng. `rand` là số trong [0, 1) — truyền vào để test tất định.
 * rand >= cumulative cuối (do sai số dấu phẩy động) thì trả mốc cuối, không
 * bao giờ trả undefined.
 */
export function rollFreeQuota(rand = Math.random(), table = buildFreeQuotaTable()) {
    if (!table.length) return FREE_MIN_M * TOKENS_PER_M;
    const r = Number.isFinite(rand) ? Math.min(Math.max(rand, 0), 1 - Number.EPSILON) : 0;
    for (const row of table) {
        if (r < row.cumulative) return row.tokens;
    }
    return table[table.length - 1].tokens;
}

/**
 * Tổng xác suất theo dải, dùng cho tài liệu admin và test.
 * bands: mảng [minM, maxM] (bao gồm cả hai đầu).
 */
export function freeQuotaBandProbabilities(table = buildFreeQuotaTable(), bands = [[5, 10], [11, 20], [21, 50], [51, 100]]) {
    return bands.map(([lo, hi]) => ({
        label: `${lo}–${hi}M`,
        lo,
        hi,
        probability: table
            .filter((r) => r.m >= lo && r.m <= hi)
            .reduce((sum, r) => sum + r.probability, 0),
    }));
}

/**
 * Đọc số token khách gõ. Chấp nhận:
 *   "3000000", "3 000 000", "3,000,000", "3.000.000"  → 3.000.000
 *   "3m", "3M", "3 m", "3tr"                            → 3.000.000
 *   "1.5m", "1,5m"                                      → 1.500.000
 *   "0.5m"                                              → 500.000 (dưới min → lỗi MIN)
 * Từ chối: chuỗi rỗng, chữ thuần, số âm, 0, số quá lớn, nhiều dấu chấm vô nghĩa.
 *
 * Trả { ok: true, tokens } hoặc { ok: false, error, min?, max? } với error là
 * mã: EMPTY | INVALID | MIN | MAX.
 */
export function parseTokenAmount(input, { min = MIN_BUY_TOKENS, max = MAX_BUY_TOKENS } = {}) {
    const raw = String(input ?? "").trim().toLowerCase();
    if (!raw) return { ok: false, error: "EMPTY" };

    // Hậu tố "m" / "tr" (triệu). "tr" vì khách Việt hay gõ "3tr".
    const suffixMatch = raw.match(/^([\d.,\s]+)\s*(m|tr|triệu|trieu)$/);
    if (suffixMatch) {
        const n = parseDecimal(suffixMatch[1]);
        if (n === null) return { ok: false, error: "INVALID" };
        return clampTokens(Math.round(n * TOKENS_PER_M), min, max);
    }

    // Số thuần. Dấu chấm/phẩy/khoảng trắng ở đây là dấu phân cách nghìn
    // ("3.000.000" kiểu VN, "3,000,000" kiểu EN) → bỏ hết, KHÔNG coi là thập phân.
    if (!/^[\d.,\s]+$/.test(raw)) return { ok: false, error: "INVALID" };
    const digits = raw.replace(/[.,\s]/g, "");
    if (!/^\d+$/.test(digits)) return { ok: false, error: "INVALID" };
    const n = Number(digits);
    if (!Number.isSafeInteger(n)) return { ok: false, error: "INVALID" };
    return clampTokens(n, min, max);
}

function parseDecimal(text) {
    // "1.5" và "1,5" đều là 1.5; "1 5" là vô nghĩa.
    const cleaned = String(text).replace(/\s/g, "").replace(",", ".");
    if (!/^\d+(\.\d+)?$/.test(cleaned)) return null;
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : null;
}

function clampTokens(tokens, min, max) {
    if (!Number.isFinite(tokens) || tokens <= 0) return { ok: false, error: "INVALID" };
    if (tokens < min) return { ok: false, error: "MIN", min, max };
    if (tokens > max) return { ok: false, error: "MAX", min, max };
    // Làm tròn xuống bội của 1M? KHÔNG — khách gõ 1.500.000 thì phải được đúng
    // 1.5M, không bị cắt về 1M. Giá tính theo token thật.
    return { ok: true, tokens };
}

/**
 * Giá USD cho một lượng token. Làm tròn LÊN cent để không bao giờ bán dưới giá.
 */
export function priceUsdForTokens(tokens, usdPerMtoken = DEFAULT_USD_PER_MTOKEN) {
    const t = Number(tokens) || 0;
    const rate = Number(usdPerMtoken);
    const perM = Number.isFinite(rate) && rate > 0 ? rate : DEFAULT_USD_PER_MTOKEN;
    if (t <= 0) return 0;
    const usd = (t / TOKENS_PER_M) * perM;
    return Math.ceil(usd * 100) / 100;
}

/**
 * Nhãn số token gọn cho UI: 1M / 1.5M / 100M / 1 tỷ.
 */
export function formatTokens(tokens) {
    const m = Number(tokens || 0) / TOKENS_PER_M;
    if (m >= 1000) {
        const b = m / 1000;
        return `${Number.isInteger(b) ? b : b.toFixed(1)}B`;
    }
    if (Number.isInteger(m)) return `${m}M`;
    return `${Number(m.toFixed(2))}M`;
}

export default {
    TOKENS_PER_M,
    MIN_BUY_TOKENS,
    MAX_BUY_TOKENS,
    FREE_MIN_M,
    FREE_MAX_M,
    DEFAULT_FREE_ALPHA,
    DEFAULT_USD_PER_MTOKEN,
    DEFAULT_BUY_PRESETS_M,
    buildFreeQuotaTable,
    rollFreeQuota,
    freeQuotaBandProbabilities,
    parseTokenAmount,
    priceUsdForTokens,
    formatTokens,
};
