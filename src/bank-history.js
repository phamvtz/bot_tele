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

/**
 * Provider báo lỗi NGHIỆP VỤ ngay trong body dù HTTP 200 — vd thueapibank trả
 * `{"status":"error","msg":"Trạng thái API đang tắt"}` khi thuê bao bị tắt/hết hạn.
 * Trả về chuỗi thông báo (để ném thành lỗi) hoặc `null` nếu payload không phải lỗi.
 *
 * PHẢI bắt trước khi parse. `parseIPNItems` có nhánh fallback LUÔN trả về một phần tử
 * cho bất kỳ object nào, nên payload lỗi này thành `[{amount:0, content:""}]` →
 * `items.length` = 1 (truthy) → `fetchBankHistory` trả về THÀNH CÔNG. Poller khi đó
 * reset backoff, xoá `lastError`, không log, không `sendLog`: auto-confirm đơn VietQR
 * chết hẳn mà admin không nhận được một tín hiệu nào. Đã xảy ra thật (2026-09-13):
 * khách chuyển tiền không nhận được key, 10 đơn PENDING tồn 5 tiếng.
 */
function providerErrorMessage(payload) {
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
    const status = String(payload.status ?? "").toLowerCase();
    const failed = payload.success === false
        || ["error", "fail", "failed", "false"].includes(status);
    if (!failed) return null;
    const msg = payload.msg || payload.message || payload.error || payload.reason || status || "không rõ";
    return `provider báo lỗi: ${String(msg).slice(0, 200)}`;
}

/**
 * Item dùng được = có số tiền VÀ có nội dung để khớp mã đơn.
 *
 * Không lọc thì một payload rác cũng được coi là "có giao dịch" (xem
 * `providerErrorMessage`). Đây chính là bộ lọc mà webhook IPN ở server.js đang dùng.
 */
const isUsableItem = (item) => Number(item?.amount) > 0 && String(item?.content || "").trim().length > 0;

/**
 * Che token trong thông điệp lỗi.
 *
 * `buildHistoryUrl` đặt token vào PATH, còn attempt 2/3 đặt vào query — mà `fetchJson`
 * ném `HTTP 404 @ <url nguyên văn>`. Lỗi đó đi thẳng ra `console.log("Bank polling
 * error:", …)` VÀ `sendLog("ERROR", …)` tức kênh Telegram admin: bí mật nhà cung cấp
 * nằm trong log plaintext và trong một chat có thể forward được.
 */
function redactSecret(error, token) {
    if (!token) return error;
    const msg = String(error?.message || error);
    const encoded = encodeURIComponent(token);
    if (!msg.includes(token) && !msg.includes(encoded)) return error;
    const out = new Error(msg.split(token).join("<token>").split(encoded).join("<token>"));
    if (error?.cause !== undefined) out.cause = error.cause;
    return out;
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
        let payload;
        try {
            payload = await attempt();
        } catch (error) {
            // Lỗi của attempt ĐẦU được giữ làm lỗi báo cáo, và luôn đi qua redact:
            // chính nó là chuỗi được log và gửi sang kênh admin.
            const safe = redactSecret(error, config.token);
            if (!firstError) firstError = safe;
            lastError = safe;
            continue;
        }

        // Provider tắt/hết hạn → NÉM NGAY, không thử attempt kế: cả ba đều gọi cùng
        // một provider nên kết quả giống nhau, thử tiếp chỉ đốt thêm 2×15s mỗi tick
        // và `firstError` sẽ là lỗi mạng của attempt đầu chứ không phải thông điệp thật.
        const providerError = providerErrorMessage(payload);
        if (providerError) throw new Error(providerError);

        const items = parseIPNItems(payload, "thueapibank").filter(isUsableItem);
        if (items.length) return items;
        // Empty-OK → return [] luôn, không fallback (tránh tốn 5–10s vô ích).
        if (looksLikeEmptyOk(payload)) return [];
        // Else: payload không hợp lệ (vd HTML, error wrapper) → thử attempt kế.
    }

    throw firstError || lastError || new Error("Unable to fetch bank history");
}
