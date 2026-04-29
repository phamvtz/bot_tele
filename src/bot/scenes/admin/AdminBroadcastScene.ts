import { Scenes } from 'telegraf';
import { BotContext, SCENES } from '../../context.js';
import { Keyboards } from '../../ui/keyboards.js';
import { NotificationService } from '../../../modules/notification/NotificationService.js';
import prisma from '../../../infrastructure/db.js';

export const adminBroadcastScene = new Scenes.BaseScene<BotContext>(SCENES.ADMIN_BROADCAST);

// State flag được lưu trong session name đặc biệt
type BroadcastStep = 'compose' | 'confirm' | undefined;

adminBroadcastScene.enter(async (ctx) => {
  (ctx.session as { _broadcastStep?: BroadcastStep; _broadcastMsg?: string })._broadcastStep = 'compose';
  (ctx.session as { _broadcastMsg?: string })._broadcastMsg = undefined;

  const text = `📢 <b>BROADCAST TIN NHẮN</b>\n\nNhập nội dung tin nhắn muốn gửi đến tất cả users:\n\n<i>Hỗ trợ HTML (<b>bold</b>, <i>italic</i>, <code>code</code>...)</i>`;

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

adminBroadcastScene.on('text', async (ctx) => {
  const step = (ctx.session as { _broadcastStep?: BroadcastStep })._broadcastStep;

  if (step === 'compose') {
    const message = ctx.message.text;
    (ctx.session as { _broadcastMsg?: string })._broadcastMsg = message;
    (ctx.session as { _broadcastStep?: BroadcastStep })._broadcastStep = 'confirm';

    // Đếm users sẽ nhận
    const totalUsers = await prisma.user.count({ where: { status: 'ACTIVE' } });

    await ctx.reply(
      `👀 <b>XEM TRƯỚC:</b>\n${'━'.repeat(24)}\n${message}\n${'━'.repeat(24)}\n\n` +
      `📦 Sẽ gửi đến <b>${totalUsers}</b> users.\n\nXác nhận gửi?`,
      {
        parse_mode: 'HTML',
        reply_markup: Keyboards.confirm('admin:broadcast:yes', 'admin:broadcast:no'),
      }
    );
  }
});

adminBroadcastScene.action('admin:broadcast:yes', async (ctx) => {
  await ctx.answerCbQuery();
  const message = (ctx.session as { _broadcastMsg?: string })._broadcastMsg;

  if (!message) return ctx.reply('❌ Không có nội dung.');

  await ctx.editMessageText('⏳ Đang gửi broadcast...').catch(() => {});

  // Load all active users' telegramIds
  const users = await prisma.user.findMany({
    where: { status: 'ACTIVE' },
    select: { telegramId: true },
  });

  const telegramIds = users.map(u => u.telegramId);
  const { sent, failed } = await NotificationService.broadcast(telegramIds, message);

  // Save to Broadcast log
  await prisma.broadcast.create({
    data: {
      title: message.substring(0, 50),
      content: message,
      totalTarget: telegramIds.length,
      totalSent: sent,
      totalFailed: failed,
      createdByAdminId: ctx.from!.id.toString(),
    },
  });

  (ctx.session as { _broadcastStep?: BroadcastStep; _broadcastMsg?: string })._broadcastStep = undefined;
  (ctx.session as { _broadcastMsg?: string })._broadcastMsg = undefined;

  await ctx.reply(
    `✅ <b>BROADCAST HOÀN TẤT!</b>\n\n📢 Đã gửi: <b>${sent}</b>\n❌ Thất bại: <b>${failed}</b>`,
    { parse_mode: 'HTML', reply_markup: Keyboards.backOnly('ADMIN_MENU') }
  );
});

adminBroadcastScene.action('admin:broadcast:no', async (ctx) => {
  await ctx.answerCbQuery();
  return ctx.scene.reenter();
});

adminBroadcastScene.action('back:ADMIN_MENU', async (ctx) => {
  await ctx.answerCbQuery();
  return ctx.scene.enter(SCENES.ADMIN_MENU);
});
