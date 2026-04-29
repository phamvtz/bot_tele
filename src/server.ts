// ⚠️ PHẢI là import đầu tiên — load .env trước khi bất kỳ module nào khởi tạo
import 'dotenv/config';

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
import { startLowStockAlertJob } from './jobs/LowStockAlertJob.js';
import { startMBBankPollerJob }  from './jobs/MBBankPollerJob.js';
import webhookRouter from './api/webhookRouter.js';
import { ProductService } from './modules/product/ProductService.js';

const log = createLogger('Server');
const app  = express();
const port = process.env.PORT ?? '3000';

// ── Express Middleware ─────────────────────────────────────────────────────────

app.use(helmet());
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

    // 5. Mount webhook routes
    app.use('/webhook', webhookRouter);

    // 6. Start background jobs
    startOrderExpiryJob();
    startLowStockAlertJob();
    startMBBankPollerJob();

    // 7. Start Express server
    const server = app.listen(Number(port), () => {
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

    // 8. Launch Telegram Bot
    // Dùng webhook nếu có BASE_URL (cả dev lẫn production)
    if (process.env.BASE_URL) {
      const secretPath = `/telegraf/${botToken}`;
      const webhookUrl = `${process.env.BASE_URL}${secretPath}`;

      await bot.telegram.setWebhook(webhookUrl, {
        secret_token: process.env.WEBHOOK_SECRET ?? undefined,
        max_connections: 100,
        drop_pending_updates: true,   // bỏ updates cũ khi restart
      });
      app.use(bot.webhookCallback(secretPath));
      log.info(`Bot running in WEBHOOK mode: ${webhookUrl} ✅`);
      log.info('⚡ Độ trễ rất thấp — Telegram push thẳng về server');
    } else {
      // Delete any existing webhook before using long-polling
      await bot.telegram.deleteWebhook({ drop_pending_updates: true });
      bot.launch({ dropPendingUpdates: true });
      log.info('Bot running in long-polling mode ✅');
      log.warn('⚠️  Đang dùng long-polling — độ trễ cao hơn webhook');
      log.warn('   → Set BASE_URL trong .env để dùng webhook (dùng Cloudflare Tunnel)');
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
