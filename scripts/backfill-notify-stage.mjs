/**
 * Điền `notifyStage` / `notifyAt` / `renewCount` / `lastRenewAt` cho những key đã
 * cấp TRƯỚC khi có tính năng nhắc gia hạn.
 *
 * Vì sao cần: `@default(...)` trong schema.prisma KHÔNG có tác dụng với Mongo ở
 * repo này — default thật nằm ở bảng DEFAULTS trong src/lib/prisma.js, và nó chỉ
 * áp lúc TẠO document mới. Key cũ vì thế thiếu hẳn field, mà MongoDB không khớp
 * field thiếu với `$lt`, nên job nhắc lọc `notifyStage: { lt: 3 }` trả về 0 dòng
 * và cả tính năng chết lặng lẽ.
 *
 * An toàn chạy lại nhiều lần: chỉ đụng document CHƯA có field.
 *
 *   node scripts/backfill-notify-stage.mjs          # xem trước, không ghi gì
 *   node scripts/backfill-notify-stage.mjs --write  # ghi thật
 */
import "dotenv/config";
import { prisma } from "../src/lib/prisma.js";

const WRITE = process.argv.includes("--write");

const rows = await prisma.issuedApiKey.findMany({ take: 100_000 });
const missing = rows.filter((r) => r.notifyStage === undefined || r.notifyStage === null);

console.log(`Tổng key: ${rows.length}`);
console.log(`Thiếu notifyStage: ${missing.length}`);

if (!missing.length) {
    console.log("Không có gì để điền.");
    process.exit(0);
}

if (!WRITE) {
    console.log("\n(xem trước — chưa ghi gì). Chạy lại với --write để điền thật.");
    process.exit(0);
}

let done = 0;
let failed = 0;
for (const r of missing) {
    try {
        await prisma.issuedApiKey.update({
            where: { id: r.id },
            data: {
                // 0 = chưa nhắc lần nào. KHÔNG suy ra mốc từ trạng thái hiện tại:
                // key đã hết từ lâu mà đặt sẵn mốc 3 là khách không bao giờ được
                // mời gia hạn, còn đặt 0 thì họ nhận đúng một tin — chính là điều
                // tính năng này sinh ra để làm.
                notifyStage: 0,
                notifyAt: null,
                renewCount: Number(r.renewCount) || 0,
                lastRenewAt: r.lastRenewAt ?? null,
            },
        });
        done += 1;
    } catch (e) {
        failed += 1;
        console.error(`  lỗi ${r.id}: ${e.message}`);
    }
}

console.log(`\nĐã điền: ${done} | lỗi: ${failed}`);
process.exit(failed ? 1 : 0);
