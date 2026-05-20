import "dotenv/config";

// Prevent MongoDB auth failures from crashing the process
process.on("unhandledRejection", (err) => {
    const msg = err?.message || String(err);
    if (msg.includes("Authentication failed") || msg.includes("MongoServerError") || msg.includes("MONGODB")) {
        console.error("⚠️ MongoDB error (non-fatal):", msg);
        return;
    }
    console.error("Unhandled rejection:", err);
});

import express from "express";
import bodyParser from "body-parser";
import compression from "compression";
import path from "path";
import { createRequire } from "module";
const _require = createRequire(import.meta.url);
const multer = _require("multer");
import { existsSync, mkdirSync } from "fs";
import prisma from "./lib/prisma.js";
import { waitForDB, startKeepAlive } from "./lib/db.js";
import { ensureIndexes } from "./lib/indexes.js";
import { createBot } from "./bot.js";
import { registerAdminCommands } from "./admin.js";
import { deliverOrder } from "./delivery.js";
import { createBackup, listBackups, scheduleBackups } from "./backup.js";
import { checkAllStock, autoEnableOnStock } from "./inventory.js";
import { invalidateCategoryCache } from "./category.js";
import { initVipLevels } from "./vip.js";
import { cleanOldExports, exportOrdersCSV, exportProductsCSV, exportRevenueCSV, exportUsersCSV } from "./export.js";
import { verifyIPNWebhook, parseIPNItems, parseIPNData, isOrderExpired } from "./payment/vietqr.js";
import { adminAddBalance, adminDeductBalance, parseDepositContent, findPendingDeposit, confirmDeposit } from "./wallet.js";
import { sendLog } from "./lib/logger.js";
import { startBankPolling } from "./bank-poller.js";
import { getBroadcastHistory, sendBroadcast, sendVipBroadcast } from "./broadcast.js";
import { getRecentLogs, logAction } from "./audit.js";
import { getRevenueByDay } from "./stats.js";

// Initialize bot
const bot = createBot({});
let botProfile = null;
let bankPolling = null;

// Register admin commands
registerAdminCommands(bot);

// Initialize Express server
const app = express();

// Gzip compression — giảm bandwidth ~60-80% cho catalog/admin API.
// Mặc định compression bỏ qua response < 1KB và nén từ 1KB trở lên.
app.use(compression());

// Content Security Policy — chống XSS bằng cách chặn inline script/style.
// Cho phép:
//   - script-src 'self'                           (chỉ load JS từ cùng domain)
//   - style-src 'self' + Google Fonts             (CSS local + fonts.googleapis.com)
//   - font-src 'self' fonts.gstatic.com           (font Google Fonts)
//   - img-src 'self' data: https:                 (cho ảnh, base64, CDN icon)
//   - connect-src 'self'                          (fetch chỉ tới same-origin)
//   - frame-ancestors 'none'                      (chống clickjacking)
//   - 'unsafe-inline' cho style-src vì code có 1 vài style="" động (cosmetic).
//     Có thể siết lại sau khi refactor hết style inline.
app.use((_req, res, next) => {
    res.setHeader(
        "Content-Security-Policy",
        [
            "default-src 'self'",
            "script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net",
            "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
            "font-src 'self' https://fonts.gstatic.com",
            "img-src 'self' data: https:",
            "connect-src 'self'",
            "frame-ancestors 'none'",
            "base-uri 'self'",
            "object-src 'none'",
        ].join("; "),
    );
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    res.setHeader("X-Frame-Options", "DENY");
    next();
});

const publicDir = path.join(process.cwd(), "public");

// Setup multer for image uploads
const uploadsDir = path.join(publicDir, "uploads", "products");
if (!existsSync(uploadsDir)) mkdirSync(uploadsDir, { recursive: true });
const _upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, uploadsDir),
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase() || ".jpg";
      cb(null, `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`);
    },
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = ["image/jpeg", "image/png", "image/webp", "image/gif"];
    cb(null, allowed.includes(file.mimetype));
  },
});

// Serve uploaded files
app.use("/uploads", express.static(path.join(publicDir, "uploads")));

app.get("/shop", (_req, res) => {
  res.sendFile(path.join(publicDir, "shop", "index.html"));
});

app.use("/shop", express.static(path.join(publicDir, "shop"), {
  maxAge: process.env.NODE_ENV === "production" ? "1h" : 0,
}));

// Admin icons management page
app.get("/admin-icons", (_req, res) => {
  res.sendFile(path.join(publicDir, "admin-icons", "index.html"));
});

app.use("/admin-icons", express.static(path.join(publicDir, "admin-icons")));

function checkAdminSecret(req, res) {
  const adminSecret = process.env.ADMIN_SECRET || "your-secret-here";
  if (req.query.secret !== adminSecret) {
    res.status(403).json({ error: "Unauthorized" });
    return false;
  }
  return true;
}

app.post("/admin/login", express.json(), (req, res) => {
  const { username, password } = req.body || {};
  const adminUsername = process.env.ADMIN_USERNAME;
  const adminPassword = process.env.ADMIN_PASSWORD;
  if (!adminUsername || !adminPassword) return res.status(403).json({ error: "Chưa cấu hình tài khoản admin" });
  if (username !== adminUsername || password !== adminPassword) return res.status(403).json({ error: "Tên đăng nhập hoặc mật khẩu không đúng" });
  res.json({ ok: true, secret: process.env.ADMIN_SECRET || "your-secret-here" });
});

// OTP store: telegramId → { otp, expiresAt, attempts }
const otpStore = new Map();

app.post("/admin/otp/request", express.json(), async (req, res) => {
  const { telegramId } = req.body || {};
  if (!telegramId) return res.status(400).json({ error: "Thiếu telegramId" });
  const adminIds = (process.env.ADMIN_IDS || "").split(",").map(id => id.trim());
  if (!adminIds.includes(String(telegramId))) {
    return res.status(403).json({ error: "Telegram ID không có quyền admin" });
  }
  const otp = String(Math.floor(100000 + Math.random() * 900000));
  otpStore.set(String(telegramId), { otp, expiresAt: Date.now() + 5 * 60 * 1000, attempts: 0 });
  try {
    await bot.telegram.sendMessage(
      telegramId,
      `🔐 *Mã đăng nhập Admin Web*\n\nMã OTP của bạn: \`${otp}\`\n\nMã có hiệu lực trong *5 phút*. Không chia sẻ mã này cho ai.`,
      { parse_mode: "Markdown" }
    );
    res.json({ ok: true });
  } catch (e) {
    otpStore.delete(String(telegramId));
    res.status(500).json({ error: "Không thể gửi OTP qua Telegram" });
  }
});

app.post("/admin/otp/verify", express.json(), async (req, res) => {
  const { telegramId, otp } = req.body || {};
  if (!telegramId || !otp) return res.status(400).json({ error: "Thiếu thông tin" });
  const record = otpStore.get(String(telegramId));
  if (!record) return res.status(400).json({ error: "Chưa yêu cầu OTP hoặc đã hết hạn" });
  if (Date.now() > record.expiresAt) {
    otpStore.delete(String(telegramId));
    return res.status(400).json({ error: "Mã OTP đã hết hạn" });
  }
  record.attempts += 1;
  if (record.attempts > 5) {
    otpStore.delete(String(telegramId));
    return res.status(429).json({ error: "Quá nhiều lần thử. Yêu cầu mã mới." });
  }
  if (otp !== record.otp) return res.status(400).json({ error: "Mã OTP không đúng" });
  otpStore.delete(String(telegramId));
  const secret = process.env.ADMIN_SECRET || "your-secret-here";
  res.json({ ok: true, secret });
});

app.get("/api/admin/icon-overrides", async (req, res) => {
  if (!checkAdminSecret(req, res)) return;
  try {
    const setting = await prisma.setting.findUnique({ where: { key: "icon_overrides" } });
    const overrides = setting ? JSON.parse(setting.value) : {};
    res.json({ overrides });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/admin/icon-overrides", express.json(), async (req, res) => {
  if (!checkAdminSecret(req, res)) return;
  try {
    const { productId, iconSlug } = req.body;
    if (!productId) return res.status(400).json({ error: "productId required" });

    const setting = await prisma.setting.findUnique({ where: { key: "icon_overrides" } });
    const overrides = setting ? JSON.parse(setting.value) : {};

    if (!iconSlug) {
      delete overrides[productId];
    } else {
      overrides[productId] = iconSlug;
    }

    await prisma.setting.upsert({
      where: { key: "icon_overrides" },
      update: { value: JSON.stringify(overrides) },
      create: { key: "icon_overrides", value: JSON.stringify(overrides) },
    });

    res.json({ success: true, overrides });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/admin/icon-overrides/bulk", express.json(), async (req, res) => {
  if (!checkAdminSecret(req, res)) return;
  try {
    const { overrides: incoming } = req.body || {};
    if (!Array.isArray(incoming)) return res.status(400).json({ error: "overrides array required" });
    const setting = await prisma.setting.findUnique({ where: { key: "icon_overrides" } });
    const overrides = setting ? JSON.parse(setting.value) : {};
    for (const { productId, iconSlug } of incoming) {
      if (!productId) continue;
      if (iconSlug) overrides[productId] = iconSlug;
      else delete overrides[productId];
    }
    await prisma.setting.upsert({
      where: { key: "icon_overrides" },
      update: { value: JSON.stringify(overrides) },
      create: { key: "icon_overrides", value: JSON.stringify(overrides) },
    });
    res.json({ success: true, overrides, saved: incoming.length });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Root route - Bot info
app.get("/", (req, res) => {
  res.json({
    name: "Telegram Shop Bot",
    status: "running",
    version: "3.0",
    endpoints: {
      health: "/health",
      shop: "/shop",
      catalog: "/api/shop/catalog",
      seed: "/admin/seed?secret=YOUR_SECRET",
      webhook: "/webhook/ipn"
    }
  });
});

// Health check
app.get("/health", (req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// Public catalog for the lightweight web shop.
// Do not expose product payload or stock line contents here.
// Cache 30s in memory để giảm load DB.
let _catalogCache = { data: null, ts: 0 };
const CATALOG_TTL_MS = 30_000;

function invalidateCatalogCache() {
  _catalogCache = { data: null, ts: 0 };
}

app.get("/api/shop/catalog", async (_req, res) => {
  // Serve from cache if fresh
  if (_catalogCache.data && Date.now() - _catalogCache.ts < CATALOG_TTL_MS) {
    return res.json(_catalogCache.data);
  }

  try {
    const [categories, products, iconOverridesSetting, shopSettings] = await Promise.all([
      prisma.category.findMany({
        where: { isActive: true },
        orderBy: [{ order: "asc" }, { name: "asc" }],
        include: {
          _count: {
            select: { products: { where: { isActive: true } } },
          },
        },
      }),
      prisma.product.findMany({
        where: { isActive: true },
        orderBy: { createdAt: "desc" },
        include: { category: true },
      }),
      prisma.setting.findUnique({ where: { key: "icon_overrides" } }),
      prisma.setting.findMany({ where: { key: { in: ["SHOP_NAME", "SHOP_BANNER_TEXT", "SHOP_BANK_NAME", "SHOP_BANK_ACCOUNT", "SHOP_BANK_ACCOUNT_NAME", "SHOP_SUPPORT_USERNAME"] } } }),
    ]);

    const iconOverrides = iconOverridesSetting ? JSON.parse(iconOverridesSetting.value) : {};
    const settings = Object.fromEntries(shopSettings.map(s => [s.key, s.value]));

    const stockProductIds = products
      .filter((product) => product.deliveryMode === "STOCK_LINES")
      .map((product) => product.id);

    // Run both count queries in parallel
    const [stockCounts, soldCountRows] = await Promise.all([
      stockProductIds.length
        ? prisma.stockItem.groupBy({
            by: ["productId"],
            where: { productId: { in: stockProductIds }, isSold: false },
            _count: { _all: true },
          })
        : Promise.resolve([]),
      products.length
        ? prisma.order.groupBy({
            by: ["productId"],
            where: { productId: { in: products.map(p => p.id) }, status: "DELIVERED" },
            _count: { _all: true },
          })
        : Promise.resolve([]),
    ]);

    const stockByProductId = new Map(stockCounts.map(r => [r.productId, r._count._all]));
    const soldByProductId = new Map(soldCountRows.map(r => [r.productId, r._count._all]));

    const responseData = {
      shop: {
        name: settings.SHOP_NAME || process.env.SHOP_NAME || "Shop Bot Tele",
        currency: "VND",
        bannerText: settings.SHOP_BANNER_TEXT || null,
        supportUsername: settings.SHOP_SUPPORT_USERNAME || process.env.ADMIN_TELEGRAM || null,
        botUsername: process.env.TELEGRAM_BOT_USERNAME || botProfile?.username || null,
        bank: {
          name: settings.SHOP_BANK_NAME || process.env.BANK_NAME || process.env.DEFAULT_BANK_NAME || "MB Bank",
          account: settings.SHOP_BANK_ACCOUNT || process.env.BANK_ACCOUNT || process.env.DEFAULT_BANK_ACCOUNT || "",
          owner: settings.SHOP_BANK_ACCOUNT_NAME || process.env.BANK_ACCOUNT_NAME || process.env.DEFAULT_BANK_OWNER || "",
        },
      },
      categories: categories.map((category) => ({
        id: category.id,
        name: category.name,
        icon: category.icon,
        iconEmojiId: category.iconEmojiId || null,
        productCount: category._count.products,
      })),
      products: products.map((product) => {
        const stockCount = product.deliveryMode === "STOCK_LINES"
          ? stockByProductId.get(product.id) || 0
          : null;

        return {
          id: product.id,
          code: product.code,
          name: product.name,
          description: product.description || "",
          note: product.note || "",
          price: product.price,
          vipPrice: product.vipPrice,
          currency: product.currency || "VND",
          deliveryMode: product.deliveryMode,
          imageUrl: product.imageUrl || null,
          categoryId: product.categoryId,
          categoryName: product.category?.name || "Khác",
          categoryIcon: product.category?.icon || "",
          iconSlug: iconOverrides[product.id] || null,
          stockCount,
          soldCount: soldByProductId.get(product.id) || 0,
          inStock: product.deliveryMode === "STOCK_LINES" ? stockCount > 0 : true,
          createdAt: product.createdAt,
        };
      }),
    };

    _catalogCache = { data: responseData, ts: Date.now() };
    res.json(responseData);
  } catch (error) {
    console.error("Catalog API error:", error);
    res.status(500).json({
      message: "Không thể tải dữ liệu sản phẩm. Vui lòng thử lại sau.",
    });
  }
});

// Seed endpoint (protected by admin secret)
app.get("/admin/seed", async (req, res) => {
  const { secret } = req.query;
  const adminSecret = process.env.ADMIN_SECRET || "your-secret-here";

  if (secret !== adminSecret) {
    return res.status(403).json({ error: "Unauthorized" });
  }

  try {
    res.write("🌱 Starting seed...\n\n");

    // Seed data — categories matching shop layout
    const categories = [
      { name: 'ADOBE',         icon: '🎨', order: 1  },
      { name: 'CANVA',         icon: '🎨', order: 2  },
      { name: 'CAPCUT PRO',    icon: '✂️', order: 3  },
      { name: 'CHATGPT',       icon: '🤖', order: 4  },
      { name: 'CLAUDE AI',     icon: '🧠', order: 5  },
      { name: 'Cursor AI',     icon: '💻', order: 6  },
      { name: 'Elenven',       icon: '🎵', order: 7  },
      { name: 'GAMMA AI',      icon: '✨', order: 8  },
      { name: 'GEMINI AI',     icon: '✨', order: 9  },
      { name: 'GROK SUPER',    icon: '🔮', order: 10 },
      { name: 'HEYGEN AI',     icon: '👤', order: 11 },
      { name: 'HIGGFIELD PLAN',icon: '🏔️', order: 12 },
      { name: 'KLING',         icon: '🎬', order: 13 },
      { name: 'OpenArt AI',    icon: '🖼️', order: 14 },
      { name: 'SUNO AI',       icon: '🎵', order: 15 },
      { name: 'VEO3 ULTRA',    icon: '🎬', order: 16 },
      { name: 'viewmax',       icon: '📺', order: 17 },
    ];

    const products = [
      { category: 'ADOBE',         code: 'ADOBE001',   name: 'Adobe Creative Cloud 1 Tháng',   price: 0 },
      { category: 'CANVA',         code: 'CANVA001',   name: 'Canva Pro 1 Tháng',               price: 0 },
      { category: 'CAPCUT PRO',    code: 'CAP001',     name: 'CapCut Pro 1 Tháng',              price: 0 },
      { category: 'CHATGPT',       code: 'GPT001',     name: 'ChatGPT Plus 1 Tháng',            price: 0 },
      { category: 'CHATGPT',       code: 'GPT002',     name: 'ChatGPT Team 3 Tháng',            price: 0 },
      { category: 'CLAUDE AI',     code: 'CLAUDE001',  name: 'Claude Pro 1 Tháng',              price: 0 },
      { category: 'Cursor AI',     code: 'CURSOR001',  name: 'Cursor Pro 1 Tháng',              price: 0 },
      { category: 'Elenven',       code: 'ELEV001',    name: 'ElevenLabs Starter 1 Tháng',      price: 0 },
      { category: 'GAMMA AI',      code: 'GAMMA001',   name: 'Gamma AI Plus 1 Tháng',           price: 0 },
      { category: 'GEMINI AI',     code: 'GEMINI001',  name: 'Gemini Advanced 1 Tháng',         price: 0 },
      { category: 'GROK SUPER',    code: 'GROK001',    name: 'Grok Super 1 Tháng',              price: 0 },
      { category: 'HEYGEN AI',     code: 'HEYGEN001',  name: 'HeyGen Basic 1 Tháng',            price: 0 },
      { category: 'HIGGFIELD PLAN',code: 'HIGG001',    name: 'Higgfield Plan 1 Tháng',          price: 0 },
      { category: 'KLING',         code: 'KLING001',   name: 'Kling AI Pro 1 Tháng',            price: 0 },
      { category: 'OpenArt AI',    code: 'OPENART001', name: 'OpenArt AI Pro 1 Tháng',          price: 0 },
      { category: 'SUNO AI',       code: 'SUNO001',    name: 'Suno AI Pro 1 Tháng',             price: 0 },
      { category: 'VEO3 ULTRA',    code: 'VEO001',     name: 'Veo3 Ultra 1 Tháng',              price: 0 },
      { category: 'viewmax',       code: 'VIEW001',    name: 'Viewmax Premium 1 Tháng',         price: 0 },
    ];

    res.write("🗑️  Deleting old data (orders, stock, products, categories)...\n");
    await prisma.order.deleteMany();
    await prisma.stockItem.deleteMany();
    await prisma.product.deleteMany();
    await prisma.category.deleteMany();
    res.write("✅ Old data deleted\n\n");

    res.write("📁 Creating categories...\n");
    for (const cat of categories) {
      await prisma.category.create({ data: cat });
      res.write(`   ✅ ${cat.icon} ${cat.name}\n`);
    }
    res.write("\n");

    res.write("📦 Creating products...\n");
    for (const prod of products) {
      const category = await prisma.category.findUnique({ where: { name: prod.category } });
      const adminUsername = process.env.ADMIN_TELEGRAM || "admin";
      await prisma.product.create({
        data: {
          code: prod.code,
          name: prod.name,
          price: prod.price,
          deliveryMode: 'TEXT',
          payload: `Liên hệ Admin @${adminUsername}`,
          categoryId: category.id,
          currency: 'VND',
          isActive: true,
        }
      });
      res.write(`   ✅ ${prod.name} (${prod.price.toLocaleString()}đ)\n`);
    }

    res.write(`\n🎉 Seed completed!\n`);
    res.write(`📊 Created ${categories.length} categories and ${products.length} products\n`);
    res.end();
  } catch (e) {
    console.error("Seed error:", e);
    res.write(`\n❌ Seed failed: ${e.message}\n`);
    res.status(500).end();
  }
});

// Seed fake orders for testing
app.get("/admin/seed-orders", async (req, res) => {
  const { secret } = req.query;
  if (secret !== (process.env.ADMIN_SECRET || "your-secret-here")) {
    return res.status(403).json({ error: "Unauthorized" });
  }
  try {
    const products = await prisma.product.findMany({ where: { isActive: true }, take: 10 });
    if (!products.length) return res.json({ error: "No products found. Run /admin/seed first." });

    const statuses = ["PENDING", "PAID", "DELIVERED", "DELIVERED", "DELIVERED", "CANCELED"];
    const methods = ["vietqr", "wallet"];
    const fakeUsers = [
      { telegramId: "111111111", chatId: "111111111", name: "Nguyễn Văn A" },
      { telegramId: "222222222", chatId: "222222222", name: "Trần Thị B" },
      { telegramId: "333333333", chatId: "333333333", name: "Lê Minh C" },
      { telegramId: "444444444", chatId: "444444444", name: "Phạm Thị D" },
      { telegramId: "555555555", chatId: "555555555", name: "Hoàng Văn E" },
    ];

    const prices = [49000, 99000, 149000, 199000, 299000, 399000, 499000];
    let created = 0;

    for (let i = 0; i < 30; i++) {
      const product = products[i % products.length];
      const user = fakeUsers[i % fakeUsers.length];
      const status = statuses[i % statuses.length];
      const method = methods[i % methods.length];
      const price = prices[i % prices.length];
      const daysAgo = Math.floor(i / 3);
      const createdAt = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000);

      await prisma.order.create({
        data: {
          odelegramId: user.telegramId,
          chatId: user.chatId,
          productId: product.id,
          quantity: 1,
          amount: price,
          discount: 0,
          finalAmount: price,
          currency: "VND",
          status,
          paymentMethod: method,
          paymentRef: status !== "PENDING" ? `TEST${Date.now()}${i}` : null,
          createdAt,
        },
      });
      created++;
    }

    res.json({ success: true, created, message: `Đã tạo ${created} đơn hàng test` });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/**
 * IPN Webhook - Tự động xác nhận chuyển khoản
 * Hỗ trợ: Casso, SePay, hoặc custom webhook
 * 
 * Cấu hình trong ngân hàng hoặc service:
 * URL: https://your-domain.com/webhook/ipn
 * Method: POST
 * Header: secure-token: YOUR_IPN_SECRET_TOKEN
 */
app.post("/webhook/ipn", express.json(), async (req, res) => {
  try {
    console.log("📥 IPN Webhook received:", JSON.stringify(req.body).slice(0, 200));

    // Verify webhook signature
    const provider = req.query.provider || "casso";
    verifyIPNWebhook(req, provider);

    if ((Array.isArray(req.body?.TranList) && req.body.TranList.length) || (Array.isArray(req.body?.transactions) && req.body.transactions.length)) {
      const items = parseIPNItems(req.body, provider).filter((item) => item.amount && item.content);

      if (!items.length) {
        console.log("MBBank IPN missing usable transactions");
        return res.json({ success: false, message: "Missing data" });
      }

      for (const { amount, content, transactionId } of items) {
        const upperContent = (content || "").toUpperCase().replace(/\s+/g, "");
        console.log(`MBBank IPN: ${amount} | ${upperContent} | ${transactionId}`);

        const depositInfo = parseDepositContent(content);
        if (depositInfo) {
          const pendingDeposit = await findPendingDeposit(depositInfo.telegramId, depositInfo.transactionIdSuffix);
          if (pendingDeposit && Math.abs(amount - pendingDeposit.amount) <= 1000) {
            const result = await confirmDeposit(pendingDeposit.id, transactionId);
            if (result.success) {
              await bot.clearPaymentMessages?.(depositInfo.telegramId, `deposit:${pendingDeposit.id}`);
              try {
                await bot.telegram.sendMessage(
                  depositInfo.telegramId,
                  `✅ *NẠP TIỀN THÀNH CÔNG*\n\n` +
                  `💰 Số tiền: +${amount.toLocaleString()}đ\n` +
                  `💵 Số dư mới: ${result.newBalance.toLocaleString()}đ\n\n` +
                  `Cảm ơn bạn đã nạp tiền!`,
                  { parse_mode: "Markdown" }
                );
              } catch (e) {
                console.log("Could not notify user:", e.message);
              }

              sendLog("DEPOSIT", `✅ *TIỀN VÀO VÍ*\n👤 User: \`${depositInfo.telegramId}\`\n💰 Số tiền: +${amount.toLocaleString()}đ\n💵 Số dư mới: ${result.newBalance.toLocaleString()}đ`);
              return res.json({ success: true, type: "deposit", walletBalance: result.newBalance });
            }
          }
        }

        const pendingOrders = await prisma.order.findMany({
          where: {
            status: "PENDING",
            paymentMethod: "vietqr",
          },
          orderBy: { createdAt: "desc" },
          take: 50,
        });

        for (const order of pendingOrders) {
          if (isOrderExpired(order.createdAt)) {
            await prisma.order.update({
              where: { id: order.id },
              data: { status: "CANCELED" },
            });
            continue;
          }

          const shortId = order.id.slice(-8).toUpperCase();
          if (upperContent.includes(`SHOP${shortId}`)) {
            if (Math.abs(amount - order.finalAmount) <= 1000) {
              await prisma.order.update({
                where: { id: order.id },
                data: {
                  status: "PAID",
                  paymentRef: transactionId || order.paymentRef,
                },
              });

              sendLog("ORDER", `✅ *ĐƠN HÀNG ĐÃ THANH TOÁN*\n📦 Order ID: \`${order.id}\`\n💰 Số tiền: ${order.finalAmount.toLocaleString()}đ`);
              await bot.clearPaymentMessages?.(order.chatId || order.odelegramId, `order:${order.id}`);
              const updatedOrder = await prisma.order.findUnique({ where: { id: order.id } });
              await deliverOrder({ prisma, telegram: bot.telegram, order: updatedOrder });
              return res.json({ success: true, orderId: order.id });
            }
          }
        }
      }

      console.log("No matching MBBank transaction found");
      return res.json({ success: true, message: "No matching transaction" });
    }

    // Parse IPN data
    const { amount, content, transactionId } = parseIPNData(req.body, provider);

    if (!amount || !content) {
      console.log("❌ Missing amount or content in IPN");
      return res.json({ success: false, message: "Missing data" });
    }

    console.log(`💰 IPN: ${amount}đ | Content: ${content} | TID: ${transactionId}`);

    const upperContent = (content || "").toUpperCase().replace(/\s+/g, "");

    // === CHECK FOR WALLET DEPOSIT (NAP format) ===
    const depositInfo = parseDepositContent(content);
    if (depositInfo) {
      console.log(`💳 Deposit detected: User ${depositInfo.telegramId}, TX suffix ${depositInfo.transactionIdSuffix}`);

      const pendingDeposit = await findPendingDeposit(depositInfo.telegramId, depositInfo.transactionIdSuffix);

      if (pendingDeposit) {
        // Verify amount matches (allow small difference)
        if (Math.abs(amount - pendingDeposit.amount) <= 1000) {
          const result = await confirmDeposit(pendingDeposit.id, transactionId);

          if (result.success) {
            console.log(`✅ Wallet deposit confirmed: User ${depositInfo.telegramId}, Amount ${amount}, New balance ${result.newBalance}`);
            await bot.clearPaymentMessages?.(depositInfo.telegramId, `deposit:${pendingDeposit.id}`);

            // Notify user
            try {
              await bot.telegram.sendMessage(
                depositInfo.telegramId,
                `✅ *NẠP TIỀN THÀNH CÔNG*\n\n` +
                `💰 Số tiền: +${amount.toLocaleString()}đ\n` +
                `💵 Số dư mới: ${result.newBalance.toLocaleString()}đ\n\n` +
                `Cảm ơn bạn đã nạp tiền!`,
                { parse_mode: "Markdown" }
              );
            } catch (e) {
              console.log("Could not notify user:", e.message);
            }

            sendLog("DEPOSIT", `✅ *TIỀN VÀO VÍ*\n👤 User: \`${depositInfo.telegramId}\`\n💰 Số tiền: +${amount.toLocaleString()}đ\n💵 Số dư mới: ${result.newBalance.toLocaleString()}đ`);

            return res.json({ success: true, type: "deposit", walletBalance: result.newBalance });
          }
        } else {
          console.log(`⚠️ Deposit amount mismatch: Expected ${pendingDeposit.amount}, got ${amount}`);
        }
      }
    }

    // === CHECK FOR ORDER PAYMENT (SHOP format) ===
    // Find matching pending order
    const pendingOrders = await prisma.order.findMany({
      where: {
        status: "PENDING",
        paymentMethod: "vietqr",
      },
      orderBy: { createdAt: "desc" },
      take: 50,
    });

    let matchedOrder = null;

    for (const order of pendingOrders) {
      // Check if expired
      if (isOrderExpired(order.createdAt)) {
        await prisma.order.update({
          where: { id: order.id },
          data: { status: "CANCELED" },
        });
        continue;
      }

      // Match by content — yêu cầu prefix SHOP để tránh false-match với content khác
      const shortId = order.id.slice(-8).toUpperCase();

      if (upperContent.includes(`SHOP${shortId}`)) {
        // Also verify amount matches
        if (Math.abs(amount - order.finalAmount) <= 1000) {
          matchedOrder = order;
          break;
        }
      }
    }

    if (!matchedOrder) {
      console.log("⚠️ No matching order or deposit found for IPN");
      return res.json({ success: true, message: "No matching transaction" });
    }

    console.log(`✅ Matched order: ${matchedOrder.id}`);

    // Update order status
    await prisma.order.update({
      where: { id: matchedOrder.id },
      data: {
        status: "PAID",
        paymentRef: transactionId || matchedOrder.paymentRef,
      },
    });

    sendLog("ORDER", `✅ *ĐƠN HÀNG ĐÃ THANH TOÁN*\n📦 Order ID: \`${matchedOrder.id}\`\n💰 Số tiền: ${matchedOrder.finalAmount.toLocaleString()}đ`);
    await bot.clearPaymentMessages?.(matchedOrder.chatId || matchedOrder.odelegramId, `order:${matchedOrder.id}`);

    // Deliver order
    const updatedOrder = await prisma.order.findUnique({ where: { id: matchedOrder.id } });
    await deliverOrder({ prisma, telegram: bot.telegram, order: updatedOrder });

    console.log(`📦 Order ${matchedOrder.id} delivered automatically`);

    res.json({ success: true, orderId: matchedOrder.id });
  } catch (err) {
    console.error("IPN webhook error:", err.message);
    res.status(400).json({ success: false, message: err.message });
  }
});

// Cancel expired orders periodically
async function cancelExpiredOrders() {
  const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);

  const expired = await prisma.order.updateMany({
    where: {
      status: "PENDING",
      createdAt: { lt: tenMinutesAgo },
    },
    data: { status: "CANCELED" },
  });

  if (expired.count > 0) {
    console.log(`⏰ Cancelled ${expired.count} expired orders`);
  }
}

// Success page
app.get("/paid", (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html><head>
      <title>Thanh toán thành công</title>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); }
        .card { background: white; padding: 40px; border-radius: 20px; text-align: center; box-shadow: 0 20px 60px rgba(0,0,0,0.3); max-width: 400px; }
        .icon { font-size: 64px; margin-bottom: 20px; }
        h1 { color: #10b981; margin: 0 0 15px; }
        p { color: #6b7280; margin: 10px 0; }
      </style>
    </head><body>
      <div class="card">
        <div class="icon">✅</div>
        <h1>Thanh toán thành công!</h1>
        <p>Đơn hàng đang được xử lý.</p>
        <p>Vui lòng quay lại Telegram để nhận hàng.</p>
      </div>
    </body></html>
  `);
});

// Start server with proper DB flow
const PORT = process.env.PORT || 3000;

async function start() {
  try {
    // Wait for DB to be ready (with retry)
    const dbReady = await waitForDB(10);
    if (!dbReady) {
      console.log("⚠️ Starting without DB confirmation, will retry on queries");
    }

    // Start keep-alive ping to prevent DB sleep
    startKeepAlive();
    console.log("💓 DB keep-alive started");

    // Ensure MongoDB indexes (idempotent — safe to run every boot)
    if (dbReady) {
      ensureIndexes().catch((err) => console.warn("⚠️ Index setup failed:", err.message));

      // Pre-warm catalog cache lúc startup — request đầu tiên không phải đợi DB
      (async () => {
        try {
          const t0 = Date.now();
          const [categories, products] = await Promise.all([
            prisma.category.findMany({ where: { isActive: true } }),
            prisma.product.findMany({ where: { isActive: true } }),
          ]);
          console.log(`🔥 Pre-warmed: ${categories.length} categories, ${products.length} products in ${Date.now() - t0}ms`);
        } catch (e) {
          console.log("Pre-warm skipped:", e.message);
        }
      })();
    }

    // Webhook mode: đăng ký handler trước khi listen
    const WEBHOOK_PATH = `/bot${process.env.BOT_TOKEN?.slice(-10).replace(/[^a-z0-9]/gi, "")}`;
    if (process.env.WEBHOOK_URL) {
      app.use(WEBHOOK_PATH, bot.webhookCallback('/'));
      console.log(`🔗 Webhook path registered: ${WEBHOOK_PATH}`);
    }

    // Start HTTP server
    app.listen(PORT, async () => {
      console.log(`🚀 Server running on port ${PORT}`);
      console.log(`📡 IPN Webhook: /webhook/ipn`);

      const me = await bot.telegram.getMe();
      botProfile = me;

      if (process.env.WEBHOOK_URL) {
        const webhookUrl = `${process.env.WEBHOOK_URL.replace(/\/$/, "")}${WEBHOOK_PATH}`;
        await bot.telegram.setWebhook(webhookUrl, { drop_pending_updates: true });
        console.log(`🤖 Bot webhook mode: ${webhookUrl}`);
      } else {
        await bot.telegram.deleteWebhook({ drop_pending_updates: false });
        bot.launch().catch(err => console.error("❌ Bot launch failed:", err));
        console.log(`🤖 Bot polling mode: @${me.username || me.id}`);
      }
      console.log(`🤖 Bot launched successfully! @${me.username || me.first_name || me.id}`);
      sendLog("SYSTEM", `🤖 Bot launched successfully! @${me.username || me.first_name || me.id}`);

      // Set up command menu for all users (priority order)
      // First delete old commands to force refresh
      try {
        await bot.telegram.deleteMyCommands();
      } catch (e) { }

      await bot.telegram.setMyCommands([
        { command: "start", description: "🏠 Bắt đầu / Mở menu chính" },
        { command: "menu", description: "🛍️ Mở menu shop" },
        { command: "wallet", description: "💳 Nạp tiền vào ví" },
        { command: "me", description: "👤 Tài khoản của tôi" },
        { command: "order", description: "📦 Đơn hàng của tôi" },
        { command: "help", description: "🆘 Hỗ trợ khách hàng" },
      ]);

      // Admin commands (includes admin panel)
      const adminIds = (process.env.ADMIN_IDS || "").split(",").filter(Boolean);
      console.log(`📋 Setting admin commands for: [${adminIds.join(", ")}]`);
      for (const adminId of adminIds) {
        try {
          // Delete old admin commands first
          await bot.telegram.deleteMyCommands({ scope: { type: "chat", chat_id: Number(adminId) } });

          await bot.telegram.setMyCommands(
            [
              { command: "start", description: "🏠 Bắt đầu / Mở menu chính" },
              { command: "menu", description: "🛍️ Mở menu shop" },
              { command: "admin", description: "🛠️ Admin Panel" },
              { command: "wallet", description: "💳 Nạp tiền vào ví" },
              { command: "me", description: "👤 Tài khoản của tôi" },
              { command: "order", description: "📦 Đơn hàng của tôi" },
              { command: "help", description: "🆘 Hỗ trợ khách hàng" },
            ],
            { scope: { type: "chat", chat_id: Number(adminId) } }
          );
          console.log(`✅ Admin commands set for ${adminId}`);
        } catch (e) {
          console.log(`Could not set admin commands for ${adminId}: ${e.message}`);
        }
      }
      console.log("📋 Command menu registered");

      // Initialize VIP levels
      await initVipLevels();

      // Schedule auto backup
      scheduleBackups(bot, 24);

      // Check stock on startup
      await checkAllStock(bot);

      // Clean old exports
      await cleanOldExports(24);

      // Cancel expired orders every minute
      setInterval(cancelExpiredOrders, 60 * 1000);
      bankPolling = startBankPolling({
        telegram: bot.telegram,
        clearPaymentMessages: bot.clearPaymentMessages,
      });
      console.log("⏰ Order expiration check started");
    });

    // Graceful shutdown
    process.once("SIGINT", () => {
      console.log("Shutting down...");
      bankPolling?.stop?.();
      if (!process.env.WEBHOOK_URL) bot.stop("SIGINT");
    });

    process.once("SIGTERM", () => {
      console.log("Shutting down...");
      bankPolling?.stop?.();
      bot.stop("SIGTERM");
    });

  } catch (e) {
    console.error("❌ Start error:", e.message);
    console.log("🔄 Retrying in 5 seconds...");
    setTimeout(start, 5000);
  }
}

// === ADMIN API ===

app.get("/api/admin/stats", async (req, res) => {
  if (!checkAdminSecret(req, res)) return;
  try {
    const today = new Date(); today.setHours(0,0,0,0);
    const [totalOrders, todayOrders, totalUsers, totalRevenue, todayRevenue, pendingOrders, totalProducts] = await Promise.all([
      prisma.order.count(),
      prisma.order.count({ where: { createdAt: { gte: today } } }),
      prisma.user.count(),
      prisma.order.aggregate({ where: { status: "DELIVERED" }, _sum: { finalAmount: true } }),
      prisma.order.aggregate({ where: { status: "DELIVERED", createdAt: { gte: today } }, _sum: { finalAmount: true } }),
      prisma.order.count({ where: { status: "PENDING" } }),
      prisma.product.count({ where: { isActive: true } }),
    ]);
    res.json({ totalOrders, todayOrders, totalUsers, totalRevenue: totalRevenue._sum.finalAmount || 0, todayRevenue: todayRevenue._sum.finalAmount || 0, pendingOrders, totalProducts });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get("/api/admin/revenue-chart", async (req, res) => {
  if (!checkAdminSecret(req, res)) return;
  try {
    const days = parseInt(req.query.days) || 7;
    const data = await getRevenueByDay(Math.min(days, 30));
    res.json(data);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get("/api/admin/orders", async (req, res) => {
  if (!checkAdminSecret(req, res)) return;
  try {
    const limit = Math.min(Number(req.query.limit) || 20, 100);
    const skip = Number(req.query.skip) || 0;
    const status = req.query.status || undefined;
    const search = (req.query.search || "").trim();
    const dateFrom = req.query.dateFrom ? new Date(req.query.dateFrom) : undefined;
    const dateTo = req.query.dateTo ? new Date(req.query.dateTo) : undefined;

    const where = {};
    if (status) where.status = status;
    if (search) where.OR = [
      { odelegramId: { contains: search } },
      { id: { contains: search, mode: "insensitive" } },
    ];
    if (dateFrom || dateTo) {
      where.createdAt = {};
      if (dateFrom) where.createdAt.gte = dateFrom;
      if (dateTo) { const end = new Date(dateTo); end.setHours(23,59,59,999); where.createdAt.lte = end; }
    }

    const [orders, total] = await Promise.all([
      prisma.order.findMany({
        where,
        orderBy: { createdAt: "desc" }, take: limit, skip,
        include: {
          product: { select: { name: true, code: true } },
          user: { select: { username: true, firstName: true, telegramId: true } },
        },
      }),
      prisma.order.count({ where }),
    ]);
    res.json({ orders, total });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.put("/api/admin/orders/:id", express.json(), async (req, res) => {
  if (!checkAdminSecret(req, res)) return;
  try {
    const order = await prisma.order.update({ where: { id: req.params.id }, data: { status: req.body.status } });
    res.json({ success: true, order });
  } catch(e) { res.status(400).json({ error: e.message }); }
});

app.get("/api/admin/products", async (req, res) => {
  if (!checkAdminSecret(req, res)) return;
  try {
    const products = await prisma.product.findMany({
      orderBy: [{ isActive: "desc" }, { createdAt: "desc" }],
      include: {
        category: { select: { name: true, icon: true } },
        _count: { select: { stockItems: { where: { isSold: false } } } },
      },
    });
    const soldCounts = await Promise.all(
      products.map(p => prisma.order.count({ where: { productId: p.id, status: { in: ["PAID", "DELIVERED"] } } }))
    );
    const result = products.map((p, i) => ({ ...p, soldCount: soldCounts[i] }));
    res.json({ products: result });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post("/api/admin/products", express.json(), async (req, res) => {
  if (!checkAdminSecret(req, res)) return;
  try {
    const { name, code, price, vipPrice, deliveryMode, payload, categoryId, description, note, imageUrl, stockAlertAt, autoDisableAt, autoHideWhenEmpty } = req.body;
    const product = await prisma.product.create({
      data: {
        name,
        code,
        price: Number(price) || 0,
        vipPrice: vipPrice === "" || vipPrice === null || vipPrice === undefined ? null : Number(vipPrice) || null,
        deliveryMode: deliveryMode || "TEXT",
        payload: payload || "",
        categoryId: categoryId || null,
        description: description || "",
        note: note || null,
        imageUrl: imageUrl || null,
        stockAlertAt: Number(stockAlertAt) || 5,
        autoDisableAt: Number(autoDisableAt) || 0,
        autoHideWhenEmpty: autoHideWhenEmpty === true || autoHideWhenEmpty === "true",
        currency: "VND",
        isActive: true,
      },
    });
    invalidateCategoryCache();
    res.json({ success: true, product });
  } catch(e) { res.status(400).json({ error: e.message }); }
});

app.put("/api/admin/products/:id", express.json(), async (req, res) => {
  if (!checkAdminSecret(req, res)) return;
  try {
    const { name, code, price, vipPrice, deliveryMode, payload, categoryId, description, note, imageUrl, stockAlertAt, autoDisableAt, autoHideWhenEmpty, isActive } = req.body;
    const data = {};
    if (name !== undefined) data.name = name;
    if (code !== undefined) data.code = code;
    if (price !== undefined) data.price = Number(price) || 0;
    if (vipPrice !== undefined) data.vipPrice = vipPrice === "" || vipPrice === null ? null : Number(vipPrice) || null;
    if (deliveryMode !== undefined) data.deliveryMode = deliveryMode;
    if (payload !== undefined) data.payload = payload;
    if (categoryId !== undefined) data.categoryId = categoryId || null;
    if (description !== undefined) data.description = description;
    if (note !== undefined) data.note = note || null;
    if (imageUrl !== undefined) data.imageUrl = imageUrl || null;
    if (stockAlertAt !== undefined) data.stockAlertAt = Number(stockAlertAt) || 0;
    if (autoDisableAt !== undefined) data.autoDisableAt = Number(autoDisableAt) || 0;
    if (autoHideWhenEmpty !== undefined) data.autoHideWhenEmpty = autoHideWhenEmpty === true || autoHideWhenEmpty === "true";
    if (isActive !== undefined) data.isActive = isActive === true || isActive === "true";
    const product = await prisma.product.update({
      where: { id: req.params.id },
      data,
    });
    invalidateCategoryCache();
    res.json({ success: true, product });
  } catch(e) { res.status(400).json({ error: e.message }); }
});

app.delete("/api/admin/products/:id", async (req, res) => {
  if (!checkAdminSecret(req, res)) return;
  try {
    await prisma.product.update({ where: { id: req.params.id }, data: { isActive: false } });
    invalidateCategoryCache();
    res.json({ success: true });
  } catch(e) { res.status(400).json({ error: e.message }); }
});

app.get("/api/admin/categories", async (req, res) => {
  if (!checkAdminSecret(req, res)) return;
  try {
    const categories = await prisma.category.findMany({ orderBy: { order: "asc" } });
    res.json({ categories });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post("/api/admin/categories", express.json(), async (req, res) => {
  if (!checkAdminSecret(req, res)) return;
  try {
    const { name, icon, order } = req.body;
    const category = await prisma.category.create({ data: { name, icon: icon || "📁", order: Number(order) || 0, isActive: true } });
    invalidateCategoryCache();
    res.json({ success: true, category });
  } catch(e) { res.status(400).json({ error: e.message }); }
});

app.put("/api/admin/categories/:id", express.json(), async (req, res) => {
  if (!checkAdminSecret(req, res)) return;
  try {
    const { name, icon, iconEmojiId, order, isActive } = req.body;
    const data = {};
    if (name !== undefined) data.name = name;
    if (icon !== undefined) {
      data.icon = icon || "📁";
      // When icon is updated via web admin, clear stale custom emoji ID unless explicitly provided
      data.iconEmojiId = iconEmojiId !== undefined ? (iconEmojiId || null) : null;
    }
    if (order !== undefined) data.order = Number(order) || 0;
    if (isActive !== undefined) data.isActive = isActive === true || isActive === "true";
    const category = await prisma.category.update({ where: { id: req.params.id }, data });
    invalidateCategoryCache();
    res.json({ success: true, category });
  } catch(e) { res.status(400).json({ error: e.message }); }
});

app.delete("/api/admin/categories/:id", async (req, res) => {
  if (!checkAdminSecret(req, res)) return;
  try {
    await prisma.category.update({ where: { id: req.params.id }, data: { isActive: false } });
    invalidateCategoryCache();
    res.json({ success: true });
  } catch(e) { res.status(400).json({ error: e.message }); }
});

app.get("/api/admin/stock/:productId", async (req, res) => {
  if (!checkAdminSecret(req, res)) return;
  try {
    const [available, sold] = await Promise.all([
      prisma.stockItem.count({ where: { productId: req.params.productId, isSold: false } }),
      prisma.stockItem.count({ where: { productId: req.params.productId, isSold: true } }),
    ]);
    res.json({ available, sold });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post("/api/admin/stock/:productId", express.json(), async (req, res) => {
  if (!checkAdminSecret(req, res)) return;
  try {
    const items = (req.body.items || []).filter(Boolean);
    if (!items.length) return res.status(400).json({ error: "No items" });
    const result = await prisma.stockItem.createMany({ data: items.map(content => ({ productId: req.params.productId, content })) });
    await autoEnableOnStock(req.params.productId);
    invalidateCategoryCache();
    res.json({ success: true, created: result.count });

    // Gửi thông báo nếu admin chọn notify
    if (req.body.notify) {
      const product = await prisma.product.findUnique({ where: { id: req.params.productId } });
      if (product) {
        const botUsername = botProfile?.username;
        const deepLink = botUsername ? `https://t.me/${botUsername}?start=product_${product.id}` : null;
        const users = await prisma.user.findMany({ where: { isBlocked: false }, select: { telegramId: true } });
        const msg = `🔔 <b>Hàng mới về!</b>\n\n📦 <b>${product.name}</b>\n${product.description ? `\n${product.description}\n` : ""}\nSố lượng mới nhập: <b>${result.count}</b>`;
        const replyMarkup = deepLink ? { inline_keyboard: [[{ text: "🛒 Mua hàng ngay", url: deepLink }]] } : undefined;
        for (const user of users) {
          try {
            await bot.telegram.sendMessage(user.telegramId, msg, { parse_mode: "HTML", ...(replyMarkup ? { reply_markup: replyMarkup } : {}) });
            await new Promise(r => setTimeout(r, 50));
          } catch {}
        }
      }
    }
  } catch(e) { res.status(400).json({ error: e.message }); }
});

app.delete("/api/admin/stock/:productId", async (req, res) => {
  if (!checkAdminSecret(req, res)) return;
  try {
    const result = await prisma.stockItem.deleteMany({
      where: { productId: req.params.productId, isSold: false },
    });
    invalidateCategoryCache();
    res.json({ success: true, deleted: result.count });
  } catch(e) { res.status(400).json({ error: e.message }); }
});

app.get("/api/admin/wallet/:telegramId", async (req, res) => {
  if (!checkAdminSecret(req, res)) return;
  try {
    const telegramId = String(req.params.telegramId || "").trim();
    if (!telegramId) return res.status(400).json({ error: "telegramId required" });

    const [user, wallet] = await Promise.all([
      prisma.user.findUnique({
        where: { telegramId },
        select: { telegramId: true, username: true, firstName: true, balance: true, vipLevel: true, isBlocked: true },
      }).catch(() => null),
      prisma.wallet.findUnique({ where: { odelegramId: telegramId } }).catch(() => null),
    ]);

    const transactions = wallet
      ? await prisma.walletTransaction.findMany({
          where: { walletId: wallet.id },
          orderBy: { createdAt: "desc" },
          take: 30,
        })
      : [];

    res.json({
      user,
      wallet: {
        telegramId,
        balance: wallet?.balance ?? user?.balance ?? 0,
        exists: Boolean(wallet),
      },
      transactions,
    });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post("/api/admin/wallet/adjust", express.json(), async (req, res) => {
  if (!checkAdminSecret(req, res)) return;
  try {
    const telegramId = String(req.body.telegramId || "").trim();
    const amount = Math.abs(Number(req.body.amount) || 0);
    const type = String(req.body.type || "ADD").toUpperCase();
    const reason = String(req.body.reason || "").trim();
    if (!telegramId) return res.status(400).json({ error: "telegramId required" });
    if (amount <= 0) return res.status(400).json({ error: "amount must be greater than 0" });

    const result = type === "DEDUCT"
      ? await adminDeductBalance(telegramId, amount, "WEB_ADMIN", reason)
      : await adminAddBalance(telegramId, amount, "WEB_ADMIN", reason);

    if (!result.success) return res.status(400).json({ error: result.error || "Wallet update failed" });

    await logAction("WEB_ADMIN", type === "DEDUCT" ? "WALLET_DEDUCT" : "WALLET_ADD", telegramId, { amount, reason });
    res.json({ success: true, ...result });
  } catch(e) { res.status(400).json({ error: e.message }); }
});

app.get("/api/admin/coupons", async (req, res) => {
  if (!checkAdminSecret(req, res)) return;
  try {
    const coupons = await prisma.coupon.findMany({ orderBy: { createdAt: "desc" } });
    res.json({ coupons });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post("/api/admin/coupons", express.json(), async (req, res) => {
  if (!checkAdminSecret(req, res)) return;
  try {
    const code = String(req.body.code || "").trim().toUpperCase();
    const discount = Number(req.body.discount) || 0;
    const discountType = String(req.body.discountType || "PERCENT").toUpperCase() === "FIXED" ? "FIXED" : "PERCENT";
    const expiresAt = req.body.expiresAt ? new Date(req.body.expiresAt) : null;
    if (!code) return res.status(400).json({ error: "code required" });
    if (discount <= 0) return res.status(400).json({ error: "discount must be greater than 0" });
    if (expiresAt && Number.isNaN(expiresAt.getTime())) return res.status(400).json({ error: "expiresAt invalid" });

    const coupon = await prisma.coupon.create({
      data: {
        code,
        discount,
        discountType,
        maxUses: req.body.maxUses === "" || req.body.maxUses === null || req.body.maxUses === undefined ? null : Number(req.body.maxUses) || null,
        minOrder: req.body.minOrder === "" || req.body.minOrder === null || req.body.minOrder === undefined ? null : Number(req.body.minOrder) || null,
        maxDiscount: req.body.maxDiscount === "" || req.body.maxDiscount === null || req.body.maxDiscount === undefined ? null : Number(req.body.maxDiscount) || null,
        vipOnly: Number(req.body.vipOnly) || 0,
        expiresAt,
        isActive: true,
      },
    });

    await logAction("WEB_ADMIN", "ADD_COUPON", code);
    res.json({ success: true, coupon });
  } catch(e) { res.status(400).json({ error: e.message }); }
});

app.put("/api/admin/coupons/:code/toggle", express.json(), async (req, res) => {
  if (!checkAdminSecret(req, res)) return;
  try {
    const code = String(req.params.code || "").toUpperCase();
    const coupon = await prisma.coupon.findUnique({ where: { code } });
    if (!coupon) return res.status(404).json({ error: "Coupon not found" });
    const updated = await prisma.coupon.update({ where: { code }, data: { isActive: !coupon.isActive } });
    await logAction("WEB_ADMIN", "TOGGLE_COUPON", code, { isActive: updated.isActive });
    res.json({ success: true, coupon: updated });
  } catch(e) { res.status(400).json({ error: e.message }); }
});

app.delete("/api/admin/coupons/:code", async (req, res) => {
  if (!checkAdminSecret(req, res)) return;
  try {
    const code = String(req.params.code || "").toUpperCase();
    await prisma.coupon.delete({ where: { code } });
    await logAction("WEB_ADMIN", "DELETE_COUPON", code);
    res.json({ success: true });
  } catch(e) { res.status(400).json({ error: e.message }); }
});

app.get("/api/admin/broadcasts", async (req, res) => {
  if (!checkAdminSecret(req, res)) return;
  try {
    const limit = Math.min(Number(req.query.limit) || 20, 100);
    const broadcasts = await getBroadcastHistory(limit);
    res.json({ broadcasts });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post("/api/admin/broadcasts", express.json(), async (req, res) => {
  if (!checkAdminSecret(req, res)) return;
  try {
    const message = String(req.body.message || "").trim();
    const target = String(req.body.target || "all").toLowerCase();
    const minVipLevel = Number(req.body.minVipLevel) || 1;
    if (!message) return res.status(400).json({ error: "message required" });

    const result = target === "vip"
      ? await sendVipBroadcast(bot, message, minVipLevel, "WEB_ADMIN")
      : await sendBroadcast(bot, message, "WEB_ADMIN");

    if (target === "vip") {
      await prisma.broadcast.create({
        data: {
          message: `[VIP ${minVipLevel}] ${message}`,
          sentCount: result.sentCount || 0,
          failCount: result.failCount || 0,
          status: "COMPLETED",
        },
      });
    }

    res.json({ success: true, ...result });
  } catch(e) { res.status(400).json({ error: e.message }); }
});

app.get("/api/admin/logs", async (req, res) => {
  if (!checkAdminSecret(req, res)) return;
  try {
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const logs = await getRecentLogs(limit);
    res.json({ logs });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get("/api/admin/export/:type", async (req, res) => {
  if (!checkAdminSecret(req, res)) return;
  try {
    const type = String(req.params.type || "").toLowerCase();
    const days = Math.max(1, Math.min(Number(req.query.days) || 30, 365));
    const exporters = {
      orders: () => exportOrdersCSV(),
      revenue: () => exportRevenueCSV(days),
      users: () => exportUsersCSV(),
      products: () => exportProductsCSV(),
    };
    const exporter = exporters[type];
    if (!exporter) return res.status(400).json({ error: "Unknown export type" });

    const result = await exporter();
    await logAction("WEB_ADMIN", "EXPORT", type, { filename: result.filename });
    res.download(result.filepath, result.filename);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get("/api/admin/backups", async (req, res) => {
  if (!checkAdminSecret(req, res)) return;
  try {
    const backups = await listBackups();
    res.json({ backups });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post("/api/admin/backups", express.json(), async (req, res) => {
  if (!checkAdminSecret(req, res)) return;
  try {
    const result = await createBackup(bot);
    if (!result.success) return res.status(500).json({ error: result.error || "Backup failed" });
    await logAction("WEB_ADMIN", "BACKUP", result.filename, { size: result.size });
    res.json(result);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.put("/api/admin/users/:telegramId", express.json(), async (req, res) => {
  if (!checkAdminSecret(req, res)) return;
  try {
    const telegramId = String(req.params.telegramId || "").trim();
    const data = {};
    if (req.body.vipLevel !== undefined) data.vipLevel = Math.max(0, Number(req.body.vipLevel) || 0);
    if (req.body.isBlocked !== undefined) data.isBlocked = req.body.isBlocked === true || req.body.isBlocked === "true";
    if (!Object.keys(data).length) return res.status(400).json({ error: "No fields to update" });

    const user = await prisma.user.update({ where: { telegramId }, data });
    await logAction("WEB_ADMIN", "UPDATE_USER", telegramId, data);
    res.json({ success: true, user });
  } catch(e) { res.status(400).json({ error: e.message }); }
});

app.get("/api/admin/users", async (req, res) => {
  if (!checkAdminSecret(req, res)) return;
  try {
    const limit = Math.min(Number(req.query.limit) || 20, 100);
    const skip = Number(req.query.skip) || 0;
    const search = (req.query.search || "").trim();
    const where = search ? {
      OR: [
        { telegramId: { contains: search } },
        { username: { contains: search, mode: "insensitive" } },
        { firstName: { contains: search, mode: "insensitive" } },
      ],
    } : {};
    const [users, total] = await Promise.all([
      prisma.user.findMany({ where, orderBy: { createdAt: "desc" }, take: limit, skip, include: { _count: { select: { orders: true } } } }),
      prisma.user.count({ where }),
    ]);
    const wallets = users.length
      ? await prisma.wallet.findMany({
          where: { odelegramId: { in: users.map((user) => user.telegramId) } },
          select: { odelegramId: true, balance: true },
        })
      : [];
    const walletByTelegramId = new Map(wallets.map((wallet) => [wallet.odelegramId, wallet]));
    res.json({
      users: users.map((user) => ({
        ...user,
        walletBalance: walletByTelegramId.get(user.telegramId)?.balance ?? user.balance ?? 0,
      })),
      total,
    });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Image upload endpoint
app.post("/api/admin/upload/image", (req, res, next) => {
  if (!checkAdminSecret(req, res)) return;
  next();
}, _upload.single("image"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No valid image file" });
  res.json({ success: true, url: `/uploads/products/${req.file.filename}` });
});

// Settings CRUD
app.get("/api/admin/settings", async (req, res) => {
  if (!checkAdminSecret(req, res)) return;
  try {
    const keys = ["SHOP_NAME", "SHOP_BANK_NAME", "SHOP_BANK_ACCOUNT", "SHOP_BANK_ACCOUNT_NAME", "SHOP_SUPPORT_USERNAME", "SHOP_BANNER_TEXT", "WELCOME_GREETING"];
    const rows = await prisma.setting.findMany({ where: { key: { in: keys } } });
    const settings = Object.fromEntries(keys.map(k => [k, ""]));
    rows.forEach(r => { settings[r.key] = r.value; });
    res.json({ settings });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.put("/api/admin/settings", express.json(), async (req, res) => {
  if (!checkAdminSecret(req, res)) return;
  try {
    const allowed = ["SHOP_NAME", "SHOP_BANK_NAME", "SHOP_BANK_ACCOUNT", "SHOP_BANK_ACCOUNT_NAME", "SHOP_SUPPORT_USERNAME", "SHOP_BANNER_TEXT", "WELCOME_GREETING"];
    const ops = Object.entries(req.body)
      .filter(([k]) => allowed.includes(k))
      .map(([k, v]) => prisma.setting.upsert({ where: { key: k }, update: { value: String(v) }, create: { key: k, value: String(v) } }));
    await Promise.all(ops);
    await logAction("WEB_ADMIN", "UPDATE_SETTINGS", "settings", req.body);
    res.json({ success: true });
  } catch(e) { res.status(400).json({ error: e.message }); }
});

// VIP Levels CRUD
app.get("/api/admin/vip-levels", async (req, res) => {
  if (!checkAdminSecret(req, res)) return;
  try {
    const levels = await prisma.vipLevel.findMany({ orderBy: { level: "asc" } });
    res.json({ levels });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.put("/api/admin/vip-levels/:level", express.json(), async (req, res) => {
  if (!checkAdminSecret(req, res)) return;
  try {
    const level = Number(req.params.level);
    const { name, minSpent, discountPercent, referralBonus, benefits } = req.body;
    const data = {};
    if (name !== undefined) data.name = name;
    if (minSpent !== undefined) data.minSpent = Number(minSpent) || 0;
    if (discountPercent !== undefined) data.discountPercent = Number(discountPercent) || 0;
    if (referralBonus !== undefined) data.referralBonus = Number(referralBonus) || 0;
    if (benefits !== undefined) data.benefits = String(benefits);
    const vip = await prisma.vipLevel.update({ where: { level }, data });
    await logAction("WEB_ADMIN", "UPDATE_VIP", String(level), data);
    res.json({ success: true, vip });
  } catch(e) { res.status(400).json({ error: e.message }); }
});

// Referrals (read-only)
app.get("/api/admin/referrals", async (req, res) => {
  if (!checkAdminSecret(req, res)) return;
  try {
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const skip = Number(req.query.skip) || 0;
    const referrals = await prisma.referral.findMany({ orderBy: { createdAt: "desc" }, take: limit, skip });
    const total = await prisma.referral.count();
    const uids = [...new Set([...referrals.map(r => r.referrerId), ...referrals.map(r => r.refereeId)])];
    const users = uids.length ? await prisma.user.findMany({ where: { id: { in: uids } }, select: { id: true, telegramId: true, username: true, firstName: true } }) : [];
    const userById = new Map(users.map(u => [u.id, u]));
    res.json({ referrals: referrals.map(r => ({ ...r, referrer: userById.get(r.referrerId), referee: userById.get(r.refereeId) })), total });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Stock items detail (list individual items, delete single)
app.get("/api/admin/stock/:productId/items", async (req, res) => {
  if (!checkAdminSecret(req, res)) return;
  try {
    const sold = req.query.sold === "true" ? true : req.query.sold === "false" ? false : undefined;
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const skip = Number(req.query.skip) || 0;
    const where = { productId: req.params.productId };
    if (sold !== undefined) where.isSold = sold;
    const [items, total] = await Promise.all([
      prisma.stockItem.findMany({ where, orderBy: { createdAt: "desc" }, take: limit, skip }),
      prisma.stockItem.count({ where }),
    ]);
    res.json({ items, total });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.delete("/api/admin/stock/:productId/items/:itemId", async (req, res) => {
  if (!checkAdminSecret(req, res)) return;
  try {
    const item = await prisma.stockItem.findUnique({ where: { id: req.params.itemId } });
    if (!item || item.productId !== req.params.productId) return res.status(404).json({ error: "Item not found" });
    if (item.isSold) return res.status(400).json({ error: "Cannot delete sold item" });
    await prisma.stockItem.delete({ where: { id: req.params.itemId } });
    invalidateCategoryCache();
    res.json({ success: true });
  } catch(e) { res.status(400).json({ error: e.message }); }
});

// Public coupon validate (for web shop)
app.get("/api/shop/coupon/:code", async (req, res) => {
  try {
    const code = String(req.params.code || "").trim().toUpperCase();
    const amount = Number(req.query.amount) || 0;
    const telegramId = req.query.telegramId ? String(req.query.telegramId) : null;
    if (!code) return res.status(400).json({ error: "code required" });
    const coupon = await prisma.coupon.findUnique({ where: { code } });
    if (!coupon || !coupon.isActive) return res.status(404).json({ error: "Mã không tồn tại hoặc đã hết hạn" });
    if (coupon.expiresAt && new Date() > coupon.expiresAt) return res.status(400).json({ error: "Mã đã hết hạn" });
    if (coupon.maxUses && coupon.usedCount >= coupon.maxUses) return res.status(400).json({ error: "Mã đã dùng hết lượt" });
    if (coupon.minOrder && amount < coupon.minOrder) return res.status(400).json({ error: `Đơn tối thiểu ${coupon.minOrder.toLocaleString()}đ` });
    // VIP-only coupon check
    if (coupon.vipOnly) {
      if (!telegramId) return res.status(403).json({ error: "Mã này chỉ dành cho thành viên VIP" });
      const user = await prisma.user.findUnique({ where: { telegramId }, select: { vipLevel: true } });
      if (!user || user.vipLevel < 1) return res.status(403).json({ error: "Mã này chỉ dành cho thành viên VIP" });
    }
    let discount = coupon.discountType === "FIXED" ? coupon.discount : Math.floor(amount * coupon.discount / 100);
    if (coupon.maxDiscount && discount > coupon.maxDiscount) discount = coupon.maxDiscount;
    res.json({ valid: true, code, discountType: coupon.discountType, discountValue: coupon.discount, discountAmount: discount, maxDiscount: coupon.maxDiscount });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Serve admin panel
app.get("/admin", (_req, res) => {
  res.sendFile(path.join(publicDir, "admin", "index.html"));
});

app.use("/admin", express.static(path.join(publicDir, "admin"), {
  maxAge: process.env.NODE_ENV === "production" ? "1h" : 0,
}));

// Start the server
start();
