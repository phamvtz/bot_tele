import { ProductService } from '../modules/product/ProductService.js';
import { OrderService } from '../modules/order/OrderService.js';
import { UserService } from '../modules/user/UserService.js';
export function setupShopHandlers(bot) {
    // Hiển thị danh sách sản phẩm
    bot.action('menu_shop', async (ctx) => {
        try {
            const { products } = await ProductService.listActiveProducts();
            if (products.length === 0) {
                return ctx.editMessageText('🛒 Hiện tại shop chưa có sản phẩm nào.', {
                    reply_markup: {
                        inline_keyboard: [[{ text: '⬅️ Quay lại', callback_data: 'menu_main' }]]
                    }
                });
            }
            const keyboard = products.map(p => [
                {
                    text: `${p.name} - ${p.basePrice.toLocaleString('vi-VN')}đ ${p.stockMode !== 'UNLIMITED' ? `(Kho: ${p.stockCount})` : ''}`,
                    callback_data: `view_prod_${p.id}`
                }
            ]);
            keyboard.push([{ text: '⬅️ Quay lại', callback_data: 'menu_main' }]);
            await ctx.editMessageText('🛒 **Danh mục sản phẩm**\n\nVui lòng chọn sản phẩm bạn muốn xem:', {
                parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: keyboard }
            });
        }
        catch (error) {
            console.error(error);
            ctx.answerCbQuery('Lỗi lấy danh sách sản phẩm!');
        }
    });
    // Xem chi tiết sản phẩm
    bot.action(/^view_prod_(.+)$/, async (ctx) => {
        try {
            // @ts-ignore
            const productId = ctx.match[1];
            const product = await ProductService.getProductDetail(productId);
            if (!product)
                return ctx.answerCbQuery('Không tìm thấy sản phẩm!');
            let text = `📦 **${product.name}**\n\n`;
            if (product.shortDescription)
                text += `📝 ${product.shortDescription}\n\n`;
            text += `💰 Giá: **${product.basePrice.toLocaleString('vi-VN')}đ**\n`;
            if (product.vipPrice) {
                text += `💎 Giá VIP: **${product.vipPrice.toLocaleString('vi-VN')}đ**\n`;
            }
            text += `\n📦 Tồn kho: ${product.stockMode === 'UNLIMITED' ? 'Vô hạn' : product.stockCount}\n`;
            text += `Trạng thái: ${product.isActive ? '✅ Đang bán' : '❌ Ngừng bán'}\n`;
            const keyboard = [
                [{ text: '💳 Mua Ngay (1)', callback_data: `buy_prod_${product.id}_1` }],
            ];
            // Nếu cho mua nhiều, hiện thêm nút
            if (product.maxQty > 1) {
                keyboard.push([{ text: '💳 Mua số lượng khác (Đang phát triển)', callback_data: 'dummy' }]);
            }
            keyboard.push([{ text: '⬅️ Quay lại Shop', callback_data: 'menu_shop' }]);
            await ctx.editMessageText(text, {
                parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: keyboard }
            });
        }
        catch (error) {
            console.error(error);
            ctx.answerCbQuery('Lỗi hiển thị sản phẩm');
        }
    });
    // Bấm nút Mua Ngay
    bot.action(/^buy_prod_(.+)_(.+)$/, async (ctx) => {
        try {
            const telegramId = ctx.from?.id.toString();
            if (!telegramId)
                return;
            // @ts-ignore
            const productId = ctx.match[1];
            // @ts-ignore
            const qty = parseInt(ctx.match[2], 10);
            const user = await UserService.getUserWithWallet(telegramId);
            if (!user)
                return ctx.answerCbQuery('Lỗi: Bạn chưa đăng ký!');
            // Tạo Pending Order (Đã gộp luôn bước reserve kho bên trong OrderService)
            const order = await OrderService.createPendingOrder(user.id, productId, qty, 'WALLET');
            const text = `🧾 **HÓA ĐƠN XÁC NHẬN**\n\n`
                + `Mã đơn: \`${order.orderCode}\`\n`
                + `Số lượng: ${qty}\n`
                + `Tổng thanh toán: **${order.finalAmount.toLocaleString('vi-VN')}đ**\n\n`
                + `⏳ Đơn hàng sẽ hết hạn vào: ${order.reservedUntil?.toLocaleTimeString('vi-VN')}\n\n`
                + `Vui lòng chọn phương thức thanh toán:`;
            await ctx.editMessageText(text, {
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: `Thanh toán bằng Ví (${user.wallet?.balance.toLocaleString('vi-VN')}đ)`, callback_data: `pay_wallet_${order.id}` }],
                        [{ text: 'Thanh toán Chuyển khoản (QR)', callback_data: `pay_qr_${order.id}` }],
                        [{ text: '❌ Hủy đơn', callback_data: `cancel_order_${order.id}` }]
                    ]
                }
            });
        }
        catch (error) {
            console.error(error);
            ctx.answerCbQuery(error.message || 'Lỗi khi tạo đơn hàng!', { show_alert: true });
        }
    });
}
