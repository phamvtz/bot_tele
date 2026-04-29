import { Scenes } from 'telegraf';
import { SCENES } from '../context.js';
import { Messages } from '../ui/messages.js';
import { Keyboards } from '../ui/keyboards.js';
export const profileScene = new Scenes.BaseScene(SCENES.PROFILE);
profileScene.enter(async (ctx) => {
    const text = Messages.profile(ctx.user);
    const keyboard = Keyboards.profileMenu();
    if (ctx.callbackQuery) {
        await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: keyboard })
            .catch(() => ctx.reply(text, { parse_mode: 'HTML', reply_markup: keyboard }));
        await ctx.answerCbQuery().catch(() => { });
    }
    else {
        await ctx.reply(text, { parse_mode: 'HTML', reply_markup: keyboard });
    }
});
profileScene.action('scene:REFERRAL', async (ctx) => {
    await ctx.answerCbQuery();
    return ctx.scene.enter(SCENES.REFERRAL);
});
profileScene.action('back:main', async (ctx) => {
    await ctx.answerCbQuery();
    return ctx.scene.enter(SCENES.MAIN_MENU);
});
