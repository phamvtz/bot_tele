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

let _bot = null;
export function setBotInstance(b) { _bot = b; }
const ADMIN_IDS = (process.env.ADMIN_IDS || "").split(",").map((id) => id.trim()).filter(Boolean);

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
router.use(express.json());
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
        // Allow re-deliver for PAID or stuck DELIVERING
        if (!["PAID", "DELIVERING"].includes(order.status)) {
            return res.status(400).json({ error: `Chỉ giao lại được đơn PAID/DELIVERING, hiện là ${order.status}` });
        }
        // Force reset to PAID so deliverOrder gate passes
        if (order.status === "DELIVERING") {
            await prisma.order.update({ where: { id: order.id }, data: { status: "PAID" } });
        }
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
        const order = await prisma.order.update({ where: { id: req.params.id }, data: { status: req.body.status } });
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
        const balanceAfter = balanceBefore + amt;
        await prisma.$transaction([
            prisma.wallet.update({ where: { id: wallet.id }, data: { balance: balanceAfter } }),
            prisma.walletTransaction.create({ data: {
                walletId: wallet.id,
                amount: amt,
                type: amt > 0 ? "ADMIN_ADD" : "ADMIN_DEDUCT",
                balanceBefore,
                balanceAfter,
                description: note || "Admin điều chỉnh",
                status: "SUCCESS",
            }}),
        ]);
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
            ADMIN_IDS: process.env.ADMIN_IDS || "",
            ADMIN_SECRET: process.env.ADMIN_SECRET || "",
            MIN_DEPOSIT: process.env.MIN_DEPOSIT || "10000",
            CURRENCY: process.env.CURRENCY || "VND",
            TIMEZONE: process.env.TIMEZONE || "Asia/Ho_Chi_Minh",
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

export default router;
