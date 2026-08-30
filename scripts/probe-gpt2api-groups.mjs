/**
 * Dò xem admin-pub có endpoint nào liệt kê được model group id.
 *
 * Tài liệu nói "không có" nhưng server thật lại BẮT BUỘC gửi
 * fallback_allowed_groups → phải tìm được id ở đâu đó, không thì bot không
 * cấp được key nào. Script chỉ GET (không tạo gì), in status + body cắt ngắn.
 */

import "dotenv/config";
import { getConfig } from "../src/gpt2api.js";

const cfg = await getConfig();
if (!cfg.configured) {
    console.error("❌ Chưa đủ cấu hình GPT2API.");
    process.exit(1);
}

const origin = new URL(cfg.base).origin;
const candidates = [
    `${cfg.base}/model-groups`,
    `${cfg.base}/groups`,
    `${cfg.base}/model_groups`,
    `${cfg.base}/fallback-groups`,
    `${cfg.base}/keys`,
    `${cfg.base}/me`,
    `${cfg.base}/scopes`,
    `${origin}/api/admin/model-groups`,
    `${origin}/api/model-groups`,
    `${origin}/v1/models`,
];

for (const url of candidates) {
    const res = await fetch(url, {
        method: "GET",
        headers: { Authorization: `Bearer ${cfg.adminToken}`, Accept: "application/json" },
    }).catch((e) => ({ _err: e.message }));

    if (res._err) {
        console.log(`\n✖ GET ${url}\n  lỗi mạng: ${res._err}`);
        continue;
    }
    const raw = await res.text();
    const hit = res.status === 200 && !/"code":\s*4\d{4}/.test(raw);
    console.log(`\n${hit ? "✔" : "·"} GET ${url}`);
    console.log(`  HTTP ${res.status} | ${raw.slice(0, 700)}`);
}
