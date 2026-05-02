import { Scenes } from 'telegraf';
import { BotContext, SCENES } from '../context.js';
import { Messages } from '../ui/messages.js';
import { Keyboards } from '../ui/keyboards.js';
import prisma from '../../infrastructure/db.js';

export const profileScene = new Scenes.BaseScene<BotContext>(SCENES.PROFILE);

profileScene.enter(async (ctx) => {
  if (ctx.callbackQuery) await ctx.answerCbQuery().catch(() => {});

  // Load next VIP level
  let nextVipLevel: { name: string; spendingThreshold: number } | null = null;
  try {
    const currentThreshold = ctx.user.vipLevel?.spendingThreshold ?? -1;
    nextVipLevel = await prisma.vipLevel.findFirst({
      where: { isActive: true, spendingThreshold: { gt: currentThreshold } },
      orderBy: { spendingThreshold: 'asc' },
      select: { name: true, spendingThreshold: true },
    });
  } catch { /* non-fatal */ }

  const text = Messages.profile(ctx.user as never, nextVipLevel);

  const keyboard = {
    inline_keyboard: [
      [
        { text: '💰 Nạp tiền', callback_data: 'scene:DEPOSIT' },
        { text: '📦 Đơn hàng', callback_data: 'scene:ORDERS' },
      ],
      [{ text: '🎁 Chương Trình Giới Thiệu', callback_data: 'scene:REFERRAL' }],
      [{ text: '🏠 Menu chính', callback_data: 'back:main' }],
    ],
  };

  if (ctx.callbackQuery) {
    await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: keyboard })
      .catch(() => ctx.reply(text, { parse_mode: 'HTML', reply_markup: keyboard }));
  } else {
    await ctx.reply(text, { parse_mode: 'HTML', reply_markup: keyboard });
  }
});

profileScene.action('scene:REFERRAL', async (ctx) => {
  await ctx.answerCbQuery();
  return ctx.scene.enter(SCENES.REFERRAL);
});

profileScene.action('scene:DEPOSIT', async (ctx) => {
  await ctx.answerCbQuery();
  return ctx.scene.enter(SCENES.DEPOSIT);
});

profileScene.action('scene:ORDERS', async (ctx) => {
  await ctx.answerCbQuery();
  return ctx.scene.enter(SCENES.ORDERS);
});

profileScene.action('back:main', async (ctx) => {
  await ctx.answerCbQuery();
  return ctx.scene.enter(SCENES.MAIN_MENU);
});
