import { Router } from 'express';
import crypto from 'crypto';
import prisma from '../infrastructure/db.js';
import { ProductService } from '../modules/product/ProductService.js';
import { OrderService } from '../modules/order/OrderService.js';
import { createLogger } from '../infrastructure/logger.js';

const log = createLogger('AdminAPI');
const router = Router();

const SECRET = process.env.ADMIN_JWT_SECRET ?? 'shop-admin-secret-2024';
const ADMIN_PASS = process.env.ADMIN_PASSWORD ?? 'admin123';

// ── Simple JWT (no external dep) ──────────────────────────────────────────────

function signToken(payload: Record<string, unknown>) {
  const h = Buffer.from(JSON.stringify({ typ: 'JWT', alg: 'HS256' })).toString('base64url');
  const p = Buffer.from(JSON.stringify({ ...payload, exp: Date.now() + 8 * 3_600_000 })).toString('base64url');
  const s = crypto.createHmac('sha256', SECRET).update(`${h}.${p}`).digest('base64url');
  return `${h}.${p}.${s}`;
}

function verifyToken(token: string): boolean {
  try {
    const [h, p, s] = token.split('.');
    if (!h || !p || !s) return false;
    const expected = crypto.createHmac('sha256', SECRET).update(`${h}.${p}`).digest('base64url');
    if (s !== expected) return false;
    const payload = JSON.parse(Buffer.from(p, 'base64url').toString());
    return payload.exp > Date.now();
  } catch { return false; }
}

function auth(req: any, res: any, next: any) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token || !verifyToken(token)) return res.status(401).json({ error: 'Unauthorized' });
  next();
}

// ── Login ─────────────────────────────────────────────────────────────────────

router.post('/login', (req: any, res: any) => {
  if (req.body?.password !== ADMIN_PASS) {
    log.warn('Admin login failed');
    return res.status(401).json({ error: 'Mật khẩu không đúng' });
  }
  log.info('Admin logged in');
  res.json({ token: signToken({ role: 'admin' }) });
});

// All routes below require auth
router.use(auth);

// ── Stats Dashboard ───────────────────────────────────────────────────────────

router.get('/stats', async (_req: any, res: any) => {
  try { res.json(await OrderService.getDashboardStats()); }
  catch (e: any) { res.status(500).json({ error: e.message }); }
});

// 7-day revenue chart
router.get('/stats/chart', async (_req: any, res: any) => {
  try {
    const days = 7;
    const result = [];
    for (let i = days - 1; i >= 0; i--) {
      const from = new Date(); from.setDate(from.getDate() - i); from.setHours(0,0,0,0);
      const to = new Date(from); to.setHours(23,59,59,999);
      const [revenue, orders] = await Promise.all([
        prisma.order.aggregate({ where: { status: 'COMPLETED', createdAt: { gte: from, lte: to } }, _sum: { finalAmount: true } }),
        prisma.order.count({ where: { status: 'COMPLETED', createdAt: { gte: from, lte: to } } }),
      ]);
      result.push({ date: from.toISOString().slice(0,10), revenue: revenue._sum.finalAmount ?? 0, orders });
    }
    res.json(result);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// ── Categories ────────────────────────────────────────────────────────────────

router.get('/categories', async (_req: any, res: any) => {
  try { res.json(await ProductService.getAllCategories()); }
  catch (e: any) { res.status(500).json({ error: e.message }); }
});

router.post('/categories', async (req: any, res: any) => {
  try {
    const { name, slug, emoji, description } = req.body;
    if (!name || !slug) return res.status(400).json({ error: 'Thiếu name/slug' });
    res.json(await ProductService.createCategory({ name, slug, emoji, description }));
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

router.put('/categories/:id', async (req: any, res: any) => {
  try {
    const { name, emoji, isActive, description } = req.body;
    res.json(await ProductService.updateCategory(req.params.id, { name, emoji, isActive, description }));
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

router.delete('/categories/:id', async (req: any, res: any) => {
  try {
    await prisma.category.delete({ where: { id: req.params.id } });
    res.json({ ok: true });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// ── Products ──────────────────────────────────────────────────────────────────

router.get('/products', async (req: any, res: any) => {
  try {
    const page = parseInt(req.query.page ?? '0', 10);
    const limit = parseInt(req.query.limit ?? '20', 10);
    res.json(await ProductService.getAllProducts(page, limit));
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

router.post('/products', async (req: any, res: any) => {
  try {
    const { name, slug, basePrice, productType, deliveryType, stockMode, categoryId, thumbnailEmoji, shortDescription } = req.body;
    if (!name || !slug || !basePrice) return res.status(400).json({ error: 'Thiếu thông tin bắt buộc' });
    const product = await ProductService.createProduct({
      name, slug,
      basePrice: Number(basePrice),
      productType: productType || 'AUTO_DELIVERY',
      deliveryType: deliveryType || 'DIGITAL_CODE',
      stockMode: stockMode || 'TRACKED',
      categoryId: categoryId || undefined,
      thumbnailEmoji, shortDescription,
    });
    ProductService.invalidateProductCaches();
    res.json(product);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

router.put('/products/:id', async (req: any, res: any) => {
  try {
    const { name, slug, thumbnailEmoji, shortDescription, categoryId, basePrice, vipPrice, isActive, productType, deliveryType, stockMode } = req.body;
    // Update all editable fields in one call
    const updateData: any = {};
    if (name !== undefined) updateData.name = name;
    if (slug !== undefined) updateData.slug = slug;
    if (thumbnailEmoji !== undefined) updateData.thumbnailEmoji = thumbnailEmoji;
    if (shortDescription !== undefined) updateData.shortDescription = shortDescription;
    if (categoryId !== undefined) updateData.categoryId = categoryId || null;
    if (basePrice !== undefined) updateData.basePrice = Number(basePrice);
    if (vipPrice !== undefined) updateData.vipPrice = vipPrice ? Number(vipPrice) : null;
    if (isActive !== undefined) updateData.isActive = Boolean(isActive);
    if (productType !== undefined) updateData.productType = productType;
    if (deliveryType !== undefined) updateData.deliveryType = deliveryType;
    if (stockMode !== undefined) updateData.stockMode = stockMode;
    await prisma.product.update({ where: { id: req.params.id }, data: updateData });
    ProductService.invalidateProductCaches();
    res.json(await prisma.product.findUnique({ where: { id: req.params.id }, include: { category: true } }));
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

router.put('/products/:id/toggle', async (req: any, res: any) => {
  try {
    const p = await ProductService.toggleProductActive(req.params.id);
    ProductService.invalidateProductCaches();
    res.json(p);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

router.delete('/products/:id', async (req: any, res: any) => {
  try {
    await prisma.product.delete({ where: { id: req.params.id } });
    ProductService.invalidateProductCaches();
    res.json({ ok: true });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// ── Stock / Keys ──────────────────────────────────────────────────────────────

router.get('/products/:id/stock', async (req: any, res: any) => {
  try {
    const page = parseInt(req.query.page ?? '0', 10);
    const limit = parseInt(req.query.limit ?? '50', 10);
    const status = req.query.status as string | undefined;
    const where: any = { productId: req.params.id };
    if (status) where.status = status;
    const [items, total, available, delivered] = await Promise.all([
      prisma.stockItem.findMany({ where, orderBy: { createdAt: 'desc' }, skip: page * limit, take: limit }),
      prisma.stockItem.count({ where: { productId: req.params.id } }),
      prisma.stockItem.count({ where: { productId: req.params.id, status: 'AVAILABLE' } }),
      prisma.stockItem.count({ where: { productId: req.params.id, status: 'DELIVERED' } }),
    ]);
    res.json({ items, total, available, delivered, totalPages: Math.ceil(total / limit) });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

router.post('/products/:id/stock', async (req: any, res: any) => {
  try {
    const keys: string[] = (req.body.keys ?? []).map((k: string) => k.trim()).filter(Boolean);
    if (!keys.length) return res.status(400).json({ error: 'Danh sách keys rỗng' });
    const result = await prisma.stockItem.createMany({
      data: keys.map(content => ({ productId: req.params.id, content, status: 'AVAILABLE' })),
    });
    await prisma.product.update({ where: { id: req.params.id }, data: { stockCount: { increment: result.count } } });
    ProductService.invalidateProductCaches();
    res.json({ added: result.count });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

router.delete('/stock/:id', async (req: any, res: any) => {
  try {
    const item = await prisma.stockItem.findUnique({ where: { id: req.params.id } });
    if (!item) return res.status(404).json({ error: 'Không tìm thấy' });
    await prisma.stockItem.delete({ where: { id: req.params.id } });
    if (item.status === 'AVAILABLE') {
      await prisma.product.update({ where: { id: item.productId }, data: { stockCount: { decrement: 1 } } });
    }
    res.json({ ok: true });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// ── Orders ────────────────────────────────────────────────────────────────────

router.get('/orders', async (req: any, res: any) => {
  try {
    const page = parseInt(req.query.page ?? '0', 10);
    const limit = parseInt(req.query.limit ?? '20', 10);
    const status = req.query.status as string | undefined;
    const where: any = status ? { status } : {};
    const [orders, total] = await Promise.all([
      prisma.order.findMany({
        where, orderBy: { createdAt: 'desc' },
        include: { user: { select: { telegramId: true, firstName: true, username: true } }, items: true },
        skip: page * limit, take: limit,
      }),
      prisma.order.count({ where }),
    ]);
    res.json({ orders, total, totalPages: Math.ceil(total / limit), page });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

router.get('/orders/:id', async (req: any, res: any) => {
  try {
    const order = await prisma.order.findUnique({
      where: { id: req.params.id },
      include: { user: true, items: { include: { deliveredItems: true } } },
    });
    if (!order) return res.status(404).json({ error: 'Không tìm thấy đơn' });
    res.json(order);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// ── Users ─────────────────────────────────────────────────────────────────────

router.get('/users', async (req: any, res: any) => {
  try {
    const page = parseInt(req.query.page ?? '0', 10);
    const limit = parseInt(req.query.limit ?? '20', 10);
    const q = req.query.q as string | undefined;
    const where: any = q ? {
      OR: [
        { firstName: { contains: q, mode: 'insensitive' } },
        { username: { contains: q, mode: 'insensitive' } },
        { telegramId: { contains: q } },
      ]
    } : {};
    const [users, total] = await Promise.all([
      prisma.user.findMany({ where, orderBy: { createdAt: 'desc' }, skip: page * limit, take: limit,
        include: { wallet: true, _count: { select: { orders: true } } } }),
      prisma.user.count({ where }),
    ]);
    res.json({ users, total, totalPages: Math.ceil(total / limit), page });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

router.get('/users/:id', async (req: any, res: any) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.params.id },
      include: {
        wallet: { include: { transactions: { orderBy: { createdAt: 'desc' }, take: 20 } } },
        orders: { orderBy: { createdAt: 'desc' }, take: 10, include: { items: true } },
      },
    });
    if (!user) return res.status(404).json({ error: 'Không tìm thấy' });
    res.json(user);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

router.put('/users/:id/ban', async (req: any, res: any) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.params.id } });
    if (!user) return res.status(404).json({ error: 'Không tìm thấy user' });
    const newStatus = user.status === 'BANNED' ? 'ACTIVE' : 'BANNED';
    const updated = await prisma.user.update({ where: { id: req.params.id }, data: { status: newStatus } });
    res.json(updated);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// Wallet adjust (admin nạp/trừ tiền)
router.post('/users/:id/wallet', async (req: any, res: any) => {
  try {
    const { amount, note } = req.body;
    if (!amount || isNaN(Number(amount))) return res.status(400).json({ error: 'Số tiền không hợp lệ' });
    const amt = Number(amount);
    const wallet = await prisma.wallet.findUnique({ where: { userId: req.params.id } });
    if (!wallet) return res.status(404).json({ error: 'User chưa có ví' });
    const newBalance = wallet.balance + amt;
    if (newBalance < 0) return res.status(400).json({ error: 'Số dư không đủ' });
    const [updated] = await prisma.$transaction([
      prisma.wallet.update({ where: { id: wallet.id }, data: { balance: { increment: amt } } }),
      prisma.walletTransaction.create({
        data: {
          userId: req.params.id, walletId: wallet.id,
          type: 'ADMIN_ADJUSTMENT', direction: amt >= 0 ? 'IN' : 'OUT',
          amount: Math.abs(amt), balanceBefore: wallet.balance, balanceAfter: newBalance,
          referenceType: 'MANUAL', description: note || (amt >= 0 ? 'Admin nạp tiền' : 'Admin trừ tiền'),
        },
      }),
    ]);
    res.json(updated);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// All transactions
router.get('/transactions', async (req: any, res: any) => {
  try {
    const page = parseInt(req.query.page ?? '0', 10);
    const limit = parseInt(req.query.limit ?? '30', 10);
    const type = req.query.type as string | undefined;
    const where: any = type ? { type } : {};
    const [txs, total] = await Promise.all([
      prisma.walletTransaction.findMany({ where, orderBy: { createdAt: 'desc' }, skip: page * limit, take: limit }),
      prisma.walletTransaction.count({ where }),
    ]);
    res.json({ transactions: txs, total, totalPages: Math.ceil(total / limit), page });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// Bulk delete stock (available only)
router.delete('/products/:id/stock/bulk', async (req: any, res: any) => {
  try {
    const result = await prisma.stockItem.deleteMany({ where: { productId: req.params.id, status: 'AVAILABLE' } });
    await prisma.product.update({ where: { id: req.params.id }, data: { stockCount: 0 } });
    ProductService.invalidateProductCaches();
    res.json({ deleted: result.count });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// Orders search
router.get('/orders/search', async (req: any, res: any) => {
  try {
    const q = req.query.q as string;
    if (!q || q.length < 3) return res.json([]);
    const orders = await prisma.order.findMany({
      where: { orderCode: { contains: q.toUpperCase() } },
      include: { user: { select: { firstName: true, username: true } }, items: true },
      take: 10,
    });
    res.json(orders);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

export default router;
