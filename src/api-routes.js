import express, { Router } from "express";
import { request as httpsReq } from "node:https";
import { request as httpReq } from "node:http";
import { createReadStream } from "node:fs";
import { unlink } from "node:fs/promises";
import prisma from "./lib/prisma.js";
import { adminAuth } from "./middleware/adminAuth.js";
import { autoEnableOnStock, invalidateStockCache } from "./inventory.js";
import { sendBroadcast, sendVipBroadcast, getBroadcastHistory, broadcastStockNotify } from "./broadcast.js";
import { exportOrdersCSV, exportRevenueCSV, exportUsersCSV } from "./export.js";
import { fetchBankHistory, getBankHistoryConfig } from "./bank-history.js";
import { logAction } from "./audit.js";
import { getRevenueByDay } from "./stats.js";
import { invalidateMenuCache, ICON_GROUPS, iconOf } from "./menu-config.js";
import { adminRouter as sellerKeyRouter } from "./seller-api.js";
import { invalidateShopConfig, getSepayApiKeySync } from "./shop-config.js";
import { invalidateCategoryCache } from "./category.js";
import { invalidateEmojiCache } from "./emoji-map.js";
import { buildCustomEmojiCheckResult, normalizeCustomEmojiId } from "./icon-utils.js";
import { reverseRefundTransaction } from "./wallet.js";
import { createGiftCode, updateGiftCode, createGiftCodeBatch, listGiftCodes, toggleGiftCode, deleteGiftCode, getGiftCodeRedemptions } from "./giftcode.js";
import { getConfig as getGpt2apiConfig, getProfileConfig, invalidateGpt2apiConfig, invalidateGpt2apiGroups, listModelGroups, createApiKey } from "./gpt2api.js";
import { normalizeProfiles, serializeProfiles, MAX_PROFILES } from "./apikey-profiles.js";
import { listAllIssuedKeys, countAllIssuedKeys, setIssuedKeyHidden, saveIssuedKey, KeySource } from "./apikey-store.js";
import { keyPriceFactors, priceUsdForKey, priceUsdForTokens, buildFreeQuotaTable, freeQuotaBandProbabilities } from "./apikey-pricing.js";
import { apiKeyMessage } from "./bot-ui/apikey-messages.js";
import { getOrderNotificationMode, getOrderNotificationMutedUntil } from "./order-notifications.js";
import { getReferralConfig, invalidateReferralConfig, getReferralLeaderboard, REFERRAL_SETTING_KEYS } from "./referral.js";

let _bot = null;
export function setBotInstance(b) { _bot = b; }
const ADMIN_IDS = (process.env.ADMIN_IDS || "").split(",").map((id) => id.trim()).filter(Boolean);

// Map collection name → prisma model key (for read-only DB viewer)
const COLLECTION_TO_MODEL = {
    users: "user", products: "product", orders: "order", stockItems: "stockItem",
    wallets: "wallet", walletTransactions: "walletTransaction", coupons: "coupon",
    giftCodes: "giftCode", giftCodeRedemptions: "giftCodeRedemption",
    issuedApiKeys: "issuedApiKey",
    categories: "category", complaints: "complaint", auditLogs: "auditLog",
    referrals: "referral", vipLevels: "vipLevel", settings: "setting",
    scheduledBroadcasts: "scheduledBroadcast",
};

function httpGetJson(urlStr, headers = {}) {
    return new Promise((resolve, reject) => {
        const url = new URL(urlStr);
        const mod = url.protocol === "https:" ? httpsReq : httpReq;
        const req = mod({
            hostname: url.hostname,
            port: url.port || (url.protocol === "https:" ? 443 : 80),
            path: url.pathname + url.search,
            method: "GET",
            headers,
            // KHÔNG tắt kiểm tra certificate: request này mang apiKey của provider
            // (Authorization: Bearer / X-Api-Key / api_key trong query). Tắt đi thì
            // kẻ chặn đường mạng dựng cert tự ký nào cũng bắt được key — key đó có
            // sức mua trên tài khoản provider của shop.
        }, (res) => {
            let body = "";
            res.on("data", (c) => body += c);
            res.on("end", () => {
                if (res.statusCode >= 400) return reject(new Error(`HTTP ${res.statusCode} — ${body.slice(0, 200)}`));
                try { resolve(JSON.parse(body)); }
                catch { reject(new Error(`Invalid JSON: ${body.slice(0, 100)}`)); }
            });
        });
        req.setTimeout(20000, () => { req.destroy(); reject(new Error("Timeout (20s)")); });
        req.on("error", reject);
        req.end();
    });
}

const router = Router();
// Tăng giới hạn body — nhập kho bằng nhiều file (.txt/.json) có thể vượt 100KB mặc định.
router.use(express.json({ limit: "25mb" }));
router.use(adminAuth);

// ─── Bot Status ───────────────────────────────────────────────────────────────
router.get("/bot-status", async (req, res) => {
    try {
        const token = process.env.BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN;
        if (!token) return res.json({ online: false, reason: "no token" });
        const r = await fetch(`https://api.telegram.org/bot${token}/getMe`, { signal: AbortSignal.timeout(4000) });
        const data = await r.json();
        if (data.ok) return res.json({ online: true, username: data.result.username, name: data.result.first_name });
        return res.json({ online: false, reason: data.description });
    } catch (e) {
        res.json({ online: false, reason: e.message });
    }
});

// ─── Seller API key management (admin only) ───────────────────────────────────
router.use("/seller-keys", sellerKeyRouter);

// ─── Stats ───────────────────────────────────────────────────────────────────
router.get("/stats", async (req, res) => {
    try {
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const since30 = new Date(Date.now() - 30 * 86400000);
        const [todayOrders, newUsers, activeProducts, recentOrders, totalUsers, allTimeAgg, pendingOrders, monthAgg] = await Promise.all([
            prisma.order.aggregate({ where: { createdAt: { gte: today }, status: { in: ["PAID", "DELIVERED"] } }, _sum: { finalAmount: true }, _count: true }),
            prisma.user.count({ where: { createdAt: { gte: today } } }),
            prisma.product.count({ where: { isActive: true } }),
            prisma.order.findMany({ take: 10, orderBy: { createdAt: "desc" }, include: { product: { select: { name: true } } } }),
            prisma.user.count(),
            prisma.order.aggregate({ where: { status: { in: ["PAID", "DELIVERED"] } }, _sum: { finalAmount: true }, _count: true }),
            prisma.order.count({ where: { status: "PENDING" } }),
            prisma.order.aggregate({ where: { createdAt: { gte: since30 }, status: { in: ["PAID", "DELIVERED"] } }, _sum: { finalAmount: true }, _count: true }),
        ]);

        // revenueChart, topRaw, allStockProducts độc lập → chạy SONG SONG (trước đây
        // await tuần tự). topProductRows phụ thuộc topRaw nên fetch sau.
        const chartDays = req.query.chartDays === "30" ? 30 : 7;
        const [revenueChart, topRaw, allStockProducts] = await Promise.all([
            getRevenueByDay(chartDays).catch(() => []),
            prisma.order.groupBy({
                by: ["productId"], _count: true,
                where: { status: { in: ["PAID", "DELIVERED"] }, createdAt: { gte: since30 }, productId: { not: null } },
                take: 200,
            }),
            prisma.product.findMany({
                where: { deliveryMode: "STOCK_LINES", isActive: true },
                include: { _count: { select: { stockItems: { where: { isSold: false } } } } },
            }),
        ]);

        // Top 5 sản phẩm bán chạy 30 ngày
        topRaw.sort((a, b) => (b._count || 0) - (a._count || 0));
        const topIds = topRaw.slice(0, 5).map(t => t.productId).filter(Boolean);
        const topProductRows = await prisma.product.findMany({ where: { id: { in: topIds } }, select: { id: true, name: true } });
        const topProductMap = Object.fromEntries(topProductRows.map(p => [p.id, p.name]));
        const topProducts = topIds.map(id => ({ name: topProductMap[id] || "?", orders: topRaw.find(t => t.productId === id)?._count || 0 }));

        // Cảnh báo hết hàng (STOCK_LINES, còn ≤ 5) — allStockProducts đã fetch song song ở trên
        const lowStock = allStockProducts
            .filter((p) => (p._count?.stockItems ?? 0) <= 5)
            .sort((a, b) => (a._count?.stockItems ?? 0) - (b._count?.stockItems ?? 0))
            .slice(0, 8)
            .map((p) => ({ id: p.id, name: p.name, stock: p._count?.stockItems ?? 0 }));

        res.json({
            stats: {
                todayRevenue: todayOrders._sum.finalAmount || 0,
                todayOrders: todayOrders._count,
                newUsers,
                activeProducts,
                totalUsers,
                allTimeRevenue: allTimeAgg._sum.finalAmount || 0,
                allTimeOrders: allTimeAgg._count,
                pendingOrders,
                monthRevenue: monthAgg._sum.finalAmount || 0,
                monthOrders: monthAgg._count,
            },
            recentOrders,
            revenueChart,
            topProducts,
            lowStock,
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ─── Products ─────────────────────────────────────────────────────────────────
router.get("/products", async (req, res) => {
    try {
        const page = Math.max(1, Number(req.query.page) || 1);
        const limit = Math.min(100, Number(req.query.limit) || 20);
        const search = req.query.search || "";
        const status = req.query.status || "all"; // active | inactive | unlisted | all
        const where = {};
        if (search) where.name = { contains: search, mode: "insensitive" };
        if (status === "active") where.isActive = true;
        else if (status === "inactive") where.isActive = false;
        else if (status === "unlisted") where.unlisted = true;
        if (req.query.categoryId) where.categoryId = req.query.categoryId;
        if (req.query.deliveryMode) where.deliveryMode = req.query.deliveryMode;
        const PROD_SORT = { name: true, price: true, createdAt: true };
        const prodSortField = PROD_SORT[req.query.sort] ? req.query.sort : "createdAt";
        const prodSortDir = req.query.order === "asc" ? "asc" : "desc";
        const [products, total] = await Promise.all([
            prisma.product.findMany({ where, skip: (page - 1) * limit, take: limit, include: { category: { select: { name: true } }, _count: { select: { stockItems: { where: { isSold: false } } } } }, orderBy: { [prodSortField]: prodSortDir } }),
            prisma.product.count({ where }),
        ]);
        res.json({ products, total });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put("/products/:id/toggle-active", async (req, res) => {
    try {
        const p = await prisma.product.findUnique({ where: { id: req.params.id }, select: { isActive: true } });
        if (!p) return res.status(404).json({ error: "Not found" });
        const updated = await prisma.product.update({ where: { id: req.params.id }, data: { isActive: !p.isActive } });
        invalidateCategoryCache();
        logAction("web-admin", "TOGGLE_PRODUCT", req.params.id, { isActive: updated.isActive });
        res.json({ isActive: updated.isActive });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put("/products/:id/toggle-unlisted", async (req, res) => {
    try {
        const p = await prisma.product.findUnique({ where: { id: req.params.id }, select: { unlisted: true } });
        if (!p) return res.status(404).json({ error: "Not found" });
        // Hàng cũ chưa có field → undefined, coi như đang công khai, bật lên thành ẩn.
        const next = !(p.unlisted === true);
        const updated = await prisma.product.update({ where: { id: req.params.id }, data: { unlisted: next } });
        invalidateCategoryCache();
        logAction("web-admin", "TOGGLE_UNLISTED", req.params.id, { unlisted: updated.unlisted });
        res.json({ unlisted: updated.unlisted });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

function autoCode(name, salt = 0) {
    const slug = String(name || "").replace(/[^a-zA-Z0-9]/g, "").slice(0, 6).toUpperCase() || "PROD";
    return `${slug}${(Date.now() + salt).toString(36).slice(-4).toUpperCase()}`;
}

function parseIconFields(body, fallbackIcon) {
    const iconEmojiId = normalizeCustomEmojiId(body.iconEmojiId);
    const icon = body.icon === undefined
        ? undefined
        : (String(body.icon || "").trim() || fallbackIcon);
    return {
        ...(icon !== undefined ? { icon } : {}),
        ...(iconEmojiId !== undefined ? { iconEmojiId } : {}),
    };
}

router.post("/products", async (req, res) => {
    try {
        const { name, description, price, costPrice, currency, deliveryMode, payload, note, categoryId, code, minQty, maxQty, unlisted } = req.body;
        const toNum = (v) => (v !== undefined && v !== null && v !== "") ? Number(v) : null;
        const iconFields = parseIconFields(req.body, "📦");
        const product = await prisma.product.create({ data: { code: code || autoCode(name), name, description, price: Number(price) || 0, costPrice: toNum(costPrice), currency: currency || "VND", deliveryMode: deliveryMode || "TEXT", payload, note, categoryId: categoryId || null, isActive: true, unlisted: unlisted === true || unlisted === "true", minQty: toNum(minQty) ?? 1, maxQty: toNum(maxQty), ...iconFields } });
        invalidateCategoryCache();
        invalidateEmojiCache();
        logAction("web-admin", "CREATE_PRODUCT", product.id, { name: product.name, price: product.price });
        res.json(product);
    } catch (e) { res.status(/Custom Emoji ID/.test(e.message) ? 400 : 500).json({ error: e.message }); }
});

router.put("/products/:id", async (req, res) => {
    try {
        const { name, description, price, costPrice, currency, deliveryMode, payload, note, categoryId, minQty, maxQty, unlisted } = req.body;
        const toNum = (v) => (v !== undefined && v !== null && v !== "") ? Number(v) : null;
        const iconFields = parseIconFields(req.body, "📦");
        const product = await prisma.product.update({ where: { id: req.params.id }, data: { name, description, price: Number(price) || 0, costPrice: toNum(costPrice), currency, deliveryMode, payload, note, categoryId: categoryId || null, minQty: toNum(minQty) ?? 1, maxQty: toNum(maxQty), ...(unlisted === undefined ? {} : { unlisted: unlisted === true || unlisted === "true" }), ...iconFields } });
        invalidateCategoryCache();
        invalidateEmojiCache();
        logAction("web-admin", "UPDATE_PRODUCT", req.params.id, { name: product.name });
        res.json(product);
    } catch (e) { res.status(/Custom Emoji ID/.test(e.message) ? 400 : 500).json({ error: e.message }); }
});

router.delete("/products/:id", async (req, res) => {
    try {
        await prisma.product.update({ where: { id: req.params.id }, data: { isActive: false } });
        invalidateCategoryCache();
        logAction("web-admin", "DELETE_PRODUCT", req.params.id);
        res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── Categories ───────────────────────────────────────────────────────────────
router.get("/categories", async (req, res) => {
    try {
        const categories = await prisma.category.findMany({ orderBy: { order: "asc" }, include: { _count: { select: { products: true } } } });
        res.json({ categories });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post("/categories", async (req, res) => {
    try {
        const iconFields = parseIconFields(req.body, "📁");
        const cat = await prisma.category.create({ data: { name: req.body.name, description: req.body.description, icon: req.body.icon || "📁", ...iconFields } });
        invalidateCategoryCache();
        res.json(cat);
    } catch (e) { res.status(/Custom Emoji ID/.test(e.message) ? 400 : 500).json({ error: e.message }); }
});

router.put("/categories/:id", async (req, res) => {
    try {
        const { name, description, icon, isActive } = req.body;
        const data = {};
        if (name !== undefined) data.name = name;
        if (description !== undefined) data.description = description;
        if (icon !== undefined) data.icon = icon;
        Object.assign(data, parseIconFields(req.body, "📁"));
        if (isActive !== undefined) data.isActive = isActive;
        const cat = await prisma.category.update({ where: { id: req.params.id }, data });
        invalidateCategoryCache();
        res.json(cat);
    } catch (e) { res.status(/Custom Emoji ID/.test(e.message) ? 400 : 500).json({ error: e.message }); }
});

router.delete("/categories/:id", async (req, res) => {
    try {
        await prisma.category.delete({ where: { id: req.params.id } });
        invalidateCategoryCache();
        res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── Orders ───────────────────────────────────────────────────────────────────
router.get("/orders", async (req, res) => {
    try {
        const page = Math.max(1, Number(req.query.page) || 1);
        const limit = Math.min(100, Number(req.query.limit) || 20);
        const where = {};
        if (req.query.status) where.status = req.query.status;
        if (req.query.search) {
            const s = req.query.search.trim();
            // Find matching users by name/username, then include their telegramIds
            const matchedUsers = await prisma.user.findMany({
                where: { OR: [{ firstName: { contains: s, mode: "insensitive" } }, { username: { contains: s, mode: "insensitive" } }] },
                select: { telegramId: true }, take: 100,
            });
            const matchedTids = matchedUsers.map((u) => u.telegramId);
            // Find matching products by name
            const matchedProducts = await prisma.product.findMany({
                where: { name: { contains: s, mode: "insensitive" } },
                select: { id: true }, take: 50,
            });
            const matchedPids = matchedProducts.map((p) => p.id);
            const orClauses = [{ odelegramId: { contains: s } }];
            if (matchedTids.length) orClauses.push({ odelegramId: { in: matchedTids } });
            if (matchedPids.length) orClauses.push({ productId: { in: matchedPids } });
            where.OR = orClauses;
        }
        if (req.query.startDate || req.query.endDate) {
            where.createdAt = {};
            if (req.query.startDate) where.createdAt.gte = new Date(req.query.startDate);
            if (req.query.endDate) where.createdAt.lte = new Date(req.query.endDate + "T23:59:59");
        }
        const SORT_ORDERS = { createdAt: true, finalAmount: true, quantity: true };
        const sortField = SORT_ORDERS[req.query.sort] ? req.query.sort : "createdAt";
        const sortDir = req.query.order === "asc" ? "asc" : "desc";
        const [orders, total] = await Promise.all([
            prisma.order.findMany({ where, skip: (page - 1) * limit, take: limit, include: { product: { select: { name: true } }, user: { select: { firstName: true, telegramId: true } } }, orderBy: { [sortField]: sortDir } }),
            prisma.order.count({ where }),
        ]);
        res.json({ orders, total });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get("/orders/:id", async (req, res) => {
    try {
        const order = await prisma.order.findUnique({ where: { id: req.params.id }, include: { product: true, user: true } });
        res.json(order);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// Manual refund for an order
router.post("/orders/:id/refund", async (req, res) => {
    try {
        const order = await prisma.order.findUnique({ where: { id: req.params.id } });
        if (!order) return res.status(404).json({ error: "Không tìm thấy đơn" });
        if (!["PAID", "CANCELED", "DELIVERING"].includes(order.status)) {
            return res.status(400).json({ error: `Chỉ hoàn được đơn PAID/CANCELED/DELIVERING, hiện là ${order.status}` });
        }

        // Idempotent check: chặn refund 2 lần cho cùng 1 order (admin click trùng,
        // hoặc đơn đã tự refund OUT_OF_STOCK rồi).
        const existingRefund = await prisma.walletTransaction.findFirst({
            where: {
                orderId: order.id,
                type: "REFUND",
                status: { in: ["SUCCESS", "PENDING"] },
            },
        });
        if (existingRefund) {
            return res.status(400).json({ error: "Đơn đã được hoàn tiền trước đó" });
        }

        const { refund } = await import("./wallet.js");
        const note = req.body.note || `Admin hoàn tiền đơn #${order.id.slice(-8).toUpperCase()}`;
        const result = await refund(String(order.odelegramId), order.finalAmount, order.id, note);
        if (!result?.success) return res.status(400).json({ error: result?.error || "Hoàn tiền thất bại" });
        await prisma.order.update({ where: { id: order.id }, data: { status: "CANCELED", cancelReason: "Admin manual refund" } });
        logAction("web-admin", "MANUAL_REFUND", order.id, { amount: order.finalAmount, note });
        res.json({ ok: true, refunded: order.finalAmount, newBalance: result.newBalance });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// Re-trigger delivery for stuck PAID/DELIVERING order
router.post("/orders/:id/redeliver", async (req, res) => {
    try {
        const order = await prisma.order.findUnique({ where: { id: req.params.id }, include: { product: true } });
        if (!order) return res.status(404).json({ error: "Không tìm thấy đơn" });
        // Allow re-deliver for PAID / stuck DELIVERING / already DELIVERED (gửi lại)
        if (!["PAID", "DELIVERING", "DELIVERED"].includes(order.status)) {
            return res.status(400).json({ error: `Chỉ giao lại được đơn PAID/DELIVERING/DELIVERED, hiện là ${order.status}` });
        }

        // Nếu đơn ĐÃ có nội dung giao (đã claim account trước đó) → GỬI LẠI nội dung cũ,
        // TUYỆT ĐỐI KHÔNG claim kho mới (tránh trừ kho / cấp account 2 lần cho 1 đơn).
        if (order.deliveryContent && String(order.deliveryContent).trim()) {
            const chatId = Number(order.chatId || order.odelegramId);
            const orderId = order.id.slice(-8).toUpperCase();
            if (_bot?.telegram && chatId) {
                await _bot.telegram.sendMessage(chatId, `🔁 <b>Gửi lại đơn</b> <code>${orderId}</code>\n📦 ${order.product?.name || ""}`, { parse_mode: "HTML" }).catch(() => {});
                await _bot.telegram.sendDocument(
                    chatId,
                    { source: Buffer.from(String(order.deliveryContent), "utf-8"), filename: `ORD${orderId}.txt` },
                    { caption: "Nội dung đơn hàng" }
                ).catch(async () => {
                    await _bot.telegram.sendMessage(chatId, String(order.deliveryContent).slice(0, 4000)).catch(() => {});
                });
            }
            if (order.status !== "DELIVERED") {
                await prisma.order.update({ where: { id: order.id }, data: { status: "DELIVERED" } }).catch(() => {});
            }
            logAction("web-admin", "MANUAL_REDELIVER_RESEND", order.id, {});
            return res.json({ ok: true, status: "DELIVERED", resent: true });
        }

        // Chưa có nội dung giao → giao mới (claim kho). Đồng thời mở lại cờ retry
        // sau khi admin đã sửa chat ID hoặc thông tin người nhận.
        await prisma.order.update({
            where: { id: order.id },
            data: {
                status: "PAID",
                deliveryRetryBlockedAt: null,
                deliveryError: null,
            },
        });
        const { deliverOrder } = await import("./delivery.js");
        await deliverOrder({ prisma, telegram: _bot?.telegram || null, order: { ...order, status: "PAID" } });
        const updated = await prisma.order.findUnique({ where: { id: order.id } });
        logAction("web-admin", "MANUAL_REDELIVER", order.id, { status: updated?.status });
        res.json({ ok: true, status: updated?.status });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put("/orders/:id/status", async (req, res) => {
    try {
        const VALID_STATUSES = ["PENDING", "PAID", "DELIVERING", "DELIVERED", "CANCELED"];
        if (!VALID_STATUSES.includes(req.body.status)) {
            return res.status(400).json({ error: `Trạng thái không hợp lệ. Chỉ chấp nhận: ${VALID_STATUSES.join(", ")}` });
        }
        const data = { status: req.body.status };
        if (req.body.status === "PAID") {
            data.deliveryRetryBlockedAt = null;
            data.deliveryError = null;
        }
        const order = await prisma.order.update({ where: { id: req.params.id }, data });
        logAction("web-admin", "UPDATE_ORDER_STATUS", req.params.id, { status: req.body.status });
        res.json(order);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── Users ────────────────────────────────────────────────────────────────────
router.get("/users", async (req, res) => {
    try {
        const page = Math.max(1, Number(req.query.page) || 1);
        const limit = Math.min(100, Number(req.query.limit) || 20);
        const search = req.query.search || "";
        const sort = req.query.sort || "newest";
        const where = search ? { OR: [{ telegramId: { contains: search } }, { firstName: { contains: search, mode: "insensitive" } }, { username: { contains: search, mode: "insensitive" } }] } : {};
        if (req.query.vipLevel !== undefined && req.query.vipLevel !== "") where.vipLevel = Number(req.query.vipLevel);
        if (req.query.blocked === "true") where.isBlocked = true;
        else if (req.query.blocked === "false") where.isBlocked = false;
        const orderBy = sort === "spent" ? [{ totalSpent: "desc" }] : [{ createdAt: "desc" }];
        const [usersRaw, total] = await Promise.all([
            prisma.user.findMany({ where, skip: sort !== "balance" ? (page - 1) * limit : 0, take: sort !== "balance" ? limit : undefined, include: { wallet: { select: { balance: true } }, _count: { select: { orders: true } } }, orderBy }),
            prisma.user.count({ where }),
        ]);
        let users = usersRaw;
        if (sort === "balance") {
            users = usersRaw.sort((a, b) => (b.wallet?.balance || 0) - (a.wallet?.balance || 0))
                .slice((page - 1) * limit, page * limit);
        }
        res.json({
            users: users.map((user) => ({
                ...user,
                orderNotificationMode: getOrderNotificationMode(user.notifyMutedUntil),
            })),
            total,
        });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put("/users/:id/wallet", async (req, res) => {
    try {
        const { amount, note } = req.body;
        const amt = Number(amount);
        if (!amt || isNaN(amt)) return res.status(400).json({ error: "Số tiền không hợp lệ" });
        const user = await prisma.user.findUnique({ where: { id: req.params.id } });
        if (!user) return res.status(404).json({ error: "User not found" });
        let wallet = await prisma.wallet.findUnique({ where: { odelegramId: user.telegramId } });
        if (!wallet) {
            wallet = await prisma.wallet.create({ data: { odelegramId: user.telegramId, balance: 0 } });
        }
        const balanceBefore = wallet.balance;
        // Chặn trừ quá số dư → ví âm.
        if (amt < 0 && balanceBefore + amt < 0) {
            return res.status(400).json({ error: `Số dư không đủ để trừ. Hiện có ${balanceBefore.toLocaleString("vi-VN")}đ` });
        }
        // Cập nhật NGUYÊN TỬ bằng increment (tránh lost-update khi 2 request đồng thời).
        const updatedWallet = await prisma.wallet.update({
            where: { id: wallet.id },
            data: { balance: { increment: amt } },
        });
        const balanceAfter = updatedWallet.balance;
        await prisma.walletTransaction.create({ data: {
            walletId: wallet.id,
            amount: amt,
            type: amt > 0 ? "ADMIN_ADD" : "ADMIN_DEDUCT",
            balanceBefore,
            balanceAfter,
            description: note || "Admin điều chỉnh",
            status: "SUCCESS",
        }});
        logAction("web-admin", "ADJUST_WALLET", req.params.id, { amount: amt, note });

        // Notify user via Telegram
        if (_bot && user.telegramId) {
            const sign = amt > 0 ? "+" : "";
            const emoji = amt > 0 ? "✅" : "⚠️";
            const action = amt > 0 ? "Cộng tiền" : "Trừ tiền";
            const msg = `${emoji} <b>${action} số dư ví</b>\n\n` +
                `💰 Số tiền: <b>${sign}${Math.abs(amt).toLocaleString("vi-VN")}đ</b>\n` +
                `💳 Số dư mới: <b>${balanceAfter.toLocaleString("vi-VN")}đ</b>` +
                (note ? `\n📝 Lý do: ${note}` : "");
            _bot.telegram.sendMessage(user.telegramId, msg, { parse_mode: "HTML" }).catch(() => {});
        }

        res.json({ ok: true, balanceBefore, balanceAfter });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put("/users/:id/block", async (req, res) => {
    try {
        const user = await prisma.user.update({ where: { id: req.params.id }, data: { isBlocked: true } });
        logAction("web-admin", "BLOCK_USER", req.params.id);
        res.json(user);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put("/users/:id/unblock", async (req, res) => {
    try {
        const user = await prisma.user.update({ where: { id: req.params.id }, data: { isBlocked: false } });
        logAction("web-admin", "UNBLOCK_USER", req.params.id);
        res.json(user);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put("/users/:id/order-notifications", async (req, res) => {
    try {
        const mode = String(req.body?.mode || "");
        const notifyMutedUntil = getOrderNotificationMutedUntil(mode);
        const user = await prisma.user.update({
            where: { id: req.params.id },
            data: { notifyMutedUntil },
        });
        logAction("web-admin", "UPDATE_ORDER_NOTIFICATIONS", req.params.id, {
            mode,
            telegramId: user.telegramId,
        });
        res.json({
            ...user,
            orderNotificationMode: getOrderNotificationMode(user.notifyMutedUntil),
        });
    } catch (e) {
        const status = /không hợp lệ/.test(e.message) ? 400 : 500;
        res.status(status).json({ error: e.message });
    }
});

router.get("/users/:id/orders", async (req, res) => {
    try {
        const page = Math.max(1, Number(req.query.page) || 1);
        const limit = Math.min(50, Number(req.query.limit) || 20);
        const user = await prisma.user.findUnique({ where: { id: req.params.id }, select: { id: true, telegramId: true } });
        if (!user) return res.status(404).json({ error: "User not found" });
        // Orders may be linked by userId (newer) or odelegramId (older)
        const where = { OR: [{ userId: req.params.id }, { odelegramId: user.telegramId }] };
        const [orders, total] = await Promise.all([
            prisma.order.findMany({ where, skip: (page - 1) * limit, take: limit, include: { product: { select: { name: true } } }, orderBy: { createdAt: "desc" } }),
            prisma.order.count({ where }),
        ]);
        res.json({ orders, total });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── Transactions ─────────────────────────────────────────────────────────────
router.get("/transactions", async (req, res) => {
    try {
        const page = Math.max(1, Number(req.query.page) || 1);
        const limit = Math.min(100, Number(req.query.limit) || 20);
        const type = req.query.type;
        const search = req.query.search || "";
        const where = {};
        if (type) where.type = { in: type.split(",") };
        if (search) {
            // Find wallets by owner telegramId, then filter transactions by walletId
            const matchedWallets = await prisma.wallet.findMany({
                where: { odelegramId: { contains: search } },
                select: { id: true }, take: 100,
            });
            const walletIds = matchedWallets.map((w) => w.id);
            const orClauses = [{ description: { contains: search, mode: "insensitive" } }];
            if (walletIds.length) orClauses.push({ walletId: { in: walletIds } });
            where.OR = orClauses;
        }
        if (req.query.startDate || req.query.endDate) {
            where.createdAt = {};
            if (req.query.startDate) where.createdAt.gte = new Date(req.query.startDate);
            if (req.query.endDate) where.createdAt.lte = new Date(req.query.endDate + "T23:59:59");
        }
        const SORT_TX = { createdAt: true, amount: true };
        const sortField = SORT_TX[req.query.sort] ? req.query.sort : "createdAt";
        const sortDir = req.query.order === "asc" ? "asc" : "desc";
        const [transactions, total] = await Promise.all([
            prisma.walletTransaction.findMany({ where, skip: (page - 1) * limit, take: limit, include: { wallet: true }, orderBy: { [sortField]: sortDir } }),
            prisma.walletTransaction.count({ where }),
        ]);
        const telegramIds = [...new Set(transactions.map((tx) => tx.wallet?.odelegramId).filter(Boolean))];
        const refundIds = transactions.filter((tx) => tx.type === "REFUND").map((tx) => tx.id);
        const refundOrderIds = [...new Set(transactions.filter((tx) => tx.type === "REFUND" && tx.orderId).map((tx) => tx.orderId))];
        const [users, reversals, orderRefunds] = await Promise.all([
            telegramIds.length
                ? prisma.user.findMany({ where: { telegramId: { in: telegramIds } }, select: { firstName: true, username: true, telegramId: true } })
                : [],
            refundIds.length
                ? prisma.walletTransaction.findMany({ where: { reversalOfId: { in: refundIds }, type: "REFUND_REVERSAL", status: "SUCCESS" } })
                : [],
            refundOrderIds.length
                ? prisma.walletTransaction.findMany({ where: { orderId: { in: refundOrderIds }, type: "REFUND", status: "SUCCESS" }, orderBy: { createdAt: "asc" } })
                : [],
        ]);
        const userMap = new Map(users.map((user) => [String(user.telegramId), user]));
        const reversalMap = new Map(reversals.map((tx) => [String(tx.reversalOfId), tx]));
        const firstRefundByOrder = new Map();
        const refundCountByOrder = new Map();
        for (const refundTx of orderRefunds) {
            const key = String(refundTx.orderId);
            if (!firstRefundByOrder.has(key)) firstRefundByOrder.set(key, refundTx.id);
            refundCountByOrder.set(key, (refundCountByOrder.get(key) || 0) + 1);
        }
        const normalized = transactions.map((tx) => {
            const reversal = reversalMap.get(String(tx.id));
            const orderKey = tx.orderId ? String(tx.orderId) : null;
            return {
                ...tx,
                user: userMap.get(String(tx.wallet?.odelegramId)) || (tx.wallet?.odelegramId ? { telegramId: tx.wallet.odelegramId } : null),
                reversedAt: tx.reversedAt || reversal?.createdAt || null,
                reversalTransactionId: tx.reversalTransactionId || reversal?.id || null,
                isDuplicateRefund: tx.type === "REFUND" && orderKey
                    ? firstRefundByOrder.get(orderKey) !== tx.id
                    : false,
                refundCountForOrder: orderKey ? (refundCountByOrder.get(orderKey) || 0) : 0,
            };
        });
        res.json({ transactions: normalized, total });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post("/transactions/:id/reverse-refund", async (req, res) => {
    try {
        const result = await reverseRefundTransaction(req.params.id, "web-admin");
        if (!result.success) {
            const status = result.code === "NOT_FOUND" ? 404 : 400;
            return res.status(status).json({ error: result.error, code: result.code });
        }
        await logAction("web-admin", "REVERSE_REFUND", req.params.id, {
            reversalTransactionId: result.transaction?.id || null,
            amount: Math.abs(result.transaction?.amount || 0),
            alreadyProcessed: !!result.alreadyProcessed,
        });
        res.json({
            ok: true,
            alreadyProcessed: !!result.alreadyProcessed,
            newBalance: result.newBalance,
            transaction: result.transaction || null,
        });
    } catch (e) {
        console.error("[reverse-refund]", e);
        res.status(500).json({ error: "Thu hồi khoản hoàn thất bại. Vui lòng thử lại." });
    }
});

// ─── Coupons ─────────────────────────────────────────────────────────────────
router.get("/coupons", async (req, res) => {
    try {
        const coupons = await prisma.coupon.findMany({ orderBy: { createdAt: "desc" } });
        res.json({ coupons });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post("/coupons", async (req, res) => {
    try {
        const { code, discountType, discountValue, maxUses, expiresAt, vipOnly } = req.body;
        const coupon = await prisma.coupon.create({
            data: { code: code.toUpperCase(), discountType, discountValue: Number(discountValue), maxUses: maxUses ? Number(maxUses) : null, expiresAt: expiresAt ? new Date(expiresAt) : null, vipOnly: !!vipOnly },
        });
        res.json(coupon);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put("/coupons/:id", async (req, res) => {
    try {
        const { discountType, discountValue, maxUses, expiresAt, vipOnly } = req.body;
        const coupon = await prisma.coupon.update({
            where: { id: req.params.id },
            data: { discountType, discountValue: Number(discountValue), maxUses: maxUses ? Number(maxUses) : null, expiresAt: expiresAt ? new Date(expiresAt) : null, vipOnly: !!vipOnly },
        });
        res.json(coupon);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete("/coupons/:id", async (req, res) => {
    try {
        await prisma.coupon.delete({ where: { id: req.params.id } });
        res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── Giftcodes ───────────────────────────────────────────────────────────────
router.get("/giftcodes", async (req, res) => {
    try {
        const limit = Math.min(200, Number(req.query.limit) || 50);
        const giftcodes = await listGiftCodes(limit);
        res.json({ giftcodes });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get("/giftcodes/:code/redemptions", async (req, res) => {
    try {
        const limit = Math.min(200, Number(req.query.limit) || 50);
        const { giftCode, redemptions } = await getGiftCodeRedemptions(req.params.code, limit);
        if (!giftCode) return res.status(404).json({ error: "Không tìm thấy mã" });
        res.json({ giftCode, redemptions });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post("/giftcodes", async (req, res) => {
    try {
        const { code, rewardType, amount, quotaMinM, quotaMaxM, keyRpm, keyValidDays, maxUses, perUserLimit, vipOnly, expiresAt, note, count } = req.body;
        const config = {
            rewardType, amount, quotaMinM, quotaMaxM, keyRpm, keyValidDays,
            maxUses, perUserLimit, vipOnly, expiresAt, note, createdBy: "web-admin",
        };

        // count > 1 → sinh loạt mã ngẫu nhiên, `code` khi đó là PREFIX (mỗi mã phải khác nhau).
        const batchSize = Number(count) || 1;
        if (batchSize > 1) {
            const created = await createGiftCodeBatch(batchSize, { ...config, prefix: code || "GIFT" });
            await logAction("web-admin", "ADD_GIFTCODE", `BATCH:${code || "GIFT"}`, { count: created.length, rewardType, amount });
            return res.json({ giftcodes: created, count: created.length });
        }

        const giftcode = await createGiftCode({ ...config, code });
        await logAction("web-admin", "ADD_GIFTCODE", giftcode.code, {
            rewardType: giftcode.rewardType, amount: giftcode.amount, maxUses: giftcode.maxUses,
        });
        res.json(giftcode);
    } catch (e) { res.status(400).json({ error: e.message }); }
});

router.put("/giftcodes/:code", async (req, res) => {
    try {
        const giftcode = await updateGiftCode(req.params.code, req.body || {});
        await logAction("web-admin", "EDIT_GIFTCODE", giftcode.code, {
            rewardType: giftcode.rewardType,
            quotaMinM: giftcode.quotaMinM, quotaMaxM: giftcode.quotaMaxM,
            keyRpm: giftcode.keyRpm, amount: giftcode.amount,
            maxUses: giftcode.maxUses, perUserLimit: giftcode.perUserLimit,
        });
        res.json(giftcode);
    } catch (e) {
        res.status(/Không tìm thấy/.test(e.message) ? 404 : 400).json({ error: e.message });
    }
});

router.post("/giftcodes/:code/toggle", async (req, res) => {
    try {
        const giftcode = await toggleGiftCode(req.params.code);
        if (!giftcode) return res.status(404).json({ error: "Không tìm thấy mã" });
        await logAction("web-admin", "TOGGLE_GIFTCODE", giftcode.code, { isActive: giftcode.isActive });
        res.json(giftcode);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete("/giftcodes/:code", async (req, res) => {
    try {
        const giftcode = await deleteGiftCode(req.params.code);
        if (!giftcode) return res.status(404).json({ error: "Không tìm thấy mã" });
        await logAction("web-admin", "DELETE_GIFTCODE", giftcode.code, { amount: giftcode.amount, usedCount: giftcode.usedCount });
        res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── GPT2API / Cửa hàng API key ────────────────────────────────────────────────
// Cấu hình kết nối tới GPT2API (xpiki) — nguồn tạo key sk-* bán cho khách.
// GPT2API_ADMIN_TOKEN là token adm_* tạo key trên tài khoản shop → GET chỉ trả
// phần đuôi che, PUT gửi rỗng = "giữ nguyên". Trước đây chỉ có ở admin cũ
// (GET/PUT /api/admin/gpt2api-config, auth ?secret=), giờ chuyển hẳn sang đây.
const GPT2API_CONFIG_KEYS = [
    "GPT2API_BASE", "GPT2API_ADMIN_TOKEN", "GPT2API_USER_ID", "GPT2API_ENDPOINT",
    "GPT2API_MODELS", "GPT2API_FALLBACK_GROUPS", "GPT2API_DOC_URL", "GPT2API_USAGE_URL",
    "GPT2API_KEY_RPM", "GPT2API_KEY_TPM", "GPT2API_KEY_VALID_DAYS",
    "GPT2API_USD_PER_MTOKEN", "GPT2API_BUY_PRESETS_M", "GPT2API_ENABLED",
    // Tab "Giá & giới hạn" — trước là ENV-only, restart mới có hiệu lực.
    "GPT2API_RPM_INCLUDED", "GPT2API_RPM_SURCHARGE_PCT", "GPT2API_DAY_SURCHARGE_PCT",
    "GPT2API_NO_EXPIRY_MULT", "GPT2API_MAX_BUY_M", "GPT2API_RPM_PRESETS", "GPT2API_DAYS_PRESETS",
    "GPT2API_FREE_MIN_M", "GPT2API_FREE_MAX_M", "GPT2API_FREE_ALPHA",
    "GPT2API_QUOTA_REF_PRICE", "GPT2API_ALLOWED_MODELS_MODE",
    // Nhiều "server" trên cùng kết nối — JSON mảng, xử lý riêng ở PUT.
    "GPT2API_PROFILES",
];

function maskGpt2apiToken(tok) {
    return tok ? `${tok.slice(0, 8)}…${tok.slice(-4)}` : "";
}

router.get("/gpt2api/config", async (req, res) => {
    try {
        const rows = await prisma.setting.findMany({ where: { key: { in: GPT2API_CONFIG_KEYS } } });
        const map = Object.fromEntries(rows.map((r) => [r.key, r.value]));
        const rawToken = map.GPT2API_ADMIN_TOKEN || process.env.GPT2API_ADMIN_TOKEN || "";
        // getConfig() phản ánh trạng thái thật (merge cả ENV) — UI cần biết đã đủ
        // điều kiện gọi API chưa, và endpoint suy ra khi admin để trống.
        const cfg = await getGpt2apiConfig();
        res.json({
            config: { ...map, GPT2API_ADMIN_TOKEN: maskGpt2apiToken(rawToken) },
            tokenConfigured: Boolean(rawToken),
            configured: cfg.configured,
            enabled: cfg.enabled,
            derivedEndpoint: cfg.endpoint,
            // Giá trị HIỆU LỰC (merge DB > ENV > mặc định) — UI đổ vào ô khi Setting
            // để trống, và dùng cho "xem trước giá". Đây là những gì đang thật sự
            // áp dụng, không phải chỉ nội dung bảng Setting.
            effective: {
                // Kết nối
                base: cfg.base,
                userId: cfg.userId,
                endpoint: cfg.endpoint,
                models: cfg.models,
                fallbackGroups: cfg.fallbackGroups,
                docUrl: cfg.docUrl,
                usageUrl: cfg.usageUrl,
                // Giá & giới hạn
                usdPerMtoken: cfg.usdPerMtoken,
                buyPresetsM: cfg.buyPresetsM,
                keyRpm: cfg.rpm, keyTpm: cfg.tpm, keyValidDays: cfg.validDays,
                rpmIncluded: cfg.rpmIncluded,
                rpmSurchargePct: cfg.rpmSurchargePct,
                daySurchargePct: cfg.daySurchargePct,
                noExpiryMult: cfg.noExpiryMult,
                maxBuyM: Math.round(cfg.maxBuyTokens / 1e6),
                rpmPresets: cfg.rpmPresets,
                daysPresets: cfg.daysPresets,
                freeMinM: cfg.freeMinM, freeMaxM: cfg.freeMaxM, freeAlpha: cfg.freeAlpha,
                quotaRefPrice: cfg.quotaRefPrice,
                allowedModelsMode: cfg.allowedModelsMode,
            },
            // Các "server" — cùng kết nối, khác nhóm fallback + bộ giá. `profiles`
            // là bản THÔ để form sửa (ô trống = kế thừa), `effectiveProfiles` là
            // giá trị đang thật sự áp dụng để hiện xem trước.
            profiles: normalizeProfiles(map.GPT2API_PROFILES),
            effectiveProfiles: (cfg.profiles || []).map((p) => ({
                id: p.profileId,
                name: p.profileName,
                note: p.profileNote,
                enabled: p.profileEnabled,
                fallbackGroups: p.fallbackGroups,
                usdPerMtoken: p.usdPerMtoken,
                rpm: p.rpm,
                validDays: p.validDays,
                maxBuyM: Math.round((p.maxBuyTokens || 0) / 1e6),
                quotaRefPrice: p.quotaRefPrice,
            })),
            maxProfiles: MAX_PROFILES,
        });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put("/gpt2api/config", async (req, res) => {
    try {
        const updates = Object.entries(req.body || {})
            .filter(([k, v]) => GPT2API_CONFIG_KEYS.includes(k) && v !== undefined && v !== null)
            // Token rỗng = "giữ nguyên": GET trả bản che nên submit lại form sẽ vô
            // tình ghi đè token thật bằng chuỗi rỗng.
            .filter(([k, v]) => !(k === "GPT2API_ADMIN_TOKEN" && String(v).trim() === ""))
            // Profile tới dưới dạng MẢNG (không phải chuỗi) — String(mảng) sẽ ra
            // "[object Object]" và phá sạch cấu hình. Chuẩn hoá + serialize ở đây,
            // đồng thời chặn knob rác trước khi ghi.
            .map(([k, v]) => (k === "GPT2API_PROFILES" ? [k, serializeProfiles(v)] : [k, String(v).trim()]));
        if (!updates.length) return res.json({ ok: true, updated: 0 });

        await Promise.all(updates.map(([k, v]) =>
            prisma.setting.upsert({ where: { key: k }, update: { value: v }, create: { key: k, value: v } })
        ));
        invalidateGpt2apiConfig();
        // Đổi base/token/fallback → danh sách model-group cache cũng phải làm mới.
        invalidateGpt2apiGroups();
        await logAction("web-admin", "UPDATE_GPT2API_CONFIG", "settings", { keys: updates.map(([k]) => k) });
        res.json({ ok: true, updated: updates.length });
    } catch (e) { res.status(400).json({ error: e.message }); }
});

// Kiểm tra token + base còn sống: gọi model-groups (endpoint duy nhất an toàn,
// không tạo gì). Trả số group để admin yên tâm fallback_allowed_groups có dữ liệu.
router.post("/gpt2api/test", async (req, res) => {
    try {
        const cfg = await getGpt2apiConfig();
        if (!cfg.configured) return res.status(400).json({ ok: false, error: "Chưa đủ cấu hình (cần Base URL, Admin token, User ID)" });
        const r = await listModelGroups({ force: true });
        if (!r.ok) return res.json({ ok: false, error: r.message || `Lỗi ${r.code}`, code: r.code });
        res.json({ ok: true, groupCount: r.groups.length, groups: r.groups });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

router.get("/gpt2api/model-groups", async (req, res) => {
    try {
        const r = await listModelGroups({ force: req.query.force === "1" });
        if (!r.ok) return res.json({ ok: false, error: r.message || `Lỗi ${r.code}`, groups: [] });
        res.json({ ok: true, groups: r.groups });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// Xem trước giá 1 key với cấu hình HIỆN TẠI (đã lưu). Không tạo gì.
router.post("/gpt2api/price-preview", async (req, res) => {
    try {
        const tokens = Math.max(0, Number(req.body?.tokens) || 0);
        const rpm = Math.max(0, Number(req.body?.rpm) || 0);
        const validDays = Math.max(0, Number(req.body?.validDays) || 0);
        const cfg = await getGpt2apiConfig();
        const factors = keyPriceFactors({ rpm, validDays }, cfg);
        res.json({
            priceUsd: priceUsdForKey({ tokens, rpm, validDays }, cfg.usdPerMtoken, cfg),
            baseUsd: priceUsdForTokens(tokens, cfg.usdPerMtoken),
            rpmPct: factors.rpmPct,
            daysPct: factors.daysPct,
            usdPerMtoken: cfg.usdPerMtoken,
            overMax: tokens > cfg.maxBuyTokens,
        });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// Bảng xác suất quota quà tặng cho một miền — cập nhật live khi admin đổi min/max/alpha.
router.get("/gpt2api/quota-preview", async (req, res) => {
    try {
        const cfg = await getGpt2apiConfig();
        const minM = Math.max(1, Math.floor(Number(req.query.minM) || cfg.freeMinM));
        const maxM = Math.max(minM, Math.floor(Number(req.query.maxM) || cfg.freeMaxM));
        const alpha = Number(req.query.alpha) >= 0 ? Number(req.query.alpha) : cfg.freeAlpha;
        const table = buildFreeQuotaTable({ minM, maxM, alpha });
        const span = maxM - minM;
        const bands = span <= 0
            ? [[minM, maxM]]
            : (() => {
                const q = span / 4;
                const c = [minM, Math.round(minM + q), Math.round(minM + 2 * q), Math.round(minM + 3 * q), maxM];
                return [[c[0], c[1]], [c[1] + 1, c[2]], [c[2] + 1, c[3]], [c[3] + 1, c[4]]].filter(([a, b]) => b >= a);
            })();
        const avgM = table.reduce((s, r) => s + r.m * r.probability, 0);
        res.json({
            minM, maxM, alpha,
            avgM: Math.round(avgM * 10) / 10,
            bands: freeQuotaBandProbabilities(table, bands),
        });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── Key API đã cấp cho khách (IssuedApiKey) ──────────────────────────────────
// Chỉ xem — GPT2API không cho liệt kê/vô hiệu/xoá key, nên "ẩn" chỉ giấu khỏi
// /mykey chứ không thu hồi được. Key nguyên văn chỉ trả ở endpoint chi tiết.
const ISSUED_KEY_SOURCES = ["GIFTCODE", "PURCHASE", "ADMIN"];

function maskIssuedKey(key) {
    const s = String(key || "");
    return s.length <= 14 ? s : `${s.slice(0, 10)}…${s.slice(-4)}`;
}

// Đặt TRƯỚC "/issued-keys/:id" — nếu không "stats" bị bắt làm :id.
router.get("/issued-keys/stats", async (req, res) => {
    try {
        const all = await prisma.issuedApiKey.findMany({ select: { quotaTokens: true, source: true, priceUsd: true, orderId: true } });
        const bySource = { GIFTCODE: 0, PURCHASE: 0, ADMIN: 0, REFERRAL: 0 };
        let totalQuota = 0;
        for (const k of all) {
            totalQuota += Number(k.quotaTokens) || 0;
            if (bySource[k.source] != null) bySource[k.source] += 1;
        }
        // Doanh thu USD: priceUsd trên key (đơn mua có), fallback order.displayFinalUsd.
        const needOrder = [...new Set(all.filter((k) => k.priceUsd == null && k.orderId).map((k) => k.orderId))];
        let orderUsd = {};
        if (needOrder.length) {
            const orders = await prisma.order.findMany({ where: { id: { in: needOrder } }, select: { id: true, displayFinalUsd: true } });
            orderUsd = Object.fromEntries(orders.map((o) => [o.id, Number(o.displayFinalUsd) || 0]));
        }
        let revenueUsd = 0;
        for (const k of all) {
            if (k.priceUsd != null) revenueUsd += Number(k.priceUsd) || 0;
            else if (k.orderId) revenueUsd += orderUsd[k.orderId] || 0;
        }
        res.json({ total: all.length, totalQuota, revenueUsd: Math.round(revenueUsd * 100) / 100, bySource });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get("/issued-keys", async (req, res) => {
    try {
        const page = Math.max(1, Number(req.query.page) || 1);
        const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));
        const source = ISSUED_KEY_SOURCES.includes(req.query.source) ? req.query.source : "";
        const q = String(req.query.q || "").trim();

        const [rows, total] = await Promise.all([
            listAllIssuedKeys({ limit, skip: (page - 1) * limit, source, q }),
            countAllIssuedKeys({ source, q }),
        ]);

        // Join thủ công: order (giá USD + trạng thái), giftcode (code), user (tên).
        const orderIds = [...new Set(rows.map((k) => k.orderId).filter(Boolean))];
        const giftIds = [...new Set(rows.map((k) => k.giftCodeId).filter(Boolean))];
        const tgIds = [...new Set(rows.map((k) => String(k.telegramId)).filter(Boolean))];
        const [orders, gifts, users] = await Promise.all([
            orderIds.length ? prisma.order.findMany({ where: { id: { in: orderIds } }, select: { id: true, displayFinalUsd: true, finalAmount: true, status: true } }) : [],
            giftIds.length ? prisma.giftCode.findMany({ where: { id: { in: giftIds } }, select: { id: true, code: true } }) : [],
            tgIds.length ? prisma.user.findMany({ where: { telegramId: { in: tgIds } }, select: { telegramId: true, firstName: true, username: true } }) : [],
        ]);
        const orderById = Object.fromEntries(orders.map((o) => [o.id, o]));
        const giftById = Object.fromEntries(gifts.map((g) => [g.id, g]));
        const userByTg = Object.fromEntries(users.map((u) => [String(u.telegramId), u]));

        const keys = rows.map((k) => {
            const o = k.orderId ? orderById[k.orderId] : null;
            const u = userByTg[String(k.telegramId)];
            return {
                id: k.id,
                telegramId: k.telegramId,
                userName: u ? (u.firstName || u.username || "") : "",
                userUsername: u?.username || "",
                quotaTokens: k.quotaTokens,
                rpm: k.rpm,
                source: k.source,
                priceUsd: k.priceUsd ?? o?.displayFinalUsd ?? null,
                orderId: k.orderId || null,
                orderCode: k.orderId ? String(k.orderId).slice(-8).toUpperCase() : null,
                orderStatus: o?.status || null,
                giftCode: k.giftCodeId ? (giftById[k.giftCodeId]?.code || null) : null,
                giftCodeId: k.giftCodeId || null,
                externalId: k.externalId || null,
                models: k.models || [],
                keyMasked: maskIssuedKey(k.key),
                // Server đã cấp. Key cũ (trước khi tách nhiều server) → null.
                profileId: k.profileId ?? null,
                profileName: k.profileName || "",
                expiresAt: k.expiresAt || null,
                hiddenAt: k.hiddenAt || null,
                createdAt: k.createdAt,
            };
        });
        res.json({ keys, total, page, limit });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// Admin cấp key thủ công (source = ADMIN). TẠO KEY THẬT trên GPT2API → tốn credit.
router.post("/issued-keys", async (req, res) => {
    try {
        const telegramId = String(req.body?.telegramId || "").trim();
        const tokens = Math.floor(Number(req.body?.tokens) || 0);
        const rpm = Math.max(0, Math.floor(Number(req.body?.rpm) || 0));
        const validDays = Math.max(0, Math.floor(Number(req.body?.validDays) || 0));
        const notify = req.body?.notify === true;
        // Server nào cấp. Bỏ trống = server đầu tiên đang bật (hành vi cũ).
        const profileId = req.body?.profileId === undefined || req.body?.profileId === null || req.body?.profileId === ""
            ? null
            : Math.floor(Number(req.body.profileId)) || null;

        if (!/^\d{3,}$/.test(telegramId)) return res.status(400).json({ error: "telegramId không hợp lệ" });
        if (tokens < 1) return res.status(400).json({ error: "Số token phải >= 1" });

        const shopCfg = await getGpt2apiConfig();
        if (!shopCfg.configured) return res.status(400).json({ error: "Chưa cấu hình GPT2API (tab Kết nối)" });
        // models/endpoint trong tin nhắn gửi khách phải là của ĐÚNG server đã cấp.
        const cfg = await getProfileConfig(profileId);

        const created = await createApiKey({
            quotaTokens: tokens,
            name: `admin-${telegramId}-${Date.now()}`,
            rpm: rpm > 0 ? rpm : undefined,
            validDays: validDays > 0 ? validDays : 0,
            profileId,
        });
        if (!created.ok) {
            return res.status(502).json({ error: created.message || "GPT2API từ chối tạo key", code: created.code });
        }

        const expiresAt = created.expiresAt
            || (validDays > 0 ? new Date(Date.now() + validDays * 86_400_000).toISOString() : null);

        const saved = await saveIssuedKey({
            telegramId, key: created.key, quotaTokens: tokens, rpm,
            source: KeySource.ADMIN, externalId: created.id, expiresAt,
            models: cfg.models || [],
            profileId: created.profileId ?? cfg.profileId ?? null,
            profileName: created.profileName || cfg.profileName || "",
        });
        await logAction("web-admin", "ISSUE_API_KEY", telegramId, {
            tokens, rpm, validDays, externalId: created.id,
            profile: created.profileName || cfg.profileName || "",
        });

        let notified = false;
        if (notify && _bot?.telegram) {
            try {
                await _bot.telegram.sendMessage(telegramId, apiKeyMessage({
                    key: created.key, quotaTokens: tokens, rpm, models: cfg.models || [],
                    endpoint: cfg.endpoint, usageUrl: cfg.usageUrl, mykeyCommand: "/mykey",
                    kind: "buy", expiresAt, lang: "vi", icon: iconOf,
                }), { parse_mode: "HTML" });
                notified = true;
            } catch (e) { console.error("[issue-key] notify fail:", e.message); }
        }

        res.json({ ok: true, id: saved?.id || null, key: created.key, notified });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get("/issued-keys/:id", async (req, res) => {
    try {
        const k = await prisma.issuedApiKey.findUnique({ where: { id: req.params.id } });
        if (!k || !k.id) return res.status(404).json({ error: "Không tìm thấy key" });
        const [order, gift, user, redemption] = await Promise.all([
            k.orderId ? prisma.order.findUnique({ where: { id: k.orderId } }).catch(() => null) : null,
            k.giftCodeId ? prisma.giftCode.findUnique({ where: { id: k.giftCodeId } }).catch(() => null) : null,
            prisma.user.findUnique({ where: { telegramId: String(k.telegramId) } }).catch(() => null),
            prisma.giftCodeRedemption.findFirst({ where: { issuedKeyId: k.id } }).catch(() => null),
        ]);
        res.json({
            key: k, // nguyên văn — admin cần để trace / hỗ trợ khách
            order: order ? {
                id: order.id, code: String(order.id).slice(-8).toUpperCase(), status: order.status,
                displayFinalUsd: order.displayFinalUsd ?? null, finalAmount: order.finalAmount ?? null,
                createdAt: order.createdAt,
            } : null,
            giftCode: gift ? { id: gift.id, code: gift.code, rewardType: gift.rewardType } : null,
            user: user ? { telegramId: user.telegramId, firstName: user.firstName, username: user.username } : null,
            redemption: redemption ? { id: redemption.id, status: redemption.status, createdAt: redemption.createdAt } : null,
        });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post("/issued-keys/:id/hide", async (req, res) => {
    try {
        const hidden = req.body?.hidden !== false; // mặc định = ẩn
        const k = await setIssuedKeyHidden(req.params.id, hidden);
        if (!k || !k.id) return res.status(404).json({ error: "Không tìm thấy key" });
        await logAction("web-admin", hidden ? "HIDE_ISSUED_KEY" : "UNHIDE_ISSUED_KEY", req.params.id, { telegramId: k.telegramId });
        res.json({ ok: true, hiddenAt: k.hiddenAt || null });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── Audit Logs ───────────────────────────────────────────────────────────────
router.get("/audit-logs", async (req, res) => {
    try {
        const page = Math.max(1, Number(req.query.page) || 1);
        const limit = Math.min(100, Number(req.query.limit) || 20);
        const where = {};
        if (req.query.actions) where.action = { in: req.query.actions.split(",") };
        if (req.query.adminId) where.adminId = req.query.adminId;
        if (req.query.target) where.target = { contains: req.query.target };
        if (req.query.startDate || req.query.endDate) {
            where.createdAt = {};
            if (req.query.startDate) where.createdAt.gte = new Date(req.query.startDate);
            if (req.query.endDate) where.createdAt.lte = new Date(req.query.endDate + "T23:59:59");
        }
        const [logs, total] = await Promise.all([
            prisma.auditLog.findMany({ where, skip: (page - 1) * limit, take: limit, orderBy: { createdAt: "desc" } }),
            prisma.auditLog.count({ where }),
        ]);
        res.json({ logs, total });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── Settings ─────────────────────────────────────────────────────────────────
router.get("/settings", async (req, res) => {
    try {
        const rows = await prisma.setting.findMany();
        const dbSettings = Object.fromEntries(rows.map((r) => [r.key, r.value]));
        // Merge env var defaults so admin panel always shows real effective values
        const envDefaults = {
            SHOP_NAME: process.env.SHOP_NAME || "",
            SHOP_DESC: process.env.SHOP_DESC || "",
            SHOP_SUPPORT_USERNAME: process.env.ADMIN_TELEGRAM || "",
            WELCOME_GREETING: process.env.WELCOME_GREETING || "",
            SHOP_BANK_NAME: process.env.BANK_NAME || "",
            SHOP_BANK_ACCOUNT: process.env.BANK_ACCOUNT || "",
            SHOP_BANK_ACCOUNT_NAME: process.env.BANK_ACCOUNT_NAME || "",
            BANK_CODE: process.env.BANK_CODE || "MB",
            // KHÔNG trả ADMIN_SECRET/ADMIN_IDS xuống client — đó là token xác thực admin, lộ là mất an toàn.
            MIN_DEPOSIT: process.env.MIN_DEPOSIT || "10000",
            CURRENCY: process.env.CURRENCY || "VND",
            TIMEZONE: process.env.TIMEZONE || "Asia/Ho_Chi_Minh",
            SUPPORT_CHANNEL_URL: process.env.SUPPORT_CHANNEL_URL || "",
            ORDER_NOTIFY_CHANNEL: process.env.ORDER_NOTIFY_CHANNEL || "",
            ORDER_CHANNEL_NOTIFY_ENABLED: process.env.ORDER_CHANNEL_NOTIFY_ENABLED || "true",
            ORDER_BOT_BROADCAST_ENABLED: process.env.ORDER_BOT_BROADCAST_ENABLED || process.env.NEW_ORDER_BROADCAST || "true",
            ORDER_EXPIRE_MINUTES: process.env.ORDER_EXPIRE_MINUTES || "10",
            MAX_DEPOSIT: process.env.MAX_DEPOSIT || "",
            DEPOSIT_PRESETS: "",
            CRYPTO_PAY_ENABLED: process.env.CRYPTO_PAY_ENABLED || "true",
            CRYPTO_POLL_ENABLED: process.env.CRYPTO_POLL_ENABLED || "true",
            CRYPTO_POLL_INTERVAL_MS: process.env.CRYPTO_POLL_INTERVAL_MS || "15000",
            CRYPTO_EXPIRE_MINUTES: process.env.CRYPTO_EXPIRE_MINUTES || "",
            CRYPTO_USD_VND_RATE: process.env.CRYPTO_USD_VND_RATE || process.env.USD_VND_RATE || "25000",
            TRC20_USDT_ADDRESS: process.env.TRC20_USDT_ADDRESS || "",
            TRONGRID_API_KEY: process.env.TRONGRID_API_KEY || "",
            BEP20_USDT_ADDRESS: process.env.BEP20_USDT_ADDRESS || "",
            BINANCE_API_KEY: process.env.BINANCE_API_KEY || "",
            BINANCE_PAY_ID: process.env.BINANCE_PAY_ID || "",
        };
        const settings = { ...envDefaults, ...dbSettings };
        if (!("ORDER_BOT_BROADCAST_ENABLED" in dbSettings) && "NEW_ORDER_BROADCAST" in dbSettings) {
            settings.ORDER_BOT_BROADCAST_ENABLED = dbSettings.NEW_ORDER_BROADCAST;
        }
        // SEPAY_API_KEY là secret → KHÔNG trả giá trị thật xuống client. Chỉ trả cờ
        // đã-cấu-hình để FE hiện trạng thái + ô nhập key mới (không lộ key cũ).
        const sepaySet = !!(dbSettings.SEPAY_API_KEY || process.env.SEPAY_API_KEY || process.env.SEPAY_SECRET_KEY);
        delete settings.SEPAY_API_KEY;
        settings.SEPAY_API_KEY_SET = sepaySet ? "1" : "";
        // BINANCE_API_SECRET cũng vậy: lộ secret là ai cũng ký được request thay shop.
        const binanceSecretSet = !!(dbSettings.BINANCE_API_SECRET || process.env.BINANCE_API_SECRET);
        delete settings.BINANCE_API_SECRET;
        settings.BINANCE_API_SECRET_SET = binanceSecretSet ? "1" : "";
        // Token thueapibank đọc được TOÀN BỘ lịch sử giao dịch Binance chỉ bằng một
        // GET — lộ ra là mất quyền riêng tư dòng tiền, nên không trả về client.
        const binancePayTokenSet = !!(dbSettings.BINANCE_PAY_TOKEN || process.env.BINANCE_PAY_TOKEN);
        delete settings.BINANCE_PAY_TOKEN;
        settings.BINANCE_PAY_TOKEN_SET = binancePayTokenSet ? "1" : "";
        res.json({ settings });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// Danh sách icon key + nhãn + nhóm, lấy trực tiếp từ menu-config.js.
// Frontend fetch cái này thay vì hardcode lại danh sách → thêm icon mới chỉ cần sửa menu-config.js.
router.get("/settings/icon-keys", (_req, res) => {
    res.json({
        groups: ICON_GROUPS.map((g) => ({
            id: g.id,
            label: g.label,
            items: g.items.map((i) => ({ key: i.key, label: i.label, def: i.icon })),
        })),
    });
});

// Nạp toàn bộ custom emoji của 1 emoji pack theo short_name (phần sau t.me/addemoji/).
// Trả về id + emoji tương ứng để admin click chọn, không phải dán ID thủ công.
router.get("/settings/emoji-pack", async (req, res) => {
    try {
        if (!_bot?.telegram?.callApi) {
            return res.status(503).json({ error: "Bot Telegram chưa sẵn sàng" });
        }
        const raw = String(req.query.name || "").trim();
        if (!raw) return res.status(400).json({ error: "Thiếu tên pack" });
        // Cho phép dán cả link t.me/addemoji/xxx
        const name = raw.replace(/^https?:\/\/(t\.me|telegram\.me)\/addemoji\//i, "").replace(/[?#].*$/, "").trim();
        if (!/^[A-Za-z0-9_]{1,64}$/.test(name)) {
            return res.status(400).json({ error: "Tên pack không hợp lệ" });
        }

        const set = await _bot.telegram.callApi("getStickerSet", { name });
        const stickers = (set?.stickers || [])
            .filter((s) => s?.custom_emoji_id)
            .map((s) => ({
                id: String(s.custom_emoji_id),
                emoji: s.emoji || null,
                thumbFileId: s.thumbnail?.file_id || s.thumb?.file_id || s.file_id || null,
            }));

        if (!stickers.length) {
            return res.status(400).json({
                error: set?.sticker_type && set.sticker_type !== "custom_emoji"
                    ? `Pack "${name}" là sticker thường, không phải custom emoji`
                    : `Pack "${name}" không có custom emoji nào`,
            });
        }

        res.json({ name: set.name, title: set.title, stickerType: set.sticker_type || null, stickers });
    } catch (error) {
        const message = error?.response?.description || error.message || "Không tải được pack";
        res.status(/not found|STICKERSET_INVALID/i.test(message) ? 404 : 502).json({ error: message });
    }
});

// Proxy ảnh thumbnail của emoji — giữ BOT_TOKEN ở server, không lộ ra client.
router.get("/settings/emoji-thumb/:fileId", async (req, res) => {
    try {
        if (!_bot?.telegram?.getFileLink) {
            return res.status(503).json({ error: "Bot Telegram chưa sẵn sàng" });
        }
        const fileId = String(req.params.fileId || "");
        if (!/^[A-Za-z0-9_-]{10,200}$/.test(fileId)) {
            return res.status(400).json({ error: "file_id không hợp lệ" });
        }
        const link = await _bot.telegram.getFileLink(fileId);
        const url = new URL(String(link));
        if (url.hostname !== "api.telegram.org") {
            return res.status(502).json({ error: "Đường dẫn file không hợp lệ" });
        }
        // Telegram trả octet-stream cho thumbnail — suy MIME từ đuôi để <img> render được.
        const ext = (url.pathname.match(/\.(\w+)$/)?.[1] || "").toLowerCase();
        const mime = { webp: "image/webp", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif" }[ext];
        await new Promise((resolve, reject) => {
            const upstream = httpsReq(url, { method: "GET" }, (r) => {
                if ((r.statusCode || 500) >= 400) {
                    res.status(502).json({ error: `Telegram trả về ${r.statusCode}` });
                    r.resume();
                    return resolve();
                }
                res.setHeader("Content-Type", mime || r.headers["content-type"] || "application/octet-stream");
                res.setHeader("Cache-Control", "public, max-age=86400");
                r.pipe(res);
                r.on("end", resolve);
                r.on("error", reject);
            });
            upstream.on("error", reject);
            upstream.end();
        });
    } catch (error) {
        if (!res.headersSent) {
            res.status(502).json({ error: error.message || "Không tải được ảnh emoji" });
        }
    }
});

router.post("/settings/check-icons", async (req, res) => {
    try {
        if (!_bot?.telegram?.callApi) {
            return res.status(503).json({ error: "Bot Telegram chưa sẵn sàng để kiểm tra icon" });
        }

        const iconIds = req.body?.iconIds || {};
        const normalized = Object.fromEntries(
            Object.entries(iconIds)
                .map(([key, value]) => [key, normalizeCustomEmojiId(value)])
                .filter(([, value]) => value),
        );
        const ids = [...new Set(Object.values(normalized))];
        if (!ids.length) {
            return res.json(buildCustomEmojiCheckResult({}, []));
        }
        if (ids.length > 200) {
            return res.status(400).json({ error: "Chỉ có thể kiểm tra tối đa 200 Custom Emoji ID mỗi lần" });
        }

        const stickers = await _bot.telegram.callApi("getCustomEmojiStickers", {
            custom_emoji_ids: ids,
        });
        res.json(buildCustomEmojiCheckResult(normalized, stickers));
    } catch (error) {
        const message = error?.response?.description || error.message || "Không kiểm tra được icon";
        const status = /Custom Emoji ID|tối đa 200/.test(message) ? 400 : 502;
        res.status(status).json({ error: message });
    }
});

router.put("/settings", async (req, res) => {
    try {
        const updates = { ...req.body };
        if ("menu_button_ids" in updates) {
            const rawIds = JSON.parse(String(updates.menu_button_ids || "{}"));
            updates.menu_button_ids = JSON.stringify(Object.fromEntries(
                Object.entries(rawIds)
                    .map(([key, value]) => [key, normalizeCustomEmojiId(value)])
                    .filter(([, value]) => value),
            ));
        }
        await Promise.all(
            Object.entries(updates).map(([key, value]) =>
                prisma.setting.upsert({ where: { key }, update: { value: String(value) }, create: { key, value: String(value) } })
            )
        );
        // BTN_* = cờ ẩn/hiện nút menu chính. Không xoá cache ở đây thì admin gạt
        // công tắc xong bot vẫn hiện nút cũ cho tới lần restart sau.
        const touchedMenu = "menu_buttons" in updates || "menu_button_ids" in updates
            || Object.keys(updates).some((k) => k.startsWith("BTN_"));
        if (touchedMenu) invalidateMenuCache();
        // Invalidate shop-config cache nếu có thay đổi key liên quan
        const shopKeys = [
            "SHOP_BANK_NAME", "SHOP_BANK_ACCOUNT", "SHOP_BANK_ACCOUNT_NAME", "BANK_CODE",
            "SUPPORT_CHANNEL_URL", "ORDER_NOTIFY_CHANNEL", "ORDER_CHANNEL_NOTIFY_ENABLED", "ORDER_BOT_BROADCAST_ENABLED", "ORDER_EXPIRE_MINUTES", "MAX_DEPOSIT", "DEPOSIT_PRESETS",
            "CRYPTO_PAY_ENABLED", "CRYPTO_POLL_ENABLED", "CRYPTO_POLL_INTERVAL_MS", "CRYPTO_EXPIRE_MINUTES",
            "CRYPTO_USD_VND_RATE", "TRC20_USDT_ADDRESS", "TRONGRID_API_KEY", "BEP20_USDT_ADDRESS",
            "BINANCE_API_KEY", "BINANCE_API_SECRET", "BINANCE_PAY_ID", "BINANCE_PAY_TOKEN", "SEPAY_API_KEY",
        ];
        if (shopKeys.some((k) => k in updates)) invalidateShopConfig();
        logAction("web-admin", "UPDATE_SETTINGS", "settings", { keys: Object.keys(updates) });
        res.json({ ok: true });
    } catch (e) { res.status(/Custom Emoji ID|JSON/.test(e.message) ? 400 : 500).json({ error: e.message }); }
});

// ─── API Providers ───────────────────────────────────────────────────────────
async function getProviders(p) {
    const s = await p.setting.findUnique({ where: { key: "api_providers" } });
    return s ? JSON.parse(s.value) : [];
}
async function saveProviders(p, providers) {
    await p.setting.upsert({ where: { key: "api_providers" }, update: { value: JSON.stringify(providers) }, create: { key: "api_providers", value: JSON.stringify(providers) } });
}

router.get("/api-providers", async (req, res) => {
    try { res.json({ providers: await getProviders(prisma) }); }
    catch (e) { res.status(500).json({ error: e.message }); }
});

router.post("/api-providers", async (req, res) => {
    try {
        const { name, baseUrl, apiKey, authMode, listEndpoint, purchaseEndpoint, customHeaders, currency } = req.body;
        if (!name || !baseUrl) return res.status(400).json({ error: "name và baseUrl là bắt buộc" });
        const providers = await getProviders(prisma);
        const provider = { id: Date.now().toString(), name, baseUrl: baseUrl.replace(/\/$/, ""), apiKey: apiKey || "", authMode: authMode || "bearer", listEndpoint: listEndpoint || "/products", purchaseEndpoint: purchaseEndpoint || "/orders", customHeaders: customHeaders || "", currency: currency || "VND", createdAt: new Date().toISOString() };
        providers.push(provider);
        await saveProviders(prisma, providers);
        res.json(provider);
    } catch (e) { console.error("[api-providers POST]", e); res.status(500).json({ error: e.message }); }
});

router.put("/api-providers/:id", async (req, res) => {
    try {
        const providers = await getProviders(prisma);
        const idx = providers.findIndex((p) => p.id === req.params.id);
        if (idx === -1) return res.status(404).json({ error: "Not found" });
        const { baseUrl, authMode, ...rest } = req.body;
        providers[idx] = { ...providers[idx], ...rest, ...(baseUrl ? { baseUrl: baseUrl.replace(/\/$/, "") } : {}), ...(authMode ? { authMode } : {}) };
        await saveProviders(prisma, providers);
        res.json(providers[idx]);
    } catch (e) { console.error("[api-providers PUT]", e); res.status(500).json({ error: e.message }); }
});

// Sản phẩm import từ provider được lưu là Product thường (deliveryMode API_CALL),
// liên kết provider chỉ nằm trong payload JSON → phải quét tay để tìm.
async function findProviderProducts(providerId) {
    const rows = await prisma.product.findMany({
        where: { deliveryMode: "API_CALL" },
        select: { id: true, name: true, payload: true, isActive: true },
    });
    return rows.filter((r) => {
        try { return JSON.parse(r.payload || "{}").providerId === providerId; }
        catch { return false; }
    });
}

// Đếm sản phẩm đã import — UI hỏi trước khi xóa provider.
router.get("/api-providers/:id/products", async (req, res) => {
    try {
        const items = await findProviderProducts(req.params.id);
        res.json({ count: items.length, products: items.map(({ id, name, isActive }) => ({ id, name, isActive })) });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ?products=keep (mặc định) | disable | delete
router.delete("/api-providers/:id", async (req, res) => {
    try {
        const mode = req.query.products || "keep";
        const providers = await getProviders(prisma);
        if (!providers.some((p) => p.id === req.params.id)) return res.status(404).json({ error: "Not found" });

        let affected = 0;
        if (mode === "disable" || mode === "delete") {
            const items = await findProviderProducts(req.params.id);
            const ids = items.map((i) => i.id);
            if (ids.length) {
                if (mode === "delete") {
                    await prisma.stockItem.deleteMany({ where: { productId: { in: ids } } }).catch(() => {});
                    await prisma.product.deleteMany({ where: { id: { in: ids } } });
                } else {
                    await prisma.product.updateMany({ where: { id: { in: ids } }, data: { isActive: false } });
                }
                affected = ids.length;
                invalidateCategoryCache();
            }
        }

        await saveProviders(prisma, providers.filter((p) => p.id !== req.params.id));
        logAction("web-admin", "DELETE_API_PROVIDER", req.params.id, { products: mode, affected });
        res.json({ ok: true, affected });
    } catch (e) { console.error("[api-providers DELETE]", e); res.status(500).json({ error: e.message }); }
});

// Dọn sản phẩm mồ côi: payload trỏ tới provider đã bị xóa trước đây.
router.get("/api-providers-orphans", async (req, res) => {
    try {
        const ids = new Set((await getProviders(prisma)).map((p) => p.id));
        const rows = await prisma.product.findMany({
            where: { deliveryMode: "API_CALL" },
            select: { id: true, name: true, price: true, isActive: true, payload: true },
        });
        const orphans = rows.filter((r) => {
            try { const pid = JSON.parse(r.payload || "{}").providerId; return pid && !ids.has(pid); }
            catch { return false; }
        }).map(({ id, name, price, isActive }) => ({ id, name, price, isActive }));
        res.json({ count: orphans.length, products: orphans });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post("/api-providers-orphans/cleanup", async (req, res) => {
    try {
        const mode = req.body?.mode === "delete" ? "delete" : "disable";
        const ids = new Set((await getProviders(prisma)).map((p) => p.id));
        const rows = await prisma.product.findMany({ where: { deliveryMode: "API_CALL" }, select: { id: true, payload: true } });
        const orphanIds = rows.filter((r) => {
            try { const pid = JSON.parse(r.payload || "{}").providerId; return pid && !ids.has(pid); }
            catch { return false; }
        }).map((r) => r.id);
        if (orphanIds.length) {
            if (mode === "delete") {
                await prisma.stockItem.deleteMany({ where: { productId: { in: orphanIds } } }).catch(() => {});
                await prisma.product.deleteMany({ where: { id: { in: orphanIds } } });
            } else {
                await prisma.product.updateMany({ where: { id: { in: orphanIds } }, data: { isActive: false } });
            }
            invalidateCategoryCache();
        }
        logAction("web-admin", "CLEANUP_ORPHAN_PRODUCTS", "-", { mode, affected: orphanIds.length });
        res.json({ ok: true, affected: orphanIds.length });
    } catch (e) { console.error("[orphans cleanup]", e); res.status(500).json({ error: e.message }); }
});

router.post("/api-providers/:id/fetch-products", async (req, res) => {
    try {
        const providers = await getProviders(prisma);
        const provider = providers.find((p) => p.id === req.params.id);
        if (!provider) return res.status(404).json({ error: "Provider not found" });

        const headers = { "Accept": "application/json" };
        const authMode = provider.authMode || "bearer";
        if (provider.apiKey) {
            if (authMode === "bearer")    headers["Authorization"] = `Bearer ${provider.apiKey}`;
            else if (authMode === "plain") headers["Authorization"] = provider.apiKey;
            else if (authMode === "x-api-key") headers["X-Api-Key"] = provider.apiKey;
            // authMode === "none" → no auth header, rely on customHeaders
        }
        if (provider.customHeaders) {
            provider.customHeaders.split("\n").forEach((line) => {
                const [k, ...v] = line.split(":"); if (k && v.length) headers[k.trim()] = v.join(":").trim();
            });
        }

        let url = `${provider.baseUrl}${provider.listEndpoint}`;
        if (authMode === "query" && provider.apiKey) {
            const sep = url.includes("?") ? "&" : "?";
            url += `${sep}api_key=${encodeURIComponent(provider.apiKey)}`;
        }

        const data = await httpGetJson(url, headers);
        // Try common envelope keys; fall back to raw data as array
        const products = Array.isArray(data)
            ? data
            : (data.data || data.products || data.items || data.result || data.services || data.list || []);
        res.json({ products, total: products.length, rawSample: products.length === 0 ? data : undefined });
    } catch (e) { res.status(400).json({ error: e.cause?.message || e.message }); }
});

router.post("/api-providers/:id/import", async (req, res) => {
    try {
        const providers = await getProviders(prisma);
        const provider = providers.find((p) => p.id === req.params.id);
        if (!provider) return res.status(404).json({ error: "Provider not found" });
        const { products, idField = "", stockField = "", unlisted = false } = req.body;
        if (!Array.isArray(products) || !products.length) return res.json({ created: 0 });
        // unlisted=true: import cả lô dạng ẩn — không hiện trong danh mục/web shop,
        // chỉ bán qua link t.me/<bot>?start=product_<id>.
        const asUnlisted = unlisted === true || unlisted === "true";
        const created = [];
        for (let i = 0; i < products.length; i++) {
            const item = products[i];
            const payload = JSON.stringify({ providerId: provider.id, providerProductId: item.originalId, purchaseEndpoint: provider.purchaseEndpoint, listEndpoint: provider.listEndpoint || "", idField, stockField, baseUrl: provider.baseUrl, apiKey: provider.apiKey, authMode: provider.authMode || "bearer", customHeaders: provider.customHeaders || "" });
            const product = await prisma.product.create({
                data: { code: autoCode(item.name, i), name: item.name, price: Number(item.price) || 0, currency: provider.currency || "VND", deliveryMode: "API_CALL", payload, description: item.description || null, categoryId: item.categoryId || null, isActive: true, unlisted: asUnlisted },
            });
            created.push(product);
        }
        logAction("web-admin", "IMPORT_PRODUCTS", req.params.id, { count: created.length, unlisted: asUnlisted });
        invalidateCategoryCache();
        res.json({ created: created.length });
    } catch (e) { console.error("[import-products]", e); res.status(500).json({ error: e.message }); }
});

// ─── Referral Stats ──────────────────────────────────────────────────────────
router.get("/referral-stats", async (req, res) => {
    try {
        const [agg, totalReferrals, commissions, referrals] = await Promise.all([
            prisma.referral.aggregate({ _sum: { commission: true } }),
            prisma.referral.count(),
            prisma.referral.findMany({
                take: 50, orderBy: { createdAt: "desc" },
                include: { referee: { select: { firstName: true, username: true, telegramId: true } }, referrer: { select: { firstName: true, username: true, telegramId: true } } },
            }),
            prisma.user.findMany({
                where: { referralReceived: { isNot: null } },
                take: 50, orderBy: { createdAt: "desc" },
                select: { id: true, telegramId: true, firstName: true, username: true, createdAt: true, totalSpent: true },
            }),
        ]);
        res.json({
            totalCommissions: agg._sum.commission || 0,
            totalReferrals,
            commissions,
            referrals,
        });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// Bảng xếp hạng người mời + tổng chi phí chương trình (token đã tặng).
router.get("/referral/leaderboard", async (req, res) => {
    try {
        const data = await getReferralLeaderboard({ limit: Number(req.query.limit) || 50 });
        res.json(data);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// Cấu hình quà mời bạn. `effective` = giá trị ĐANG áp dụng (DB Setting > ENV >
// mặc định) để UI đổ vào ô khi Setting còn trống — giống tab GPT2API.
router.get("/referral/config", async (req, res) => {
    try {
        const rows = await prisma.setting.findMany({ where: { key: { in: REFERRAL_SETTING_KEYS } } });
        const map = Object.fromEntries(rows.map((r) => [r.key, r.value]));
        const cfg = await getReferralConfig();
        res.json({
            config: map,
            effective: {
                tokensM: cfg.tokensM,
                tokens: cfg.tokens,
                days: cfg.days,
                rpm: cfg.rpm,
                since: cfg.since ? cfg.since.toISOString().slice(0, 10) : "",
                commissionPercent: cfg.commissionPercent,
                enabled: cfg.enabled,
            },
            // RPM thật sự dùng khi để 0 (theo cấu hình cửa hàng API key).
            shopRpm: (await getGpt2apiConfig().catch(() => null))?.rpm ?? 300,
        });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put("/referral/config", async (req, res) => {
    try {
        const body = req.body || {};
        const updates = REFERRAL_SETTING_KEYS
            .filter((k) => body[k] !== undefined && body[k] !== null)
            .map((k) => [k, String(body[k]).trim()]);
        if (!updates.length) return res.json({ ok: true, updated: 0 });

        // Chặn số vô lý ngay ở API — Setting sai kiểu thì bot âm thầm rơi về ENV.
        for (const [k, v] of updates) {
            if (k === "REFERRAL_REWARD_SINCE") {
                if (v && Number.isNaN(new Date(v).getTime())) {
                    return res.status(400).json({ error: "Ngày bắt đầu không hợp lệ (dùng YYYY-MM-DD)" });
                }
                continue;
            }
            if (v === "") continue; // rỗng = xoá override, quay về ENV/mặc định
            const n = Number(v);
            if (!Number.isFinite(n) || n < 0) return res.status(400).json({ error: `${k} phải là số >= 0` });
            if (k === "REFERRAL_COMMISSION" && n > 100) return res.status(400).json({ error: "Hoa hồng tối đa 100%" });
            if (k === "REFERRAL_REWARD_TOKENS_M" && n > 100_000) return res.status(400).json({ error: "Token tối đa 100.000M mỗi key" });
            if (k === "REFERRAL_REWARD_DAYS" && n > 3650) return res.status(400).json({ error: "Số ngày tối đa 3650" });
            if (k === "REFERRAL_REWARD_RPM" && n > 100_000) return res.status(400).json({ error: "RPM tối đa 100.000" });
        }

        await Promise.all(updates.map(([k, v]) =>
            prisma.setting.upsert({ where: { key: k }, update: { value: v }, create: { key: k, value: v } })
        ));
        invalidateReferralConfig();
        await logAction("web-admin", "UPDATE_REFERRAL_CONFIG", "settings", { keys: updates.map(([k]) => k) });
        res.json({ ok: true, updated: updates.length, effective: await getReferralConfig() });
    } catch (e) { res.status(400).json({ error: e.message }); }
});

// ─── Stock Items ─────────────────────────────────────────────────────────────
router.get("/stock-items", async (req, res) => {
    try {
        const { productId, page = 1, limit = 50, sold } = req.query;
        if (!productId) return res.status(400).json({ error: "productId required" });
        const where = { productId };
        if (sold === "true") where.isSold = true;
        else if (sold === "false") where.isSold = false;
        const [items, total, soldCount] = await Promise.all([
            prisma.stockItem.findMany({ where, skip: (Number(page) - 1) * Number(limit), take: Number(limit), orderBy: { createdAt: "desc" } }),
            prisma.stockItem.count({ where }),
            prisma.stockItem.count({ where: { productId, isSold: true } }),
        ]);
        res.json({ items, total, soldCount });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post("/stock-items/bulk", async (req, res) => {
    try {
        const { productId, lines } = req.body;
        if (!productId || !lines) return res.status(400).json({ error: "productId và lines là bắt buộc" });
        const contents = String(lines).split("\n").map((l) => l.trim()).filter(Boolean);
        if (!contents.length) return res.status(400).json({ error: "Không có dòng hợp lệ" });
        const result = await prisma.stockItem.createMany({
            data: contents.map((content) => ({ productId, content })),
        });
        invalidateStockCache(productId);
        await autoEnableOnStock(productId);
        const product = await prisma.product.findUnique({ where: { id: productId }, select: { name: true, imageFileId: true, imageUrl: true } });
        const currentStock = await prisma.stockItem.count({ where: { productId, isSold: false } });
        if (_bot && ADMIN_IDS.length) {
            await Promise.allSettled(
                ADMIN_IDS.map((id) => _bot.telegram.sendMessage(
                    id,
                    `${iconOf("STOCK_IMPORT_OK")} *Nhập kho thành công*\n\n${iconOf("STOCK_IMPORT_PRODUCT")} Sản phẩm: ${product?.name || productId}\n${iconOf("STOCK_IMPORT_ADDED")} Đã thêm: ${result.count} mục\n${iconOf("STOCK_IMPORT_TOTAL")} Tồn kho: ${currentStock}`,
                    { parse_mode: "Markdown" }
                ))
            );
        }
        if (_bot) {
            broadcastStockNotify(_bot, product?.name || productId, productId, result.count, currentStock, product?.imageFileId || product?.imageUrl || null)
                .catch((e) => console.error("broadcastStockNotify error:", e.message));
        }
        logAction("web-admin", "BULK_ADD_STOCK", productId, { count: result.count });
        res.json({ created: result.count });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// Mỗi phần tử trong `items` = 1 stock item nguyên content (không split theo dòng).
// Dùng cho upload nhiều file, mỗi file = 1 sản phẩm.
router.post("/stock-items/bulk-items", async (req, res) => {
    try {
        const { productId, items } = req.body;
        if (!productId || !Array.isArray(items)) return res.status(400).json({ error: "productId và items (mảng) là bắt buộc" });
        const contents = items
            .map((c) => String(c == null ? "" : c).replace(/\r\n/g, "\n").trim())
            .filter(Boolean);
        if (!contents.length) return res.status(400).json({ error: "Không có nội dung hợp lệ" });

        const result = await prisma.stockItem.createMany({
            data: contents.map((content) => ({ productId, content })),
        });
        invalidateStockCache(productId);
        await autoEnableOnStock(productId);
        const product = await prisma.product.findUnique({ where: { id: productId }, select: { name: true, imageFileId: true, imageUrl: true } });
        const currentStock = await prisma.stockItem.count({ where: { productId, isSold: false } });
        if (_bot && ADMIN_IDS.length) {
            await Promise.allSettled(
                ADMIN_IDS.map((id) => _bot.telegram.sendMessage(
                    id,
                    `${iconOf("STOCK_IMPORT_OK")} *Nhập kho thành công*\n\n${iconOf("STOCK_IMPORT_PRODUCT")} Sản phẩm: ${product?.name || productId}\n${iconOf("STOCK_IMPORT_ADDED")} Đã thêm: ${result.count} file\n${iconOf("STOCK_IMPORT_TOTAL")} Tồn kho: ${currentStock}`,
                    { parse_mode: "Markdown" }
                ))
            );
        }
        if (_bot) {
            broadcastStockNotify(_bot, product?.name || productId, productId, result.count, currentStock, product?.imageFileId || product?.imageUrl || null)
                .catch((e) => console.error("broadcastStockNotify error:", e.message));
        }
        logAction("web-admin", "BULK_ADD_STOCK_FILES", productId, { count: result.count });
        res.json({ created: result.count });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete("/stock-items/:id", async (req, res) => {
    try {
        await prisma.stockItem.delete({ where: { id: req.params.id } });
        logAction("web-admin", "DELETE_STOCK_ITEM", req.params.id);
        res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete("/products/:id/stock-unsold", async (req, res) => {
    try {
        const result = await prisma.stockItem.deleteMany({ where: { productId: req.params.id, isSold: false } });
        logAction("web-admin", "CLEAR_UNSOLD_STOCK", req.params.id, { deleted: result.count });
        res.json({ deleted: result.count });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── VIP Levels ───────────────────────────────────────────────────────────────
router.get("/vip-levels", async (req, res) => {
    try {
        const vipLevels = await prisma.vipLevel.findMany({ orderBy: { level: "asc" } });
        res.json({ vipLevels });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put("/vip-levels/:id", async (req, res) => {
    try {
        const level = await prisma.vipLevel.update({ where: { id: req.params.id }, data: req.body });
        logAction("web-admin", "UPDATE_VIP_LEVEL", req.params.id, { name: level.name, level: level.level });
        res.json(level);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── Broadcast ───────────────────────────────────────────────────────────────
router.get("/broadcast/history", async (req, res) => {
    try { res.json({ history: await getBroadcastHistory(20) }); }
    catch (e) { res.status(500).json({ error: e.message }); }
});

router.post("/broadcast/send", async (req, res) => {
    try {
        const { message, vipOnly, minVip } = req.body;
        if (!message?.trim()) return res.status(400).json({ error: "message trống" });
        if (!_bot) return res.status(503).json({ error: "Bot chưa sẵn sàng" });
        const result = vipOnly
            ? await sendVipBroadcast(_bot, message, Number(minVip) || 1, ADMIN_IDS[0])
            : await sendBroadcast(_bot, message, ADMIN_IDS[0]);
        logAction("web-admin", "SEND_BROADCAST", "broadcast", { sentCount: result.sentCount, vipOnly: !!vipOnly });
        res.json(result);
    } catch (e) { console.error("[broadcast]", e); res.status(500).json({ error: e.message }); }
});

// ─── Export CSV ───────────────────────────────────────────────────────────────
router.get("/export/orders", async (req, res) => {
    try {
        const { filepath, filename } = await exportOrdersCSV({
            status: req.query.status || null,
            search: req.query.search || null,
            start: req.query.start || req.query.startDate || null,
            end: req.query.end || req.query.endDate || null,
        });
        res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
        res.setHeader("Content-Type", "text/csv; charset=utf-8");
        const stream = createReadStream(filepath);
        stream.pipe(res);
        res.on("finish", () => unlink(filepath).catch(() => {}));
    } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get("/export/revenue", async (req, res) => {
    try {
        const { filepath, filename } = await exportRevenueCSV(Number(req.query.days) || 30);
        res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
        res.setHeader("Content-Type", "text/csv; charset=utf-8");
        const stream = createReadStream(filepath);
        stream.pipe(res);
        res.on("finish", () => unlink(filepath).catch(() => {}));
    } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get("/export/users", async (req, res) => {
    try {
        const { filepath, filename } = await exportUsersCSV();
        res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
        res.setHeader("Content-Type", "text/csv; charset=utf-8");
        const stream = createReadStream(filepath);
        stream.pipe(res);
        res.on("finish", () => unlink(filepath).catch(() => {}));
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── Bank Monitor ─────────────────────────────────────────────────────────────
router.get("/bank/status", async (req, res) => {
    try {
        const config = getBankHistoryConfig();
        const today = new Date(); today.setHours(0, 0, 0, 0);
        const [pendingOrders, todayProcessed] = await Promise.all([
            prisma.order.count({ where: { status: "PENDING", paymentMethod: "vietqr" } }),
            prisma.order.count({ where: { status: { in: ["PAID", "DELIVERED"] }, paymentMethod: "vietqr", updatedAt: { gte: today } } }),
        ]);
        res.json({ enabled: config.enabled, accountNo: config.accountNo, accountName: config.accountName, pendingOrders, todayProcessed });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get("/bank/recent", async (req, res) => {
    try {
        const txns = await fetchBankHistory();
        res.json({ transactions: txns.slice(0, 30) });
    } catch (e) { res.status(400).json({ error: e.message }); }
});

// ─── User Activity Feed ───────────────────────────────────────────────────────
router.get("/user-activity", async (req, res) => {
    try {
        const page = Math.max(1, Number(req.query.page) || 1);
        const limit = Math.min(100, Number(req.query.limit) || 30);
        const type = req.query.type || "order";
        const search = req.query.search?.trim() || "";

        if (type === "order") {
            const where = {};
            if (req.query.status) where.status = req.query.status;
            if (search) where.odelegramId = { contains: search };

            const [orders, total] = await Promise.all([
                prisma.order.findMany({ where, skip: (page - 1) * limit, take: limit, orderBy: { createdAt: "desc" }, include: { product: { select: { name: true } } } }),
                prisma.order.count({ where }),
            ]);

            const telegramIds = [...new Set(orders.map((o) => o.odelegramId).filter(Boolean))];
            const users = telegramIds.length ? await prisma.user.findMany({ where: { telegramId: { in: telegramIds } }, select: { telegramId: true, firstName: true, username: true, vipLevel: true } }) : [];
            const userMap = Object.fromEntries(users.map((u) => [u.telegramId, u]));

            return res.json({
                activities: orders.map((o) => ({
                    type: "order", id: o.id, telegramId: o.odelegramId,
                    user: userMap[o.odelegramId] || null,
                    status: o.status, productName: o.product?.name || "?",
                    amount: o.finalAmount, quantity: o.quantity,
                    paymentMethod: o.paymentMethod, createdAt: o.createdAt,
                })),
                total,
            });
        }

        if (type === "wallet") {
            const where = {};
            if (req.query.txType) where.type = { in: req.query.txType.split(",") };
            if (search) {
                const matchedWallets = await prisma.wallet.findMany({
                    where: { odelegramId: { contains: search } }, select: { id: true }, take: 100,
                });
                if (!matchedWallets.length) return res.json({ activities: [], total: 0 });
                where.walletId = { in: matchedWallets.map((w) => w.id) };
            }

            const [txns, total] = await Promise.all([
                prisma.walletTransaction.findMany({ where, skip: (page - 1) * limit, take: limit, orderBy: { createdAt: "desc" } }),
                prisma.walletTransaction.count({ where }),
            ]);

            const walletIds = [...new Set(txns.map((t) => t.walletId).filter(Boolean))];
            const wallets = walletIds.length ? await prisma.wallet.findMany({ where: { id: { in: walletIds } } }) : [];
            const walletMap = Object.fromEntries(wallets.map((w) => [w.id, w]));

            const telegramIds = [...new Set(wallets.map((w) => w.odelegramId).filter(Boolean))];
            const users = telegramIds.length ? await prisma.user.findMany({ where: { telegramId: { in: telegramIds } }, select: { telegramId: true, firstName: true, username: true, vipLevel: true } }) : [];
            const userMap = Object.fromEntries(users.map((u) => [u.telegramId, u]));

            return res.json({
                activities: txns.map((t) => {
                    const wallet = walletMap[t.walletId];
                    return {
                        type: "wallet", id: t.id, telegramId: wallet?.odelegramId,
                        user: wallet ? (userMap[wallet.odelegramId] || null) : null,
                        txType: t.type, amount: t.amount,
                        balanceBefore: t.balanceBefore, balanceAfter: t.balanceAfter,
                        description: t.description, status: t.status, createdAt: t.createdAt,
                    };
                }),
                total,
            });
        }

        res.status(400).json({ error: "type phải là 'order' hoặc 'wallet'" });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── Sidebar badges ───────────────────────────────────────────────────────────
router.get("/sidebar-badges", async (req, res) => {
    try {
        const complaints = await prisma.complaint.count({ where: { status: "OPEN" } }).catch(() => 0);
        res.json({ complaints });
    } catch (e) { res.json({ complaints: 0 }); }
});

// ─── Complaints / Tickets ──────────────────────────────────────────────────────
const COMPLAINT_STATUSES = ["OPEN", "IN_PROGRESS", "RESOLVED", "CLOSED"];

router.get("/complaints", async (req, res) => {
    try {
        const page = Math.max(1, Number(req.query.page) || 1);
        const limit = Math.min(100, Number(req.query.limit) || 30);
        const where = {};
        if (req.query.status && COMPLAINT_STATUSES.includes(req.query.status)) where.status = req.query.status;
        if (req.query.search?.trim()) where.odelegramId = { contains: req.query.search.trim() };

        const [items, total, openCount] = await Promise.all([
            prisma.complaint.findMany({ where, skip: (page - 1) * limit, take: limit, orderBy: { createdAt: "desc" } }),
            prisma.complaint.count({ where }),
            prisma.complaint.count({ where: { status: "OPEN" } }),
        ]);
        res.json({ complaints: items, total, openCount });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get("/complaints/:id", async (req, res) => {
    try {
        const c = await prisma.complaint.findUnique({ where: { id: req.params.id } });
        if (!c) return res.status(404).json({ error: "Không tìm thấy khiếu nại" });
        res.json(c);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post("/complaints/:id/reply", async (req, res) => {
    try {
        const { message } = req.body;
        if (!message?.trim()) return res.status(400).json({ error: "message trống" });
        const c = await prisma.complaint.findUnique({ where: { id: req.params.id } });
        if (!c) return res.status(404).json({ error: "Không tìm thấy khiếu nại" });

        const messages = Array.isArray(c.messages) ? c.messages : [];
        messages.push({ from: "admin", text: message.trim(), at: new Date().toISOString() });
        await prisma.complaint.update({
            where: { id: c.id },
            data: { messages, status: c.status === "OPEN" ? "IN_PROGRESS" : c.status, updatedAt: new Date() },
        });

        // Gửi tin nhắn cho user qua bot (nếu có)
        if (_bot && c.odelegramId) {
            try {
                await _bot.telegram.sendMessage(
                    c.odelegramId,
                    `💬 *Phản hồi khiếu nại #${String(c.id).slice(-6).toUpperCase()}*\n\n${message.trim()}`,
                    { parse_mode: "Markdown" }
                );
            } catch (err) { console.log("[complaint reply] notify fail:", err.message); }
        }
        logAction("web-admin", "COMPLAINT_REPLY", c.id, {});
        res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put("/complaints/:id/status", async (req, res) => {
    try {
        const { status } = req.body;
        if (!COMPLAINT_STATUSES.includes(status)) return res.status(400).json({ error: "Trạng thái không hợp lệ" });
        await prisma.complaint.update({ where: { id: req.params.id }, data: { status, updatedAt: new Date() } });
        logAction("web-admin", "COMPLAINT_STATUS", req.params.id, { status });
        res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── Quantity discounts (per-product tiers, stored in Setting JSON) ─────────────
const QTY_DISCOUNT_KEY = "quantity_discounts";

async function getQtyDiscountsMap() {
    const s = await prisma.setting.findUnique({ where: { key: QTY_DISCOUNT_KEY } });
    if (!s) return {};
    try { return JSON.parse(s.value) || {}; } catch { return {}; }
}

router.get("/quantity-discounts", async (req, res) => {
    try {
        const map = await getQtyDiscountsMap();
        const products = await prisma.product.findMany({
            where: { isActive: true },
            select: { id: true, name: true, price: true, currency: true },
            orderBy: { createdAt: "desc" },
        });
        res.json({
            products: products.map((p) => ({ ...p, tiers: map[p.id] || [] })),
        });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put("/quantity-discounts/:productId", async (req, res) => {
    try {
        const { tiers } = req.body;
        if (!Array.isArray(tiers)) return res.status(400).json({ error: "tiers phải là mảng" });
        // Validate + normalize: { minQty, discountPercent }
        const clean = tiers
            .map((t) => ({ minQty: Math.max(1, Math.floor(Number(t.minQty) || 0)), discountPercent: Math.min(100, Math.max(0, Number(t.discountPercent) || 0)) }))
            .filter((t) => t.minQty > 1 && t.discountPercent > 0)
            .sort((a, b) => a.minQty - b.minQty);

        const map = await getQtyDiscountsMap();
        if (clean.length) map[req.params.productId] = clean;
        else delete map[req.params.productId];

        await prisma.setting.upsert({
            where: { key: QTY_DISCOUNT_KEY },
            update: { value: JSON.stringify(map) },
            create: { key: QTY_DISCOUNT_KEY, value: JSON.stringify(map) },
        });
        logAction("web-admin", "SET_QTY_DISCOUNT", req.params.productId, { tiers: clean.length });
        res.json({ ok: true, tiers: clean });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── Reseller orders (orders placed via API) ────────────────────────────────────
router.get("/reseller-orders", async (req, res) => {
    try {
        const page = Math.max(1, Number(req.query.page) || 1);
        const limit = Math.min(100, Number(req.query.limit) || 30);
        const where = { source: "api" };
        if (req.query.status) where.status = req.query.status;

        const [orders, total] = await Promise.all([
            prisma.order.findMany({ where, skip: (page - 1) * limit, take: limit, orderBy: { createdAt: "desc" }, include: { product: { select: { name: true } } } }),
            prisma.order.count({ where }),
        ]);
        res.json({
            orders: orders.map((o) => ({
                id: o.id, shortId: o.id.slice(-8).toUpperCase(),
                product: o.product?.name || o.productId,
                quantity: o.quantity, amount: o.finalAmount, currency: o.currency,
                status: o.status, paymentMethod: o.paymentMethod,
                telegramId: o.odelegramId, createdAt: o.createdAt,
            })),
            total,
        });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── Scheduled broadcasts ───────────────────────────────────────────────────────
router.get("/scheduled-broadcasts", async (req, res) => {
    try {
        const items = await prisma.scheduledBroadcast.findMany({ orderBy: { scheduledAt: "asc" } });
        res.json({ broadcasts: items });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post("/scheduled-broadcasts", async (req, res) => {
    try {
        const { message, scheduledAt, vipOnly, minVip } = req.body;
        if (!message?.trim()) return res.status(400).json({ error: "message trống" });
        if (!scheduledAt) return res.status(400).json({ error: "scheduledAt bắt buộc" });
        const when = new Date(scheduledAt);
        if (isNaN(when.getTime())) return res.status(400).json({ error: "scheduledAt không hợp lệ" });

        const created = await prisma.scheduledBroadcast.create({
            data: {
                message: message.trim(),
                scheduledAt: when,
                vipOnly: !!vipOnly,
                minVip: Number(minVip) || 1,
                status: "SCHEDULED",
            },
        });
        logAction("web-admin", "SCHEDULE_BROADCAST", created.id, { scheduledAt: when.toISOString() });
        res.json({ ok: true, broadcast: created });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete("/scheduled-broadcasts/:id", async (req, res) => {
    try {
        await prisma.scheduledBroadcast.delete({ where: { id: req.params.id } });
        res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── SePay / Bank debug ─────────────────────────────────────────────────────────
router.get("/sepay/debug", async (req, res) => {
    try {
        const config = getBankHistoryConfig();
        let transactions = [];
        let fetchError = null;
        try {
            transactions = await fetchBankHistory(config);
        } catch (err) { fetchError = err.message; }

        const recentPending = await prisma.order.findMany({
            where: { status: "PENDING", paymentMethod: "vietqr" },
            orderBy: { createdAt: "desc" }, take: 20,
            select: { id: true, finalAmount: true, createdAt: true, paymentRef: true },
        });

        res.json({
            config: {
                enabled: config.enabled,
                baseUrl: config.baseUrl ? config.baseUrl.replace(/\/[^/]*$/, "/***") : "",
                hasToken: !!config.token,
                accountNo: config.accountNo,
                accountName: config.accountName,
                intervalMs: config.intervalMs,
            },
            // Trạng thái SePay (bank dự phòng chạy song song qua webhook push).
            sepay: {
                enabled: !!getSepayApiKeySync(),
                webhookUrl: "/webhook/ipn?provider=sepay",
            },
            fetchError,
            transactionCount: transactions.length,
            transactions: transactions.slice(0, 30),
            pendingOrders: recentPending.map((o) => ({
                shortId: o.id.slice(-8).toUpperCase(),
                expectContent: `SHOP${o.id.slice(-8).toUpperCase()}`,
                amount: o.finalAmount, createdAt: o.createdAt,
            })),
        });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── Database viewer (read-only) ────────────────────────────────────────────────
const DB_ALLOWED = ["users", "products", "orders", "stockItems", "wallets", "walletTransactions", "coupons", "giftCodes", "giftCodeRedemptions", "issuedApiKeys", "categories", "complaints", "auditLogs", "referrals", "vipLevels", "settings", "scheduledBroadcasts"];

router.get("/db/collections", async (req, res) => {
    try {
        const counts = {};
        await Promise.all(DB_ALLOWED.map(async (name) => {
            const model = COLLECTION_TO_MODEL[name];
            if (model && prisma[model]) {
                counts[name] = await prisma[model].count().catch(() => 0);
            }
        }));
        res.json({ collections: DB_ALLOWED.map((name) => ({ name, count: counts[name] ?? 0 })) });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get("/db/collections/:collection", async (req, res) => {
    try {
        const name = req.params.collection;
        if (!DB_ALLOWED.includes(name)) return res.status(400).json({ error: "Collection không được phép" });
        const model = COLLECTION_TO_MODEL[name];
        if (!model || !prisma[model]) return res.status(400).json({ error: "Collection không tồn tại" });

        const page = Math.max(1, Number(req.query.page) || 1);
        const limit = Math.min(100, Number(req.query.limit) || 25);
        // Một số model (settings, vipLevels) KHÔNG có field createdAt → orderBy cứng gây lỗi 500.
        const NO_CREATED_AT = new Set(["setting", "vipLevel"]);
        const orderBy = NO_CREATED_AT.has(model) ? undefined : { createdAt: "desc" };
        const [docs, total] = await Promise.all([
            prisma[model].findMany({ skip: (page - 1) * limit, take: limit, ...(orderBy ? { orderBy } : {}) }),
            prisma[model].count(),
        ]);
        // Mask sensitive fields
        const masked = docs.map((d) => {
            const copy = { ...d };
            if (copy.payload && String(copy.payload).length > 80) copy.payload = String(copy.payload).slice(0, 80) + "…";
            // Key sk-* là bí mật của khách — che ở trình xem DB (trang "Cửa hàng
            // API key" mới là nơi xem đầy đủ, có kiểm soát).
            if (name === "issuedApiKeys" && copy.key) copy.key = maskIssuedKey(copy.key);
            return copy;
        });
        res.json({ documents: masked, total, page, limit });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

export default router;
