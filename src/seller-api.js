import { Router } from "express";
import { randomBytes } from "node:crypto";
import prisma from "./lib/prisma.js";
import { logAction } from "./audit.js";
import { autoEnableOnStock, invalidateStockCache } from "./inventory.js";

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
    const found = keys.find(k => k.key === key && k.active !== false);
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
        };
        keys.push(newKey);
        await saveApiKeys(keys);
        logAction("web-admin", "CREATE_API_KEY", newKey.id, { name: newKey.name });
        res.json({ key: newKey }); // Return full key only on creation
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

/** GET /api/seller/products — list active products */
router.get("/products", async (req, res) => {
    try {
        const products = await prisma.product.findMany({
            where: { isActive: true },
            select: { id: true, name: true, price: true, currency: true, deliveryMode: true, description: true },
            orderBy: { createdAt: "desc" },
        });
        // Attach stock count for STOCK_LINES products
        const result = await Promise.all(products.map(async (p) => {
            if (p.deliveryMode !== "STOCK_LINES") return { ...p, stock: null };
            const stock = await prisma.stockItem.count({ where: { productId: p.id, isSold: false } });
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
        res.json({
            orders: orders.map(o => ({
                id: o.id,
                shortId: o.id.slice(-8).toUpperCase(),
                product: o.product?.name || o.productId,
                productId: o.productId,
                quantity: o.quantity,
                amount: o.finalAmount,
                currency: o.currency,
                status: o.status,
                paymentMethod: o.paymentMethod,
                createdAt: o.createdAt,
            }))
        });
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
        res.json({ order: { ...order, product: order.product } });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

/** GET /api/seller/stats — basic shop stats */
router.get("/stats", async (req, res) => {
    try {
        const [totalOrders, pendingOrders, totalProducts] = await Promise.all([
            prisma.order.count({ where: { status: { in: ["PAID", "DELIVERED"] } } }),
            prisma.order.count({ where: { status: "PENDING" } }),
            prisma.product.count({ where: { isActive: true } }),
        ]);
        res.json({ totalOrders, pendingOrders, totalProducts });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

export default router;
