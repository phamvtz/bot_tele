/**
 * Binance Pay (C2C) — nguồn đối soát giao dịch USDT nhận qua Binance Pay.
 *
 * Khác TRC20/BEP20: đây KHÔNG phải blockchain. Không có địa chỉ ví, không có
 * explorer, không tra được on-chain. Ta phụ thuộc hoàn toàn vào nhà cung cấp
 * thueapibank.vn đọc lịch sử Binance Pay của tài khoản shop.
 *
 * Hai endpoint, dùng cùng một token:
 *   V1  GET {base}/{token}    → { rows: [...] }          — toàn bộ giao dịch
 *   V2  GET {baseV2}/{token}  → { transactions: [...] }  — chỉ C2C
 *
 * GIỚI HẠN quan trọng: V1 không phân trang và không có tham số thời gian — nó
 * trả về một cửa sổ giao dịch gần nhất (đo thực tế: ~34 dòng). Shop nhiều giao
 * dịch Pay trong thời gian ngắn thì giao dịch của một đơn PENDING có thể rơi ra
 * ngoài cửa sổ đó và không bao giờ khớp. Không sửa được từ phía client; nếu gặp,
 * phải giảm CRYPTO_EXPIRE_MINUTES hoặc đối soát tay.
 *
 * V1 là nguồn CHÍNH vì có `transactionTime`/`timestamp` dạng epoch ms — khớp
 * trực tiếp với `transfer.timestamp` mà tầng matching đang dùng. V2 chỉ có
 * `transactionDate` dạng "DD/MM/YYYY HH:mm:ss" theo giờ VN (UTC+7, đã đối
 * chiếu với timestamp V1 của cùng giao dịch), phải tự quy đổi nên sai lệch
 * múi giờ là rủi ro thật: lệch 1 giờ là giao dịch bị coi như xảy ra TRƯỚC khi
 * tạo đơn và bị bỏ qua. Vì vậy V2 chỉ dùng làm dự phòng khi V1 lỗi.
 *
 * V1 trả cả giao dịch nội bộ (FUNDING_MAIN / MAIN_FUNDING = chuyển giữa các ví
 * Binance của chính mình) và giao dịch gửi ra (amount âm). Chỉ giữ
 * type = BINANCE_PAY với amount > 0, nếu không sẽ tự khớp tiền của chính mình.
 */

const DEFAULT_BASE_V1 = "https://thueapibank.vn/historyapibinance";
const DEFAULT_BASE_V2 = "https://thueapibank.vn/historyapibinancev2";
const DEFAULT_TZ_OFFSET_HOURS = 7;
const PAY_TYPE = "BINANCE_PAY";

/**
 * Network key nội bộ. Phải khớp entry `binance_pay` trong NETWORKS của crypto.js:
 * getCryptoNetworkConfig(network) tra theo đúng key này, lệch một ký tự là toàn bộ
 * transfer bị coi như sai mạng và không đơn nào khớp.
 */
export const BINANCE_PAY_NETWORK = "binance_pay";

/**
 * Ghép token vào base URL. Hỗ trợ cả placeholder `{token}` (nếu provider đổi
 * định dạng) và dạng `base/token` như tài liệu hiện tại. Không nhân đôi token
 * nếu người cấu hình đã dán sẵn cả token vào base.
 */
export function buildBinanceHistoryUrl(baseUrl, token) {
    if (!baseUrl) return "";
    if (!token) return baseUrl;
    if (baseUrl.includes("{token}")) return baseUrl.replace("{token}", encodeURIComponent(token));

    const base = baseUrl.replace(/\/+$/, "");
    const encoded = encodeURIComponent(token);
    if (base.endsWith(`/${encoded}`) || base.endsWith(`/${token}`)) return base;
    return `${base}/${encoded}`;
}

/**
 * "DD/MM/YYYY HH:mm:ss" (giờ VN) → epoch ms. Trả 0 nếu không parse được —
 * tầng matching coi transfer không có timestamp là "không rõ thời điểm" và vẫn
 * xét khớp theo số tiền, tốt hơn là đoán sai giờ rồi loại oan.
 */
export function parseBinanceV2Date(value, tzOffsetHours = DEFAULT_TZ_OFFSET_HOURS) {
    const match = String(value || "").trim().match(/^(\d{2})\/(\d{2})\/(\d{4})[ T](\d{2}):(\d{2}):(\d{2})$/);
    if (!match) return 0;
    const [, dd, mm, yyyy, hh, mi, ss] = match;
    const utc = Date.UTC(Number(yyyy), Number(mm) - 1, Number(dd), Number(hh), Number(mi), Number(ss));
    return utc - Number(tzOffsetHours) * 3600 * 1000;
}

/** Chuẩn hoá row V1 → shape transfer dùng chung với TRC20/BEP20. */
export function mapBinanceV1Rows(rows, { payId = "", token = "USDT" } = {}) {
    if (!Array.isArray(rows)) return [];
    const wanted = String(token || "USDT").toUpperCase();

    return rows
        .filter((row) => String(row?.type || "").toUpperCase() === PAY_TYPE)
        .filter((row) => Number(row?.amount) > 0)
        .filter((row) => !row?.currency || String(row.currency).toUpperCase() === wanted)
        .map((row) => ({
            network: BINANCE_PAY_NETWORK,
            txid: String(row.transactionId || row.orderId || ""),
            from: String(row.payerInfo?.name || row.payerInfo?.binanceId || ""),
            // Không có địa chỉ nhận thật; gán chính Pay ID đã cấu hình để lớp
            // matching (so `transfer.to` với địa chỉ kỳ vọng) không loại oan.
            to: payId,
            amount: Number(row.amount),
            memo: String(row.note || ""),
            timestamp: Number(row.transactionTime || row.timestamp || 0),
            source: "v1",
        }))
        .filter((item) => item.txid);
}

/** Chuẩn hoá row V2 → shape transfer dùng chung. */
export function mapBinanceV2Rows(rows, { payId = "", tzOffsetHours = DEFAULT_TZ_OFFSET_HOURS } = {}) {
    if (!Array.isArray(rows)) return [];

    return rows
        .filter((row) => String(row?.type || "").toUpperCase() === "IN")
        .filter((row) => Number(row?.amount) > 0)
        .map((row) => ({
            network: BINANCE_PAY_NETWORK,
            txid: String(row.transactionID || row.transactionId || ""),
            from: "",
            to: payId,
            amount: Number(row.amount),
            memo: String(row.description || ""),
            timestamp: parseBinanceV2Date(row.transactionDate, tzOffsetHours),
            source: "v2",
        }))
        .filter((item) => item.txid);
}

/**
 * Lấy lịch sử Binance Pay đã chuẩn hoá.
 *
 * V1 trước, V2 dự phòng: chỉ khi V1 lỗi mạng/HTTP hoặc trả payload không đọc
 * được. V1 trả danh sách rỗng KHÔNG phải lỗi (tài khoản chưa có giao dịch nào
 * trong cửa sổ) — fallback lúc đó chỉ tốn thêm một request mỗi tick.
 *
 * `sinceMs` được lọc phía client: provider không có tham số thời gian. Transfer
 * thiếu timestamp (V2 parse lỗi) được giữ lại, đúng như đường TRC20/BEP20.
 */
export async function fetchBinancePayTransfers(config, sinceMs = 0, { fetchJson } = {}) {
    const get = fetchJson;
    if (typeof get !== "function") throw new Error("fetchBinancePayTransfers cần fetchJson");
    if (!config?.apiKey) return [];

    const payId = config.address || "";
    const baseV1 = config.apiBase || DEFAULT_BASE_V1;
    const baseV2 = config.apiBaseV2 || DEFAULT_BASE_V2;
    const tzOffsetHours = Number(config.tzOffsetHours ?? DEFAULT_TZ_OFFSET_HOURS);

    let transfers = null;
    let firstError = null;

    const urlV1 = buildBinanceHistoryUrl(baseV1, config.apiKey);
    try {
        const payload = await get(urlV1, { method: "GET" });
        if (Array.isArray(payload?.rows)) {
            transfers = mapBinanceV1Rows(payload.rows, { payId, token: config.token });
        } else {
            firstError = new Error("Binance Pay V1 trả payload không có `rows`");
        }
    } catch (error) {
        firstError = error;
    }

    if (transfers === null) {
        const urlV2 = buildBinanceHistoryUrl(baseV2, config.apiKey);
        try {
            const payload = await get(urlV2, { method: "GET" });
            if (Array.isArray(payload?.transactions)) {
                console.warn(`⚠️ Binance Pay: V1 lỗi (${firstError?.message}), đang dùng V2 dự phòng`);
                transfers = mapBinanceV2Rows(payload.transactions, { payId, tzOffsetHours });
            }
        } catch (error) {
            // Giữ lỗi V1 làm lỗi báo cáo: đó là nguồn chính, lỗi của nó mới là
            // nguyên nhân thật cần admin xử lý.
            if (!firstError) firstError = error;
        }
    }

    if (transfers === null) throw firstError || new Error("Không đọc được lịch sử Binance Pay");

    return sinceMs ? transfers.filter((item) => !item.timestamp || item.timestamp >= sinceMs) : transfers;
}

export const BINANCE_PAY_DEFAULTS = {
    baseV1: DEFAULT_BASE_V1,
    baseV2: DEFAULT_BASE_V2,
    tzOffsetHours: DEFAULT_TZ_OFFSET_HOURS,
};

export default {
    buildBinanceHistoryUrl,
    parseBinanceV2Date,
    mapBinanceV1Rows,
    mapBinanceV2Rows,
    fetchBinancePayTransfers,
    BINANCE_PAY_DEFAULTS,
};
