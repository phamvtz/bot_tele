/**
 * Probe thật POST /keys để biết provider từ chối vì lý do gì.
 *
 * Vì sao cần script riêng: log bot chỉ in `created.code` sau khi đã hoàn tiền,
 * mất luôn body + response gốc. Script này gọi đúng body mà deliverApiKey dựng
 * rồi in nguyên văn envelope {code, message, trace_id}.
 *
 * Chạy:  node scripts/probe-gpt2api-key.mjs [quotaTokens] [rpm] [validDays]
 * Mặc định 1M/300/0. Token adm_* đọc từ .env, LUÔN bị che khi in.
 */

import "dotenv/config";
import { buildCreateKeyBody, getConfig, parseCreateKeyResponse } from "../src/gpt2api.js";

const quotaTokens = Number(process.argv[2] || 1_000_000);
const rpm = Number(process.argv[3] || 300);
const validDays = Number(process.argv[4] || 0);

const mask = (s) => (s ? `${String(s).slice(0, 8)}…${String(s).slice(-4)}` : "(trống)");

const cfg = await getConfig();
console.log("── Cấu hình ──");
console.log(`base       : ${cfg.base || "(trống)"}`);
console.log(`adminToken : ${mask(cfg.adminToken)}`);
console.log(`userId     : ${cfg.userId || "(trống)"}`);
console.log(`enabled    : ${cfg.enabled} | configured: ${cfg.configured}`);
console.log(`models     : ${cfg.models.length} model → ${cfg.models.join(", ")}`);
console.log(`fallback   : ${cfg.fallbackGroups.length ? cfg.fallbackGroups.join(", ") : "(trống → bỏ field)"}`);

if (!cfg.configured) {
    console.error("\n❌ Chưa đủ cấu hình, không gọi được. Cần GPT2API_BASE + GPT2API_ADMIN_TOKEN + GPT2API_USER_ID.");
    process.exit(1);
}

const body = buildCreateKeyBody({
    userId: cfg.userId,
    name: `probe-${quotaTokens}`,
    quotaTokens,
    rpm,
    tpm: cfg.tpm,
    validDays,
    models: cfg.models,
    fallbackGroups: cfg.fallbackGroups,
});

console.log("\n── Body gửi đi ──");
console.log(JSON.stringify(body, null, 2));

const url = `${cfg.base}/keys`;
console.log(`\n── POST ${url} ──`);

const res = await fetch(url, {
    method: "POST",
    headers: {
        Authorization: `Bearer ${cfg.adminToken}`,
        "Content-Type": "application/json",
        Accept: "application/json",
    },
    body: JSON.stringify(body),
}).catch((e) => {
    console.error(`❌ Lỗi mạng: ${e.message}`);
    process.exit(1);
});

const raw = await res.text();
console.log(`HTTP ${res.status} ${res.statusText}`);
console.log(`content-type: ${res.headers.get("content-type") || "(không có)"}`);
console.log("\n── Response gốc ──");
console.log(raw.slice(0, 2000));

let json = null;
try { json = JSON.parse(raw); } catch { /* có thể là HTML lỗi proxy */ }

const parsed = parseCreateKeyResponse(res.status, json, raw.slice(0, 500));
console.log("\n── Bot đọc thành ──");
console.log(JSON.stringify({ ...parsed, key: parsed.key ? mask(parsed.key) : undefined }, null, 2));

if (parsed.ok) {
    console.log("\n✅ Provider CẤP ĐƯỢC key với body này. Key vừa tạo là key thật — nhớ xoá bên provider.");
} else {
    console.log(`\n❌ Provider TỪ CHỐI: code=${parsed.code} | ${parsed.message}`);
}
