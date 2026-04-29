import { Scenes } from 'telegraf';
import { SCENES } from '../../context.js';
import { Keyboards } from '../../ui/keyboards.js';
import { OrderService } from '../../../modules/order/OrderService.js';
const PAGE_SIZE = 8;
export const adminOrderScene = new Scenes.BaseScene(SCENES.ADMIN_ORDERS);
// ── Enter: Danh sách đơn hàng ──────────────────────────────────────────────
adminOrderScene.enter(async (ctx) => {
    const page = 0;
    const { orders, totalPages } = await OrderService.getAllOrdersPaginated(page, PAGE_SIZE);
    const text = `📦 <b>QUẢN LÝ ĐƠN HÀNG</b>\n\nTổng: ${orders.length} đơn | Trang 1/${Math.max(totalPages, 1)}`;
    const keyboard = Keyboards.adminOrders(orders, page, Math.max(totalPages, 1));
    if (ctx.callbackQuery) {
        await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: keyboard })
            .catch(() => ctx.reply(text, { parse_mode: 'HTML', reply_markup: keyboard }));
        await ctx.answerCbQuery().catch(() => { });
    }
    else {
        await ctx.reply(text, { parse_mode: 'HTML', reply_markup: keyboard });
    }
});
// ── Action: Phân trang ──────────────────────────────────────────────────────
adminOrderScene.action(/^admin:order:page:(\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const page = parseInt(ctx.match[1], 10);
    const { orders, totalPages } = await OrderService.getAllOrdersPaginated(page, PAGE_SIZE);
    const text = `📦 <b>QUẢN LÝ ĐƠN HÀNG</b>\n\nTrang ${page + 1}/${Math.max(totalPages, 1)}`;
    await ctx.editMessageText(text, {
        parse_mode: 'HTML',
        reply_markup: Keyboards.adminOrders(orders, page, Math.max(totalPages, 1)),
    });
});
// ── Action: Xem chi tiết đơn hàng ──────────────────────────────────────────
adminOrderScene.action(/^admin:order:(.+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const orderId = ctx.match[1];
    // order:page:x và order:keys:x và order:refund:x sẽ lọt xuống dưới do handler regex khác
    if (orderId.startsWith('page:') || orderId.startsWith('keys:') || orderId.startsWith('refund:')) {
        return;
    }
    // Tái sử dụng query, nhưng gọi prisma hoặc order service để lấy chính xác info
    const { orders } = await OrderService.getAllOrdersPaginated(0, 1000);
    const order = orders.find(o => o.id === orderId);
    if (!order) {
        return ctx.answerCbQuery('❌ Đơn hàng không tồn tại!', { show_alert: true });
    }
    const itemsText = order.items.map(i => `- ${i.productNameSnapshot} x${i.quantity}`).join('\n');
    const userText = order.user ? `${order.user.firstName || ''} ${order.user.lastName || ''}`.trim() + (order.user.username ? ` (@${order.user.username})` : '') : 'Ẩn danh';
    const text = `📦 <b>CHI TIẾT ĐƠN HÀNG</b>\n` +
        `${'━'.repeat(20)}\n` +
        `Mã đơn: <code>${order.orderCode}</code>\n` +
        `Khách: <b>${userText}</b> (ID: <code>${order.user.telegramId}</code>)\n` +
        `Trạng thái: <b>${order.status}</b>\n` +
        `Mặt hàng:\n${itemsText}\n` +
        `Tổng tiền: <b>${order.finalAmount.toLocaleString('vi-VN')}đ</b>\n` +
        `Ngày tạo: ${order.createdAt.toLocaleString('vi-VN')}`;
    await ctx.editMessageText(text, {
        parse_mode: 'HTML',
        reply_markup: Keyboards.adminOrderDetail(orderId),
    });
});
// ── Action: Xem Product Keys ──────────────────────────────────────────────
adminOrderScene.action(/^admin:order:keys:(.+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const orderId = ctx.match[1];
    const keys = await OrderService.getOrderWithDeliveredItems(orderId);
    if (keys.length === 0) {
        return ctx.reply('❌ Chưa có dữ liệu giao hàng nào cho đơn này.');
    }
    const texts = keys.map((k, i) => `<i>Item ${i + 1}</i>\n<pre>${k.deliveredContent}</pre>`);
    await ctx.reply(`🔑 <b>DỮ LIỆU ĐÃ GIAO</b>:\n\n${texts.join('\n\n')}`, { parse_mode: 'HTML' });
});
// ── Navigation ────────────────────────────────────────────────────────────
adminOrderScene.action('back:ADMIN_ORDERS', async (ctx) => {
    await ctx.answerCbQuery();
    return ctx.scene.reenter();
});
adminOrderScene.action('back:ADMIN_MENU', async (ctx) => {
    await ctx.answerCbQuery();
    return ctx.scene.enter(SCENES.ADMIN_MENU);
});
