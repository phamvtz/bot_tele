import { Scenes } from 'telegraf';
import { SCENES } from '../../context.js';
import { Keyboards } from '../../ui/keyboards.js';
import { AdminService } from '../../../modules/admin/AdminService.js';
import { ProductService } from '../../../modules/product/ProductService.js';
export const adminStockScene = new Scenes.BaseScene(SCENES.ADMIN_STOCK);
// ── Enter: Chọn sản phẩm để nhập kho ────────────────────────────────────────
adminStockScene.enter(async (ctx) => {
    // Nếu đã có targetProductId (từ AdminProductScene) → bỏ qua bước chọn
    if (ctx.session.adminTargetProductId) {
        return promptStockLines(ctx);
    }
    const { products } = await ProductService.getAllProducts(0, 20);
    const keyboard = [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rows = products.map((p) => ([{
            text: `${p.isActive ? '✅' : '❌'} ${p.name} (${p.stockCount} còn)`,
            callback_data: `adminstock:pick:${p.id}`,
        }]));
    const text = `📥 <b>NHẬP KHO</b>\n\nChọn sản phẩm cần nhập kho:`;
    if (ctx.callbackQuery) {
        await ctx.editMessageText(text, {
            parse_mode: 'HTML',
            reply_markup: { inline_keyboard: [...rows, [{ text: '⬅️ Quay lại', callback_data: 'back:ADMIN_MENU' }]] },
        }).catch(() => ctx.reply(text, { parse_mode: 'HTML' }));
        await ctx.answerCbQuery().catch(() => { });
    }
    else {
        await ctx.reply(text, {
            parse_mode: 'HTML',
            reply_markup: { inline_keyboard: [...rows, [{ text: '⬅️ Quay lại', callback_data: 'back:ADMIN_MENU' }]] },
        });
    }
});
// ── Action: Chọn sản phẩm ────────────────────────────────────────────────────
adminStockScene.action(/^adminstock:pick:(.+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    ctx.session.adminTargetProductId = ctx.match[1];
    return promptStockLines(ctx);
});
// ── Nhận nội dung kho từ admin ────────────────────────────────────────────────
adminStockScene.on('text', async (ctx) => {
    const productId = ctx.session.adminTargetProductId;
    if (!productId)
        return ctx.reply('❌ Chưa chọn sản phẩm. Dùng /admin → Nhập Kho.');
    const rawText = ctx.message.text;
    const lines = rawText.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    if (lines.length === 0) {
        return ctx.reply('❌ Không có dòng nào hợp lệ. Mỗi dòng = 1 item.');
    }
    const adminId = ctx.from.id.toString();
    try {
        const result = await AdminService.importStockText(adminId, productId, lines);
        ctx.session.adminTargetProductId = undefined;
        await ctx.reply(`✅ <b>NHẬP KHO THÀNH CÔNG!</b>\n\n` +
            `📦 Đã nhập: <b>${result.importedCount}</b> items\n` +
            `🏷️ Batch ID: <code>${result.batchId}</code>`, {
            parse_mode: 'HTML',
            reply_markup: {
                inline_keyboard: [
                    [{ text: '📥 Nhập tiếp', callback_data: 'back:ADMIN_STOCK' }],
                    [{ text: '⬅️ Menu Admin', callback_data: 'back:ADMIN_MENU' }],
                ],
            },
        });
    }
    catch (err) {
        const msg = err instanceof Error ? err.message : 'Lỗi nhập kho';
        await ctx.reply(`❌ Lỗi: ${msg}`);
    }
});
// ── Navigation ────────────────────────────────────────────────────────────────
adminStockScene.action('back:ADMIN_STOCK', async (ctx) => {
    await ctx.answerCbQuery();
    ctx.session.adminTargetProductId = undefined;
    return ctx.scene.reenter();
});
adminStockScene.action('back:ADMIN_MENU', async (ctx) => {
    await ctx.answerCbQuery();
    return ctx.scene.enter(SCENES.ADMIN_MENU);
});
// ── Helper ────────────────────────────────────────────────────────────────────
async function promptStockLines(ctx) {
    const productId = ctx.session.adminTargetProductId;
    const product = await ProductService.getProductDetail(productId);
    const text = `📥 <b>NHẬP KHO — ${product?.name ?? productId}</b>\n\n` +
        `Gửi nội dung kho, mỗi dòng là 1 item:\n\n` +
        `<i>Ví dụ:</i>\n<pre>\nemail1@gmail.com:pass1\nemail2@gmail.com:pass2\n</pre>`;
    const msg = ctx.callbackQuery
        ? ctx.editMessageText(text, {
            parse_mode: 'HTML',
            reply_markup: Keyboards.backOnly('ADMIN_MENU'),
        })
        : ctx.reply(text, {
            parse_mode: 'HTML',
            reply_markup: Keyboards.backOnly('ADMIN_MENU'),
        });
    await msg;
    await ctx.answerCbQuery?.().catch(() => { });
}
