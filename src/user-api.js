import { Router } from "express";
import { createHmac } from "node:crypto";
import prisma from "./lib/prisma.js";
import { getBalance, purchase as walletPurchase } from "./wallet.js";
import { deliverOrder } from "./delivery.js";
import { invalidateStockCache } from "./inventory.js";
import { getUsdVndRate } from "./payment/crypto.js";
import { isUsdCurrency, toVndAmount } from "./money-display.js";

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

/** GET /api/user/docs — trang tài liệu API (public, không cần key) */
router.get("/docs", (req, res) => {
    const base = `${req.protocol}://${req.get("host")}/api/user`;
    res.type("html").send(`<!doctype html>
<html lang="vi"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Tài liệu API</title>
<style>
  :root{color-scheme:dark}
  body{font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#0b0d12;color:#e5e7eb;margin:0;padding:2rem 1rem;line-height:1.6}
  .wrap{max-width:760px;margin:0 auto}
  h1{font-size:1.5rem;margin:0 0 .25rem}
  h2{font-size:1.05rem;margin:2rem 0 .5rem;color:#a5b4fc}
  p{color:#9ca3af}
  code{background:#1a1d27;color:#e5e7eb;padding:.15rem .4rem;border-radius:5px;font-size:.9em}
  pre{background:#12151d;border:1px solid #232838;border-radius:10px;padding:1rem;overflow:auto}
  .ep{display:flex;gap:.6rem;align-items:center;padding:.55rem .75rem;border:1px solid #232838;border-radius:10px;margin:.4rem 0;background:#12151d}
  .m{font-weight:700;font-size:.75rem;padding:.15rem .5rem;border-radius:6px}
  .get{background:#064e3b;color:#6ee7b7}.post{background:#3b2f06;color:#fcd34d}
  .note{border-left:3px solid #6366f1;padding:.5rem .9rem;background:#12151d;border-radius:0 8px 8px 0;margin-top:1.5rem}
</style></head>
<body><div class="wrap">
<h1>🔗 Tài liệu API người dùng</h1>
<p>Base URL: <code>${base}</code></p>
<h2>Xác thực</h2>
<p>Gửi API key qua header:</p>
<pre>Authorization: Bearer sk_u_...</pre>
<h2>Endpoints</h2>
<div class="ep"><span class="m get">GET</span><code>/me</code><span>Thông tin tài khoản + số dư</span></div>
<div class="ep"><span class="m get">GET</span><code>/products</code><span>Danh sách sản phẩm đang bán</span></div>
<div class="ep"><span class="m post">POST</span><code>/purchase</code><span>Mua hàng bằng số dư ví</span></div>
<div class="ep"><span class="m get">GET</span><code>/orders</code><span>Lịch sử đơn hàng</span></div>
<div class="ep"><span class="m get">GET</span><code>/orders/:id</code><span>Chi tiết một đơn</span></div>
<h2>Ví dụ mua hàng</h2>
<pre>curl -X POST ${base}/purchase \\
  -H "Authorization: Bearer sk_u_..." \\
  -H "Content-Type: application/json" \\
  -d '{"productId":"clx...","quantity":1}'</pre>
<div class="note">Cần có số dư ví trước khi mua qua API. Lấy API key bằng lệnh <code>/api</code> trong bot Telegram.</div>
</div></body></html>`);
});

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

        // Tạo order PENDING trước, chỉ promote PAID khi đã trừ ví thành công.
        // Nếu crash giữa create và walletPurchase → order ở PENDING, được dọn
        // sau 10 phút thay vì kẹt PAID mà ví chưa trừ.
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

        // Promote PENDING → PAID, gắn paymentRef = walletTx.id để đối soát
        await prisma.order.update({
            where: { id: order.id },
            data: {
                status: "PAID",
                paymentRef: purchase.transaction?.id || `WALLET:${order.id}`,
            },
        });
        order.status = "PAID";
        order.paymentRef = purchase.transaction?.id || `WALLET:${order.id}`;

        // Deliver — if fails, refund wallet and cancel order.
        // Lưu ý: delivery.js (STOCK_LINES / API_CALL) tự refund khi OUT_OF_STOCK
        // hoặc partial cho payment=wallet, nên check status sau deliver
        // để không refund 2 lần.
        try {
            await deliverOrder({ prisma, telegram: null, order });
        } catch (deliveryErr) {
            // Lấy lại trạng thái đơn — có thể delivery đã set OUT_OF_STOCK + refund rồi
            const after = await prisma.order.findUnique({ where: { id: order.id } });
            const alreadyHandled = after?.status === "CANCELED" && (after?.deliveryRef === "OUT_OF_STOCK" || String(after?.deliveryRef || "").startsWith("PARTIAL:"));
            if (!alreadyHandled) {
                await prisma.order.update({ where: { id: order.id }, data: { status: "CANCELED" } });
                const { refund } = await import("./wallet.js");
                await refund(req.apiUser.telegramId, totalAmount, order.id, "Hoàn tiền giao hàng thất bại").catch(() => {});
            }
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
        const order = await prisma.order.findUnique({ where: { id: req.params.id }, include: { product: { select: { name: true } } } });
        if (!order) return res.status(404).json({ error: "Không tìm thấy đơn" });
        if (order.odelegramId !== req.apiUser.telegramId) return res.status(403).json({ error: "Không có quyền" });
        res.json({ order });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

export default router;
