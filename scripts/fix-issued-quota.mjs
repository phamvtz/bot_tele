/**
 * Chỉnh lại quota_limit trên xpiki cho các key ĐÃ CẤP để số token khớp với số bot
 * đã báo khách.
 *
 * Bối cảnh: trước 2026-08-31 bot gửi quota_limit = số token thô. xpiki lưu
 * credit = quota_limit/10.000 và panel hiển thị token = credit / giá_Opus5 × 1tr,
 * nên panel hiện GẤP ~6.667 lần số bot báo. Script này set lại:
 *
 *     quota_limit_mới = round(DB.quotaTokens × GPT2API_QUOTA_REF_PRICE / 100)
 *
 * → panel xpiki sẽ hiện đúng bằng DB.quotaTokens (số khách được báo).
 *
 * DÙNG:
 *   node scripts/fix-issued-quota.mjs                 # dry-run: liệt kê, KHÔNG đụng gì
 *   node scripts/fix-issued-quota.mjs --one <extId>   # sửa đúng 1 key (để test)
 *   node scripts/fix-issued-quota.mjs --apply         # sửa TẤT CẢ
 *   node scripts/fix-issued-quota.mjs --apply --source GIFTCODE
 *
 * Chạy trên VPS (máy dev không tới được Mongo Atlas).
 */

import prisma from "../src/lib/prisma.js";
import { getConfig } from "../src/gpt2api.js";
import { request as httpsReq } from "node:https";
import { request as httpReq } from "node:http";

const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const ONE = args.includes("--one") ? args[args.indexOf("--one") + 1] : null;
const SOURCE = args.includes("--source") ? args[args.indexOf("--source") + 1] : null;

const SLEEP_MS = Number(process.env.FIX_SLEEP_MS) || 700;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function httpOnce(method, url, token, body) {
    return new Promise((resolve, reject) => {
        const u = new URL(url);
        const mod = u.protocol === "https:" ? httpsReq : httpReq;
        const payload = body ? JSON.stringify(body) : null;
        const headers = { Accept: "application/json", Authorization: `Bearer ${token}` };
        if (payload) { headers["Content-Type"] = "application/json"; headers["Content-Length"] = Buffer.byteLength(payload); }
        const req = mod({ hostname: u.hostname, port: u.port || 443, path: u.pathname + u.search, method, headers }, (res) => {
            let d = ""; res.on("data", (c) => d += c);
            res.on("end", () => { let j = null; try { j = JSON.parse(d); } catch {} resolve({ status: res.statusCode, json: j, raw: d.slice(0, 300) }); });
        });
        req.setTimeout(20000, () => { req.destroy(); reject(new Error("timeout")); });
        req.on("error", reject);
        if (payload) req.write(payload);
        req.end();
    });
}

// xpiki giới hạn tốc độ admin API (code 42900) → lùi và thử lại.
async function http(method, url, token, body) {
    for (let attempt = 0; attempt < 5; attempt++) {
        await sleep(SLEEP_MS);
        const r = await httpOnce(method, url, token, body);
        if (r.status === 429 || r.json?.code === 42900) { await sleep(3000 * (attempt + 1)); continue; }
        return r;
    }
    return { status: 429, json: { code: 42900 }, raw: "rate-limited sau 5 lần thử" };
}

const cfg = await getConfig();
const refPrice = cfg.quotaRefPrice;
if (!(refPrice > 0)) { console.error("GPT2API_QUOTA_REF_PRICE <= 0 → không quy đổi, thoát."); process.exit(1); }
if (!cfg.configured) { console.error("Chưa cấu hình GPT2API."); process.exit(1); }

const target = (tokens) => Math.max(1, Math.round(Number(tokens || 0) * refPrice / 100));

let where = {};
if (SOURCE) where.source = SOURCE;
let keys = await prisma.issuedApiKey.findMany({ where, orderBy: { createdAt: "asc" } });
if (ONE) keys = keys.filter((k) => k.externalId === ONE || k.id === ONE);

console.log(`refPrice=${refPrice} | ${keys.length} key | mode=${ONE ? "ONE " + ONE : APPLY ? "APPLY" : "DRY-RUN"}\n`);

let done = 0, skip = 0, fail = 0, noExt = 0;
for (const k of keys) {
    if (!k.externalId) { noExt++; console.log(`  ∅  ${k.key.slice(0, 14)}… (không có externalId) — bỏ qua`); continue; }
    let cur;
    try {
        const r = await http("GET", `${cfg.base}/keys/${k.externalId}`, cfg.adminToken);
        if (r.status === 404) { fail++; console.log(`  ✗  ${k.externalId} — key không còn trên xpiki`); continue; }
        if (r.json?.code !== 0) { fail++; console.log(`  ✗  ${k.externalId} — GET lỗi ${r.status} ${r.raw}`); continue; }
        cur = Number(r.json.data?.quota_limit ?? NaN);
    } catch (e) { fail++; console.log(`  ✗  ${k.externalId} — GET ${e.message}`); continue; }

    const want = target(k.quotaTokens);
    const tokM = (Number(k.quotaTokens) / 1e6).toFixed(1);
    if (cur === want) { skip++; console.log(`  =  ${k.externalId} ${tokM}M — đã đúng (${want})`); continue; }

    const line = `  →  ${k.externalId} ${tokM}M token: quota_limit ${cur} → ${want}`;
    if (!APPLY && !ONE) { console.log(line + "  (dry-run)"); done++; continue; }

    // thử PUT trước, không được thì PATCH
    let ok = false, detail = "";
    for (const method of ["PUT", "PATCH"]) {
        try {
            const r = await http(method, `${cfg.base}/keys/${k.externalId}`, cfg.adminToken, { quota_limit: want });
            if (r.json?.code === 0) { ok = true; detail = method; break; }
            detail = `${method} ${r.status} ${r.json?.message || r.raw}`;
        } catch (e) { detail = `${method} ${e.message}`; }
    }
    if (ok) { done++; console.log(line + `  ✓ (${detail})`); }
    else { fail++; console.log(line + `  ✗ ${detail}`); }
}

console.log(`\nxong: ${APPLY || ONE ? "sửa" : "sẽ sửa"} ${done} · đã đúng ${skip} · lỗi ${fail} · không externalId ${noExt}`);
process.exit(0);
