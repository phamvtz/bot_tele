import { Scenes } from 'telegraf';
import { SCENES } from '../context.js';
import { Messages } from '../ui/messages.js';
import { Keyboards } from '../ui/keyboards.js';
import { OrderService } from '../../modules/order/OrderService.js';
import { OrderService as OrderSvc } from '../../modules/order/OrderService.js';
import { PaymentService } from '../../modules/payment/PaymentService.js';
import { NotificationService } from '../../modules/notification/NotificationService.js';
import prisma from '../../infrastructure/db.js';
const BANK_CODE = process.env.BANK_ID ?? 'MB';
const BANK_ACCOUNT = process.env.BANK_ACCOUNT_NO ?? '321336';
const BANK_NAME = process.env.BANK_ACCOUNT_NAME ?? 'PHAM VAN VIET';
export const checkoutScene = new Scenes.BaseScene(SCENES.CHECKOUT);
// ── Enter: Xác nhận đơn hàng ─────────────────────────────────────────────────
checkoutScene.enter(async (ctx) => {
    const cart = ctx.session.cart;
    if (!cart) {
        if (ctx.callbackQuery) {
            await ctx.answerCbQuery('❌ Phiên hết hạn, vui lòng chọn lại!', { show_alert: true }).catch(() => { });
            await ctx.editMessageText('❌ Phiên mua hàng hết hạn.', { reply_markup: Keyboards.backOnly('SHOP') }).catch(() => { });
        }
        return ctx.scene.enter(SCENES.SHOP);
    }
    const walletBalance = ctx.user.wallet?.balance ?? 0;
    try {
        const order = await OrderService.createPendingOrder(ctx.user.id, cart.productId, cart.quantity, 'WALLET');
        ctx.session.pendingOrderId = order.id;
        ctx.session.pendingOrderCode = order.orderCode;
        ctx.session.pendingOrderAmount = order.finalAmount;
        const text = Messages.checkoutSummary({ ...order, items: [{ quantity: cart.quantity, productNameSnapshot: cart.productName }] }, cart.productName, order.discountAmount, 0);
        const keyboard = Keyboards.checkout(order.id, walletBalance, order.finalAmount, cart.productId);
        const reply = ctx.callbackQuery
            ? ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: keyboard })
            : ctx.reply(text, { parse_mode: 'HTML', reply_markup: keyboard });
        await reply;
        await ctx.answerCbQuery().catch(() => { });
    }
    catch (err) {
        const msg = err instanceof Error ? err.message : 'Lỗi tạo đơn hàng';
        if (ctx.callbackQuery) {
            await ctx.editMessageText(`❌ ${msg}`, { reply_markup: Keyboards.backOnly('SHOP') }).catch(() => { });
        }
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
        // Kiểm tra loại sản phẩm để chia nhánh
        const product = await prisma.product.findUnique({ where: { id: paidOrder.productId } });
        const isAutoDelivery = product?.productType === 'AUTO_DELIVERY';
        if (isAutoDelivery) {
            // ── Sản phẩm mã/code: hiển thị mã ngay ──────────────────────────────
            const deliveredItems = await OrderSvc.getOrderWithDeliveredItems(paidOrder.id);
            const text = Messages.paymentSuccess(paidOrder, deliveredItems);
            await ctx.editMessageText(text, {
                parse_mode: 'HTML',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '📦 Xem Đơn Hàng', callback_data: 'scene:ORDERS' }],
                        [{ text: '🛒 Mua Tiếp', callback_data: 'scene:SHOP' }],
                        [{ text: '🎧 Báo Lỗi', callback_data: `support:new:${paidOrder.id}` }],
                    ],
                },
            });
        }
        else {
            // ── Đơn dịch vụ: hướng dẫn liên hệ admin ────────────────────────────
            const adminLink = process.env.ADMIN_USERNAME
                ? `https://t.me/${process.env.ADMIN_USERNAME.replace('@', '')}`
                : null;
            const text = `✅ <b>THANH TOÁN THÀNH CÔNG!</b>\n` +
                `━━━━━━━━━━━━━━━━━━━━\n` +
                `📦 Sản phẩm: <b>${product?.name ?? ''}</b>\n` +
                `🧾 Mã đơn: <code>${paidOrder.orderCode}</code>\n` +
                `💰 Số tiền: <b>${paidOrder.finalAmount.toLocaleString('vi-VN')}đ</b>\n` +
                `━━━━━━━━━━━━━━━━━━━━\n` +
                `📋 <b>BƯỚC TIẾP THEO:</b>\n` +
                `Đây là đơn <b>dịch vụ thủ công</b>.\n` +
                `👇 Copy tin nhắn bên dưới và gửi cho admin:\n\n` +
                `<code>🛒 ĐƠN DỊCH VỤ\n` +
                `Sản phẩm: ${product?.name ?? ''}\n` +
                `Mã đơn: ${paidOrder.orderCode}\n` +
                `Số tiền: ${paidOrder.finalAmount.toLocaleString('vi-VN')}đ</code>\n\n` +
                `<i>⏱ Admin xử lý trong 5-30 phút.</i>`;
            await ctx.editMessageText(text, {
                parse_mode: 'HTML',
                reply_markup: {
                    inline_keyboard: [
                        ...(adminLink ? [[{ text: '💬 Nhắn Admin Ngay', url: adminLink }]] : []),
                        [{ text: '📦 Xem Đơn Hàng', callback_data: 'scene:ORDERS' }],
                        [{ text: '🛒 Mua Tiếp', callback_data: 'scene:SHOP' }],
                    ],
                },
            });
            // Ping admin (non-fatal)
            try {
                await NotificationService.sendToAdmins(`🔔 <b>ĐƠN DỊCH VỤ CẦN XỬ LÝ!</b>\n` +
                    `━━━━━━━━━━━━━━━━━━━━\n` +
                    `📦 SP: <b>${product?.name ?? ''}</b>\n` +
                    `🧾 Mã đơn: <code>${paidOrder.orderCode}</code>\n` +
                    `👤 User: <code>${ctx.user.telegramId}</code>` +
                    `${ctx.from.username ? ` | @${ctx.from.username}` : ''}\n` +
                    `💰 Đã TT: <b>${paidOrder.finalAmount.toLocaleString('vi-VN')}đ</b> (Ví)\n` +
                    `<i>⚡ Liên hệ user để xử lý!</i>`);
            }
            catch { /* non-fatal */ }
        }
        // Xóa cart session
        ctx.session.cart = undefined;
        ctx.session.pendingOrderId = undefined;
    }
    catch (err) {
        const msg = err instanceof Error ? err.message : 'Lỗi thanh toán';
        await ctx.editMessageText(`❌ <b>THANH TOÁN THẤT BẠI</b>\n\nLý do: ${msg}`, {
            parse_mode: 'HTML',
            reply_markup: Keyboards.backOnly('ORDERS'),
        });
    }
});
// ── Action: Thanh toán QR trực tiếp (ORDER_PAYMENT) ─────────────────────────
checkoutScene.action(/^pay:qr:(.+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const orderId = ctx.match[1];
    try {
        const order = await prisma.order.findUnique({ where: { id: orderId } });
        if (!order)
            return ctx.reply('❌ Đơn hàng không tồn tại.');
        const request = await PaymentService.createOrderPaymentRequest(ctx.user.id, orderId, order.finalAmount);
        const expireTime = request.expiresAt.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
        const amount = order.finalAmount;
        const qrUrl = `https://img.vietqr.io/image/${BANK_CODE}-${BANK_ACCOUNT}-compact2.png?amount=${amount}&addInfo=${encodeURIComponent(request.transferContent)}&accountName=${encodeURIComponent(BANK_NAME)}`;
        const text = `🏦 <b>THANH TOÁN CHUYỂN KHOẢN</b>\n\n` +
            `🏦 Ngân hàng: <b>${BANK_CODE}</b>\n` +
            `🏧 STK: <code>${BANK_ACCOUNT}</code>\n` +
            `👤 Chủ TK: <b>${BANK_NAME}</b>\n\n` +
            `💰 Số tiền: <b>${amount.toLocaleString('vi-VN')}đ</b>\n` +
            `📝 Nội dung CK: <code>${request.transferContent}</code>\n` +
            `⚠️ <b>BẮT BUỘC GHI ĐÚNG NỘI DUNG!</b>\n\n` +
            `🖼️ <a href="${qrUrl}">Bấm vào đây để mở QR Code</a>\n\n` +
            `⏳ Hết hạn lúc: <b>${expireTime}</b>\n` +
            `<i>Sau khi CK, đơn sẽ tự giao trong 1-3 phút.</i>`;
        await ctx.editMessageText(text, {
            parse_mode: 'HTML',
            link_preview_options: { is_disabled: false, prefer_small_media: true, show_above_text: true, url: qrUrl },
            reply_markup: {
                inline_keyboard: [
                    [{ text: '🔄 Kiểm tra trạng thái', callback_data: `checkout:qr:check:${request.id}` }],
                    [{ text: '❌ Hủy đơn hàng', callback_data: `order:cancel:${orderId}` }],
                ],
            },
        });
    }
    catch (err) {
        const msg = err instanceof Error ? err.message : 'Lỗi tạo QR';
        await ctx.editMessageText(`❌ ${msg}`, { reply_markup: Keyboards.backOnly('CHECKOUT') }).catch(() => { });
    }
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
// ── Action: Kiểm tra trạng thái ORDER_PAYMENT ────────────────────────────────
checkoutScene.action(/^checkout:qr:check:(.+)$/, async (ctx) => {
    const requestId = ctx.match[1];
    const request = await prisma.paymentRequest.findUnique({ where: { id: requestId } });
    if (!request)
        return ctx.answerCbQuery('❌ Không tìm thấy yêu cầu.', { show_alert: true });
    if (request.status === 'PAID') {
        await ctx.answerCbQuery('✅ Đã nhận tiền! Đang giao sản phẩm...');
    }
    else if (request.status === 'EXPIRED') {
        await ctx.answerCbQuery('⏰ Yêu cầu đã hết hạn.', { show_alert: true });
    }
    else {
        await ctx.answerCbQuery('⏳ Chưa nhận được tiền. Vui lòng đợi 1-3 phút.', { show_alert: true });
    }
});
// ── Action: Gợi ý khi số dư không đủ ────────────────────────────────────────
checkoutScene.action('checkout:deposit_hint', async (ctx) => {
    await ctx.answerCbQuery();
    const orderId = ctx.session.pendingOrderId;
    const amount = ctx.session.pendingOrderAmount ?? 0;
    const walletBalance = ctx.user.wallet?.balance ?? 0;
    const need = amount - walletBalance;
    const text = `❌ <b>Số dư ví không đủ!</b>\n` +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        `💼 Số dư hiện tại: <b>${walletBalance.toLocaleString('vi-VN')}đ</b>\n` +
        `💰 Cần thanh toán: <b>${amount.toLocaleString('vi-VN')}đ</b>\n` +
        `➡️ Cần nạp thêm: <b>${need.toLocaleString('vi-VN')}đ</b>\n` +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        `Chọn phương thức thanh toán:`;
    await ctx.editMessageText(text, {
        parse_mode: 'HTML',
        reply_markup: {
            inline_keyboard: [
                [{ text: '🏦 Chuyển khoản trực tiếp', callback_data: orderId ? `pay:qr:${orderId}` : 'noop' }],
                [{ text: '💳 Nạp tiền vào ví trước', callback_data: 'scene:DEPOSIT' }],
                [{ text: '⬅️ Quay lại đơn hàng', callback_data: 'back:CHECKOUT' }],
            ],
        },
    }).catch(() => ctx.reply(text, { parse_mode: 'HTML' }));
});
checkoutScene.action('back:CHECKOUT', async (ctx) => {
    await ctx.answerCbQuery();
    return ctx.scene.reenter();
});
checkoutScene.action('back:main', async (ctx) => {
    await ctx.answerCbQuery();
    return ctx.scene.enter(SCENES.MAIN_MENU);
});
checkoutScene.action('noop', (ctx) => ctx.answerCbQuery());
