/**
 * GPT2API Admin Public API client — tạo API key sk-* cho khách.
 *
 * Surface dùng: POST /api/admin-pub/keys (scope key:write).
 * Auth: token adm_* qua header Authorization: Bearer (KHÔNG bao giờ để trong query
 * string — tài liệu nói rõ token trong URL bị từ chối vì rò qua access log).
 *
 * Envelope của gateway: { code, message, data, trace_id }. code === 0 mới là OK;
 * HTTP 200 + code 40000 vẫn là THẤT BẠI (payload sai). Mọi hàm ở đây trả
 * { ok, ... } thay vì throw để caller quyết định hoàn tiền/không.
 */

import { request as httpsReq } from "node:https";
import { request as httpReq } from "node:http";
import prisma from "./lib/prisma.js";
import {
    RPM_INCLUDED, RPM_SURCHARGE_PCT, DAY_SURCHARGE_PCT, NO_EXPIRY_MULT,
    DEFAULT_RPM_PRESETS, DEFAULT_DAYS_PRESETS,
    FREE_MIN_M, FREE_MAX_M, DEFAULT_FREE_ALPHA,
    MAX_BUY_TOKENS, TOKENS_PER_M, DEFAULT_KEY_TPM,
} from "./apikey-pricing.js";
import {
    resolveProfiles, enabledProfiles as filterEnabledProfiles, pickProfile,
    readSourceProfiles, resolveSourceProfileId, normalizeKeySource, KEY_SOURCES,
    KEY_SOURCE_NAMES, sourceSettingKey,
} from "./apikey-profiles.js";
import { computeRenewal } from "./apikey-renew.js";

const SETTING_KEYS = [
    "GPT2API_BASE",
    "GPT2API_ADMIN_TOKEN",
    "GPT2API_USER_ID",
    "GPT2API_ENDPOINT",
    "GPT2API_MODELS",
    "GPT2API_FALLBACK_GROUPS",
    "GPT2API_DOC_URL",
    "GPT2API_KEY_RPM",
    "GPT2API_KEY_TPM",
    "GPT2API_KEY_VALID_DAYS",
    "GPT2API_USD_PER_MTOKEN",
    "GPT2API_BUY_PRESETS_M",
    "GPT2API_USAGE_URL",
    "GPT2API_ENABLED",
    // Phụ phí + giới hạn — trước đây chỉ đọc ENV lúc load module (apikey-pricing.js),
    // giờ chỉnh được trong web admin (tab "Giá & giới hạn").
    "GPT2API_RPM_INCLUDED",
    "GPT2API_RPM_SURCHARGE_PCT",
    "GPT2API_DAY_SURCHARGE_PCT",
    "GPT2API_NO_EXPIRY_MULT",
    "GPT2API_MAX_BUY_M",
    "GPT2API_RPM_PRESETS",
    "GPT2API_DAYS_PRESETS",
    "GPT2API_FREE_MIN_M",
    "GPT2API_FREE_MAX_M",
    "GPT2API_FREE_ALPHA",
    "GPT2API_QUOTA_REF_PRICE",
    "GPT2API_ALLOWED_MODELS_MODE",
    // Nhiều "server" trên cùng một kết nối — JSON mảng, xem apikey-profiles.js.
    "GPT2API_PROFILES",
    // Nguồn key → server (GPT2API_PROFILE_GIFTCODE/REFERRAL/PURCHASE). Danh sách
    // này là WHITELIST của `loadSettings` — quên thêm khoá vào đây thì admin lưu
    // được, `GET /gpt2api/config` đọc thẳng bảng Setting nên UI vẫn hiện đúng,
    // nhưng `getConfig()` KHÔNG BAO GIỜ thấy nó: tính năng chết lặng.
    ...KEY_SOURCE_NAMES.map(sourceSettingKey),
];

let _cache = null;
let _cacheTs = 0;
const TTL = 30_000;

/**
 * `GET /keys` PHÂN TRANG, mặc định 20 mỗi trang — không đọc hết là tưởng nhầm key
 * của khách đã bị xoá bên provider. `page_size` chỉ nhận tới ~100: đưa số lớn hơn
 * (500) nó lặng lẽ rơi về 20, nên đừng "tối ưu" bằng cách tăng con số này.
 */
const KEY_LIST_PAGE_SIZE = 100;
const KEY_LIST_MAX_PAGES = 200;
// Số trang đọc đồng thời. MẶC ĐỊNH 1 (tuần tự): provider GIỚI HẠN TỐC ĐỘ (code 42900
// "too many requests, slow down", đo trên VPS thật) — đọc song song 5 trang làm cả shop bị
// chặn, kể cả tạo key và gia hạn của khách đã trả tiền. Tuần tự ~3 request/giây thì ổn.
// Tăng bằng GPT2API_KEY_LIST_PARALLEL chỉ khi provider nới giới hạn.
const KEY_LIST_PARALLEL = Math.max(1, Math.min(8, Number(process.env.GPT2API_KEY_LIST_PARALLEL) || 1));
// Provider bảo "chậm lại" thì lùi rồi thử lại thay vì bỏ cả lượt đọc.
const RATE_LIMIT_CODES = new Set(["42900", "429"]);
const isRateLimited = (code) => RATE_LIMIT_CODES.has(String(code));
const RATE_LIMIT_BACKOFF_MS = [1200, 2800];

export function invalidateGpt2apiConfig() { _cache = null; _cacheTs = 0; }

async function loadSettings() {
    if (_cache && Date.now() - _cacheTs < TTL) return _cache;
    let map = {};
    try {
        const rows = await prisma.setting.findMany({ where: { key: { in: SETTING_KEYS } } });
        map = Object.fromEntries(rows.map((r) => [r.key, r.value]));
    } catch (err) {
        // Giữ cache cũ nếu có — một lỗi DB thoáng qua không nên làm tính năng
        // rơi về ENV rồi bật/tắt nhảy loạn.
        console.error("[gpt2api] loadSettings failed:", err.message);
        map = _cache || {};
    }
    _cache = map;
    _cacheTs = Date.now();
    return _cache;
}

/** Danh sách model mặc định gửi kèm key + hiện trong hướng dẫn. */
export const DEFAULT_MODELS = [
    "claude-opus-5",
    "claude-opus-4-8",
    "claude-opus-4-7",
    "claude-sonnet-5",
    "claude-sonnet-4-6",
    "claude-haiku-4-5",
    "claude-fable-5",
];

function splitList(value, fallback = []) {
    if (value === undefined || value === null || value === "") return fallback;
    const arr = String(value).split(/[,\s]+/).map((s) => s.trim()).filter(Boolean);
    return arr.length ? arr : fallback;
}

/**
 * Cấu hình đầy đủ. `configured` = có đủ base + token + user_id để gọi API thật.
 */
export async function getConfig() {
    const m = await loadSettings();
    const base = String(m.GPT2API_BASE || process.env.GPT2API_BASE || "").replace(/\/+$/, "");
    const adminToken = m.GPT2API_ADMIN_TOKEN || process.env.GPT2API_ADMIN_TOKEN || "";
    const userId = m.GPT2API_USER_ID || process.env.GPT2API_USER_ID || "";
    const enabledRaw = m.GPT2API_ENABLED ?? process.env.GPT2API_ENABLED;
    const enabled = enabledRaw === undefined || enabledRaw === null || enabledRaw === ""
        ? true
        : String(enabledRaw).toLowerCase() !== "false";

    const shop = {
        base,
        adminToken,
        userId,
        enabled,
        configured: Boolean(base && adminToken && userId),
        // Endpoint khách dùng để gọi model — mặc định suy ra từ base (bỏ /api/admin-pub).
        endpoint: m.GPT2API_ENDPOINT || process.env.GPT2API_ENDPOINT || deriveEndpoint(base),
        models: splitList(m.GPT2API_MODELS ?? process.env.GPT2API_MODELS, DEFAULT_MODELS),
        // Rỗng = KHÔNG gửi fallback_allowed_groups (xem giải thích ở resolveFallbackGroups).
        fallbackGroups: splitList(m.GPT2API_FALLBACK_GROUPS ?? process.env.GPT2API_FALLBACK_GROUPS, []),
        docUrl: m.GPT2API_DOC_URL || process.env.GPT2API_DOC_URL || "",
        usageUrl: m.GPT2API_USAGE_URL || process.env.GPT2API_USAGE_URL || "",
        rpm: toPositiveInt(m.GPT2API_KEY_RPM ?? process.env.GPT2API_KEY_RPM, 100),
        tpm: toPositiveInt(m.GPT2API_KEY_TPM ?? process.env.GPT2API_KEY_TPM, DEFAULT_KEY_TPM),
        validDays: toPositiveInt(m.GPT2API_KEY_VALID_DAYS ?? process.env.GPT2API_KEY_VALID_DAYS, 0),
        usdPerMtoken: toPositiveFloat(m.GPT2API_USD_PER_MTOKEN ?? process.env.GPT2API_USD_PER_MTOKEN, 0.01),
        buyPresetsM: parsePresets(m.GPT2API_BUY_PRESETS_M ?? process.env.GPT2API_BUY_PRESETS_M),

        // ── Quy đổi token → quota_limit gửi lên xpiki ──────────────────────────
        // xpiki lưu credit = quota_limit / 10.000, và panel hiện
        //   tokens(Opus5) = credit / <giá Opus5 /1M> × 1.000.000  = quota_limit × 100/giá
        // Muốn "10M token" trên bot = "10M token" trong panel xpiki thì phải gửi
        //   quota_limit = round(token × giá / 100).  giá Opus5 hiện = 15.
        // Đặt = 0 để tắt quy đổi (gửi token thô như trước).
        quotaRefPrice: numOr(m.GPT2API_QUOTA_REF_PRICE ?? process.env.GPT2API_QUOTA_REF_PRICE, 15, { min: 0 }),
        // "all" = không gửi allowed_models (key xài mọi model group cho phép).
        // "restrict" = giới hạn theo GPT2API_MODELS.
        allowedModelsMode: String(m.GPT2API_ALLOWED_MODELS_MODE ?? process.env.GPT2API_ALLOWED_MODELS_MODE ?? "all")
            .trim().toLowerCase() === "restrict" ? "restrict" : "all",

        // ── Phụ phí giá (đọc bởi keyPriceFactors/priceUsdForKey qua tham số) ──
        rpmIncluded: numOr(m.GPT2API_RPM_INCLUDED ?? process.env.GPT2API_RPM_INCLUDED, RPM_INCLUDED, { min: 1, int: true }),
        rpmSurchargePct: numOr(m.GPT2API_RPM_SURCHARGE_PCT ?? process.env.GPT2API_RPM_SURCHARGE_PCT, RPM_SURCHARGE_PCT, { min: 0 }),
        daySurchargePct: numOr(m.GPT2API_DAY_SURCHARGE_PCT ?? process.env.GPT2API_DAY_SURCHARGE_PCT, DAY_SURCHARGE_PCT, { min: 0 }),
        noExpiryMult: numOr(m.GPT2API_NO_EXPIRY_MULT ?? process.env.GPT2API_NO_EXPIRY_MULT, NO_EXPIRY_MULT, { min: 1 }),
        // Trần token khách được mua (đơn vị token). Rỗng/vô lý → giữ trần .env/mặc định.
        maxBuyTokens: resolveMaxBuyTokens(m.GPT2API_MAX_BUY_M ?? process.env.GPT2API_MAX_BUY_M),
        // Gói preset cho bước RPM / số ngày (chỉ là nút bấm sẵn, không giới hạn).
        rpmPresets: parseIntList(m.GPT2API_RPM_PRESETS ?? process.env.GPT2API_RPM_PRESETS, DEFAULT_RPM_PRESETS),
        daysPresets: parseIntList(m.GPT2API_DAYS_PRESETS ?? process.env.GPT2API_DAYS_PRESETS, DEFAULT_DAYS_PRESETS),
        // Miền quota mặc định cho giftcode APIKEY khi mã không tự đặt.
        freeMinM: numOr(m.GPT2API_FREE_MIN_M ?? process.env.GPT2API_FREE_MIN_M, FREE_MIN_M, { min: 1, int: true }),
        freeMaxM: numOr(m.GPT2API_FREE_MAX_M ?? process.env.GPT2API_FREE_MAX_M, FREE_MAX_M, { min: 1, int: true }),
        freeAlpha: numOr(m.GPT2API_FREE_ALPHA ?? process.env.GPT2API_FREE_ALPHA, DEFAULT_FREE_ALPHA, { min: 0 }),
    };

    // Profile ("server") — mỗi cái là chính `shop` này với nhóm fallback + bộ giá
    // riêng đè lên. Chưa cấu hình → đúng 1 profile dựng từ cấu hình phẳng, nên
    // shop một server chạy y như trước khi có tính năng này.
    shop.profiles = resolveProfiles(m.GPT2API_PROFILES ?? process.env.GPT2API_PROFILES, shop);

    // Nguồn nào cấp key trên server nào. null = chưa chỉ định → server đầu tiên
    // đang bật (hành vi trước khi có tính năng này), nên shop chưa cấu hình gì
    // chạy y hệt cũ, không cần migration.
    shop.sourceProfiles = readSourceProfiles((key) => m[key] ?? process.env[key]);
    return shop;
}

/**
 * Server dùng để cấp key cho một nguồn ("giftcode" | "referral" | "purchase",
 * không phân biệt hoa thường nên `KeySource.GIFTCODE` cũng dùng được).
 * Trả `null` khi admin chưa chọn — caller cứ truyền thẳng vào `createApiKey`,
 * `pickProfile` sẽ rơi về server đầu tiên đang bật.
 */
export async function getSourceProfileId(source) {
    // Nguồn viết sai (typo, hoặc một enum thứ ba nào đó sau này) trả null y hệt
    // "chưa cấu hình" → key lặng lẽ cấp sai server. Kêu to ở đây để còn thấy.
    if (!normalizeKeySource(source)) {
        console.error(`[gpt2api] getSourceProfileId: nguồn không hợp lệ "${source}" — bỏ qua định tuyến server`);
        return null;
    }
    const cfg = await getConfig();
    return resolveSourceProfileId(cfg.sourceProfiles, source, cfg.profiles || []);
}

/**
 * Danh sách profile HIỆU LỰC. `onlyEnabled` = cái khách được thấy khi mua;
 * để false khi cần tra cứu profile của một đơn cũ trỏ tới profile đã tắt.
 */
export async function getProfiles({ onlyEnabled = false } = {}) {
    const cfg = await getConfig();
    const list = cfg.profiles || [];
    return onlyEnabled ? filterEnabledProfiles(list) : list;
}

/**
 * Cấu hình hiệu lực của MỘT profile — dùng thay `getConfig()` ở mọi chỗ báo giá
 * và tạo key, vì giá/RPM/trần mua giờ thuộc về profile chứ không còn của shop.
 * Id không tồn tại → profile đầu tiên đang bật (xem pickProfile).
 */
export async function getProfileConfig(profileId) {
    const cfg = await getConfig();
    return pickProfile(cfg.profiles || [], profileId) || cfg;
}

// Đọc số từ Setting/ENV. Rỗng ("" / null / undefined) hoặc ngoài ràng buộc →
// fallback. `min` là chặn dưới (bao gồm); `int` = làm tròn xuống.
function numOr(value, fallback, { min = -Infinity, int = false } = {}) {
    if (value === undefined || value === null || value === "") return fallback;
    let n = Number(value);
    if (!Number.isFinite(n) || n < min) return fallback;
    return int ? Math.floor(n) : n;
}
function parseIntList(value, fallback) {
    if (value === undefined || value === null || value === "") return fallback;
    const arr = String(value).split(/[,\s]+/).map((x) => Math.floor(Number(x))).filter((x) => Number.isFinite(x) && x > 0);
    return arr.length ? arr.slice(0, 12) : fallback;
}
function resolveMaxBuyTokens(value) {
    if (value === undefined || value === null || value === "") return MAX_BUY_TOKENS;
    const m = Number(value);
    return Number.isFinite(m) && m > 0 ? Math.floor(m) * TOKENS_PER_M : MAX_BUY_TOKENS;
}

/** "1,5,10,20" hoặc "[1,5,10]" → [1,5,10,20]. Rỗng/sai → [] (caller dùng mặc định). */
function parsePresets(value) {
    if (value === undefined || value === null || value === "") return [];
    const raw = String(value).trim();
    let arr;
    try {
        arr = raw.startsWith("[") ? JSON.parse(raw) : raw.split(/[,\s]+/);
    } catch {
        arr = raw.split(/[,\s]+/);
    }
    return (Array.isArray(arr) ? arr : [])
        .map((x) => Math.floor(Number(x)))
        .filter((x) => Number.isFinite(x) && x > 0)
        .slice(0, 12);
}

/** Sync — chỉ dùng ở chỗ không await được (dựng bàn phím). Cache nguội thì trả ENV. */
export function isGpt2apiEnabledSync() {
    const m = _cache || {};
    const enabledRaw = m.GPT2API_ENABLED ?? process.env.GPT2API_ENABLED;
    const enabled = enabledRaw === undefined || enabledRaw === null || enabledRaw === ""
        ? true
        : String(enabledRaw).toLowerCase() !== "false";
    const base = m.GPT2API_BASE || process.env.GPT2API_BASE || "";
    const token = m.GPT2API_ADMIN_TOKEN || process.env.GPT2API_ADMIN_TOKEN || "";
    const userId = m.GPT2API_USER_ID || process.env.GPT2API_USER_ID || "";
    return enabled && Boolean(base && token && userId);
}

/** Warm cache lúc khởi động — để isGpt2apiEnabledSync() đúng ngay từ đầu. */
export async function warmGpt2apiConfig() {
    await loadSettings();
}

function deriveEndpoint(base) {
    if (!base) return "";
    // "https://api.xpiki.com/api/admin-pub" → "https://api.xpiki.com/v1"
    try {
        const u = new URL(base);
        return `${u.origin}/v1`;
    } catch {
        return "";
    }
}

function toPositiveInt(value, fallback) {
    const n = Number(value);
    return Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback;
}

function toPositiveFloat(value, fallback) {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? n : fallback;
}

// ─── HTTP ─────────────────────────────────────────────────────────────────────
function httpJson(method, url, { token, body = null, timeoutMs = 30_000 } = {}) {
    return new Promise((resolve, reject) => {
        let parsedUrl;
        try { parsedUrl = new URL(url); }
        catch { return reject(new Error(`URL không hợp lệ: ${url}`)); }

        const mod = parsedUrl.protocol === "https:" ? httpsReq : httpReq;
        const bodyStr = body ? JSON.stringify(body) : null;
        const headers = { Accept: "application/json" };
        if (token) headers.Authorization = `Bearer ${token}`;
        if (bodyStr) {
            headers["Content-Type"] = "application/json";
            headers["Content-Length"] = Buffer.byteLength(bodyStr);
        }

        const req = mod({
            hostname: parsedUrl.hostname,
            port: parsedUrl.port || (parsedUrl.protocol === "https:" ? 443 : 80),
            path: parsedUrl.pathname + parsedUrl.search,
            method,
            headers,
            // KHÔNG tắt kiểm tra certificate: request này mang token adm_* có quyền
            // tạo key trên tài khoản của shop.
        }, (res) => {
            let data = "";
            res.on("data", (c) => { data += c; });
            res.on("end", () => {
                let parsed = null;
                try { parsed = JSON.parse(data); }
                catch { /* để caller xử lý — có thể là HTML lỗi proxy */ }
                resolve({ status: res.statusCode, json: parsed, raw: data.slice(0, 500) });
            });
        });

        req.setTimeout(timeoutMs, () => {
            req.destroy();
            reject(new Error(`GPT2API timeout (${Math.round(timeoutMs / 1000)}s)`));
        });
        req.on("error", (e) => reject(new Error(e.message)));
        if (bodyStr) req.write(bodyStr);
        req.end();
    });
}

/**
 * Chuẩn hoá response của POST /keys. Thuần (không I/O) để test được.
 *
 * Tài liệu: HTTP 200 + code 40000 nghĩa là payload sai — VẪN là thất bại.
 * 401/403 là auth/scope. Chỉ code === 0 và có data.key mới coi là thành công.
 */
export function isSafeApiKeyCreateFailure(result = {}) {
    if (result?.ok) return false;
    if (result?.providerMutationPossible === false) return true;
    const code = String(result?.code ?? "").toLowerCase();
    if (!code) return false;
    if (["network", "no_key_in_response"].includes(code)) return false;
    if (/^http_5\d\d$/.test(code)) return false;
    return true;
}

export function parseCreateKeyResponse(status, json, raw = "") {
    if (status === 401) {
        const code = json?.error?.code || "invalid_admin_key";
        return { ok: false, code, message: json?.error?.message || "Token admin GPT2API không hợp lệ hoặc đã hết hạn" };
    }
    if (status === 403) {
        return { ok: false, code: "scope_denied", message: json?.error?.message || json?.message || "Token admin thiếu scope key:write hoặc IP bị chặn" };
    }
    if (status === 429) {
        return { ok: false, code: "rate_limited", message: json?.message || "GPT2API đang giới hạn tốc độ, thử lại sau" };
    }
    if (!json || typeof json !== "object") {
        return { ok: false, code: `http_${status}`, message: `GPT2API trả về dữ liệu không phải JSON (HTTP ${status}): ${raw}` };
    }
    if (json.code !== 0) {
        return {
            ok: false,
            code: json.code ?? `http_${status}`,
            message: json.message || `GPT2API lỗi (code ${json.code})`,
            traceId: json.trace_id || null,
        };
    }

    const d = json.data || {};
    const key = d.key || d.api_key || d.apiKey || "";
    if (!key) {
        // code=0 mà không có key → vẫn là thất bại, đừng để khách trả tiền mà tay trắng.
        return { ok: false, code: "no_key_in_response", message: "GPT2API không trả về key", traceId: json.trace_id || null };
    }
    return {
        ok: true,
        key,
        id: d.id ?? null,
        name: d.name ?? null,
        keyPrefix: d.key_prefix ?? null,
        createdAt: d.created_at ?? null,
        // Server tính ngày hết hạn từ expires_in_days. Nếu nó trả về thì ưu tiên
        // dùng, khỏi lệch múi giờ/giây so với việc bot tự cộng ngày.
        expiresAt: d.expires_at ?? d.expiresAt ?? null,
        traceId: json.trace_id || null,
    };
}

/**
 * Quyết định gửi fallback_allowed_groups thế nào.
 *
 * Yêu cầu nghiệp vụ là "mặc định chọn TẤT CẢ group đang có".
 *
 * LỊCH SỬ: tài liệu admin-pub nói không có endpoint liệt kê group id và
 * fallback_allowed_groups sẽ được "clamped to the groups the key owner may use",
 * nên bản đầu BỎ HẲN field khi admin không cấu hình. Server thật (api.xpiki.com)
 * từ chối: HTTP 200 + `{"code":40000,"message":"fallback_allowed_groups is
 * required: pick at least one fallback group"}` → mọi đơn đều hoàn tiền
 * (đơn 8D664972, 2026-08-30). Và `GET /api/admin-pub/model-groups` THỰC SỰ tồn
 * tại, trả đủ public_id.
 *
 * Nên bây giờ: admin cấu hình GPT2API_FALLBACK_GROUPS thì dùng đúng danh sách đó;
 * để TRỐNG thì createApiKey tự gọi listModelGroups() lấy TẤT CẢ group rồi truyền
 * vào đây. `omit` chỉ còn xảy ra khi cả hai đường đều rỗng — giữ lại để hàm vẫn
 * thuần và để server nào không đòi field này vẫn chạy được.
 */
export function resolveFallbackGroups(configuredGroups = []) {
    const groups = (configuredGroups || []).filter(Boolean);
    if (!groups.length) return { omit: true, groups: [], order: [] };
    return { omit: false, groups, order: groups };
}

// Catalog group đổi rất ít nhưng lại nằm trên đường đi của MỌI đơn key → cache
// riêng, TTL dài hơn config. Rỗng KHÔNG được cache: lần sau phải thử lại, không
// thì một lỗi mạng thoáng qua làm cả 10 phút không bán được key nào.
let _groupsCache = null;
let _groupsTs = 0;
const GROUPS_TTL = 300_000;

export function invalidateGpt2apiGroups() { _groupsCache = null; _groupsTs = 0; }

/**
 * Liệt kê model group của tài khoản. Trả { ok, groups: [{ id, name, order }] }.
 * KHÔNG throw — caller coi thất bại là "không lấy được danh sách".
 */
export async function listModelGroups({ force = false } = {}) {
    const cfg = await getConfig();
    if (!cfg.configured) return { ok: false, code: "not_configured", groups: [] };

    if (!force && _groupsCache && Date.now() - _groupsTs < GROUPS_TTL) {
        return { ok: true, groups: _groupsCache, cached: true };
    }

    let res;
    try {
        res = await httpJson("GET", `${cfg.base}/model-groups`, { token: cfg.adminToken });
    } catch (err) {
        return { ok: false, code: "network", message: err.message, groups: [] };
    }

    const json = res.json;
    if (!json || typeof json !== "object") {
        return { ok: false, code: `http_${res.status}`, message: `model-groups trả về không phải JSON: ${res.raw}`, groups: [] };
    }
    if (json.code !== 0) {
        return { ok: false, code: json.code ?? `http_${res.status}`, message: json.message || "model-groups lỗi", groups: [] };
    }

    // data.list là dạng thật của server; đỡ thêm vài dạng khác cho chắc.
    const list = Array.isArray(json.data?.list) ? json.data.list
        : Array.isArray(json.data) ? json.data
            : Array.isArray(json.data?.groups) ? json.data.groups : [];

    const groups = list
        .map((g) => ({
            id: g.public_id ?? g.publicId ?? g.id ?? "",
            name: g.name ?? "",
            order: Number(g.order_index ?? g.orderIndex ?? 0) || 0,
        }))
        .filter((g) => g.id)
        // order_index rồi tên — để fallback_order tất định, không phụ thuộc thứ tự
        // server trả về (đổi thứ tự nghĩa là key mới ưu tiên group khác key cũ).
        .sort((a, b) => (a.order - b.order) || a.name.localeCompare(b.name));

    if (groups.length) {
        _groupsCache = groups;
        _groupsTs = Date.now();
    }
    return { ok: true, groups };
}

/**
 * Dựng body cho POST /keys. Thuần — test được không cần mạng.
 */
export function buildCreateKeyBody({
    userId, name, quotaTokens, rpm = 0, tpm = 0, validDays = 0,
    models = [], fallbackGroups = [],
    quotaRefPrice = 0,      // >0: quota_limit = round(token × giá / 100). 0: gửi token thô.
    restrictModels = false, // false: KHÔNG gửi allowed_models (All models).
}) {
    const rawTokens = Math.max(0, Math.floor(Number(quotaTokens) || 0));
    const price = Number(quotaRefPrice);
    // ⚠️ quota_limit = 0 nghĩa là KHÔNG GIỚI HẠN trên xpiki. Khi quy đổi, số token
    // rất nhỏ (× giá / 100 < 0.5) làm tròn về 0 → key vô hạn. Chặn sàn ở 1.
    const quotaLimit = Number.isFinite(price) && price > 0 && rawTokens > 0
        ? Math.max(1, Math.round(rawTokens * price / 100))
        : rawTokens;
    const body = {
        user_id: String(userId),
        name: String(name).slice(0, 128),
        quota_limit: quotaLimit,
    };
    if (rpm > 0) body.rpm = Math.floor(rpm);
    if (tpm > 0) body.tpm = Math.floor(tpm);
    // expires_in_days: bỏ qua nếu 0 → key không hết hạn theo thời gian, chỉ theo quota.
    if (validDays > 0) body.expires_in_days = Math.floor(validDays);
    if (restrictModels && models.length) body.allowed_models = models;

    const fb = resolveFallbackGroups(fallbackGroups);
    if (!fb.omit) {
        body.fallback_allowed_groups = fb.groups;
        body.fallback_order = fb.order;
    }
    return body;
}

// === Tự phục hồi khi tạo key gặp lỗi tạm thời =================================
// Sự cố thật (đơn C293E146, 1 tỷ token, 271.110đ đã thu tiền): provider trả HTTP 503
// thoáng qua. Bot chỉ gọi tạo key MỘT lần và coi 5xx là "không biết đã tạo hay chưa"
// nên khoá đơn chờ admin soát tay — trong khi provider KHÔNG hề tạo key và khách mua
// lại 6 phút sau là chạy bình thường.
//
// Sự thật đã xác minh trên provider thật: `GET /keys` trả ĐỦ chuỗi `sk-*` (không che),
// sắp xếp key mới nhất trước, và tên key là `order-<mã đơn>` — duy nhất. Nên "không
// chắc" có thể được GIẢI QUYẾT thay vì phải đoán:
//   - tra theo tên: CÓ key → nhận lại đúng chuỗi sk-* đó và giao (không cấp trùng);
//   - tra theo tên: CHẮC CHẮN chưa có → thử tạo lại an toàn, không thể trùng;
//   - không tra được (provider vẫn lỗi) → giữ hành vi cũ: khoá đơn, admin soát tay.

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Lỗi tạm thời đáng thử lại: 5xx, mất kết nối, thiếu key trong phản hồi, bị giới hạn tốc độ. */
export function isRetryableCreateFailure(result = {}) {
    if (result?.ok) return false;
    const code = String(result?.code ?? "").toLowerCase();
    return ["rate_limited", "network", "no_key_in_response"].includes(code) || /^http_5\d\d$/.test(code);
}

/**
 * Dòng key có tên khớp tuyệt đối và có chuỗi key đầy đủ, hoặc null.
 * `notBefore` (ms): bỏ qua key tạo TRƯỚC mốc này — một key trùng tên từ quá khứ không
 * bao giờ được nhận nhầm làm key của lượt tạo hiện tại (sẽ giao một chuỗi sk-* cũ
 * cho khách mới). Không rõ thời điểm tạo thì cũng bỏ qua.
 */
export function pickKeyByName(rows, name, { notBefore = null } = {}) {
    if (!Array.isArray(rows) || !name) return null;
    return rows.find((r) => {
        if (!r || r.name !== name || !r.key) return false;
        if (notBefore === null) return true;
        const t = new Date(goTimeToIso(r.created_at) || NaN).getTime();
        return Number.isFinite(t) && t >= notBefore;
    }) || null;
}

/** Dòng key của provider → cùng dạng kết quả với `parseCreateKeyResponse` thành công. */
export function rowToCreatedKey(row = {}) {
    return {
        ok: true,
        key: row.key,
        id: row.public_id || row.id_str || null,
        name: row.name ?? null,
        keyPrefix: row.key_prefix ?? null,
        createdAt: goTimeToIso(row.created_at),
        expiresAt: goTimeToIso(row.expires_at),
        traceId: null,
        recovered: true,
    };
}

/**
 * Trang danh sách đã trôi qua mốc `notBeforeMs` chưa? Chỉ tin khi trang xếp mới→cũ
 * (đúng như đã xác minh); trang không xếp thứ tự thì trả false để quét tiếp, tuyệt
 * đối không kết luận "không có" dựa trên giả định sai.
 */
export function pageOlderThan(list, notBeforeMs) {
    if (!Array.isArray(list) || !list.length || !Number.isFinite(notBeforeMs)) return false;
    const times = list.map((r) => new Date(goTimeToIso(r?.created_at) || NaN).getTime());
    if (times.some((t) => !Number.isFinite(t))) return false;
    for (let i = 1; i < times.length; i++) if (times[i] > times[i - 1]) return false;
    return times[times.length - 1] < notBeforeMs;
}

/**
 * Tra key theo TÊN trên provider.
 *   { ok: true, found: true, row }   — có key (kèm chuỗi sk-* đầy đủ)
 *   { ok: true, found: false }       — CHẮC CHẮN chưa có (đã quét hết vùng liên quan)
 *   { ok: false, code }              — không tra được → KHÔNG được kết luận gì
 * `notBefore` (ms): chỉ cần quét tới các key tạo trước mốc này — danh sách xếp mới nhất
 * trước nên key của đơn đang xử lý chắc chắn nằm ở những trang đầu.
 */
export async function findKeyByName(name, { profileId = null, notBefore = null, maxPages = 5 } = {}) {
    const cfg = await getProfileConfig(profileId);
    if (!cfg.configured) return { ok: false, code: "not_configured" };
    const limit = notBefore ? maxPages : KEY_LIST_MAX_PAGES;
    try {
        for (let page = 1; page <= limit; page++) {
            const { status, json } = await httpJson(
                "GET", `${cfg.base}/keys?page=${page}&page_size=${KEY_LIST_PAGE_SIZE}`,
                { token: cfg.adminToken, timeoutMs: 20_000 },
            );
            const list = json?.data?.list;
            if (json?.code !== 0 || !Array.isArray(list)) {
                return { ok: false, code: json?.code ?? `http_${status}`, message: json?.message || `HTTP ${status}` };
            }
            const row = pickKeyByName(list, name, { notBefore });
            if (row) return { ok: true, found: true, row };
            if (list.length < KEY_LIST_PAGE_SIZE) return { ok: true, found: false };
            if (notBefore && pageOlderThan(list, notBefore)) return { ok: true, found: false };
        }
        return { ok: false, code: "scan_limit" };
    } catch (err) {
        return { ok: false, code: "network", message: err.message };
    }
}

/**
 * Điều phối tạo key + tự phục hồi. Thuần về mặt điều khiển (post/find/sleep truyền vào)
 * nên test được không cần mạng.
 *
 * @param post   () => kết quả kiểu createApiKey (đã gồm profileId/profileName)
 * @param find   () => kết quả của findKeyByName
 * @returns kết quả createApiKey. Thêm:
 *   - `recovered: true`      key đã được tạo ở lần trước, nhận lại bằng cách tra tên
 *   - `attempts`             số lần gọi tạo key
 *   - `verifiedNoKey: true`  hết lượt mà đã XÁC MINH provider không có key → với
 *                            providerMutationPossible:false, hoàn tiền là an toàn
 */
export async function createKeyWithRecovery({
    post, find, sleep = defaultSleep, delaysMs = [1500, 4000], lookupDelayMs = 1200,
} = {}) {
    const maxAttempts = delaysMs.length + 1;
    let last = null;
    let verifiedAbsent = false;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        last = await post();
        if (last?.ok) return attempt > 1 ? { ...last, attempts: attempt } : last;
        if (!isRetryableCreateFailure(last)) return { ...last, attempts: attempt };

        verifiedAbsent = false;
        // 429: provider TỪ CHỐI request nên chắc chắn chưa tạo — không cần tra, chỉ chờ.
        if (String(last.code).toLowerCase() !== "rate_limited") {
            await sleep(lookupDelayMs); // cho provider kịp ghi nhận trước khi tra
            const found = await find();
            if (found?.ok && found.found) {
                // Không spread `last`: code/message của lần lỗi không được lẫn vào kết quả thành công.
                return {
                    ...rowToCreatedKey(found.row),
                    profileId: last.profileId ?? null,
                    profileName: last.profileName || "",
                    providerMutationPossible: true,
                    attempts: attempt,
                };
            }
            // Không tra được thì KHÔNG đoán: trả đúng lỗi mơ hồ, đơn bị giữ cho admin.
            if (!found?.ok) return { ...last, lookupFailed: found?.code || "unknown", attempts: attempt };
            verifiedAbsent = true;
        }
        if (attempt < maxAttempts) await sleep(delaysMs[attempt - 1]);
    }

    return verifiedAbsent
        ? { ...last, providerMutationPossible: false, verifiedNoKey: true, attempts: maxAttempts }
        : { ...last, attempts: maxAttempts };
}

/**
 * Tạo key thật. Trả { ok, key, ... } hoặc { ok: false, code, message }.
 * KHÔNG throw khi API trả lỗi — chỉ throw nếu chưa cấu hình (lỗi lập trình/vận hành).
 */
export async function createApiKey({
    quotaTokens, name, rpm, tpm, validDays, models, fallbackGroups, profileId,
    // Cho phép cấp key từ server ĐANG TẮT. Dùng ở đường GIAO HÀNG (đơn đã trừ
    // tiền) và ở nút cấp key thủ công của admin — hai chỗ mà "server này ngừng
    // bán" không được biến thành "không cấp key nữa".
    allowDisabledProfile = false,
} = {}) {
    // Profile quyết định nhóm fallback + quy đổi quota + RPM/ngày mặc định. Không
    // truyền profileId (giftcode/referral cũ, đơn cũ) → profile đầu tiên đang bật.
    const cfg = await getProfileConfig(profileId);
    // Tắt MỘT server ≠ tắt cửa hàng. Nếu gộp hai cái ở đây thì admin tắt server 2
    // là mọi đơn server 2 đã thanh toán mà chưa giao xong (kể cả lượt retry của
    // delivery-recovery) rơi vào nhánh lỗi → hoàn tiền + huỷ đơn, khách mất hàng.
    const on = allowDisabledProfile
        ? (cfg.shopEnabled !== undefined ? cfg.shopEnabled : cfg.enabled !== false)
        : cfg.enabled !== false;
    if (!on) return { ok: false, code: "disabled", message: "Tính năng API key đang tắt" };
    if (!cfg.configured) {
        return {
            ok: false,
            code: "not_configured",
            message: "Chưa cấu hình GPT2API (cần GPT2API_BASE, GPT2API_ADMIN_TOKEN, GPT2API_USER_ID)",
        };
    }

    // Server ĐÒI fallback_allowed_groups (code 40000 nếu thiếu). Admin không cấu
    // hình thì lấy TẤT CẢ group của tài khoản — đúng ý "mặc định chọn tất cả".
    let groups = (fallbackGroups ?? cfg.fallbackGroups ?? []).filter(Boolean);
    if (!groups.length) {
        const listed = await listModelGroups();
        groups = listed.groups.map((g) => g.id);
        if (!groups.length) {
            // Không có group nào thì key sinh ra cũng không gọi được model nào →
            // báo lỗi rõ ràng ở đây tốt hơn để provider trả 40000 khó hiểu.
            return {
                ok: false,
                code: listed.code || "no_fallback_groups",
                message: listed.message
                    || "Không lấy được danh sách model group từ GPT2API. Đặt GPT2API_FALLBACK_GROUPS để chỉ định thủ công.",
                // Chua POST /keys, provider chac chan chua tao key. Caller co the
                // hoan tien/nha suat an toan du loi preflight mang code network.
                providerMutationPossible: false,
            };
        }
    }

    // Tên cố định cho CẢ các lần thử: đó là khoá để tra lại key khi provider trả lỗi mơ hồ.
    const keyName = name || `bot-${Date.now()}`;
    const startedAt = Date.now() - 5 * 60_000; // lề cho lệch đồng hồ giữa bot và provider
    const body = buildCreateKeyBody({
        userId: cfg.userId,
        name: keyName,
        quotaTokens,
        rpm: rpm ?? cfg.rpm,
        tpm: (tpm !== undefined && Number(tpm) > 0) ? Number(tpm) : (cfg.tpm && Number(cfg.tpm) > 0 ? Number(cfg.tpm) : DEFAULT_KEY_TPM),
        validDays: validDays ?? cfg.validDays,
        models: models ?? cfg.models,
        fallbackGroups: groups,
        quotaRefPrice: cfg.quotaRefPrice,
        restrictModels: cfg.allowedModelsMode === "restrict",
    });

    const post = async () => {
        try {
            const { status, json, raw } = await httpJson("POST", `${cfg.base}/keys`, {
                token: cfg.adminToken,
                body,
            });
            // Kèm profile đã dùng để caller ghi vào IssuedApiKey — không có nó thì
            // sau này không tra được key nào ra từ server nào.
            return {
                ...parseCreateKeyResponse(status, json, raw),
                profileId: cfg.profileId ?? null,
                profileName: cfg.profileName || "",
                // Request tao key da roi process. Timeout/no-key/5xx co the xay ra
                // sau khi provider da tao key nen caller khong duoc tu rollback — chi
                // createKeyWithRecovery moi duoc ket luan sau khi tra theo ten.
                providerMutationPossible: true,
            };
        } catch (err) {
            return {
                ok: false, code: "network", message: err.message, providerMutationPossible: true,
                profileId: cfg.profileId ?? null, profileName: cfg.profileName || "",
            };
        }
    };

    const result = await createKeyWithRecovery({
        post,
        find: () => findKeyByName(keyName, { profileId: cfg.profileId ?? profileId, notBefore: startedAt }),
    });
    if (result.recovered || result.attempts > 1) {
        console.warn(`[gpt2api] createApiKey "${keyName}": ${result.recovered ? "NHẬN LẠI key đã tạo" : "thử lại thành công/hết lượt"} sau ${result.attempts} lần (${result.ok ? "ok" : result.code})`);
    }
    return result;
}

// === Đọc & gia hạn key đã cấp ================================================
// Ba endpoint dưới đây KHÔNG có trong tài liệu admin-pub nhưng đã xác minh bằng
// probe thật trên tài khoản shop (2026-09-05):
//   GET   /keys              → data.list[] có quota_limit + quota_used của MỌI key
//   GET   /keys/{public_id}  → thêm expires_at, enabled, rpm, last_used_at
//   PATCH /keys/{public_id}  → nhận quota_limit, expires_at (RFC3339), rpm, tpm, enabled
// Cảnh báo: PATCH BỎ QUA field lạ mà vẫn trả code 0 (đã thử `expires_in_days`,
// `valid_days`… đều "thành công" nhưng không đổi gì) → không được tin code trả
// về, phải ĐỌC LẠI để xác nhận. Xem renewApiKey.

/** {Time, Valid} kiểu Go → ISO string hoặc null. Provider trả cả hai dạng. */
function goTimeToIso(v) {
    if (v == null) return null;
    if (typeof v === "string") return v || null;
    if (typeof v === "object") {
        if (v.Valid === false) return null;
        return v.Time || null;
    }
    return null;
}

/** Chuỗi kiểu Go `sql.NullString`: `{String, Valid}`. Valid=false → rỗng. */
function goStringOf(v) {
    if (v == null) return "";
    if (typeof v === "string") return v;
    if (typeof v === "object") return v.Valid === false ? "" : String(v.String || "");
    return "";
}

/**
 * Một dòng key phía provider → dạng dùng trong bot.
 *
 * `GET /keys` (danh sách) trả ĐỦ mọi field, không thiếu gì so với `GET /keys/{id}`
 * — kể cả expires_at, tpm, effective_*, last_used_at. Nhờ vậy bảng "Key đã cấp"
 * của admin dựng được số liệu sống mà không cần mỗi key một request.
 */
function normalizeKeyRow(d = {}) {
    const int = (v) => Math.max(0, Math.floor(Number(v) || 0));
    return {
        externalId: d.public_id || d.id_str || null,
        name: d.name || "",
        quotaLimit: int(d.quota_limit),
        quotaUsed: int(d.quota_used),
        expiresAt: goTimeToIso(d.expires_at),
        lastUsedAt: goTimeToIso(d.last_used_at),
        enabled: d.enabled !== false,
        rpm: int(d.rpm),
        tpm: int(d.tpm),
        // Giới hạn THỰC TẾ đang áp: key để rpm/tpm = 0 nghĩa là theo mức của tài
        // khoản, nên số 0 ở trên không có nghĩa "chặn hết".
        effectiveRpm: int(d.effective_rpm),
        effectiveTpm: int(d.effective_tpm),
        lastUsedIp: d.last_used_ip || "",
        lockReason: goStringOf(d.lock_reason),
        lockedAt: goTimeToIso(d.locked_at),
        providerCreatedAt: goTimeToIso(d.created_at),
    };
}

/**
 * listKeyStatuses nhưng có cache ngắn. Một lượt quét giờ tốn 4 request HTTP
 * (382 key / 100 mỗi trang), mà màn /mykey gọi lại mỗi lần khách bấm nút lọc và
 * bảng admin gọi mỗi lần đổi trang — không cache là mỗi cú bấm 4 request.
 */
//
// Một lượt đọc toàn bộ key tốn 12–15 giây khi shop có ~3.300 key (đo trên VPS thật), nên
// màn "API key của tôi" từng treo cả chục giây mỗi khi cache hết hạn. Ba lớp xử lý:
//   1. single-flight — nhiều người bấm cùng lúc dùng CHUNG một lượt đọc, không mỗi người một lượt;
//   2. stale-while-revalidate — có số liệu cũ (≤ staleMs) thì trả NGAY và làm mới ngầm;
//   3. `generation` — sau gia hạn (invalidate) lượt đọc đang bay từ trước không được ghi
//      đè lại bản cũ vào cache.
const _keyStatusCache = new Map(); // profileId → { at, value, lastAccess }
const _keyStatusInflight = new Map(); // profileId → Promise
let _keyStatusGen = 0;

function refreshKeyStatuses(k, profileId) {
    const running = _keyStatusInflight.get(k);
    if (running) return running;
    const gen = _keyStatusGen;
    const p = listKeyStatuses(profileId)
        .then((value) => {
            // KHÔNG cache lần đọc hỏng: một lỗi mạng thoáng qua không được làm cả phút
            // sau đó nhìn đâu cũng thấy "không có số liệu".
            if (value?.ok && gen === _keyStatusGen) {
                _keyStatusCache.set(k, { at: Date.now(), value, lastAccess: Date.now() });
            }
            return value;
        })
        .finally(() => { _keyStatusInflight.delete(k); });
    _keyStatusInflight.set(k, p);
    return p;
}

/**
 * @param staleMs  cho phép trả bản cũ tới tuổi này (và làm mới ngầm). 0 = luôn chờ bản mới
 *                 khi quá `ttlMs` (hành vi cũ — trang admin cần số liệu tươi).
 */
export async function listKeyStatusesCached(profileId = null, ttlMs = 60_000, { staleMs = 0 } = {}) {
    const k = String(profileId ?? "");
    const hit = _keyStatusCache.get(k);
    const age = hit ? Date.now() - hit.at : Infinity;
    if (hit) hit.lastAccess = Date.now();
    if (hit && age < ttlMs) return hit.value;
    if (hit && age < staleMs) {
        refreshKeyStatuses(k, profileId).catch(() => {});
        return hit.value;
    }
    return refreshKeyStatuses(k, profileId);
}

/** Xem cache mà KHÔNG gọi mạng: { value, ageMs } hoặc null. */
export function peekKeyStatuses(profileId = null) {
    const hit = _keyStatusCache.get(String(profileId ?? ""));
    return hit ? { value: hit.value, ageMs: Date.now() - hit.at } : null;
}

/** Làm mới ngầm (không chờ). Dùng khi cache nguội mà khách không nên phải đợi. */
export function warmKeyStatuses(profileId = null) {
    refreshKeyStatuses(String(profileId ?? ""), profileId).catch(() => {});
}

export function invalidateKeyStatusCache() {
    _keyStatusGen += 1;
    _keyStatusCache.clear();
}

/**
 * Số liệu CHỈ các key được hỏi — không quét cả shop. Một khách thường có vài key nên
 * chỉ cần vài request song song (~0,25s/key) thay vì 12–15s đọc 3.000+ key.
 * Có ngân sách thời gian: hết ngân sách thì trả những gì đã có (`partial: true`) để màn
 * hình vẫn hiện ra từ dữ liệu trong DB thay vì treo.
 *
 * @param items  [{ externalId, profileId }]
 * @returns { ok: true, byId: Map<externalId, trạng thái>, partial }
 */
export async function getKeyStatusesFor(items = [], { concurrency = 3, budgetMs = 4000 } = {}) {
    const list = (items || []).filter((x) => x?.externalId);
    const byId = new Map();
    const deadline = Date.now() + Math.max(500, Number(budgetMs) || 4000);
    let next = 0;
    const timeout = (ms) => new Promise((resolve) => setTimeout(() => resolve({ ok: false, code: "budget" }), Math.max(0, ms)));
    let throttled = false;
    const worker = async () => {
        // Bị giới hạn tốc độ thì DỪNG hẳn: dồn thêm request chỉ kéo dài thời gian bị chặn của
        // cả shop (kể cả tạo key / gia hạn của khách khác).
        while (next < list.length && Date.now() < deadline && !throttled) {
            const it = list[next++];
            try {
                const r = await Promise.race([getKeyStatus(it.externalId, it.profileId ?? null), timeout(deadline - Date.now())]);
                if (r?.ok) byId.set(String(it.externalId), r);
                else if (isRateLimited(r?.code)) throttled = true;
            } catch { /* một key lỗi không được làm hỏng cả màn hình */ }
        }
    };
    await Promise.all(Array.from({ length: Math.min(concurrency, list.length) }, worker));
    return { ok: true, byId, partial: byId.size < list.length, throttled };
}

/**
 * Giữ cache ấm cho profile đang có người dùng: làm mới ngầm khi cache sắp hết hạn, nên
 * người bấm tiếp theo gặp số liệu sẵn thay vì phải chờ cả lượt quét. Chỉ làm mới profile
 * đã được truy cập trong `idleMs` gần đây — shop vắng khách thì không quét vô ích.
 */
export function startKeyStatusWarmer({ intervalMs = 60_000, refreshAfterMs = 150_000, idleMs = 30 * 60_000 } = {}) {
    const timer = setInterval(() => {
        const now = Date.now();
        for (const [k, hit] of _keyStatusCache) {
            if (now - hit.lastAccess > idleMs) continue;
            if (now - hit.at < refreshAfterMs) continue;
            refreshKeyStatuses(k, k === "" ? null : Number(k)).catch(() => {});
        }
    }, intervalMs);
    timer.unref?.();
    return { stop: () => clearInterval(timer) };
}

/** Số liệu MỘT key. `externalId` là public_id (UUID) lưu ở IssuedApiKey. */
export async function getKeyStatus(externalId, profileId = null) {
    const cfg = await getProfileConfig(profileId);
    if (!cfg.configured) return { ok: false, code: "not_configured" };
    const id = String(externalId || "").trim();
    if (!id) return { ok: false, code: "no_external_id" };
    try {
        const { status, json } = await httpJson("GET", `${cfg.base}/keys/${encodeURIComponent(id)}`, { token: cfg.adminToken });
        if (json?.code === 0 && json?.data) return { ok: true, ...normalizeKeyRow(json.data) };
        // 40400 = key đã bị xoá bên provider. Caller phân biệt được với lỗi mạng.
        return { ok: false, code: json?.code ?? status, message: json?.message || `HTTP ${status}` };
    } catch (err) {
        return { ok: false, code: "network", message: err.message };
    }
}

/**
 * Số liệu TẤT CẢ key trong một request — dùng cho job nhắc hạn, thay vì gọi
 * getKeyStatus cho từng key (shop có hàng nghìn key thì đó là hàng nghìn request
 * mỗi lượt quét).
 *
 * Lưu ý: bản list KHÔNG có expires_at, nên caller phải lấy hạn từ
 * IssuedApiKey.expiresAt của bot (vẫn đúng, vì mọi thay đổi hạn đều đi qua
 * renewApiKey và được ghi lại).
 */
export async function listKeyStatuses(profileId = null) {
    const cfg = await getProfileConfig(profileId);
    if (!cfg.configured) return { ok: false, code: "not_configured", byId: new Map() };
    const byId = new Map();
    let fetched = 0;
    let total = null;
    try {
        const readPage = async (page) => {
            let res;
            for (let attempt = 0; ; attempt++) {
                res = await httpJson(
                    "GET", `${cfg.base}/keys?page=${page}&page_size=${KEY_LIST_PAGE_SIZE}`,
                    { token: cfg.adminToken, timeoutMs: 45_000 },
                );
                const limited = res.status === 429 || isRateLimited(res.json?.code);
                if (!limited || attempt >= RATE_LIMIT_BACKOFF_MS.length) break;
                await defaultSleep(RATE_LIMIT_BACKOFF_MS[attempt]);
            }
            const { status, json } = res;
            const list = json?.data?.list;
            if (json?.code !== 0 || !Array.isArray(list)) {
                return { error: { ok: false, code: json?.code ?? status, message: json?.message || `HTTP ${status}`, byId: new Map() } };
            }
            for (const row of list) {
                const k = normalizeKeyRow(row);
                if (k.externalId) byId.set(k.externalId, k);
            }
            fetched += list.length;
            return { list, json };
        };

        // Trang 1 trước: nó cho biết `total`, từ đó biết cần bao nhiêu trang rồi đọc các
        // trang còn lại SONG SONG (3.300 key = 33 trang; tuần tự là 12–15s, song song ~3s).
        const first = await readPage(1);
        if (first.error) return first.error;
        const t0 = Number(first.json?.data?.total);
        total = Number.isFinite(t0) && t0 >= 0 ? t0 : null;

        if (first.list.length >= KEY_LIST_PAGE_SIZE && (total === null || fetched < total)) {
            if (total !== null) {
                const lastPage = Math.min(KEY_LIST_MAX_PAGES, Math.ceil(total / KEY_LIST_PAGE_SIZE));
                const pages = [];
                for (let p = 2; p <= lastPage; p++) pages.push(p);
                let failure = null;
                let cursor = 0;
                const worker = async () => {
                    while (cursor < pages.length && !failure) {
                        const r = await readPage(pages[cursor++]);
                        if (r.error) failure = r.error;
                    }
                };
                await Promise.all(Array.from({ length: Math.min(KEY_LIST_PARALLEL, pages.length) }, worker));
                // Một trang lỗi = cả lượt lỗi: tuyệt đối không trả danh sách một phần (xem chốt bên dưới).
                if (failure) return failure;
            } else {
                // Provider không khai `total` → không biết số trang, đọc tuần tự tới trang cuối.
                for (let page = 2; page <= KEY_LIST_MAX_PAGES; page++) {
                    const r = await readPage(page);
                    if (r.error) return r.error;
                    if (r.list.length < KEY_LIST_PAGE_SIZE) break;
                }
            }
        }
        // Đọc thiếu (đứt giữa chừng / server đổi kiểu phân trang) thì trả LỖI, tuyệt
        // đối không trả danh sách một phần: caller coi "không có trong danh sách" là
        // "key đã bị xoá bên provider", nên danh sách thiếu = khai tử nhầm key thật.
        //
        // Đếm bằng `byId.size` (số key PHÂN BIỆT thu được) chứ KHÔNG phải `fetched`:
        // danh sách xếp key mới nhất trước, nên chỉ cần một key được tạo giữa lúc
        // đọc là mọi thứ dịch xuống một dòng — dòng cuối trang N lặp lại ở đầu
        // trang N+1, và key cuối cùng bị đẩy ra ngoài. Lúc đó `fetched` vẫn khớp
        // `total` nhờ bản trùng, chốt này im lặng cho qua, và key bị bỏ sót sẽ bị
        // notifier ghi notifyStage = DEAD vĩnh viễn.
        if (total !== null && byId.size < total) {
            return {
                ok: false, code: "incomplete", byId: new Map(),
                message: `Mới đọc được ${byId.size}/${total} key (nhận ${fetched} dòng)`,
            };
        }
        return { ok: true, byId, total: total ?? byId.size };
    } catch (err) {
        return { ok: false, code: "network", message: err.message, byId: new Map() };
    }
}

/**
 * Gia hạn TẠI CHỖ một key: cộng thêm token và/hoặc đẩy ngày hết hạn ra xa.
 * Khách giữ nguyên chuỗi sk-* — không phải sửa cấu hình ở ứng dụng của họ.
 *
 * KHÔNG idempotent theo bản chất (quota_limit là tuyệt đối, phải đọc-rồi-cộng),
 * nên caller BẮT BUỘC phải chặn gọi lại cho cùng một đơn — xem deliverApiKey.
 */
export async function renewApiKey({ externalId, addTokens = 0, addDays = 0, newRpm = 0, profileId = null } = {}) {
    const cfg = await getProfileConfig(profileId);
    if (!cfg.configured) return { ok: false, code: "not_configured", message: "Chưa cấu hình GPT2API" };

    const before = await getKeyStatus(externalId, profileId);
    if (!before.ok) return { ok: false, code: before.code, message: before.message || "Không đọc được key bên nhà cung cấp" };

    const patch = computeRenewal({
        current: { quotaLimit: before.quotaLimit, expiresAt: before.expiresAt, rpm: before.rpm },
        addTokens, addDays, newRpm, quotaRefPrice: cfg.quotaRefPrice, now: Date.now(),
    });
    // Không có gì để đổi = key vô hạn quota/không hết hạn. Báo rõ để caller hoàn
    // tiền thay vì trừ tiền xong không làm gì.
    if (!patch) return { ok: false, code: "nothing_to_renew", message: "Key này không gia hạn được (quota hoặc thời hạn đang là vô hạn)" };

    try {
        const { status, json } = await httpJson("PATCH", `${cfg.base}/keys/${encodeURIComponent(String(externalId))}`, {
            token: cfg.adminToken, body: patch,
        });
        if (json?.code !== 0) {
            return { ok: false, code: json?.code ?? status, message: json?.message || `HTTP ${status}` };
        }
        // XÁC NHẬN BẰNG CÁCH ĐỌC LẠI: provider trả code 0 cả khi nó bỏ qua field.
        const after = await getKeyStatus(externalId, profileId);
        if (!after.ok) return { ok: false, code: after.code, message: "Đã gửi lệnh gia hạn nhưng không đọc lại được key" };
        if (patch.quota_limit !== undefined && after.quotaLimit !== patch.quota_limit) {
            return { ok: false, code: "quota_not_applied", message: "Nhà cung cấp không nhận thêm quota" };
        }
        if (patch.expires_at !== undefined
            && Math.abs(new Date(after.expiresAt || 0).getTime() - new Date(patch.expires_at).getTime()) > 60_000) {
            return { ok: false, code: "expiry_not_applied", message: "Nhà cung cấp không nhận gia hạn thời gian" };
        }
        if (patch.rpm !== undefined && after.rpm !== patch.rpm) {
            return { ok: false, code: "rpm_not_applied", message: "Nhà cung cấp không nhận nâng RPM" };
        }
        return {
            ok: true,
            before: { quotaLimit: before.quotaLimit, expiresAt: before.expiresAt, rpm: before.rpm },
            after: { quotaLimit: after.quotaLimit, expiresAt: after.expiresAt, rpm: after.rpm },
            quotaRefPrice: cfg.quotaRefPrice,
            profileId: cfg.profileId ?? null,
            profileName: cfg.profileName || "",
        };
    } catch (err) {
        return { ok: false, code: "network", message: err.message };
    }
}

/**
 * Bật / tắt một key bên provider (`PATCH {enabled}`). KHÔNG xoá key.
 *
 * Vì sao là "tắt" chứ không phải "xoá": `DELETE /keys/{id}` bên provider là không
 * thu hồi được, và shop cần giữ `IssuedApiKey` khớp với trạng thái thật để còn
 * đối soát doanh thu. Tắt thì đảo lại được.
 *
 * Vẫn ĐỌC LẠI sau khi PATCH như `renewApiKey`: provider trả `code: 0` kể cả khi nó
 * bỏ qua field. `enabled` là field có thật, nhưng "tin code 0" đúng là thói quen đã
 * gây bug một lần rồi — không có lý do gì để lặp lại ở field thứ hai.
 *
 * @returns `{ok, enabled}` — `enabled` là giá trị provider ĐANG giữ, không phải giá
 *          trị caller xin. Caller phải dùng nó để ghi DB, đừng dùng tham số đầu vào.
 */
export async function setApiKeyEnabled({ externalId, enabled = true, profileId = null } = {}) {
    const cfg = await getProfileConfig(profileId);
    if (!cfg.configured) return { ok: false, code: "not_configured", message: "Chưa cấu hình GPT2API" };
    const id = String(externalId || "").trim();
    if (!id) return { ok: false, code: "no_external_id", message: "Key này không có id phía nhà cung cấp" };
    const want = enabled !== false;

    try {
        const { status, json } = await httpJson("PATCH", `${cfg.base}/keys/${encodeURIComponent(id)}`, {
            token: cfg.adminToken,
            body: { enabled: want },
        });
        if (json?.code !== 0) {
            return { ok: false, code: json?.code ?? status, message: json?.message || `HTTP ${status}` };
        }
        const after = await getKeyStatus(id, profileId);
        if (!after.ok) return { ok: false, code: after.code, message: "Đã gửi lệnh nhưng không đọc lại được key" };
        if (after.enabled !== want) {
            return {
                ok: false,
                code: "enabled_not_applied",
                message: "Nhà cung cấp không đổi trạng thái key",
                enabled: after.enabled,
            };
        }
        return { ok: true, enabled: after.enabled, profileId: cfg.profileId ?? null };
    } catch (err) {
        return { ok: false, code: "network", message: err.message };
    }
}

export default {
    DEFAULT_MODELS,
    getConfig,
    getProfiles,
    getProfileConfig,
    isGpt2apiEnabledSync,
    warmGpt2apiConfig,
    invalidateGpt2apiConfig,
    invalidateGpt2apiGroups,
    listModelGroups,
    parseCreateKeyResponse,
    isSafeApiKeyCreateFailure,
    resolveFallbackGroups,
    buildCreateKeyBody,
    createApiKey,
    getKeyStatus,
    listKeyStatuses,
    listKeyStatusesCached,
    invalidateKeyStatusCache,
    renewApiKey,
    setApiKeyEnabled,
};
