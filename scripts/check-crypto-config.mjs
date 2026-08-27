/**
 * Chan doan cau hinh nhan USDT - CHI DOC, khong sua gi.
 *
 * Chay TREN VPS:  node scripts/check-crypto-config.mjs
 *
 * Vi Setting trong DB ghi de .env (getCryptoConfigSync doc DB truoc), xem .env
 * la chua du de biet shop dang bat mang nao. Script in NGUON cua tung khoa
 * (DB / ENV / trong) va mang nao that su hien ra cho khach.
 *
 * Khong in gia tri secret. Dia chi vi in dang rut gon de doi chieu duoc ma
 * khong phoi nguyen chuoi ra log.
 */
import "dotenv/config";
import prisma from "../src/lib/prisma.js";
import { warmShopConfig } from "../src/shop-config.js";

const SECRET_KEYS = new Set(["BINANCE_API_SECRET", "BINANCE_API_KEY", "BINANCE_PAY_TOKEN", "TRONGRID_API_KEY", "BSCSCAN_API_KEY"]);
const KEYS = [
    "CRYPTO_PAY_ENABLED",
    "CRYPTO_POLL_ENABLED",
    "TRC20_USDT_ADDRESS",
    "BEP20_USDT_ADDRESS",
    "BINANCE_API_KEY",
    "BINANCE_API_SECRET",
    "BINANCE_PAY_ID",
    "BINANCE_PAY_TOKEN",
    "TRONGRID_API_KEY",
    "BSCSCAN_API_KEY",
];

function show(key, value) {
    if (value == null || value === "") return "(trong)";
    const text = String(value);
    if (SECRET_KEYS.has(key)) return `(da dat, ${text.length} ky tu)`;
    if (text.length > 14) return `${text.slice(0, 6)}...${text.slice(-4)} (${text.length} ky tu)`;
    return text;
}

function firstLine(error) {
    return String(error?.message || error).split("\n")[0];
}

// getCryptoConfigSync doc _cache trong shop-config, chi loadAll() moi set cache.
// Khong warm truoc thi getEnabledCryptoNetworks() chi thay ENV va bao "khong co
// mang nao" DU cho user da nhap key qua web admin - sai dung truong hop can bat.
//
// KHONG bot try/catch o day: loadAll() (shop-config.js:43) tu bat loi findMany va
// `catch { map = {} }`, khong rethrow - nen warmShopConfig() khong bao gio throw
// va khong the dung lam lop do DB. Chinh findMany ngay duoi moi la cai phat hien
// DB loi; dung xoa no.
await warmShopConfig();

let rows = [];
let dbError = null;
try {
    rows = await prisma.setting.findMany({ where: { key: { in: KEYS } } });
} catch (error) {
    dbError = firstLine(error);
}
const db = new Map(rows.map((row) => [row.key, row.value]));

const dbUsable = !dbError;
if (!dbUsable) {
    console.log("!! KHONG doc duoc Setting trong DB:", dbError);
    console.log("   -> Ket qua duoi chi phan anh .env, THIEU lop DB ghi de.");
    console.log("   -> Chay lai script nay TREN VPS de thay gia tri that.\n");
}

console.log("=== Cau hinh USDT: DB Setting ghi de .env ===");
for (const key of KEYS) {
    const dbValue = db.get(key);
    const envValue = process.env[key];
    const effective = dbValue || envValue;
    const source = dbValue ? "DB" : (envValue ? "ENV" : "-");
    console.log(`${key.padEnd(20)} [${source.padEnd(3)}] ${show(key, effective)}`);
}

const { getEnabledCryptoNetworks } = await import("../src/payment/crypto.js");
console.log("\n=== Mang dang hien cho khach ===");
const networks = getEnabledCryptoNetworks();
console.log(networks.length ? networks.join(", ") : "(khong co mang nao - nut USDT bi an)");
console.log(dbUsable ? "(da doc ca DB + ENV - so lieu tin duoc)" : "(CHUA tin duoc: tinh theo .env vi khong doc duoc DB)");
process.exit(0);
