import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import morgan from 'morgan';
import { PrismaClient } from '@prisma/client';
import { Telegraf } from 'telegraf';
import dotenv from 'dotenv';
import { setupBotHandlers } from './bot/BotSetup.js';
import { setupShopHandlers } from './bot/ShopSetup.js';
import { setupPaymentHandlers } from './bot/PaymentSetup.js';
import { setupOrderHandlers } from './bot/OrderSetup.js';
import { setupAdminHandlers } from './bot/AdminSetup.js';
import { startOrderExpiryJob } from './jobs/OrderExpiryJob.js';

dotenv.config();

const app = express();
const prisma = new PrismaClient();
const port = process.env.PORT || 3000;

// Setup Middleware
app.use(cors());
app.use(helmet());
app.use(morgan('dev'));
app.use(express.json());

// Initialize Telegram Bot
const botToken = process.env.BOT_TOKEN;
if (!botToken) {
  console.error('Lỗi: Chưa cấu hình BOT_TOKEN trong file .env');
  process.exit(1);
}
const bot = new Telegraf(botToken);

app.get('/health', (req, res) => {
  res.json({ status: 'OK', message: 'Telegram Shop Bot API is running.' });
});

async function startServer() {
  try {
    // Test DB connection
    await prisma.$connect();
    console.log('✅ Đã kết nối cơ sở dữ liệu Prisma.');

    // Start background jobs
    startOrderExpiryJob();

    // Express server
    app.listen(port, () => {
      console.log(`✅ Server running on port ${port}`);
    });

    // Telegram Bot handlers
    setupBotHandlers(bot);
    setupShopHandlers(bot);
    setupPaymentHandlers(bot);
    setupOrderHandlers(bot);
    setupAdminHandlers(bot);
    
    // Launch bot
    if (process.env.NODE_ENV === 'production') {
      // In production use webhooks securely
      // bot.launch({ webhook: ... })
      bot.launch();
    } else {
      bot.launch();
      console.log('✅ Telegram bot started in long-polling mode');
    }

  } catch (error) {
    console.error('❌ Error during bootstrap:', error);
    process.exit(1);
  }
}

startServer();

// Enable graceful stop
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
