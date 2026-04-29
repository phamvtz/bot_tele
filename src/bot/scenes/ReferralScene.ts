import { Scenes } from 'telegraf';
import { BotContext, SCENES } from '../context.js';
import { Messages } from '../ui/messages.js';
import { Keyboards } from '../ui/keyboards.js';
import prisma from '../../infrastructure/db.js';

export const referralScene = new Scenes.BaseScene<BotContext>(SCENES.REFERRAL);

const COMMISSION_RATE = parseInt(process.env.REFERRAL_COMMISSION_RATE ?? '5', 10);

referralScene.enter(async (ctx) => {
  const [referralCount, commissionSum] = await Promise.all([
    prisma.referral.count({ where: { referrerUserId: ctx.user.id } }),
    prisma.referralCommission.aggregate({
      where: { referrerUserId: ctx.user.id, status: 'PAID' },
      _sum: { commissionAmount: true },
    }),
  ]);

  const totalCommission = commissionSum._sum.commissionAmount ?? 0;
  const botUsername = (await ctx.telegram.getMe()).username ?? 'YourBot';

  const text = Messages.referralInfo(ctx.user as never, referralCount, totalCommission, COMMISSION_RATE);
  const keyboard = Keyboards.referralMenu(botUsername, ctx.user.referralCode);

  if (ctx.callbackQuery) {
    await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: keyboard })
      .catch(() => ctx.reply(text, { parse_mode: 'HTML', reply_markup: keyboard }));
    await ctx.answerCbQuery().catch(() => {});
  } else {
    await ctx.reply(text, { parse_mode: 'HTML', reply_markup: keyboard });
  }
});

referralScene.action(/^referral:copy:(.+)$/, async (ctx) => {
  const link = decodeURIComponent(ctx.match[1]);
  await ctx.answerCbQuery(`✅ Link: ${link}`, { show_alert: true });
});

referralScene.action('back:PROFILE', async (ctx) => {
  await ctx.answerCbQuery();
  return ctx.scene.enter(SCENES.PROFILE);
});

referralScene.action('back:main', async (ctx) => {
  await ctx.answerCbQuery();
  return ctx.scene.enter(SCENES.MAIN_MENU);
});
