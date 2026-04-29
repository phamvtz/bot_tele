import { Telegraf, Scenes, session } from 'telegraf';
import { SCENES } from './context.js';
import { createLogger } from '../infrastructure/logger.js';
// ── Middleware
import { authMiddleware } from './middleware/authMiddleware.js';
import { rateLimitMiddleware } from './middleware/rateLimitMiddleware.js';
import { errorMiddleware } from './middleware/errorMiddleware.js';
import { adminMiddleware } from './middleware/adminMiddleware.js';
// ── Scenes (User)
import { mainMenuScene } from './scenes/MainMenuScene.js';
import { shopScene } from './scenes/ShopScene.js';
import { checkoutScene } from './scenes/CheckoutScene.js';
import { depositScene } from './scenes/DepositScene.js';
import { walletScene } from './scenes/WalletScene.js';
import { orderScene } from './scenes/OrderScene.js';
import { profileScene } from './scenes/ProfileScene.js';
import { referralScene } from './scenes/ReferralScene.js';
import { supportScene } from './scenes/SupportScene.js';
// ── Scenes (Admin)
import { adminMenuScene } from './scenes/admin/AdminMenuScene.js';
import { adminProductScene } from './scenes/admin/AdminProductScene.js';
import { adminStockScene } from './scenes/admin/AdminStockScene.js';
import { adminUserScene } from './scenes/admin/AdminUserScene.js';
import { adminBroadcastScene } from './scenes/admin/AdminBroadcastScene.js';
import { adminCategoryScene } from './scenes/admin/AdminCategoryScene.js';
import { adminOrderScene } from './scenes/admin/AdminOrderScene.js';
// ── Event Listeners
import eventBus from '../infrastructure/events.js';
import { NotificationService } from '../modules/notification/NotificationService.js';
import { Messages } from './ui/messages.js';
const log = createLogger('BotApp');
export function createBotApp(token) {
    const bot = new Telegraf(token);
    // ── 1. Create Scene Stage ──────────────────────────────────────────────────
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    // @ts-ignore — Telegraf v4: custom context with extra props needs this cast
    const stage = new Scenes.Stage(([
        mainMenuScene,
        shopScene,
        checkoutScene,
        depositScene,
        walletScene,
        orderScene,
        profileScene,
        referralScene,
        supportScene,
        adminMenuScene,
        adminProductScene,
        adminStockScene,
        adminUserScene,
        adminBroadcastScene,
        adminCategoryScene,
        adminOrderScene,
    ]));
    // ── 2. Register Global Middleware (order matters!) ─────────────────────────
    bot.use(errorMiddleware);
    bot.use(session());
    bot.use(rateLimitMiddleware);
    bot.use(authMiddleware);
    bot.use(stage.middleware());
    // ── 3. Global Navigation Actions (outside scenes) ─────────────────────────
    bot.action('back:main', async (ctx) => {
        await ctx.answerCbQuery().catch(() => { });
        return ctx.scene.enter(SCENES.MAIN_MENU);
    });
    // Scene routing from any context
    bot.action(/^scene:(.+)$/, async (ctx) => {
        await ctx.answerCbQuery().catch(() => { });
        const sceneName = ctx.match[1];
        if (SCENES[sceneName])
            return ctx.scene.enter(SCENES[sceneName]);
    });
    // noop (các nút placeholder)
    bot.action('noop', (ctx) => ctx.answerCbQuery().catch(() => { }));
    // ── 4. Commands ────────────────────────────────────────────────────────────
    bot.start(async (ctx) => {
        // Handle referral code from /start ref_XXXXX
        const payload = ctx.payload;
        if (payload && payload.startsWith('ref_')) {
            // Referral code được xử lý trong UserService (findOrCreate gọi trong authMiddleware)
            // UserService nhận referredByCode qua payload — cần gọi lại với referral
            await import('../modules/user/UserService.js').then(m => m.UserService.findOrCreateUser(ctx.from.id.toString(), {
                username: ctx.from.username,
                firstName: ctx.from.first_name,
                lastName: ctx.from.last_name,
                languageCode: ctx.from.language_code,
                referredByCode: payload,
            }));
        }
        return ctx.scene.enter(SCENES.MAIN_MENU);
    });
    bot.command('menu', (ctx) => ctx.scene.enter(SCENES.MAIN_MENU));
    // Admin commands — protected by adminMiddleware
    bot.command('admin', adminMiddleware, (ctx) => ctx.scene.enter(SCENES.ADMIN_MENU));
    // Tiện ích lấy ID Emoji Premium (Chỉ Admin)
    bot.command('getemoji', adminMiddleware, (ctx) => {
        ctx.reply('Hãy gửi cho tôi 1 tin nhắn có chứa Premium Emoji để lấy ID nhé!');
    });
    // Lắng nghe tin nhắn chứa custom_emoji (Chỉ hoạt động khi admin gửi)
    bot.on('message', async (ctx, next) => {
        const msg = ctx.message;
        if (msg && 'text' in msg && msg.entities) {
            const customEmojis = msg.entities.filter(e => e.type === 'custom_emoji');
            if (customEmojis.length > 0) {
                // Kiểm tra xem có phải admin không (dựa trên ADMIN_IDS)
                const isAdmin = process.env.ADMIN_IDS?.split(',').includes(ctx.from.id.toString());
                if (isAdmin) {
                    let response = '<b>ID CỦA PREMIUM EMOJI:</b>\n\n';
                    customEmojis.forEach(e => {
                        const text = msg.text.substring(e.offset, e.offset + e.length);
                        // @ts-ignore
                        response += `${text} : <code>${e.custom_emoji_id}</code>\n`;
                    });
                    response += '\n<i>Copy mã ID này vào emojis.ts</i>';
                    return ctx.reply(response, { parse_mode: 'HTML' });
                }
            }
        }
        return next();
    });
    // ── 5. Event Listeners (cross-cutting concerns) ───────────────────────────
    // Khi đơn hàng hoàn tất → gửi key cho user nếu bot chưa gửi trong scene
    eventBus.onOrderCompleted(async (payload) => {
        log.info({ orderId: payload.order.id }, 'ORDER_COMPLETED event received');
        // Gửi thông báo đến Group Admin
        const { order } = payload;
        const adminMsg = `🛍 <b>CÓ ĐƠN HÀNG MỚI!</b>\n` +
            `${'━'.repeat(24)}\n` +
            `Mã đơn: <code>${order.orderCode}</code>\n` +
            `Khách hàng: <code>${payload.telegramId}</code>\n` +
            `Tổng tiền: <b>${order.finalAmount.toLocaleString('vi-VN')}đ</b>`;
        await NotificationService.sendToAdminGroup(adminMsg);
    });
    // Khi nạp tiền thành công → thông báo cho user
    eventBus.onPaymentReceived(async (payload) => {
        if (payload.type === 'DEPOSIT') {
            const wallet = await import('../infrastructure/db.js').then(m => m.default.wallet.findUnique({ where: { userId: payload.userId } }));
            const msg = Messages.depositSuccess(payload.amount, wallet?.balance ?? 0);
            await NotificationService.sendToUser(payload.telegramId, msg);
        }
    });
    // HACK: Bắt các nút từ Menu cũ bị kẹt trên app người dùng để quét sạch chúng
    bot.hears(['💰 Nạp tiền', '🛒 Mua hàng', '📦 Đơn hàng', '📊 Lịch sử GD', '👤 Tài khoản', '🔧 Admin', 'Menu'], async (ctx) => {
        const m = await ctx.reply('🔄 Đang đồng bộ giao diện mới...', {
            reply_markup: { remove_keyboard: true }
        });
        // Xóa tin nhắn dọn rác và đưa vào Menu mới
        setTimeout(() => ctx.deleteMessage(m.message_id).catch(() => { }), 1500);
        return ctx.scene.enter(SCENES.MAIN_MENU);
    });
    log.info('Bot app initialized with all scenes and middleware');
    return bot;
}
