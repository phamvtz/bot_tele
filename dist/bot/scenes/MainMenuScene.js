import { Scenes } from 'telegraf';
import { SCENES } from '../context.js';
import { Messages } from '../ui/messages.js';
import { Keyboards } from '../ui/keyboards.js';
/**
 * MainMenuScene — màn hình chính của bot.
 * Điều hướng sang các scene khác.
 */
export const mainMenuScene = new Scenes.BaseScene(SCENES.MAIN_MENU);
mainMenuScene.enter(async (ctx) => {
    if (ctx.callbackQuery)
        await ctx.answerCbQuery().catch(() => { });
    const welcomeText = Messages.welcome(ctx.user, ctx.botInfo.username);
    const keyboard = Keyboards.mainMenu();
    if (ctx.callbackQuery) {
        await ctx.editMessageText(welcomeText, {
            parse_mode: 'HTML',
            reply_markup: keyboard,
        }).catch(() => ctx.reply(welcomeText, { parse_mode: 'HTML', reply_markup: keyboard }));
    }
    else {
        await ctx.reply(welcomeText, { parse_mode: 'HTML', reply_markup: keyboard });
    }
});
// Điều hướng sang scene khác khi bấm nút
mainMenuScene.action(/^scene:(.+)$/, async (ctx) => {
    const sceneName = ctx.match[1];
    await ctx.answerCbQuery();
    if (SCENES[sceneName]) {
        return ctx.scene.enter(SCENES[sceneName]);
    }
});
// Quay về main từ bất kỳ đâu
mainMenuScene.action('back:main', async (ctx) => {
    await ctx.answerCbQuery();
    return ctx.scene.enter(SCENES.MAIN_MENU);
});
