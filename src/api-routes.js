import express, { Router } from "express";
import { request as httpsReq } from "node:https";
import { request as httpReq } from "node:http";
import prisma from "./lib/prisma.js";
import { adminAuth } from "./middleware/adminAuth.js";
import { autoEnableOnStock, invalidateStockCache } from "./inventory.js";

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
        const status = req.query.status || "all"; // active | inactive | all
        const where = {};
        if (search) where.name = { contains: search, mode: "insensitive" };
        if (status === "active") where.isActive = true;
        else if (status === "inactive") where.isActive = false;
        const [products, total] = await Promise.all([
            prisma.product.findMany({ where, skip: (page - 1) * limit, take: limit, include: { category: { select: { name: true } }, _count: { select: { stockItems: { where: { isSold: false } } } } }, orderBy: { createdAt: "desc" } }),
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
        res.json(product);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put("/products/:id", async (req, res) => {
    try {
        const { name, description, price, costPrice, currency, deliveryMode, payload, note, categoryId, minQty, maxQty } = req.body;
        const toNum = (v) => (v !== undefined && v !== null && v !== "") ? Number(v) : null;
        const product = await prisma.product.update({ where: { id: req.params.id }, data: { name, description, price: Number(price) || 0, costPrice: toNum(costPrice), currency, deliveryMode, payload, note, categoryId: categoryId || null, minQty: toNum(minQty) ?? 1, maxQty: toNum(maxQty) } });
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
        const sort = req.query.sort || "newest";
        const where = search ? { OR: [{ telegramId: { contains: search } }, { firstName: { contains: search, mode: "insensitive" } }, { username: { contains: search, mode: "insensitive" } }] } : {};
        const orderBy = sort === "balance" ? [{ wallet: { balance: "desc" } }]
            : sort === "spent" ? [{ totalSpent: "desc" }]
            : [{ createdAt: "desc" }];
        const [users, total] = await Promise.all([
            prisma.user.findMany({ where, skip: (page - 1) * limit, take: limit, include: { wallet: { select: { balance: true } }, _count: { select: { orders: true } } }, orderBy }),
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
        res.json({ created: result.count });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete("/stock-items/:id", async (req, res) => {
    try {
        await prisma.stockItem.delete({ where: { id: req.params.id } });
        res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete("/products/:id/stock-unsold", async (req, res) => {
    try {
        const result = await prisma.stockItem.deleteMany({ where: { productId: req.params.id, isSold: false } });
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
        res.json(level);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

export default router;
