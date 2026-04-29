import { Telegraf, Context, Markup } from 'telegraf';
import { AdminService } from '../modules/admin/AdminService.js';
import prisma from '../infrastructure/db.js';

// ID Admin (In a real app, check DB for user role)
const ADMIN_IDS = ['ADMIN_ID_TBD']; // We can check process.env.ADMIN_ID later

export function setupAdminHandlers(bot: Telegraf<Context>) {

  // Lệnh /admin
  bot.command('admin', async (ctx) => {
    // In production, verify ctx.from.id is in ADMIN_IDS or Admin DB
    await ctx.reply('⚙️ **BẢNG ĐIỀU KHIỂN QUẢN TRỊ**\n\n_Các lệnh hỗ trợ hiện tại:_\n📍 Lấy danh sách sản phẩm: `/admin_products`\n📍 Cộng tiền: `/admin_add_balance <user_id> <số_tiền>`\n📍 Nạp kho: `/admin_nhapkho <product_id> <nội_dung_từng_dòng>`', {
      parse_mode: 'Markdown'
    });
  });

  bot.command('admin_products', async (ctx) => {
    const products = await prisma.product.findMany();
    let text = '📦 **DANH SÁCH SẢN PHẨM**\n\n';
    products.forEach((p: any, i: number) => {
      text += `ID: \`${p.id}\`\nTên: **${p.name}**\nGiá: ${p.basePrice}đ\nKho: ${p.stockCount}\n\n`;
    });
    await ctx.replyWithMarkdown(text);
  });

  // Cộng tiền User: /admin_add_balance 123456 50000
  bot.command('admin_add_balance', async (ctx) => {
    try {
      const parts = ctx.message.text.split(' ');
      if (parts.length < 3) return ctx.reply('Sử dụng: /admin_add_balance <user_id> <số_tiền>');
      
      const targetUserId = parts[1];
      const amount = parseInt(parts[2], 10);
      
      const adminId = ctx.from.id.toString(); // Dùng Mock Admin ID
      
      const wallet = await AdminService.adjustUserBalance(adminId, targetUserId, amount, true, 'Admin cấp vốn thủ công');
      
      ctx.reply(`✅ Đã cộng **${amount}đ** cho User ID \`${targetUserId}\`.\nSố dư hiện hành: ${wallet.balance}đ`, { parse_mode: 'Markdown' });
    } catch(error: any) {
      ctx.reply(`❌ Lỗi cộng tiền: ${error.message}`);
    }
  });

  // Nhập Kho: /admin_nhapkho product_id\nline1\nline2\nline3
  bot.command('admin_nhapkho', async (ctx) => {
    try {
      const text = ctx.message.text;
      // BUG FIX: Split by newline first so product_id is cleanly separated from stock contents
      const lines = text.split('\n');
      const firstLineParts = lines[0].trim().split(/\s+/);

      // firstLineParts[0] = '/admin_nhapkho', firstLineParts[1] = productId
      if (firstLineParts.length < 2) {
        return ctx.reply('Sử dụng:\n/admin_nhapkho <product_id>\ndong_kho_1\ndong_kho_2\n...');
      }

      const productId = firstLineParts[1];
      // Stock lines are everything after the first line
      const payloadLines = lines.slice(1);

      if (payloadLines.length === 0) {
        return ctx.reply('Sử dụng:\n/admin_nhapkho <product_id>\ndong_kho_1\ndong_kho_2\n...');
      }

      const adminId = ctx.from.id.toString();
      
      const result = await AdminService.importStockText(adminId, productId, payloadLines);

      ctx.reply(`✅ **Nhập kho thành công!**\nSản phẩm ID: \`${productId}\`\nSố lượng nạp: **${result.importedCount}** line.\nMã Lô (Batch ID): \`${result.batchId}\``, { parse_mode: 'Markdown' });
    } catch (error: any) {
       ctx.reply(`❌ Lỗi Nhập kho: ${error.message}`);
    }
  });
}
