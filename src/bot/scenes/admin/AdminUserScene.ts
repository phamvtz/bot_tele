import { Scenes } from 'telegraf';
import { BotContext, SCENES } from '../../context.js';
import { Keyboards } from '../../ui/keyboards.js';
import { AdminService } from '../../../modules/admin/AdminService.js';
import prisma from '../../../infrastructure/db.js';

export const adminUserScene = new Scenes.BaseScene<BotContext>(SCENES.ADMIN_USER);

// ── Enter: Tìm kiếm user ─────────────────────────────────────────────────────

adminUserScene.enter(async (ctx) => {
  const text = `👥 <b>QUẢN LÝ USERS</b>\n\nNhập Telegram ID hoặc username để tìm user:`;

  if (ctx.callbackQuery) {
    await ctx.editMessageText(text, {
      parse_mode: 'HTML',
      reply_markup: Keyboards.backOnly('ADMIN_MENU'),
    }).catch(() => ctx.reply(text, { parse_mode: 'HTML' }));
    await ctx.answerCbQuery().catch(() => {});
  } else {
    await ctx.reply(text, { parse_mode: 'HTML', reply_markup: Keyboards.backOnly('ADMIN_MENU') });
  }
});

// ── Text: Tìm user ────────────────────────────────────────────────────────────

adminUserScene.on('text', async (ctx) => {
  const query = ctx.message.text.trim().replace('@', '');

  // Bỏ qua nếu là lệnh
  if (ctx.message.text.startsWith('/')) return;

  // Nếu đang chờ nhập số tiền adjust
  if (ctx.session.adminTargetUserId && (ctx.session as { _adjustMode?: string })._adjustMode) {
    return handleBalanceInput(ctx, query);
  }

  // Tìm theo telegramId hoặc username
  const user = await prisma.user.findFirst({
    where: {
      OR: [
        { telegramId: query },
        { username: query },
      ],
    },
    include: { wallet: true, vipLevel: true },
  });

  if (!user) {
    return ctx.reply(`❌ Không tìm thấy user với ID/username: <code>${query}</code>`, { parse_mode: 'HTML' });
  }

  ctx.session.adminTargetUserId = user.id;

  const text =
    `👤 <b>THÔNG TIN USER</b>\n${'━'.repeat(24)}\n` +
    `Tên: <b>${user.firstName ?? 'N/A'} ${user.lastName ?? ''}</b>\n` +
    `Username: ${user.username ? `@${user.username}` : 'N/A'}\n` +
    `Telegram ID: <code>${user.telegramId}</code>\n` +
    `${'━'.repeat(24)}\n` +
    `💰 Số dư: <b>${(user.wallet?.balance ?? 0).toLocaleString('vi-VN')}đ</b>\n` +
    `💎 VIP: <b>${user.vipLevel?.name ?? 'Chưa có'}</b>\n` +
    `📦 Tổng đơn: <b>${user.totalOrders}</b>\n` +
    `💸 Tổng chi: <b>${user.totalSpent.toLocaleString('vi-VN')}đ</b>\n` +
    `⚠️ Trạng thái: <b>${user.status}</b>`;

  await ctx.reply(text, {
    parse_mode: 'HTML',
    reply_markup: Keyboards.adminUserAction(user.id),
  });
});

// ── Action: Cộng tiền ────────────────────────────────────────────────────────

adminUserScene.action(/^admin:balance:add:(.+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  const userId = ctx.match[1];
  ctx.session.adminTargetUserId = userId;
  (ctx.session as { _adjustMode?: string })._adjustMode = 'add';

  await ctx.reply(
    `💰 Nhập số tiền cần <b>CỘNG</b> (VND):\n<i>Ví dụ: 100000</i>`,
    { parse_mode: 'HTML', reply_markup: Keyboards.backOnly('ADMIN_USER') }
  );
});

// ── Action: Trừ tiền ────────────────────────────────────────────────────────

adminUserScene.action(/^admin:balance:sub:(.+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  const userId = ctx.match[1];
  ctx.session.adminTargetUserId = userId;
  (ctx.session as { _adjustMode?: string })._adjustMode = 'sub';

  await ctx.reply(
    `💰 Nhập số tiền cần <b>TRỪ</b> (VND):\n<i>Ví dụ: 50000</i>`,
    { parse_mode: 'HTML', reply_markup: Keyboards.backOnly('ADMIN_USER') }
  );
});

// ── Action: Ban user ─────────────────────────────────────────────────────────

adminUserScene.action(/^admin:user:ban:(.+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  const userId = ctx.match[1];

  await prisma.user.update({ where: { id: userId }, data: { status: 'BANNED' } });
  await ctx.reply('✅ Đã ban user thành công.');
  return ctx.scene.reenter();
});

// ── Navigation ────────────────────────────────────────────────────────────────

adminUserScene.action('back:ADMIN_USER', async (ctx) => {
  await ctx.answerCbQuery();
  (ctx.session as { _adjustMode?: string })._adjustMode = undefined;
  ctx.session.adminTargetUserId = undefined;
  return ctx.scene.reenter();
});

adminUserScene.action('back:ADMIN_MENU', async (ctx) => {
  await ctx.answerCbQuery();
  return ctx.scene.enter(SCENES.ADMIN_MENU);
});

adminUserScene.action('admin:user:search', async (ctx) => {
  await ctx.answerCbQuery();
  return ctx.scene.reenter();
});

// ── Helper ────────────────────────────────────────────────────────────────────

async function handleBalanceInput(ctx: BotContext, input: string) {
  const userId = ctx.session.adminTargetUserId!;
  const mode = (ctx.session as { _adjustMode?: string })._adjustMode;

  const amount = parseInt(input.replace(/[.,\s]/g, ''), 10);
  if (isNaN(amount) || amount <= 0) {
    return ctx.reply('❌ Số tiền không hợp lệ.');
  }

  const isAddition = mode === 'add';
  const adminId = ctx.from!.id.toString();

  const wallet = await AdminService.adjustUserBalance(
    adminId,
    userId,
    amount,
    isAddition,
    `Admin ${isAddition ? 'cộng' : 'trừ'} ${amount.toLocaleString('vi-VN')}đ`
  );

  (ctx.session as { _adjustMode?: string })._adjustMode = undefined;
  ctx.session.adminTargetUserId = undefined;

  await ctx.reply(
    `✅ ${isAddition ? 'Cộng' : 'Trừ'} <b>${amount.toLocaleString('vi-VN')}đ</b> thành công!\nSố dư mới: <b>${wallet.balance.toLocaleString('vi-VN')}đ</b>`,
    { parse_mode: 'HTML' }
  );
}
