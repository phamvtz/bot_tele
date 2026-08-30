/**
 * Đối chiếu quota: bot GỬI `quota_limit` (số token) khi tạo key, còn panel xpiki
 * HIỂN THỊ "≈ N token". Script này GET danh sách key thật (scope key:read) rồi in
 * quota mà server LƯU cho từng key — để biết xpiki có nhân/chia gì không.
 *
 * CHỈ ĐỌC. Không tạo, không sửa, không xoá key nào.
 *
 * Chạy:  node scripts/probe-gpt2api-quota.mjs [lọc-theo-tên]
 */

import "dotenv/config";
import { getConfig } from "../src/gpt2api.js";

const nameFilter = String(process.argv[2] || "").toLowerCase();
const mask = (s) => (s ? `${String(s).slice(0, 10)}…${String(s).slice(-4)}` : "(trống)");

const cfg = await getConfig();
if (!cfg.configured) {
    console.error("❌ Chưa đủ cấu hình GPT2API (cần BASE + ADMIN_TOKEN + USER_ID).");
    process.exit(1);
}

const origin = new URL(cfg.base).origin;
const candidates = [
    `${cfg.base}/keys?user_id=${encodeURIComponent(cfg.userId)}`,
    `${cfg.base}/keys`,
    `${origin}/api/admin-pub/keys`,
];

async function tryGet(url) {
    const res = await fetch(url, {
        method: "GET",
        headers: { Authorization: `Bearer ${cfg.adminToken}`, Accept: "application/json" },
    }).catch((e) => ({ _err: e.message }));
    if (res._err) return { url, err: res._err };
    const raw = await res.text();
    let json = null;
    try { json = JSON.parse(raw); } catch { /* html/proxy error */ }
    return { url, status: res.status, json, raw };
}

let hit = null;
for (const url of candidates) {
    const r = await tryGet(url);
    console.log(`\nGET ${url}`);
    if (r.err) { console.log(`  ✖ lỗi mạng: ${r.err}`); continue; }
    console.log(`  HTTP ${r.status}`);
    if (r.json && r.json.code === 0) { hit = r; console.log("  ✔ OK"); break; }
    console.log(`  ${String(r.raw).slice(0, 400)}`);
}

if (!hit) {
    console.error("\n❌ Không GET được danh sách key. In nguyên văn ở trên để xem server nói gì.");
    process.exit(1);
}

const list = Array.isArray(hit.json.data?.list) ? hit.json.data.list
    : Array.isArray(hit.json.data) ? hit.json.data
        : Array.isArray(hit.json.data?.keys) ? hit.json.data.keys : [];

console.log(`\n── ${list.length} key ──`);
console.log("Mọi field có 'quota'/'limit'/'token' được in nguyên để so với số bot gửi.\n");

for (const k of list) {
    const name = String(k.name ?? k.remark ?? "");
    if (nameFilter && !name.toLowerCase().includes(nameFilter)) continue;

    const quotaFields = Object.fromEntries(
        Object.entries(k).filter(([key]) => /quota|limit|token|used|remain/i.test(key)),
    );
    console.log(`• ${name || "(không tên)"}  key=${mask(k.key || k.key_prefix)}`);
    console.log(`  ${JSON.stringify(quotaFields)}`);
}

// In 1 key đầy đủ để thấy toàn bộ schema.
const sample = list.find((k) => !nameFilter || String(k.name ?? "").toLowerCase().includes(nameFilter)) || list[0];
if (sample) {
    console.log("\n── 1 key đầy đủ (mọi field) ──");
    console.log(JSON.stringify({ ...sample, key: sample.key ? mask(sample.key) : undefined }, null, 2));
}
