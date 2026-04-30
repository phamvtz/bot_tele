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
    const { name, thumbnailEmoji, shortDescription, categoryId, basePrice, vipPrice, isActive } = req.body;
    await ProductService.updateProduct(req.params.id, { name, thumbnailEmoji, shortDescription, categoryId: categoryId || undefined });
    if (basePrice !== undefined) {
      await ProductService.updateProductPrice(req.params.id, Number(basePrice), vipPrice ? Number(vipPrice) : undefined);
    }
    if (isActive !== undefined) {
      await prisma.product.update({ where: { id: req.params.id }, data: { isActive: Boolean(isActive) } });
    }
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
      include: { user: true, items: true, deliveredItems: true },
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
    const [users, total] = await Promise.all([
      prisma.user.findMany({ orderBy: { createdAt: 'desc' }, skip: page * limit, take: limit }),
      prisma.user.count(),
    ]);
    res.json({ users, total, totalPages: Math.ceil(total / limit), page });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

router.get('/users/:id', async (req: any, res: any) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.params.id },
      include: { orders: { orderBy: { createdAt: 'desc' }, take: 10 } },
    });
    if (!user) return res.status(404).json({ error: 'Không tìm thấy' });
    res.json(user);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

router.put('/users/:id/ban', async (req: any, res: any) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.params.id } });
    if (!user) return res.status(404).json({ error: 'Không tìm thấy user' });
    const updated = await prisma.user.update({ where: { id: req.params.id }, data: { isBanned: !user.isBanned } });
    res.json(updated);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

export default router;
