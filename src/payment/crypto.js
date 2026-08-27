import { getCryptoConfigSync, getOrderExpireMinutesSync } from "../shop-config.js";
import { escapeHtml } from "../bot-ui/format.js";
import { getCryptoAmountTolerance } from "./amounts.js";
import { fetchBinanceUsdtDeposits, isBinanceConfigured } from "./binance.js";
import { fetchBinancePayTransfers, BINANCE_PAY_DEFAULTS, BINANCE_PAY_NETWORK } from "./binance-pay.js";

const USDT_TRC20_CONTRACT = "TXLAQ63Xg1NAzckPwKHvzw7CSEmLMEqcdj";
const USDT_BEP20_CONTRACT = "0x55d398326f99059fF775485246999027B3197955";
const DEFAULT_USD_VND_RATE = 26500;
const DEFAULT_TIMEOUT_MS = 10000;
const DEFAULT_RATE_API = "https://api.coingecko.com/api/v3/simple/price?ids=tether&vs_currencies=vnd,cny";
const DEFAULT_RATE_TTL_MS = 5 * 60 * 1000;
const DEFAULT_USD_CNY_RATE = 7.25;

let usdVndRateCache = {
    value: null,
    cnyValue: null,
    updatedAt: 0,
    source: "fallback",
};
let usdVndRateRefreshPromise = null;
let usdVndRateTimer = null;

/**
 * Nguồn dữ liệu xác nhận nạp: Binance (lịch sử nạp của tài khoản) cho MỌI mạng.
 *
 * Trước đây mỗi mạng đọc explorer riêng (TronGrid cho TRC20, BscScan cho BEP20).
 * BscScan không lọc được theo thời gian nên ví bị spam token dust là bỏ sót giao
 * dịch của khách — đã bỏ hẳn đường đó. Binance có một endpoint trả về nạp của mọi
 * mạng, lọc được theo startTime, nên thêm mạng mới không cần code đọc chain mới.
 *
 * Hệ quả: `*_USDT_ADDRESS` phải là ĐỊA CHỈ NẠP CỦA TÀI KHOẢN BINANCE đó, và mạng
 * nào cũng cần BINANCE_API_KEY/SECRET mới bật được (xem getEnabledCryptoNetworks).
 * TronGrid giữ lại làm đường dự phòng cho TRC20 khi chưa cấu hình Binance.
 */
const NETWORKS = {
    trc20: {
        key: "trc20",
        method: "crypto_trc20",
        label: "TRC20",
        chainName: "Tron",
        token: "USDT",
        explorerTx: "https://tronscan.org/#/transaction/",
        addressEnv: ["TRC20_USDT_ADDRESS", "USDT_TRC20_ADDRESS", "CRYPTO_TRC20_ADDRESS"],
        contractEnv: ["TRC20_USDT_CONTRACT", "USDT_TRC20_CONTRACT"],
        apiKeyEnv: ["TRONGRID_API_KEY", "TRON_GRID_API_KEY"],
        apiBaseEnv: ["TRONGRID_API_BASE", "TRC20_API_BASE"],
        defaultContract: USDT_TRC20_CONTRACT,
        defaultApiBase: "https://api.trongrid.io",
        // Có đường đọc chain riêng → vẫn dùng được khi chưa nối Binance.
        requiresBinance: false,
    },
    bep20: {
        key: "bep20",
        method: "crypto_bep20",
        label: "BEP20",
        chainName: "BNB Smart Chain",
        token: "USDT",
        explorerTx: "https://bscscan.com/tx/",
        addressEnv: ["BEP20_USDT_ADDRESS", "USDT_BEP20_ADDRESS", "CRYPTO_BEP20_ADDRESS"],
        contractEnv: ["BEP20_USDT_CONTRACT", "USDT_BEP20_CONTRACT"],
        apiKeyEnv: [],
        apiBaseEnv: [],
        defaultContract: USDT_BEP20_CONTRACT,
        defaultApiBase: "",
        // Không còn nguồn đọc chain nào: thiếu Binance là KHÔNG có cách xác nhận,
        // nên không được hiện nút cho khách chuyển tiền vào chỗ không ai đối soát.
        requiresBinance: true,
    },
    /**
     * Binance Pay (C2C) — KHÔNG phải blockchain.
     *
     * Khách chuyển nội bộ trong Binance tới Pay ID của shop: không có địa chỉ ví,
     * không tx on-chain, không explorer. Vì vậy `address` ở đây là PAY ID, không
     * phải địa chỉ ví, và không có contract để đối chiếu.
     *
     * Nguồn đối soát là thueapibank.vn đọc lịch sử Binance Pay của tài khoản shop
     * (xem src/payment/binance-pay.js) — không dùng chung credential với
     * BINANCE_API_KEY/SECRET vì đó là luồng nạp on-chain, endpoint khác hẳn.
     *
     * Đo trên dữ liệu thật: MỌI giao dịch Pay nhận được đều có `note` RỖNG —
     * Binance Pay không mang nội dung chuyển khoản. Nên khớp đơn dựa HOÀN TOÀN
     * vào số USDT lẻ duy nhất (vndToUniqueUsdt), không có lớp xác thực thứ hai.
     */
    binance_pay: {
        key: "binance_pay",
        method: "crypto_binance_pay",
        label: "Binance Pay",
        chainName: "Binance Pay (nội bộ)",
        token: "USDT",
        // Không có explorer: Pay ID không tra được ở bất kỳ chain nào.
        explorerTx: "",
        addressEnv: ["BINANCE_PAY_ID"],
        contractEnv: [],
        apiKeyEnv: ["BINANCE_PAY_TOKEN"],
        apiBaseEnv: ["BINANCE_PAY_API_BASE"],
        apiBaseV2Env: ["BINANCE_PAY_API_BASE_V2"],
        defaultContract: "",
        defaultApiBase: BINANCE_PAY_DEFAULTS.baseV1,
        defaultApiBaseV2: BINANCE_PAY_DEFAULTS.baseV2,
        requiresBinance: false,
        // Thiếu token là không đọc được lịch sử → không có cách xác nhận, phải ẩn.
        requiresApiKey: true,
        // Pay ID không phải địa chỉ ví: QR chứa chuỗi đó không app nào quét trả tiền
        // được, chỉ làm khách tưởng quét là xong rồi mất tiền sai chỗ.
        qrSupported: false,
    },
};

function firstEnv(keys, fallback = "") {
    const runtime = getCryptoConfigSync();
    for (const key of keys) {
        const value = runtime[key];
        if (value) return value;
    }
    for (const key of keys) {
        const value = process.env[key];
        if (value) return value;
    }
    return fallback;
}

function hashString(input) {
    let hash = 2166136261;
    for (const ch of String(input)) {
        hash ^= ch.charCodeAt(0);
        hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
}

function toFixedNumber(value, decimals = 6) {
    return Number(Number(value).toFixed(decimals));
}

function cryptoText(lang = "vi") {
    const key = ["vi", "en", "zh"].includes(lang) ? lang : "vi";
    return {
        vi: {
            payTitle: "Thanh toán bằng USDT",
            depositTitle: "Nạp ví bằng USDT",
            product: "Sản phẩm",
            sendExact: "Cần chuyển",
            network: "Mạng",
            address: "Ví nhận",
            payIdLabel: "Binance Pay ID",
            walletCredit: "Cộng vào ví",
            depositAmount: "Số USDT nạp",
            howTo: "Cách thực hiện",
            steps: [
                "Quét QR bên dưới hoặc copy ví nhận.",
                "Trong Binance/ví crypto, chọn đúng mạng hiển thị.",
                "Chuyển đúng số USDT, không làm tròn.",
                "Chuyển xong bấm nút kiểm tra.",
            ],
            // Binance Pay không có ví/mạng để chọn và không quét QR được — hướng
            // dẫn chung sẽ khiến khách đi tìm thứ không tồn tại.
            payStepsPay: [
                "Mở app Binance → Pay → Chuyển tiền.",
                "Dán Binance Pay ID bên dưới làm người nhận.",
                "Chọn USDT, chuyển ĐÚNG số lẻ bên dưới, không làm tròn.",
                "Chuyển xong bấm nút kiểm tra.",
            ],
            payWarningPay: "Phải chuyển ĐÚNG tới số lẻ cuối — số lẻ chính là mã nhận diện đơn của bạn, vì Binance Pay không gửi kèm nội dung. Sai số sẽ không tự cộng. Hết hạn sau",
            warning: "Sai mạng hoặc sai số USDT sẽ không tự cộng. Hết hạn sau",
            minutes: "phút",
        },
        en: {
            payTitle: "Pay with USDT",
            depositTitle: "Top up wallet with USDT",
            product: "Product",
            sendExact: "Send exactly",
            network: "Network",
            address: "Receiving wallet",
            payIdLabel: "Binance Pay ID",
            walletCredit: "Wallet credit",
            depositAmount: "Top-up amount",
            howTo: "How to pay",
            steps: [
                "Scan the QR below or copy the receiving wallet.",
                "In Binance/your crypto wallet, choose the exact network shown.",
                "Send the exact USDT amount. Do not round it.",
                "After sending, tap the check button.",
            ],
            payStepsPay: [
                "Open Binance app -> Pay -> Send.",
                "Paste the Binance Pay ID below as the recipient.",
                "Choose USDT and send the EXACT amount below, every decimal.",
                "After sending, tap the check button.",
            ],
            payWarningPay: "Send the EXACT amount down to the last decimal - those decimals identify your order, because Binance Pay carries no reference note. A wrong amount will not auto-confirm. Expires in",
            warning: "Wrong network or wrong USDT amount will not auto-confirm. Expires in",
            minutes: "minutes",
        },
        zh: {
            payTitle: "使用 USDT 支付",
            depositTitle: "使用 USDT 充值钱包",
            product: "商品",
            sendExact: "请转入",
            network: "网络",
            address: "收款钱包",
            payIdLabel: "Binance Pay ID",
            walletCredit: "钱包入账",
            depositAmount: "充值金额",
            howTo: "操作步骤",
            steps: [
                "扫描下方二维码，或复制收款钱包。",
                "在 Binance/加密钱包中选择显示的正确网络。",
                "转入准确的 USDT 数量，不要四舍五入。",
                "转账后点击检查按钮。",
            ],
            payStepsPay: [
                "打开 Binance App → Pay → 转账。",
                "粘贴下方的 Binance Pay ID 作为收款人。",
                "选择 USDT，转入下方的精确金额，小数不要省略。",
                "转账后点击检查按钮。",
            ],
            payWarningPay: "必须转入完全一致的金额（含所有小数）——小数就是您订单的识别码，因为 Binance Pay 不带备注。金额错误将无法自动确认。有效期",
            warning: "网络或 USDT 数量错误将无法自动确认。有效期",
            minutes: "分钟",
        },
    }[key];
}

function cryptoRateLabel(lang = "vi") {
    if (lang === "en") return "Rate";
    if (lang === "zh") return "汇率";
    return "Tỷ giá";
}

function unitsToDecimal(value, decimals = 6) {
    const raw = String(value || "0");
    const neg = raw.startsWith("-");
    const clean = neg ? raw.slice(1) : raw;
    const padded = clean.padStart(decimals + 1, "0");
    const whole = padded.slice(0, -decimals) || "0";
    const fraction = padded.slice(-decimals).replace(/0+$/, "");
    return Number(`${neg ? "-" : ""}${whole}${fraction ? `.${fraction}` : ""}`);
}

function getTimeoutMs() {
    return Number(process.env.CRYPTO_POLL_TIMEOUT_MS || DEFAULT_TIMEOUT_MS);
}

export function getConfiguredUsdVndRate() {
    const runtime = getCryptoConfigSync();
    const value = Number(runtime.CRYPTO_USD_VND_RATE || process.env.CRYPTO_USD_VND_RATE || process.env.USD_VND_RATE || DEFAULT_USD_VND_RATE);
    return Number.isFinite(value) && value > 0 ? value : DEFAULT_USD_VND_RATE;
}

function normalizeUsdVndRate(value) {
    const n = Number(value);
    // USDT/VND should stay in a sane range; reject bad API payloads.
    if (!Number.isFinite(n) || n < 10000 || n > 50000) return null;
    return Math.round(n);
}

function normalizeUsdCnyRate(value) {
    const n = Number(value);
    if (!Number.isFinite(n) || n < 3 || n > 15) return null;
    return Number(n.toFixed(4));
}

function shouldUseLiveUsdVndRate() {
    const runtime = getCryptoConfigSync();
    return String(runtime.CRYPTO_USD_VND_RATE_AUTO || process.env.CRYPTO_USD_VND_RATE_AUTO || "true").toLowerCase() !== "false";
}

async function fetchUsdVndRate() {
    const url = process.env.CRYPTO_USD_VND_RATE_API || DEFAULT_RATE_API;
    const payload = await fetchJson(url, { method: "GET" });
    const vndValue = payload?.tether?.vnd ?? payload?.USDT?.VND ?? payload?.usd_vnd ?? payload?.rate;
    const cnyValue = payload?.tether?.cny ?? payload?.USDT?.CNY ?? payload?.usd_cny ?? payload?.cnyRate;
    const normalizedVnd = normalizeUsdVndRate(vndValue);
    if (!normalizedVnd) throw new Error("Invalid USDT/VND rate payload");
    return {
        vnd: normalizedVnd,
        cny: normalizeUsdCnyRate(cnyValue),
    };
}

export async function refreshUsdVndRate({ force = false } = {}) {
    if (!shouldUseLiveUsdVndRate()) {
        const fallback = getConfiguredUsdVndRate();
        usdVndRateCache = { value: fallback, cnyValue: getConfiguredUsdCnyRate(), updatedAt: Date.now(), source: "manual" };
        return usdVndRateCache;
    }

    const runtime = getCryptoConfigSync();
    const ttl = Number(runtime.CRYPTO_USD_VND_RATE_UPDATE_MS || process.env.CRYPTO_USD_VND_RATE_TTL_MS || DEFAULT_RATE_TTL_MS);
    if (!force && usdVndRateCache.value && Date.now() - usdVndRateCache.updatedAt < ttl) {
        return usdVndRateCache;
    }
    if (usdVndRateRefreshPromise) return usdVndRateRefreshPromise;

    usdVndRateRefreshPromise = (async () => {
        try {
            const liveRate = await fetchUsdVndRate();
            usdVndRateCache = {
                value: liveRate.vnd,
                cnyValue: liveRate.cny || usdVndRateCache.cnyValue || getConfiguredUsdCnyRate(),
                updatedAt: Date.now(),
                source: "market",
            };
            console.log(`💱 USDT market rate updated: 1 USDT = ${liveRate.vnd.toLocaleString("vi-VN")}đ`);
            return usdVndRateCache;
        } catch (error) {
            const fallback = getConfiguredUsdVndRate();
            usdVndRateCache = {
                value: usdVndRateCache.value || fallback,
                cnyValue: usdVndRateCache.cnyValue || getConfiguredUsdCnyRate(),
                updatedAt: usdVndRateCache.value ? usdVndRateCache.updatedAt : Date.now(),
                source: usdVndRateCache.value ? usdVndRateCache.source : "fallback",
            };
            console.warn(`⚠️ Cannot update USDT/VND market rate, using ${usdVndRateCache.source}: ${error.message}`);
            return usdVndRateCache;
        } finally {
            usdVndRateRefreshPromise = null;
        }
    })();
    return usdVndRateRefreshPromise;
}

function getConfiguredUsdCnyRate() {
    const value = Number(process.env.CRYPTO_USD_CNY_RATE || process.env.USD_CNY_RATE || DEFAULT_USD_CNY_RATE);
    return normalizeUsdCnyRate(value) || DEFAULT_USD_CNY_RATE;
}

export function startUsdVndRateUpdater() {
    if (usdVndRateTimer) return usdVndRateTimer;
    refreshUsdVndRate({ force: true }).catch(() => {});
    const runtime = getCryptoConfigSync();
    const interval = Number(runtime.CRYPTO_USD_VND_RATE_UPDATE_MS || process.env.CRYPTO_USD_VND_RATE_UPDATE_MS || DEFAULT_RATE_TTL_MS);
    usdVndRateTimer = setInterval(() => {
        refreshUsdVndRate({ force: true }).catch(() => {});
    }, Math.max(60_000, interval));
    return usdVndRateTimer;
}

/**
 * URL an toàn để đưa vào thông báo lỗi.
 *
 * Một số nhà cung cấp nhận credential trong PATH (thueapibank: /historyapibinance/
 * TOKEN). Lỗi HTTP từng nhúng nguyên URL, và message đó đi tiếp lên log channel
 * Telegram qua sendLog — tức token đọc được toàn bộ lịch sử giao dịch bị dán vĩnh
 * viễn vào channel cho mọi thành viên thấy. Che segment cuối của path, giữ lại
 * origin và các segment trước để vẫn biết endpoint nào lỗi.
 *
 * Query string bị bỏ hẳn: apikey của TronGrid/BscScan từng đi qua đó.
 */
function safeUrlForError(url) {
    try {
        const parsed = new URL(typeof url === "string" ? url : url.toString());
        const segments = parsed.pathname.split("/").filter(Boolean);
        const masked = segments.length ? [...segments.slice(0, -1), "***"].join("/") : "";
        return `${parsed.origin}/${masked}`;
    } catch (_) {
        // Không parse được thì thà không nói gì hơn là in ra chuỗi có thể chứa secret.
        return "(url an)";
    }
}

async function fetchJson(url, options = {}) {
    const response = await fetch(url, {
        ...options,
        signal: AbortSignal.timeout(getTimeoutMs()),
    });
    if (!response.ok) {
        throw new Error(`HTTP ${response.status} @ ${safeUrlForError(url)}`);
    }
    return response.json();
}

export function getCryptoNetworkConfig(network) {
    const key = String(network || "").toLowerCase();
    const spec = NETWORKS[key];
    if (!spec) return null;

    return {
        ...spec,
        address: firstEnv(spec.addressEnv),
        contract: firstEnv(spec.contractEnv, spec.defaultContract),
        apiKey: firstEnv(spec.apiKeyEnv),
        apiBase: firstEnv(spec.apiBaseEnv, spec.defaultApiBase),
        // Chỉ Binance Pay có endpoint dự phòng; mạng khác không khai báo thì undefined.
        apiBaseV2: spec.apiBaseV2Env ? firstEnv(spec.apiBaseV2Env, spec.defaultApiBaseV2) : undefined,
    };
}

/**
 * Các mạng thực sự dùng được: đã có ví nhận, VÀ có nguồn xác nhận giao dịch.
 *
 * Mạng chỉ xác nhận được qua Binance (requiresBinance) mà thiếu API key thì phải
 * bị ẩn — hiện nút cho khách chuyển tiền vào ví không ai đối soát được là mất
 * tiền khách. Binance Pay cũng vậy nhưng qua cờ riêng (requiresApiKey): nguồn đối
 * soát của nó là token thueapibank, không phải BINANCE_API_KEY.
 */
export function getEnabledCryptoNetworks() {
    const runtime = getCryptoConfigSync();
    if (String(runtime.CRYPTO_PAY_ENABLED || process.env.CRYPTO_PAY_ENABLED) === "false") return [];
    const binanceReady = isBinanceConfigured();
    return Object.keys(NETWORKS).filter((network) => {
        const config = getCryptoNetworkConfig(network);
        if (!config?.address) return false;
        if (config.requiresApiKey && !config.apiKey) return false;
        return binanceReady || !config.requiresBinance;
    });
}

export function isCryptoPaymentMethod(method) {
    return String(method || "").startsWith("crypto_");
}

export function networkFromPaymentMethod(method) {
    const normalized = String(method || "").toLowerCase();
    if (normalized === "crypto_trc20") return "trc20";
    if (normalized === "crypto_bep20") return "bep20";
    if (normalized === "crypto_binance_pay") return BINANCE_PAY_NETWORK;
    return null;
}

export function getUsdVndRate() {
    const runtime = getCryptoConfigSync();
    const ttl = Number(runtime.CRYPTO_USD_VND_RATE_UPDATE_MS || process.env.CRYPTO_USD_VND_RATE_TTL_MS || DEFAULT_RATE_TTL_MS);
    if (usdVndRateCache.value && Date.now() - usdVndRateCache.updatedAt < ttl * 2) {
        return usdVndRateCache.value;
    }
    if (shouldUseLiveUsdVndRate()) refreshUsdVndRate().catch(() => {});
    return usdVndRateCache.value || getConfiguredUsdVndRate();
}

export function getUsdCnyRate() {
    const ttl = Number(process.env.CRYPTO_USD_VND_RATE_TTL_MS || DEFAULT_RATE_TTL_MS);
    if (usdVndRateCache.cnyValue && Date.now() - usdVndRateCache.updatedAt < ttl * 2) {
        return usdVndRateCache.cnyValue;
    }
    if (shouldUseLiveUsdVndRate()) refreshUsdVndRate().catch(() => {});
    return usdVndRateCache.cnyValue || getConfiguredUsdCnyRate();
}

export function getCryptoExpireMinutes() {
    const runtime = getCryptoConfigSync();
    return Number(runtime.CRYPTO_EXPIRE_MINUTES || process.env.CRYPTO_EXPIRE_MINUTES || getOrderExpireMinutesSync() || 10);
}

/**
 * Hạn thanh toán của một order / giao dịch nạp.
 *
 * Ưu tiên `expiresAt` đã ghi lúc tạo checkout: đó là con số đã hiện cho khách.
 * Đổi CRYPTO_EXPIRE_MINUTES sau đó không được kéo dài/rút ngắn đơn đang chờ (M1).
 * Bản ghi cũ chưa có trường này thì lùi về `createdAt + phút cấu hình`.
 */
export function cryptoExpiresAt(record) {
    if (record?.expiresAt) return new Date(record.expiresAt);
    // Vẫn nhận cả Date trần để không im lặng trả "chưa hết hạn" nếu ai đó truyền createdAt.
    const createdAt = record?.createdAt ?? record;
    return new Date(new Date(createdAt).getTime() + getCryptoExpireMinutes() * 60 * 1000);
}

export function isCryptoOrderExpired(record) {
    return Date.now() > cryptoExpiresAt(record).getTime();
}

// Phần lẻ nhận diện đơn: 0.001000 → 0.009999 USDT, bước 0.000001 → 9000 slot.
const UNIQUE_OFFSET_MIN = 1000;
const UNIQUE_OFFSET_SLOTS = 9000;

/**
 * Số tiền USDT duy nhất cho một đơn/giao dịch nạp.
 *
 * Vị trí đầu tiên vẫn suy ra từ hash(orderId) để cùng một đơn luôn cho cùng một
 * số khi tỷ giá không đổi. Nhưng hash chỉ có 9000 slot: hai đơn cùng `amountVnd`
 * mà trùng slot sẽ ra cùng số tiền, và khi đó poller không dám credit đơn nào
 * (matches.length > 1) — cả hai khách chuyển tiền thật đều bị treo.
 *
 * `taken` là tập `cryptoAmount` đang chờ thanh toán trên cùng network. Nếu slot
 * hash đã bị chiếm, dò sang slot kế tiếp cho tới khi trống. Vì vậy tính unique
 * là bảo đảm thật, không phải kỳ vọng vào hash.
 */
export function vndToUniqueUsdt(amountVnd, orderId, { taken = null } = {}) {
    const rate = getUsdVndRate();
    const base = Math.ceil((Number(amountVnd || 0) / rate) * 1_000_000) / 1_000_000;
    const start = hashString(orderId) % UNIQUE_OFFSET_SLOTS;

    const busy = taken instanceof Set
        ? taken
        : new Set((taken || []).map((value) => toFixedNumber(value, 6)));

    for (let step = 0; step < UNIQUE_OFFSET_SLOTS; step += 1) {
        const slot = (start + step) % UNIQUE_OFFSET_SLOTS;
        const candidate = toFixedNumber(base + (slot + UNIQUE_OFFSET_MIN) / 1_000_000, 6);
        if (!busy.has(candidate)) return candidate;
    }

    // Hết 9000 slot cho cùng một mức giá: không thể sinh số an toàn. Thà báo lỗi
    // ngay còn hơn trả về số trùng rồi treo tiền của khách.
    throw new Error("Không còn số tiền USDT duy nhất cho mức giá này, vui lòng thử lại sau");
}

export function cryptoQrUrl(address) {
    return address;
}

/**
 * Mạng này có QR quét-để-trả được không.
 *
 * Binance Pay ID không phải địa chỉ ví: QR chứa nó không app nào quét ra được
 * lệnh chuyển tiền. Hiện QR ở đó chỉ làm khách tin là quét xong là trả rồi.
 */
export function cryptoNetworkSupportsQr(network) {
    const config = getCryptoNetworkConfig(network);
    return config ? config.qrSupported !== false : false;
}

/**
 * Nhãn hiển thị cho khách. Không dùng network.toUpperCase(): key `binance_pay`
 * sẽ hiện ra "BINANCE_PAY" trong tin nhắn khách đọc.
 */
export function cryptoNetworkLabel(network) {
    return NETWORKS[String(network || "").toLowerCase()]?.label || String(network || "").toUpperCase();
}

export function createCryptoCheckout({ orderId, amount, productName, quantity, network, takenAmounts = null }) {
    const config = getCryptoNetworkConfig(network);
    if (!config) throw new Error("Mang crypto khong hop le");
    if (!config.address) throw new Error(`Chua cau hinh vi nhan ${config.label}`);

    const amountToken = vndToUniqueUsdt(amount, orderId, { taken: takenAmounts });
    const expiresAt = new Date(Date.now() + getCryptoExpireMinutes() * 60 * 1000);

    return {
        network: config.key,
        paymentMethod: config.method,
        networkLabel: config.label,
        chainName: config.chainName,
        token: config.token,
        address: config.address,
        contract: config.contract,
        amountToken,
        amountUsd: amountToken,
        amountVnd: amount,
        usdVndRate: getUsdVndRate(),
        expiresAt,
        qrUrl: cryptoQrUrl(config.address),
        paymentCode: `USDT${orderId.slice(-8).toUpperCase()}`,
        productInfo: {
            name: productName,
            quantity,
            total: amount,
        },
    };
}

/**
 * Dựng lại checkout ĐÃ CHỐT của một order từ dữ liệu đã lưu trong DB.
 *
 * Bắt buộc dùng khi khách xem lại màn thanh toán của order PENDING. Không được
 * gọi createCryptoCheckout lần hai: nó đọc tỷ giá LIVE nên sinh ra số tiền khác,
 * lệch xa hơn tolerance (0.00000049 USDT) so với số khách đã chuyển → giao dịch
 * thật không bao giờ khớp và đơn bị hủy sau khi hết hạn dù tiền đã vào ví.
 *
 * Trả về null nếu order chưa từng được chốt số tiền (thiếu network/amount/address);
 * caller khi đó mới được phép tạo checkout mới.
 */
export function restoreCryptoCheckout(order, { productName, quantity } = {}) {
    const expected = getOrderExpectedCrypto(order);
    if (!expected.network || !expected.amountToken) return null;

    const config = getCryptoNetworkConfig(expected.network);
    if (!config) return null;

    const address = expected.address || config.address;
    if (!address) return null;

    const ref = parseCryptoPaymentRef(order.paymentRef);
    const expiresAt = cryptoExpiresAt(order);

    return {
        network: config.key,
        paymentMethod: config.method,
        networkLabel: config.label,
        chainName: config.chainName,
        token: order.cryptoToken || ref?.token || config.token,
        address,
        contract: config.contract,
        amountToken: expected.amountToken,
        amountUsd: Number(ref?.amountUsd || expected.amountToken),
        amountVnd: order.finalAmount,
        // Tỷ giá đã chốt lúc tạo đơn — KHÔNG đọc lại getUsdVndRate() ở đây,
        // nếu không màn hình sẽ hiện tỷ giá khác với số USDT đang yêu cầu.
        // Đơn cũ thiếu tỷ giá: dùng tỷ giá cấu hình tĩnh để mỗi lần mở lại vẫn ra
        // cùng một số, thay vì tỷ giá live thay đổi theo phút.
        usdVndRate: Number(order.cryptoUsdVndRate || ref?.rate || 0) || getConfiguredUsdVndRate(),
        expiresAt,
        qrUrl: cryptoQrUrl(address),
        paymentCode: `USDT${String(order.id).slice(-8).toUpperCase()}`,
        productInfo: {
            name: productName,
            quantity: quantity ?? order.quantity,
            total: order.finalAmount,
        },
        restored: true,
    };
}

export function createCryptoDepositCheckout({ transactionId, amount, amountUsd, network, takenAmounts = null }) {
    const config = getCryptoNetworkConfig(network);
    if (!config) throw new Error("Mang crypto khong hop le");
    if (!config.address) throw new Error(`Chua cau hinh vi nhan ${config.label}`);

    const usdVndRate = getUsdVndRate();
    const amountToken = vndToUniqueUsdt(amount, transactionId, { taken: takenAmounts });
    const depositUsd = amountUsd != null
        ? toFixedNumber(amountUsd, 6)
        : toFixedNumber(Number(amount || 0) / usdVndRate, 6);
    const expiresAt = new Date(Date.now() + getCryptoExpireMinutes() * 60 * 1000);

    return {
        network: config.key,
        paymentMethod: config.method,
        networkLabel: config.label,
        chainName: config.chainName,
        token: config.token,
        address: config.address,
        contract: config.contract,
        amountToken,
        amountUsd: depositUsd,
        amountVnd: amount,
        usdVndRate,
        expiresAt,
        qrUrl: cryptoQrUrl(config.address),
        paymentCode: `NAP${transactionId.slice(-8).toUpperCase()}`,
    };
}

/**
 * Binance Pay khác đủ nhiều để không dùng chung phần hướng dẫn: không có mạng để
 * chọn, không quét QR được, và số lẻ là mã nhận diện đơn duy nhất. Gom vào một
 * hàm để hai màn (mua hàng / nạp ví) không lệch nhau.
 */
function cryptoInstructions(checkout, l) {
    const isPay = checkout.network === BINANCE_PAY_NETWORK;
    return {
        isPay,
        addressLabel: isPay ? l.payIdLabel : l.address,
        steps: isPay && l.payStepsPay ? l.payStepsPay : l.steps,
        warning: isPay && l.payWarningPay ? l.payWarningPay : l.warning,
    };
}

export function formatCryptoPaymentMessage(checkout, { lang = "vi" } = {}) {
    const remainMs = new Date(checkout.expiresAt) - Date.now();
    const remainMin = Math.max(1, Math.ceil(remainMs / 60000));
    const l = cryptoText(lang);
    const guide = cryptoInstructions(checkout, l);
    const productLine = checkout.productInfo?.name
        ? `🛒 ${l.product}: <b>${escapeHtml(checkout.productInfo.name)}</b>${checkout.productInfo.quantity > 1 ? ` x${checkout.productInfo.quantity}` : ""}\n`
        : "";

    return `💵 <b>${l.payTitle} ${escapeHtml(checkout.networkLabel)}</b>\n`
        + `─────────────────────\n`
        + productLine
        + `💵 ${l.sendExact}: <b>${checkout.amountToken.toFixed(6)} USDT</b>\n`
        + `💱 ${cryptoRateLabel(lang)}: <b>1 USDT = ${Number(checkout.usdVndRate).toLocaleString("vi-VN")}đ</b>\n`
        + `🌐 ${l.network}: <b>${escapeHtml(checkout.chainName)} (${checkout.networkLabel})</b>\n`
        + `📥 ${guide.addressLabel}: <code>${escapeHtml(checkout.address)}</code>\n\n`
        + `📌 <b>${l.howTo}</b>\n`
        + guide.steps.map((step, index) => `${index + 1}. ${step}`).join("\n")
        + `\n\n⚠️ ${guide.warning} <b>${remainMin} ${l.minutes}</b>.`;
}

export function formatCryptoDepositMessage(checkout, { lang = "vi" } = {}) {
    const remainMs = new Date(checkout.expiresAt) - Date.now();
    const remainMin = Math.max(1, Math.ceil(remainMs / 60000));
    const l = cryptoText(lang);
    const guide = cryptoInstructions(checkout, l);
    const depositUsd = Number(checkout.amountUsd || 0).toFixed(6).replace(/0+$/, "").replace(/\.$/, "");

    return `💵 <b>${l.depositTitle} ${escapeHtml(checkout.networkLabel)}</b>\n`
        + `─────────────────────\n`
        + `💵 ${l.depositAmount}: <b>${depositUsd} USDT</b>\n`
        + `💱 ${cryptoRateLabel(lang)}: <b>1 USDT = ${Number(checkout.usdVndRate).toLocaleString("vi-VN")}đ</b>\n`
        + `💰 ${l.walletCredit}: <b>${Number(checkout.amountVnd).toLocaleString("vi-VN")}đ</b>\n`
        + `✅ ${l.sendExact}: <b>${checkout.amountToken.toFixed(6)} USDT</b>\n`
        + `🌐 ${l.network}: <b>${escapeHtml(checkout.chainName)} (${checkout.networkLabel})</b>\n`
        + `📥 ${guide.addressLabel}: <code>${escapeHtml(checkout.address)}</code>\n\n`
        + `📌 <b>${l.howTo}</b>\n`
        + guide.steps.map((step, index) => `${index + 1}. ${step}`).join("\n")
        + `\n\n⚠️ ${guide.warning} <b>${remainMin} ${l.minutes}</b>.`;
}

export function parseCryptoPaymentRef(paymentRef) {
    if (!paymentRef || !String(paymentRef).startsWith("CRYPTO:")) return null;
    try {
        return JSON.parse(String(paymentRef).slice("CRYPTO:".length));
    } catch (_) {
        return null;
    }
}

export function buildCryptoPaymentRef(checkout) {
    return `CRYPTO:${JSON.stringify({
        network: checkout.network,
        amountToken: checkout.amountToken,
        amountUsd: checkout.amountUsd,
        address: checkout.address,
        token: checkout.token,
        rate: checkout.usdVndRate,
    })}`;
}

export function buildCryptoDepositRef(checkout) {
    return `CRYPTO:${JSON.stringify({
        type: "deposit",
        network: checkout.network,
        amountToken: checkout.amountToken,
        amountUsd: checkout.amountUsd,
        address: checkout.address,
        token: checkout.token,
        rate: checkout.usdVndRate,
    })}`;
}

export function cryptoExplorerUrl(network, txid) {
    const config = getCryptoNetworkConfig(network);
    return config?.explorerTx && txid ? `${config.explorerTx}${txid}` : "";
}

async function fetchTrc20Transfers(config, sinceMs = 0) {
    const url = new URL(`/v1/accounts/${encodeURIComponent(config.address)}/transactions/trc20`, config.apiBase);
    url.searchParams.set("only_confirmed", "true");
    url.searchParams.set("limit", String(Number(process.env.TRONGRID_LIMIT || 100)));
    url.searchParams.set("contract_address", config.contract);
    if (sinceMs) url.searchParams.set("min_timestamp", String(Math.max(0, sinceMs)));

    const headers = {};
    if (config.apiKey) headers["TRON-PRO-API-KEY"] = config.apiKey;

    const payload = await fetchJson(url, { method: "GET", headers });
    const rows = Array.isArray(payload?.data) ? payload.data : [];
    return rows.map((item) => {
        const decimals = Number(item.token_info?.decimals ?? 6);
        return {
            network: "trc20",
            txid: item.transaction_id,
            from: item.from,
            to: item.to,
            amount: unitsToDecimal(item.value, decimals),
            timestamp: Number(item.block_timestamp || 0),
        };
    }).filter((item) => item.txid && String(item.to).toLowerCase() === String(config.address).toLowerCase());
}

/**
 * Nạp đã vào tài khoản Binance, lọc theo một network.
 *
 * Thay cho fetchBep20Transfers (BscScan) cũ: BscScan không lọc theo thời gian nên
 * phải lật trang thủ công, và ví bị spam token dust vẫn có thể đẩy giao dịch của
 * khách ra ngoài cửa sổ đọc. Binance trả về nạp của mọi mạng trong một lần gọi và
 * lọc được bằng startTime.
 *
 * Lưu ý: kết quả là nạp Binance ĐÃ CREDIT (status 1/6), nên chậm hơn đọc chain —
 * đúng bằng thời gian Binance chờ đủ confirm.
 */
async function fetchBinanceTransfers(network, sinceMs = 0) {
    const deposits = await fetchBinanceUsdtDeposits(sinceMs);
    return deposits.filter((item) => item.network === network);
}

async function fetchCryptoTransfersUncached(network, sinceMs) {
    const config = getCryptoNetworkConfig(network);
    if (!config?.address) return [];
    // Binance Pay có nguồn riêng và PHẢI xét trước nhánh Binance on-chain: nó
    // không xuất hiện trong /sapi/v1/capital/deposit/hisrec (endpoint đó chỉ trả
    // nạp on-chain), nên để rơi xuống nhánh dưới là không bao giờ khớp được đơn.
    if (config.key === BINANCE_PAY_NETWORK) {
        return fetchBinancePayTransfers(config, sinceMs, { fetchJson });
    }
    // Binance là nguồn chính khi đã cấu hình: một API cho mọi mạng.
    if (isBinanceConfigured()) return fetchBinanceTransfers(config.key, sinceMs);
    // Chưa nối Binance: chỉ TRC20 còn đường đọc chain. BEP20 không còn nguồn nào
    // (getEnabledCryptoNetworks cũng đã ẩn nó khỏi menu).
    if (config.key === "trc20") return fetchTrc20Transfers(config, sinceMs);
    return [];
}

/**
 * Cache lịch sử transfer theo network trong một cửa sổ ngắn (M2).
 *
 * Poller chạy mỗi 15s và mỗi lần khách bấm [Kiểm tra] cũng gọi API blockchain.
 * Nhiều khách bấm liên tục là gọi TronGrid/BscScan chục lần trong vài giây —
 * dễ bị rate-limit, và khi bị chặn thì cả poller cũng mù theo.
 *
 * Điều kiện dùng lại: cùng network, còn trong TTL, và cửa sổ đã lấy phải PHỦ
 * cửa sổ đang cần (`entry.sinceMs <= sinceMs`) — nếu không sẽ thiếu transfer cũ.
 * Request đang bay được chia sẻ (dedupe) nên hai lần bấm cùng lúc chỉ tốn 1 gọi.
 * Lỗi không được cache: xoá entry để lần sau thử lại ngay.
 */
const _transferCache = new Map(); // network -> { sinceMs, fetchedAt, promise }

function getTransferCacheMs() {
    const runtime = getCryptoConfigSync();
    const value = Number(runtime.CRYPTO_FETCH_CACHE_MS || process.env.CRYPTO_FETCH_CACHE_MS || 10000);
    return Number.isFinite(value) && value >= 0 ? value : 10000;
}

export function clearCryptoTransferCache() {
    _transferCache.clear();
}

export async function fetchCryptoTransfers(network, { sinceMs = 0 } = {}) {
    const key = String(network || "").toLowerCase();
    const ttl = getTransferCacheMs();
    const cached = _transferCache.get(key);
    const usable = ttl > 0
        && cached
        && Date.now() - cached.fetchedAt < ttl
        && cached.sinceMs <= sinceMs;

    let promise;
    if (usable) {
        promise = cached.promise;
    } else {
        promise = fetchCryptoTransfersUncached(key, sinceMs);
        if (ttl > 0) {
            _transferCache.set(key, { sinceMs, fetchedAt: Date.now(), promise });
            promise.catch(() => {
                if (_transferCache.get(key)?.promise === promise) _transferCache.delete(key);
            });
        }
    }

    const transfers = await promise;
    // Cache có thể rộng hơn cửa sổ đang cần — cắt lại để hợp đồng của hàm không đổi.
    // Transfer không có timestamp thì giữ: bên khớp đơn vẫn tự xử lý được, bỏ đi là mất tiền.
    return sinceMs ? transfers.filter((item) => !item.timestamp || item.timestamp >= sinceMs) : transfers;
}

export function getOrderExpectedCrypto(order) {
    const ref = parseCryptoPaymentRef(order.paymentRef);
    return {
        network: order.cryptoNetwork || ref?.network || networkFromPaymentMethod(order.paymentMethod),
        amountToken: Number(order.cryptoAmount || ref?.amountToken || 0),
        address: order.cryptoAddress || ref?.address || "",
    };
}

export function getWalletTransactionExpectedCrypto(tx) {
    const ref = parseCryptoPaymentRef(tx.paymentRef);
    return {
        network: tx.cryptoNetwork || ref?.network,
        amountToken: Number(tx.cryptoAmount || ref?.amountToken || 0),
        address: tx.cryptoAddress || ref?.address || "",
    };
}

/**
 * Ví nhận của transfer có khớp ví nhận mong đợi không.
 *
 * Transfer KHÔNG có `to` vẫn được chấp nhận: nạp nội bộ Binance không có địa chỉ
 * on-chain, mà mọi bản ghi Binance trả về đều là nạp vào chính tài khoản của shop
 * nên không có nguy cơ nhận tiền của người khác. Bỏ qua các bản ghi này thì tiền
 * khách đã vào mà đơn vẫn bị hủy.
 */
function transferAddressMatches(transfer, expectedAddress) {
    if (!expectedAddress || !transfer.to) return true;
    return String(transfer.to).toLowerCase() === String(expectedAddress).toLowerCase();
}

/**
 * Giao dịch có xảy ra SAU khi tạo đơn không (đệm 60s cho lệch giờ).
 *
 * Transfer THIẾU timestamp vẫn được chấp nhận — cố ý: V2 dự phòng có thể parse
 * lỗi ngày, và loại oan một giao dịch có thật là khách mất tiền. Nhưng nó mở ra
 * đường cho một giao dịch RẤT CŨ trùng số tiền được khớp vào đơn mới, nên phải
 * ghi nhận lại để admin đối soát thay vì im lặng chấp nhận.
 *
 * Number("13/06/2026") = NaN, và NaN cũng falsy như 0 — cả hai đều rơi vào nhánh
 * "không rõ thời điểm" này.
 */
const _reportedUndatedTransfers = new Set();
function transferTimeMatches(transfer, createdAtMs) {
    const ts = Number(transfer.timestamp);
    if (Number.isFinite(ts) && ts > 0) return ts >= createdAtMs - 60_000;

    const key = `${transfer.network}:${transfer.txid}`;
    if (!_reportedUndatedTransfers.has(key)) {
        _reportedUndatedTransfers.add(key);
        console.warn(
            `⚠️ Transfer không có thời điểm hợp lệ, bỏ qua kiểm tra tuổi giao dịch: `
            + `${transfer.network} ${transfer.amount} USDT txid=${transfer.txid}`,
        );
    }
    return true;
}

export function cryptoTransferMatchesOrder(transfer, order) {
    const expected = getOrderExpectedCrypto(order);
    if (!expected.network || transfer.network !== expected.network) return false;
    if (!expected.amountToken) return false;

    const config = getCryptoNetworkConfig(expected.network);
    if (!transferAddressMatches(transfer, expected.address || config?.address || "")) return false;

    const tolerance = getCryptoAmountTolerance();
    if (Math.abs(Number(transfer.amount) - expected.amountToken) > tolerance) return false;

    if (!transferTimeMatches(transfer, new Date(order.createdAt).getTime())) return false;

    return true;
}

export function cryptoTransferMatchesWalletTransaction(transfer, tx) {
    const expected = getWalletTransactionExpectedCrypto(tx);
    if (!expected.network || transfer.network !== expected.network) return false;
    if (!expected.amountToken) return false;

    const config = getCryptoNetworkConfig(expected.network);
    if (!transferAddressMatches(transfer, expected.address || config?.address || "")) return false;

    const tolerance = getCryptoAmountTolerance();
    if (Math.abs(Number(transfer.amount) - expected.amountToken) > tolerance) return false;

    if (!transferTimeMatches(transfer, new Date(tx.createdAt).getTime())) return false;

    return true;
}

export default {
    createCryptoCheckout,
    createCryptoDepositCheckout,
    restoreCryptoCheckout,
    formatCryptoPaymentMessage,
    formatCryptoDepositMessage,
    fetchCryptoTransfers,
    clearCryptoTransferCache,
    getEnabledCryptoNetworks,
    getCryptoNetworkConfig,
    cryptoNetworkSupportsQr,
    cryptoNetworkLabel,
    getOrderExpectedCrypto,
    getWalletTransactionExpectedCrypto,
    cryptoTransferMatchesOrder,
    cryptoTransferMatchesWalletTransaction,
    buildCryptoPaymentRef,
    buildCryptoDepositRef,
    cryptoExplorerUrl,
    isCryptoOrderExpired,
    cryptoExpiresAt,
    isCryptoPaymentMethod,
    networkFromPaymentMethod,
    getUsdCnyRate,
};
