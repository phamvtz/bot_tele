import { Telegraf, Context, Markup } from 'telegraf';
import prisma from '../infrastructure/db.js';
import { UserService } from '../modules/user/UserService.js';

export function setupOrderHandlers(bot: Telegraf<Context>) {
  
  // Hiển thị Lịch sử đơn hàng
  bot.action('menu_orders', async (ctx) => {
    try {
      const telegramId = ctx.from?.id.toString();
      if (!telegramId) return;

      const user = await UserService.getUserWithWallet(telegramId);
      if (!user) return ctx.answerCbQuery('Bạn chưa đăng ký!');

      const orders = await prisma.order.findMany({
        where: { userId: user.id },
        orderBy: { createdAt: 'desc' },
        take: 5,
        include: { items: true }
      });

      if (orders.length === 0) {
        return ctx.editMessageText('📦 Bạn chưa có đơn hàng nào.', {
          reply_markup: { inline_keyboard: [[{ text: '⬅️ Quay lại', callback_data: 'menu_main' }]] }
        });
      }

      let text = '📦 **Lịch sử 5 đơn hàng gần nhất**\n\n';
      orders.forEach((o: any, i: number) => {
        text += `${i + 1}. \`${o.orderCode}\` - **${o.finalAmount.toLocaleString('vi-VN')}đ**\n`;
        text += `Trạng thái: ${getStatusText(o.status)}\n`;
        text += `Sản phẩm: ${o.items.map((it: any) => it.productNameSnapshot).join(', ')}\n\n`;
      });

      // Nếu đơn có trạng thái DELIVERED/COMPLETED, cho phép xem chi tiết lấy Key/Code
      const keyboard = orders
        .filter((o: any) => o.status === 'COMPLETED' || o.status === 'DELIVERED')
        .map((o: any) => [{ text: `🔑 Xem kho/Code đơn ${o.orderCode}`, callback_data: `view_delivery_${o.id}` }]);

      keyboard.push([{ text: '⬅️ Quay lại', callback_data: 'menu_main' }]);

      await ctx.editMessageText(text, {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: keyboard }
      });

    } catch (error) {
      console.error(error);
      ctx.answerCbQuery('Lỗi lấy lịch sử đơn hàng!');
    }
  });

  // Xem chi tiết hàng đã giao
  bot.action(/^view_delivery_(.+)$/, async (ctx) => {
     try {
        // @ts-ignore
        const orderId = ctx.match[1];

        const deliveredItems = await prisma.deliveredItem.findMany({
          where: { orderId },
          include: { orderItem: true }
        });

        if (deliveredItems.length === 0) return ctx.answerCbQuery('Đơn này chưa có dữ liệu giao hàng hoặc là dịch vụ.');

        let text = '🔑 **Dữ liệu đơn hàng của bạn:**\n\n';
        deliveredItems.forEach((item: any) => {
           text += `Sản phẩm: ${item.orderItem.productNameSnapshot}\n`;
           text += `Nội dung: \`${item.deliveredContent}\`\n\n`;
        });

        await ctx.replyWithMarkdown(text);
        ctx.answerCbQuery('Đã gửi thông tin!');

     } catch (error) {
        console.error(error);
        ctx.answerCbQuery('Lỗi lấy dữ liệu giao hàng!');
     }
  });
}

function getStatusText(status: string) {
  switch(status) {
    case 'PENDING_PAYMENT': return '⏳ Chờ thanh toán';
    case 'PAID': return '💸 Đã thanh toán (Chờ giao)';
    case 'PROCESSING': return '⚙️ Đang xử lý';
    case 'DELIVERED': return '🚚 Đã giao';
    case 'COMPLETED': return '✅ Hoàn tất';
    case 'CANCELLED': return '❌ Đã hủy';
    case 'FAILED': return '⚠️ Lỗi';
    case 'REFUNDED': return '🔙 Đã hoàn tiền';
    default: return status;
  }
}
