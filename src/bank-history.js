import { parseIPNItems } from "./payment/vietqr.js";

const DEFAULT_INTERVAL_MS = 5000;

export function getBankHistoryConfig() {
    return {
        enabled: process.env.BANK_POLL_ENABLED !== "false",
        intervalMs: Number(process.env.BANK_POLL_INTERVAL_MS || DEFAULT_INTERVAL_MS),
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

async function fetchJson(url, options) {
    const response = await fetch(url, options);
    if (!response.ok) {
        throw new Error(`HTTP ${response.status} @ ${typeof url === "string" ? url : url.toString()}`);
    }
    return response.json();
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

    const attempts = [
        () => fetchJson(historyUrl || queryUrl, { method: "GET", headers }),
        () => fetchJson(queryUrl, { method: "GET", headers }),
        () => fetchJson(config.baseUrl, {
            method: "POST",
            headers,
            body: JSON.stringify({
                token: config.token,
                accountNo: config.accountNo,
                accountNumber: config.accountNo,
                username: config.accountName,
            }),
        }),
    ];

    let lastError;
    for (const attempt of attempts) {
        try {
            const payload = await attempt();
            const items = parseIPNItems(payload, "thueapibank");
            if (items.length) return items;
            if (payload?.status === "success") return [];
        } catch (error) {
            lastError = error;
        }
    }

    throw lastError || new Error("Unable to fetch bank history");
}
