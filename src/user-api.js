import { Router } from "express";
import { createHmac } from "node:crypto";
import prisma from "./lib/prisma.js";
import { getBalance, purchase as walletPurchase } from "./wallet.js";
import { deliverOrder } from "./delivery.js";
import { invalidateStockCache } from "./inventory.js";

const router = Router();

// ─── Key helpers ──────────────────────────────────────────────────────────────
function generateUserKey(telegramId) {
    const secret = process.env.USER_API_SECRET || process.env.ADMIN_SECRET || "user_api_secret";
    return "sk_u_" + createHmac("sha256", secret).update(String(telegramId)).digest("hex");
}

export function getUserApiKey(telegramId) {
    return generateUserKey(telegramId);
}

// ─── Auth middleware ──────────────────────────────────────────────────────────
async function userAuth(req, res, next) {
    const auth = req.headers.authorization || "";
    const key = auth.startsWith("Bearer ") ? auth.slice(7) : req.headers["x-api-key"];
    if (!key || !key.startsWith("sk_u_")) {
        return res.status(401).json({ error: "API key không hợp lệ. Dùng: Authorization: Bearer sk_u_..." });
    }
    // Find user whose key matches
    const users = await prisma.user.findMany({ select: { id: true, telegramId: true, firstName: true, vipLevel: true }, take: 5000 });
    const found = users.find(u => generateUserKey(u.telegramId) === key);
    if (!found) return res.status(401).json({ error: "API key không đúng hoặc tài khoản không tồn tại" });
    req.apiUser = found;
    next();
}

// ─── Endpoints ────────────────────────────────────────────────────────────────

/** GET /api/user/me */
router.get("/me", userAuth, async (req, res) => {
    try {
        const balance = await getBalance(req.apiUser.telegramId);
        res.json({
            telegramId: req.apiUser.telegramId,
            name: req.apiUser.firstName,
            vipLevel: req.apiUser.vipLevel,
            balance,
        });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

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
            const stock = await prisma.stockItem.count({ where: { productId: p.id, isSold: false } });
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

        const totalAmount = product.price * qty;
        const balance = await getBalance(req.apiUser.telegramId);
        if (balance < totalAmount) {
            return res.status(400).json({ error: `Số dư không đủ. Cần ${totalAmount}đ, hiện có ${balance}đ` });
        }

        // Create order
        const order = await prisma.order.create({
            data: {
                odelegramId: req.apiUser.telegramId,
                chatId: req.apiUser.telegramId,
                productId,
                quantity: qty,
                amount: totalAmount,
                discount: 0,
                finalAmount: totalAmount,
                currency: product.currency || "VND",
                status: "PAID",
                paymentMethod: "wallet",
                userId: req.apiUser.id,
            },
        });

        // Deduct wallet
        const purchase = await walletPurchase(req.apiUser.telegramId, totalAmount, order.id, `API: Mua ${product.name} x${qty}`);
        if (!purchase.success) {
            await prisma.order.update({ where: { id: order.id }, data: { status: "CANCELED" } });
            return res.status(400).json({ error: purchase.error });
        }

        // Deliver — if fails, refund wallet and cancel order
        try {
            await deliverOrder({ prisma, telegram: null, order });
        } catch (deliveryErr) {
            await prisma.order.update({ where: { id: order.id }, data: { status: "CANCELED" } });
            const { refund } = await import("./wallet.js");
            await refund(req.apiUser.telegramId, totalAmount, order.id, "Hoàn tiền giao hàng thất bại").catch(() => {});
            return res.status(500).json({ error: `Giao hàng thất bại: ${deliveryErr.message}` });
        }
        const delivered = await prisma.order.findUnique({ where: { id: order.id } });
        if (delivered?.status !== "DELIVERED") {
            return res.status(500).json({ error: "Giao hàng không thành công, vui lòng liên hệ admin" });
        }

        res.json({
            ok: true,
            orderId: order.id,
            shortId: order.id.slice(-8).toUpperCase(),
            product: product.name,
            quantity: qty,
            amount: totalAmount,
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
        const order = await prisma.order.findUnique({ where: { id: req.params.id }, include: { product: { select: { name: true } } } });
        if (!order) return res.status(404).json({ error: "Không tìm thấy đơn" });
        if (order.odelegramId !== req.apiUser.telegramId) return res.status(403).json({ error: "Không có quyền" });
        res.json({ order });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

export default router;
