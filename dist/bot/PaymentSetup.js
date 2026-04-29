import { OrderService } from '../modules/order/OrderService.js';
import { UserService } from '../modules/user/UserService.js';
import prisma from '../infrastructure/db.js';
import crypto from 'crypto';
export function setupPaymentHandlers(bot) {
    // Action: pay_wallet_{orderId}
    bot.action(/^pay_wallet_(.+)$/, async (ctx) => {
        try {
            const telegramId = ctx.from?.id.toString();
            if (!telegramId)
                return;
            // @ts-ignore
            const orderId = ctx.match[1];
            const user = await UserService.getUserWithWallet(telegramId);
            if (!user)
                return ctx.answerCbQuery('Bạn chưa đăng ký!');
            await ctx.editMessageText('🔄 Đang xử lý thanh toán ví...');
            // Gọi logic gạch nợ an toàn
            const paidOrder = await OrderService.payWithWallet(orderId, user.id);
            ctx.editMessageText(`✅ **THANH TOÁN THÀNH CÔNG**\n\nMã đơn: \`${paidOrder.orderCode}\`\nSố tiền: ${paidOrder.finalAmount.toLocaleString('vi-VN')}đ\n\nSản phẩm đã được hệ thống ghi nhận. Vui lòng kiểm tra mục 📦 Đơn hàng.`, { parse_mode: 'Markdown' });
        }
        catch (error) {
            console.error(error);
            const errMsg = error.message || 'Lỗi thanh toán';
            ctx.editMessageText(`❌ **THANH TOÁN THẤT BẠI**\n\nLý do: ${errMsg}`);
        }
    });
    // Action: pay_qr_{orderId} 
    bot.action(/^pay_qr_(.+)$/, async (ctx) => {
        try {
            const telegramId = ctx.from?.id.toString();
            if (!telegramId)
                return;
            // @ts-ignore
            const orderId = ctx.match[1];
            const user = await UserService.getUserWithWallet(telegramId);
            if (!user)
                return ctx.answerCbQuery('Bạn chưa đăng ký!');
            // Find order to get amount
            const order = await prisma.order.findUnique({ where: { id: orderId } });
            if (!order)
                return ctx.answerCbQuery('Không tìm thấy đơn hàng!');
            // BUG FIX: verify order belongs to the requesting user
            if (order.userId !== user.id)
                return ctx.answerCbQuery('Đơn hàng không thuộc về bạn!');
            if (order.status !== 'PENDING_PAYMENT')
                return ctx.answerCbQuery('Đơn hàng không ở trạng thái chờ thanh toán!');
            // BUG FIX: Create ORDER_PAYMENT request directly in one step (not DEPOSIT → patch)
            const transferContent = `BOT${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
            const requestCode = `REQ-${Date.now().toString().slice(-6)}`;
            const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 phút (theo reservedUntil)
            const request = await prisma.paymentRequest.create({
                data: {
                    requestCode,
                    userId: user.id,
                    orderId: order.id,
                    type: 'ORDER_PAYMENT',
                    amount: order.finalAmount,
                    transferContent,
                    expiresAt,
                    status: 'PENDING'
                }
            });
            // Thông tin ngân hàng — ưu tiên env, fallback về thông tin mặc định
            const bankId = process.env.BANK_ID || 'MB';
            const accountNo = process.env.BANK_ACCOUNT_NO || '321336';
            const accountName = process.env.BANK_ACCOUNT_NAME || 'PHAM VAN VIET';
            const amount = order.finalAmount;
            const content = request.transferContent;
            const qrUrl = `https://img.vietqr.io/image/${bankId}-${accountNo}-compact2.png?amount=${amount}&addInfo=${encodeURIComponent(content)}&accountName=${encodeURIComponent(accountName)}`;
            await ctx.editMessageText(`🏦 *Thanh Toán Chuyển Khoản*\n`
                + `${'━'.repeat(28)}\n`
                + `🏦 Ngân hàng: *${bankId}*\n`
                + `🏧 STK: \`${accountNo}\`\n`
                + `👤 Chủ TK: *${accountName}*\n`
                + `${'━'.repeat(28)}\n`
                + `💰 Số tiền: *${amount.toLocaleString('vi-VN')}đ*\n`
                + `📝 Nội dung CK: \`${content}\`\n`
                + `⚠️ *BẮT BUỘC GHI ĐÚNG NỘI DUNG!*\n`
                + `${'━'.repeat(28)}\n`
                + `⏳ Hết hạn lúc: ${order.reservedUntil?.toLocaleTimeString('vi-VN')}\n`
                + `_Hệ thống tự đối soát sau 1-3 phút khi nhận được tiền._`, { parse_mode: 'Markdown' });
            await ctx.replyWithPhoto(qrUrl);
        }
        catch (error) {
            console.error(error);
            ctx.answerCbQuery('Lỗi tạo QR!');
        }
    });
    // Action: cancel_order_{orderId}
    bot.action(/^cancel_order_(.+)$/, async (ctx) => {
        try {
            // @ts-ignore
            const orderId = ctx.match[1];
            await OrderService.cancelOrder(orderId, 'USER_CANCELLED');
            ctx.editMessageText('✅ Đơn hàng đã được hủy thành công. Hàng tồn kho đã được hoàn trả.');
        }
        catch (error) {
            ctx.answerCbQuery('Lỗi hủy đơn');
        }
    });
}
