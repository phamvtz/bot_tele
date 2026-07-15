import { formatCurrency } from "./bot-ui/format.js";
import { getUsdCnyRate, getUsdVndRate } from "./payment/crypto.js";
import { convertToUsd, convertToVnd, isUsdCurrencyCode } from "./payment/amounts.js";

export function isUsdCurrency(currency = "VND") {
    return isUsdCurrencyCode(currency);
}

export function toVndAmount(amount = 0, currency = "VND", { rate = getUsdVndRate() } = {}) {
    return convertToVnd(amount, currency, rate);
}

export function toUsdAmount(amount = 0, currency = "VND", { rate = getUsdVndRate() } = {}) {
    return convertToUsd(amount, currency, rate);
}

export function formatUsdAmount(amount = 0) {
    const value = Number(amount || 0);
    const digits = value >= 100 ? 2 : value >= 1 ? 2 : 4;
    return `$${value.toLocaleString("en-US", {
        minimumFractionDigits: 2,
        maximumFractionDigits: digits,
    })}`;
}

export function formatUsdPrimary(amount = 0, currency = "VND", { lang = "vi", showEquivalent = true, rate = getUsdVndRate() } = {}) {
    const usd = toUsdAmount(amount, currency, { rate });
    const primary = formatUsdAmount(usd);
    if (!showEquivalent) return primary;

    const vnd = toVndAmount(amount, currency, { rate });
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
