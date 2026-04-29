import { Scenes } from 'telegraf';
import { SCENES } from '../context.js';
import { Messages } from '../ui/messages.js';
import { Keyboards } from '../ui/keyboards.js';
import { WalletService } from '../../modules/wallet/WalletService.js';
const TX_PER_PAGE = 10;
export const walletScene = new Scenes.BaseScene(SCENES.WALLET);
// ── Enter: Xem thông tin ví ──────────────────────────────────────────────────
walletScene.enter(async (ctx) => {
    const wallet = ctx.user.wallet;
    if (!wallet) {
        await ctx.reply('❌ Không tìm thấy thông tin ví.');
        return ctx.scene.enter(SCENES.MAIN_MENU);
    }
    const text = Messages.walletInfo(wallet);
    const keyboard = Keyboards.walletMenu();
    if (ctx.callbackQuery) {
        await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: keyboard })
            .catch(() => ctx.reply(text, { parse_mode: 'HTML', reply_markup: keyboard }));
        await ctx.answerCbQuery().catch(() => { });
    }
    else {
        await ctx.reply(text, { parse_mode: 'HTML', reply_markup: keyboard });
    }
});
// ── Action: Nạp tiền ─────────────────────────────────────────────────────────
walletScene.action('scene:DEPOSIT', async (ctx) => {
    await ctx.answerCbQuery();
    return ctx.scene.enter(SCENES.DEPOSIT);
});
// ── Action: Lịch sử giao dịch (paginated) ────────────────────────────────────
walletScene.action(/^wallet:history:(\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const page = parseInt(ctx.match[1], 10);
    ctx.session.txPage = page;
    const txs = await WalletService.getTransactions(ctx.user.id, TX_PER_PAGE, page);
    const total = await WalletService.countTransactions(ctx.user.id);
    const totalPages = Math.ceil(total / TX_PER_PAGE);
    const text = Messages.txHistory(txs, page, Math.max(totalPages, 1));
    const keyboard = Keyboards.walletHistory(page, Math.max(totalPages, 1));
    await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: keyboard });
});
// ── Navigation ────────────────────────────────────────────────────────────────
walletScene.action('back:main', async (ctx) => {
    await ctx.answerCbQuery();
    return ctx.scene.enter(SCENES.MAIN_MENU);
});
