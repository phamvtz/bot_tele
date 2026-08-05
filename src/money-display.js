import { formatCurrency } from "./bot-ui/format.js";
import { getConfiguredUsdVndRate, getUsdCnyRate, getUsdVndRate } from "./payment/crypto.js";
import { convertToUsd, convertToVnd, isUsdCurrencyCode } from "./payment/amounts.js";

export function isUsdCurrency(currency = "VND") {
    return isUsdCurrencyCode(currency);
}

/**
 * Tỷ giá dùng để HIỂN THỊ số tiền động (số dư ví, giá sản phẩm, catalog) —
 * những giá trị không gắn với một đơn cụ thể nên đọc tỷ giá hiện hành.
 */
export function liveUsdVndRate() {
    return getUsdVndRate();
}

/**
 * Tỷ giá dùng để hiển thị số tiền CỦA MỘT ĐƠN / GIAO DỊCH đã tạo.
 *
 * Đơn đã chốt tỷ giá lúc checkout (`cryptoUsdVndRate`); phải dùng đúng số đó,
 * nếu không cùng một đơn sẽ hiện số USD khác nhau trên từng màn hình (H5).
 * Đơn cũ chưa có trường này thì lùi về tỷ giá cấu hình TĨNH — không phải tỷ giá
 * live — để số hiển thị ít nhất ổn định giữa các lần mở.
 */
export function orderDisplayRate(order) {
    const locked = Number(order?.cryptoUsdVndRate ?? order?.usdVndRate ?? 0);
    if (Number.isFinite(locked) && locked > 0) return locked;
    return getConfiguredUsdVndRate();
}

export function toVndAmount(amount = 0, currency = "VND", { rate } = {}) {
    return convertToVnd(amount, currency, rate);
}

export function toUsdAmount(amount = 0, currency = "VND", { rate } = {}) {
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

// `rate` là bắt buộc: dùng liveUsdVndRate() cho số tiền động, orderDisplayRate(order)
// cho số tiền của một đơn đã tạo. Không có default để không ai vô tình hiển thị
// đơn đã chốt giá theo tỷ giá live.
export function formatUsdPrimary(amount = 0, currency = "VND", { lang = "vi", showEquivalent = true, rate } = {}) {
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
