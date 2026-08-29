/**
 * Tin nhắn giao API key cho khách — HÀM THUẦN, không I/O.
 *
 * Tách khỏi bot.js để test được nội dung (endpoint, header, danh sách model,
 * escape HTML) mà không cần Telegram hay DB.
 */

import { escapeHtml } from "./format.js";
import { formatTokens } from "../apikey-pricing.js";

const DIVIDER = "━━━━━━━━━━━━━━━━";

const L = {
    vi: {
        giftTitle: "Chúc mừng! Bạn nhận được quà",
        buyTitle: "Tạo API key thành công",
        tapToCopy: "(chạm để copy)",
        quota: "Quota",
        tokens: "token",
        rpm: "RPM",
        rpmUnit: "lệnh/phút",
        expires: "Hết hạn",
        noExpiry: "không hết hạn theo thời gian",
        howTo: "Cách dùng key (tương thích OpenAI)",
        endpoint: "Endpoint",
        header: "Header",
        model: "Model",
        addedTo: (cmd) => `Key đã được thêm vào 🔑 API key của bạn (${cmd}).`,
        checkUsage: "Xem mức sử dụng tại",
        price: "Giá",
        note: "Ghi chú",
    },
    en: {
        giftTitle: "Congrats! You got a gift",
        buyTitle: "API key created",
        tapToCopy: "(tap to copy)",
        quota: "Quota",
        tokens: "tokens",
        rpm: "RPM",
        rpmUnit: "req/min",
        expires: "Expires",
        noExpiry: "no time-based expiry",
        howTo: "How to use the key (OpenAI-compatible)",
        endpoint: "Endpoint",
        header: "Header",
        model: "Model",
        addedTo: (cmd) => `The key was added to 🔑 My API keys (${cmd}).`,
        checkUsage: "Check usage at",
        price: "Price",
        note: "Note",
    },
    zh: {
        giftTitle: "恭喜！您获得了礼物",
        buyTitle: "API 密钥创建成功",
        tapToCopy: "（点击复制）",
        quota: "配额",
        tokens: "token",
        rpm: "RPM",
        rpmUnit: "次/分钟",
        expires: "过期时间",
        noExpiry: "无时间限制",
        howTo: "如何使用密钥（兼容 OpenAI）",
        endpoint: "接口地址",
        header: "请求头",
        model: "模型",
        addedTo: (cmd) => `密钥已添加到 🔑 我的 API 密钥（${cmd}）。`,
        checkUsage: "用量查询",
        price: "价格",
        note: "备注",
    },
};

function labels(lang) {
    return L[["vi", "en", "zh"].includes(lang) ? lang : "vi"];
}

/**
 * @param {object} p
 * @param {string} p.key            — sk-... plaintext
 * @param {number} p.quotaTokens
 * @param {number} p.rpm
 * @param {string[]} p.models
 * @param {string} p.endpoint       — vd https://api.xpiki.com/v1
 * @param {string} p.usageUrl       — trang xem mức dùng (tuỳ chọn)
 * @param {string} p.mykeyCommand   — vd "/mykey"
 * @param {"gift"|"buy"} p.kind
 * @param {number|null} p.priceUsd  — chỉ hiện khi kind="buy"
 * @param {string|null} p.expiresAt
 * @param {string|null} p.note
 * @param {string} p.lang
 * @param {(key: string) => string} p.icon — hàm lấy icon theo key config
 */
export function apiKeyMessage({
    key,
    quotaTokens = 0,
    rpm = 0,
    models = [],
    endpoint = "",
    usageUrl = "",
    mykeyCommand = "/mykey",
    kind = "gift",
    priceUsd = null,
    expiresAt = null,
    note = null,
    lang = "vi",
    icon = () => "",
} = {}) {
    const t = labels(lang);
    const ic = (k) => {
        const v = icon(k);
        return v ? `${v} ` : "";
    };

    const lines = [];
    lines.push(`${ic(kind === "gift" ? "GIFT_WIN" : "STATUS_SUCCESS")}<b>${kind === "gift" ? t.giftTitle : t.buyTitle}</b>`);
    lines.push(DIVIDER);
    lines.push(`<code>${escapeHtml(key)}</code>`);
    lines.push(`<i>${t.tapToCopy}</i>`);
    lines.push("");
    lines.push(`${ic("APIKEY_QUOTA")}${t.quota}: <b>${formatTokens(quotaTokens)} ${t.tokens}</b> (${Number(quotaTokens).toLocaleString("en-US")})`);
    if (rpm > 0) {
        lines.push(`${ic("APIKEY_RPM")}${t.rpm}: <b>${rpm} ${t.rpmUnit}</b>`);
    }
    if (expiresAt) {
        lines.push(`${ic("APIKEY_EXPIRES")}${t.expires}: <b>${escapeHtml(String(expiresAt).slice(0, 19).replace("T", " "))}</b>`);
    }
    if (kind === "buy" && priceUsd !== null) {
        lines.push(`${ic("FIELD_PRICE")}${t.price}: <b>$${Number(priceUsd).toFixed(2)}</b>`);
    }

    lines.push("");
    lines.push(`${ic("APIKEY_DOCS")}<b>${t.howTo}</b>`);
    if (endpoint) lines.push(`• ${t.endpoint}: <code>${escapeHtml(endpoint)}</code>`);
    lines.push(`• ${t.header}: <code>Authorization: Bearer &lt;sk-key&gt;</code>`);
    if (models.length) {
        lines.push(`• ${t.model}: <code>${escapeHtml(models.join(", "))}</code>`);
    }

    lines.push("");
    lines.push(t.addedTo(mykeyCommand));
    if (usageUrl) {
        lines.push(`${ic("APIKEY_USAGE")}${t.checkUsage}: ${escapeHtml(usageUrl)}`);
    }
    if (note) {
        lines.push("");
        lines.push(`${ic("ADMIN_NOTE")}${t.note}: ${escapeHtml(note)}`);
    }

    return lines.join("\n");
}

/**
 * Danh sách key của khách cho /mykey.
 */
export function myKeysMessage(keys = [], { lang = "vi", icon = () => "" } = {}) {
    const t = labels(lang);
    const ic = (k) => {
        const v = icon(k);
        return v ? `${v} ` : "";
    };
    const title = lang === "en" ? "My API keys" : lang === "zh" ? "我的 API 密钥" : "API key của tôi";
    const empty = lang === "en"
        ? "You have no API key yet."
        : lang === "zh" ? "您还没有 API 密钥。" : "Bạn chưa có API key nào.";

    if (!keys.length) {
        return `${ic("APIKEY_MY_KEYS")}<b>${title}</b>\n${DIVIDER}\n${empty}`;
    }

    const sourceLabel = (source) => {
        if (source === "GIFTCODE") return lang === "en" ? "gift" : lang === "zh" ? "礼品" : "quà tặng";
        if (source === "ADMIN") return "admin";
        return lang === "en" ? "purchased" : lang === "zh" ? "已购买" : "đã mua";
    };

    const rows = keys.map((k, i) => {
        const created = k.createdAt ? new Date(k.createdAt).toLocaleDateString("vi-VN") : "";
        const meta = [
            `${formatTokens(k.quotaTokens)} ${t.tokens}`,
            k.rpm > 0 ? `${k.rpm} ${t.rpmUnit}` : null,
            sourceLabel(k.source),
            created,
        ].filter(Boolean).join(" · ");
        return `${i + 1}. <b>${meta}</b>\n<code>${escapeHtml(k.key)}</code>`;
    });

    return `${ic("APIKEY_MY_KEYS")}<b>${title}</b> (${keys.length})\n${DIVIDER}\n${rows.join("\n\n")}`;
}

export default { apiKeyMessage, myKeysMessage };
