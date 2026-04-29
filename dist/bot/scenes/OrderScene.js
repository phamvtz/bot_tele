import { Scenes } from 'telegraf';
import { SCENES } from '../context.js';
import { Messages } from '../ui/messages.js';
import { Keyboards } from '../ui/keyboards.js';
import { OrderService } from '../../modules/order/OrderService.js';
const ORDERS_PER_PAGE = 10;
export const orderScene = new Scenes.BaseScene(SCENES.ORDERS);
// ── Enter: Lịch sử đơn hàng ──────────────────────────────────────────────────
orderScene.enter(async (ctx) => {
    if (ctx.callbackQuery)
        await ctx.answerCbQuery().catch(() => { });
    const page = ctx.session.orderPage ?? 0;
    const { orders, totalPages } = await OrderService.getUserOrders(ctx.user.id, page, ORDERS_PER_PAGE);
    const text = Messages.orderList(orders, page, Math.max(totalPages, 1));
    const keyboard = Keyboards.orderList(orders, page, Math.max(totalPages, 1));
    if (ctx.callbackQuery) {
        await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: keyboard })
            .catch(() => ctx.reply(text, { parse_mode: 'HTML', reply_markup: keyboard }));
    }
    else {
        await ctx.reply(text, { parse_mode: 'HTML', reply_markup: keyboard });
    }
});
// ── Action: Phân trang ───────────────────────────────────────────────────────
orderScene.action(/^order:page:(\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    ctx.session.orderPage = parseInt(ctx.match[1], 10);
    return ctx.scene.reenter();
});
// ── Action: Xem chi tiết đơn ─────────────────────────────────────────────────
orderScene.action(/^order:detail:(.+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const orderId = ctx.match[1];
    const order = await import('../../infrastructure/db.js').then(m => m.default.order.findUnique({
        where: { id: orderId },
        include: { items: true },
    }));
    if (!order)
        return ctx.answerCbQuery('❌ Không tìm thấy đơn.', { show_alert: true });
    const statusMap = {
        PENDING_PAYMENT: '⏳ Chờ thanh toán',
        PAID: '💸 Đã thanh toán',
        PROCESSING: '⚙️ Đang xử lý',
        DELIVERED: '🚚 Đã giao hàng',
        COMPLETED: '✅ Hoàn tất',
        CANCELLED: '❌ Đã hủy',
        FAILED: '⚠️ Thất bại',
        REFUNDED: '🔙 Đã hoàn tiền',
    };
    const item = order.items[0];
    let text = `📦 <b>CHI TIẾT ĐƠN HÀNG</b>\n\n`;
    text += `🧾 Mã đơn: <code>${order.orderCode}</code>\n`;
    text += `📦 Sản phẩm: <b>${item?.productNameSnapshot ?? 'N/A'}</b> × ${item?.quantity ?? 1}\n`;
    text += `💰 Thành tiền: <b>${order.finalAmount.toLocaleString('vi-VN')}đ</b>\n`;
    text += `📊 Trạng thái: ${statusMap[order.status] ?? order.status}\n`;
    text += `📅 Ngày tạo: ${order.createdAt.toLocaleDateString('vi-VN')}\n`;
    await ctx.editMessageText(text, {
        parse_mode: 'HTML',
        reply_markup: Keyboards.orderDetail(orderId, order.status),
    });
});
// ── Action: Xem key/code đã giao ─────────────────────────────────────────────
orderScene.action(/^order:keys:(.+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const orderId = ctx.match[1];
    const deliveredItems = await OrderService.getOrderWithDeliveredItems(orderId);
    const text = Messages.orderKeys(orderId, deliveredItems);
    // Gửi riêng (không edit vì có thể message cũ)
    await ctx.reply(text, { parse_mode: 'HTML' });
    await ctx.answerCbQuery('✅ Đã gửi dữ liệu!');
});
// ── Navigation ────────────────────────────────────────────────────────────────
orderScene.action('back:ORDERS', async (ctx) => {
    await ctx.answerCbQuery();
    return ctx.scene.reenter();
});
orderScene.action('back:main', async (ctx) => {
    await ctx.answerCbQuery();
    return ctx.scene.enter(SCENES.MAIN_MENU);
});
orderScene.action('scene:SHOP', async (ctx) => {
    await ctx.answerCbQuery();
    return ctx.scene.enter(SCENES.SHOP);
});
orderScene.action('scene:ORDERS', async (ctx) => {
    await ctx.answerCbQuery();
    return ctx.scene.reenter();
});
orderScene.action(/^support:new:(.+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    ctx.session.pendingOrderId = ctx.match[1];
    return ctx.scene.enter(SCENES.SUPPORT);
});
