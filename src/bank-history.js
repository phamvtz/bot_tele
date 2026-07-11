import { parseIPNItems } from "./payment/vietqr.js";

const DEFAULT_INTERVAL_MS = 3000;

const DEFAULT_TIMEOUT_MS = 15000;

export function getBankHistoryConfig() {
    return {
        enabled: process.env.BANK_POLL_ENABLED !== "false",
        intervalMs: Number(process.env.BANK_POLL_INTERVAL_MS || DEFAULT_INTERVAL_MS),
        timeoutMs: Number(process.env.BANK_POLL_TIMEOUT_MS || DEFAULT_TIMEOUT_MS),
        baseUrl: process.env.MBBANK_HISTORY_BASE || "",
        token: process.env.MBBANK_API_TOKEN || "",
        accountNo: process.env.MBBANK_ACCOUNT_NO || process.env.BANK_ACCOUNT || "",
        accountName: process.env.MBBANK_USERNAME || process.env.MBBANK_ACCOUNT_NAME || "",
    };
}

export function buildHistoryUrl(baseUrl, token) {
    if (!baseUrl) return "";
    if (!token) return baseUrl;

    if (baseUrl.includes("{token}")) {
        return baseUrl.replace("{token}", encodeURIComponent(token));
    }

    const normalizedBase = baseUrl.replace(/\/+$/, "");
    const encodedToken = encodeURIComponent(token);

    if (normalizedBase.endsWith(`/${encodedToken}`) || normalizedBase.endsWith(`/${token}`)) {
        return normalizedBase;
    }

    return `${normalizedBase}/${encodedToken}`;
}

async function fetchJson(url, options = {}, timeoutMs = DEFAULT_TIMEOUT_MS) {
    const response = await fetch(url, {
        ...options,
        signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) {
        throw new Error(`HTTP ${response.status} @ ${typeof url === "string" ? url : url.toString()}`);
    }
    return response.json();
}

/**
 * Decide whether a provider response is a "successful empty list" — i.e. API
 * trả về OK nhưng chưa có giao dịch mới. Trong trường hợp này KHÔNG fallback
 * sang attempt khác (vì sẽ tốn thêm 5–10s vô ích cho mỗi poll tick).
 */
function looksLikeEmptyOk(payload) {
    if (!payload) return false;
    // Status flag rõ ràng
    if (payload.status === "success" || payload.status === "ok") return true;
    if (payload.success === true) return true;
    // Có structure transaction nhưng rỗng — chấp nhận luôn
    if (Array.isArray(payload.transactions) && payload.transactions.length === 0) return true;
    if (Array.isArray(payload.TranList) && payload.TranList.length === 0) return true;
    if (Array.isArray(payload.data) && payload.data.length === 0) return true;
    if (Array.isArray(payload) && payload.length === 0) return true;
    return false;
}

export async function fetchBankHistory(config = getBankHistoryConfig()) {
    const historyUrl = buildHistoryUrl(config.baseUrl, config.token);
    const headers = {
        "Content-Type": "application/json",
        "x-api-key": config.token,
        Authorization: `Bearer ${config.token}`,
    };

    const queryUrl = new URL(historyUrl || config.baseUrl);
    if (config.token) queryUrl.searchParams.set("token", config.token);
    if (config.accountNo) {
        queryUrl.searchParams.set("accountNo", config.accountNo);
        queryUrl.searchParams.set("accountNumber", config.accountNo);
    }
    if (config.accountName) {
        queryUrl.searchParams.set("username", config.accountName);
    }

    const timeoutMs = config.timeoutMs || DEFAULT_TIMEOUT_MS;
    const attempts = [
        () => fetchJson(historyUrl || queryUrl, { method: "GET", headers }, timeoutMs),
        () => fetchJson(queryUrl, { method: "GET", headers }, timeoutMs),
        () => fetchJson(config.baseUrl, {
            method: "POST",
            headers,
            body: JSON.stringify({
                token: config.token,
                accountNo: config.accountNo,
                accountNumber: config.accountNo,
                username: config.accountName,
            }),
        }, timeoutMs),
    ];

    // Giữ lỗi của attempt ĐẦU TIÊN (định dạng URL chuẩn base/token) làm lỗi báo cáo —
    // đây là nguyên nhân thật (vd timeout mạng). Các fallback thường trả 404 vì
    // provider chỉ chấp nhận đúng 1 định dạng, nên lỗi 404 của chúng gây hiểu lầm.
    let firstError;
    let lastError;
    for (const attempt of attempts) {
        try {
            const payload = await attempt();
            const items = parseIPNItems(payload, "thueapibank");
            if (items.length) return items;
            // Empty-OK → return [] luôn, không fallback (tránh tốn 5–10s vô ích).
            if (looksLikeEmptyOk(payload)) return [];
            // Else: payload không hợp lệ (vd HTML, error wrapper) → thử attempt kế.
        } catch (error) {
            if (!firstError) firstError = error;
            lastError = error;
        }
    }

    throw firstError || lastError || new Error("Unable to fetch bank history");
}
