import { Telegraf, Context } from 'telegraf';
import { UserService } from '../modules/user/UserService.js';
import { WalletService } from '../modules/wallet/WalletService.js';

export function setupBotHandlers(bot: Telegraf<Context>) {
  // Command: /start
  bot.start(async (ctx) => {
    try {
      const telegramId = ctx.from?.id.toString();
      const payload = ctx.payload; // Contains referral code if any: /start ref_XYZ

      if (!telegramId) return;

      const user = await UserService.findOrCreateUser(telegramId, {
        username: ctx.from?.username,
        firstName: ctx.from?.first_name,
        lastName: ctx.from?.last_name,
        languageCode: ctx.from?.language_code,
        referredByCode: payload || undefined,
      });

      const welcomeMsg = `👋 Xin chào ${user.firstName || user.username || 'bạn'}!\n\n`
                       + `Chào mừng bạn đến với Telegram Shop. 🛒\n`
                       + `Mã giới thiệu của bạn là: \`${user.referralCode}\`\n\n`
                       + `Vui lòng chọn tính năng dưới đây:`;

      return ctx.replyWithMarkdown(welcomeMsg, {
        reply_markup: {
          inline_keyboard: [
            [{ text: '🛒 Mua hàng', callback_data: 'menu_shop' }],
            [{ text: '💰 Ví / Nạp tiền', callback_data: 'menu_wallet' }],
            [{ text: '📦 Đơn hàng', callback_data: 'menu_orders' }],
            [{ text: '👤 Cá nhân', callback_data: 'menu_profile' }, { text: '🎧 Hỗ trợ', callback_data: 'menu_support' }]
          ]
        }
      });

    } catch (error) {
      console.error('Error in /start handler', error);
      ctx.reply('❌ Có lỗi xảy ra. Vui lòng thử lại sau.');
    }
  });

  // Action: menu_wallet
  bot.action('menu_wallet', async (ctx) => {
    try {
      const telegramId = ctx.from?.id.toString();
      if (!telegramId) return;

      const user = await UserService.getUserWithWallet(telegramId);
      if (!user || !user.wallet) {
        return ctx.reply('❌ Không tìm thấy thông tin ví.');
      }

      await ctx.editMessageText(
        `💰 **Thông tin Ví của bạn**\n\n` +
        `💵 Số dư khả dụng: **${user.wallet.balance.toLocaleString('vi-VN')}đ**\n` +
        `🥶 Số dư đóng băng (đang giao dịch): **${user.wallet.frozenBalance.toLocaleString('vi-VN')}đ**\n\n` +
        `Tổng nạp: ${user.wallet.totalDeposit.toLocaleString('vi-VN')}đ\n` +
        `Tổng chi: ${user.wallet.totalSpent.toLocaleString('vi-VN')}đ`,
        {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [
              [{ text: '💳 Nạp tiền', callback_data: 'wallet_deposit' }],
              [{ text: '📜 Lịch sử giao dịch', callback_data: 'wallet_history' }],
              [{ text: '⬅️ Quay lại', callback_data: 'menu_main' }]
            ]
          }
        }
      );
    } catch (error) {
      console.error(error);
      ctx.answerCbQuery('Lỗi xử lý!');
    }
  });

  // Action: menu_main
  bot.action('menu_main', (ctx) => {
    const welcomeMsg = `Vui lòng chọn tính năng dưới đây:`;
    ctx.editMessageText(welcomeMsg, {
      reply_markup: {
        inline_keyboard: [
          [{ text: '🛒 Mua hàng', callback_data: 'menu_shop' }],
          [{ text: '💰 Ví / Nạp tiền', callback_data: 'menu_wallet' }],
          [{ text: '📦 Đơn hàng', callback_data: 'menu_orders' }],
          [{ text: '👤 Cá nhân', callback_data: 'menu_profile' }, { text: '🎧 Hỗ trợ', callback_data: 'menu_support' }]
        ]
      }
    });
  });
}
