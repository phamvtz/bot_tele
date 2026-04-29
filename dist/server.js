// ⚠️ PHẢI là import đầu tiên — load .env trước khi bất kỳ module nào khởi tạo
import 'dotenv/config';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import morgan from 'morgan';
import prisma from './infrastructure/db.js';
import logger, { createLogger } from './infrastructure/logger.js';
import { createBotApp } from './bot/BotApp.js';
import { NotificationService } from './modules/notification/NotificationService.js';
import { startOrderExpiryJob } from './jobs/OrderExpiryJob.js';
import { startLowStockAlertJob } from './jobs/LowStockAlertJob.js';
import { startMBBankPollerJob } from './jobs/MBBankPollerJob.js';
import webhookRouter from './api/webhookRouter.js';
const log = createLogger('Server');
const app = express();
const port = process.env.PORT ?? '3000';
// ── Express Middleware ─────────────────────────────────────────────────────────
app.use(helmet());
app.use(cors());
app.use(express.json());
app.use(morgan('combined', {
    stream: { write: (msg) => logger.info(msg.trim()) }
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
// ── Bootstrap ─────────────────────────────────────────────────────────────────
async function bootstrap() {
    try {
        // 1. Test DB connection
        await prisma.$connect();
        log.info('PostgreSQL (Supabase) connected ✅');
        // 2. Create bot
        const bot = createBotApp(botToken);
        // 3. Init NotificationService with bot reference
        NotificationService.init(bot);
        // 4. Mount webhook routes
        app.use('/webhook', webhookRouter);
        // 5. Start background jobs
        startOrderExpiryJob();
        startLowStockAlertJob();
        startMBBankPollerJob();
        // 6. Start Express server
        app.listen(port, () => {
            log.info(`Server listening on port ${port} ✅`);
        });
        // 7. Launch Telegram Bot
        if (process.env.NODE_ENV === 'production' && process.env.BASE_URL) {
            const secretPath = `/telegraf/${botToken}`;
            const webhookUrl = `${process.env.BASE_URL}${secretPath}`;
            await bot.telegram.setWebhook(webhookUrl);
            app.use(bot.webhookCallback(secretPath));
            log.info(`Bot running in webhook mode: ${webhookUrl} ✅`);
        }
        else {
            // Delete any existing webhook before using long-polling
            await bot.telegram.deleteWebhook();
            bot.launch();
            log.info('Bot running in long-polling mode ✅');
        }
        // 8. Graceful shutdown
        process.once('SIGINT', () => { bot.stop('SIGINT'); log.info('Bot stopped (SIGINT)'); });
        process.once('SIGTERM', () => { bot.stop('SIGTERM'); log.info('Bot stopped (SIGTERM)'); });
        log.info('🚀 Telegram Shop Bot v2.0 started successfully!');
    }
    catch (err) {
        log.error({ err }, 'Bootstrap failed');
        process.exit(1);
    }
}
bootstrap();
