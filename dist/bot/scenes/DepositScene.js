import { Scenes } from 'telegraf';
import { SCENES } from '../context.js';
import { Messages } from '../ui/messages.js';
import { Keyboards } from '../ui/keyboards.js';
import { PaymentService } from '../../modules/payment/PaymentService.js';
import prisma from '../../infrastructure/db.js';
export const depositScene = new Scenes.BaseScene(SCENES.DEPOSIT);
const BANK_CODE = process.env.BANK_CODE ?? 'TCB';
const BANK_ACCOUNT = process.env.BANK_ACCOUNT ?? '0123456789';
const BANK_NAME = process.env.BANK_ACCOUNT_NAME ?? 'SHOP';
// ── Enter: Chọn số tiền nạp ──────────────────────────────────────────────────
depositScene.enter(async (ctx) => {
    ctx.session.depositAmount = undefined;
    ctx.session.depositRequestId = undefined;
    const text = `💳 *NẠP TIỀN VÀO VÍ*\n\nChọn số tiền hoặc nhập số tiền tùy chỉnh:`;
    const keyboard = Keyboards.depositAmounts();
    if (ctx.callbackQuery) {
        await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: keyboard })
            .catch(() => ctx.reply(text, { parse_mode: 'HTML', reply_markup: keyboard }));
        await ctx.answerCbQuery().catch(() => { });
    }
    else {
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
    await ctx.editMessageText(`✏️ *Nhập số tiền muốn nạp (VND):*\n\n_Ví dụ: 150000_\n\nGiá trị tối thiểu: 10,000đ`, { parse_mode: 'HTML', reply_markup: Keyboards.backOnly('DEPOSIT') });
});
depositScene.on('text', async (ctx) => {
    if (ctx.session.depositAmount !== -1)
        return; // Không phải đang chờ custom amount
    const text = ctx.message.text.replace(/[.,\s]/g, '');
    const amount = parseInt(text, 10);
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
    if (!request)
        return;
    if (request.status === 'PAID') {
        // Reload wallet balance
        const wallet = await prisma.wallet.findUnique({ where: { userId: ctx.user.id } });
        const successText = Messages.depositSuccess(request.amount, wallet?.balance ?? 0);
        await ctx.editMessageText(successText, {
            parse_mode: 'HTML',
            reply_markup: Keyboards.backOnly('WALLET'),
        });
    }
    else if (request.status === 'EXPIRED') {
        await ctx.editMessageText('⏰ Yêu cầu nạp tiền đã hết hạn. Vui lòng tạo yêu cầu mới.', {
            reply_markup: Keyboards.backOnly('DEPOSIT'),
        });
    }
    else {
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
async function processDepositAmount(ctx, amount) {
    ctx.session.depositAmount = amount;
    const request = await PaymentService.createDepositRequest(ctx.user.id, amount);
    ctx.session.depositRequestId = request.id;
    const text = Messages.qrPayment(request, BANK_CODE, BANK_ACCOUNT, BANK_NAME);
    const keyboard = Keyboards.depositPending(request.id);
    // Gửi QR image
    const qrUrl = `https://img.vietqr.io/image/${BANK_CODE}-${BANK_ACCOUNT}-compact2.png?amount=${amount}&addInfo=${encodeURIComponent(request.transferContent)}&accountName=${encodeURIComponent(BANK_NAME)}`;
    if (ctx.callbackQuery) {
        await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: keyboard });
    }
    else {
        await ctx.reply(text, { parse_mode: 'HTML', reply_markup: keyboard });
    }
    // Gửi ảnh QR kèm theo
    await ctx.replyWithPhoto(qrUrl, {
        caption: `📱 Quét QR để chuyển khoản *${amount.toLocaleString('vi-VN')}đ*\nNội dung: \`${request.transferContent}\``,
        parse_mode: 'HTML',
    });
}
