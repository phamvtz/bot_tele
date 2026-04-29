import { MiddlewareFn } from 'telegraf';
import { BotContext } from '../context.js';
import prisma from '../../infrastructure/db.js';
import { createLogger } from '../../infrastructure/logger.js';

const log = createLogger('AdminMiddleware');

/**
 * Admin Guard Middleware
 *
 * Xác thực quyền admin qua 2 cơ chế:
 * 1. ADMIN_IDS trong .env (nhanh, không cần DB) — dùng cho super-admin
 * 2. Admin.telegramId trong database — dùng cho admin đã cấp phép
 *
 * Nếu không phải admin → từ chối và không chuyển tiếp.
 */
export const adminMiddleware: MiddlewareFn<BotContext> = async (ctx, next) => {
  const telegramId = ctx.from?.id?.toString();
  if (!telegramId) return;

  const isAdmin = await checkIsAdmin(telegramId);

  if (!isAdmin) {
    log.warn({ telegramId }, 'Unauthorized admin access attempt');
    if (ctx.callbackQuery) {
      await ctx.answerCbQuery('⛔ Bạn không có quyền thực hiện thao tác này.', { show_alert: true });
    } else {
      await ctx.reply('⛔ Lệnh này chỉ dành cho Admin.');
    }
    return; // Dừng middleware chain
  }

  return next();
};

async function checkIsAdmin(telegramId: string): Promise<boolean> {
  // 1. Check ADMIN_IDS env (comma-separated)
  const envAdminIds = (process.env.ADMIN_IDS ?? '')
    .split(',')
    .map(id => id.trim())
    .filter(Boolean);

  if (envAdminIds.includes(telegramId)) return true;

  // 2. Check Admin.telegramId in DB
  try {
    const admin = await prisma.admin.findFirst({
      where: { telegramId, status: 'ACTIVE' },
      select: { id: true }
    });
    return !!admin;
  } catch (err) {
    log.error({ err }, 'AdminMiddleware: DB check failed');
    return false;
  }
}
