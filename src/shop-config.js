import prisma from "./lib/prisma.js";

/**
 * Shop runtime config — đọc các setting key có thể chỉnh từ web admin,
 * fallback về biến môi trường (.env) khi DB chưa có giá trị.
 *
 * Cache toàn bộ trong 1 lần load (TTL 30s) để tránh query DB mỗi lần dùng.
 * Gọi invalidateShopConfig() sau khi admin lưu settings để áp dụng ngay.
 */

const KEYS = [
    "SHOP_BANK_NAME",
    "SHOP_BANK_ACCOUNT",
    "SHOP_BANK_ACCOUNT_NAME",
    "BANK_CODE",
    "SUPPORT_CHANNEL_URL",
    "ORDER_NOTIFY_CHANNEL",
    "ORDER_CHANNEL_NOTIFY_ENABLED",
    "ORDER_BOT_BROADCAST_ENABLED",
    "NEW_ORDER_BROADCAST",
    "ORDER_EXPIRE_MINUTES",
    "MAX_DEPOSIT",
    "DEPOSIT_PRESETS",
    "CRYPTO_PAY_ENABLED",
    "CRYPTO_POLL_ENABLED",
    "CRYPTO_POLL_INTERVAL_MS",
    "CRYPTO_EXPIRE_MINUTES",
    "CRYPTO_USD_VND_RATE",
    "CRYPTO_USD_VND_RATE_AUTO",
    "CRYPTO_USD_VND_RATE_UPDATE_MS",
    "TRC20_USDT_ADDRESS",
    "TRONGRID_API_KEY",
    "BEP20_USDT_ADDRESS",
    "BSCSCAN_API_KEY",
    "BSCSCAN_CHAIN_ID",
];

let _cache = null;
let _cacheTs = 0;
const TTL = 30000;

async function loadAll() {
    if (_cache && Date.now() - _cacheTs < TTL) return _cache;
    let map = {};
    try {
        const rows = await prisma.setting.findMany({ where: { key: { in: KEYS } } });
        map = Object.fromEntries(rows.map((r) => [r.key, r.value]));
    } catch {
        map = {};
    }
    _cache = map;
    _cacheTs = Date.now();
    return _cache;
}

export function invalidateShopConfig() {
    _cache = null;
    _cacheTs = 0;
}

/** Bank info — ưu tiên DB, fallback env */
export async function getBankConfig() {
    const m = await loadAll();
    return {
        bankCode: m.BANK_CODE || process.env.BANK_CODE || "MB",
        bankName: m.SHOP_BANK_NAME || process.env.BANK_NAME || "MBBank",
        accountNumber: m.SHOP_BANK_ACCOUNT || process.env.BANK_ACCOUNT || "",
        accountName: m.SHOP_BANK_ACCOUNT_NAME || process.env.BANK_ACCOUNT_NAME || "",
    };
}

/** Sync version — dùng giá trị đã cache (gọi sau khi đã warm cache) */
export function getBankConfigSync() {
    const m = _cache || {};
    return {
        bankCode: m.BANK_CODE || process.env.BANK_CODE || "MB",
        bankName: m.SHOP_BANK_NAME || process.env.BANK_NAME || "MBBank",
        accountNumber: m.SHOP_BANK_ACCOUNT || process.env.BANK_ACCOUNT || "",
        accountName: m.SHOP_BANK_ACCOUNT_NAME || process.env.BANK_ACCOUNT_NAME || "",
    };
}

export async function getSupportChannelUrl() {
    const m = await loadAll();
    return m.SUPPORT_CHANNEL_URL || process.env.SUPPORT_CHANNEL_URL || "";
}

export function getSupportChannelUrlSync() {
    const m = _cache || {};
    return m.SUPPORT_CHANNEL_URL || process.env.SUPPORT_CHANNEL_URL || "";
}

export async function getOrderNotifyChannel() {
    const m = await loadAll();
    return m.ORDER_NOTIFY_CHANNEL || process.env.ORDER_NOTIFY_CHANNEL || "";
}

function enabledValue(settingValue, envValue, defaultValue = true) {
    const value = settingValue ?? envValue;
    if (value === undefined || value === null || value === "") return defaultValue;
    return String(value).toLowerCase() !== "false";
}

export async function isOrderChannelNotifyEnabled() {
    const m = await loadAll();
    return enabledValue(m.ORDER_CHANNEL_NOTIFY_ENABLED, process.env.ORDER_CHANNEL_NOTIFY_ENABLED, true);
}

export async function isOrderBotBroadcastEnabled() {
    const m = await loadAll();
    return enabledValue(
        m.ORDER_BOT_BROADCAST_ENABLED ?? m.NEW_ORDER_BROADCAST,
        process.env.ORDER_BOT_BROADCAST_ENABLED ?? process.env.NEW_ORDER_BROADCAST,
        true,
    );
}

export async function getOrderExpireMinutes() {
    const m = await loadAll();
    const v = Number(m.ORDER_EXPIRE_MINUTES || process.env.ORDER_EXPIRE_MINUTES || 10);
    return v > 0 && v <= 1440 ? v : 10;
}

export function getOrderExpireMinutesSync() {
    const m = _cache || {};
    const v = Number(m.ORDER_EXPIRE_MINUTES || process.env.ORDER_EXPIRE_MINUTES || 10);
    return v > 0 && v <= 1440 ? v : 10;
}

export function getCryptoConfigSync() {
    const m = _cache || {};
    return {
        CRYPTO_PAY_ENABLED: m.CRYPTO_PAY_ENABLED || process.env.CRYPTO_PAY_ENABLED || "true",
        CRYPTO_POLL_ENABLED: m.CRYPTO_POLL_ENABLED || process.env.CRYPTO_POLL_ENABLED || "true",
        CRYPTO_POLL_INTERVAL_MS: m.CRYPTO_POLL_INTERVAL_MS || process.env.CRYPTO_POLL_INTERVAL_MS || "15000",
        CRYPTO_EXPIRE_MINUTES: m.CRYPTO_EXPIRE_MINUTES || process.env.CRYPTO_EXPIRE_MINUTES || "",
        CRYPTO_USD_VND_RATE: m.CRYPTO_USD_VND_RATE || process.env.CRYPTO_USD_VND_RATE || process.env.USD_VND_RATE || "26500",
        CRYPTO_USD_VND_RATE_AUTO: m.CRYPTO_USD_VND_RATE_AUTO || process.env.CRYPTO_USD_VND_RATE_AUTO || "true",
        CRYPTO_USD_VND_RATE_UPDATE_MS: m.CRYPTO_USD_VND_RATE_UPDATE_MS || process.env.CRYPTO_USD_VND_RATE_UPDATE_MS || "300000",
        TRC20_USDT_ADDRESS: m.TRC20_USDT_ADDRESS || process.env.TRC20_USDT_ADDRESS || "",
        TRONGRID_API_KEY: m.TRONGRID_API_KEY || process.env.TRONGRID_API_KEY || "",
        BEP20_USDT_ADDRESS: m.BEP20_USDT_ADDRESS || process.env.BEP20_USDT_ADDRESS || "",
        BSCSCAN_API_KEY: m.BSCSCAN_API_KEY || process.env.BSCSCAN_API_KEY || "",
        BSCSCAN_CHAIN_ID: m.BSCSCAN_CHAIN_ID || process.env.BSCSCAN_CHAIN_ID || "56",
    };
}

export async function getMaxDeposit() {
    const m = await loadAll();
    const v = Number(m.MAX_DEPOSIT || process.env.MAX_DEPOSIT || 0);
    return v > 0 ? v : 0; // 0 = không giới hạn
}

const DEFAULT_PRESETS = [50000, 100000, 200000, 500000, 1000000];

export async function getDepositPresets() {
    const m = await loadAll();
    if (!m.DEPOSIT_PRESETS) return DEFAULT_PRESETS;
    const raw = String(m.DEPOSIT_PRESETS).trim();
    let arr;
    try {
        // Hỗ trợ cả JSON array "[50000,...]" lẫn chuỗi phân cách phẩy "50000, 100000"
        arr = raw.startsWith("[") ? JSON.parse(raw) : raw.split(/[,\s]+/);
    } catch {
        arr = raw.split(/[,\s]+/);
    }
    const clean = (Array.isArray(arr) ? arr : [])
        .map((x) => Math.floor(Number(String(x).replace(/[^\d]/g, ""))))
        .filter((x) => x > 0)
        .slice(0, 12);
    return clean.length ? clean : DEFAULT_PRESETS;
}

/** Warm cache lúc startup */
export async function warmShopConfig() {
    await loadAll();
}

export default {
    getBankConfig, getBankConfigSync,
    getSupportChannelUrl, getSupportChannelUrlSync, getOrderNotifyChannel,
    isOrderChannelNotifyEnabled, isOrderBotBroadcastEnabled,
    getOrderExpireMinutes, getOrderExpireMinutesSync,
    getCryptoConfigSync,
    getMaxDeposit, getDepositPresets,
    invalidateShopConfig, warmShopConfig,
};
