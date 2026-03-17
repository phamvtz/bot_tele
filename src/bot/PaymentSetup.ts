import { Telegraf, Context, Markup } from 'telegraf';
import { OrderService } from '../modules/order/OrderService.js';
import { PaymentService } from '../modules/payment/PaymentService.js';
import { UserService } from '../modules/user/UserService.js';
import prisma from '../infrastructure/db.js';

export function setupPaymentHandlers(bot: Telegraf<Context>) {

  // Action: pay_wallet_{orderId}
  bot.action(/^pay_wallet_(.+)$/, async (ctx) => {
    try {
      const telegramId = ctx.from?.id.toString();
      if (!telegramId) return;

      // @ts-ignore
      const orderId = ctx.match[1];

      const user = await UserService.getUserWithWallet(telegramId);
      if (!user) return ctx.answerCbQuery('Bạn chưa đăng ký!');

      await ctx.editMessageText('🔄 Đang xử lý thanh toán ví...');

      // Gọi logic gạch nợ an toàn
      const paidOrder = await OrderService.payWithWallet(orderId, user.id);

      ctx.editMessageText(`✅ **THANH TOÁN THÀNH CÔNG**\n\nMã đơn: \`${paidOrder.orderCode}\`\nSố tiền: ${paidOrder.finalAmount.toLocaleString('vi-VN')}đ\n\nSản phẩm đã được hệ thống ghi nhận. Vui lòng kiểm tra mục 📦 Đơn hàng.`, { parse_mode: 'Markdown' });

    } catch (error: any) {
      console.error(error);
      const errMsg = error.message || 'Lỗi thanh toán';
      ctx.editMessageText(`❌ **THANH TOÁN THẤT BẠI**\n\nLý do: ${errMsg}`);
    }
  });

  // Action: pay_qr_{orderId} 
  bot.action(/^pay_qr_(.+)$/, async (ctx) => {
    try {
      const telegramId = ctx.from?.id.toString();
      if (!telegramId) return;

      // @ts-ignore
      const orderId = ctx.match[1];

      const user = await UserService.getUserWithWallet(telegramId);
      if (!user) return ctx.answerCbQuery('Bạn chưa đăng ký!');

      // Find order to get amount
      const order = await prisma.order.findUnique({ where: { id: orderId } });
      
      if (!order) return ctx.answerCbQuery('Không tìm thấy đơn hàng!');
      if (order.status !== 'PENDING_PAYMENT') return ctx.answerCbQuery('Đơn hàng không ở trạng thái chờ thanh toán!');

      // Tạo Payment Request
      const request = await PaymentService.createDepositRequest(user.id, order.finalAmount);
      
      // Update order to link this request
      await prisma.paymentRequest.update({
        where: { id: request.id },
        data: {
          type: 'ORDER_PAYMENT',
          orderId: order.id
        }
      });

      // Tạo link mã QR VietQR (Dùng template API của vietqr.io)
      const bankId = 'MB'; // Lấy từ Settings
      const accountNo = '0123456789'; // Lấy từ Settings
      const accountName = 'SHOP_ADMIN'; // Lấy từ Settings
      const amount = order.finalAmount;
      const content = request.transferContent;
      
      const qrUrl = `https://img.vietqr.io/image/${bankId}-${accountNo}-compact.png?amount=${amount}&addInfo=${content}&accountName=${accountName}`;

      await ctx.editMessageText(`🏦 **Nạp Tiền / Thanh Toán QR**\n\n`
                              + `Vui lòng chuyển khoản với thông tin sau:\n`
                              + `Ngân hàng: **${bankId}**\n`
                              + `STK: \`${accountNo}\`\n`
                              + `Số tiền: **${amount.toLocaleString('vi-VN')}đ**\n`
                              + `Nội dung CK: \`${content}\` (BẮT BUỘC CHÍNH XÁC)\n\n`
                              + `⏳ Hệ thống sẽ tự động đối soát sau 1-3 phút.`, 
        { parse_mode: 'Markdown' }
      );
      
      await ctx.replyWithPhoto(qrUrl);
      
    } catch (error: any) {
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
      } catch(error) {
        ctx.answerCbQuery('Lỗi hủy đơn');
      }
  });
}
