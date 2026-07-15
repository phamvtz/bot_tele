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
import { invalidateMenuCache } from "./menu-config.js";
import { adminRouter as sellerKeyRouter } from "./seller-api.js";
import { invalidateShopConfig } from "./shop-config.js";

let _bot = null;
export function setBotInstance(b) { _bot = b; }
const ADMIN_IDS = (process.env.ADMIN_IDS || "").split(",").map((id) => id.trim()).filter(Boolean);

// Map collection name → prisma model key (for read-only DB viewer)
const COLLECTION_TO_MODEL = {
    users: "user", products: "product", orders: "order", stockItems: "stockItem",
    wallets: "wallet", walletTransactions: "walletTransaction", coupons: "coupon",
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
            rejectUnauthorized: false,
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

        // Revenue chart — 7 or 30 days (single query, group in-memory)
        const chartDays = req.query.chartDays === "30" ? 30 : 7;
        const revenueChart = await getRevenueByDay(chartDays).catch(() => []);

        // Top 5 sản phẩm bán chạy 30 ngày
        const topRaw = await prisma.order.groupBy({
            by: ["productId"], _count: true,
            where: { status: { in: ["PAID", "DELIVERED"] }, createdAt: { gte: since30 }, productId: { not: null } },
            take: 200,
        });
        topRaw.sort((a, b) => (b._count || 0) - (a._count || 0));
        const topIds = topRaw.slice(0, 5).map(t => t.productId).filter(Boolean);
        const topProductRows = await prisma.product.findMany({ where: { id: { in: topIds } }, select: { id: true, name: true } });
        const topProductMap = Object.fromEntries(topProductRows.map(p => [p.id, p.name]));
        const topProducts = topIds.map(id => ({ name: topProductMap[id] || "?", orders: topRaw.find(t => t.productId === id)?._count || 0 }));

        // Cảnh báo hết hàng (STOCK_LINES, còn ≤ 5)
        const allStockProducts = await prisma.product.findMany({
            where: { deliveryMode: "STOCK_LINES", isActive: true },
            include: { _count: { select: { stockItems: { where: { isSold: false } } } } },
        });
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
        const status = req.query.status || "all"; // active | inactive | all
        const where = {};
        if (search) where.name = { contains: search, mode: "insensitive" };
        if (status === "active") where.isActive = true;
        else if (status === "inactive") where.isActive = false;
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
        logAction("web-admin", "TOGGLE_PRODUCT", req.params.id, { isActive: updated.isActive });
        res.json({ isActive: updated.isActive });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

function autoCode(name, salt = 0) {
    const slug = String(name || "").replace(/[^a-zA-Z0-9]/g, "").slice(0, 6).toUpperCase() || "PROD";
    return `${slug}${(Date.now() + salt).toString(36).slice(-4).toUpperCase()}`;
}

router.post("/products", async (req, res) => {
    try {
        const { name, description, price, costPrice, currency, deliveryMode, payload, note, categoryId, code, minQty, maxQty } = req.body;
        const toNum = (v) => (v !== undefined && v !== null && v !== "") ? Number(v) : null;
        const product = await prisma.product.create({ data: { code: code || autoCode(name), name, description, price: Number(price) || 0, costPrice: toNum(costPrice), currency: currency || "VND", deliveryMode: deliveryMode || "TEXT", payload, note, categoryId: categoryId || null, isActive: true, minQty: toNum(minQty) ?? 1, maxQty: toNum(maxQty) } });
        logAction("web-admin", "CREATE_PRODUCT", product.id, { name: product.name, price: product.price });
        res.json(product);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put("/products/:id", async (req, res) => {
    try {
        const { name, description, price, costPrice, currency, deliveryMode, payload, note, categoryId, minQty, maxQty } = req.body;
        const toNum = (v) => (v !== undefined && v !== null && v !== "") ? Number(v) : null;
        const product = await prisma.product.update({ where: { id: req.params.id }, data: { name, description, price: Number(price) || 0, costPrice: toNum(costPrice), currency, deliveryMode, payload, note, categoryId: categoryId || null, minQty: toNum(minQty) ?? 1, maxQty: toNum(maxQty) } });
        logAction("web-admin", "UPDATE_PRODUCT", req.params.id, { name: product.name });
        res.json(product);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete("/products/:id", async (req, res) => {
    try {
        await prisma.product.update({ where: { id: req.params.id }, data: { isActive: false } });
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
        const cat = await prisma.category.create({ data: { name: req.body.name, description: req.body.description, icon: req.body.icon || "📁" } });
        res.json(cat);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put("/categories/:id", async (req, res) => {
    try {
        const { name, description, icon, isActive } = req.body;
        const data = {};
        if (name !== undefined) data.name = name;
        if (description !== undefined) data.description = description;
        if (icon !== undefined) data.icon = icon;
        if (isActive !== undefined) data.isActive = isActive;
        const cat = await prisma.category.update({ where: { id: req.params.id }, data });
        res.json(cat);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete("/categories/:id", async (req, res) => {
    try {
        await prisma.category.delete({ where: { id: req.params.id } });
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
        res.json({ users, total });
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
            prisma.walletTransaction.findMany({ where, skip: (page - 1) * limit, take: limit, include: { wallet: { include: { user: { select: { firstName: true, telegramId: true } } } } }, orderBy: { [sortField]: sortDir } }),
            prisma.walletTransaction.count({ where }),
        ]);
        const normalized = transactions.map((tx) => ({ ...tx, user: tx.wallet?.user }));
        res.json({ transactions: normalized, total });
    } catch (e) { res.status(500).json({ error: e.message }); }
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
            BSCSCAN_API_KEY: process.env.BSCSCAN_API_KEY || "",
            BSCSCAN_CHAIN_ID: process.env.BSCSCAN_CHAIN_ID || "56",
        };
        res.json({ settings: { ...envDefaults, ...dbSettings } });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put("/settings", async (req, res) => {
    try {
        const updates = req.body;
        await Promise.all(
            Object.entries(updates).map(([key, value]) =>
                prisma.setting.upsert({ where: { key }, update: { value: String(value) }, create: { key, value: String(value) } })
            )
        );
        if ("menu_buttons" in updates || "menu_button_ids" in updates) invalidateMenuCache();
        // Invalidate shop-config cache nếu có thay đổi key liên quan
        const shopKeys = [
            "SHOP_BANK_NAME", "SHOP_BANK_ACCOUNT", "SHOP_BANK_ACCOUNT_NAME", "BANK_CODE",
            "SUPPORT_CHANNEL_URL", "ORDER_NOTIFY_CHANNEL", "ORDER_EXPIRE_MINUTES", "MAX_DEPOSIT", "DEPOSIT_PRESETS",
            "CRYPTO_PAY_ENABLED", "CRYPTO_POLL_ENABLED", "CRYPTO_POLL_INTERVAL_MS", "CRYPTO_EXPIRE_MINUTES",
            "CRYPTO_USD_VND_RATE", "TRC20_USDT_ADDRESS", "TRONGRID_API_KEY", "BEP20_USDT_ADDRESS",
            "BSCSCAN_API_KEY", "BSCSCAN_CHAIN_ID",
        ];
        if (shopKeys.some((k) => k in updates)) invalidateShopConfig();
        logAction("web-admin", "UPDATE_SETTINGS", "settings", { keys: Object.keys(updates) });
        res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
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

router.delete("/api-providers/:id", async (req, res) => {
    try {
        const providers = await getProviders(prisma);
        await saveProviders(prisma, providers.filter((p) => p.id !== req.params.id));
        res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
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
        const { products, idField = "", stockField = "" } = req.body;
        if (!Array.isArray(products) || !products.length) return res.json({ created: 0 });
        const created = [];
        for (let i = 0; i < products.length; i++) {
            const item = products[i];
            const payload = JSON.stringify({ providerId: provider.id, providerProductId: item.originalId, purchaseEndpoint: provider.purchaseEndpoint, listEndpoint: provider.listEndpoint || "", idField, stockField, baseUrl: provider.baseUrl, apiKey: provider.apiKey, authMode: provider.authMode || "bearer", customHeaders: provider.customHeaders || "" });
            const product = await prisma.product.create({
                data: { code: autoCode(item.name, i), name: item.name, price: Number(item.price) || 0, currency: provider.currency || "VND", deliveryMode: "API_CALL", payload, description: item.description || null, categoryId: item.categoryId || null, isActive: true },
            });
            created.push(product);
        }
        logAction("web-admin", "IMPORT_PRODUCTS", req.params.id, { count: created.length });
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
                    `📦 *Nhập kho thành công*\n\n🏷️ Sản phẩm: ${product?.name || productId}\n✅ Đã thêm: ${result.count} mục\n📊 Tồn kho: ${currentStock}`,
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
                    `📦 *Nhập kho thành công*\n\n🏷️ Sản phẩm: ${product?.name || productId}\n✅ Đã thêm: ${result.count} file\n📊 Tồn kho: ${currentStock}`,
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
        const { filepath, filename } = await exportOrdersCSV(req.query.start || null, req.query.end || null);
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
const DB_ALLOWED = ["users", "products", "orders", "stockItems", "wallets", "walletTransactions", "coupons", "categories", "complaints", "auditLogs", "referrals", "vipLevels", "settings", "scheduledBroadcasts"];

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
            return copy;
        });
        res.json({ documents: masked, total, page, limit });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

export default router;
