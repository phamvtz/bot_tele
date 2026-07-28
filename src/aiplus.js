/**
 * aiplus.cyou client — bán Claude API key (tạo key động theo RPM / token / số ngày).
 *
 * Luồng: khách chọn cấu hình → tính giá gốc (theo công thức từ /options) → cộng markup %
 * → trừ ví khách → gọi POST /keys/claude-custom → giao key. aiplus trừ số dư tài khoản
 * aiplus của shop (AIPLUS_API_KEY). Lợi nhuận của shop = phần markup.
 *
 * KHÔNG cần DB migration — cấu hình lưu trong Setting (key-value) + ENV.
 */

import { request as httpsReq } from "node:https";
import { request as httpReq } from "node:http";
import prisma from "./lib/prisma.js";

const AIPLUS_BASE = (process.env.AIPLUS_BASE || "https://api.aiplus.cyou/api/v1").replace(/\/$/, "");

function apiKey() {
    return process.env.AIPLUS_API_KEY || "";
}

export function isAiplusEnabled() {
    return String(process.env.AIPLUS_ENABLED || "").toLowerCase() !== "false" && !!apiKey();
}

// ─── HTTP helpers (giống style delivery.js — tự parse JSON, timeout, retry lỗi mạng) ──
function httpJson(method, path, body = null) {
    return new Promise((resolve, reject) => {
        const url = new URL(`${AIPLUS_BASE}${path}`);
        const mod = url.protocol === "https:" ? httpsReq : httpReq;
        const bodyStr = body ? JSON.stringify(body) : null;
        const headers = {
            Accept: "application/json",
            Authorization: `Bearer ${apiKey()}`,
        };
        if (bodyStr) {
            headers["Content-Type"] = "application/json";
            headers["Content-Length"] = Buffer.byteLength(bodyStr);
        }
        const req = mod({
            hostname: url.hostname,
            port: url.port || (url.protocol === "https:" ? 443 : 80),
            path: url.pathname + url.search,
            method,
            headers,
        }, (res) => {
            let data = "";
            res.on("data", (c) => (data += c));
            res.on("end", () => {
                let parsed;
                try { parsed = JSON.parse(data); }
                catch { return reject(new Error(`aiplus trả JSON không hợp lệ (HTTP ${res.statusCode})`)); }
                // aiplus dùng envelope { code, message, data }. code === 0 là OK.
                resolve({ status: res.statusCode, json: parsed });
            });
        });
        req.setTimeout(30000, () => { req.destroy(); reject(new Error("aiplus timeout (30s)")); });
        req.on("error", (e) => reject(new Error(e.message)));
        if (bodyStr) req.write(bodyStr);
        req.end();
    });
}

// ─── Options + pricing (cache 5 phút) ───────────────────────────────────────────
let _optionsCache = null;
let _optionsAt = 0;
const OPTIONS_TTL = 5 * 60 * 1000;

export function invalidateAiplusOptions() { _optionsCache = null; _optionsAt = 0; }

export async function getOptions({ force = false } = {}) {
    if (!force && _optionsCache && Date.now() - _optionsAt < OPTIONS_TTL) return _optionsCache;
    const { json } = await httpJson("GET", "/keys/claude-custom/options");
    if (!json || json.code !== 0 || !json.data) {
        throw new Error(json?.message || "Không lấy được cấu hình từ aiplus");
    }
    _optionsCache = json.data;
    _optionsAt = Date.now();
    return _optionsCache;
}

// Nội suy tuyến tính giữa các mốc trong bảng hệ số (rpmMult / daysMult).
function interp(map, x) {
    const ks = Object.keys(map).map(Number).sort((a, b) => a - b);
    if (!ks.length) return 1;
    if (x <= ks[0]) return map[ks[0]];
    if (x >= ks[ks.length - 1]) return map[ks[ks.length - 1]];
    for (let i = 0; i < ks.length - 1; i++) {
        if (x >= ks[i] && x <= ks[i + 1]) {
            const t = (x - ks[i]) / (ks[i + 1] - ks[i]);
            return map[ks[i]] + t * (map[ks[i + 1]] - map[ks[i]]);
        }
    }
    return map[ks[ks.length - 1]];
}

/**
 * Tính giá GỐC aiplus (đúng theo công thức note trong /options):
 *   priceUsdt = (tokens/1e6) x basePerMtokenUsdt x interp(rpmMult,rpm) x interp(daysMult,days)
 *   ceil 0.01$, priceVnd = round(priceUsdt x usdtRate)
 * `tokens` truyền vào là SỐ TOKEN THÔ (vd 100_000_000 = 100M).
 * Đã verify khớp aiplus: 100M / rpm200 / 1 ngày = 98.280đ.
 */
export function computeBasePrice({ rpm, tokens, days, pricing }) {
    const rate = Number(pricing.usdtRate) || 27000;
    const base = Number(pricing.basePerMtokenUsdt) || 0.03;
    const tokenM = tokens / 1e6;
    let usdt = tokenM * base * interp(pricing.rpmMult || {}, rpm) * interp(pricing.daysMult || {}, days);
    usdt = Math.ceil(usdt * 100) / 100; // ceil 0.01$
    const vnd = Math.round(usdt * rate);
    return { usdt, vnd, usdtRate: rate };
}

// ─── Markup (lấy từ Setting DB, fallback ENV) ────────────────────────────────────
const MARKUP_KEY = "AIPLUS_MARKUP_PERCENT";

export async function getMarkupPercent() {
    try {
        const s = await prisma.setting.findUnique({ where: { key: MARKUP_KEY } });
        if (s && s.value !== undefined && s.value !== null && s.value !== "") {
            const n = Number(s.value);
            if (Number.isFinite(n) && n >= 0) return n;
        }
    } catch { /* ignore — fallback ENV */ }
    const envN = Number(process.env.AIPLUS_MARKUP_PERCENT);
    return Number.isFinite(envN) && envN >= 0 ? envN : 0;
}

// Giá bán cho khách = giá gốc + markup%.
// markup = 0 → bán ĐÚNG giá gốc aiplus (không làm tròn).
// markup > 0 → làm tròn lên 1.000đ cho đẹp.
export function applyMarkup(baseVnd, markupPercent) {
    const pct = Number(markupPercent) || 0;
    if (pct <= 0) return baseVnd;
    const withMarkup = baseVnd * (1 + pct / 100);
    return Math.ceil(withMarkup / 1000) * 1000;
}

/**
 * Báo giá đầy đủ cho một cấu hình. Trả cả giá gốc (để trừ đối soát) lẫn giá bán.
 */
export async function quote({ rpm, tokens, days }) {
    const options = await getOptions();
    const base = computeBasePrice({ rpm, tokens, days, pricing: options.pricing });
    const markupPercent = await getMarkupPercent();
    const sellVnd = applyMarkup(base.vnd, markupPercent);
    return {
        rpm, tokens, days,
        tokenM: tokens / 1e6,
        baseVnd: base.vnd,
        baseUsdt: base.usdt,
        usdtRate: base.usdtRate,
        markupPercent,
        sellVnd,
        profitVnd: sellVnd - base.vnd,
    };
}

/**
 * Chuẩn hoá response của POST /keys/claude-custom thành { ok, key, ... }.
 * Tách riêng (thuần, không I/O) để test được mà không cần gọi HTTP thật.
 * `code !== 0` (hoặc thiếu key trong data) → coi là THẤT BẠI → caller sẽ hoàn tiền.
 */
export function parseCreateKeyResponse(status, json, { rpm, tokens } = {}) {
    if (!json || json.code !== 0) {
        return {
            ok: false,
            code: json?.code || `http_${status}`,
            message: json?.message || `aiplus lỗi (HTTP ${status})`,
            priceVnd: json?.priceVnd,
            balanceVnd: json?.balanceVnd,
        };
    }
    const d = json.data || {};
    // Parse phòng thủ — field name có thể là apiKey/key/secret tùy phiên bản aiplus.
    const key = d.apiKey || d.key || d.secret || d.token || d.value || "";
    const expiresAt = d.expiresAt || d.expireAt || d.expiredAt || d.validUntil || null;
    if (!key) {
        // code=0 nhưng không có key → vẫn coi là thất bại để hoàn tiền, tránh
        // "mua thành công mà không nhận được gì".
        return { ok: false, code: "no_key_in_response", message: "aiplus không trả về key", raw: d };
    }
    return {
        ok: true,
        key,
        keyId: d.id ?? d.keyId ?? null,
        expiresAt,
        rpm: d.rpm ?? rpm,
        tokens: d.tokens ?? tokens,
        raw: d,
    };
}

/**
 * Gọi aiplus tạo key thật. Trả { ok, key, expiresAt, raw } hoặc { ok:false, code, message }.
 */
export async function createKey({ rpm, tokens, days }) {
    const { status, json } = await httpJson("POST", "/keys/claude-custom", { rpm, tokens, days });
    return parseCreateKeyResponse(status, json, { rpm, tokens });
}

// Số dư tài khoản aiplus của shop (cho admin xem).
export async function getShopBalance() {
    const { json } = await httpJson("GET", "/me");
    if (!json || json.code !== 0) throw new Error(json?.message || "Không lấy được thông tin aiplus");
    return json.data;
}

export default {
    isAiplusEnabled,
    getOptions,
    invalidateAiplusOptions,
    computeBasePrice,
    getMarkupPercent,
    applyMarkup,
    quote,
    createKey,
    parseCreateKeyResponse,
    getShopBalance,
};
