import "dotenv/config";
import express from "express";
import bodyParser from "body-parser";
import prisma from "./lib/prisma.js";
import { waitForDB, startKeepAlive } from "./lib/db.js";
import { createBot } from "./bot.js";
import { registerAdminCommands } from "./admin.js";
import { deliverOrder } from "./delivery.js";
import { scheduleBackups } from "./backup.js";
import { checkAllStock } from "./inventory.js";
import { initVipLevels } from "./vip.js";
import { cleanOldExports } from "./export.js";
import { verifyIPNWebhook, parseIPNData, isOrderExpired } from "./payment/vietqr.js";
import { parseDepositContent, findPendingDeposit, confirmDeposit } from "./wallet.js";

// Initialize bot
const bot = createBot({});

// Register admin commands
registerAdminCommands(bot);

// Initialize Express server
const app = express();

// Health check
app.get("/health", (req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
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

    // Parse IPN data
    const { amount, content, transactionId } = parseIPNData(req.body, provider);

    if (!amount || !content) {
      console.log("❌ Missing amount or content in IPN");
      return res.json({ success: false, message: "Missing data" });
    }

    console.log(`💰 IPN: ${amount}đ | Content: ${content} | TID: ${transactionId}`);

    const upperContent = (content || "").toUpperCase().replace(/\s+/g, "");

    // === CHECK FOR WALLET DEPOSIT (NAP format) ===
    const depositInfo = parseDepositContent(upperContent);
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

    // Deliver order
    const updatedOrder = await prisma.order.findUnique({ where: { id: matchedOrder.id } });
    await deliverOrder({ prisma, bot, order: updatedOrder });

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

      // Launch bot
      await bot.launch();
      console.log("🤖 Bot launched successfully!");

      // Set up command menu for all users (priority order)
      // First delete old commands to force refresh
      try {
        await bot.telegram.deleteMyCommands();
      } catch (e) { }

      await bot.telegram.setMyCommands([
        { command: "menu", description: "🏪 Mua hàng" },
        { command: "wallet", description: "💰 Nạp tiền" },
        { command: "me", description: "👤 Tài khoản" },
        { command: "order", description: "📦 Tra cứu đơn" },
        { command: "help", description: "❓ Trợ giúp" },
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
              { command: "menu", description: "🏪 Mua hàng" },
              { command: "admin", description: "🔧 Admin Panel" },
              { command: "wallet", description: "💰 Nạp tiền" },
              { command: "me", description: "👤 Tài khoản" },
              { command: "order", description: "📦 Tra cứu đơn" },
              { command: "help", description: "❓ Trợ giúp" },
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
      console.log("⏰ Order expiration check started");
    });

    // Graceful shutdown
    process.once("SIGINT", () => {
      console.log("Shutting down...");
      bot.stop("SIGINT");
    });

    process.once("SIGTERM", () => {
      console.log("Shutting down...");
      bot.stop("SIGTERM");
    });

  } catch (e) {
    console.error("❌ Start error:", e.message);
    console.log("🔄 Retrying in 5 seconds...");
    setTimeout(start, 5000);
  }
}

// Start the server
start();
