import { Router } from "express";
import { createHmac } from "node:crypto";
import prisma from "./lib/prisma.js";
import { SETTLED_ORDER_STATUSES } from "./lib/payment-events.js";
import { getBalance, purchase as walletPurchase, promoteSettledWalletOrder, refund as walletRefund } from "./wallet.js";
import { deliverOrder } from "./delivery.js";
import { getStockCount } from "./inventory.js";
import { getUsdVndRate } from "./payment/crypto.js";
import { isUsdCurrency, toVndAmount } from "./money-display.js";
import { secretEquals } from "./lib/secret-compare.js";
import { getProfiles, getProfileConfig, createApiKey } from "./gpt2api.js";
import {
    parseTokenAmount, parseRpmAmount, parseDaysAmount, parseTpmAmount,
    priceUsdForKey, MIN_KEY_RPM, MAX_KEY_RPM, MIN_KEY_DAYS, MAX_KEY_DAYS, DEFAULT_KEY_TPM,
} from "./apikey-pricing.js";
import { saveIssuedKey, listIssuedKeys, KeySource } from "./apikey-store.js";
import { maskApiKey } from "./lib/mask-secret.js";
import { logAction } from "./audit.js";
import { getVipDiscount } from "./vip.js";
import { apiKeyMessage } from "./bot-ui/apikey-messages.js";
import { iconOf } from "./menu-config.js";

const router = Router();

// Instance bot — để `notify: true` gửi key cho khách qua Telegram
let _bot = null;
export function setUserBotInstance(b) { _bot = b; }

// ─── Key helpers ──────────────────────────────────────────────────────────────
function userApiSecret() {
    const secret = String(process.env.USER_API_SECRET || "").trim();
    if (!secret) throw new Error("USER_API_SECRET chưa được cấu hình");
    return secret;
}

function generateUserKey(telegramId) {
    const id = String(telegramId || "").trim();
    if (!/^\d{3,}$/.test(id)) throw new Error("Telegram ID không hợp lệ");
    const signature = createHmac("sha256", userApiSecret())
        .update(`user-api:v2:${id}`)
        .digest("hex");
    // Nhúng ID không bí mật vào key để auth lookup O(1), không quét tối đa 5.000 user.
    return `sk_u_v2_${id}_${signature}`;
}

export function getUserApiKey(telegramId) {
    return generateUserKey(telegramId);
}

function telegramIdFromUserKey(key) {
    const match = /^sk_u_v2_(\d{3,})_([a-f0-9]{64})$/.exec(String(key || ""));
    return match ? { telegramId: match[1], signature: match[2] } : null;
}

/** Xác thực User API key v2 (`sk_u_v2_<telegramId>_<hmac>`) và trả về `telegramId` nếu hợp lệ. */
export function verifyUserApiKey(key) {
    const parsed = telegramIdFromUserKey(key);
    if (!parsed) return { ok: false, code: "INVALID_FORMAT" };
    const expected = generateUserKey(parsed.telegramId);
    if (!secretEquals(expected, key)) return { ok: false, code: "BAD_SIGNATURE" };
    return { ok: true, telegramId: parsed.telegramId };
}

// ─── Auth middleware ──────────────────────────────────────────────────────────
async function userAuth(req, res, next) {
    try {
        const auth = req.headers.authorization || "";
        const key = auth.startsWith("Bearer ") ? auth.slice(7) : req.headers["x-api-key"];
        const checked = verifyUserApiKey(key);
        if (!checked.ok) {
            const msg = checked.code === "BAD_SIGNATURE"
                ? "API key không đúng"
                : "API key không hợp lệ. Hãy lấy key mới bằng lệnh /api trong bot.";
            return res.status(401).json({ error: msg });
        }

        const found = await prisma.user.findUnique({
            where: { telegramId: checked.telegramId },
            select: { id: true, telegramId: true, firstName: true, vipLevel: true },
        });
        if (!found) return res.status(401).json({ error: "Tài khoản không tồn tại trên hệ thống" });
        req.apiUser = found;
        next();
    } catch (error) {
        if (/USER_API_SECRET/.test(error.message)) {
            return res.status(503).json({ error: "User API chưa được cấu hình trên máy chủ" });
        }
        next(error);
    }
}

// ─── Helper: Product ảo API Key ───────────────────────────────────────────────
let _cachedApiKeyProductId = null;
async function getOrCreateApiKeyProduct() {
    if (_cachedApiKeyProductId) {
        const p = await prisma.product.findUnique({ where: { id: _cachedApiKeyProductId } }).catch(() => null);
        if (p) return p;
        _cachedApiKeyProductId = null;
    }
    let p = await prisma.product.findUnique({ where: { code: "__API_KEY__" } }).catch(() => null);
    if (!p) {
        p = await prisma.product.create({
            data: {
                code: "__API_KEY__",
                name: "API Key",
                description: "API key token (tạo động theo số token khách chọn)",
                price: 0,
                currency: "USD",
                deliveryMode: "API_KEY",
                isActive: false,
                unlisted: true,
            },
        }).catch(async () => {
            return prisma.product.findUnique({ where: { code: "__API_KEY__" } });
        });
    }
    _cachedApiKeyProductId = p?.id || null;
    return p;
}

// ─── Endpoints ────────────────────────────────────────────────────────────────

/** GET /api/user/docs — trang tài liệu API */
router.get("/docs", (req, res) => {
    const base = `${req.protocol}://${req.get("host")}/api/user`;
    res.type("html").send(`<!doctype html>
<html lang="vi"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Tài liệu API Người dùng & Reseller</title>
<style>
  :root{color-scheme:dark}
  body{font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#090d16;color:#e2e8f0;margin:0;padding:2.5rem 1.25rem;line-height:1.6}
  .wrap{max-width:860px;margin:0 auto}
  h1{font-size:1.65rem;margin:0 0 .5rem;color:#f8fafc;font-weight:700}
  h2{font-size:1.15rem;margin:2rem 0 .75rem;color:#a5b4fc;border-bottom:1px solid #1e293b;padding-bottom:.4rem}
  h3{font-size:1rem;margin:1.25rem 0 .5rem;color:#cbd5e1}
  p,li{color:#94a3b8;font-size:.95rem}
  code{background:#1e293b;color:#38bdf8;padding:.2rem .45rem;border-radius:6px;font-size:.88em;font-family:ui-monospace,Menlo,monospace}
  pre{background:#0d1117;border:1px solid #1e293b;border-radius:10px;padding:1rem;overflow:auto;margin:.6rem 0}
  pre code{background:none;color:#a7f3d0;padding:0;font-size:.85rem}
  .ep{display:flex;gap:.75rem;align-items:center;padding:.65rem .9rem;border:1px solid #1e293b;border-radius:8px;margin:.5rem 0;background:#0f172a;flex-wrap:wrap}
  .m{font-weight:700;font-size:.75rem;padding:.2rem .55rem;border-radius:6px;font-family:ui-monospace,Menlo,monospace}
  .get{background:#064e3b;color:#6ee7b7}.post{background:#3b2f06;color:#fcd34d}
  .note{border-left:4px solid #6366f1;padding:.75rem 1rem;background:#0f172a;border-radius:0 8px 8px 0;margin:1.25rem 0}
  .tip{border-left-color:#10b981}
  .alert{border-left-color:#ef4444}
  table{border-collapse:collapse;width:100%;margin:.75rem 0;font-size:.9rem}
  th,td{text-align:left;padding:.5rem .75rem;border-bottom:1px solid #1e293b}
  th{color:#94a3b8;background:#0f172a;font-weight:600}
  .badge{display:inline-block;padding:.15rem .5rem;border-radius:9999px;font-size:.75rem;font-weight:600}
</style></head>
<body><div class="wrap">
<h1>🚀 Tài liệu API Kết nối Reseller & Khách hàng</h1>
<p>Dành cho khách hàng & đại lý (reseller) nạp tiền vào bot qua số dư ví, sau đó gọi API để mua hàng hoặc tự động tạo API Key GPT.</p>
<p>Base URL: <code>${base}</code></p>

<div class="note tip">
  <b>Quy trình kết nối cho Reseller:</b><br>
  1. Mở bot Telegram, gửi lệnh <code>/api</code> để nhận <b>API Key cá nhân</b> (dạng <code>sk_u_v2_...</code>).<br>
  2. Nạp tiền vào tài khoản bot (chuyển khoản VietQR MB Bank hoặc ví Crypto).<br>
  3. Gọi API <code>POST /api/user/keys</code> từ hệ thống của bạn để tạo key GPT cho khách. Hệ thống sẽ <b>tự động trừ tiền vào số dư ví</b> của bạn!
</div>

<h2>1. Xác thực HTTP Request</h2>
<p>Gửi API key trong header của mọi request:</p>
<pre><code>Authorization: Bearer sk_u_v2_123456789_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx</code></pre>
<p>Hoặc gửi qua header <code>x-api-key: sk_u_v2_...</code></p>

<h2>2. Tài khoản & Số dư</h2>
${["GET", "/me", "Xem thông tin tài khoản, cấp VIP và số dư ví VND hiện có"].map(([m, p, d]) => `<div class="ep"><span class="m ${m.toLowerCase()}">${m}</span><code>${p}</code><span>${d}</span></div>`).join("")}

<pre><code>curl -s ${base}/me \\
  -H "Authorization: Bearer $USER_KEY"</code></pre>

<h2>3. Dành cho Reseller: Tạo API Key (Trừ số dư ví)</h2>
<div class="ep"><span class="m get">GET</span><code>/profiles</code><span>Danh sách server, đơn giá $/1M token, RPM, số ngày hết hạn</span></div>
<div class="ep"><span class="m post">POST</span><code>/quote</code><span>Báo giá trước (USD & VND), kiểm tra số dư ví</span></div>
<div class="ep"><span class="m post">POST</span><code>/keys</code><span><b>Tạo API Key</b> — Tự động trừ tiền ví & cấp chuỗi key sk-*</span></div>
<div class="ep"><span class="m get">GET</span><code>/keys</code><span>Danh sách các API Key đã tạo của tài khoản</span></div>
<div class="ep"><span class="m get">GET</span><code>/keys/:id</code><span>Xem chi tiết trạng thái một API Key</span></div>

<h3>Tham số khi tạo API Key (<code>POST /keys</code>)</h3>
<table>
  <tr><th>Tham số</th><th>Kiểu</th><th>Bắt buộc</th><th>Mô tả</th></tr>
  <tr><td><code>tokens</code></td><td>string | int</td><td><b>Có</b></td><td>Số lượng token. Nhận dạng số <code>10000000</code> hoặc chuỗi viết tắt <code>"10m"</code>, <code>"5tr"</code>, <code>"1b"</code></td></tr>
  <tr><td><code>rpm</code></td><td>int</td><td>Không</td><td>Giới hạn lượt gọi/phút (10–10000). Mặc định lấy theo server</td></tr>
  <tr><td><code>validDays</code></td><td>int</td><td>Không</td><td>Số ngày hiệu lực (1–3650, hoặc <code>0</code> = vĩnh viễn). Mặc định theo server</td></tr>
  <tr><td><code>profileId</code></td><td>int</td><td>Không</td><td>ID server/profile (xem ở <code>GET /profiles</code>). Bỏ trống = server mặc định</td></tr>
  <tr><td><code>name</code></td><td>string</td><td>Không</td><td>Ghi chú hoặc tên key của bạn (tối đa 60 ký tự)</td></tr>
  <tr><td><code>clientRef</code></td><td>string</td><td><b>Khuyên dùng</b></td><td>Mã đơn phía bạn. Chống trừ tiền 2 lần khi bạn retry request do mạng chập chờn</td></tr>
  <tr><td><code>targetTelegramId</code></td><td>string</td><td>Không</td><td>ID Telegram của khách. Nếu gửi, key sẽ hiện trong <code>/mykey</code> của khách đó</td></tr>
  <tr><td><code>notify</code></td><td>boolean</td><td>Không</td><td><code>true</code> = bot tự động gửi tin nhắn Telegram báo key cho khách (nếu có <code>targetTelegramId</code>)</td></tr>
</table>

<h3>Ví dụ: Kiểm tra giá trước (Quote)</h3>
<pre><code>curl -X POST ${base}/quote \\
  -H "Authorization: Bearer $USER_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "tokens": "10m",
    "validDays": 30
  }'</code></pre>

<h3>Ví dụ: Gọi tạo Key và trừ tiền ví</h3>
<pre><code>curl -X POST ${base}/keys \\
  -H "Authorization: Bearer $USER_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "tokens": "10m",
    "validDays": 30,
    "name": "Khách A",
    "clientRef": "ORDER_102938"
  }'</code></pre>

<p><b>Response thành công:</b></p>
<pre><code>{
  "ok": true,
  "orderId": "clx...",
  "shortId": "A1B2C3D4",
  "key": "sk-proj-xxxxxxxxxxxxxxxxxxxx",
  "quotaTokens": 10000000,
  "rpm": 60,
  "validDays": 30,
  "expiresAt": "2026-11-30T14:00:00.000Z",
  "priceUsd": 5.0,
  "priceVnd": 127000,
  "newBalance": 373000,
  "profile": {
    "id": 1,
    "name": "Server Chính"
  }
}</code></pre>

<div class="note alert">
  <b>Bảo vệ tiền của bạn (Auto Refund):</b><br>
  Nếu máy chủ AI nhà cung cấp gặp sự cố và không tạo được key, hệ thống sẽ <b>hoàn tiền 100% về ví ngay lập tức</b> và trả lỗi HTTP 502 để bạn không bao giờ bị trừ tiền oan.
</div>

<h2>4. Mua sản phẩm thông thường (Tài khoản, Mã thẻ, File)</h2>
<div class="ep"><span class="m get">GET</span><code>/products</code><span>Danh sách sản phẩm thông thường đang bán kèm tồn kho</span></div>
<div class="ep"><span class="m post">POST</span><code>/purchase</code><span>Mua sản phẩm bằng số dư ví</span></div>
<div class="ep"><span class="m get">GET</span><code>/orders</code><span>Danh sách đơn hàng của bạn</span></div>
<div class="ep"><span class="m get">GET</span><code>/orders/:id</code><span>Xem chi tiết đơn hàng và nội dung đã nhận</span></div>

<pre><code>curl -X POST ${base}/purchase \\
  -H "Authorization: Bearer $USER_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"productId":"clx...","quantity":1}'</code></pre>

</div></body></html>`);
});

/** GET /api/user/me — Thông tin tài khoản & số dư ví */
router.get("/me", userAuth, async (req, res) => {
    try {
        const balance = await getBalance(req.apiUser.telegramId);
        res.json({
            ok: true,
            telegramId: req.apiUser.telegramId,
            name: req.apiUser.firstName,
            vipLevel: req.apiUser.vipLevel,
            balance,
        });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── API Key / GPT2API endpoints cho Reseller ──────────────────────────────────

/**
 * GET /api/user/apikey/profiles & GET /api/user/profiles
 * Danh sách máy chủ GPT2API, đơn giá, giới hạn RPM, ngày hiệu lực và tỷ giá USD/VND
 */
const handleGetProfiles = async (req, res) => {
    try {
        const [profiles, usdVndRate] = await Promise.all([
            getProfiles(),
            getUsdVndRate(),
        ]);
        const activeProfiles = profiles
            .filter(p => p.enabled !== false && p.shopEnabled !== false && p.configured)
            .map(p => ({
                profileId: p.profileId,
                name: p.profileName,
                usdPerMtoken: Number(p.usdPerMtoken) || 0,
                maxBuyTokens: Number(p.maxBuyTokens) || 0,
                defaultRpm: Number(p.rpm) || 0,
                defaultValidDays: Number(p.validDays) || 0,
                rpmPresets: Array.isArray(p.rpmPresets) ? p.rpmPresets : [],
                daysPresets: Array.isArray(p.daysPresets) ? p.daysPresets : [],
                models: Array.isArray(p.models) ? p.models : [],
            }));
        res.json({
            ok: true,
            usdVndRate,
            profiles: activeProfiles,
        });
    } catch (e) { res.status(500).json({ error: e.message }); }
};
router.get("/apikey/profiles", userAuth, handleGetProfiles);
router.get("/profiles", userAuth, handleGetProfiles);

/**
 * POST /api/user/apikey/quote & POST /api/user/quote
 * Xem trước giá tiền (USD & VND), kiểm tra số dư ví
 * Body: { tokens, rpm?, validDays?, profileId? }
 */
const handleQuote = async (req, res) => {
    try {
        const b = req.body || {};
        const profileId = (b.profileId === undefined || b.profileId === null || b.profileId === "")
            ? null : (Math.floor(Number(b.profileId)) || null);

        const cfg = await getProfileConfig(profileId);
        if (!cfg.configured) return res.status(400).json({ error: "Shop chưa cấu hình GPT2API" });

        const parsedTokens = parseTokenAmount(b.tokens ?? b.quotaTokens, { min: 1, max: Number(cfg.maxBuyTokens) || undefined });
        if (!parsedTokens.ok) {
            return res.status(400).json({
                error: `tokens không hợp lệ (${parsedTokens.error})`,
                min: parsedTokens.min ?? 1,
                max: parsedTokens.max ?? null,
            });
        }
        const tokens = parsedTokens.tokens;

        let rpm = 0;
        if (b.rpm !== undefined && b.rpm !== null && String(b.rpm).trim() !== "") {
            const p = parseRpmAmount(b.rpm, { min: MIN_KEY_RPM, max: MAX_KEY_RPM });
            if (!p.ok) return res.status(400).json({ error: `rpm không hợp lệ (${p.error})`, min: p.min, max: p.max });
            rpm = p.rpm;
        }

        let validDays = null;
        if (b.validDays !== undefined && b.validDays !== null && String(b.validDays).trim() !== "") {
            const p = parseDaysAmount(b.validDays, { min: MIN_KEY_DAYS, max: MAX_KEY_DAYS });
            if (!p.ok) return res.status(400).json({ error: `validDays không hợp lệ (${p.error})`, min: p.min, max: p.max });
            validDays = p.days;
        }

        const effectiveRpm = rpm > 0 ? rpm : (Number(cfg.rpm) || 0);
        const effectiveValidDays = validDays !== null ? validDays : (Number(cfg.validDays) || 0);

        const listPriceUsd = priceUsdForKey(
            { tokens, rpm: effectiveRpm, validDays: effectiveValidDays },
            cfg.usdPerMtoken,
            cfg
        );

        const vipDiscountPercent = await getVipDiscount(req.apiUser.id).catch(() => 0);
        const finalPriceUsd = vipDiscountPercent > 0
            ? Math.max(0, listPriceUsd * (1 - vipDiscountPercent / 100))
            : listPriceUsd;

        const usdVndRate = getUsdVndRate();
        const priceVnd = Math.round(finalPriceUsd * usdVndRate);

        const balance = await getBalance(req.apiUser.telegramId);

        res.json({
            ok: true,
            tokens,
            rpm: effectiveRpm,
            validDays: effectiveValidDays,
            profile: {
                id: cfg.profileId,
                name: cfg.profileName,
            },
            listPriceUsd,
            vipDiscountPercent,
            priceUsd: Number(finalPriceUsd.toFixed(4)),
            usdVndRate,
            priceVnd,
            currentBalance: balance,
            sufficientBalance: balance >= priceVnd,
            shortfall: Math.max(0, priceVnd - balance),
        });
    } catch (e) { res.status(500).json({ error: e.message }); }
};
router.post("/apikey/quote", userAuth, handleQuote);
router.post("/quote", userAuth, handleQuote);

/**
 * POST /api/user/apikey/create & POST /api/user/keys
 * Tạo API Key GPT2API và tự động trừ vào số dư ví của tài khoản
 * Body: { tokens, rpm?, validDays?, tpm?, profileId?, name?, clientRef?, targetTelegramId?, notify? }
 */
const handleCreateApiKey = async (req, res) => {
    let order = null;
    let priceVnd = 0;
    try {
        const b = req.body || {};
        const profileId = (b.profileId === undefined || b.profileId === null || b.profileId === "")
            ? null : (Math.floor(Number(b.profileId)) || null);

        const clientRef = b.clientRef == null ? "" : String(b.clientRef).trim();
        if (clientRef.length > 100) {
            return res.status(400).json({ error: "clientRef tối đa 100 ký tự" });
        }

        // Idempotency: nếu client gửi clientRef, kiểm tra đơn cũ đã hoàn tất chưa
        if (clientRef) {
            const existingOrder = await prisma.order.findFirst({
                where: {
                    odelegramId: req.apiUser.telegramId,
                    source: "api",
                    oderId: clientRef,
                    status: "DELIVERED",
                },
            });
            if (existingOrder && existingOrder.deliveryContent) {
                try {
                    const deliveredData = JSON.parse(existingOrder.deliveryContent);
                    return res.status(200).json({
                        ok: true,
                        duplicate: true,
                        orderId: existingOrder.id,
                        shortId: existingOrder.id.slice(-8).toUpperCase(),
                        key: deliveredData.key,
                        quotaTokens: deliveredData.quotaTokens,
                        rpm: deliveredData.rpm,
                        validDays: deliveredData.validDays,
                        expiresAt: deliveredData.expiresAt,
                        priceUsd: existingOrder.displayFinalUsd,
                        priceVnd: existingOrder.finalAmount,
                        note: "clientRef này đã được tạo thành công trước đó.",
                    });
                } catch {}
            }
        }

        const cfg = await getProfileConfig(profileId);
        if (!cfg.configured) return res.status(400).json({ error: "Shop chưa cấu hình GPT2API" });

        const parsedTokens = parseTokenAmount(b.tokens ?? b.quotaTokens, { min: 1, max: Number(cfg.maxBuyTokens) || undefined });
        if (!parsedTokens.ok) {
            return res.status(400).json({
                error: `tokens không hợp lệ (${parsedTokens.error})`,
                min: parsedTokens.min ?? 1,
                max: parsedTokens.max ?? null,
            });
        }
        const tokens = parsedTokens.tokens;

        let rpm = 0;
        if (b.rpm !== undefined && b.rpm !== null && String(b.rpm).trim() !== "") {
            const p = parseRpmAmount(b.rpm, { min: MIN_KEY_RPM, max: MAX_KEY_RPM });
            if (!p.ok) return res.status(400).json({ error: `rpm không hợp lệ (${p.error})`, min: p.min, max: p.max });
            rpm = p.rpm;
        }

        let validDays = null;
        if (b.validDays !== undefined && b.validDays !== null && String(b.validDays).trim() !== "") {
            const p = parseDaysAmount(b.validDays, { min: MIN_KEY_DAYS, max: MAX_KEY_DAYS });
            if (!p.ok) return res.status(400).json({ error: `validDays không hợp lệ (${p.error})`, min: p.min, max: p.max });
            validDays = p.days;
        }

        let tpm = DEFAULT_KEY_TPM;
        if (b.tpm !== undefined && b.tpm !== null && String(b.tpm).trim() !== "") {
            const p = parseTpmAmount(b.tpm, { min: MIN_KEY_TPM, max: MAX_KEY_TPM });
            if (!p.ok) return res.status(400).json({ error: `tpm không hợp lệ (${p.error})`, min: p.min, max: p.max });
            tpm = p.tpm;
        }

        const effectiveRpm = rpm > 0 ? rpm : (Number(cfg.rpm) || 0);
        const effectiveValidDays = validDays !== null ? validDays : (Number(cfg.validDays) || 0);

        const listPriceUsd = priceUsdForKey(
            { tokens, rpm: effectiveRpm, validDays: effectiveValidDays },
            cfg.usdPerMtoken,
            cfg
        );

        const vipDiscountPercent = await getVipDiscount(req.apiUser.id).catch(() => 0);
        const finalPriceUsd = vipDiscountPercent > 0
            ? Math.max(0, listPriceUsd * (1 - vipDiscountPercent / 100))
            : listPriceUsd;

        const usdVndRate = getUsdVndRate();
        priceVnd = Math.round(finalPriceUsd * usdVndRate);

        const balance = await getBalance(req.apiUser.telegramId);
        if (balance < priceVnd) {
            return res.status(400).json({
                error: `Số dư ví không đủ. Cần ${priceVnd.toLocaleString("vi-VN")}đ ($${finalPriceUsd.toFixed(2)}), hiện có ${balance.toLocaleString("vi-VN")}đ`,
                requiredVnd: priceVnd,
                currentBalance: balance,
                shortfall: priceVnd - balance,
                requiredUsd: Number(finalPriceUsd.toFixed(4)),
            });
        }

        const targetTelegramId = b.targetTelegramId ? String(b.targetTelegramId).trim() : req.apiUser.telegramId;
        const notify = b.notify === true;

        const product = await getOrCreateApiKeyProduct();

        order = await prisma.order.create({
            data: {
                odelegramId: req.apiUser.telegramId,
                chatId: req.apiUser.telegramId,
                productId: product.id,
                quantity: 1,
                amount: Math.round(listPriceUsd * usdVndRate),
                discount: Math.round(listPriceUsd * usdVndRate) - priceVnd,
                finalAmount: priceVnd,
                currency: "VND",
                displayCurrency: "USD",
                displayUnitPrice: Number(finalPriceUsd.toFixed(4)),
                displayFinalUsd: Number(finalPriceUsd.toFixed(4)),
                cryptoUsdVndRate: usdVndRate,
                status: "PENDING",
                paymentMethod: "wallet",
                source: "api",
                userId: req.apiUser.id,
                oderId: clientRef || null,
            },
        });

        // Trừ ví của user/seller
        const purchase = await walletPurchase(
            req.apiUser.telegramId,
            priceVnd,
            order.id,
            `API: Mua API Key ${tokens} token`
        );

        if (!purchase.success) {
            await prisma.order.update({ where: { id: order.id }, data: { status: "CANCELED" } });
            return res.status(400).json({ error: purchase.error });
        }

        // Tạo key bên GPT2API
        const keyName = String(b.name || "").trim().slice(0, 60) || `user-${req.apiUser.telegramId}-${Date.now()}`;
        const created = await createApiKey({
            quotaTokens: tokens,
            name: keyName,
            rpm: effectiveRpm > 0 ? effectiveRpm : undefined,
            tpm: tpm > 0 ? tpm : undefined,
            validDays: validDays === null ? undefined : validDays,
            profileId,
            allowDisabledProfile: false,
        });

        if (!created.ok) {
            // Hoàn tiền ví ngay lập tức cho seller
            await walletRefund(
                req.apiUser.telegramId,
                priceVnd,
                order.id,
                `Hoàn tiền: tạo API key lỗi (${created.message || created.code})`
            ).catch(err => console.error("[user-api] refund failed:", err));

            await prisma.order.update({
                where: { id: order.id },
                data: { status: "CANCELED", deliveryError: created.message || "Tạo key thất bại" },
            }).catch(() => {});

            return res.status(502).json({
                error: created.message || "GPT2API từ chối tạo key. Tiền đã được hoàn lại ví của bạn.",
                code: created.code,
                refunded: true,
                currentBalance: balance,
            });
        }

        const expiresAt = created.expiresAt || null;

        // Lưu bản ghi vào IssuedApiKey
        await saveIssuedKey({
            telegramId: targetTelegramId,
            key: created.key,
            quotaTokens: tokens,
            rpm: effectiveRpm,
            tpm,
            source: KeySource.PURCHASE,
            orderId: order.id,
            priceUsd: finalPriceUsd,
            externalId: created.id,
            expiresAt,
            models: cfg.models || [],
            profileId: cfg.profileId,
            profileName: cfg.profileName || "",
        });

        // Cập nhật Order DELIVERED
        await prisma.order.update({
            where: { id: order.id },
            data: {
                status: "DELIVERED",
                paymentRef: purchase.transaction?.id || `WALLET:${order.id}`,
                deliveryContent: JSON.stringify({
                    key: created.key,
                    quotaTokens: tokens,
                    rpm: effectiveRpm,
                    validDays,
                    expiresAt,
                    profileId: cfg.profileId,
                }),
            },
        });

        logAction(req.apiUser.telegramId, "API_PURCHASE_KEY", order.id, {
            tokens, priceVnd, finalPriceUsd, profileId: cfg.profileId,
        });

        // Gửi tin nhắn Telegram thông báo key nếu có cờ notify
        let notified = false;
        if (notify && targetTelegramId && _bot?.telegram) {
            try {
                await _bot.telegram.sendMessage(targetTelegramId, apiKeyMessage({
                    key: created.key,
                    quotaTokens: tokens,
                    rpm: effectiveRpm,
                    tpm,
                    models: cfg.models || [],
                    endpoint: cfg.endpoint,
                    usageUrl: cfg.usageUrl,
                    mykeyCommand: "/mykey",
                    kind: "buy",
                    expiresAt,
                    lang: "vi",
                    icon: iconOf,
                }), { parse_mode: "HTML" });
                notified = true;
            } catch (e) {
                console.error("[user-api] notify error:", e.message);
            }
        }

        res.json({
            ok: true,
            orderId: order.id,
            shortId: order.id.slice(-8).toUpperCase(),
            key: created.key,
            quotaTokens: tokens,
            rpm: effectiveRpm,
            validDays: effectiveValidDays,
            expiresAt,
            priceUsd: Number(finalPriceUsd.toFixed(4)),
            priceVnd,
            newBalance: purchase.newBalance,
            profile: {
                id: cfg.profileId,
                name: cfg.profileName,
            },
            notified,
        });
    } catch (e) {
        // Rollback nếu có lỗi phát sinh sau khi trừ ví
        if (order && priceVnd > 0) {
            await walletRefund(
                req.apiUser.telegramId,
                priceVnd,
                order.id,
                "Hoàn tiền: lỗi hệ thống khi tạo API key"
            ).catch(() => null);
            await prisma.order.update({
                where: { id: order.id },
                data: { status: "CANCELED", deliveryError: e.message },
            }).catch(() => {});
        }
        res.status(500).json({ error: e.message });
    }
};
router.post("/apikey/create", userAuth, handleCreateApiKey);
router.post("/keys", userAuth, handleCreateApiKey);

/**
 * GET /api/user/apikey/keys & GET /api/user/keys
 * Danh sách key đã mua/cấp của tài khoản
 */
const handleListKeys = async (req, res) => {
    try {
        const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 20));
        const keys = await listIssuedKeys(req.apiUser.telegramId, limit);
        res.json({
            ok: true,
            keys: keys.map(k => ({
                id: k.id,
                key: maskApiKey(k.key),
                quotaTokens: k.quotaTokens,
                rpm: k.rpm,
                profileId: k.profileId,
                profileName: k.profileName,
                expiresAt: k.expiresAt,
                createdAt: k.createdAt,
                renewCount: k.renewCount,
            })),
        });
    } catch (e) { res.status(500).json({ error: e.message }); }
};
router.get("/apikey/keys", userAuth, handleListKeys);
router.get("/keys", userAuth, handleListKeys);

/**
 * GET /api/user/apikey/keys/:id & GET /api/user/keys/:id
 * Chi tiết một key
 */
const handleGetKeyDetail = async (req, res) => {
    try {
        const item = await prisma.issuedApiKey.findUnique({
            where: { id: req.params.id },
        });
        if (!item || String(item.telegramId) !== String(req.apiUser.telegramId)) {
            return res.status(404).json({ error: "Không tìm thấy key" });
        }
        res.json({
            ok: true,
            key: {
                id: item.id,
                key: maskApiKey(item.key),
                quotaTokens: item.quotaTokens,
                rpm: item.rpm,
                profileId: item.profileId,
                profileName: item.profileName,
                expiresAt: item.expiresAt,
                createdAt: item.createdAt,
                renewCount: item.renewCount,
            },
        });
    } catch (e) { res.status(500).json({ error: e.message }); }
};
router.get("/apikey/keys/:id", userAuth, handleGetKeyDetail);
router.get("/keys/:id", userAuth, handleGetKeyDetail);

// ─── Sản phẩm thông thường ───────────────────────────────────────────────────

/** GET /api/user/products */
router.get("/products", userAuth, async (req, res) => {
    try {
        const products = await prisma.product.findMany({
            where: { isActive: true },
            select: { id: true, name: true, price: true, currency: true, deliveryMode: true, description: true },
            orderBy: { createdAt: "desc" },
        });
        const result = await Promise.all(products.map(async (p) => {
            if (p.deliveryMode !== "STOCK_LINES") return { ...p, stock: null };
            const stock = await getStockCount(p.id).catch(() => 0); // cache 30s, countDocuments
            return { ...p, inStock: stock > 0, stock };
        }));
        res.json({ products: result });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

/** POST /api/user/purchase — buy product using wallet balance
 * Body: { productId, quantity?: 1 }
 */
router.post("/purchase", userAuth, async (req, res) => {
    try {
        const { productId, quantity = 1 } = req.body;
        if (!productId) return res.status(400).json({ error: "productId bắt buộc" });
        const qty = Math.max(1, Math.floor(Number(quantity)));

        const product = await prisma.product.findUnique({ where: { id: productId }, include: { category: true } });
        if (!product || !product.isActive) return res.status(404).json({ error: "Sản phẩm không tồn tại hoặc đã tắt" });

        // Check stock for STOCK_LINES
        if (product.deliveryMode === "STOCK_LINES") {
            const stock = await prisma.stockItem.count({ where: { productId, isSold: false } });
            if (stock < qty) return res.status(400).json({ error: `Không đủ hàng. Còn ${stock}, cần ${qty}` });
        }

        const usdVndRate = getUsdVndRate();
        const unitPriceVnd = toVndAmount(product.price, product.currency, { rate: usdVndRate });
        const totalAmount = unitPriceVnd * qty;
        const displayFinalUsd = isUsdCurrency(product.currency)
            ? Number(product.price) * qty
            : totalAmount / usdVndRate;
        const balance = await getBalance(req.apiUser.telegramId);
        if (balance < totalAmount) {
            return res.status(400).json({
                error: `Số dư không đủ. Cần ${totalAmount.toLocaleString("vi-VN")}đ ($${displayFinalUsd.toFixed(2)}), hiện có ${balance.toLocaleString("vi-VN")}đ`,
            });
        }

        const order = await prisma.order.create({
            data: {
                odelegramId: req.apiUser.telegramId,
                chatId: req.apiUser.telegramId,
                productId,
                quantity: qty,
                amount: totalAmount,
                discount: 0,
                finalAmount: totalAmount,
                currency: "VND",
                cryptoUsdVndRate: usdVndRate,
                displayCurrency: product.currency || "VND",
                displayUnitPrice: Number(product.price),
                displayFinalUsd,
                status: "PENDING",
                paymentMethod: "wallet",
                source: "api",
                userId: req.apiUser.id,
            },
        });

        // Deduct wallet
        const purchase = await walletPurchase(req.apiUser.telegramId, totalAmount, order.id, `API: Mua ${product.name} x${qty}`);
        if (!purchase.success) {
            await prisma.order.update({ where: { id: order.id }, data: { status: "CANCELED" } });
            return res.status(400).json({ error: purchase.error });
        }

        let settlement;
        try {
            settlement = await promoteSettledWalletOrder(order.id);
        } catch (settlementError) {
            console.error(`[user-api] wallet settled but order promotion failed ${order.id}:`, settlementError.message);
            return res.status(202).json({
                ok: true,
                paymentAccepted: true,
                processing: true,
                orderId: order.id,
                status: "PENDING",
                message: "Đã nhận thanh toán, đơn đang được hệ thống hoàn tất",
            });
        }
        if (!settlement.settled || !SETTLED_ORDER_STATUSES.includes(settlement.order?.status)) {
            return res.status(202).json({
                ok: true,
                paymentAccepted: true,
                processing: true,
                orderId: order.id,
                status: settlement.order?.status || "PENDING",
                message: "Đã nhận thanh toán, đơn đang được hệ thống hoàn tất",
            });
        }
        order.status = settlement.order.status;
        order.paymentRef = settlement.order.paymentRef || purchase.transaction?.id || `WALLET:${order.id}`;

        try {
            await deliverOrder({ prisma, telegram: null, order });
        } catch (deliveryErr) {
            const after = await prisma.order.findUnique({ where: { id: order.id } });
            if (after?.status === "CANCELED") {
                return res.status(409).json({
                    error: `Giao hàng thất bại: ${deliveryErr.message}`,
                    paymentAccepted: true,
                    orderId: order.id,
                    status: after.status,
                });
            }

            await prisma.order.updateMany({
                where: { id: order.id, status: "DELIVERING" },
                data: {
                    status: "PAID",
                    deliveryError: `user_api_delivery_failed:${deliveryErr.message}`.slice(0, 500),
                },
            }).catch(() => {});
            const pending = await prisma.order.findUnique({ where: { id: order.id } }).catch(() => after);
            return res.status(202).json({
                ok: true,
                paymentAccepted: true,
                processing: true,
                orderId: order.id,
                status: pending?.status || "PAID",
                message: "Đã nhận thanh toán, đơn đang chờ hệ thống giao lại hoặc admin xử lý",
            });
        }
        const delivered = await prisma.order.findUnique({ where: { id: order.id } });
        if (delivered?.status !== "DELIVERED") {
            return res.status(202).json({
                ok: true,
                paymentAccepted: true,
                processing: true,
                orderId: order.id,
                status: delivered?.status || "PAID",
                message: "Đã nhận thanh toán, đơn đang chờ hệ thống hoàn tất",
            });
        }

        res.json({
            ok: true,
            orderId: order.id,
            shortId: order.id.slice(-8).toUpperCase(),
            product: product.name,
            quantity: qty,
            amount: totalAmount,
            amountVnd: totalAmount,
            amountUsd: displayFinalUsd,
            usdVndRate,
            newBalance: purchase.newBalance,
            status: delivered.status,
            deliveryContent: delivered.deliveryContent || null,
        });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

/** GET /api/user/orders */
router.get("/orders", userAuth, async (req, res) => {
    try {
        const limit = Math.min(50, Number(req.query.limit) || 20);
        const orders = await prisma.order.findMany({
            where: { odelegramId: req.apiUser.telegramId },
            take: limit,
            orderBy: { createdAt: "desc" },
            include: { product: { select: { name: true } } },
        });
        res.json({ orders: orders.map(o => ({
            id: o.id, shortId: o.id.slice(-8).toUpperCase(),
            product: o.product?.name, quantity: o.quantity,
            amount: o.finalAmount, status: o.status, createdAt: o.createdAt,
        })) });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

/** GET /api/user/orders/:id */
router.get("/orders/:id", userAuth, async (req, res) => {
    try {
        const order = await prisma.order.findUnique({ where: { id: req.params.id }, include: { product: { select: { name: true, code: true, deliveryMode: true } } } });
        if (!order) return res.status(404).json({ error: "Không tìm thấy đơn" });
        if (order.odelegramId !== req.apiUser.telegramId) return res.status(403).json({ error: "Không có quyền" });
        const safeProduct = order.product
            ? { name: order.product.name, code: order.product.code, deliveryMode: order.product.deliveryMode }
            : null;
        const safeOrder = {
            ...order,
            product: safeProduct,
            deliveryContent: order.status === "DELIVERED" ? (order.deliveryContent || null) : null,
        };
        res.json({ order: safeOrder });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

export default router;
