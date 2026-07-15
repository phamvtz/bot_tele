import { formatCurrency } from "./bot-ui/format.js";
import { getUsdCnyRate, getUsdVndRate } from "./payment/crypto.js";

const SUPPORTED_USD = new Set(["USD", "USDT"]);

export function isUsdCurrency(currency = "VND") {
    return SUPPORTED_USD.has(String(currency || "VND").toUpperCase());
}

export function toVndAmount(amount = 0, currency = "VND") {
    const value = Number(amount || 0);
    return isUsdCurrency(currency) ? Math.round(value * getUsdVndRate()) : Math.round(value);
}

export function toUsdAmount(amount = 0, currency = "VND") {
    const value = Number(amount || 0);
    return isUsdCurrency(currency) ? value : value / getUsdVndRate();
}

export function formatUsdAmount(amount = 0) {
    const value = Number(amount || 0);
    const digits = value >= 100 ? 2 : value >= 1 ? 2 : 4;
    return `$${value.toLocaleString("en-US", {
        minimumFractionDigits: 2,
        maximumFractionDigits: digits,
    })}`;
}

export function formatUsdPrimary(amount = 0, currency = "VND", { lang = "vi", showEquivalent = true } = {}) {
    const usd = toUsdAmount(amount, currency);
    const primary = formatUsdAmount(usd);
    if (!showEquivalent) return primary;

    const vnd = toVndAmount(amount, currency);
    if (lang === "zh") {
        const cny = usd * getUsdCnyRate();
        return `${primary} (≈ ¥${cny.toLocaleString("zh-CN", {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
        })} / ${formatCurrency(vnd)})`;
    }
    if (lang === "en") {
        return `${primary} (≈ ${vnd.toLocaleString("vi-VN")} VND)`;
    }
    return `${primary} (≈ ${formatCurrency(vnd)})`;
}

export function formatRateHint(lang = "vi") {
    const vnd = getUsdVndRate();
    if (lang === "zh") {
        return `1 USDT ≈ $1.00 ≈ ¥${getUsdCnyRate().toLocaleString("zh-CN", {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
        })} / ${formatCurrency(vnd)}`;
    }
    if (lang === "en") {
        return `1 USDT ≈ $1.00 ≈ ${vnd.toLocaleString("vi-VN")} VND`;
    }
    return `1 USDT ≈ $1.00 tương đương ${formatCurrency(vnd)}`;
}
