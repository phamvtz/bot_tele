import { Scenes } from 'telegraf';
import { SCENES } from '../../context.js';
import { Keyboards } from '../../ui/keyboards.js';
import { OrderService } from '../../../modules/order/OrderService.js';
import prisma from '../../../infrastructure/db.js';
const PAGE_SIZE = 8;
export const adminOrderScene = new Scenes.BaseScene(SCENES.ADMIN_ORDERS);
// ── Helper ──────────────────────────────────────────────────────────────────
function vnd(n) { return n.toLocaleString('vi-VN') + 'đ'; }
const STATUS_MAP = {
    PENDING_PAYMENT: '⏳ Chờ thanh toán',
    PAID: '💸 Đã thanh toán',
    PROCESSING: '⚙️ Đang xử lý',
    DELIVERED: '🚚 Đã giao hàng',
    COMPLETED: '✅ Hoàn tất',
    CANCELLED: '❌ Đã hủy',
    FAILED: '⚠️ Thất bại',
    REFUNDED: '🔙 Đã hoàn tiền',
};
// ── Enter: Danh sách đơn hàng ──────────────────────────────────────────────
adminOrderScene.enter(async (ctx) => {
    if (ctx.callbackQuery)
        await ctx.answerCbQuery().catch(() => { });
    const page = 0;
    const { orders, total, totalPages } = await OrderService.getAllOrdersPaginated(page, PAGE_SIZE);
    // Thống kê nhanh
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const [todayCount, pendingCount, completedCount] = await Promise.all([
        prisma.order.count({ where: { createdAt: { gte: todayStart } } }),
        prisma.order.count({ where: { status: 'PENDING_PAYMENT' } }),
        prisma.order.count({ where: { status: 'COMPLETED' } }),
    ]);
    const text = `📦 <b>QUẢN LÝ ĐƠN HÀNG</b>\n\n` +
        `📊 <b>Tổng quan</b>\n` +
        `├ Tổng đơn: <b>${total}</b>\n` +
        `├ Hôm nay: <b>${todayCount}</b>\n` +
        `├ Chờ thanh toán: <b>${pendingCount}</b>\n` +
        `└ Hoàn tất: <b>${completedCount}</b>\n\n` +
        `📋 Trang ${page + 1}/${Math.max(totalPages, 1)} — Bấm đơn để xem chi tiết`;
    const keyboard = Keyboards.adminOrders(orders, page, Math.max(totalPages, 1));
    if (ctx.callbackQuery) {
        await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: keyboard })
            .catch(() => ctx.reply(text, { parse_mode: 'HTML', reply_markup: keyboard }));
    }
    else {
        await ctx.reply(text, { parse_mode: 'HTML', reply_markup: keyboard });
    }
});
// ── Action: Phân trang ──────────────────────────────────────────────────────
adminOrderScene.action(/^admin:order:page:(\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const page = parseInt(ctx.match[1], 10);
    const { orders, total, totalPages } = await OrderService.getAllOrdersPaginated(page, PAGE_SIZE);
    const text = `📦 <b>QUẢN LÝ ĐƠN HÀNG</b>\n\n` +
        `📋 Trang ${page + 1}/${Math.max(totalPages, 1)} — Tổng: ${total} đơn`;
    await ctx.editMessageText(text, {
        parse_mode: 'HTML',
        reply_markup: Keyboards.adminOrders(orders, page, Math.max(totalPages, 1)),
    });
});
// ── Action: Xem chi tiết đơn hàng ──────────────────────────────────────────
adminOrderScene.action(/^admin:order:detail:(.+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const orderId = ctx.match[1];
    const [order, deliveredItems] = await Promise.all([
        prisma.order.findUnique({
            where: { id: orderId },
            include: { user: true, items: true, product: true },
        }),
        prisma.deliveredItem.findMany({
            where: { orderId },
            include: { orderItem: true },
        }),
    ]);
    if (!order) {
        return ctx.answerCbQuery('❌ Đơn hàng không tồn tại!', { show_alert: true });
    }
    const userText = order.user
        ? `${order.user.firstName || ''} ${order.user.lastName || ''}`.trim() + (order.user.username ? ` (@${order.user.username})` : '')
        : 'Ẩn danh';
    const itemsText = order.items.map(i => {
        const deliveryStatus = i.deliveryStatus === 'DELIVERED' ? '✅' : (i.deliveryStatus === 'FAILED' ? '❌' : '⏳');
        return `   ${deliveryStatus} ${i.productNameSnapshot} × ${i.quantity} — ${vnd(i.unitPrice * i.quantity)}`;
    }).join('\n');
    const status = STATUS_MAP[order.status] ?? order.status;
    const hasDelivered = deliveredItems.length > 0;
    let text = `🧾 <b>CHI TIẾT ĐƠN HÀNG</b>\n\n` +
        `📋 <b>Thông tin đơn</b>\n` +
        `├ Mã đơn: <code>${order.orderCode}</code>\n` +
        `├ Trạng thái: ${status}\n` +
        `├ Phương thức: <b>${order.paymentMethod ?? 'N/A'}</b>\n` +
        `└ Ngày tạo: ${order.createdAt.toLocaleString('vi-VN')}\n\n` +
        `👤 <b>Khách hàng</b>\n` +
        `├ Tên: <b>${userText}</b>\n` +
        `└ Telegram ID: <code>${order.user?.telegramId ?? 'N/A'}</code>\n\n` +
        `📦 <b>Sản phẩm</b>\n` +
        `${itemsText}\n\n` +
        `💰 <b>Thanh toán</b>\n` +
        `├ Tạm tính: ${vnd(order.subtotalAmount)}\n` +
        `├ Giảm giá: -${vnd(order.discountAmount)}\n` +
        `└ Tổng cộng: <b>${vnd(order.finalAmount)}</b>`;
    // Hiển thị dữ liệu sản phẩm đã giao trực tiếp
    if (hasDelivered) {
        text += `\n\n🔑 <b>Dữ liệu đã giao (${deliveredItems.length} item)</b>\n`;
        deliveredItems.forEach((d, i) => {
            const name = d.orderItem?.productNameSnapshot ?? `Item ${i + 1}`;
            // Truncate nếu quá dài (Telegram giới hạn 4096 ký tự)
            const content = d.deliveredContent.length > 200
                ? d.deliveredContent.substring(0, 200) + '...'
                : d.deliveredContent;
            text += `\n📎 <b>${name}</b>\n<code>${content}</code>\n`;
        });
    }
    await ctx.editMessageText(text, {
        parse_mode: 'HTML',
        reply_markup: Keyboards.adminOrderDetail(orderId, order.status, hasDelivered),
    });
});
// ── Action: Xem Product Keys ──────────────────────────────────────────────
adminOrderScene.action(/^admin:order:keys:(.+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const orderId = ctx.match[1];
    const keys = await OrderService.getOrderWithDeliveredItems(orderId);
    if (keys.length === 0) {
        return ctx.answerCbQuery('❌ Chưa có dữ liệu giao hàng.', { show_alert: true });
    }
    const texts = keys.map((k, i) => `📦 <b>Item ${i + 1}</b> — ${k.orderItem?.productNameSnapshot ?? 'N/A'}\n<pre>${k.deliveredContent}</pre>`);
    await ctx.editMessageText(`🔑 <b>DỮ LIỆU ĐÃ GIAO</b>\n\n${texts.join('\n\n')}`, {
        parse_mode: 'HTML',
        reply_markup: {
            inline_keyboard: [
                [{ text: '🔙 Quay lại chi tiết', callback_data: `admin:order:detail:${orderId}` }],
            ],
        },
    });
});
// ── Action: Hủy / Hoàn tiền ────────────────────────────────────────────────
adminOrderScene.action(/^admin:order:refund:(.+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const orderId = ctx.match[1];
    try {
        await OrderService.cancelOrder(orderId, 'ADMIN_REFUND');
        await ctx.editMessageText(`✅ <b>Đã hủy đơn & hoàn tiền thành công!</b>\n\nĐơn hàng: <code>${orderId}</code>`, {
            parse_mode: 'HTML',
            reply_markup: {
                inline_keyboard: [
                    [{ text: '🔙 Quay lại danh sách', callback_data: 'back:ADMIN_ORDERS' }],
                ],
            },
        });
    }
    catch (err) {
        await ctx.answerCbQuery(`❌ ${err.message ?? 'Lỗi hoàn tiền'}`, { show_alert: true });
    }
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
