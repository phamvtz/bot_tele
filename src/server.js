import "dotenv/config";
import express from "express";
import bodyParser from "body-parser";
import path from "path";
import prisma from "./lib/prisma.js";
import { waitForDB, startKeepAlive } from "./lib/db.js";
import { createBot } from "./bot.js";
import { registerAdminCommands } from "./admin.js";
import { deliverOrder } from "./delivery.js";
import { scheduleBackups } from "./backup.js";
import { checkAllStock } from "./inventory.js";
import { initVipLevels } from "./vip.js";
import { cleanOldExports } from "./export.js";
import { verifyIPNWebhook, parseIPNItems, parseIPNData, isOrderExpired } from "./payment/vietqr.js";
import { parseDepositContent, findPendingDeposit, confirmDeposit } from "./wallet.js";
import { sendLog } from "./lib/logger.js";
import { startBankPolling } from "./bank-poller.js";

// Initialize bot
const bot = createBot({});
let botProfile = null;
let bankPolling = null;

// Register admin commands
registerAdminCommands(bot);

// Initialize Express server
const app = express();
const publicDir = path.join(process.cwd(), "public");

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
app.get("/api/shop/catalog", async (_req, res) => {
  try {
    const [categories, products, iconOverridesSetting] = await Promise.all([
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
    ]);

    const iconOverrides = iconOverridesSetting ? JSON.parse(iconOverridesSetting.value) : {};

    const stockProductIds = products
      .filter((product) => product.deliveryMode === "STOCK_LINES")
      .map((product) => product.id);

    const stockCounts = stockProductIds.length
      ? await prisma.stockItem.groupBy({
        by: ["productId"],
        where: {
          productId: { in: stockProductIds },
          isSold: false,
        },
        _count: { _all: true },
      })
      : [];

    const stockByProductId = new Map(
      stockCounts.map((item) => [item.productId, item._count._all])
    );

    res.json({
      shop: {
        name: process.env.SHOP_NAME || "Shop Bot Tele",
        currency: "VND",
        supportUsername: process.env.ADMIN_TELEGRAM || null,
        botUsername: process.env.TELEGRAM_BOT_USERNAME || botProfile?.username || null,
        bank: {
          name: process.env.BANK_NAME || process.env.DEFAULT_BANK_NAME || "MB Bank",
          account: process.env.BANK_ACCOUNT || process.env.DEFAULT_BANK_ACCOUNT || "",
          owner: process.env.BANK_ACCOUNT_NAME || process.env.DEFAULT_BANK_OWNER || "",
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
          price: product.price,
          vipPrice: product.vipPrice,
          currency: product.currency || "VND",
          deliveryMode: product.deliveryMode,
          categoryId: product.categoryId,
          categoryName: product.category?.name || "Khác",
          categoryIcon: product.category?.icon || "",
          iconSlug: iconOverrides[product.id] || null,
          stockCount,
          inStock: product.deliveryMode === "STOCK_LINES" ? stockCount > 0 : true,
          createdAt: product.createdAt,
        };
      }),
    });
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
      await prisma.product.create({
        data: {
          code: prod.code,
          name: prod.name,
          price: prod.price,
          deliveryMode: 'TEXT',
          payload: 'Liên hệ Admin @vanggohh',
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
          if (upperContent.includes(`SHOP${shortId}`) || upperContent.includes(shortId)) {
            if (Math.abs(amount - order.finalAmount) <= 1000) {
              await prisma.order.update({
                where: { id: order.id },
                data: {
                  status: "PAID",
                  paymentRef: transactionId || order.paymentRef,
                },
              });

              sendLog("ORDER", `✅ *ĐƠN HÀNG ĐÃ THANH TOÁN*\n📦 Order ID: \`${order.id}\`\n💰 Số tiền: ${order.finalAmount.toLocaleString()}đ`);
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

      // Match by content (payment reference)
      const shortId = order.id.slice(-8).toUpperCase();

      if (upperContent.includes(`SHOP${shortId}`) || upperContent.includes(shortId)) {
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

    // Start HTTP server
    app.listen(PORT, async () => {
      console.log(`🚀 Server running on port ${PORT}`);
      console.log(`📡 IPN Webhook: /webhook/ipn`);

      // Verify token first, then launch bot without blocking startup
      const me = await bot.telegram.getMe();
      botProfile = me;
      bot.launch().catch(err => console.error("❌ Bot launch failed:", err));
      console.log(`🤖 Bot launched successfully! @${me.username || me.first_name || me.id}`);
      sendLog("SYSTEM", `🤖 Bot launched successfully! @${me.username || me.first_name || me.id}`);

      // Set up command menu for all users (priority order)
      // First delete old commands to force refresh
      try {
        await bot.telegram.deleteMyCommands();
      } catch (e) { }

      await bot.telegram.setMyCommands([
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
      bankPolling = startBankPolling({ telegram: bot.telegram });
      console.log("⏰ Order expiration check started");
    });

    // Graceful shutdown
    process.once("SIGINT", () => {
      console.log("Shutting down...");
      bankPolling?.stop?.();
      bot.stop("SIGINT");
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

app.get("/api/admin/orders", async (req, res) => {
  if (!checkAdminSecret(req, res)) return;
  try {
    const limit = Math.min(Number(req.query.limit) || 20, 100);
    const skip = Number(req.query.skip) || 0;
    const status = req.query.status || undefined;
    const [orders, total] = await Promise.all([
      prisma.order.findMany({
        where: status ? { status } : {},
        orderBy: { createdAt: "desc" }, take: limit, skip,
        include: { product: { select: { name: true } }, user: { select: { username: true, firstName: true } } },
      }),
      prisma.order.count({ where: status ? { status } : {} }),
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
    res.json({ products });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post("/api/admin/products", express.json(), async (req, res) => {
  if (!checkAdminSecret(req, res)) return;
  try {
    const { name, code, price, deliveryMode, payload, categoryId, description } = req.body;
    const product = await prisma.product.create({
      data: { name, code, price: Number(price) || 0, deliveryMode: deliveryMode || "TEXT", payload: payload || "", categoryId: categoryId || null, description: description || "", currency: "VND", isActive: true },
    });
    res.json({ success: true, product });
  } catch(e) { res.status(400).json({ error: e.message }); }
});

app.put("/api/admin/products/:id", express.json(), async (req, res) => {
  if (!checkAdminSecret(req, res)) return;
  try {
    const { name, price, deliveryMode, payload, categoryId, description, isActive } = req.body;
    const product = await prisma.product.update({
      where: { id: req.params.id },
      data: { name, price: Number(price) || 0, deliveryMode, payload, categoryId: categoryId || null, description, isActive },
    });
    res.json({ success: true, product });
  } catch(e) { res.status(400).json({ error: e.message }); }
});

app.delete("/api/admin/products/:id", async (req, res) => {
  if (!checkAdminSecret(req, res)) return;
  try {
    await prisma.product.update({ where: { id: req.params.id }, data: { isActive: false } });
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
    res.json({ success: true, category });
  } catch(e) { res.status(400).json({ error: e.message }); }
});

app.delete("/api/admin/categories/:id", async (req, res) => {
  if (!checkAdminSecret(req, res)) return;
  try {
    await prisma.category.update({ where: { id: req.params.id }, data: { isActive: false } });
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
    res.json({ success: true, created: result.count });
  } catch(e) { res.status(400).json({ error: e.message }); }
});

app.get("/api/admin/users", async (req, res) => {
  if (!checkAdminSecret(req, res)) return;
  try {
    const limit = Math.min(Number(req.query.limit) || 20, 100);
    const skip = Number(req.query.skip) || 0;
    const [users, total] = await Promise.all([
      prisma.user.findMany({ orderBy: { createdAt: "desc" }, take: limit, skip, include: { _count: { select: { orders: true } } } }),
      prisma.user.count(),
    ]);
    res.json({ users, total });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Serve admin panel
app.get("/admin", (_req, res) => {
  res.sendFile(path.join(publicDir, "admin", "index.html"));
});

// Start the server
start();
