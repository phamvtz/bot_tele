// ⚠️ PHẢI là import đầu tiên — load .env trước khi bất kỳ module nào khởi tạo
import './load-env.js';
import fs from 'fs';
import http from 'http';
import https from 'https';

import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import morgan from 'morgan';
import prisma from './infrastructure/db.js';
import { startDbHeartbeat } from './infrastructure/db.js';
import logger, { createLogger } from './infrastructure/logger.js';
import { createBotApp } from './bot/BotApp.js';
import { NotificationService } from './modules/notification/NotificationService.js';
import { startOrderExpiryJob } from './jobs/OrderExpiryJob.js';
import { startPaymentRequestExpiryJob } from './jobs/PaymentRequestExpiryJob.js';
import { startLowStockAlertJob } from './jobs/LowStockAlertJob.js';
import { startMBBankPollerJob }  from './jobs/MBBankPollerJob.js';
import webhookRouter from './api/webhookRouter.js';
import adminRouter from './api/adminRouter.js';
import { ProductService } from './modules/product/ProductService.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const log = createLogger('Server');
const app  = express();
const port = process.env.PORT ?? '3000';

// ── Express Middleware ─────────────────────────────────────────────────────────

app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors());
app.use(express.json());
app.use(morgan('combined', {
  stream: { write: (msg: string) => logger.info(msg.trim()) }
}));

// ── Health Check ──────────────────────────────────────────────────────────────

app.get('/health', (_req, res) => {
  res.json({
    status: 'OK',
    version: '2.0.0',
    timestamp: new Date().toISOString(),
  });
});

// ── Bot Token Validation ──────────────────────────────────────────────────────

const botToken = process.env.BOT_TOKEN;
if (!botToken) {
  log.error('BOT_TOKEN is not set in .env — exiting');
  process.exit(1);
}

// ── Cache Warmup — load dữ liệu phổ biến vào RAM ngay khi start ──────────────

async function warmupCache() {
  try {
    await Promise.all([
      ProductService.listActiveCategories(),
      ProductService.listFeaturedProducts(),
      ProductService.listUncategorizedProducts(),
    ]);
    log.info('Cache warmed up ✅');
  } catch (err) {
    log.warn({ err }, 'Cache warmup failed (non-fatal)');
  }
}

// ── Bootstrap ─────────────────────────────────────────────────────────────────

async function bootstrap() {
  try {
    // 1. Test DB connection
    await prisma.$connect();
    startDbHeartbeat();
    log.info('MongoDB Atlas connected ✅');

    // 2. Pre-warm cache — để request đầu tiên của user cũng nhanh
    await warmupCache();

    // 3. Create bot
    const bot = createBotApp(botToken!);

    // 4. Init NotificationService with bot reference
    NotificationService.init(bot);

    // 4b. Lắng nghe ORDER_COMPLETED → push key cho user (nếu chưa được gửi trong scene)
    const { BOT_EVENTS } = await import('./infrastructure/events.js');
    const { default: eventBus } = await import('./infrastructure/events.js');
    const { OrderService } = await import('./modules/order/OrderService.js');

    eventBus.on(BOT_EVENTS.ORDER_COMPLETED, async (payload: any) => {
      try {
        const { order, telegramId } = payload;
        // Chỉ push thêm nếu là AUTO_DELIVERY (MANUAL_DELIVERY đã có flow riêng)
        const deliveredItems = await OrderService.getOrderWithDeliveredItems(order.id);
        if (!deliveredItems.length) return; // không có gì để push

        // Compose summary message với keys
        let msg = `✅ <b>ĐƠN HÀNG ${order.orderCode} ĐÃ HOÀN TẤT!</b>\n`;
        msg += `━━━━━━━━━━━━━━━━━━━━\n`;
        msg += `🔑 <b>DỮ LIỆU SẢN PHẨM CỦA BẠN:</b>\n\n`;
        for (const item of deliveredItems) {
          msg += `📦 <b>${item.orderItem.productNameSnapshot}</b>\n`;
          msg += `<pre>${item.deliveredContent}</pre>\n\n`;
        }
        msg += `⚠️ <i>Hãy lưu lại thông tin trên!</i>\n`;
        msg += `<i>Xem lại trong mục 📦 Đơn hàng → Chi tiết</i>`;

        await NotificationService.sendToUser(telegramId, msg, { parse_mode: 'HTML' });
        log.info({ orderId: order.id, telegramId }, 'Order completion notification sent');
      } catch (err) {
        log.error({ err }, 'ORDER_COMPLETED notification failed — non-fatal');
      }
    });

    // 5. Mount webhook routes
    app.use('/webhook', webhookRouter);

    // 5b. Admin REST API
    app.use('/api/admin', adminRouter);

    // 5c. Serve static admin panel
    const adminDir = path.join(__dirname, '..', 'public', 'admin');
    const adminCsp = [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline'",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com",
      "connect-src 'self'",
      "img-src 'self' data:",
    ].join('; ');
    const setAdminCsp = (_req: any, res: any, next: any) => {
      res.setHeader('Content-Security-Policy', adminCsp);
      next();
    };
    app.use('/admin', setAdminCsp, express.static(adminDir));
    app.get('/admin*', setAdminCsp, (_req, res) => res.sendFile(path.join(adminDir, 'index.html')));

    // 6. Start background jobs
    startOrderExpiryJob();
    startPaymentRequestExpiryJob();
    startLowStockAlertJob();
    startMBBankPollerJob();

    // 7. Start HTTP server (admin API + optional webhook HTTP)
    const server = http.createServer(app);
    server.listen(Number(port), () => {
      log.info(`Server listening on port ${port} ✅`);
    });

    server.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        log.error(`Port ${port} đang bị chiếm bởi tiến trình khác. Tắt process đó rồi thử lại.`);
      } else {
        log.error({ err }, 'Server error');
      }
      process.exit(1);
    });

    // HTTPS server (VPS Windows — port 8443 như bot cũ)
    const httpsPort = process.env.HTTPS_PORT ?? process.env.WEBHOOK_HTTPS_PORT;
    const sslKeyPath = process.env.SSL_KEY_PATH;
    const sslCertPath = process.env.WEBHOOK_CERT_PATH ?? process.env.SSL_CERT_PATH;
    let httpsServer: https.Server | null = null;

    if (httpsPort && sslKeyPath && sslCertPath && fs.existsSync(sslKeyPath) && fs.existsSync(sslCertPath)) {
      httpsServer = https.createServer(
        { key: fs.readFileSync(sslKeyPath), cert: fs.readFileSync(sslCertPath) },
        app,
      );
      httpsServer.listen(Number(httpsPort), () => {
        log.info(`HTTPS server listening on port ${httpsPort} ✅`);
      });
    } else if (httpsPort) {
      log.warn({ httpsPort, sslKeyPath, sslCertPath }, 'HTTPS_PORT set but SSL cert/key not found — skipping HTTPS');
    }

    // 8. Launch Telegram Bot
    // Dùng webhook nếu có BASE_URL (cả dev lẫn production)
    if (process.env.BASE_URL) {
      // Legacy VPS: /bot{TOKEN} — mặc định mới: /telegraf/{TOKEN}
      const webhookPath = process.env.WEBHOOK_PATH ?? `/telegraf/${botToken}`;
      const webhookUrl = `${process.env.BASE_URL.replace(/\/$/, '')}${webhookPath}`;

      // Upload cert lên Telegram nếu self-signed (Windows VPS)
      const certPath = sslCertPath ?? '/etc/nginx/ssl/cert.pem';
      const certificate = certPath && fs.existsSync(certPath)
        ? { filename: 'cert.pem', source: fs.readFileSync(certPath) }
        : undefined;

      await bot.telegram.setWebhook(webhookUrl, {
        ...(certificate && { certificate }),
        secret_token: process.env.WEBHOOK_SECRET ?? undefined,
        max_connections: 40,
        drop_pending_updates: true,
      });
      app.use(bot.webhookCallback(webhookPath));
      log.info(`Bot running in WEBHOOK mode: ${webhookUrl} ✅`);
      log.info('⚡ Độ trễ rất thấp — Telegram push thẳng về server');
    } else {
      // Delete any existing webhook before using long-polling
      await bot.telegram.deleteWebhook({ drop_pending_updates: true });
      try {
        await bot.launch({ dropPendingUpdates: true });
        log.info('Bot running in long-polling mode ✅');
        log.warn('⚠️  Đang dùng long-polling — độ trễ cao hơn webhook');
        log.warn('   → Set BASE_URL trong .env để dùng webhook (dùng Cloudflare Tunnel)');
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes('409')) {
          log.error(
            'Bot launch failed: 409 Conflict — BOT_TOKEN đang được process khác dùng (long-polling). '
            + 'Chỉ được 1 instance/polling. Kiểm tra net/net2/netflix-bot hoặc set BASE_URL để dùng webhook.',
          );
        } else {
          log.error({ err }, 'Bot launch failed');
        }
        process.exit(1);
      }
    }

    // 9. Cấu hình Menu đồng bộ cho Điện thoại và PC
    await bot.telegram.setMyCommands([
      { command: 'menu', description: 'Mở Menu chính' },
      { command: 'products', description: 'Danh sách Sản Phẩm' },
      { command: 'topup', description: 'Nạp tiền vào ví' },
      { command: 'orders', description: 'Đơn hàng của bạn' },
      { command: 'me', description: 'Tài khoản cá nhân' },
      { command: 'support', description: 'Liên hệ Hỗ trợ' },
    ]);
    log.info('Bot Commands synchronized ✅');

    // 10. Graceful shutdown
    const shutdown = (signal: string) => {
      log.info(`Bot stopped (${signal})`);
      bot.stop(signal);
      server.close(() => process.exit(0));
      httpsServer?.close();
      setTimeout(() => process.exit(0), 3000);
    };
    process.once('SIGINT',  () => shutdown('SIGINT'));
    process.once('SIGTERM', () => shutdown('SIGTERM'));

    log.info('🚀 Telegram Shop Bot v2.0 started successfully!');

  } catch (err) {
    log.error({ err }, 'Bootstrap failed');
    process.exit(1);
  }
}

bootstrap();
