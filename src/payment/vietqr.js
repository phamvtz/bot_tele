/**
 * VietQR Payment Provider
 * 
 * Tạo QR chuyển khoản tự động với IPN webhook
 * Hỗ trợ: Casso, SePay, hoặc bank API trực tiếp
 */

import { getBankConfigSync, getOrderExpireMinutesSync } from "../shop-config.js";
import { secretEquals } from "../lib/secret-compare.js";
import QRCode from "qrcode";

export const BANK_BINS = {
    MB: "970422", MBBANK: "970422",
    VCB: "970436", VIETCOMBANK: "970436",
    TCB: "970407", TECHCOMBANK: "970407",
    ACB: "970416",
    VPB: "970432", VPBANK: "970432",
    TPB: "970423", TPBANK: "970423",
    BIDV: "970418",
    VTB: "970415", VIETINBANK: "970415",
    MSB: "970426",
    STB: "970403", SACOMBANK: "970403",
    SHB: "970443",
    HDB: "970437", HDBANK: "970437",
    VIB: "970441",
    LPB: "970449", LPBANK: "970449",
    OCB: "970448",
    SCB: "970429",
    SEAB: "970440", SEABANK: "970440",
    BAB: "970409", BACABANK: "970409",
    NAB: "970428", NAMABANK: "970428",
    BVB: "970438", BAOVIETBANK: "970438",
    ABB: "970425", ABBANK: "970425",
    PGB: "970430", PGBANK: "970430",
    VIETBANK: "970433",
    VAB: "970427", VIETABANK: "970427",
    BIDC: "970454",
    CAKE: "546034",
    UBANK: "546035",
    TIMO: "963388",
};

function formatTlv(tag, value) {
    const v = String(value ?? "");
    // EMVCo TLV đo độ dài theo BYTE (UTF-8), không phải số ký tự UTF-16 —
    // nội dung có dấu tiếng Việt tạo length sai làm app ngân hàng đọc hỏng QR.
    return tag + String(Buffer.byteLength(v, "utf8")).padStart(2, "0") + v;
}

export function crc16Ccitt(str) {
    let crc = 0xFFFF;
    for (let c = 0; c < str.length; c++) {
        crc ^= str.charCodeAt(c) << 8;
        for (let i = 0; i < 8; i++) {
            if (crc & 0x8000) {
                crc = ((crc << 1) ^ 0x1021) & 0xFFFF;
            } else {
                crc = (crc << 1) & 0xFFFF;
            }
        }
    }
    return crc.toString(16).toUpperCase().padStart(4, "0");
}

export function buildVietQrString({ bankBin, accountNumber, amount, content }) {
    const cleanAccount = String(accountNumber || "").replace(/\s+/g, "");
    const sub00 = formatTlv("00", bankBin);
    const sub01 = formatTlv("01", cleanAccount);
    const tag38_01 = sub00 + sub01;
    const tag38 = formatTlv("00", "A000000727") + formatTlv("01", tag38_01) + formatTlv("02", "QRIBFTTA");

    // Tag 01 (Point of Initiation): "12" = dynamic (kèm số tiền), "11" = static
    // (không kèm số tiền — khách tự nhập). Hardcode "12" cho QR không tiền khiến
    // một số app hiểu sai.
    const hasAmount = amount && Number(amount) > 0;
    let raw = formatTlv("00", "01")
        + formatTlv("01", hasAmount ? "12" : "11")
        + formatTlv("38", tag38)
        + formatTlv("53", "704");

    if (hasAmount) {
        raw += formatTlv("54", String(Math.round(Number(amount))));
    }
    raw += formatTlv("58", "VN");
    if (content) {
        raw += formatTlv("62", formatTlv("08", String(content)));
    }
    raw += "6304";
    return raw + crc16Ccitt(raw);
}

export function extractImageFromResponse(body) {
    if (!body) return null;
    if (typeof body === "string") {
        const match = body.match(/data:image\/(?:png|jpeg|jpg);base64,([A-Za-z0-9+/=]+)/);
        if (match) return Buffer.from(match[1], "base64");
        return null;
    }
    if (Buffer.isBuffer(body)) {
        if (body.length > 4 && body[0] === 0x3c) { // '<' (SVG or HTML)
            const text = body.toString("utf8");
            const match = text.match(/data:image\/(?:png|jpeg|jpg);base64,([A-Za-z0-9+/=]+)/);
            if (match) return Buffer.from(match[1], "base64");
            return null;
        }
        if (body.length > 4 && body[0] === 0x89 && body[1] === 0x50 && body[2] === 0x4e && body[3] === 0x47) {
            return body;
        }
        if (body.length > 2 && body[0] === 0xff && body[1] === 0xd8) {
            return body;
        }
        if (body.length > 12 && body.slice(0, 4).toString() === "RIFF" && body.slice(8, 12).toString() === "WEBP") {
            return body;
        }
    }
    return null;
}

export async function fetchVietQrImageBuffer(qrUrl, fallbackParams = {}) {
    let bankCode = fallbackParams.bankCode;
    let accountNumber = fallbackParams.accountNumber;
    let accountName = fallbackParams.accountName;
    let amount = fallbackParams.amount;
    let content = fallbackParams.content;

    if (qrUrl && typeof qrUrl === "string") {
        try {
            const u = new URL(qrUrl);
            const match = u.pathname.match(/\/image\/([A-Za-z0-9]+)-([A-Za-z0-9]+)/);
            if (match) {
                if (!bankCode) bankCode = match[1];
                if (!accountNumber) accountNumber = match[2];
            }
            if (!content) content = u.searchParams.get("addInfo") || "";
            if (!amount && u.searchParams.get("amount")) amount = Number(u.searchParams.get("amount"));
            if (!accountName && u.searchParams.get("accountName")) accountName = u.searchParams.get("accountName");
        } catch {}
    }

    const bank = bankConfig();
    const bCode = (bankCode || bank.bankCode || "MB").toUpperCase().replace(/[^A-Z0-9]/g, "");
    const bankBin = BANK_BINS[bCode] || (/^\d{6}$/.test(bCode) ? bCode : "970422");
    const accNo = accountNumber || bank.accountNumber;
    const accName = accountName || bank.accountName || "";

    // 1. Ưu tiên: Gọi API chính thức của VietQR (api.vietqr.io/v2/generate) để sinh ảnh template
    // đầy đủ và ĐÃ RENDER MA TRẬN QR BÊN TRONG (tránh lỗi img.vietqr.io trả về SVG với frame trắng).
    if (accNo) {
        try {
            const apiRes = await fetch("https://api.vietqr.io/v2/generate", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    accountNo: accNo,
                    accountName: accName,
                    acqId: bankBin,
                    amount: amount ? String(Math.round(Number(amount))) : undefined,
                    addInfo: content || "",
                    format: "text",
                    template: "compact2",
                }),
                signal: AbortSignal.timeout(6000),
            });
            if (apiRes.ok) {
                const data = await apiRes.json();
                if (data.code === "00" && data.data?.qrDataURL) {
                    const b64 = data.data.qrDataURL.replace(/^data:image\/[a-zA-Z]+;base64,/, "");
                    return Buffer.from(b64, "base64");
                }
            }
        } catch (e) {
            console.warn("[vietqr] api.vietqr.io v2 generate lỗi, chuyển sang sinh local:", e.message);
        }
    }

    // 2. Nếu là URL ảnh nhị phân thuần khác ngoài vietqr.io (ví dụ file png/jpg tĩnh)
    if (qrUrl && typeof qrUrl === "string" && qrUrl.startsWith("http") && !qrUrl.includes("vietqr.io")) {
        try {
            const res = await fetch(qrUrl, { signal: AbortSignal.timeout(6000) });
            if (res.ok) {
                const ab = await res.arrayBuffer();
                const buf = extractImageFromResponse(Buffer.from(ab));
                if (buf) return buf;
            }
        } catch (e) {
            console.warn("[vietqr] fetch ảnh ngoài thất bại:", e.message);
        }
    }

    // 3. Dự phòng tin cậy: Tự sinh mã QR chuẩn Napas VietQR (chuẩn EMVCo ngân hàng Việt Nam)
    // chạy 100% local, quét được trên tất cả app ngân hàng (MB, VCB, ACB, Techcombank,...)
    if (accNo) {
        try {
            const emvco = buildVietQrString({ bankBin, accountNumber: accNo, amount, content });
            return await QRCode.toBuffer(emvco, {
                type: "png",
                width: 520,
                margin: 2,
                errorCorrectionLevel: "M",
            });
        } catch (e) {
            console.error("[vietqr] sinh mã QR local thất bại:", e.message);
        }
    }

    return null;
}

// Bank config đọc động từ shop-config (DB → fallback env). Dùng sync getter
// vì cache đã được warm lúc startup; nếu chưa warm thì tự fallback về env.
function bankConfig() {
    return getBankConfigSync();
}

// SePay config
const SEPAY_CONFIG = {
    merchantId: process.env.SEPAY_MERCHANT_ID || "",
    secretKey: process.env.SEPAY_SECRET_KEY || "",
};

function escapeHtml(value = "") {
    return String(value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

// Order expiration time mặc định (phút) — fallback khi DB chưa cấu hình.
export const ORDER_EXPIRE_MINUTES = 10;

function expireMinutes() {
    return getOrderExpireMinutesSync() || ORDER_EXPIRE_MINUTES;
}

/**
 * Mốc thời gian: đơn tạo TRƯỚC mốc này đã quá hạn trả.
 *
 * Tách ra để query DB và `isOrderExpired` suy ra từ CÙNG một luật — hai chỗ tự tính
 * mốc là hai chỗ lệch nhau được, và lệch ở đây nghĩa là một đơn vừa bị coi là quá
 * hạn (để huỷ) vừa còn hạn (để khớp giao dịch).
 */
export function orderExpiryCutoff(now = Date.now()) {
    return new Date(now - expireMinutes() * 60 * 1000);
}

/**
 * Khoảng ÂN HẠN giữa "đã quá hạn trả" và "đáng huỷ".
 *
 * Vì sao cần: khách bấm chuyển tiền ở giây 590 của cửa sổ 600 giây là chuyện bình
 * thường, và ngân hàng ghi nhận giao dịch sau đó 20–30 giây. Huỷ đơn ngay khi quá
 * hạn thì trong tick kế tiếp đơn ĐÃ bị huỷ nhưng TIỀN ĐÃ VÀO tài khoản shop —
 * chuyển khoản ngân hàng không đảo ngược được, ngân hàng cũng không tự hoàn một
 * lệnh hợp lệ. Shop giữ tiền, khách không có hàng.
 *
 * Luật: **tiền đã vào thì thắng mốc hết hạn**, trong một khoảng hữu hạn. Đơn vẫn bị
 * huỷ, chỉ là huỷ MUỘN hơn 15 phút. Khách chưa trả tiền thì có thêm 15 phút để trả —
 * đó là quà, không phải thiệt hại; chi phí thật là coupon/tồn kho bị giữ lâu hơn.
 *
 * Nằm ở ĐÂY, cạnh `orderExpiryCutoff`, để bank-poller và IPN webhook dùng chung một
 * luật. Hai chỗ tự chọn dải ân hạn là hai chỗ một đơn vừa được khớp vừa bị huỷ.
 */
export const VIETQR_MATCH_GRACE_MS = 15 * 60 * 1000;

/**
 * Mốc ĐÁNG HUỶ: đơn tạo trước mốc này mới bị huỷ. Đơn nằm giữa `orderCancelCutoff`
 * và `orderExpiryCutoff` là đơn "đã quá hạn trả nhưng vẫn còn khớp được" — tập mà
 * cả bank-poller lẫn IPN webhook phải đem đi khớp giao dịch.
 */
export function orderCancelCutoff(now = Date.now(), graceMs = VIETQR_MATCH_GRACE_MS) {
    return new Date(orderExpiryCutoff(now).getTime() - Math.max(0, Number(graceMs) || 0));
}

/** Đơn này còn nằm trong tập KHỚP được giao dịch không (chưa trôi qua dải ân hạn)? */
export function isOrderMatchable(createdAt, now = Date.now(), graceMs = VIETQR_MATCH_GRACE_MS) {
    return new Date(createdAt) >= orderCancelCutoff(now, graceMs);
}

/**
 * Generate VietQR URL with amount
 */
export function generateQRUrl(amount, content) {
    const { bankCode, accountNumber, accountName } = bankConfig();

    // VietQR compact format with amount and content
    const qrUrl = `https://img.vietqr.io/image/${bankCode}-${accountNumber}-compact2.png?amount=${amount}&addInfo=${encodeURIComponent(content)}&accountName=${encodeURIComponent(accountName)}`;

    return qrUrl;
}

/**
 * Generate unique transfer content for order
 */
export function generateTransferContent(orderId) {
    // Short format: SHOP + last 8 chars of order ID
    const shortId = orderId.slice(-8).toUpperCase();
    return `SHOP${shortId}`;
}

/**
 * Create checkout with VietQR
 */
export async function createVietQRCheckout({ orderId, amount, productName, quantity }) {
    const transferContent = generateTransferContent(orderId);
    const qrUrl = generateQRUrl(amount, transferContent);
    const bank = bankConfig();

    const expiresAt = new Date(Date.now() + expireMinutes() * 60 * 1000);

    return {
        qrUrl,
        transferContent,
        amount,
        expiresAt,
        bankInfo: {
            bankName: bank.bankName,
            bankCode: bank.bankCode,
            accountNumber: bank.accountNumber,
            accountName: bank.accountName,
        },
        productInfo: {
            name: productName,
            quantity,
            total: amount,
        },
    };
}

/**
 * Format payment message for Telegram
 */
export function formatPaymentMessage(checkout, lang = "vi") {
    const { bankInfo, productInfo, transferContent, amount, expiresAt } = checkout;

    const money = amount.toLocaleString("vi-VN") + "đ";
    const remainMs = new Date(expiresAt) - Date.now();
    const remainMin = Math.max(1, Math.ceil(remainMs / 60000));

    const DIVIDER = "─────────────────────";
    const productLine = productInfo?.name
        ? `🛒 Sản phẩm: <b>${escapeHtml(productInfo.name)}</b>${productInfo.quantity > 1 ? ` x${productInfo.quantity}` : ""}\n`
        : "";

    return `🏦 <b>Thanh toán đơn hàng</b>\n${DIVIDER}\n`
        + productLine
        + `💰 Số tiền: <b>${money}</b>\n`
        + `📝 Nội dung CK: <code>${escapeHtml(transferContent)}</code>\n\n`
        + `⚠️ Chuyển đúng số tiền và đúng nội dung. Hết hạn sau <b>${remainMin} phút</b>.`;
}

/**
 * Verify IPN webhook from payment gateway
 * Supports: Casso, SePay, or custom webhook
 *
 * Thiếu secret là LỖI CẤU HÌNH, không phải lý do bỏ qua xác thực: nếu bỏ qua thì
 * bất kỳ ai POST /webhook/ipn đúng format đều chuyển được đơn sang PAID và nhận
 * hàng miễn phí. Chỉ môi trường dev mới được tắt, bằng ALLOW_UNSIGNED_IPN=true.
 */
export function verifyIPNWebhook(req, provider = "casso", opts = {}) {
    const allowUnsigned = String(process.env.ALLOW_UNSIGNED_IPN || "").toLowerCase() === "true";

    // SePay xác thực bằng header "Authorization: Apikey <KEY>". Tách riêng để không
    // đụng token thuebankvn — cho phép 2 nguồn dùng token khác nhau, chạy song song.
    // opts.sepayKey: key resolve từ Setting DB (web admin) — ưu tiên hơn ENV.
    if (provider === "sepay") {
        const sepayKey = opts.sepayKey || process.env.SEPAY_API_KEY || process.env.SEPAY_SECRET_KEY || "";
        if (!sepayKey) {
            if (!allowUnsigned) {
                throw new Error("SePay IPN chưa cấu hình SEPAY_API_KEY — từ chối webhook chưa xác thực");
            }
            console.warn("⚠️ ALLOW_UNSIGNED_IPN=true: bỏ qua xác thực SePay (chỉ dùng cho dev)");
            return true;
        }
        const auth = String(req.headers["authorization"] || "");
        // Chấp nhận "Apikey <key>", "Bearer <key>", hoặc key trần trong header phụ.
        const provided = auth.replace(/^(Apikey|Bearer)\s+/i, "").trim()
            || req.headers["x-api-key"]
            || req.headers["secure-token"];
        // secretEquals: so sánh thời gian không đổi (M7). Webhook là endpoint public,
        // gọi được tuỳ ý → `!==` cho phép dò key theo từng byte qua thời gian phản hồi.
        if (!secretEquals(typeof provided === "string" ? provided : "", sepayKey)) {
            throw new Error("Invalid SePay signature");
        }
        return true;
    }

    const signature = req.headers["signature"]
        || req.headers["x-signature"]
        || req.headers["secure-token"]
        || req.headers["x-api-key"];
    const expectedToken = process.env.THUEAPIBANK_WEBHOOK_SIGNATURE
        || process.env.IPN_SECRET_TOKEN;

    if (!expectedToken) {
        if (!allowUnsigned) {
            throw new Error("IPN chưa cấu hình IPN_SECRET_TOKEN — từ chối webhook chưa xác thực");
        }
        console.warn("⚠️ ALLOW_UNSIGNED_IPN=true: bỏ qua xác thực IPN (chỉ dùng cho dev)");
        return true;
    }

    if (!secretEquals(typeof signature === "string" ? signature : "", expectedToken)) {
        throw new Error("Invalid IPN signature");
    }

    return true;
}

/**
 * Parse IPN data to extract order info
 * Different formats for different providers
 */
export function parseIPNItems(body, provider = "casso") {
    if (Array.isArray(body?.transactions) && body.transactions.length) {
        return body.transactions
            .filter((item) => String(item.type || "").toUpperCase() !== "OUT")
            .map((item) => ({
                amount: Number(item.amount || item.creditAmount || 0),
                content: item.description || item.content || item.memo || "",
                transactionId: item.transactionID || item.transactionId || item.tranId || item.refNo || item.id || "",
                when: item.transactionDate || item.postingDate || item.when || item.date || null,
            }));
    }

    if (Array.isArray(body?.TranList) && body.TranList.length) {
        return body.TranList
            .filter((item) => Number(item.creditAmount || item.amount || 0) > 0)
            .map((item) => ({
                amount: Number(item.creditAmount || item.amount || 0),
                content: item.description || item.content || item.memo || "",
                transactionId: item.tranId || item.refNo || item.id || "",
                when: item.transactionDate || item.postingDate || item.when || item.date || null,
            }));
    }

    if (provider === "casso") {
        const items = Array.isArray(body.data) ? body.data : [body.data || body];
        return items.filter(Boolean).map((item) => ({
            amount: Number(item.amount || item.creditAmount || 0),
            content: item.description || item.content || item.memo || "",
            transactionId: item.tid || item.id || item.tranId || "",
            when: item.when || item.transactionDate || item.date || null,
        }));
    }

    if (provider === "sepay") {
        return [{
            amount: Number(body.transferAmount || body.amount || 0),
            content: body.content || body.description || "",
            transactionId: body.referenceCode || body.transactionId || body.id || "",
            when: body.transactionDate || body.when || body.date || null,
        }];
    }

    return [{
        amount: Number(body.amount || body.creditAmount || 0),
        content: body.content || body.description || body.memo || "",
        transactionId: body.transactionId || body.id || body.tranId || body.refNo || "",
        when: body.when || body.date || body.transactionDate || body.postingDate || null,
    }];
}

export function parseIPNData(body, provider = "casso") {
    return parseIPNItems(body, provider)[0] || {
        amount: 0,
        content: "",
        transactionId: "",
        when: null,
    };
}

/**
/**
 * Extract order ID from transfer content.
 * Yêu cầu chính xác prefix SHOP{shortId} để tránh false-match.
 */
export function extractOrderIdFromContent(content, orderId) {
    if (!content) return null;

    const upperContent = content.toUpperCase().replace(/\s+/g, "");
    const shortId = orderId.slice(-8).toUpperCase();

    if (upperContent.includes(`SHOP${shortId}`)) {
        return orderId;
    }

    return null;
}

/**
 * Check if order is expired
 */
export function isOrderExpired(createdAt) {
    return new Date(createdAt) < orderExpiryCutoff();
}

export default {
    generateQRUrl,
    fetchVietQrImageBuffer,
    buildVietQrString,
    extractImageFromResponse,
    BANK_BINS,
    generateTransferContent,
    createVietQRCheckout,
    formatPaymentMessage,
    parseIPNItems,
    verifyIPNWebhook,
    parseIPNData,
    extractOrderIdFromContent,
    isOrderExpired,
    orderExpiryCutoff,
    orderCancelCutoff,
    isOrderMatchable,
    VIETQR_MATCH_GRACE_MS,
    ORDER_EXPIRE_MINUTES,
};
