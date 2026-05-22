import { Router } from "express";
import prisma from "./lib/prisma.js";
import { adminAuth } from "./middleware/adminAuth.js";

const router = Router();
router.use(adminAuth);

// ─── Stats ───────────────────────────────────────────────────────────────────
router.get("/stats", async (req, res) => {
    try {
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const [todayOrders, newUsers, activeProducts, recentOrders] = await Promise.all([
            prisma.order.aggregate({ where: { createdAt: { gte: today }, status: { in: ["PAID", "DELIVERED"] } }, _sum: { finalAmount: true }, _count: true }),
            prisma.user.count({ where: { createdAt: { gte: today } } }),
            prisma.product.count({ where: { isActive: true } }),
            prisma.order.findMany({ take: 10, orderBy: { createdAt: "desc" }, include: { product: { select: { name: true } } } }),
        ]);

        // Revenue chart last 7 days
        const revenueChart = [];
        for (let i = 6; i >= 0; i--) {
            const d = new Date();
            d.setDate(d.getDate() - i);
            d.setHours(0, 0, 0, 0);
            const end = new Date(d);
            end.setHours(23, 59, 59, 999);
            const agg = await prisma.order.aggregate({
                where: { createdAt: { gte: d, lte: end }, status: { in: ["PAID", "DELIVERED"] } },
                _sum: { finalAmount: true },
            });
            revenueChart.push({
                date: d.toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit" }),
                revenue: agg._sum.finalAmount || 0,
            });
        }

        res.json({
            stats: {
                todayRevenue: todayOrders._sum.finalAmount || 0,
                todayOrders: todayOrders._count,
                newUsers,
                activeProducts,
            },
            recentOrders,
            revenueChart,
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
        const where = search ? { name: { contains: search, mode: "insensitive" } } : {};
        const [products, total] = await Promise.all([
            prisma.product.findMany({ where, skip: (page - 1) * limit, take: limit, include: { category: { select: { name: true } }, _count: { select: { stockItems: { where: { isSold: false } } } } }, orderBy: { createdAt: "desc" } }),
            prisma.product.count({ where }),
        ]);
        res.json({ products, total });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post("/products", async (req, res) => {
    try {
        const { name, description, price, currency, deliveryMode, payload, note, categoryId } = req.body;
        const product = await prisma.product.create({ data: { name, description, price: Number(price) || 0, currency: currency || "VND", deliveryMode: deliveryMode || "TEXT", payload, note, categoryId: categoryId || null, isActive: true } });
        res.json(product);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put("/products/:id", async (req, res) => {
    try {
        const { name, description, price, currency, deliveryMode, payload, note, categoryId } = req.body;
        const product = await prisma.product.update({ where: { id: req.params.id }, data: { name, description, price: Number(price) || 0, currency, deliveryMode, payload, note, categoryId: categoryId || null } });
        res.json(product);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete("/products/:id", async (req, res) => {
    try {
        await prisma.product.update({ where: { id: req.params.id }, data: { isActive: false } });
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
        const cat = await prisma.category.update({ where: { id: req.params.id }, data: { name: req.body.name, description: req.body.description, icon: req.body.icon } });
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
        const where = req.query.status ? { status: req.query.status } : {};
        const [orders, total] = await Promise.all([
            prisma.order.findMany({ where, skip: (page - 1) * limit, take: limit, include: { product: { select: { name: true } }, user: { select: { firstName: true, telegramId: true } } }, orderBy: { createdAt: "desc" } }),
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

router.put("/orders/:id/status", async (req, res) => {
    try {
        const order = await prisma.order.update({ where: { id: req.params.id }, data: { status: req.body.status } });
        res.json(order);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── Users ────────────────────────────────────────────────────────────────────
router.get("/users", async (req, res) => {
    try {
        const page = Math.max(1, Number(req.query.page) || 1);
        const limit = Math.min(100, Number(req.query.limit) || 20);
        const search = req.query.search || "";
        const where = search ? { OR: [{ telegramId: { contains: search } }, { firstName: { contains: search, mode: "insensitive" } }, { username: { contains: search, mode: "insensitive" } }] } : {};
        const [users, total] = await Promise.all([
            prisma.user.findMany({ where, skip: (page - 1) * limit, take: limit, include: { wallet: { select: { balance: true } }, _count: { select: { orders: true } } }, orderBy: { createdAt: "desc" } }),
            prisma.user.count({ where }),
        ]);
        res.json({ users, total });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put("/users/:id/wallet", async (req, res) => {
    try {
        const { amount, note } = req.body;
        const user = await prisma.user.findUnique({ where: { id: req.params.id }, include: { wallet: true } });
        if (!user) return res.status(404).json({ error: "User not found" });
        const walletId = user.wallet?.id;
        if (!walletId) return res.status(400).json({ error: "User has no wallet" });
        await prisma.$transaction([
            prisma.wallet.update({ where: { id: walletId }, data: { balance: { increment: Number(amount) } } }),
            prisma.walletTransaction.create({ data: { walletId, amount: Number(amount), type: amount > 0 ? "ADMIN_ADD" : "ADMIN_DEDUCT", description: note || "Admin điều chỉnh" } }),
        ]);
        res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put("/users/:id/block", async (req, res) => {
    try {
        const user = await prisma.user.update({ where: { id: req.params.id }, data: { isBlocked: true } });
        res.json(user);
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
        if (search) where.OR = [{ description: { contains: search, mode: "insensitive" } }];
        const [transactions, total] = await Promise.all([
            prisma.walletTransaction.findMany({ where, skip: (page - 1) * limit, take: limit, include: { wallet: { include: { user: { select: { firstName: true, telegramId: true } } } } }, orderBy: { createdAt: "desc" } }),
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
        const [logs, total] = await Promise.all([
            prisma.auditLog.findMany({ skip: (page - 1) * limit, take: limit, orderBy: { createdAt: "desc" } }),
            prisma.auditLog.count(),
        ]);
        res.json({ logs, total });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── Settings ─────────────────────────────────────────────────────────────────
router.get("/settings", async (req, res) => {
    try {
        const rows = await prisma.setting.findMany();
        const settings = Object.fromEntries(rows.map((r) => [r.key, r.value]));
        res.json({ settings });
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
        res.json({ ok: true });
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
        res.json(level);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

export default router;
