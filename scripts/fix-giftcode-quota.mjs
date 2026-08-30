/**
 * Xem / sửa MIỀN QUOTA của giftcode loại APIKEY.
 *
 * Chạy TRÊN VPS (nơi kết nối được DB):
 *
 *   node scripts/fix-giftcode-quota.mjs
 *       → CHỈ ĐỌC: liệt kê mọi mã APIKEY kèm miền quota đang lưu.
 *         quotaMinM/MaxM = 0 nghĩa là "không cấu hình" → mã dùng mặc định
 *         FREE_MIN_M–FREE_MAX_M (hiện là 3–50M).
 *
 *   node scripts/fix-giftcode-quota.mjs FREE2026 3 50
 *       → đặt mã FREE2026 thành random 3–50M.
 *
 *   node scripts/fix-giftcode-quota.mjs FREE2026 0 0
 *       → xoá override, cho mã bám theo mặc định của shop.
 *
 * KHÔNG đụng tới key đã cấp trước đó — chỉ đổi quota cho các lần đổi mã SAU này.
 */
import "dotenv/config";
import prisma from "../src/lib/prisma.js";
import { FREE_MIN_M, FREE_MAX_M } from "../src/apikey-pricing.js";

const [codeArg, minArg, maxArg] = process.argv.slice(2);

function fmtRange(g) {
    const min = g.quotaMinM > 0 ? `${g.quotaMinM}M` : `mặc định (${FREE_MIN_M}M)`;
    const max = g.quotaMaxM > 0 ? `${g.quotaMaxM}M` : `mặc định (${FREE_MAX_M}M)`;
    const fixed = g.quotaMinM > 0 && g.quotaMinM === g.quotaMaxM ? "  ⚠ CỐ ĐỊNH, không random" : "";
    return `${min} – ${max}${fixed}`;
}

if (!codeArg) {
    const all = await prisma.giftCode.findMany({ orderBy: { createdAt: "desc" } });
    const keys = all.filter((g) => g.rewardType === "APIKEY");
    if (!keys.length) {
        console.log("Không có giftcode APIKEY nào.");
    } else {
        console.log(`${keys.length} mã APIKEY (mặc định shop: ${FREE_MIN_M}–${FREE_MAX_M}M):\n`);
        for (const g of keys) {
            console.log(`• ${g.code.padEnd(20)} ${fmtRange(g)}`);
            console.log(`  active=${g.isActive}  đã đổi=${g.usedCount}${g.maxUses ? `/${g.maxUses}` : ""}  alpha=${g.quotaAlpha || "mặc định"}`);
        }
    }
    await prisma.$disconnect?.();
    process.exit(0);
}

// ── Chế độ sửa ──
const min = Number(minArg);
const max = Number(maxArg);
if (!Number.isInteger(min) || !Number.isInteger(max) || min < 0 || max < 0) {
    console.error("❌ Cần: node scripts/fix-giftcode-quota.mjs <CODE> <MIN_M> <MAX_M>  (số nguyên ≥ 0)");
    process.exit(1);
}
if (min > 0 && max > 0 && max < min) {
    console.error(`❌ MAX (${max}M) phải ≥ MIN (${min}M).`);
    process.exit(1);
}

const code = codeArg.trim().toUpperCase();
const gift = await prisma.giftCode.findUnique({ where: { code } });
if (!gift) {
    console.error(`❌ Không tìm thấy mã ${code}.`);
    process.exit(1);
}
if (gift.rewardType !== "APIKEY") {
    console.error(`❌ Mã ${code} là loại ${gift.rewardType}, không phải APIKEY.`);
    process.exit(1);
}

console.log(`Mã ${code}: ${fmtRange(gift)}  →  ${min === 0 && max === 0 ? `mặc định (${FREE_MIN_M}–${FREE_MAX_M}M)` : `${min}–${max}M`}`);

await prisma.giftCode.update({
    where: { id: gift.id },
    data: { quotaMinM: min, quotaMaxM: max },
});

const after = await prisma.giftCode.findUnique({ where: { code } });
console.log(`✅ Đã cập nhật. Giờ: ${fmtRange(after)}`);
await prisma.$disconnect?.();
