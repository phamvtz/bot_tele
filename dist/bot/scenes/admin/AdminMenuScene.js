import { Scenes } from 'telegraf';
import { SCENES } from '../../context.js';
import { Messages } from '../../ui/messages.js';
import { Keyboards } from '../../ui/keyboards.js';
import { OrderService } from '../../../modules/order/OrderService.js';
export const adminMenuScene = new Scenes.BaseScene(SCENES.ADMIN_MENU);
adminMenuScene.enter(async (ctx) => {
    const stats = await OrderService.getDashboardStats();
    const text = Messages.adminDashboard(stats);
    const keyboard = Keyboards.adminMenu();
    if (ctx.callbackQuery) {
        await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: keyboard })
            .catch(() => ctx.reply(text, { parse_mode: 'HTML', reply_markup: keyboard }));
        await ctx.answerCbQuery().catch(() => { });
    }
    else {
        await ctx.reply(text, { parse_mode: 'HTML', reply_markup: keyboard });
    }
});
// Routing
const routes = {
    'admin:products': SCENES.ADMIN_PRODUCT,
    'admin:stock': SCENES.ADMIN_STOCK,
    'admin:users': SCENES.ADMIN_USER,
    'admin:balance': SCENES.ADMIN_USER,
    'admin:broadcast': SCENES.ADMIN_BROADCAST,
    'admin:orders': SCENES.ADMIN_ORDERS,
    'admin:categories': SCENES.ADMIN_CATEGORY,
};
for (const [action, scene] of Object.entries(routes)) {
    adminMenuScene.action(action, async (ctx) => {
        await ctx.answerCbQuery();
        return ctx.scene.enter(scene);
    });
}
adminMenuScene.action('admin:stats', async (ctx) => {
    await ctx.answerCbQuery();
    return ctx.scene.reenter();
});
adminMenuScene.action('back:main', async (ctx) => {
    await ctx.answerCbQuery();
    return ctx.scene.enter(SCENES.MAIN_MENU);
});
