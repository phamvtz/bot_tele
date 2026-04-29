import { Scenes } from 'telegraf';
import { SCENES } from '../../context.js';
import { Keyboards } from '../../ui/keyboards.js';
import { ProductService } from '../../../modules/product/ProductService.js';
export const adminCategoryScene = new Scenes.BaseScene(SCENES.ADMIN_CATEGORY);
// ── Enter: Danh sách danh mục ─────────────────────────────────────────────────
adminCategoryScene.enter(async (ctx) => {
    const categories = await ProductService.getAllCategories();
    const text = `📂 <b>QUẢN LÝ DANH MỤC</b>\n\nTổng: ${categories.length} danh mục.`;
    const keyboard = Keyboards.adminCategories(categories);
    if (ctx.callbackQuery) {
        await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: keyboard })
            .catch(() => ctx.reply(text, { parse_mode: 'HTML', reply_markup: keyboard }));
        await ctx.answerCbQuery().catch(() => { });
    }
    else {
        await ctx.reply(text, { parse_mode: 'HTML', reply_markup: keyboard });
    }
});
// ── Action: Tạo danh mục mới (bắt đầu) ──────────────────────────────────────
adminCategoryScene.action('admin:cat:new', async (ctx) => {
    await ctx.answerCbQuery();
    ctx.session._catStep = 'name';
    await ctx.editMessageText(`📂 <b>TẠO DANH MỤC MỚI</b>\n\nBước 1/3: Nhập tên danh mục:`, { parse_mode: 'HTML', reply_markup: Keyboards.backOnly('ADMIN_CATEGORY') });
});
// ── Action: Sửa danh mục ─────────────────────────────────────────────────────
adminCategoryScene.action(/^admin:cat:edit:(.+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const categoryId = ctx.match[1];
    const category = await ProductService.getAllCategories();
    const cat = category.find(c => c.id === categoryId);
    if (!cat)
        return;
    await ctx.editMessageText(`📂 <b>${cat.emoji} ${cat.name}</b>\n\nSlug: <code>${cat.slug}</code>\nTrạng thái: ${cat.isActive ? '✅ Bật' : '❌ Tắt'}`, {
        parse_mode: 'HTML',
        reply_markup: {
            inline_keyboard: [
                [{ text: cat.isActive ? '❌ Tắt danh mục' : '✅ Bật danh mục', callback_data: `admin:cat:toggle:${cat.id}` }],
                [{ text: '⬅️ Quay lại', callback_data: 'back:ADMIN_CATEGORY' }],
            ],
        },
    });
});
// ── Action: Bật/Tắt danh mục ─────────────────────────────────────────────────
adminCategoryScene.action(/^admin:cat:toggle:(.+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const categoryId = ctx.match[1];
    const cats = await ProductService.getAllCategories();
    const cat = cats.find(c => c.id === categoryId);
    if (!cat)
        return;
    await ProductService.updateCategory(categoryId, { isActive: !cat.isActive });
    await ctx.answerCbQuery(cat.isActive ? '❌ Đã tắt danh mục!' : '✅ Đã bật danh mục!', { show_alert: true });
    return ctx.scene.reenter();
});
adminCategoryScene.on('text', async (ctx) => {
    const s = ctx.session;
    const text = ctx.message.text.trim();
    if (s._catStep === 'name') {
        s._catName = text;
        s._catStep = 'emoji';
        await ctx.reply(`✅ Tên: <b>${text}</b>\n\nBước 2/3: Nhập emoji cho danh mục (ví dụ: 🎮):`, { parse_mode: 'HTML', reply_markup: Keyboards.backOnly('ADMIN_CATEGORY') });
        return;
    }
    if (s._catStep === 'emoji') {
        s._catEmoji = text;
        s._catStep = 'confirm';
        await ctx.reply(`✅ Emoji: ${text}\n\nBước 3/3: Nhập slug (không dấu, viết liền nối gạch ngang, ví dụ: game-the):`, { parse_mode: 'HTML', reply_markup: Keyboards.backOnly('ADMIN_CATEGORY') });
        return;
    }
    if (s._catStep === 'confirm') {
        const slug = text.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
        await ProductService.createCategory({
            name: s._catName,
            slug,
            emoji: s._catEmoji || '📦',
        });
        const finalName = s._catName;
        const finalEmoji = s._catEmoji ?? '📦';
        s._catStep = undefined;
        s._catName = undefined;
        s._catEmoji = undefined;
        await ctx.reply(`✅ <b>Đã tạo danh mục thành công!</b>\n\n${finalEmoji} <b>${finalName}</b>\nSlug: <code>${slug}</code>`, { parse_mode: 'HTML' });
        return ctx.scene.reenter();
    }
});
// ── Navigation ────────────────────────────────────────────────────────────────
adminCategoryScene.action('back:ADMIN_CATEGORY', async (ctx) => {
    await ctx.answerCbQuery();
    ctx.session._catStep = undefined;
    return ctx.scene.reenter();
});
adminCategoryScene.action('back:ADMIN_MENU', async (ctx) => {
    await ctx.answerCbQuery();
    return ctx.scene.enter(SCENES.ADMIN_MENU);
});
