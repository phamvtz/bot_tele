import { Scenes } from 'telegraf';
import { SCENES } from '../context.js';
import { Messages } from '../ui/messages.js';
import { Keyboards } from '../ui/keyboards.js';
import prisma from '../../infrastructure/db.js';
import crypto from 'crypto';
const TICKETS_PER_PAGE = 5;
export const supportScene = new Scenes.BaseScene(SCENES.SUPPORT);
// ── Enter: Menu hỗ trợ ───────────────────────────────────────────────────────
supportScene.enter(async (ctx) => {
    const openCount = await prisma.ticket.count({
        where: { userId: ctx.user.id, status: { in: ['OPEN', 'PENDING', 'ANSWERED'] } },
    });
    const text = Messages.supportMenu(openCount);
    const keyboard = Keyboards.supportMenu();
    if (ctx.callbackQuery) {
        await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: keyboard })
            .catch(() => ctx.reply(text, { parse_mode: 'HTML', reply_markup: keyboard }));
        await ctx.answerCbQuery().catch(() => { });
    }
    else {
        await ctx.reply(text, { parse_mode: 'HTML', reply_markup: keyboard });
    }
});
// ── Action: Xem danh sách ticket ─────────────────────────────────────────────
supportScene.action(/^support:list:(\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const page = parseInt(ctx.match[1], 10);
    const [tickets, total] = await Promise.all([
        prisma.ticket.findMany({
            where: { userId: ctx.user.id },
            orderBy: { createdAt: 'desc' },
            skip: page * TICKETS_PER_PAGE,
            take: TICKETS_PER_PAGE,
        }),
        prisma.ticket.count({ where: { userId: ctx.user.id } }),
    ]);
    const totalPages = Math.max(Math.ceil(total / TICKETS_PER_PAGE), 1);
    const text = Messages.ticketList(tickets, page, totalPages);
    const keyboard = {
        inline_keyboard: [
            ...(totalPages > 1 ? [
                [
                    ...(page > 0 ? [{ text: '◀️', callback_data: `support:list:${page - 1}` }] : []),
                    { text: `${page + 1}/${totalPages}`, callback_data: 'noop' },
                    ...(page < totalPages - 1 ? [{ text: '▶️', callback_data: `support:list:${page + 1}` }] : []),
                ]
            ] : []),
            [{ text: '⬅️ Quay lại', callback_data: 'back:SUPPORT' }],
        ],
    };
    await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: keyboard });
});
// ── Action: Tạo ticket mới (WizardScene-like với text handler) ────────────────
supportScene.action('support:create', async (ctx) => {
    await ctx.answerCbQuery();
    ctx.session.ticketSubject = ''; // Flag: đang nhập subject
    await ctx.editMessageText(`🎧 *TẠO TICKET HỖ TRỢ*\n\nBước 1/2: Nhập tiêu đề vấn đề của bạn:`, {
        parse_mode: 'HTML',
        reply_markup: {
            inline_keyboard: [[{ text: '❌ Hủy', callback_data: 'back:SUPPORT' }]],
        },
    });
});
// ── Action: Tạo ticket với đơn hàng cụ thể ───────────────────────────────────
supportScene.action(/^support:new:(.+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const orderId = ctx.match[1];
    ctx.session.pendingOrderId = orderId;
    ctx.session.ticketSubject = ''; // Flag: nhập subject
    await ctx.reply(`🎧 *BÁO LỖI SẢN PHẨM*\n\nBước 1/2: Mô tả ngắn vấn đề bạn gặp phải:`, {
        parse_mode: 'HTML',
        reply_markup: {
            inline_keyboard: [[{ text: '❌ Hủy', callback_data: 'scene:ORDERS' }]],
        },
    });
});
// ── Text: Nhận nhập từ user ───────────────────────────────────────────────────
supportScene.on('text', async (ctx) => {
    const text = ctx.message.text;
    // Bước 1: Nhận subject
    if (ctx.session.ticketSubject === '') {
        ctx.session.ticketSubject = text;
        await ctx.reply(`✅ Tiêu đề: *${text}*\n\nBước 2/2: Mô tả chi tiết vấn đề bạn gặp phải:`, {
            parse_mode: 'HTML',
            reply_markup: {
                inline_keyboard: [[{ text: '❌ Hủy', callback_data: 'back:SUPPORT' }]],
            },
        });
        return;
    }
    // Bước 2: Nhận content → tạo ticket
    if (ctx.session.ticketSubject) {
        const subject = ctx.session.ticketSubject;
        const content = text;
        const ticketCode = `TK-${Date.now().toString().slice(-6)}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`;
        const ticket = await prisma.ticket.create({
            data: {
                ticketCode,
                userId: ctx.user.id,
                orderId: ctx.session.pendingOrderId ?? null,
                subject,
                status: 'OPEN',
                priority: 'NORMAL',
                messages: {
                    create: {
                        senderType: 'USER',
                        senderId: ctx.user.id,
                        messageText: content,
                    },
                },
            },
        });
        ctx.session.ticketSubject = undefined;
        ctx.session.pendingOrderId = undefined;
        await ctx.reply(`✅ *TICKET ĐÃ ĐƯỢC TẠO!*\n\nMã Ticket: \`${ticket.ticketCode}\`\n\n_Đội hỗ trợ sẽ phản hồi trong vòng 24 giờ._`, {
            parse_mode: 'HTML',
            reply_markup: Keyboards.supportMenu(),
        });
    }
});
// ── Navigation ────────────────────────────────────────────────────────────────
supportScene.action('back:SUPPORT', async (ctx) => {
    await ctx.answerCbQuery();
    ctx.session.ticketSubject = undefined;
    return ctx.scene.reenter();
});
supportScene.action('scene:ORDERS', async (ctx) => {
    await ctx.answerCbQuery();
    return ctx.scene.enter(SCENES.ORDERS);
});
supportScene.action('back:main', async (ctx) => {
    await ctx.answerCbQuery();
    return ctx.scene.enter(SCENES.MAIN_MENU);
});
supportScene.action('noop', (ctx) => ctx.answerCbQuery());
