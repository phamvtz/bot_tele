import { Scenes } from 'telegraf';
import { SCENES } from '../context.js';
import { Messages } from '../ui/messages.js';
import { Keyboards } from '../ui/keyboards.js';
import { OrderService } from '../../modules/order/OrderService.js';
import { OrderService as OrderSvc } from '../../modules/order/OrderService.js';
export const checkoutScene = new Scenes.BaseScene(SCENES.CHECKOUT);
// ── Enter: Xác nhận đơn hàng ─────────────────────────────────────────────────
checkoutScene.enter(async (ctx) => {
    const cart = ctx.session.cart;
    if (!cart) {
        await ctx.reply('❌ Phiên mua hàng hết hạn. Vui lòng chọn sản phẩm lại.');
        return ctx.scene.enter(SCENES.SHOP);
    }
    const walletBalance = ctx.user.wallet?.balance ?? 0;
    try {
        // Tạo pending order
        const order = await OrderService.createPendingOrder(ctx.user.id, cart.productId, cart.quantity, 'WALLET');
        // Lưu ID vào session
        ctx.session.pendingOrderId = order.id;
        ctx.session.pendingOrderCode = order.orderCode;
        ctx.session.pendingOrderAmount = order.finalAmount;
        const text = Messages.checkoutSummary({ ...order, items: [{ quantity: cart.quantity, productNameSnapshot: cart.productName }] }, cart.productName, order.discountAmount, 0);
        const keyboard = Keyboards.checkout(order.id, walletBalance, order.finalAmount);
        const reply = ctx.callbackQuery
            ? ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: keyboard })
            : ctx.reply(text, { parse_mode: 'HTML', reply_markup: keyboard });
        await reply;
        await ctx.answerCbQuery().catch(() => { });
    }
    catch (err) {
        const msg = err instanceof Error ? err.message : 'Lỗi tạo đơn hàng';
        await ctx.reply(`❌ ${msg}`);
        return ctx.scene.enter(SCENES.SHOP);
    }
});
// ── Action: Thanh toán bằng ví ───────────────────────────────────────────────
checkoutScene.action(/^pay:wallet:(.+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const orderId = ctx.match[1];
    await ctx.editMessageText('⏳ Đang xử lý thanh toán...').catch(() => { });
    try {
        const paidOrder = await OrderService.payWithWallet(orderId, ctx.user.id);
        // Load delivered items để show ngay
        const deliveredItems = await OrderSvc.getOrderWithDeliveredItems(paidOrder.id);
        const text = Messages.paymentSuccess(paidOrder, deliveredItems);
        await ctx.editMessageText(text, {
            parse_mode: 'HTML',
            reply_markup: {
                inline_keyboard: [
                    [{ text: '📦 Xem Đơn Hàng', callback_data: 'scene:ORDERS' }],
                    [{ text: '🛒 Mua Tiếp', callback_data: 'scene:SHOP' }],
                    [{ text: '🎧 Báo Lỗi Sản Phẩm', callback_data: `support:new:${paidOrder.id}` }],
                ],
            },
        });
        // Xóa cart session
        ctx.session.cart = undefined;
        ctx.session.pendingOrderId = undefined;
    }
    catch (err) {
        const msg = err instanceof Error ? err.message : 'Lỗi thanh toán';
        await ctx.editMessageText(`❌ *THANH TOÁN THẤT BẠI*\n\nLý do: ${msg}`, {
            parse_mode: 'HTML',
            reply_markup: Keyboards.backOnly('ORDERS'),
        });
    }
});
// ── Action: Thanh toán QR ────────────────────────────────────────────────────
checkoutScene.action(/^pay:qr:(.+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    return ctx.scene.enter(SCENES.DEPOSIT);
});
// ── Action: Hủy đơn ──────────────────────────────────────────────────────────
checkoutScene.action(/^order:cancel:(.+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const orderId = ctx.match[1];
    try {
        await OrderService.cancelOrder(orderId, 'USER_CANCELLED');
        ctx.session.cart = undefined;
        ctx.session.pendingOrderId = undefined;
        await ctx.editMessageText('✅ Đơn hàng đã được hủy thành công.', {
            reply_markup: Keyboards.backOnly('MAIN_MENU'),
        });
    }
    catch {
        await ctx.reply('❌ Không thể hủy đơn. Vui lòng thử lại.');
    }
});
// ── Action: Gợi ý nạp tiền ───────────────────────────────────────────────────
checkoutScene.action('checkout:deposit_hint', async (ctx) => {
    await ctx.answerCbQuery(`💡 Số dư ví không đủ! Vui lòng nạp thêm tiền.`, { show_alert: true });
});
checkoutScene.action('back:main', async (ctx) => {
    await ctx.answerCbQuery();
    return ctx.scene.enter(SCENES.MAIN_MENU);
});
checkoutScene.action('noop', (ctx) => ctx.answerCbQuery());
