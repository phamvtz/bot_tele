/**
 * Chẩn đoán cờ bật/tắt Claude Key (aiplus) — CHỈ ĐỌC, không sửa gì.
 *
 * Chạy TRÊN VPS:  node scripts/check-aiplus-flag.mjs
 *
 * Trả lời 2 câu hỏi:
 *   1. Setting AIPLUS_ENABLED trong DB có giá trị gì?
 *   2. prisma.setting.findUnique({ where: { key } }) có đọc được nó không,
 *      hay trả null (→ code cũ rơi về ENV và mặc định BẬT)?
 */
import "dotenv/config";
import prisma from "../src/lib/prisma.js";

const KEY = "AIPLUS_ENABLED";

const viaFindMany = await prisma.setting.findMany({ where: { key: KEY } });
let viaFindUnique = null;
let findUniqueError = null;
try {
    viaFindUnique = await prisma.setting.findUnique({ where: { key: KEY } });
} catch (e) {
    findUniqueError = e?.message || String(e);
}

console.log("=== AIPLUS_ENABLED ===");
console.log("findMany :", JSON.stringify(viaFindMany));
console.log("findUnique:", findUniqueError ? `ERROR ${findUniqueError}` : JSON.stringify(viaFindUnique));
console.log("ENV AIPLUS_ENABLED :", JSON.stringify(process.env.AIPLUS_ENABLED ?? null));
console.log("ENV AIPLUS_API_KEY :", process.env.AIPLUS_API_KEY ? "(đã đặt)" : "(trống)");

const dbVal = viaFindMany?.[0]?.value;
console.log("\n→ DB nói:", dbVal === undefined ? "KHÔNG CÓ ROW" : JSON.stringify(dbVal));
if (dbVal !== undefined && !viaFindUnique) {
    console.log("→ KẾT LUẬN: findUnique KHÔNG đọc được row (trả null) — đây chính là nguyên nhân bug.");
} else if (dbVal !== undefined && viaFindUnique) {
    console.log("→ KẾT LUẬN: findUnique đọc được. Nguyên nhân là 2 process riêng giữ cache khác nhau.");
}

process.exit(0);
