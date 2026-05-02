import { Scenes } from 'telegraf';
import { SCENES } from '../context.js';
import { Messages } from '../ui/messages.js';
import { Keyboards } from '../ui/keyboards.js';
import { OrderService } from '../../modules/order/OrderService.js';
const ORDERS_PER_PAGE = 10;
// ─ Rate limit: chống spam callback ─────────────────────────────────────────────
const cbMap = new Map();
function isRateLimited(userId, limitMs = 800) {
    const now = Date.now();
    const last = cbMap.get(userId) ?? 0;
    if (now - last < limitMs)
        return true;
    cbMap.set(userId, now);
    // dọn bộ nhớ mỗi 10 phút
    if (cbMap.size > 2000)
        cbMap.clear();
    return false;
}
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
    // Nút có thể xem lại data nếu đã giao
    const hasDelivery = ['COMPLETED', 'DELIVERED'].includes(order.status);
    const deliveryBtn = hasDelivery
        ? [[{ text: '📋 Xem lại dữ liệu đã mua', callback_data: `order:keys:${orderId}` }]]
        : [];
    await ctx.editMessageText(text, {
        parse_mode: 'HTML',
        reply_markup: {
            inline_keyboard: [
                ...deliveryBtn,
                ...Keyboards.orderDetail(orderId, order.status).inline_keyboard,
            ],
        },
    });
});
// ── Action: Xem key/code đã giao ────────────────────────────────────────────────────
orderScene.action(/^order:keys:(.+)$/, async (ctx) => {
    if (isRateLimited(ctx.user.id, 3000))
        return ctx.answerCbQuery('⏳ Vui lòng chờ vài giây...').catch(() => { });
    await ctx.answerCbQuery('📤 Đang lấy dữ liệu...');
    const orderId = ctx.match[1];
    const deliveredItems = await OrderService.getOrderWithDeliveredItems(orderId);
    const text = Messages.orderKeys(orderId, deliveredItems);
    await ctx.reply(text, { parse_mode: 'HTML' });
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
