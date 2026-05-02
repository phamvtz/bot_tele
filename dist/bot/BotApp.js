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
    // back:main — về menu chính từ bất kỳ đâu
    bot.action('back:main', async (ctx) => {
        await ctx.answerCbQuery().catch(() => { });
        return ctx.scene.enter(SCENES.MAIN_MENU);
    });
    // Scene routing từ bất kỳ context nào
    bot.action(/^scene:(.+)$/, async (ctx) => {
        await ctx.answerCbQuery().catch(() => { });
        const sceneName = ctx.match[1];
        if (SCENES[sceneName])
            return ctx.scene.enter(SCENES[sceneName]);
    });
    // noop (các nút placeholder)
    bot.action('noop', (ctx) => ctx.answerCbQuery().catch(() => { }));
    // close (đóng tin nhắn hiện tại)
    bot.action('close', async (ctx) => {
        await ctx.answerCbQuery().catch(() => { });
        await ctx.deleteMessage().catch(() => { });
    });
    // ── Catch-all fallback: nút cũ không khớp scene hiện tại ─────────────────
    // Chạy SAU stage.middleware() nên scene handler có ưu tiên cao hơn.
    // Nếu scene không xử lý callback → rơi xuống đây → tự điều hướng đúng scene.
    bot.on('callback_query', async (ctx) => {
        if (!('data' in ctx.callbackQuery))
            return ctx.answerCbQuery().catch(() => { });
        // Strip _cls:xxx: prefix trước khi routing
        const raw = ctx.callbackQuery.data;
        const data = raw.replace(/^_cls:[^:]+:/, '');
        await ctx.answerCbQuery().catch(() => { });
        // Map prefix → scene
        const routeMap = [
            [/^shop:/, 'SHOP'],
            [/^back:SHOP$/, 'SHOP'],
            [/^admin:order:/, 'ADMIN_ORDERS'],
            [/^back:ADMIN_ORDERS$/, 'ADMIN_ORDERS'],
            [/^back:ADMIN_MENU$/, 'ADMIN_MENU'],
            [/^back:ORDERS$/, 'ORDERS'],
            [/^order:/, 'ORDERS'],
            [/^pay:/, 'CHECKOUT'],
            [/^checkout:/, 'CHECKOUT'],
            [/^deposit:/, 'DEPOSIT'],
            [/^support:/, 'SUPPORT'],
            [/^back:SUPPORT$/, 'SUPPORT'],
            [/^referral:/, 'REFERRAL'],
            [/^wallet:/, 'WALLET'],
            [/^adminstock:/, 'ADMIN_STOCK'],
            [/^admin:prod:/, 'ADMIN_PRODUCT'],
            [/^admin:cat:/, 'ADMIN_CATEGORY'],
            [/^admin:user:/, 'ADMIN_USER'],
        ];
        for (const [pattern, scene] of routeMap) {
            const match = typeof pattern === 'string' ? data === pattern : pattern.test(data);
            if (match) {
                return ctx.scene.enter(SCENES[scene]);
            }
        }
    });
    // ── 4. Commands ────────────────────────────────────────────────────────────
    bot.start(async (ctx) => {
        const payload = ctx.payload;
        // Deep link: /start prod_PRODUCTID — từ nút Mua ngay trên kênh thông báo
        if (payload && payload.startsWith('prod_')) {
            const productId = payload.slice(5); // bỏ "prod_"
            const { Keyboards } = await import('./ui/keyboards.js');
            await ctx.reply('✅ Hệ thống đã sẵn sàng!', { reply_markup: Keyboards.persistentMenu() });
            // Vào thẳng shop scene, lưu product để auto-navigate
            ctx.session.directProductId = productId;
            return ctx.scene.enter(SCENES.SHOP);
        }
        // Deep link: /start ref_XXXXX — referral
        if (payload && payload.startsWith('ref_')) {
            await import('../modules/user/UserService.js').then(m => m.UserService.findOrCreateUser(ctx.from.id.toString(), {
                username: ctx.from.username,
                firstName: ctx.from.first_name,
                lastName: ctx.from.last_name,
                languageCode: ctx.from.language_code,
                referredByCode: payload,
            }));
        }
        const { Keyboards } = await import('./ui/keyboards.js');
        await ctx.reply('✅ Hệ thống đã sẵn sàng!', { reply_markup: Keyboards.persistentMenu() });
        return ctx.scene.enter(SCENES.MAIN_MENU);
    });
    // Xử lý các nút bấm từ Persistent Menu (Reply Keyboard)
    bot.hears('🛍️ Sản Phẩm', (ctx) => ctx.scene.enter(SCENES.SHOP));
    bot.hears('💬 Hỗ trợ', (ctx) => ctx.scene.enter(SCENES.SUPPORT));
    bot.hears('👛 Ví', (ctx) => ctx.scene.enter(SCENES.DEPOSIT));
    bot.hears('👤 Tài khoản', (ctx) => ctx.scene.enter(SCENES.PROFILE));
    bot.command('menu', (ctx) => ctx.scene.enter(SCENES.MAIN_MENU));
    bot.command('products', (ctx) => ctx.scene.enter(SCENES.SHOP));
    bot.command('topup', (ctx) => ctx.scene.enter(SCENES.DEPOSIT));
    bot.command('wallet', (ctx) => ctx.scene.enter(SCENES.DEPOSIT)); // alias /wallet → Ví
    bot.command('orders', (ctx) => ctx.scene.enter(SCENES.ORDERS));
    bot.command('order', (ctx) => ctx.scene.enter(SCENES.ORDERS)); // alias /order
    bot.command('me', (ctx) => ctx.scene.enter(SCENES.PROFILE));
    bot.command('support', (ctx) => ctx.scene.enter(SCENES.SUPPORT));
    bot.command('help', (ctx) => ctx.scene.enter(SCENES.SUPPORT)); // /help → Hỗ trợ
    // Admin commands — protected by adminMiddleware
    bot.command('admin', adminMiddleware, (ctx) => ctx.scene.enter(SCENES.ADMIN_MENU));
    // Test broadcast thông báo sản phẩm mới (chỉ Admin)
    bot.command('testnotify', adminMiddleware, async (ctx) => {
        await ctx.reply('⏳ Đang gửi thông báo test đến tất cả users...');
        const { NotificationService } = await import('../modules/notification/NotificationService.js');
        const { ProductService } = await import('../modules/product/ProductService.js');
        // Lấy sản phẩm đầu tiên để test
        const { products } = await ProductService.getAllProducts(0, 1);
        const product = products[0];
        if (!product) {
            return ctx.reply('❌ Chưa có sản phẩm nào trong hệ thống để test!');
        }
        const result = await NotificationService.notifyNewStock({
            productId: product.id,
            productName: product.name,
            productEmoji: product.thumbnailEmoji ?? '📦',
            addedCount: 10,
            newStockTotal: product.stockCount ?? 10,
            botUsername: ctx.botInfo.username,
        });
        await ctx.reply(result
            ? `✅ Test thông báo đã gửi thành công!\nSản phẩm: <b>${product.name}</b>`
            : `❌ Gửi thất bại — kiểm tra logs.`, { parse_mode: 'HTML' });
    });
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
    eventBus.onOrderCompleted(async (payload) => {
        log.info({ orderId: payload.order.id }, 'ORDER_COMPLETED event received');
        const { order } = payload;
        try {
            const db = await import('../infrastructure/db.js').then(m => m.default);
            // Load sản phẩm để kiểm tra loại
            const product = await db.product.findUnique({ where: { id: order.productId } });
            const isAutoDelivery = product?.productType === 'AUTO_DELIVERY';
            if (isAutoDelivery) {
                // ── SẢN PHẨM MÃ / CODE ───────────────────────────────────────────────
                // Chỉ gửi qua event nếu thanh toán bank (wallet đã gửi trực tiếp trong CheckoutScene)
                if (order.paymentMethod === 'BANK_TRANSFER') {
                    const deliveredItems = await db.deliveredItem.findMany({
                        where: { orderId: order.id },
                        include: { orderItem: true },
                    });
                    if (deliveredItems.length > 0) {
                        const userMsg = `✅ <b>ĐƠN HÀNG HOÀN TẤT!</b>\n` +
                            `━━━━━━━━━━━━━━━━━━━━\n` +
                            `🧾 Mã đơn: <code>${order.orderCode}</code>\n` +
                            `💰 Số tiền: <b>${order.finalAmount.toLocaleString('vi-VN')}đ</b>\n` +
                            `━━━━━━━━━━━━━━━━━━━━\n` +
                            `🔑 <b>SẢN PHẨM CỦA BẠN:</b>\n\n` +
                            deliveredItems.map(item => `📦 <b>${item.orderItem.productNameSnapshot}</b>\n` +
                                `<code>${item.deliveredContent}</code>`).join('\n') +
                            `\n\n<i>Lưu lại thông tin! Xem lại trong mục 📦 Đơn Hàng.</i>`;
                        await NotificationService.sendToUser(payload.telegramId, userMsg, { parse_mode: 'HTML' });
                    }
                }
                // Thông báo admin group (tóm tắt)
                const adminMsg = `🛍 <b>ĐƠN HÀNG HOÀN TẤT</b>\n` +
                    `━━━━━━━━━━━━━━━━━━━━\n` +
                    `📦 SP: <b>${product?.name ?? order.productId}</b>\n` +
                    `🧾 Mã: <code>${order.orderCode}</code>\n` +
                    `👤 User: <code>${payload.telegramId}</code>\n` +
                    `💰 <b>${order.finalAmount.toLocaleString('vi-VN')}đ</b>`;
                await NotificationService.sendToAdminGroup(adminMsg);
            }
            else {
                // ── ĐƠN DỊCH VỤ (MANUAL/SERVICE) ─────────────────────────────────────
                // Với wallet payment: CheckoutScene đã hiển thị thông báo → chỉ ping admin
                // Với bank payment: gửi thêm message cho user
                if (order.paymentMethod === 'BANK_TRANSFER') {
                    const userMsg = `✅ <b>ĐÃ NHẬN TIỀN — ĐƠN DỊCH VỤ!</b>\n` +
                        `━━━━━━━━━━━━━━━━━━━━\n` +
                        `📦 Sản phẩm: <b>${product?.name ?? ''}</b>\n` +
                        `🧾 Mã đơn: <code>${order.orderCode}</code>\n` +
                        `💰 Số tiền: <b>${order.finalAmount.toLocaleString('vi-VN')}đ</b>\n` +
                        `━━━━━━━━━━━━━━━━━━━━\n` +
                        `📋 <b>VUI LÒNG NHẮN CHO ADMIN:</b>\n` +
                        `Copy toàn bộ nội dung dưới đây và gửi cho admin:\n\n` +
                        `<code>🛒 ĐƠN DỊCH VỤ\n` +
                        `Sản phẩm: ${product?.name ?? ''}\n` +
                        `Mã đơn: ${order.orderCode}\n` +
                        `Số tiền: ${order.finalAmount.toLocaleString('vi-VN')}đ</code>\n\n` +
                        `<i>Admin sẽ xử lý trong vòng 5-30 phút.</i>`;
                    await NotificationService.sendToUser(payload.telegramId, userMsg, { parse_mode: 'HTML' });
                }
                // Luôn ping admin về đơn dịch vụ mới
                const adminMsg = `🔔 <b>ĐƠN DỊCH VỤ CẦN XỬ LÝ!</b>\n` +
                    `━━━━━━━━━━━━━━━━━━━━\n` +
                    `📦 SP: <b>${product?.name ?? order.productId}</b>\n` +
                    `🧾 Mã đơn: <code>${order.orderCode}</code>\n` +
                    `👤 User TelegramID: <code>${payload.telegramId}</code>\n` +
                    `💰 Đã thanh toán: <b>${order.finalAmount.toLocaleString('vi-VN')}đ</b>\n` +
                    `💳 Phương thức: ${order.paymentMethod}\n` +
                    `━━━━━━━━━━━━━━━━━━━━\n` +
                    `<i>⚡ Vui lòng liên hệ user để xử lý đơn!</i>`;
                await NotificationService.sendToAdmins(adminMsg);
            }
        }
        catch (err) {
            log.error({ err, orderId: order.id }, 'Failed to handle ORDER_COMPLETED event');
        }
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
