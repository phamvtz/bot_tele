/**
 * Nguồn dữ liệu nạp USDT từ tài khoản Binance (thay cho việc đọc trực tiếp
 * blockchain qua BscScan/TronGrid).
 *
 * Vì sao: đọc explorer là mỗi mạng một API, mỗi API một kiểu phân trang và một
 * hạn mức riêng — BscScan còn không lọc được theo thời gian nên ví bị spam token
 * dust là bỏ sót giao dịch của khách. Binance có MỘT endpoint lịch sử nạp trả về
 * nạp của MỌI mạng, lọc được theo startTime, nên thêm mạng mới không cần thêm
 * code đọc chain.
 *
 * Đánh đổi: ví nhận phải là địa chỉ nạp của chính tài khoản Binance này, và tiền
 * chỉ được ghi nhận sau khi Binance credit (đủ số confirm) — chậm hơn đọc chain
 * vài chục giây tới vài phút tùy mạng.
 *
 * API key chỉ cần quyền đọc (Enable Reading). KHÔNG bật rút tiền / giao dịch.
 */
import { createHmac } from "node:crypto";
import { getCryptoConfigSync } from "../shop-config.js";
import { sendLog } from "../lib/logger.js";

const DEFAULT_BASE = "https://api.binance.com";
const DEFAULT_TIMEOUT_MS = 10000;
// Binance: khoảng startTime..endTime không được vượt 90 ngày.
const MAX_WINDOW_MS = 89 * 24 * 60 * 60 * 1000;
const PAGE_LIMIT = 1000;
const MAX_PAGES = 5;
const TIME_OFFSET_TTL_MS = 5 * 60 * 1000;

/**
 * Mã network của Binance → network key nội bộ của bot.
 *
 * Nạp trên mạng KHÔNG có trong bảng này không được auto-credit (bot không bán mạng
 * đó, không có ví nhận để đối chiếu), nhưng cũng KHÔNG được bỏ im lặng — xem
 * reportUnmappedNetwork.
 */
const NETWORK_BY_BINANCE_CODE = {
    TRX: "trc20",
    BSC: "bep20",
};

/**
 * status: 0 pending, 1 success, 6 credited but cannot withdraw,
 *         7 wrong deposit, 8 waiting user confirm.
 * Chỉ 1 và 6 nghĩa là tiền ĐÃ vào tài khoản (6 chỉ chặn rút, không chặn đã nhận).
 */
const ARRIVED_STATUSES = new Set([1, 6]);

function conf(key) {
    const runtime = getCryptoConfigSync();
    return runtime[key] || process.env[key] || "";
}

function getTimeoutMs() {
    return Number(process.env.CRYPTO_POLL_TIMEOUT_MS || DEFAULT_TIMEOUT_MS);
}

export function getBinanceCredentials() {
    return {
        apiKey: conf("BINANCE_API_KEY"),
        apiSecret: conf("BINANCE_API_SECRET"),
        base: conf("BINANCE_API_BASE") || DEFAULT_BASE,
    };
}

export function isBinanceConfigured() {
    const { apiKey, apiSecret } = getBinanceCredentials();
    return !!(apiKey && apiSecret);
}

export function binanceNetworkKey(code) {
    return NETWORK_BY_BINANCE_CODE[String(code || "").toUpperCase()] || null;
}

export function binanceSupportsNetwork(network) {
    return Object.values(NETWORK_BY_BINANCE_CODE).includes(String(network || "").toLowerCase());
}

// Lệch giờ giữa VPS và Binance làm request bị từ chối (-1021). Đo một lần rồi
// dùng lại trong TTL, thay vì gọi /api/v3/time trước mỗi request.
let _timeOffsetMs = 0;
let _timeOffsetAt = 0;

export function resetBinanceTimeOffset() {
    _timeOffsetMs = 0;
    _timeOffsetAt = 0;
}

async function syncServerTime(base, { force = false } = {}) {
    if (!force && _timeOffsetAt && Date.now() - _timeOffsetAt < TIME_OFFSET_TTL_MS) {
        return _timeOffsetMs;
    }
    const response = await fetch(new URL("/api/v3/time", base), {
        signal: AbortSignal.timeout(getTimeoutMs()),
    });
    if (!response.ok) throw new Error(`Binance /api/v3/time HTTP ${response.status}`);
    const body = await response.json();
    const serverTime = Number(body?.serverTime);
    if (!Number.isFinite(serverTime)) throw new Error("Binance /api/v3/time thiếu serverTime");
    _timeOffsetMs = serverTime - Date.now();
    _timeOffsetAt = Date.now();
    return _timeOffsetMs;
}

async function signedGet(path, params, { retryOnClockSkew = true } = {}) {
    const { apiKey, apiSecret, base } = getBinanceCredentials();
    if (!apiKey || !apiSecret) {
        throw new Error("Chưa cấu hình BINANCE_API_KEY / BINANCE_API_SECRET");
    }

    // Không đo được giờ server thì vẫn thử với giờ local: recvWindow 5s thường
    // đủ, và nếu lệch thật thì nhánh -1021 dưới sẽ đồng bộ rồi thử lại.
    let offset = 0;
    try {
        offset = await syncServerTime(base);
    } catch (_) {
        offset = _timeOffsetMs;
    }

    const query = new URLSearchParams({
        ...params,
        recvWindow: "5000",
        timestamp: String(Date.now() + offset),
    });
    // Chữ ký tính trên đúng chuỗi query sẽ gửi, chưa gồm signature.
    query.set("signature", createHmac("sha256", apiSecret).update(query.toString()).digest("hex"));

    const url = new URL(path, base);
    url.search = query.toString();

    const response = await fetch(url, {
        headers: { "X-MBX-APIKEY": apiKey },
        signal: AbortSignal.timeout(getTimeoutMs()),
    });

    const text = await response.text();
    let body = null;
    try {
        body = text ? JSON.parse(text) : null;
    } catch (_) {
        body = null;
    }

    if (!response.ok) {
        const code = Number(body?.code || 0);
        // -1021: timestamp ngoài recvWindow → giờ VPS đã trôi. Đồng bộ lại và
        // thử ĐÚNG một lần, không lặp vô hạn khi lỗi thật sự khác.
        if (code === -1021 && retryOnClockSkew) {
            await syncServerTime(base, { force: true }).catch(() => {});
            return signedGet(path, params, { retryOnClockSkew: false });
        }
        throw new Error(`Binance ${path} HTTP ${response.status}${body?.msg ? `: ${body.msg}` : ""}`);
    }

    return body;
}

/**
 * Nạp USDT đã vào tài khoản nhưng trên mạng bot không bán.
 *
 * Trước đây mapDeposit lặng lẽ `return null` cho mọi mạng ngoài BSC/TRX. Đã quan
 * sát thấy trên tài khoản thật một khoản 6 USDT qua TON, status=1 (Binance ĐÃ
 * credit), bị bot phớt lờ hoàn toàn — không log, không cảnh báo. Nếu đó là tiền
 * của khách thì khách mất tiền mà không ai biết để hoàn.
 *
 * Vẫn KHÔNG auto-credit: bot không có ví nhận mạng đó để đối chiếu, và TON còn
 * bắt buộc memo nên rất dễ là tiền của người khác hoặc của chính shop. Chỉ báo
 * để admin đối soát tay — đúng cách xử lý cho tiền không rõ chủ.
 */
const _reportedUnmapped = new Set();
function reportUnmappedNetwork(item) {
    const key = String(item?.txId || item?.id || "");
    if (!key || _reportedUnmapped.has(key)) return;
    _reportedUnmapped.add(key);
    console.warn(
        `⚠️ Binance: nạp ${item?.amount} USDT trên mạng ${item?.network} (không phải BSC/TRX) — `
        + `bot không tự cộng, cần đối soát tay. txId=${key}`,
    );
    sendLog(
        "ERROR",
        `⚠️ *NẠP USDT MẠNG LẠ — CẦN ĐỐI SOÁT TAY*\n`
        + `🌐 Mạng: ${item?.network}\n`
        + `💵 Số tiền: ${item?.amount} USDT\n`
        + `🔗 TX: \`${key}\`\n\n`
        + `Bot chỉ tự cộng nạp qua BSC (BEP20) và TRX (TRC20). Nếu đây là tiền của khách, `
        + `vui lòng cộng tay cho đúng đơn.`,
    );
}

function mapDeposit(item) {
    if (String(item?.coin || "").toUpperCase() !== "USDT") return null;
    if (!ARRIVED_STATUSES.has(Number(item?.status))) return null;

    const amount = Number(item?.amount || 0);
    if (!(amount > 0)) return null;

    const network = binanceNetworkKey(item?.network);
    if (!network) {
        reportUnmappedNetwork(item);
        return null;
    }

    // Nạp nội bộ Binance có thể không có txId on-chain; dùng id bản ghi để
    // event key vẫn duy nhất (idempotency của poller dựa vào nó).
    const txid = item?.txId || (item?.id != null ? `binance-${item.id}` : "");
    if (!txid) return null;

    return {
        network,
        txid: String(txid),
        from: item.sourceAddress || "",
        to: item.address || "",
        amount,
        timestamp: Number(item.insertTime || 0),
    };
}

/**
 * Toàn bộ nạp USDT đã vào tài khoản, MỌI mạng, kể từ `sinceMs`.
 *
 * Trả về cùng shape với transfer đọc từ chain (`{network, txid, from, to,
 * amount, timestamp}`) để phần khớp đơn không cần biết nguồn nào.
 */
export async function fetchBinanceUsdtDeposits(sinceMs = 0) {
    // startTime cũ hơn 90 ngày sẽ bị Binance từ chối; kẹp lại thay vì để lỗi.
    const start = sinceMs > 0 ? Math.max(sinceMs, Date.now() - MAX_WINDOW_MS) : 0;

    const rows = [];
    for (let page = 0; page < MAX_PAGES; page += 1) {
        const params = {
            coin: "USDT",
            limit: String(PAGE_LIMIT),
            offset: String(page * PAGE_LIMIT),
        };
        // endTime để Binance tự lấy hiện tại: gửi endTime=now có thể cắt mất bản
        // ghi vừa insert nếu giờ VPS chạy chậm hơn giờ server.
        if (start > 0) params.startTime = String(start);

        const batch = await signedGet("/sapi/v1/capital/deposit/hisrec", params);
        const list = Array.isArray(batch) ? batch : [];
        rows.push(...list);
        if (list.length < PAGE_LIMIT) break;
    }

    return rows.map(mapDeposit).filter(Boolean);
}

export default {
    fetchBinanceUsdtDeposits,
    isBinanceConfigured,
    binanceNetworkKey,
    binanceSupportsNetwork,
    getBinanceCredentials,
    resetBinanceTimeOffset,
};
