import { Scenes } from 'telegraf';
import { SCENES } from '../../context.js';
import { AdminService } from '../../../modules/admin/AdminService.js';
import { ProductService } from '../../../modules/product/ProductService.js';
import { NotificationService } from '../../../modules/notification/NotificationService.js';
export const adminStockScene = new Scenes.BaseScene(SCENES.ADMIN_STOCK);
// ── Enter: Chọn sản phẩm để nhập kho ────────────────────────────────────────
adminStockScene.enter(async (ctx) => {
    // Nếu đã có targetProductId (từ AdminProductScene) → bỏ qua bước chọn
    if (ctx.session.adminTargetProductId) {
        return promptStockInput(ctx);
    }
    ctx.session.adminTargetProductId = undefined;
    ctx.session.adminStockPendingLines = undefined;
    const { products } = await ProductService.getAllProducts(0, 50);
    if (products.length === 0) {
        const text = `📥 <b>NHẬP KHO</b>\n\n❌ Chưa có sản phẩm nào. Hãy tạo sản phẩm trước.`;
        await (ctx.callbackQuery
            ? ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: { inline_keyboard: [[{ text: '⬅️ Quay lại', callback_data: 'back:ADMIN_MENU' }]] } }).catch(() => ctx.reply(text, { parse_mode: 'HTML' }))
            : ctx.reply(text, { parse_mode: 'HTML' }));
        await ctx.answerCbQuery?.().catch(() => { });
        return;
    }
    // Nhóm theo danh mục
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rows = products.map(p => ([{
            text: `${p.stockCount > 0 ? '🟢' : '🔴'} ${p.name} — còn ${p.stockCount}`,
            callback_data: `adminstock:pick:${p.id}`,
        }]));
    const text = `📥 <b>NHẬP KHO SẢN PHẨM</b>\n━━━━━━━━━━━━━━━━━━━━━━━━\n🟢 Còn hàng  🔴 Hết hàng\n\nChọn sản phẩm cần nhập kho:`;
    const replyMarkup = { inline_keyboard: [...rows, [{ text: '⬅️ Quay lại', callback_data: 'back:ADMIN_MENU' }]] };
    if (ctx.callbackQuery) {
        await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: replyMarkup }).catch(() => ctx.reply(text, { parse_mode: 'HTML', reply_markup: replyMarkup }));
        await ctx.answerCbQuery().catch(() => { });
    }
    else {
        await ctx.reply(text, { parse_mode: 'HTML', reply_markup: replyMarkup });
    }
});
// ── Action: Chọn sản phẩm ────────────────────────────────────────────────────
adminStockScene.action(/^adminstock:pick:(.+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    ctx.session.adminTargetProductId = ctx.match[1];
    ctx.session.adminStockPendingLines = undefined;
    return promptStockInput(ctx);
});
// ── Action: Xác nhận nhập kho ─────────────────────────────────────────────────
adminStockScene.action('adminstock:confirm', async (ctx) => {
    await ctx.answerCbQuery('⏳ Đang nhập kho...');
    const productId = ctx.session.adminTargetProductId;
    const lines = ctx.session.adminStockPendingLines;
    if (!productId || !lines || lines.length === 0) {
        return ctx.reply('❌ Không có dữ liệu để nhập. Vui lòng thử lại.');
    }
    try {
        const adminId = ctx.from.id.toString();
        const result = await AdminService.importStockText(adminId, productId, lines);
        // Lấy thông tin sản phẩm sau khi import (stockCount đã cập nhật)
        const product = await ProductService.getProductDetail(productId);
        // Invalidate cache vì stock đã thay đổi
        ProductService.invalidateProductCaches();
        ctx.session.adminTargetProductId = undefined;
        ctx.session.adminStockPendingLines = undefined;
        let msg = `✅ <b>NHẬP KHO THÀNH CÔNG!</b>\n━━━━━━━━━━━━━━━━━━━━━━━━\n`;
        msg += `📦 Đã nhập mới: <b>${result.importedCount} items</b>\n`;
        if (result.dupeCount > 0) {
            msg += `⚠️ Bỏ qua trùng: <b>${result.dupeCount} items</b>\n`;
        }
        if (result.batchId) {
            msg += `🗂 Batch ID: <code>${result.batchId}</code>\n`;
        }
        await ctx.editMessageText(msg, {
            parse_mode: 'HTML',
            reply_markup: {
                inline_keyboard: [
                    [{ text: '📥 Nhập tiếp sản phẩm này', callback_data: `adminstock:pick:${productId}` }],
                    [{ text: '📋 Chọn sản phẩm khác', callback_data: 'adminstock:reset' }],
                    [{ text: '⬅️ Menu Admin', callback_data: 'back:ADMIN_MENU' }],
                ],
            },
        });
        // Gửi thông báo lên kênh (fire & forget — không block UI)
        if (product && result.importedCount > 0) {
            NotificationService.notifyNewStock({
                productId: product.id,
                productName: product.name,
                productEmoji: product.thumbnailEmoji ?? '📦',
                addedCount: result.importedCount,
                newStockTotal: product.stockCount,
                botUsername: ctx.botInfo.username,
            }).catch(() => { }); // Không crash nếu kênh chưa set
        }
    }
    catch (err) {
        const msg = err instanceof Error ? err.message : 'Lỗi nhập kho';
        await ctx.reply(`❌ Lỗi: ${msg}`, {
            reply_markup: { inline_keyboard: [[{ text: '🔄 Thử lại', callback_data: 'adminstock:reset' }]] }
        });
    }
});
// ── Action: Huỷ / Reset ───────────────────────────────────────────────────────
adminStockScene.action('adminstock:cancel', async (ctx) => {
    await ctx.answerCbQuery();
    ctx.session.adminStockPendingLines = undefined;
    return promptStockInput(ctx);
});
adminStockScene.action('adminstock:reset', async (ctx) => {
    await ctx.answerCbQuery();
    ctx.session.adminTargetProductId = undefined;
    ctx.session.adminStockPendingLines = undefined;
    return ctx.scene.reenter();
});
// ── Nhận text từ admin (nội dung kho) ────────────────────────────────────────
adminStockScene.on('text', async (ctx) => {
    const productId = ctx.session.adminTargetProductId;
    if (!productId) {
        return ctx.reply('❌ Chưa chọn sản phẩm. Vui lòng bấm /admin → Nhập Kho.');
    }
    const rawText = ctx.message.text;
    const lines = rawText.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    if (lines.length === 0) {
        return ctx.reply('❌ Không có dòng nào hợp lệ. Mỗi dòng = 1 item.');
    }
    // Lưu vào session để xác nhận
    ctx.session.adminStockPendingLines = lines;
    // Lấy thông tin sản phẩm
    const product = await ProductService.getProductDetail(productId);
    // Preview 3 dòng đầu
    const preview = lines.slice(0, 3).map((l, i) => `  ${i + 1}. <code>${l.slice(0, 60)}${l.length > 60 ? '...' : ''}</code>`).join('\n');
    const moreText = lines.length > 3 ? `\n  <i>...và ${lines.length - 3} dòng nữa</i>` : '';
    const msg = `📋 <b>XÁC NHẬN NHẬP KHO</b>\n━━━━━━━━━━━━━━━━━━━━━━━━\n` +
        `📦 Sản phẩm: <b>${product?.name ?? productId}</b>\n` +
        `🗃 Tồn kho hiện tại: <b>${product?.stockCount ?? 0}</b>\n` +
        `➕ Sẽ thêm: <b>${lines.length} items</b>\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━━\n` +
        `<b>Preview nội dung:</b>\n${preview}${moreText}\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━━\n` +
        `⚠️ <i>Duplicate sẽ tự động bỏ qua.</i>`;
    await ctx.reply(msg, {
        parse_mode: 'HTML',
        reply_markup: {
            inline_keyboard: [
                [
                    { text: '✅ Xác nhận nhập kho', callback_data: 'adminstock:confirm' },
                    { text: '❌ Huỷ', callback_data: 'adminstock:cancel' },
                ],
            ],
        },
    });
});
// ── Navigation ────────────────────────────────────────────────────────────────
adminStockScene.action('back:ADMIN_STOCK', async (ctx) => {
    await ctx.answerCbQuery();
    ctx.session.adminTargetProductId = undefined;
    ctx.session.adminStockPendingLines = undefined;
    return ctx.scene.reenter();
});
adminStockScene.action('back:ADMIN_MENU', async (ctx) => {
    await ctx.answerCbQuery();
    return ctx.scene.enter(SCENES.ADMIN_MENU);
});
// ── Helper ────────────────────────────────────────────────────────────────────
async function promptStockInput(ctx) {
    const productId = ctx.session.adminTargetProductId;
    const product = await ProductService.getProductDetail(productId);
    const stockCount = product?.stockCount ?? 0;
    const statusIcon = stockCount > 0 ? '🟢' : '🔴';
    const text = `📥 <b>NHẬP KHO</b>\n━━━━━━━━━━━━━━━━━━━━━━━━\n` +
        `📦 Sản phẩm: <b>${product?.name ?? productId}</b>\n` +
        `${statusIcon} Tồn kho: <b>${stockCount} items</b>\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━━\n` +
        `Gửi nội dung kho, <b>mỗi dòng = 1 item</b>:\n\n` +
        `<i>Ví dụ:</i>\n` +
        `<pre>email1@gmail.com | pass: Abc@123 | gói: 1 tháng\nemail2@gmail.com | pass: Xyz@456 | gói: 1 tháng</pre>`;
    const replyMarkup = {
        inline_keyboard: [
            [{ text: '📋 Đổi sản phẩm', callback_data: 'adminstock:reset' }],
            [{ text: '⬅️ Menu Admin', callback_data: 'back:ADMIN_MENU' }],
        ],
    };
    if (ctx.callbackQuery) {
        await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: replyMarkup })
            .catch(() => ctx.reply(text, { parse_mode: 'HTML', reply_markup: replyMarkup }));
        await ctx.answerCbQuery?.().catch(() => { });
    }
    else {
        await ctx.reply(text, { parse_mode: 'HTML', reply_markup: replyMarkup });
    }
}
