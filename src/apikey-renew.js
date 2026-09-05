/**
 * Gia hạn key + vòng đời key (sắp hết / đã hết).
 *
 * TOÀN BỘ file là hàm THUẦN — không I/O, không đọc ENV, không đụng Date.now()
 * (mọi hàm nhận `now` từ ngoài). gpt2api.js lo phần gọi provider, file này chỉ
 * tính toán. Nhờ vậy test được trên máy dev không kết nối được Atlas, giống
 * apikey-pricing.js và apikey-profiles.js.
 *
 * Bối cảnh provider (xpiki admin-pub), đã xác minh bằng probe thật:
 *   GET   /keys/{public_id}  → quota_limit, quota_used, expires_at, enabled, rpm
 *   PATCH /keys/{public_id}  → nhận quota_limit, expires_at (RFC3339), rpm, tpm, enabled
 *                              KHÔNG nhận expires_in_days (im lặng bỏ qua)
 * `quota_limit` là TUYỆT ĐỐI, không phải cộng dồn → muốn nạp thêm phải đọc số
 * hiện tại rồi ghi tổng. Và provider bỏ qua field lạ mà vẫn trả code 0, nên
 * không thể tin status code — phải đọc lại để xác nhận.
 */

/** quota_limit = 0 nghĩa là KHÔNG GIỚI HẠN trên xpiki — không bao giờ được ghi nhầm. */
export const UNLIMITED_QUOTA = 0;

/** Ngưỡng vòng đời. Mỗi mốc nhắc ĐÚNG MỘT LẦN (xem nextNotifyStage). */
export const STAGE_NONE = 0;
export const STAGE_LOW = 1;      // ~80% quota, hoặc còn ≤3 ngày
export const STAGE_CRITICAL = 2; // ~95% quota, hoặc còn ≤1 ngày
export const STAGE_DEAD = 3;     // cạn quota, hoặc đã quá hạn

export const DEFAULT_THRESHOLDS = {
    lowPct: 80,
    criticalPct: 95,
    lowDays: 3,
    criticalDays: 1,
};

// ─── Quy đổi quota ────────────────────────────────────────────────────────────
// Bot hiển thị "token" (theo giá Opus 5); provider lưu `quota_limit` = token ×
// giá / 100. Xem giải thích đầy đủ ở CLAUDE.md mục "Quy đổi quota (xpiki)".

/** token hiển thị → quota_limit gửi provider. Khớp buildCreateKeyBody. */
export function toProviderQuota(tokens, quotaRefPrice = 0) {
    const raw = Math.max(0, Math.floor(Number(tokens) || 0));
    const price = Number(quotaRefPrice);
    if (!Number.isFinite(price) || price <= 0 || raw <= 0) return raw;
    // Sàn 1: số token rất nhỏ làm tròn về 0 = key VÔ HẠN trên xpiki.
    return Math.max(1, Math.round(raw * price / 100));
}

/** quota_limit của provider → token hiển thị cho khách. Nghịch đảo hàm trên. */
export function toDisplayTokens(quotaLimit, quotaRefPrice = 0) {
    const raw = Math.max(0, Math.floor(Number(quotaLimit) || 0));
    const price = Number(quotaRefPrice);
    if (!Number.isFinite(price) || price <= 0 || raw <= 0) return raw;
    return Math.round(raw * 100 / price);
}

// ─── Trạng thái vòng đời ──────────────────────────────────────────────────────

function msToDays(ms) {
    return ms / 86_400_000;
}

/**
 * Trạng thái một key từ số liệu provider trả về.
 *
 * Hai trục ĐỘC LẬP: quota và thời hạn. Key chết vì trục nào cũng là chết, nên
 * lấy trạng thái NẶNG HƠN của hai bên.
 *
 * `quotaLimit = 0` = không giới hạn → trục quota không bao giờ báo động.
 * `expiresAt = null` = không hết hạn → trục ngày không bao giờ báo động.
 */
export function keyLifecycle({ quotaLimit, quotaUsed, expiresAt, enabled = true } = {}, now = Date.now(), thresholds = {}) {
    const t = { ...DEFAULT_THRESHOLDS, ...thresholds };
    const limit = Math.max(0, Math.floor(Number(quotaLimit) || 0));
    const used = Math.max(0, Math.floor(Number(quotaUsed) || 0));

    const unlimitedQuota = limit === UNLIMITED_QUOTA;
    // Dùng quá hạn mức vẫn kẹp ở 100 — hiện "112%" cho khách là vô nghĩa.
    const usedPct = unlimitedQuota ? 0 : Math.min(100, (used / limit) * 100);
    const remainingQuota = unlimitedQuota ? null : Math.max(0, limit - used);

    const expMs = expiresAt == null ? null : new Date(expiresAt).getTime();
    const hasExpiry = expMs !== null && Number.isFinite(expMs);
    const daysLeft = hasExpiry ? msToDays(expMs - now) : null;

    let quotaStage = STAGE_NONE;
    if (!unlimitedQuota) {
        if (used >= limit) quotaStage = STAGE_DEAD;
        else if (usedPct >= t.criticalPct) quotaStage = STAGE_CRITICAL;
        else if (usedPct >= t.lowPct) quotaStage = STAGE_LOW;
    }

    let timeStage = STAGE_NONE;
    if (hasExpiry) {
        if (daysLeft <= 0) timeStage = STAGE_DEAD;
        else if (daysLeft <= t.criticalDays) timeStage = STAGE_CRITICAL;
        else if (daysLeft <= t.lowDays) timeStage = STAGE_LOW;
    }

    // Provider tắt key (admin khoá, hoặc key bị thu hồi) → coi như chết.
    const stage = enabled === false ? STAGE_DEAD : Math.max(quotaStage, timeStage);

    return {
        stage,
        // Lý do NẶNG hơn — dùng để chọn câu chữ trong tin nhắn nhắc.
        reason: enabled === false ? "disabled" : (quotaStage >= timeStage ? "quota" : "time"),
        usedPct,
        remainingQuota,
        unlimitedQuota,
        daysLeft,
        hasExpiry,
        expired: hasExpiry && daysLeft <= 0,
        exhausted: !unlimitedQuota && used >= limit,
        dead: (enabled === false) || (hasExpiry && daysLeft <= 0) || (!unlimitedQuota && used >= limit),
    };
}

/**
 * Mốc cần nhắc tiếp theo, hoặc 0 nếu chưa tới lúc.
 *
 * `notified` = mốc CAO NHẤT đã nhắc cho key này. Chỉ nhắc khi trạng thái vượt
 * qua mốc đã nhắc — nên mỗi mốc đúng một tin, và key tụt thẳng từ bình thường
 * xuống "đã hết" (khách đốt hết quota trong một đêm) vẫn nhận đúng một tin cuối
 * chứ không nhận bù cả ba.
 */
export function nextNotifyStage(stage, notified = 0) {
    const seen = Math.max(0, Math.floor(Number(notified) || 0));
    const cur = Math.max(0, Math.floor(Number(stage) || 0));
    return cur > seen ? cur : STAGE_NONE;
}

// ─── Tính gia hạn ─────────────────────────────────────────────────────────────

/**
 * Giá trị MỚI cần PATCH lên provider để gia hạn.
 *
 * @param current  số liệu provider đang có: { quotaLimit, expiresAt }
 * @param addTokens token hiển thị muốn nạp thêm (0 = không nạp)
 * @param addDays   số ngày muốn cộng thêm (0 = không gia hạn ngày)
 *
 * Trả về CHỈ những field thật sự đổi — PATCH thừa field là ghi đè oan.
 * `null` = không có gì để đổi.
 */
export function computeRenewal({
    current = {}, addTokens = 0, addDays = 0, quotaRefPrice = 0, now = Date.now(),
} = {}) {
    const tokens = Math.max(0, Math.floor(Number(addTokens) || 0));
    const days = Math.max(0, Math.floor(Number(addDays) || 0));
    const patch = {};

    if (tokens > 0) {
        const curLimit = Math.max(0, Math.floor(Number(current.quotaLimit) || 0));
        // Key ĐANG vô hạn (quota_limit = 0) mà cộng thêm token thì thành HỮU HẠN
        // — đó là hạ cấp thứ khách đã trả tiền. Không đụng vào.
        if (curLimit !== UNLIMITED_QUOTA) {
            patch.quota_limit = curLimit + toProviderQuota(tokens, quotaRefPrice);
        }
    }

    if (days > 0) {
        const expMs = current.expiresAt == null ? null : new Date(current.expiresAt).getTime();
        const hasExpiry = expMs !== null && Number.isFinite(expMs);
        // Key KHÔNG hết hạn thì cộng ngày vào là tự dưng gắn hạn cho nó — cũng là
        // hạ cấp. Bỏ qua, y như trường hợp quota vô hạn ở trên.
        if (hasExpiry) {
            // Key đã quá hạn thì tính từ BÂY GIỜ, không phải từ mốc cũ đã trôi qua
            // (cộng 30 ngày vào mốc của tháng trước = khách trả tiền mua quá khứ).
            const base = Math.max(now, expMs);
            patch.expires_at = new Date(base + days * 86_400_000).toISOString();
        }
    }

    return Object.keys(patch).length ? patch : null;
}

/**
 * Những gì khách được/không được gia hạn trên một key — để UI không mời chào
 * thứ sẽ bị computeRenewal bỏ qua rồi khách tưởng mất tiền oan.
 */
export function renewability(current = {}) {
    const curLimit = Math.max(0, Math.floor(Number(current.quotaLimit) || 0));
    const expMs = current.expiresAt == null ? null : new Date(current.expiresAt).getTime();
    return {
        canAddTokens: curLimit !== UNLIMITED_QUOTA,
        canAddDays: expMs !== null && Number.isFinite(expMs),
    };
}

// ─── Giá gia hạn ──────────────────────────────────────────────────────────────
// Dùng lại ĐÚNG hệ số của công thức bán key (keyPriceFactors) để giá gia hạn
// không lệch khỏi giá mua mới — khách so được ngay và admin chỉ chỉnh một bộ knob.

/**
 * Làm tròn LÊN cent, nhưng cắt nhiễu số thực trước.
 * `1 + 30/30 × 5/100 - 1` ra 0.050000000000000044 → ×100 = 5.000000000000004 →
 * ceil thẳng thành 6 cent, tức thu oan 1 cent trên mỗi lần gia hạn.
 */
function ceilCents(usd) {
    const cents = Number(usd) * 100;
    if (!Number.isFinite(cents) || cents <= 0) return 0;
    return Math.ceil(Number(cents.toFixed(6))) / 100;
}

/**
 * Giá nạp thêm token: token × $/1M × hệ_số_RPM của chính key đó.
 * KHÔNG nhân hệ số ngày — khách không mua thêm thời gian ở đây. (Nếu nhân, key
 * vĩnh viễn sẽ bị tính ×1.5 cho mỗi lần nạp token, vô lý.)
 */
export function priceAddTokens(addTokens, { usdPerMtoken, rpm = 0, factors } = {}) {
    const t = Math.max(0, Number(addTokens) || 0);
    if (t <= 0) return 0;
    const rate = Number(usdPerMtoken) > 0 ? Number(usdPerMtoken) : 0.01;
    const rpmMult = factors ? factors({ rpm, validDays: 1 }).rpmMult : 1;
    return ceilCents((t / 1_000_000) * rate * rpmMult);
}

/**
 * Giá gia hạn ngày = ĐÚNG phần phụ phí ngày mà công thức bán key đã tính:
 * giá_gốc_key × (ngày/30 × daySurchargePct%).
 *
 * Nói cách khác, mua key 30 ngày đắt hơn key 1 ngày bao nhiêu thì gia hạn thêm
 * 29 ngày cũng đúng bấy nhiêu. Giá tính trên quota GỐC của key (khách trả tiền
 * để giữ nguyên bộ quota đó sống thêm), không phải quota còn lại.
 */
export function priceAddDays(addDays, { keyTokens, usdPerMtoken, rpm = 0, factors } = {}) {
    const d = Math.max(0, Math.floor(Number(addDays) || 0));
    const t = Math.max(0, Number(keyTokens) || 0);
    if (d <= 0 || t <= 0) return 0;
    const rate = Number(usdPerMtoken) > 0 ? Number(usdPerMtoken) : 0.01;
    if (!factors) return 0;
    const base = (t / 1_000_000) * rate * factors({ rpm, validDays: 1 }).rpmMult;
    // daysMult(d) - 1 = phần phụ phí thuần của d ngày.
    const extra = factors({ rpm, validDays: d }).daysMult - 1;
    return ceilCents(base * Math.max(0, extra));
}

export default {
    UNLIMITED_QUOTA,
    STAGE_NONE, STAGE_LOW, STAGE_CRITICAL, STAGE_DEAD,
    DEFAULT_THRESHOLDS,
    toProviderQuota,
    toDisplayTokens,
    keyLifecycle,
    nextNotifyStage,
    computeRenewal,
    renewability,
    priceAddTokens,
    priceAddDays,
};
