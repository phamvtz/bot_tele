import { Scenes } from 'telegraf';
import { BotContext, SCENES } from '../context.js';
import { Messages } from '../ui/messages.js';
import { Keyboards } from '../ui/keyboards.js';
import { PaymentService } from '../../modules/payment/PaymentService.js';
import prisma from '../../infrastructure/db.js';

export const depositScene = new Scenes.BaseScene<BotContext>(SCENES.DEPOSIT);

const BANK_CODE    = process.env.BANK_ID          ?? process.env.BANK_CODE    ?? 'MB';
const BANK_ACCOUNT = process.env.BANK_ACCOUNT_NO  ?? process.env.BANK_ACCOUNT ?? '321336';
const BANK_NAME    = process.env.BANK_ACCOUNT_NAME ?? 'PHAM VAN VIET';

// ── Enter: Chọn số tiền nạp ──────────────────────────────────────────────────

depositScene.enter(async (ctx) => {
  if (ctx.callbackQuery) await ctx.answerCbQuery().catch(() => {});
  ctx.session.depositAmount = undefined;
  ctx.session.depositRequestId = undefined;

  const text = `💳 <b>NẠP TIỀN VÀO VÍ</b>\n\nChọn số tiền hoặc nhập số tiền tùy chỉnh:`;
  const keyboard = Keyboards.depositAmounts();

  if (ctx.callbackQuery) {
    await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: keyboard })
      .catch(() => ctx.reply(text, { parse_mode: 'HTML', reply_markup: keyboard }));
  } else {
    await ctx.reply(text, { parse_mode: 'HTML', reply_markup: keyboard });
  }
});

// ── Action: Chọn số tiền preset ──────────────────────────────────────────────

depositScene.action(/^deposit:amount:(\d+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  const amount = parseInt(ctx.match[1], 10);
  await processDepositAmount(ctx, amount);
});

// ── Action: Nhập số tiền tùy chỉnh ──────────────────────────────────────────

depositScene.action('deposit:custom', async (ctx) => {
  await ctx.answerCbQuery();
  ctx.session.depositAmount = -1; // Flag: waiting for text input

  await ctx.editMessageText(
    `✏️ <b>Nhập số tiền muốn nạp (VND):</b>\n\n<i>Ví dụ: 150000</i>\n\nGiá trị tối thiểu: 10,000đ`,
    { parse_mode: 'HTML', reply_markup: Keyboards.backOnly('DEPOSIT') }
  );
});

depositScene.on('text', async (ctx, next) => {
  // Bỏ qua nếu là command hoặc nút từ Persistent Menu
  const text = ctx.message.text;
  if (text.startsWith('/') || ['🛍️ Sản Phẩm', '💬 Hỗ trợ', '👛 Ví', '👤 Tài khoản'].includes(text)) {
    return next();
  }

  if (ctx.session.depositAmount !== -1) return next(); // Không phải đang chờ custom amount

  const amountStr = text.replace(/[.,\s]/g, '');
  const amount = parseInt(amountStr, 10);

  if (isNaN(amount) || amount < 10_000) {
    return ctx.reply('❌ Số tiền không hợp lệ. Vui lòng nhập tối thiểu 10,000đ.');
  }
  if (amount > 100_000_000) {
    return ctx.reply('❌ Số tiền vượt quá giới hạn cho phép (100,000,000đ).');
  }

  await processDepositAmount(ctx, amount);
});

// ── Action: Kiểm tra trạng thái ──────────────────────────────────────────────

depositScene.action(/^deposit:check:(.+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  const requestId = ctx.match[1];

  const request = await prisma.paymentRequest.findUnique({ where: { id: requestId } });

  if (!request) return;

  if (request.status === 'PAID') {
    const wallet = await prisma.wallet.findUnique({ where: { userId: ctx.user.id } });
    const successText = Messages.depositSuccess(request.amount, wallet?.balance ?? 0);
    await ctx.editMessageText(successText, {
      parse_mode: 'MarkdownV2',
      reply_markup: Keyboards.backOnly('WALLET'),
    });
  } else if (request.status === 'EXPIRED') {
    await ctx.editMessageText('⏰ Yêu cầu nạp tiền đã hết hạn. Vui lòng tạo yêu cầu mới.', {
      reply_markup: Keyboards.backOnly('DEPOSIT'),
    });
  } else {
    await ctx.answerCbQuery('⏳ Chưa nhận được thanh toán. Vui lòng đợi thêm.', { show_alert: true });
  }
});

// ── Action: Hủy yêu cầu ──────────────────────────────────────────────────────

depositScene.action(/^deposit:cancel:(.+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  const requestId = ctx.match[1];

  await prisma.paymentRequest.update({
    where: { id: requestId },
    data: { status: 'CANCELLED' },
  });

  ctx.session.depositRequestId = undefined;
  await ctx.editMessageText('✅ Đã hủy yêu cầu nạp tiền.', {
    reply_markup: Keyboards.backOnly('WALLET'),
  });
});

// ── Navigation ────────────────────────────────────────────────────────────────

depositScene.action('back:DEPOSIT', async (ctx) => {
  await ctx.answerCbQuery();
  return ctx.scene.reenter();
});

depositScene.action('back:WALLET', async (ctx) => {
  await ctx.answerCbQuery();
  return ctx.scene.enter(SCENES.WALLET);
});

depositScene.action('back:main', async (ctx) => {
  await ctx.answerCbQuery();
  return ctx.scene.enter(SCENES.MAIN_MENU);
});

// ── Helper ────────────────────────────────────────────────────────────────────

async function processDepositAmount(ctx: BotContext, amount: number) {
  ctx.session.depositAmount = amount;

  const request = await PaymentService.createDepositRequest(ctx.user.id, amount);
  ctx.session.depositRequestId = request.id;

  const expireTime = request.expiresAt.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });

  const text =
    `🏦 *THÔNG TIN CHUYỂN KHOẢN*\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `🏦 Ngân hàng: *${BANK_CODE}*\n` +
    `🏧 STK: \`${BANK_ACCOUNT}\`\n` +
    `👤 Chủ TK: *${BANK_NAME}*\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `💰 Số tiền: *${amount.toLocaleString('vi-VN')}đ*\n` +
    `📝 Nội dung CK: \`${request.transferContent}\`\n` +
    `⚠️ *BẬ BUỘC GHI ĐÚNG NỘI DUNG\!*\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `⏳ Hết hạn lúc: *${expireTime}*\n` +
    `_Hệ thống tự đối soát sau 1\-3 phút\._`;

  const keyboard = Keyboards.depositPending(request.id);
  const qrUrl = `https://img.vietqr.io/image/${BANK_CODE}-${BANK_ACCOUNT}-compact2.png?amount=${amount}&addInfo=${encodeURIComponent(request.transferContent)}&accountName=${encodeURIComponent(BANK_NAME)}`;

  if (ctx.callbackQuery) {
    await ctx.editMessageText(text, { parse_mode: 'MarkdownV2', reply_markup: keyboard });
  } else {
    await ctx.reply(text, { parse_mode: 'MarkdownV2', reply_markup: keyboard });
  }

  await ctx.replyWithPhoto(qrUrl, {
    caption: `📱 Quét QR để chuyển khoản *${amount.toLocaleString('vi-VN')}đ*\nNội dung: \`${request.transferContent}\``,
    parse_mode: 'MarkdownV2',
  });
}
