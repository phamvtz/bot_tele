import { Router } from "express";
import { createHash, randomBytes } from "node:crypto";
import prisma from "./lib/prisma.js";
import { logAction } from "./audit.js";
import { autoEnableOnStock, invalidateStockCache, getStockCount } from "./inventory.js";
import { secretEquals } from "./lib/secret-compare.js";
import {
    createApiKey, getProfiles, getProfileConfig, getKeyStatus, listKeyStatusesCached,
    renewApiKey, setApiKeyEnabled, invalidateKeyStatusCache, isSafeApiKeyCreateFailure,
} from "./gpt2api.js";
import {
    parseTokenAmount, parseRpmAmount, parseDaysAmount, priceUsdForKey, keyPriceFactors,
    MIN_KEY_RPM, MAX_KEY_RPM, MIN_KEY_DAYS, MAX_KEY_DAYS,
} from "./apikey-pricing.js";
import { priceAddTokens, priceAddDays, keyLifecycle, classifyKeyStatus, renewability, toDisplayTokens } from "./apikey-renew.js";
import {
    KeySource, claimSellerKeySlot, finalizeSellerKeySlot, discardSellerKeySlot,
    getSellerIssuedKey, listSellerIssuedKeys, countSellerIssuedKeys,
    scanSellerIssuedKeysForStatus, claimSellerKeyRenew, releaseSellerKeyRenew,
    finalizeSellerKeyRenew, sellerUsageSince, namespacedClientRef, setIssuedKeyHidden,
    SELLER_STATUS_SCAN_MAX, SELLER_CLIENT_REF_MAX,
} from "./apikey-store.js";
import { summarizeDailySpend, summarizeUserDailySpend, DEFAULT_TZ_OFFSET_MINUTES, dayStartUtc, dayKey, dayRange } from "./spend-stats.js";
import { fetchSpendRows } from "./spend-store.js";
import { apiKeyMessage } from "./bot-ui/apikey-messages.js";
import { iconOf } from "./menu-config.js";
import { maskApiKey } from "./lib/mask-secret.js";
import { sellerDocsHtml } from "./seller-api-docs.js";

// Export lại để test và caller tìm thấy nó ở đúng chỗ mọi serializer khác của
// Seller API đang nằm. `export … from` một mình KHÔNG tạo binding cục bộ, nên
// dòng import ở trên là bắt buộc chứ không thừa.
export { maskApiKey };

// Instance bot — để `notify: true` gửi key thẳng cho khách qua Telegram. Cùng cơ chế
// với `setBotInstance` của api-routes.js: seller-api.js không import bot.js (bot.js
// là ngọn của cây import, kéo ngược sẽ vòng).
let _bot = null;
export function setSellerBotInstance(b) { _bot = b; }

const router = Router();
router.use((req, res, next) => { res.setHeader("Content-Type", "application/json"); next(); });

// ─── API Key helpers ──────────────────────────────────────────────────────────
async function getApiKeys() {
    const s = await prisma.setting.findUnique({ where: { key: "seller_api_keys" } });
    return s ? JSON.parse(s.value) : [];
}
async function saveApiKeys(keys) {
    await prisma.setting.upsert({
        where: { key: "seller_api_keys" },
        update: { value: JSON.stringify(keys) },
        create: { key: "seller_api_keys", value: JSON.stringify(keys) },
    });
}
export function generateApiKey() {
    return "sk_" + randomBytes(24).toString("hex");
}

// ─── Auth middleware ──────────────────────────────────────────────────────────
async function sellerAuth(req, res, next) {
    const auth = req.headers.authorization || "";
    const key = auth.startsWith("Bearer ") ? auth.slice(7) : req.headers["x-api-key"];
    if (!key) return res.status(401).json({ error: "API key required. Use: Authorization: Bearer sk_..." });
    const keys = await getApiKeys();
    // So sánh ở thời gian không đổi (M7). `k.key === key` thoát ra ở byte khác nhau
    // đầu tiên nên thời gian phản hồi rò rỉ độ dài prefix đúng, và endpoint này gọi
    // được từ internet bao nhiêu lần cũng được — đủ để dò key theo từng byte.
    // server.js và user-api.js đã dùng secretEquals; seller-api là chỗ sót lại.
    // secretEquals cũng trả false cho giá trị không phải chuỗi, nên header
    // `x-api-key` bị lặp (Node gộp thành mảng) không làm crash middleware.
    const found = keys.find((k) => secretEquals(k.key, key) && k.active !== false);
    if (!found) return res.status(401).json({ error: "Invalid or inactive API key" });
    req.apiKey = found;
    next();
}

// ─── Admin: manage keys ───────────────────────────────────────────────────────
// These routes are called from admin panel (already has adminAuth from parent router)
export const adminRouter = Router();

adminRouter.get("/keys", async (req, res) => {
    try {
        const keys = await getApiKeys();
        // Mask key — only show last 8 chars
        res.json({ keys: keys.map(k => ({ ...k, key: "sk_..." + k.key.slice(-8) })) });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

adminRouter.post("/keys", async (req, res) => {
    try {
        const { name } = req.body;
        if (!name?.trim()) return res.status(400).json({ error: "name bắt buộc" });
        const keys = await getApiKeys();
        const newKey = {
            id: randomBytes(8).toString("hex"),
            name: name.trim(),
            key: generateApiKey(),
            createdAt: new Date().toISOString(),
            active: true,
            // Trần cấp key theo ngày. 0 = không giới hạn (giữ hành vi cũ cho mọi key
            // đã tồn tại). POST /api/seller/keys tạo key THẬT tốn quota của shop, và
            // seller là bên thứ ba — một key bị lộ mà không có trần là một đường rút
            // quota không giới hạn. Đặt trần ngay lúc cấp key là mặc định an toàn hơn.
            ...readLimits(req.body),
        };
        keys.push(newKey);
        await saveApiKeys(keys);
        logAction("web-admin", "CREATE_API_KEY", newKey.id, {
            name: newKey.name, maxKeysPerDay: newKey.maxKeysPerDay, maxTokensPerDay: newKey.maxTokensPerDay,
        });
        res.json({ key: newKey }); // Return full key only on creation
    } catch (e) { res.status(500).json({ error: e.message }); }
});

/**
 * Đọc trần cấp key từ body. Không hợp lệ (âm, NaN, chuỗi) → 0 = không giới hạn,
 * ĐÚNG như key cũ chưa từng có hai field này. KHÔNG fallback về một con số có giới
 * hạn: đang từ "không chặn" sang "chặn" một cách âm thầm là đổi hành vi của seller
 * đang chạy mà không ai ra quyết định đó.
 */
function readLimits(body = {}) {
    const cap = (v) => {
        if (v === undefined || v === null || v === "") return 0;
        const n = Math.floor(Number(v));
        return Number.isFinite(n) && n > 0 ? n : 0;
    };
    return { maxKeysPerDay: cap(body.maxKeysPerDay), maxTokensPerDay: cap(body.maxTokensPerDay) };
}

/** PATCH /api/admin-react/seller-keys/keys/:id/limits — đổi trần cấp key. */
adminRouter.patch("/keys/:id/limits", async (req, res) => {
    try {
        const keys = await getApiKeys();
        const k = keys.find((x) => x.id === req.params.id);
        if (!k) return res.status(404).json({ error: "Key not found" });
        const limits = readLimits(req.body);
        k.maxKeysPerDay = limits.maxKeysPerDay;
        k.maxTokensPerDay = limits.maxTokensPerDay;
        await saveApiKeys(keys);
        logAction("web-admin", "UPDATE_API_KEY_LIMITS", k.id, { ...limits, name: k.name });
        res.json({ ok: true, ...limits });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

adminRouter.delete("/keys/:id", async (req, res) => {
    try {
        let keys = await getApiKeys();
        const before = keys.length;
        keys = keys.filter(k => k.id !== req.params.id);
        if (keys.length === before) return res.status(404).json({ error: "Key not found" });
        await saveApiKeys(keys);
        logAction("web-admin", "DELETE_API_KEY", req.params.id);
        res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

adminRouter.patch("/keys/:id/toggle", async (req, res) => {
    try {
        const keys = await getApiKeys();
        const k = keys.find(k => k.id === req.params.id);
        if (!k) return res.status(404).json({ error: "Key not found" });
        k.active = !k.active;
        await saveApiKeys(keys);
        res.json({ ok: true, active: k.active });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── Seller API endpoints ─────────────────────────────────────────────────────
router.use(sellerAuth);

/**
 * Order trả ra cho Seller API — WHITELIST field, KHÔNG BAO GIỜ spread cả document.
 *
 * Vì sao: `Order.deliveryContent` chứa payload ĐÃ GIAO. Với đơn API key đó là chuỗi
 * `sk-*` THẬT của khách (delivery.js ghi `{key, quotaTokens, rpm, ...}` vào đó); với
 * đơn STOCK_LINES đó là các dòng tài khoản/mật khẩu đã bán. Bên cạnh còn có
 * `odelegramId`, `chatId`, `userId`, `paymentRef`, `cryptoAddress`.
 *
 * Bản cũ của GET /orders/:id làm `res.json({ order: { ...order } })` — spread toàn
 * bộ. Nghĩa là bất kỳ ai giữ một key seller (chức năng của nó chỉ là NẠP HÀNG) đều
 * đọc được key API và tài khoản đã bán của MỌI khách: liệt kê id từ GET /orders
 * (limit 100/lần) rồi đọc từng cái. Một key supplier bị lộ = toàn bộ hàng shop đã
 * giao bị lộ, và hàng đó là hàng dùng được ngay, không thu hồi lại được.
 *
 * HAI endpoint phải dùng CHUNG hàm này. Mỗi chỗ tự chọn field là mỗi chỗ lệch nhau
 * được — lần sau thêm field vào một chỗ là chỗ kia tiếp tục rò.
 */
export function serializeOrderForSeller(order) {
    if (!order) return null;
    return {
        id: order.id,
        shortId: String(order.id || "").slice(-8).toUpperCase(),
        product: order.product?.name || order.productId,
        productId: order.productId,
        quantity: order.quantity,
        // `amount` giữ nguyên nghĩa cũ của endpoint danh sách (= finalAmount) để
        // không phá integration đang dùng.
        amount: order.finalAmount,
        currency: order.currency,
        status: order.status,
        paymentMethod: order.paymentMethod ?? null,
        createdAt: order.createdAt,
    };
}

/** GET /api/seller/products — list active products */
router.get("/products", async (req, res) => {
    try {
        const products = await prisma.product.findMany({
            where: { isActive: true },
            select: { id: true, name: true, price: true, currency: true, deliveryMode: true, description: true },
            orderBy: { createdAt: "desc" },
        });
        // Attach stock count for STOCK_LINES products — dùng getStockCount (cache 30s,
        // countDocuments) thay vì count trực tiếp mỗi lần để chịu được API bị poll dày.
        const result = await Promise.all(products.map(async (p) => {
            if (p.deliveryMode !== "STOCK_LINES") return { ...p, stock: null };
            const stock = await getStockCount(p.id).catch(() => 0);
            return { ...p, stock };
        }));
        res.json({ products: result });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// Shared logic for both /stock and /stock/text
async function handleAddStock(req, res, lines) {
    const { productId } = req.body;
    if (!productId) return res.status(400).json({ error: "productId bắt buộc" });
    const contents = lines.map(l => String(l).trim()).filter(Boolean);
    if (!contents.length) return res.status(400).json({ error: "Không có dòng hợp lệ" });
    const product = await prisma.product.findUnique({ where: { id: productId }, select: { id: true, name: true, deliveryMode: true } });
    if (!product) return res.status(404).json({ error: "Không tìm thấy sản phẩm" });
    if (product.deliveryMode !== "STOCK_LINES") return res.status(400).json({ error: "Sản phẩm không dùng chế độ STOCK_LINES" });
    const result = await prisma.stockItem.createMany({ data: contents.map(content => ({ productId, content })) });
    invalidateStockCache(productId);
    await autoEnableOnStock(productId);
    const currentStock = await prisma.stockItem.count({ where: { productId, isSold: false } });
    logAction(req.apiKey.name || req.apiKey.id, "SELLER_ADD_STOCK", productId, { count: result.count });
    res.json({ ok: true, added: result.count, totalStock: currentStock, product: product.name });
}

/** POST /api/seller/stock — upload stock lines (JSON array) */
router.post("/stock", async (req, res) => {
    try {
        const { lines } = req.body;
        if (!Array.isArray(lines) || !lines.length) return res.status(400).json({ error: "lines phải là mảng không rỗng" });
        await handleAddStock(req, res, lines);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

/** POST /api/seller/stock/text — upload stock as plain text (one line per row) */
router.post("/stock/text", async (req, res) => {
    try {
        const { text } = req.body;
        if (!text) return res.status(400).json({ error: "text bắt buộc" });
        await handleAddStock(req, res, String(text).split("\n"));
    } catch (e) { res.status(500).json({ error: e.message }); }
});

/** GET /api/seller/orders — recent orders */
router.get("/orders", async (req, res) => {
    try {
        const status = req.query.status || "";
        const limit = Math.min(100, Number(req.query.limit) || 20);
        const where = {};
        if (status) where.status = status;
        const orders = await prisma.order.findMany({
            where,
            take: limit,
            orderBy: { createdAt: "desc" },
            include: { product: { select: { id: true, name: true } } },
        });
        res.json({ orders: orders.map((o) => serializeOrderForSeller(o)) });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

/** GET /api/seller/orders/:id */
router.get("/orders/:id", async (req, res) => {
    try {
        const order = await prisma.order.findUnique({
            where: { id: req.params.id },
            include: { product: { select: { id: true, name: true } } },
        });
        if (!order) return res.status(404).json({ error: "Không tìm thấy đơn hàng" });
        // KHÔNG spread `order`: xem serializeOrderForSeller.
        res.json({ order: serializeOrderForSeller(order) });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

/** GET /api/seller/stats — basic shop stats */
router.get("/stats", async (req, res) => {
    try {
        const [totalOrders, pendingOrders, totalProducts, myKeys] = await Promise.all([
            prisma.order.count({ where: { status: { in: ["PAID", "DELIVERED"] } } }),
            prisma.order.count({ where: { status: "PENDING" } }),
            prisma.product.count({ where: { isActive: true } }),
            countSellerIssuedKeys(req.apiKey.id),
        ]);
        // `myKeys` = key do CHÍNH API key này cấp. Không đếm lẫn key của shop hay
        // của seller khác — con số đó không phải việc của họ.
        res.json({ totalOrders, pendingOrders, totalProducts, myKeys });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── Seller Key API: tạo & quản lý key sk-* ───────────────────────────────────
//
// Seller là BÊN THỨ BA giữ một API key, không phải admin bảng web. Ba nguyên tắc
// rút ra từ chính lỗ hổng đã sửa ở serializeOrderForSeller:
//
//   1. WHITELIST field trả ra. Không bao giờ spread một document.
//   2. Chuỗi `sk-*` chỉ được trả về ĐÚNG MỘT LẦN, trong response của POST /keys.
//      List/detail trả bản che. Một request GET gọi lại được bao nhiêu lần cũng
//      không được trở thành cách đọc lại kho key: lộ một bản log hay một response
//      cache là lộ toàn bộ key đang sống của khách.
//   3. Scope theo `req.apiKey.id`. Seller A không thấy, không sửa được key của
//      seller B hay key shop tự cấp.
//
// `telegramId` trong response key KHÔNG phải rò rỉ: chính seller gửi nó lên lúc tạo
// key. Khác với `odelegramId` của Order (khách của SHOP — supplier không có lý do gì
// biết), nên endpoint thống kê chi tiêu bên dưới vẫn phải ẩn danh người mua.

/**
 * Số liệu SỐNG của một key, whitelist.
 *
 * `liveOk: false` (không đọc được provider) thì trả `live: false, status: "unknown"`
 * chứ KHÔNG suy ra "missing". admin đã xoá key và mạng đang hỏng là hai chuyện khác
 * nhau hoàn toàn, và seller đọc nhầm cái sau thành cái trước sẽ đi cấp lại key cho
 * khách đang dùng tốt.
 */
export function liveKeyViewForSeller(st, row, now, quotaRefPrice, liveOk) {
    if (!liveOk || !st) {
        // Không có số liệu provider thì vẫn suy được trục THỜI GIAN từ mốc đã lưu —
        // có còn hơn không, nhưng phải nói rõ là không có quota.
        const expMs = row?.expiresAt ? new Date(row.expiresAt).getTime() : null;
        const expired = expMs !== null && Number.isFinite(expMs) && expMs <= now;
        return {
            live: false,
            status: expired ? "expired" : "unknown",
            usedPct: null, daysLeft: expired ? 0 : null,
            unlimitedQuota: null, enabled: null,
            quotaTokensLive: null, usedTokensLive: null,
        };
    }
    const expiresAt = st.expiresAt ?? row?.expiresAt ?? null;
    const life = keyLifecycle({ ...st, expiresAt }, now);
    const hasQuota = st.quotaLimit > 0;
    return {
        live: true,
        status: classifyKeyStatus(life, { enabled: st.enabled }),
        // quota_limit = 0 là VÔ HẠN trên provider, không phải "0 token". Trả null
        // thay vì 0 để client không hiện "còn 0 token" cho một key không giới hạn.
        quotaTokensLive: hasQuota ? toDisplayTokens(st.quotaLimit, quotaRefPrice) : null,
        usedTokensLive: hasQuota ? toDisplayTokens(st.quotaUsed, quotaRefPrice) : null,
        usedPct: hasQuota ? Math.round(life.usedPct) : null,
        unlimitedQuota: life.unlimitedQuota,
        daysLeft: life.daysLeft === null ? null : Math.ceil(life.daysLeft),
        expiresAtLive: st.expiresAt || null,
        enabled: st.enabled !== false,
        lastUsedAt: st.lastUsedAt || null,
        rpmLive: st.rpm, effectiveRpm: st.effectiveRpm,
        renewability: renewability({ quotaLimit: st.quotaLimit, expiresAt }),
    };
}

/** Key trả ra cho seller — whitelist, không spread. */
export function serializeKeyForSeller(row, { live = null, revealKey = false } = {}) {
    if (!row) return null;
    const out = {
        id: row.id,
        key: revealKey ? (row.key || null) : maskApiKey(row.key),
        keyRevealed: !!revealKey,
        // `pending: true` = đã giữ chỗ nhưng provider chưa trả key (hoặc process chết
        // giữa chừng). Seller cần phân biệt được với "key đã cấp" để không báo khách.
        pending: !row.key,
        telegramId: row.telegramId ? String(row.telegramId) : null,
        quotaTokens: Number(row.quotaTokens) || 0,
        rpm: Number(row.rpm) || 0,
        models: Array.isArray(row.models) ? row.models : [],
        profileId: row.profileId ?? null,
        profileName: row.profileName || "",
        expiresAt: row.expiresAt || null,
        renewCount: Number(row.renewCount) || 0,
        lastRenewAt: row.lastRenewAt || null,
        createdAt: row.createdAt || null,
        hidden: !!row.hiddenAt,
    };
    if (live) out.live = live;
    return out;
}

/**
 * Ẩn danh `odelegramId` cho endpoint thống kê của seller.
 *
 * HMAC chứ không phải sha256 trần: telegramId chỉ ~10 chữ số, một GPU băm hết
 * không gian đó trong khoảng một giây, nên hash không khoá = ẩn danh trang trí.
 * Khoá là `USER_API_SECRET` của MÁY CHỦ — seller không có nó thì không dò ngược được.
 * Hệ quả: cùng một khách ra HAI mã khác nhau với hai seller khác nhau, và không đổi
 * được sang `sellerKeyId` khác (đổi seller key là mất khả năng nối chuỗi cũ — chấp
 * nhận được, đó là mặt trái của việc không cho họ biết ai là ai).
 */
export function pseudonymizeUser(sellerKeyId, telegramId, secret) {
    const id = String(telegramId ?? "").trim();
    if (!id) return null;
    const key = String(secret || "");
    if (!key) return null;
    const mac = createHash("sha256").update(`${key}|${sellerKeyId || ""}|${id}`).digest("hex");
    return `u_${mac.slice(0, 20)}`;
}

/**
 * Đọc clientRef từ body. Quá dài thì BÁO LỖI chứ không cắt.
 *
 * `namespacedClientRef` có cắt ở 120 ký tự làm lưới an toàn, nhưng im lặng dùng bản
 * cắt là một lỗi khó thấy nhất có thể: hai clientRef khác nhau quá 120 ký tự ra cùng
 * một giá trị, request thứ hai nhận `duplicate: true` kèm một key đã che, và seller
 * không bao giờ có key cho khách mà cũng không nhận được lỗi nào.
 */
function readClientRef(body = {}) {
    const ref = body.clientRef == null ? "" : String(body.clientRef).trim();
    if (ref.length > SELLER_CLIENT_REF_MAX) {
        return { ref: null, error: `clientRef tối đa ${SELLER_CLIENT_REF_MAX} ký tự` };
    }
    return { ref, error: null };
}

/** Trần cấp key theo ngày của MỘT seller key. 0 / thiếu = không giới hạn. */function sellerLimits(apiKey = {}) {
    const intOr0 = (v) => {
        const n = Math.floor(Number(v));
        return Number.isFinite(n) && n > 0 ? n : 0;
    };
    return { maxKeysPerDay: intOr0(apiKey.maxKeysPerDay), maxTokensPerDay: intOr0(apiKey.maxTokensPerDay) };
}

/** Cấu hình server, chỉ trả những gì seller được phép biết. */
function publicProfileView(p) {
    return {
        profileId: p.profileId ?? null,
        name: p.profileName || "",
        enabled: p.enabled !== false && p.shopEnabled !== false,
        configured: !!p.configured,
        usdPerMtoken: Number(p.usdPerMtoken) || 0,
        maxBuyTokens: Number(p.maxBuyTokens) || 0,
        defaultRpm: Number(p.rpm) || 0,
        defaultValidDays: Number(p.validDays) || 0,
        rpmPresets: Array.isArray(p.rpmPresets) ? p.rpmPresets : [],
        daysPresets: Array.isArray(p.daysPresets) ? p.daysPresets : [],
        models: Array.isArray(p.models) ? p.models : [],
        // base / adminToken / userId / fallbackGroups CỐ TÌNH không có ở đây.
        endpoint: p.endpoint || "",
        usageUrl: p.usageUrl || "",
        docUrl: p.docUrl || "",
    };
}

/** GET /api/seller/profiles — các "server" đang mở bán, kèm giới hạn + đơn giá. */
router.get("/profiles", async (req, res) => {
    try {
        const profiles = await getProfiles();
        res.json({ profiles: profiles.map(publicProfileView) });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

/**
 * POST /api/seller/keys — cấp một key sk-* THẬT. Tốn quota của shop.
 *
 * Body: `{ telegramId?, tokens, rpm?, validDays?, profileId?, clientRef?, notify?, name? }`
 *   - `telegramId` bỏ trống = key không thuộc khách nào của bot, chỉ quản lý qua
 *     Seller API. Có giá trị hợp lệ thì key hiện trong `/mykey` của người đó.
 *   - `clientRef` là khoá idempotency. Client NÊN gửi: retry sau timeout mà không có
 *     nó thì mỗi lần retry là một key thật nữa được tạo ra.
 *
 * Trả chuỗi `key` đầy đủ ĐÚNG MỘT LẦN ở đây.
 */
router.post("/keys", async (req, res) => {
    try {
        const b = req.body || {};
        const rawTelegramId = b.telegramId == null ? "" : String(b.telegramId).trim();
        const { ref: clientRef, error: refError } = readClientRef(b);
        if (refError) return res.status(400).json({ error: refError, code: "client_ref_too_long" });
        const notify = b.notify === true;
        const profileId = (b.profileId === undefined || b.profileId === null || b.profileId === "")
            ? null : (Math.floor(Number(b.profileId)) || null);

        if (rawTelegramId && !/^\d{3,}$/.test(rawTelegramId)) {
            return res.status(400).json({ error: "telegramId phải là chuỗi chữ số (>= 3 ký tự), hoặc bỏ trống" });
        }

        const cfg = await getProfileConfig(profileId);
        if (!cfg.configured) return res.status(400).json({ error: "Shop chưa cấu hình GPT2API" });

        const parsedTokens = parseTokenAmount(b.tokens, { min: 1, max: Number(cfg.maxBuyTokens) || undefined });
        if (!parsedTokens.ok) {
            return res.status(400).json({
                error: `tokens không hợp lệ (${parsedTokens.error})`,
                min: parsedTokens.min ?? 1, max: parsedTokens.max ?? null,
            });
        }
        const tokens = parsedTokens.tokens;

        // rpm / validDays bỏ trống = dùng mặc định của server. Chỉ validate khi có gửi.
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

        // ── Trần theo ngày ──────────────────────────────────────────────────────
        // Đọc-rồi-kiểm nên HAI request song song vẫn có thể cùng lọt qua. Đây là rào
        // chống lạm dụng, không phải bất biến tài chính — bất biến "không cấp trùng"
        // là ở `clientRef` unique index bên dưới. Nói rõ để không ai tưởng cái này
        // là chốt chặn tuyệt đối.
        const { maxKeysPerDay, maxTokensPerDay } = sellerLimits(req.apiKey);
        if (maxKeysPerDay || maxTokensPerDay) {
            const since = dayStartUtc(dayKey(new Date(), DEFAULT_TZ_OFFSET_MINUTES), DEFAULT_TZ_OFFSET_MINUTES);
            const used = await sellerUsageSince(req.apiKey.id, since);
            if (maxKeysPerDay && used.keys + 1 > maxKeysPerDay) {
                return res.status(429).json({ error: `Vượt trần ${maxKeysPerDay} key/ngày`, usedToday: used.keys, limit: maxKeysPerDay });
            }
            if (maxTokensPerDay && used.tokens + tokens > maxTokensPerDay) {
                return res.status(429).json({ error: `Vượt trần ${maxTokensPerDay} token/ngày`, usedToday: used.tokens, limit: maxTokensPerDay });
            }
        }

        // ── Giữ chỗ TRƯỚC khi gọi provider ───────────────────────────────────────
        // Insert ăn unique index của clientRef = claim atomic. Hai request cùng
        // clientRef thì chỉ một cái tới được createApiKey.
        const claim = await claimSellerKeySlot({
            telegramId: rawTelegramId || "",
            quotaTokens: tokens,
            sellerKeyId: req.apiKey.id,
            sellerKeyName: req.apiKey.name,
            clientRef: clientRef || null,
            profileId,
        });
        if (!claim.claimed) {
            const row = claim.row;
            // Đã có request khác làm rồi. KHÔNG trả lại key đầy đủ: đây là một GET
            // trá hình, và client đã nhận key ở lần gọi đầu.
            logAction(req.apiKey.name || req.apiKey.id, "SELLER_KEY_DUPLICATE", row?.id || clientRef, { clientRef });
            return res.status(200).json({
                ok: true, duplicate: true,
                id: row?.id || null,
                key: maskApiKey(row?.key),
                pending: !row?.key,
                note: "clientRef này đã được dùng. Key đầy đủ chỉ trả về ở lần tạo đầu tiên.",
            });
        }

        const created = await createApiKey({
            quotaTokens: tokens,
            name: String(b.name || "").trim().slice(0, 60) || `seller-${req.apiKey.name || req.apiKey.id}-${Date.now()}`,
            rpm: rpm > 0 ? rpm : undefined,
            validDays: validDays === null ? undefined : validDays,
            profileId,
            // CỐ TÌNH false, khác với nút cấp key thủ công của admin. Seller tạo key
            // là MỘT LẦN BÁN MỚI, nên công tắc "ngừng bán" của server phải có tác
            // dụng; admin chọn server đang tắt là một quyết định có chủ ý, seller thì không.
            allowDisabledProfile: false,
        });

        if (!created.ok) {
            const safe = isSafeApiKeyCreateFailure(created);
            if (safe) {
                // Chưa có gì xảy ra phía provider → xoá chỗ giữ, seller thử lại được.
                await discardSellerKeySlot(claim.row.id).catch(() => {});
                return res.status(created.code === "disabled" ? 409 : 502).json({
                    error: created.message || "GPT2API từ chối tạo key", code: created.code, retryable: true,
                });
            }
            // Provider CÓ THỂ đã tạo key. Giữ lại dòng (vẫn ẩn) làm dấu vết để đối
            // soát — xoá đi là mất luôn manh mối duy nhất.
            await prisma.issuedApiKey.update({
                where: { id: claim.row.id },
                data: { wipError: `${created.code || "unknown"}: ${created.message || ""}`.slice(0, 300) },
            }).catch(() => {});
            logAction(req.apiKey.name || req.apiKey.id, "SELLER_KEY_AMBIGUOUS", claim.row.id, { code: created.code, clientRef });
            return res.status(502).json({
                error: created.message || "Không xác định được key đã được tạo hay chưa",
                code: created.code,
                retryable: false,
                reconcileId: claim.row.id,
                note: "Yêu cầu có thể đã tạo key phía nhà cung cấp. ĐỪNG retry bằng clientRef khác — gửi lại đúng clientRef này, hoặc báo shop đối soát reconcileId.",
            });
        }

        const expiresAt = created.expiresAt
            || (validDays ? new Date(Date.now() + validDays * 86_400_000).toISOString() : null);
        const priceUsd = priceUsdForKey({ tokens, rpm: rpm || cfg.rpm, validDays: validDays ?? cfg.validDays }, cfg.usdPerMtoken, cfg);

        const saved = await finalizeSellerKeySlot(claim.row.id, {
            key: created.key,
            externalId: created.id,
            expiresAt,
            quotaTokens: tokens,
            rpm: rpm || cfg.rpm || 0,
            models: cfg.models || [],
            profileId: created.profileId ?? cfg.profileId ?? null,
            profileName: created.profileName || cfg.profileName || "",
            priceUsd,
        });
        invalidateKeyStatusCache();
        logAction(req.apiKey.name || req.apiKey.id, "SELLER_CREATE_KEY", saved?.id || claim.row.id, {
            telegramId: rawTelegramId || null, tokens, rpm, validDays, profile: created.profileName || cfg.profileName || "",
            externalId: created.id, priceUsd, clientRef: clientRef || null,
        });

        let notified = false;
        if (notify && rawTelegramId && _bot?.telegram) {
            try {
                await _bot.telegram.sendMessage(rawTelegramId, apiKeyMessage({
                    key: created.key, quotaTokens: tokens, rpm: rpm || cfg.rpm || 0,
                    models: cfg.models || [], endpoint: cfg.endpoint, usageUrl: cfg.usageUrl,
                    mykeyCommand: "/mykey", kind: "buy", expiresAt, lang: "vi", icon: iconOf,
                }), { parse_mode: "HTML" });
                notified = true;
            } catch (e) { console.error("[seller-api] notify fail:", e.message); }
        }

        res.json({
            ok: true,
            id: saved?.id || claim.row.id,
            // Lần DUY NHẤT chuỗi thật được trả về.
            key: created.key,
            keyMasked: maskApiKey(created.key),
            externalId: created.id || null,
            telegramId: rawTelegramId || null,
            quotaTokens: tokens,
            rpm: rpm || cfg.rpm || 0,
            validDays: validDays ?? cfg.validDays ?? 0,
            expiresAt,
            profileId: created.profileId ?? cfg.profileId ?? null,
            profileName: created.profileName || cfg.profileName || "",
            models: cfg.models || [],
            endpoint: cfg.endpoint || "",
            usageUrl: cfg.usageUrl || "",
            priceUsd,
            notified,
            notifySkipped: notify && !notified ? (!rawTelegramId ? "no_telegram_id" : "send_failed") : null,
        });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

/** GET /api/seller/keys — key do CHÍNH seller này cấp. Không trả chuỗi sk-* thật. */
router.get("/keys", async (req, res) => {
    try {
        const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 50));
        const page = Math.max(1, Number(req.query.page) || 1);
        // `live=0` để bỏ qua việc gọi provider — client chỉ cần danh sách thì đỡ 4
        // request HTTP mỗi lần phân trang.
        const wantLive = String(req.query.live ?? "1") !== "0";

        const [rows, total] = await Promise.all([
            listSellerIssuedKeys({ sellerKeyId: req.apiKey.id, limit, skip: (page - 1) * limit }),
            countSellerIssuedKeys(req.apiKey.id),
        ]);

        let liveOk = false;
        let statusById = new Map();
        const cfgByProfile = new Map();
        if (wantLive && rows.length) {
            // Key có thể nằm trên nhiều server, mỗi server một lần đọc (có cache 60s).
            const profileIds = [...new Set(rows.map((r) => r.profileId ?? null))];
            const results = await Promise.all(profileIds.map(async (pid) => {
                const [st, cfg] = await Promise.all([listKeyStatusesCached(pid), getProfileConfig(pid)]);
                return { pid, st, cfg };
            }));
            for (const { pid, st, cfg } of results) {
                cfgByProfile.set(String(pid ?? ""), cfg);
                if (st?.ok) {
                    liveOk = true;
                    for (const [k, v] of st.byId || new Map()) statusById.set(k, v);
                }
            }
            // Chỉ một server đọc hỏng thì liveOk vẫn true nhờ server kia, nhưng key
            // của server hỏng sẽ ra status "unknown" — đúng hơn là báo cả bảng hỏng.
        }

        const now = Date.now();
        res.json({
            keys: rows.map((r) => serializeKeyForSeller(r, {
                live: wantLive ? liveKeyViewForSeller(statusById.get(r.externalId), r, now, cfgByProfile.get(String(r.profileId ?? ""))?.quotaRefPrice, liveOk) : null,
            })),
            page, limit, total,
            pages: Math.max(1, Math.ceil(total / limit)),
            liveOk: wantLive ? liveOk : null,
        });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

/** GET /api/seller/keys/:id — chi tiết MỘT key, đọc số liệu sống trực tiếp. */
router.get("/keys/:id", async (req, res) => {
    try {
        const row = await getSellerIssuedKey(req.params.id, req.apiKey.id);
        if (!row) return res.status(404).json({ error: "Không tìm thấy key (hoặc key không thuộc API key này)" });

        const cfg = await getProfileConfig(row.profileId);
        let st = null;
        let liveOk = false;
        if (row.externalId) {
            const r = await getKeyStatus(row.externalId, row.profileId);
            liveOk = !!r?.ok;
            st = r?.ok ? r : null;
        }
        res.json({
            key: serializeKeyForSeller(row, {
                live: liveKeyViewForSeller(st, row, Date.now(), cfg.quotaRefPrice, liveOk),
            }),
            endpoint: cfg.endpoint || "",
            usageUrl: cfg.usageUrl || "",
        });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

/**
 * PATCH /api/seller/keys/:id — gia hạn: `{ addTokens?, addDays?, clientRef? }`.
 *
 * `quota_limit` bên provider là số TUYỆT ĐỐI và `renewApiKey` đọc-rồi-cộng, nên chạy
 * hai lần là tặng khách thêm một lần token. Hai lớp chặn:
 *   - `clientRef` trùng với `lastRenewRef` → trả lại kết quả cũ, KHÔNG gọi provider.
 *   - claim atomic `renewWipAt: null` → hai request song song chỉ một cái qua.
 * Process chết giữa PATCH và finalize thì cờ WIP Ở LẠI và mọi lần sau nhận 409 —
 * cố ý. Tự nhả cờ là tự chọn "có thể cấp trùng quota" thay cho "admin phải đối soát".
 */
router.patch("/keys/:id", async (req, res) => {
    try {
        const b = req.body || {};
        const row = await getSellerIssuedKey(req.params.id, req.apiKey.id);
        if (!row) return res.status(404).json({ error: "Không tìm thấy key (hoặc key không thuộc API key này)" });
        if (!row.externalId) return res.status(409).json({ error: "Key này không có id phía nhà cung cấp nên không gia hạn được" });

        const addTokens = Math.max(0, Math.floor(Number(b.addTokens) || 0));
        const addDays = Math.max(0, Math.floor(Number(b.addDays) || 0));
        if (!addTokens && !addDays) return res.status(400).json({ error: "Cần addTokens hoặc addDays > 0" });

        const { ref: clientRef, error: refError } = readClientRef(b);
        if (refError) return res.status(400).json({ error: refError, code: "client_ref_too_long" });
        const renewRef = clientRef ? namespacedClientRef(req.apiKey.id, clientRef) : null;

        // Đã làm đúng lượt này rồi → trả biên nhận cũ.
        if (renewRef && row.lastRenewRef === renewRef) {
            return res.status(200).json({
                ok: true, duplicate: true, id: row.id,
                quotaTokens: Number(row.quotaTokens) || 0,
                expiresAt: row.expiresAt || null,
                renewCount: Number(row.renewCount) || 0,
                note: "clientRef này đã được gia hạn. Không gọi lại nhà cung cấp.",
            });
        }

        const cfg = await getProfileConfig(row.profileId);
        if (addTokens > 0) {
            const p = parseTokenAmount(addTokens, { min: 1, max: Number(cfg.maxBuyTokens) || undefined });
            if (!p.ok) return res.status(400).json({ error: `addTokens không hợp lệ (${p.error})`, min: p.min, max: p.max });
        }
        if (addDays > (MAX_KEY_DAYS)) return res.status(400).json({ error: `addDays vượt ${MAX_KEY_DAYS}` });

        if (row.renewWipAt) {
            return res.status(409).json({
                error: "Có một lượt gia hạn chưa chốt kết quả",
                code: "renew_in_progress",
                retryable: false,
                renewWipAt: row.renewWipAt,
                note: "Không tự retry: lượt trước có thể đã cộng quota phía nhà cung cấp. Gửi lại đúng clientRef cũ, hoặc báo shop đối soát.",
            });
        }

        const claimed = await claimSellerKeyRenew(row.id, req.apiKey.id, renewRef);
        if (!claimed) {
            return res.status(409).json({ error: "Có một lượt gia hạn chưa chốt kết quả", code: "renew_in_progress", retryable: false });
        }

        let result;
        try {
            result = await renewApiKey({ externalId: row.externalId, addTokens, addDays, profileId: row.profileId });
        } catch (err) {
            // Lỗi NÉM RA (không phải result.ok=false) — không biết PATCH đã bay đi
            // chưa. GIỮ cờ WIP để không ai cộng lần hai.
            logAction(req.apiKey.name || req.apiKey.id, "SELLER_RENEW_AMBIGUOUS", row.id, { error: err.message, clientRef });
            return res.status(502).json({
                error: err.message, code: "network", retryable: false,
                note: "Không xác định được đã gia hạn hay chưa. ĐỪNG retry — báo shop đối soát key này.",
            });
        }

        if (!result.ok) {
            // key_not_found / not_configured / nothing_to_renew: chắc chắn chưa PATCH
            // → nhả cờ cho lần sau. Mọi mã khác (quota_not_applied, expiry_not_applied,
            // network, 5xx): CÓ THỂ đã cộng một phần → GIỮ cờ, admin đối soát.
            const safeToRelease = ["key_not_found", "not_configured", "nothing_to_renew", "no_external_id"]
                .includes(String(result.code ?? "").toLowerCase());
            if (safeToRelease) await releaseSellerKeyRenew(row.id).catch(() => {});
            else logAction(req.apiKey.name || req.apiKey.id, "SELLER_RENEW_AMBIGUOUS", row.id, { code: result.code, clientRef });
            return res.status(safeToRelease ? 409 : 502).json({
                error: result.message || "Gia hạn thất bại",
                code: result.code,
                retryable: safeToRelease,
                renewBlocked: !safeToRelease,
            });
        }

        const quotaTokens = result.after?.quotaLimit > 0
            ? toDisplayTokens(result.after.quotaLimit, result.quotaRefPrice ?? cfg.quotaRefPrice)
            : 0;
        const saved = await finalizeSellerKeyRenew(row.id, {
            quotaTokens,
            expiresAt: result.after?.expiresAt ?? null,
            renewRef,
        }).catch((e) => {
            // Provider ĐÃ gia hạn, chỉ có DB local lỗi. Không được PATCH lần hai —
            // ghi dấu để admin đồng bộ lại, và vẫn báo thành công cho seller vì
            // phía khách hàng thì key đã có thêm quota thật.
            console.error("[seller-api] finalize renew failed:", e.message);
            logAction(req.apiKey.name || req.apiKey.id, "SELLER_RENEW_STORE_SYNC_FAILED", row.id, { error: e.message });
            return null;
        });
        invalidateKeyStatusCache();

        const factors = (o) => keyPriceFactors(o, cfg);
        const valueUsd = priceAddTokens(addTokens, { usdPerMtoken: cfg.usdPerMtoken, rpm: row.rpm, factors })
            + priceAddDays(addDays, {
                keyTokens: toDisplayTokens(result.before?.quotaLimit || 0, result.quotaRefPrice ?? cfg.quotaRefPrice),
                usdPerMtoken: cfg.usdPerMtoken, rpm: row.rpm, factors,
            });
        logAction(req.apiKey.name || req.apiKey.id, "SELLER_RENEW_KEY", row.id, { addTokens, addDays, valueUsd, clientRef: clientRef || null });

        res.json({
            ok: true,
            id: row.id,
            addTokens, addDays,
            before: { quotaLimit: result.before?.quotaLimit ?? null, expiresAt: result.before?.expiresAt ?? null },
            after: { quotaLimit: result.after?.quotaLimit ?? null, expiresAt: result.after?.expiresAt ?? null },
            quotaTokens,
            renewCount: saved ? (Number(saved.renewCount) || 0) : (Number(row.renewCount) || 0) + 1,
            valueUsd: Math.round(valueUsd * 100) / 100,
            storeSyncFailed: !saved,
        });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

/** PATCH /api/seller/keys/:id/enabled — `{ enabled: bool }`. Tắt/mở key, không xoá. */
router.patch("/keys/:id/enabled", async (req, res) => {
    try {
        const row = await getSellerIssuedKey(req.params.id, req.apiKey.id);
        if (!row) return res.status(404).json({ error: "Không tìm thấy key (hoặc key không thuộc API key này)" });
        if (!row.externalId) return res.status(409).json({ error: "Key này không có id phía nhà cung cấp" });
        const want = req.body?.enabled !== false;

        const r = await setApiKeyEnabled({ externalId: row.externalId, enabled: want, profileId: row.profileId });
        if (!r.ok) return res.status(502).json({ error: r.message || "Nhà cung cấp từ chối", code: r.code });
        invalidateKeyStatusCache();
        logAction(req.apiKey.name || req.apiKey.id, want ? "SELLER_ENABLE_KEY" : "SELLER_DISABLE_KEY", row.id, { externalId: row.externalId });
        // `enabled` lấy từ giá trị provider ĐANG giữ, không phải từ request.
        res.json({ ok: true, id: row.id, enabled: r.enabled });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

/**
 * DELETE /api/seller/keys/:id — thu hồi.
 *
 * `?revoke=true` (mặc định) tắt key phía provider rồi ẩn khỏi `/mykey`.
 * `?revoke=false` chỉ ẩn phía shop, key VẪN DÙNG ĐƯỢC — dành cho trường hợp seller
 * không muốn bán cho khách này nữa nhưng không muốn cắt giữa chừng.
 *
 * KHÔNG xoá document: `IssuedApiKey` là sổ doanh thu (`priceUsd`) và là nguồn cho
 * job nhắc hết hạn. Xoá đi là mất dấu vết một key đã từng tồn tại.
 */
router.delete("/keys/:id", async (req, res) => {
    try {
        const row = await getSellerIssuedKey(req.params.id, req.apiKey.id);
        if (!row) return res.status(404).json({ error: "Không tìm thấy key (hoặc key không thuộc API key này)" });
        const revoke = String(req.query.revoke ?? "true") !== "false";

        let providerRevoked = false;
        if (revoke) {
            if (!row.externalId) {
                return res.status(409).json({ error: "Key không có id phía nhà cung cấp nên không thu hồi được — chỉ có thể ẩn", code: "no_external_id" });
            }
            const r = await setApiKeyEnabled({ externalId: row.externalId, enabled: false, profileId: row.profileId });
            if (!r.ok) return res.status(502).json({ error: r.message || "Nhà cung cấp từ chối thu hồi", code: r.code });
            providerRevoked = r.enabled === false;
            invalidateKeyStatusCache();
        }
        await setIssuedKeyHidden(row.id, true);
        logAction(req.apiKey.name || req.apiKey.id, "SELLER_REVOKE_KEY", row.id, { revoke, providerRevoked });

        res.json({
            ok: true, id: row.id,
            providerRevoked,
            hiddenFromMykey: true,
            // Nói thẳng khi key vẫn còn sống — để seller không tưởng đã cắt mà khách
            // vẫn đang gọi được.
            stillUsable: !providerRevoked,
        });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

/**
 * GET /api/seller/stats/users/daily — mỗi khách tiêu bao nhiêu mỗi ngày.
 *
 * `?days=30` (1–366) · `?user=u_xxx` (một khách) · `?top=20` (1–500).
 *
 * ⚠️ `telegramId` THẬT không bao giờ ra khỏi endpoint này — nó được HMAC thành
 * `u_xxx` (xem pseudonymizeUser). `/orders` cho seller thấy doanh thu từng đơn là
 * chuyện đã có từ trước; nhưng ghép doanh thu đó với DANH TÍNH khách của shop là
 * một mức rò rỉ khác hẳn và seller không có lý do gì cần nó. Đây là cùng một bài
 * học với serializeOrderForSeller, áp dụng cho một loại dữ liệu khác.
 */
router.get("/stats/users/daily", async (req, res) => {
    try {
        const secret = String(process.env.USER_API_SECRET || "").trim();
        if (!secret) {
            // Thà từ chối còn hơn trả telegramId trần: thiếu secret mà vẫn chạy thì
            // "ẩn danh" chỉ là nhãn, không phải tính chất.
            return res.status(503).json({
                error: "Chưa cấu hình USER_API_SECRET nên không ẩn danh được người mua",
                code: "no_pseudonym_secret",
            });
        }
        const days = Math.min(366, Math.max(1, Number(req.query.days) || 30));
        const top = Math.min(500, Math.max(1, Number(req.query.top) || 20));
        const userParam = String(req.query.user || "").trim();

        let filterUser = null;
        if (userParam) {
            // Chỉ nhận MÃ u_xxx, không nhận telegramId thô — endpoint này không giúp
            // ai dò ngược từ id thật sang mã.
            if (!/^u_[0-9a-f]{20}$/.test(userParam)) {
                return res.status(400).json({ error: "user phải là mã u_... lấy từ chính endpoint này" });
            }
            filterUser = userParam;
        }

        const { rows, truncated, scanned } = await fetchSpendRows({
            days, label: "đơn hàng thống kê chi tiêu (seller)",
        });

        // Mã hoá MỘT lần cho mọi telegramId xuất hiện, rồi mới gộp — hai hàm gộp
        // phải nhìn cùng một tập, không thì tổng theo ngày và bảng xếp hạng lệch nhau.
        const pseudonymOf = new Map();
        for (const r of rows) {
            const uid = r.odelegramId == null ? "" : String(r.odelegramId);
            if (uid && !pseudonymOf.has(uid)) pseudonymOf.set(uid, pseudonymizeUser(req.apiKey.id, uid, secret));
        }
        const rename = (u) => ({ ...u, telegramId: null, user: pseudonymOf.get(u.telegramId) || null });

        const summary = summarizeDailySpend(rows, { days, topUsers: filterUser ? 500 : top });

        let topUsers = summary.topUsers.map(rename);
        let selected = null;
        if (filterUser) {
            const real = [...pseudonymOf.entries()].find(([, p]) => p === filterUser)?.[0] || null;
            topUsers = topUsers.filter((u) => u.user === filterUser);
            if (real) {
                selected = summarizeUserDailySpend(rows, real, { days });
                // Xoá id thật khỏi cả object con — cùng một luật với danh sách.
                selected.telegramId = null;
                selected.user = filterUser;
            }
        }

        res.json({
            days,
            from: summary.from, to: summary.to,
            statuses: summary.statuses,
            tzOffsetMinutes: summary.tzOffsetMinutes,
            totals: summary.totals,
            daySeries: summary.daySeries,
            topUsers,
            userCount: summary.userCount,
            // KHÔNG cắt âm thầm: bảng này có thể chưa phải toàn bộ khách.
            truncatedUserCount: filterUser ? 0 : summary.truncatedUserCount,
            user: selected,
            // Quét thiếu đơn thì MỌI con số ở trên là con số thiếu — phải nói thẳng.
            truncated, scanned,
            pseudonym: {
                stablePerApiKey: true, reversible: false,
                note: "Cùng một khách ra hai mã khác nhau với hai API key khác nhau.",
            },
        });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

/**
 * GET /api/seller/stats/keys — key của CHÍNH seller này theo ngày và trạng thái.
 * `?days=30`.
 */
router.get("/stats/keys", async (req, res) => {
    try {
        const days = Math.min(366, Math.max(1, Number(req.query.days) || 30));
        const rows = await scanSellerIssuedKeysForStatus(req.apiKey.id);
        const truncated = rows.length >= SELLER_STATUS_SCAN_MAX;
        const now = Date.now();

        // Trạng thái sống nằm ở provider. Đọc một lượt cho mọi server có key
        // (cache 60s) thay vì mỗi key một request.
        const profileIds = [...new Set(rows.map((r) => r.profileId ?? null))];
        let liveOk = false;
        const statusById = new Map();
        const quotaRefByProfile = new Map();
        if (rows.length) {
            const results = await Promise.all(profileIds.map(async (pid) => {
                const [st, cfg] = await Promise.all([listKeyStatusesCached(pid), getProfileConfig(pid)]);
                return { pid, st, cfg };
            }));
            for (const { pid, st, cfg } of results) {
                quotaRefByProfile.set(String(pid ?? ""), cfg.quotaRefPrice);
                if (st?.ok) { liveOk = true; for (const [k, v] of st.byId || new Map()) statusById.set(k, v); }
            }
        }

        const wantedDays = new Set(dayRange(days, now, DEFAULT_TZ_OFFSET_MINUTES).keys);
        const byStatus = {};
        const byDay = new Map();
        let quotaTokens = 0, valueUsd = 0, renewals = 0, pending = 0;

        for (const r of rows) {
            const view = liveKeyViewForSeller(
                statusById.get(r.externalId), r, now, quotaRefByProfile.get(String(r.profileId ?? "")), liveOk,
            );
            byStatus[view.status] = (byStatus[view.status] || 0) + 1;
            quotaTokens += Number(r.quotaTokens) || 0;
            valueUsd += Number(r.priceUsd) || 0;
            renewals += Number(r.renewCount) || 0;
            if (!r.key) pending += 1;

            const createdAt = r.createdAt ? new Date(r.createdAt) : null;
            if (createdAt && Number.isFinite(+createdAt)) {
                const k = dayKey(createdAt, DEFAULT_TZ_OFFSET_MINUTES);
                // Chỉ giữ ngày nằm trong khoảng client hỏi — cùng một `dayRange` mà
                // endpoint chi tiêu dùng, nên hai bảng không bao giờ lệch biên.
                if (wantedDays.has(k)) {
                    const d = byDay.get(k) || { date: k, keys: 0, quotaTokens: 0, valueUsd: 0 };
                    d.keys += 1;
                    d.quotaTokens += Number(r.quotaTokens) || 0;
                    d.valueUsd += Number(r.priceUsd) || 0;
                    byDay.set(k, d);
                }
            }
        }

        res.json({
            days, keys: rows.length, truncated, liveOk, pending,
            totals: {
                quotaTokens,
                valueUsd: Math.round(valueUsd * 100) / 100,
                renewals,
            },
            byStatus,
            daySeries: [...byDay.values()]
                .map((d) => ({ ...d, valueUsd: Math.round(d.valueUsd * 100) / 100 }))
                .sort((a, b) => (a.date < b.date ? -1 : 1)),
        });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

/**
 * GET /api/seller/docs — tài liệu endpoint, CÓ XÁC THỰC.
 *
 * Cố ý nằm SAU sellerAuth: trang này mô tả toàn bộ bề mặt API mà một key seller với
 * chức năng gốc là NẠP HÀNG có thể chạm tới. Để nó public là tự vẽ bản đồ cho người
 * chưa có key. Shop gửi kèm URL khi cấp key.
 */
router.get("/docs", async (req, res) => {
    const limits = sellerLimits(req.apiKey);
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.end(sellerDocsHtml({
        apiKey: req.apiKey,
        limits,
        base: `${req.protocol}://${req.get("host")}/api/seller`,
    }));
});

export default router;