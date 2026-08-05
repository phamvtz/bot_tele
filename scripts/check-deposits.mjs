/**
 * Kiểm tra các lần NẠP VÍ gần đây — CHỈ ĐỌC, không sửa gì.
 *
 * Chạy TRÊN VPS:
 *   node scripts/check-deposits.mjs                 # 15 deposit mới nhất
 *   node scripts/check-deposits.mjs 123456789       # lọc theo telegramId
 *   node scripts/check-deposits.mjs 123456789 40    # + giới hạn số dòng
 *
 * Với mỗi deposit in ra: trạng thái, số tiền, paymentRef (nội dung CK khớp được),
 * mạng crypto nếu là nạp USDT, và balanceBefore/After.
 *
 * Cách đọc kết quả:
 *   SUCCESS  → đã cộng ví xong (balanceAfter là số dư thật sau khi cộng).
 *   PENDING  → CHƯA cộng ví. Còn trong 15 phút thì bank-poller vẫn đang chờ khớp;
 *              quá 15 phút mà vẫn PENDING thì lần createDeposit sau sẽ set EXPIRED.
 *   EXPIRED  → hết hạn, không cộng ví. Khách phải nạp lại.
 */
import "dotenv/config";
import prisma from "../src/lib/prisma.js";

const argTelegramId = process.argv[2] && /^\d+$/.test(process.argv[2]) ? process.argv[2] : null;
const limit = Number(process.argv[3] || process.argv[2]) || 15;

let walletFilter = {};
if (argTelegramId) {
    const wallets = await prisma.wallet.findMany({ where: { odelegramId: argTelegramId } });
    if (!wallets.length) {
        console.log(`Không tìm thấy ví nào của telegramId ${argTelegramId}.`);
        process.exit(0);
    }
    walletFilter = { walletId: wallets[0].id };
    console.log(`Ví của ${argTelegramId}: id=${wallets[0].id} — số dư hiện tại = ${wallets[0].balance?.toLocaleString()}đ\n`);
}

const txs = await prisma.walletTransaction.findMany({
    where: { type: "DEPOSIT", ...walletFilter },
    orderBy: { createdAt: "desc" },
    take: limit,
});

if (!txs.length) {
    console.log("Không có giao dịch nạp ví nào.");
    process.exit(0);
}

console.log(`=== ${txs.length} lần nạp ví gần nhất ===`);
for (const t of txs) {
    const when = t.createdAt ? new Date(t.createdAt).toISOString() : "?";
    const crypto = t.cryptoNetwork
        ? ` | ${t.cryptoNetwork.toUpperCase()} ${t.cryptoAmount ?? "?"} USDT @${t.cryptoUsdVndRate ?? "?"}`
        : "";
    console.log(
        `[${String(t.status).padEnd(7)}] ${when} | ${String(t.amount).padStart(9)}đ` +
        ` | ref=${t.paymentRef ?? "(chưa khớp)"}` +
        ` | ví: ${t.balanceBefore} → ${t.balanceAfter}${crypto}` +
        ` | id=${t.id}`,
    );
}

const pending = txs.filter((t) => t.status === "PENDING");
if (pending.length) {
    const now = Date.now();
    console.log(`\n→ Còn ${pending.length} deposit PENDING (CHƯA cộng ví):`);
    for (const t of pending) {
        const ageMin = Math.round((now - new Date(t.createdAt).getTime()) / 60000);
        console.log(`   id=${t.id} — ${t.amount}đ — tạo ${ageMin} phút trước` +
            (ageMin > 15 ? " → QUÁ HẠN 15 phút, sẽ bị EXPIRED" : " → còn trong hạn, poller đang chờ khớp"));
    }
} else {
    console.log("\n→ Không có deposit nào đang PENDING.");
}

process.exit(0);
