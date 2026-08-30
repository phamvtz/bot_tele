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
];

let _cache = null;
let _cacheTs = 0;
const TTL = 30_000;

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

    return {
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
        rpm: toPositiveInt(m.GPT2API_KEY_RPM ?? process.env.GPT2API_KEY_RPM, 300),
        tpm: toPositiveInt(m.GPT2API_KEY_TPM ?? process.env.GPT2API_KEY_TPM, 0),
        validDays: toPositiveInt(m.GPT2API_KEY_VALID_DAYS ?? process.env.GPT2API_KEY_VALID_DAYS, 0),
        usdPerMtoken: toPositiveFloat(m.GPT2API_USD_PER_MTOKEN ?? process.env.GPT2API_USD_PER_MTOKEN, 0.01),
        buyPresetsM: parsePresets(m.GPT2API_BUY_PRESETS_M ?? process.env.GPT2API_BUY_PRESETS_M),
    };
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
export function buildCreateKeyBody({ userId, name, quotaTokens, rpm = 0, tpm = 0, validDays = 0, models = [], fallbackGroups = [] }) {
    const body = {
        user_id: String(userId),
        name: String(name).slice(0, 128),
        quota_limit: Math.max(0, Math.floor(Number(quotaTokens) || 0)),
    };
    if (rpm > 0) body.rpm = Math.floor(rpm);
    if (tpm > 0) body.tpm = Math.floor(tpm);
    // expires_in_days: bỏ qua nếu 0 → key không hết hạn theo thời gian, chỉ theo quota.
    if (validDays > 0) body.expires_in_days = Math.floor(validDays);
    if (models.length) body.allowed_models = models;

    const fb = resolveFallbackGroups(fallbackGroups);
    if (!fb.omit) {
        body.fallback_allowed_groups = fb.groups;
        body.fallback_order = fb.order;
    }
    return body;
}

/**
 * Tạo key thật. Trả { ok, key, ... } hoặc { ok: false, code, message }.
 * KHÔNG throw khi API trả lỗi — chỉ throw nếu chưa cấu hình (lỗi lập trình/vận hành).
 */
export async function createApiKey({ quotaTokens, name, rpm, tpm, validDays, models, fallbackGroups } = {}) {
    const cfg = await getConfig();
    if (!cfg.enabled) return { ok: false, code: "disabled", message: "Tính năng API key đang tắt" };
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
            };
        }
    }

    const body = buildCreateKeyBody({
        userId: cfg.userId,
        name: name || `bot-${Date.now()}`,
        quotaTokens,
        rpm: rpm ?? cfg.rpm,
        tpm: tpm ?? cfg.tpm,
        validDays: validDays ?? cfg.validDays,
        models: models ?? cfg.models,
        fallbackGroups: groups,
    });

    try {
        const { status, json, raw } = await httpJson("POST", `${cfg.base}/keys`, {
            token: cfg.adminToken,
            body,
        });
        return parseCreateKeyResponse(status, json, raw);
    } catch (err) {
        // Lỗi mạng/timeout — caller phải coi như thất bại và hoàn tiền.
        return { ok: false, code: "network", message: err.message };
    }
}

export default {
    DEFAULT_MODELS,
    getConfig,
    isGpt2apiEnabledSync,
    warmGpt2apiConfig,
    invalidateGpt2apiConfig,
    invalidateGpt2apiGroups,
    listModelGroups,
    parseCreateKeyResponse,
    resolveFallbackGroups,
    buildCreateKeyBody,
    createApiKey,
};
