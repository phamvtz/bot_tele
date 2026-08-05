import { getCryptoConfigSync, getOrderExpireMinutesSync } from "../shop-config.js";
import { escapeHtml } from "../bot-ui/format.js";
import { getCryptoAmountTolerance } from "./amounts.js";

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
        apiKeyEnv: ["BSCSCAN_API_KEY", "BSC_API_KEY"],
        apiBaseEnv: ["BSCSCAN_API_BASE", "BSC_API_BASE"],
        defaultContract: USDT_BEP20_CONTRACT,
        defaultApiBase: "https://api.etherscan.io/v2/api",
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
            walletCredit: "Cộng vào ví",
            depositAmount: "Số USDT nạp",
            howTo: "Cách thực hiện",
            steps: [
                "Quét QR bên dưới hoặc copy ví nhận.",
                "Trong Binance/ví crypto, chọn đúng mạng hiển thị.",
                "Chuyển đúng số USDT, không làm tròn.",
                "Chuyển xong bấm nút kiểm tra.",
            ],
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
            walletCredit: "Wallet credit",
            depositAmount: "Top-up amount",
            howTo: "How to pay",
            steps: [
                "Scan the QR below or copy the receiving wallet.",
                "In Binance/your crypto wallet, choose the exact network shown.",
                "Send the exact USDT amount. Do not round it.",
                "After sending, tap the check button.",
            ],
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
            walletCredit: "钱包入账",
            depositAmount: "充值金额",
            howTo: "操作步骤",
            steps: [
                "扫描下方二维码，或复制收款钱包。",
                "在 Binance/加密钱包中选择显示的正确网络。",
                "转入准确的 USDT 数量，不要四舍五入。",
                "转账后点击检查按钮。",
            ],
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

async function fetchJson(url, options = {}) {
    const response = await fetch(url, {
        ...options,
        signal: AbortSignal.timeout(getTimeoutMs()),
    });
    if (!response.ok) {
        throw new Error(`HTTP ${response.status} @ ${typeof url === "string" ? url : url.toString()}`);
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
    };
}

export function getEnabledCryptoNetworks() {
    const runtime = getCryptoConfigSync();
    if (String(runtime.CRYPTO_PAY_ENABLED || process.env.CRYPTO_PAY_ENABLED) === "false") return [];
    return Object.keys(NETWORKS).filter((network) => !!getCryptoNetworkConfig(network)?.address);
}

export function isCryptoPaymentMethod(method) {
    return String(method || "").startsWith("crypto_");
}

export function networkFromPaymentMethod(method) {
    const normalized = String(method || "").toLowerCase();
    if (normalized === "crypto_trc20") return "trc20";
    if (normalized === "crypto_bep20") return "bep20";
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

export function isCryptoOrderExpired(createdAt) {
    const expireMs = getCryptoExpireMinutes() * 60 * 1000;
    return Date.now() - new Date(createdAt).getTime() > expireMs;
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
    const expiresAt = order.expiresAt
        ? new Date(order.expiresAt)
        : new Date(new Date(order.createdAt).getTime() + getCryptoExpireMinutes() * 60 * 1000);

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

export function formatCryptoPaymentMessage(checkout, { lang = "vi" } = {}) {
    const remainMs = new Date(checkout.expiresAt) - Date.now();
    const remainMin = Math.max(1, Math.ceil(remainMs / 60000));
    const l = cryptoText(lang);
    const productLine = checkout.productInfo?.name
        ? `🛒 ${l.product}: <b>${escapeHtml(checkout.productInfo.name)}</b>${checkout.productInfo.quantity > 1 ? ` x${checkout.productInfo.quantity}` : ""}\n`
        : "";

    return `💵 <b>${l.payTitle} ${escapeHtml(checkout.networkLabel)}</b>\n`
        + `─────────────────────\n`
        + productLine
        + `💵 ${l.sendExact}: <b>${checkout.amountToken.toFixed(6)} USDT</b>\n`
        + `💱 ${cryptoRateLabel(lang)}: <b>1 USDT = ${Number(checkout.usdVndRate).toLocaleString("vi-VN")}đ</b>\n`
        + `🌐 ${l.network}: <b>${escapeHtml(checkout.chainName)} (${checkout.networkLabel})</b>\n`
        + `📥 ${l.address}: <code>${escapeHtml(checkout.address)}</code>\n\n`
        + `📌 <b>${l.howTo}</b>\n`
        + l.steps.map((step, index) => `${index + 1}. ${step}`).join("\n")
        + `\n\n⚠️ ${l.warning} <b>${remainMin} ${l.minutes}</b>.`;
}

export function formatCryptoDepositMessage(checkout, { lang = "vi" } = {}) {
    const remainMs = new Date(checkout.expiresAt) - Date.now();
    const remainMin = Math.max(1, Math.ceil(remainMs / 60000));
    const l = cryptoText(lang);
    const depositUsd = Number(checkout.amountUsd || 0).toFixed(6).replace(/0+$/, "").replace(/\.$/, "");

    return `💵 <b>${l.depositTitle} ${escapeHtml(checkout.networkLabel)}</b>\n`
        + `─────────────────────\n`
        + `💵 ${l.depositAmount}: <b>${depositUsd} USDT</b>\n`
        + `💱 ${cryptoRateLabel(lang)}: <b>1 USDT = ${Number(checkout.usdVndRate).toLocaleString("vi-VN")}đ</b>\n`
        + `💰 ${l.walletCredit}: <b>${Number(checkout.amountVnd).toLocaleString("vi-VN")}đ</b>\n`
        + `✅ ${l.sendExact}: <b>${checkout.amountToken.toFixed(6)} USDT</b>\n`
        + `🌐 ${l.network}: <b>${escapeHtml(checkout.chainName)} (${checkout.networkLabel})</b>\n`
        + `📥 ${l.address}: <code>${escapeHtml(checkout.address)}</code>\n\n`
        + `📌 <b>${l.howTo}</b>\n`
        + l.steps.map((step, index) => `${index + 1}. ${step}`).join("\n")
        + `\n\n⚠️ ${l.warning} <b>${remainMin} ${l.minutes}</b>.`;
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
 * BscScan `tokentx` không có tham số lọc theo thời gian (chỉ startblock/endblock),
 * nên `sinceMs` được xử lý bằng cách lật trang `sort=desc` cho tới khi chạm mốc.
 *
 * Trước đây hàm này bỏ im lặng `sinceMs` và chỉ lấy 100 transfer mới nhất: ví nhận
 * đông hoặc bị spam token dust sẽ đẩy transfer của đơn PENDING ra khỏi cửa sổ đó,
 * đơn không bao giờ khớp và khách mất tiền.
 */
async function fetchBep20Transfers(config, sinceMs = 0) {
    const runtime = getCryptoConfigSync();
    const pageSize = Number(process.env.BSCSCAN_LIMIT || 100);
    const maxPages = Math.max(1, Number(process.env.BSCSCAN_MAX_PAGES || 5));

    const buildUrl = (page) => {
        const url = new URL(config.apiBase);
        url.searchParams.set("chainid", runtime.BSCSCAN_CHAIN_ID || process.env.BSCSCAN_CHAIN_ID || "56");
        url.searchParams.set("module", "account");
        url.searchParams.set("action", "tokentx");
        url.searchParams.set("contractaddress", config.contract);
        url.searchParams.set("address", config.address);
        url.searchParams.set("page", String(page));
        url.searchParams.set("offset", String(pageSize));
        url.searchParams.set("sort", "desc");
        if (config.apiKey) url.searchParams.set("apikey", config.apiKey);
        return url;
    };

    const mapRow = (item) => {
        const decimals = Number(item.tokenDecimal || 18);
        return {
            network: "bep20",
            txid: item.hash,
            from: item.from,
            to: item.to,
            amount: unitsToDecimal(item.value, decimals),
            timestamp: Number(item.timeStamp || 0) * 1000,
        };
    };

    const collected = [];
    let reachedSince = false;

    for (let page = 1; page <= maxPages; page += 1) {
        const payload = await fetchJson(buildUrl(page));
        const rows = Array.isArray(payload?.result) ? payload.result : [];
        if (!rows.length) {
            reachedSince = true;
            break;
        }

        collected.push(...rows.map(mapRow));

        // Trang chưa đầy nghĩa là đã hết lịch sử.
        if (rows.length < pageSize) {
            reachedSince = true;
            break;
        }
        // Không lọc theo thời gian thì một trang là đủ (giữ nguyên hành vi cũ).
        if (!sinceMs) {
            reachedSince = true;
            break;
        }
        // Transfer cũ nhất của trang đã vượt qua mốc → không cần lật thêm.
        if (collected[collected.length - 1].timestamp < sinceMs) {
            reachedSince = true;
            break;
        }
    }

    if (sinceMs && !reachedSince) {
        console.warn(
            `⚠️ BEP20: đã đọc ${maxPages} trang × ${pageSize} mà vẫn chưa lùi tới ${new Date(sinceMs).toISOString()}; `
            + "có thể bỏ sót transfer. Tăng BSCSCAN_MAX_PAGES hoặc BSCSCAN_LIMIT.",
        );
    }

    return collected.filter((item) =>
        item.txid
        && String(item.to).toLowerCase() === String(config.address).toLowerCase()
        && (!sinceMs || item.timestamp >= sinceMs));
}

export async function fetchCryptoTransfers(network, { sinceMs = 0 } = {}) {
    const config = getCryptoNetworkConfig(network);
    if (!config?.address) return [];
    if (config.key === "trc20") return fetchTrc20Transfers(config, sinceMs);
    if (config.key === "bep20") return fetchBep20Transfers(config, sinceMs);
    return [];
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

export function cryptoTransferMatchesOrder(transfer, order) {
    const expected = getOrderExpectedCrypto(order);
    if (!expected.network || transfer.network !== expected.network) return false;
    if (!expected.amountToken) return false;

    const config = getCryptoNetworkConfig(expected.network);
    const expectedAddress = expected.address || config?.address || "";
    if (expectedAddress && String(transfer.to).toLowerCase() !== String(expectedAddress).toLowerCase()) return false;

    const tolerance = getCryptoAmountTolerance();
    if (Math.abs(Number(transfer.amount) - expected.amountToken) > tolerance) return false;

    const createdAt = new Date(order.createdAt).getTime();
    if (transfer.timestamp && transfer.timestamp < createdAt - 60_000) return false;

    return true;
}

export function cryptoTransferMatchesWalletTransaction(transfer, tx) {
    const expected = getWalletTransactionExpectedCrypto(tx);
    if (!expected.network || transfer.network !== expected.network) return false;
    if (!expected.amountToken) return false;

    const config = getCryptoNetworkConfig(expected.network);
    const expectedAddress = expected.address || config?.address || "";
    if (expectedAddress && String(transfer.to).toLowerCase() !== String(expectedAddress).toLowerCase()) return false;

    const tolerance = getCryptoAmountTolerance();
    if (Math.abs(Number(transfer.amount) - expected.amountToken) > tolerance) return false;

    const createdAt = new Date(tx.createdAt).getTime();
    if (transfer.timestamp && transfer.timestamp < createdAt - 60_000) return false;

    return true;
}

export default {
    createCryptoCheckout,
    createCryptoDepositCheckout,
    restoreCryptoCheckout,
    formatCryptoPaymentMessage,
    formatCryptoDepositMessage,
    fetchCryptoTransfers,
    getEnabledCryptoNetworks,
    getCryptoNetworkConfig,
    getOrderExpectedCrypto,
    getWalletTransactionExpectedCrypto,
    cryptoTransferMatchesOrder,
    cryptoTransferMatchesWalletTransaction,
    buildCryptoPaymentRef,
    buildCryptoDepositRef,
    cryptoExplorerUrl,
    isCryptoOrderExpired,
    isCryptoPaymentMethod,
    networkFromPaymentMethod,
    getUsdCnyRate,
};
