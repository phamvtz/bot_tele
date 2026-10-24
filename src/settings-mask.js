/**
 * Che secret trước khi trả Setting / provider xuống trình duyệt admin.
 *
 * Bản cũ của GET /settings trả TOÀN BỘ bảng Setting và chỉ xoá tay vài khoá, nên các
 * khoá thêm sau (token adm_* của GPT2API, GPT2API_PROFILES chứa adminToken từng
 * server, api_providers chứa apiKey nhà cung cấp, token Crypto Bot…) lộ nguyên văn
 * trong DevTools / log proxy dù endpoint chuyên biệt đã che đúng. Ở đây mặc định là
 * CHE: khoá nào trông giống secret thì không bao giờ ra khỏi server, chỉ có cờ
 * `<KEY>_SET` để giao diện biết "đã cấu hình hay chưa".
 *
 * File thuần — không I/O, không đọc ENV (caller truyền vào) để test được.
 */

/** Khoá secret đã biết: không trả giá trị, chỉ trả cờ `<KEY>_SET`. */
export const SECRET_SETTING_KEYS = [
    "SEPAY_API_KEY",
    "BINANCE_API_SECRET",
    "BINANCE_PAY_TOKEN",
    "CRYPTOPAY_API_TOKEN",
    "TRONGRID_API_KEY",
    "GPT2API_ADMIN_TOKEN",
];

/** Khoá chứa JSON có secret lồng bên trong — có endpoint riêng, không trả ở đây. */
export const HIDDEN_SETTING_KEYS = ["GPT2API_PROFILES", "api_providers"];

// Bắt cả khoá secret thêm sau này mà quên khai báo. Neo ở CUỐI để không bắt nhầm
// REFERRAL_REWARD_TOKENS_M (số token, không phải secret).
const SECRET_SUFFIX = /(_TOKEN|_SECRET|_PASSWORD)$/i;

export function isHiddenSettingKey(key) {
    return HIDDEN_SETTING_KEYS.includes(key);
}

export function isSecretSettingKey(key) {
    return SECRET_SETTING_KEYS.includes(key) || SECRET_SUFFIX.test(String(key));
}

/**
 * @param settings  object đã gộp env + DB (sẽ KHÔNG bị sửa tại chỗ)
 * @param opts.env  process.env — để biết secret đã được cấu hình qua ENV
 * @param opts.envNames  { KEY: ["ENV_A", "ENV_B"] } khi tên ENV khác tên khoá
 * @returns bản sao đã che: secret → `<KEY>_SET` = "1" | "", khoá hidden bị bỏ
 */
export function maskSettingsForClient(settings = {}, { env = {}, envNames = {} } = {}) {
    const out = { ...settings };

    for (const key of HIDDEN_SETTING_KEYS) delete out[key];

    const secretKeys = new Set([
        ...SECRET_SETTING_KEYS,
        ...Object.keys(out).filter((k) => SECRET_SUFFIX.test(k)),
    ]);
    for (const key of secretKeys) {
        const names = envNames[key] || [key];
        const configured = Boolean(out[key]) || names.some((n) => Boolean(env[n]));
        delete out[key];
        out[`${key}_SET`] = configured ? "1" : "";
    }
    return out;
}

/** Provider API: apiKey không ra khỏi server, chỉ có cờ `apiKeySet`. */
export function maskProviderForClient(provider = {}) {
    return { ...provider, apiKey: "", apiKeySet: Boolean(provider.apiKey) };
}

/**
 * Gộp body PUT provider lên bản đã lưu. apiKey trống/thiếu = GIỮ key cũ (giao diện
 * không bao giờ nhận lại key thật nên ô nhập luôn rỗng — gửi rỗng không có nghĩa xoá).
 */
export function mergeProviderUpdate(existing = {}, body = {}) {
    const { baseUrl, authMode, apiKey, ...rest } = body;
    const next = {
        ...existing,
        ...rest,
        ...(baseUrl ? { baseUrl: String(baseUrl).replace(/\/$/, "") } : {}),
        ...(authMode ? { authMode } : {}),
    };
    if (typeof apiKey === "string" && apiKey.trim()) next.apiKey = apiKey.trim();
    return next;
}
