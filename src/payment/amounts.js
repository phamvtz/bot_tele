const USD_CURRENCIES = new Set(["USD", "USDT"]);

export function isUsdCurrencyCode(currency = "VND") {
    return USD_CURRENCIES.has(String(currency || "VND").toUpperCase());
}

export function convertToVnd(amount, currency = "VND", usdVndRate) {
    const value = Number(amount || 0);
    const rate = Number(usdVndRate);
    if (!Number.isFinite(value)) return 0;
    if (!isUsdCurrencyCode(currency)) return Math.round(value);
    if (!Number.isFinite(rate) || rate <= 0) throw new Error("Invalid USD/VND rate");
    return Math.round(value * rate);
}

export function convertToUsd(amount, currency = "VND", usdVndRate) {
    const value = Number(amount || 0);
    const rate = Number(usdVndRate);
    if (!Number.isFinite(value)) return 0;
    if (isUsdCurrencyCode(currency)) return value;
    if (!Number.isFinite(rate) || rate <= 0) throw new Error("Invalid USD/VND rate");
    return value / rate;
}

export function getBankAmountToleranceVnd() {
    const configured = Number(process.env.BANK_AMOUNT_TOLERANCE_VND || 0);
    return Number.isFinite(configured) ? Math.max(0, Math.floor(configured)) : 0;
}

export function bankAmountsMatch(actual, expected) {
    return Math.abs(Number(actual || 0) - Number(expected || 0)) <= getBankAmountToleranceVnd();
}

export function getCryptoAmountTolerance() {
    const configured = Number(process.env.CRYPTO_AMOUNT_TOLERANCE || 0.0000004);
    if (!Number.isFinite(configured) || configured < 0) return 0.0000004;
    // Unique checkout amounts differ by 0.000001 USDT. Never allow adjacent
    // checkouts to match the same transfer.
    return Math.min(configured, 0.00000049);
}
