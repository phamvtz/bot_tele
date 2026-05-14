import { Telegraf, Markup, session } from "telegraf";
import { prisma } from "./db.js";
import { t, getLanguages } from "./i18n/index.js";
import { rateLimitMiddleware } from "./ratelimit.js";
import { getStockCount } from "./inventory.js";
import { validateCoupon, calculateDiscount, applyCoupon } from "./coupon.js";
import { getOrCreateUser, getReferralStats, getReferralLink } from "./referral.js";
import { renderCategoryList, renderProductsInCategory } from "./category.js";
import { createCheckout, getPaymentMessage, getExpireMinutes } from "./payment/provider.js";
import { generateQRUrl } from "./payment/vietqr.js";
import {
    getBalance,
    createDeposit,
    confirmDepositByBankScan,
    getTransactionHistory,
    generateDepositContent,
    purchase as walletPurchase,
    refund as walletRefund,
} from "./wallet.js";
import { deliverOrder } from "./delivery.js";
import { confirmOrderByBankScan } from "./bank-poller.js";
import { sendLog } from "./lib/logger.js";
import {
    DIVIDER,
    formatCurrency,
    escapeHtml,
    formatDateTime,
    truncateText,
} from "./bot-ui/format.js";
import {
    accountMessage,
    checkoutMessage,
    contactProductMessage,
    mainMenuMessage,
    orderDetailMessage,
    ordersMessage,
    orderSuccessMessage,
    productDetailMessage,
    searchPromptMessage,
    supportMessage,
    walletMessage,
} from "./bot-ui/messages.js";
import {
    buildCheckoutKeyboard,
    buildContactProductKeyboard,
    buildMainMenuKeyboard,
    buildOrderDetailKeyboard,
    buildOrderListKeyboard,
    buildProductDetailKeyboard,
    buildReplyKeyboard,
    buildSupportKeyboard,
    buildWalletKeyboard,
} from "./bot-ui/keyboards.js";
import { answerCallback, safeEditOrReply } from "./bot-ui/safe.js";

/**

/**
 * Create and configure the Telegram bot v3
 * VietQR payment only
 */
export function createBot({ paymentProvider }) {
    const botToken = process.env.BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN || "";
    if (!botToken) {
        throw new Error("Missing BOT_TOKEN (or TELEGRAM_BOT_TOKEN) in environment");
    }
    const bot = new Telegraf(botToken);

    // ============================================
    // CHAT STATE MANAGEMENT (CORE)
    // ============================================
    const chatState = new Map();

    // Dọn state cũ mỗi 10 phút — tránh memory leak
    setInterval(() => {
        const cutoff = Date.now() - 30 * 60 * 1000;
        for (const [id, s] of chatState.entries()) {
            if (s.lastActionAt < cutoff) chatState.delete(id);
        }
    }, 10 * 60 * 1000);

    // Cache bot info — tránh gọi API mỗi lần bấm REFERRAL
    let _botInfo = null;
    const getBotInfo = () => { _botInfo ??= bot.telegram.getMe(); return _botInfo; };
    /*
    chatState = {
      chatId: {
        lastMenuId: number,      // ID menu cuối cùng
        tempMessages: number[],  // Các tin nhắn tạm
        lastActionAt: number     // Thời điểm action cuối
      }
    }
    */

    // Get or create chat state for user
    const getState = (chatId) => {
        if (!chatState.has(chatId)) {
            chatState.set(chatId, {
                lastMenuId: null,
                tempMessages: [],
                lastActionAt: 0,
            });
        }
        return chatState.get(chatId);
    };

    // Rate limit check - chống spam bấm menu
    const isSpam = (chatId, delay = 800) => {
        const state = getState(chatId);
        const now = Date.now();
        if (now - state.lastActionAt < delay) return true;
        state.lastActionAt = now;
        return false;
    };

    // Safe delete message (không throw error)
    const safeDelete = async (ctx, messageId = null) => {
        try {
            if (messageId) {
                await ctx.telegram.deleteMessage(ctx.chat.id, messageId);
            } else if (ctx.callbackQuery?.message?.message_id) {
                await ctx.deleteMessage();
            }
        } catch (e) {
            // Ignore - message already deleted or too old
        }
    };

    // Send MENU - tự động xóa menu cũ (QUAN TRỌNG NHẤT)
    const sendMenu = async (ctx, text, options = {}, keepOldMenu = false) => {
        const chatId = ctx.chat.id;
        const state = getState(chatId);

        // Xóa user's button press message (nếu từ keyboard)
        if (ctx.message?.message_id) {
            await safeDelete(ctx, ctx.message.message_id);
        }

        // Xóa menu cũ (nếu không yêu cầu giữ lại)
        if (state.lastMenuId && !keepOldMenu) {
            await safeDelete(ctx, state.lastMenuId);
        }

        // Gửi menu mới
        const msg = await ctx.reply(text, { parse_mode: "Markdown", ...options });
        state.lastMenuId = msg.message_id;
        return msg;
    };

    // Send TEMP message - tự động xóa sau TTL
    const sendTemp = async (ctx, text, options = {}, ttl = 30000) => {
        const chatId = ctx.chat.id;
        const state = getState(chatId);

        const msg = await ctx.reply(text, { parse_mode: "Markdown", ...options });
        state.tempMessages.push(msg.message_id);

        // Auto delete after TTL
        setTimeout(() => {
            safeDelete(ctx, msg.message_id);
            state.tempMessages = state.tempMessages.filter(id => id !== msg.message_id);
        }, ttl);

        return msg;
    };

    // Send IMPORTANT message - KHÔNG BAO GIỜ XÓA (nạp/đơn thành công)
    const sendImportant = async (ctx, text, options = {}) => {
        return ctx.reply(text, { parse_mode: "Markdown", ...options });
    };

    // Clear all temp messages (khi quay về menu chính)
    const clearTemp = async (ctx) => {
        const state = getState(ctx.chat.id);
        await Promise.all(state.tempMessages.map((id) => safeDelete(ctx, id)));
        state.tempMessages = [];
    };

    // Edit message smoothly (for callback queries)
    const smoothEdit = async (ctx, text, options = {}) => {
        try {
            const chatId = ctx.chat.id;
            if (isSpam(chatId, 500)) {
                await ctx.answerCbQuery("⏳ Đang xử lý...");
                return;
            }
            await ctx.answerCbQuery();
            await ctx.editMessageText(text, { parse_mode: "Markdown", ...options });
        } catch (e) {
            if (e.message?.includes("message is not modified")) {
                // Message is identical, ignore
                return;
            }
            if (e.message?.includes("there is no text in the message")) {
                // Original message was photo/document, delete and send new text message
                try {
                    await safeDelete(ctx);
                    await ctx.reply(text, { parse_mode: "Markdown", ...options });
                } catch (fallbackErr) {
                    console.log("smoothEdit fallback error:", fallbackErr.message);
                }
            } else {
                console.log("smoothEdit error:", e.message);
            }
        }
    };

    // ============================================
    // END CHAT STATE MANAGEMENT
    // ============================================

    // Session middleware
    bot.use(session({ defaultSession: () => ({ language: "vi", pendingOrder: null }) }));

    // Rate limiting middleware
    bot.use(rateLimitMiddleware());

    // Error handling
    bot.catch((err, ctx) => {
        console.error(`Bot error for ${ctx.updateType}:`, err);
        sendLog("ERROR", `⚠️ Bot caught error: ${err.message}\nUser: ${ctx.from?.id || "unknown"}`);
        ctx.reply("Có lỗi xảy ra, vui lòng thử lại hoặc liên hệ hỗ trợ.").catch(() => { });
    });



    const buildDepositMsg = ({ amount, depositContent, bankName, bankAccount, accountName, expireMinutes }) =>
        `🏦 <b>Nạp tiền vào ví</b>\n${DIVIDER}\n`
        + `💰 Số tiền: <b>${formatPrice(amount)}</b>\n`
        + `📝 Nội dung CK: <code>${escapeHtml(depositContent)}</code>\n\n`
        + `🏢 Ngân hàng: <b>${escapeHtml(bankName)}</b>\n`
        + `💳 STK: <code>${escapeHtml(bankAccount)}</code>\n`
        + `👤 Chủ TK: <b>${escapeHtml(accountName)}</b>\n\n`
        + `⚠️ Chuyển đúng số tiền và đúng nội dung. Hết hạn sau <b>${expireMinutes} phút</b>.`;

    // Helper to get user language
    const getLang = (ctx) => ctx.session?.language || "vi";

    // Helper to format price
    const formatPrice = (amount, currency = "VND") => {
        return formatCurrency(amount, currency);
    };

    // cleanReply = alias for sendMenu (backward compatibility)
    const cleanReply = sendMenu;

    // Helper to build dynamic main menu — nhận productCount từ ngoài, không query thêm
    const buildMainMenu = (ctx, productCount) => buildMainMenuKeyboard({
        hasWallet: true,
        isAdmin: isAdmin(ctx.from.id),
        hasProducts: productCount > 0,
    });

    // Reply keyboard for regular users (persistent at bottom)
    const userKeyboard = buildReplyKeyboard();

    // Reply keyboard for admins (with admin button)
    const adminKeyboard = buildReplyKeyboard({ isAdmin: true });

    // Check if user is admin
    const isAdmin = (userId) => {
        const adminIds = (process.env.ADMIN_IDS || "").split(",").filter(Boolean);
        return adminIds.includes(String(userId));
    };

    // Cache productCount 60s to reduce DB queries on every menu open
    let _productCountCache = { count: 0, ts: 0 };
    const getCachedProductCount = async () => {
        if (Date.now() - _productCountCache.ts < 60000) return _productCountCache.count;
        const count = await prisma.product.count({ where: { isActive: true } });
        _productCountCache = { count, ts: Date.now() };
        return count;
    };

    // Cache product detail 30s — tránh query DB mỗi lần user click vào sản phẩm
    const _productCache = new Map();
    const getCachedProduct = async (productId) => {
        const entry = _productCache.get(productId);
        if (entry && Date.now() - entry.ts < 30000) return entry.value;
        const product = await prisma.product.findUnique({ where: { id: productId }, include: { category: true } });
        if (product) _productCache.set(productId, { value: product, ts: Date.now() });
        return product;
    };
    const invalidateProductCache = (productId) => { if (productId) _productCache.delete(productId); else _productCache.clear(); };

    const createPendingOrder = (ctx, product, quantity) => {
        ctx.session.pendingOrder = {
            productId: product.id,
            productName: product.name,
            quantity,
            unitPrice: product.price,
            amount: product.price * quantity,
            currency: product.currency,
            discount: 0,
            finalAmount: product.price * quantity,
        };
        return ctx.session.pendingOrder;
    };

    const validateStockForQuantity = async (product, quantity) => {
        if (!product || !product.isActive) {
            return { ok: false, message: "Sản phẩm không khả dụng." };
        }
        if (product.deliveryMode !== "STOCK_LINES") {
            return { ok: true };
        }
        const stockCount = await getStockCount(product.id);
        if (stockCount < quantity) {
            return { ok: false, message: `Không đủ hàng. Hiện chỉ còn ${stockCount} sản phẩm.` };
        }
        return { ok: true };
    };

    const showMainMenu = async (ctx, { edit = false } = {}) => {
        const [balance, productCount] = await Promise.all([
            getBalance(ctx.from.id),
            getCachedProductCount(),
        ]);
        const keyboard = buildMainMenu(ctx, productCount);
        const text = mainMenuMessage({
            firstName: ctx.from.first_name || "bạn",
            balance,
            productCount,
        });

        if (edit || ctx.callbackQuery) {
            return safeEditOrReply(ctx, text, keyboard);
        }

        return sendMenu(ctx, text, { parse_mode: "HTML", ...keyboard });
    };

    // No products action
    bot.action("NO_PRODUCTS", async (ctx) => {
        await ctx.answerCbQuery("Gói này hiện không khả dụng. Vui lòng chọn gói khác.", { show_alert: true });
    });

    bot.action("SEARCH_PRODUCTS", async (ctx) => {
        await answerCallback(ctx);
        await safeEditOrReply(ctx, searchPromptMessage(), {
            ...Markup.inlineKeyboard([
                [Markup.button.callback("📁 Xem danh mục", "LIST_PRODUCTS")],
                [Markup.button.callback("🏠 Menu", "BACK_HOME")],
            ]),
        });
    });

    bot.action("HOT_PRODUCTS", async (ctx) => {
        await answerCallback(ctx);
        const products = await prisma.product.findMany({
            where: { isActive: true, price: { gt: 0 } },
            orderBy: { createdAt: "desc" },
            take: 6,
        });

        if (!products.length) {
            return safeEditOrReply(ctx, `<b>Gói mới</b>\n${DIVIDER}\nHiện chưa có gói nào đang mở bán.`, {
                ...Markup.inlineKeyboard([
                    [Markup.button.callback("📁 Danh mục", "LIST_PRODUCTS")],
                    [Markup.button.callback("🏠 Menu", "BACK_HOME")],
                ]),
            });
        }

        const lines = products.map((product, index) => `<b>${index + 1}.</b> ${escapeHtml(product.name)}\n${formatPrice(product.price, product.currency)}`);
        await safeEditOrReply(ctx, `<b>Gói mới</b>\n${DIVIDER}\n${lines.join("\n\n")}`, {
            ...Markup.inlineKeyboard([
                ...products.map((product) => [Markup.button.callback(`${truncateText(product.name, 34)}`, `product:${product.id}`)]),
                [Markup.button.callback("📁 Danh mục", "LIST_PRODUCTS")],
                [Markup.button.callback("🏠 Menu", "BACK_HOME")],
            ]),
        });
    });

    // ALL_PRODUCTS → redirect to category list
    bot.action("ALL_PRODUCTS", async (ctx) => {
        await answerCallback(ctx);
        const ui = await renderCategoryList();
        await safeEditOrReply(ctx, ui.text, ui.keyboard);
    });

    bot.action(/^all_products:(\d+)$/i, async (ctx) => {
        await answerCallback(ctx);
        const ui = await renderCategoryList();
        await safeEditOrReply(ctx, ui.text, ui.keyboard);
    });

    // /start command — show reply keyboard + category list with optional banner
    bot.start(async (ctx) => {
        const startParam = ctx.message.text.split(" ")[1];
        let referralCode = null;
        if (startParam?.startsWith("ref_")) {
            referralCode = startParam.replace("ref_", "");
        }
        await getOrCreateUser(ctx.from, referralCode);

        const replyKbd = isAdmin(ctx.from.id) ? adminKeyboard : userKeyboard;
        await ctx.reply(`Chào <b>${escapeHtml(ctx.from.first_name || "bạn")}</b>. Menu nhanh đã sẵn sàng ở bàn phím bên dưới.`, { parse_mode: "HTML", ...replyKbd });

        const ui = await renderCategoryList();
        const bannerUrl = process.env.SHOP_BANNER_URL;
        if (bannerUrl) {
            try {
                const msg = await ctx.replyWithPhoto(bannerUrl, { caption: ui.text, parse_mode: "HTML", ...ui.keyboard });
                getState(ctx.chat.id).lastMenuId = msg.message_id;
                return;
            } catch { /* fallback to text */ }
        }
        const msg = await ctx.reply(ui.text, { parse_mode: "HTML", ...ui.keyboard });
        getState(ctx.chat.id).lastMenuId = msg.message_id;
    });

    // /menu command — show main menu
    bot.command("menu", async (ctx) => {
        await showMainMenu(ctx);
    });

    // /products command — show category list
    bot.command("products", async (ctx) => {
        const ui = await renderCategoryList();
        const msg = await ctx.reply(ui.text, { parse_mode: "HTML", ...ui.keyboard });
        getState(ctx.chat.id).lastMenuId = msg.message_id;
    });

    // /topup command — quick access to wallet top-up
    bot.command("topup", async (ctx) => {
        const balance = await getBalance(ctx.from.id);
        await ctx.reply(walletMessage(balance), { parse_mode: "HTML", ...buildWalletKeyboard() });
    });

    // /orders command — show user's orders
    bot.command("orders", async (ctx) => {
        const telegramId = String(ctx.from.id);
        const orders = await prisma.order.findMany({
            where: { odelegramId: telegramId },
            include: { product: true },
            orderBy: { createdAt: "desc" },
            take: 20,
        });
        await ctx.reply(ordersMessage(orders), { parse_mode: "HTML", ...buildOrderListKeyboard(orders) });
    });

    // /support command — show support screen
    bot.command("support", async (ctx) => {
        const adminUsername = process.env.ADMIN_TELEGRAM || "vanggohh";
        await ctx.reply(supportMessage(adminUsername), { parse_mode: "HTML", ...buildSupportKeyboard(adminUsername) });
    });

    // Back to home - edit current message
    bot.action("BACK_HOME", async (ctx) => {
        await answerCallback(ctx);
        await showMainMenu(ctx, { edit: true });
    });

    bot.action("main_menu", async (ctx) => {
        await answerCallback(ctx);
        await showMainMenu(ctx, { edit: true });
    });

    // Language selection
    bot.action("LANGUAGE", async (ctx) => {
        await answerCallback(ctx);
        const lang = getLang(ctx);
        const languages = getLanguages();

        await safeEditOrReply(
            ctx,
            t("selectLanguage", lang),
            Markup.inlineKeyboard([
                ...languages.map((l) => [Markup.button.callback(l.name, `SET_LANG:${l.code}`)]),
                [Markup.button.callback(t("back", lang), "BACK_HOME")],
            ])
        );
    });

    bot.action(/^SET_LANG:(.+)$/, async (ctx) => {
        await answerCallback(ctx);
        const newLang = ctx.match[1];
        ctx.session.language = newLang;

        const user = await prisma.user.findUnique({
            where: { telegramId: String(ctx.from.id) },
        });
        if (user) {
            await prisma.user.update({
                where: { id: user.id },
                data: { language: newLang },
            });
        }

        await safeEditOrReply(
            ctx,
            t("languageChanged", newLang),
            Markup.inlineKeyboard([[Markup.button.callback(t("back", newLang), "BACK_HOME")]])
        );
    });

    // Help - Main menu
    bot.action("HELP", async (ctx) => {
        await answerCallback(ctx);
        const adminUsername = process.env.ADMIN_TELEGRAM || "vanggohh";
        await safeEditOrReply(ctx, supportMessage(adminUsername), buildSupportKeyboard(adminUsername));
    });

    bot.action("HELP:BUYING", async (ctx) => {
        await answerCallback(ctx);
        await safeEditOrReply(ctx, `<b>Cách mua hàng</b>
${DIVIDER}
1. Chọn <b>Mua hàng</b>.
2. Chọn danh mục và gói cần mua.
3. Kiểm tra giá, kho và số lượng.
4. Thanh toán bằng ví hoặc QR ngân hàng.
5. Bot tự động giao hàng sau khi đơn được xác nhận.`, {
            ...Markup.inlineKeyboard([
                [Markup.button.callback("🛒 Mua hàng", "LIST_PRODUCTS")],
                [Markup.button.callback("← Hỗ trợ", "HELP")],
            ]),
        });
    });

    bot.action("HELP:WALLET", async (ctx) => {
        await answerCallback(ctx);
        await safeEditOrReply(ctx, `<b>Ví và nạp tiền</b>
${DIVIDER}
Nạp trước vào ví để mua nhanh hơn.

Khi nạp tiền, hãy chuyển đúng số tiền và đúng nội dung QR. Hệ thống sẽ cộng ví tự động sau khi nhận giao dịch.`, {
            ...Markup.inlineKeyboard([
                [Markup.button.callback("💳 Mở ví", "WALLET")],
                [Markup.button.callback("← Hỗ trợ", "HELP")],
            ]),
        });
    });

    bot.action("HELP:PAYMENT", async (ctx) => {
        await answerCallback(ctx);
        await safeEditOrReply(ctx, `<b>Thanh toán & giao hàng</b>
${DIVIDER}
<b>Bao lâu nhận hàng?</b>
Thường trong 1-3 phút sau khi hệ thống xác nhận thanh toán.

<b>Chuyển sai nội dung?</b>
Liên hệ admin và gửi ảnh giao dịch kèm mã đơn.

<b>Đơn hết hạn?</b>
Không thanh toán đơn đã hết hạn. Hãy tạo đơn mới để tránh sai lệch.`, {
            ...Markup.inlineKeyboard([[Markup.button.callback("← Hỗ trợ", "HELP")]]),
        });
    });

    bot.action("HELP:REFERRAL", async (ctx) => {
        await answerCallback(ctx);
        await safeEditOrReply(ctx, `<b>Giới thiệu bạn bè</b>
${DIVIDER}
Lấy link giới thiệu trong menu và gửi cho bạn bè.

Khi người được giới thiệu mua hàng thành công, hoa hồng sẽ được ghi nhận theo cấu hình shop.`, {
            ...Markup.inlineKeyboard([[Markup.button.callback("← Hỗ trợ", "HELP")]]),
        });
    });

    bot.action("HELP:CONTACT", async (ctx) => {
        await answerCallback(ctx);

        const adminUsername = process.env.ADMIN_TELEGRAM || "vanggohh";

        await safeEditOrReply(ctx, supportMessage(adminUsername), buildSupportKeyboard(adminUsername));
    });

    // === USER PROFILE SECTION ===

    // /me command - User profile with order stats
    bot.command("me", async (ctx) => {
        const telegramId = String(ctx.from.id);
        const [balance, orders] = await Promise.all([
            getBalance(ctx.from.id),
            prisma.order.findMany({ where: { odelegramId: telegramId } }),
        ]);

        const totalOrders = orders.length;
        const totalSpent = orders
            .filter(o => o.status === "DELIVERED" || o.status === "PAID")
            .reduce((sum, o) => sum + o.finalAmount, 0);

        await ctx.reply(
            accountMessage({ ctx, balance, orderCount: totalOrders, totalSpent }),
            {
                parse_mode: "HTML",
                ...Markup.inlineKeyboard([
                    [Markup.button.callback("💳 Mở ví", "WALLET")],
                    [Markup.button.callback("📦 Đơn hàng", "MY_ORDERS")],
                    [Markup.button.callback("🏠 Menu", "BACK_HOME")],
                ]),
            }
        );
    });

    bot.action("ACCOUNT", async (ctx) => {
        await answerCallback(ctx);
        const telegramId = String(ctx.from.id);
        const [balance, orders] = await Promise.all([
            getBalance(ctx.from.id),
            prisma.order.findMany({ where: { odelegramId: telegramId } }),
        ]);
        const totalSpent = orders
            .filter((order) => order.status === "DELIVERED" || order.status === "PAID")
            .reduce((sum, order) => sum + order.finalAmount, 0);

        await safeEditOrReply(ctx, accountMessage({
            ctx,
            balance,
            orderCount: orders.length,
            totalSpent,
        }), {
            ...Markup.inlineKeyboard([
                [Markup.button.callback("💳 Mở ví", "WALLET")],
                [Markup.button.callback("📦 Đơn hàng", "MY_ORDERS")],
                [Markup.button.callback("🏠 Menu", "BACK_HOME")],
            ]),
        });
    });

    // MY_ORDERS - Show user's orders with clickable list
    bot.action("MY_ORDERS", async (ctx) => {
        await answerCallback(ctx);
        const telegramId = String(ctx.from.id);

        const orders = await prisma.order.findMany({
            where: { odelegramId: telegramId },
            include: {
                product: {
                    include: { category: true }
                }
            },
            orderBy: { createdAt: "desc" },
            take: 20,
        });

        await safeEditOrReply(ctx, ordersMessage(orders), buildOrderListKeyboard(orders));
    });

    // ORDER detail - Show single order details
    bot.action(/^ORDER:(.+)$/, async (ctx) => {
        await answerCallback(ctx);
        const orderId = ctx.match[1];

        const order = await prisma.order.findUnique({
            where: { id: orderId },
            include: {
                product: {
                    include: { category: true }
                }
            },
        });

        if (!order) {
            return ctx.reply("Không tìm thấy đơn hàng.");
        }

        if (order.odelegramId !== String(ctx.from.id) && !isAdmin(ctx.from.id)) {
            return ctx.reply("Bạn không có quyền xem đơn hàng này.");
        }

        await safeEditOrReply(ctx, orderDetailMessage(order), buildOrderDetailKeyboard(order));
    });

    // Cancel order - Confirmation
    bot.action(/^CANCEL_ORDER:(.+)$/, async (ctx) => {
        await answerCallback(ctx);
        const orderId = ctx.match[1];

        const order = await prisma.order.findUnique({
            where: { id: orderId },
            include: { product: true }
        });

        if (!order) {
            return ctx.reply("Không tìm thấy đơn hàng.");
        }

        // Verify ownership
        if (order.odelegramId !== String(ctx.from.id)) {
            return ctx.reply("Bạn không có quyền hủy đơn hàng này.");
        }

        // Check if can cancel
        if (order.status === "DELIVERED") {
            return ctx.reply("Không thể hủy đơn hàng đã giao.");
        }

        if (order.status === "CANCELED") {
            return ctx.reply("Đơn hàng đã bị hủy trước đó.");
        }

        // Show confirmation
        await safeEditOrReply(ctx, `<b>Xác nhận hủy đơn</b>
${DIVIDER}
Mã đơn: <code>${escapeHtml(order.id.slice(-8).toUpperCase())}</code>
Sản phẩm: <b>${escapeHtml(order.product.name)}</b>
Số tiền: <b>${formatPrice(order.finalAmount)}</b>

${order.status === "PAID" && String(order.paymentMethod).toLowerCase() === "wallet"
                ? "Số tiền sẽ được hoàn lại vào ví của bạn.\n\n"
                : ""}Bạn có chắc chắn muốn hủy đơn hàng này?`, {
            ...Markup.inlineKeyboard([
                [Markup.button.callback("Xác nhận hủy", `CONFIRM_CANCEL:${orderId}`)],
                [Markup.button.callback("← Quay lại đơn", `ORDER:${orderId}`)],
            ]),
        });
    });

    // Confirm cancel order
    bot.action(/^CONFIRM_CANCEL:(.+)$/, async (ctx) => {
        await answerCallback(ctx);
        const orderId = ctx.match[1];

        const order = await prisma.order.findUnique({
            where: { id: orderId },
            include: { product: true, user: true }
        });

        if (!order) {
            return ctx.reply("Không tìm thấy đơn hàng.");
        }

        // Verify ownership
        if (order.odelegramId !== String(ctx.from.id)) {
            return ctx.reply("Bạn không có quyền hủy đơn hàng này.");
        }

        // Check if already canceled
        if (order.status === "CANCELED") {
            return ctx.reply("Đơn hàng đã bị hủy.");
        }

        // Check if delivered
        if (order.status === "DELIVERED") {
            return ctx.reply("Không thể hủy đơn hàng đã giao.");
        }

        try {
            // Process refund if paid with wallet
            let refundAmount = 0;
            let refundResult = null;
            if (order.status === "PAID" && String(order.paymentMethod).toLowerCase() === "wallet") {
                refundAmount = order.finalAmount;
                refundResult = await walletRefund(
                    order.odelegramId,
                    refundAmount,
                    order.id,
                    `Hoàn tiền đơn hàng #${order.id.slice(-8).toUpperCase()}`
                );
                if (!refundResult?.success) {
                    return ctx.reply(
                        `❌ <b>Không thể hủy đơn hàng</b>\n${DIVIDER}\nHoàn tiền thất bại: ${refundResult?.error || "lỗi không xác định"}.\nVui lòng liên hệ admin.`,
                        { parse_mode: "HTML" }
                    );
                }
            }

            // Update order status
            await prisma.order.update({
                where: { id: orderId },
                data: {
                    status: "CANCELED",
                    canceledAt: new Date(),
                    cancelReason: "User canceled"
                }
            });

            // Success message
            let successMsg = `<b>Đã hủy đơn hàng</b>
${DIVIDER}
Mã đơn: <code>${escapeHtml(order.id.slice(-8).toUpperCase())}</code>
Sản phẩm: <b>${escapeHtml(order.product.name)}</b>`;

            if (refundAmount > 0) {
                const newBalance = refundResult?.newBalance ?? await getBalance(order.odelegramId);
                successMsg += `\n\nĐã hoàn: <b>${formatPrice(refundAmount)}</b>\n`;
                successMsg += `Số dư mới: <b>${formatPrice(newBalance)}</b>`;
            }

            await safeEditOrReply(ctx, successMsg, {
                parse_mode: "HTML",
                ...Markup.inlineKeyboard([
                    [Markup.button.callback("📦 Đơn hàng", "MY_ORDERS")],
                    [Markup.button.callback("🏠 Menu", "BACK_HOME")]
                ])
            });

            // Notify admin
            sendLog("ORDER",
                `❌ *ĐƠN HÀNG BỊ HUỶ*\n` +
                `👤 User: \`${order.odelegramId}\`\n` +
                `🆔 Order: \`${order.id.slice(-8)}\`\n` +
                `📦 SP: ${order.product.name}\n` +
                `💰 Số tiền: ${order.finalAmount.toLocaleString()}đ\n` +
                (refundAmount > 0 ? `🔁 Đã hoàn về ví: ${refundAmount.toLocaleString()}đ` : "")
            );

        } catch (error) {
            console.error("Cancel order error:", error);
            await ctx.reply("Không thể hủy đơn hàng lúc này. Vui lòng liên hệ admin.");
        }
    });

    // === WALLET SECTION ===

    // /wallet command - quick access to wallet
    bot.command("wallet", async (ctx) => {
        const balance = await getBalance(ctx.from.id);

        await ctx.reply(
            walletMessage(balance),
            {
                parse_mode: "HTML",
                ...buildWalletKeyboard(),
            }
        );
    });

    // Wallet - Show balance and deposit options
    bot.action("WALLET", async (ctx) => {
        await answerCallback(ctx);
        const balance = await getBalance(ctx.from.id);

        await safeEditOrReply(ctx, walletMessage(balance), buildWalletKeyboard());
    });

    // Deposit - Create QR for deposit
    bot.action(/^DEPOSIT:(\d+)$/, async (ctx) => {
        await answerCallback(ctx);
        const amount = parseInt(ctx.match[1], 10);

        sendLog("DEPOSIT", `User ${ctx.from.id} requested DEPOSIT: ${amount} VND`);

        const tx = await createDeposit(ctx.from.id, amount);
        const depositContent = generateDepositContent(ctx.from.id, tx.id);
        const qrUrl = generateQRUrl(amount, depositContent);
        const expireMinutes = getExpireMinutes();

        const bankAccount = process.env.BANK_ACCOUNT || "321336";
        const bankName = process.env.BANK_NAME || "MBBank";
        const accountName = process.env.BANK_ACCOUNT_NAME || "PHAM VAN VIET";

        const msg = buildDepositMsg({ amount, depositContent, bankName, bankAccount, accountName, expireMinutes });

        const depositKeyboard = Markup.inlineKeyboard([
            [Markup.button.url("📷 Mở QR để quét", qrUrl)],
            [Markup.button.callback("✅ Tôi đã chuyển, kiểm tra", `DEPOSIT_CHECK:${tx.id}`)],
            [Markup.button.callback("← Quay lại ví", "WALLET")],
        ]);

        // Send text immediately — no delay for user
        await ctx.reply(msg, { parse_mode: "HTML", ...depositKeyboard });

        // Then try to send QR image in background (non-blocking)
        fetch(qrUrl, { signal: AbortSignal.timeout(8000) })
            .then(async (qrRes) => {
                if (!qrRes.ok) return;
                const qrBuffer = Buffer.from(await qrRes.arrayBuffer());
                await ctx.replyWithPhoto({ source: qrBuffer, filename: "qr.png" },
                    { caption: `📷 QR chuyển khoản — ${formatPrice(amount)}` });
            })
            .catch(() => {});
    });

    // ... (rest of code) ...
    // ... (rest of code) ...
    bot.action("DEPOSIT:CUSTOM", async (ctx) => {
        await answerCallback(ctx);

        sendLog("DEPOSIT", `User ${ctx.from.id} selected CUSTOM DEPOSIT`);

        ctx.session.pendingAction = "DEPOSIT_AMOUNT";

        await safeEditOrReply(ctx, `<b>Nạp tiền tùy chỉnh</b>
${DIVIDER}
Nhập số tiền muốn nạp.

Tối thiểu: <b>10.000đ</b>
Ví dụ: <code>50000</code>`, {
            ...Markup.inlineKeyboard([
                [Markup.button.callback("Hủy", "WALLET")],
            ]),
        });
    });

    // Transaction history
    bot.action("TX_HISTORY", async (ctx) => {
        await answerCallback(ctx);
        const transactions = await getTransactionHistory(ctx.from.id, 10);

        if (transactions.length === 0) {
            return safeEditOrReply(ctx, `<b>Lịch sử giao dịch</b>
${DIVIDER}
Chưa có giao dịch nào.`, {
                ...Markup.inlineKeyboard([[Markup.button.callback("🏠 Menu", "BACK_HOME")]]),
            });
        }

        const lines = transactions.map((tx) => {
            const sign = tx.amount >= 0 ? "+" : "";
            return `${escapeHtml(tx.type)} · ${tx.status === "SUCCESS" ? "Thành công" : tx.status === "PENDING" ? "Đang chờ" : "Thất bại"}
${sign}${formatPrice(tx.amount)} | Số dư: ${formatPrice(tx.balanceAfter)}
${formatDateTime(tx.createdAt)}`;
        });

        await safeEditOrReply(ctx, `<b>Lịch sử giao dịch</b>
${DIVIDER}
${lines.join("\n\n")}`, {
            ...Markup.inlineKeyboard([[Markup.button.callback("🏠 Menu", "BACK_HOME")]]),
        });
    });

    // Referral
    bot.action("REFERRAL", async (ctx) => {
        await answerCallback(ctx);
        const lang = getLang(ctx);

        const [user, botInfo] = await Promise.all([
            prisma.user.findUnique({ where: { telegramId: String(ctx.from.id) } }),
            getBotInfo(),
        ]);

        if (!user) return ctx.reply("Không tìm thấy tài khoản.");

        const stats = await getReferralStats(user.id);
        const link = getReferralLink(botInfo.username, stats.referralCode);

        await safeEditOrReply(
            ctx,
            `<b>Giới thiệu bạn bè</b>\n${DIVIDER}\n` +
            `Mã của bạn: <code>${stats.referralCode}</code>\n` +
            `Link: ${link}\n\n` +
            `Đã nhận: <b>${formatPrice(stats.balance)}</b>\n` +
            `Đã giới thiệu: <b>${stats.referralCount}</b> người\n` +
            `Hoa hồng: <b>${stats.commissionPercent}%</b> mỗi đơn`,
            {
                parse_mode: "HTML",
                disable_web_page_preview: true,
                ...Markup.inlineKeyboard([[Markup.button.callback("🏠 Menu", "BACK_HOME")]]),
            }
        );
    });

    // Helper: Shared Product List UI
    const renderProductList = async (ctx) => {
        return renderCategoryList();
    };

    const showProductDetail = async (ctx, productId, quantity = 1) => {
        const product = await getCachedProduct(productId);

        if (!product || !product.isActive) {
            return safeEditOrReply(ctx, "Sản phẩm không tồn tại hoặc đã ngừng bán.", {
                ...Markup.inlineKeyboard([
                    [Markup.button.callback("📁 Danh mục", "LIST_PRODUCTS")],
                    [Markup.button.callback("🏠 Menu", "BACK_HOME")],
                ]),
            });
        }

        const adminUsername = process.env.ADMIN_TELEGRAM || "vanggohh";
        if (product.price <= 0 || product.deliveryMode === "CONTACT") {
            return safeEditOrReply(ctx, contactProductMessage({ product, adminUsername }), {
                ...buildContactProductKeyboard(adminUsername, product.categoryId),
            });
        }

        const [stockCount, soldCount] = await Promise.all([
            product.deliveryMode === "STOCK_LINES" ? getStockCount(product.id) : Promise.resolve(null),
            prisma.order.count({ where: { productId: product.id, status: { in: ["PAID", "DELIVERED"] } } }),
        ]);
        const inStock = product.deliveryMode !== "STOCK_LINES" || stockCount > 0;
        const safeQuantity = Math.min(Math.max(Number(quantity) || 1, 1), 999);

        const text = productDetailMessage({ product, quantity: safeQuantity, stockCount, soldCount });
        const keyboard = buildProductDetailKeyboard({
            productId: product.id,
            quantity: safeQuantity,
            inStock,
            categoryId: product.categoryId,
        });

        const imageSource = product.imageFileId || product.imageUrl;
        if (imageSource) {
            const isPhotoMsg = !!(ctx.callbackQuery?.message?.photo?.length);
            if (isPhotoMsg) {
                try {
                    await ctx.answerCbQuery();
                    const caption = text.length > 1024 ? text.slice(0, 1021) + "..." : text;
                    await ctx.editMessageCaption(caption, { parse_mode: "HTML", ...keyboard });
                    return;
                } catch (e) {
                    if (e.message?.includes("message is not modified")) return;
                }
            } else {
                try {
                    await ctx.answerCbQuery();
                    try { await ctx.deleteMessage(); } catch {}
                    const caption = text.length > 1024 ? text.slice(0, 1021) + "..." : text;
                    const msg = await ctx.replyWithPhoto(imageSource, { caption, parse_mode: "HTML", ...keyboard });
                    getState(ctx.chat.id).lastMenuId = msg.message_id;
                    return;
                } catch {
                    // Fall through to text-only
                }
            }
        }

        return safeEditOrReply(ctx, text, keyboard);
    };

    // List products (Inline Action)
    // Show categories
    bot.action("LIST_PRODUCTS", async (ctx) => {
        await answerCallback(ctx);
        const ui = await renderCategoryList();

        await safeEditOrReply(ctx, ui.text, ui.keyboard);
    });

    bot.action(/^category_page:(\d+)$/i, async (ctx) => {
        await answerCallback(ctx);
        const ui = await renderCategoryList(Number(ctx.match[1]));
        await safeEditOrReply(ctx, ui.text, ui.keyboard);
    });

    bot.hears("🛍️ Sản Phẩm", async (ctx) => {
        const ui = await renderCategoryList();
        await cleanReply(ctx, ui.text, { parse_mode: "HTML", ...ui.keyboard });
    });

    bot.hears("❌ Đóng", async (ctx) => {
        try { await ctx.deleteMessage(); } catch {}
        await ctx.reply("Đã đóng menu. Gõ /start hoặc /menu để mở lại.", Markup.removeKeyboard());
    });

    bot.hears("Ẩn menu", async (ctx) => {
        try { await ctx.deleteMessage(); } catch {}
        await ctx.reply("Đã ẩn menu. Gõ /start hoặc /menu để mở lại.", Markup.removeKeyboard());
    });

    // Show products in category
    bot.action(/^(?:CATEGORY:|category:)(.+)$/i, async (ctx) => {
        await answerCallback(ctx);
        const categoryId = ctx.match[1];
        const ui = await renderProductsInCategory(categoryId);

        await safeEditOrReply(ctx, ui.text, ui.keyboard);
    });

    bot.action(/^products:(.+):(\d+)$/i, async (ctx) => {
        await answerCallback(ctx);
        const categoryId = ctx.match[1];
        const page = Number(ctx.match[2]);
        const ui = await renderProductsInCategory(categoryId, page);
        await safeEditOrReply(ctx, ui.text, ui.keyboard);
    });

    // Product detail
    bot.action(/^(?:PRODUCT:|product:)(.+)$/i, async (ctx) => {
        await answerCallback(ctx);
        const productId = ctx.match[1];
        await showProductDetail(ctx, productId, 1);
    });

    bot.action(/^qty_(inc|dec):(.+):(\d+)$/i, async (ctx) => {
        await answerCallback(ctx);
        const direction = ctx.match[1];
        const productId = ctx.match[2];
        const quantity = Math.max(1, Number(ctx.match[3]) || 1);
        const nextQuantity = direction === "inc" ? quantity + 1 : Math.max(1, quantity - 1);
        await showProductDetail(ctx, productId, nextQuantity);
    });

    bot.action(/^noop:/i, async (ctx) => {
        await answerCallback(ctx, "Chọn ➖ hoặc ➕ để đổi số lượng.");
    });

    // Custom quantity — show quick-pick buttons
    bot.action(/^CUSTOM_QTY:(.+)$/i, async (ctx) => {
        await answerCallback(ctx);
        const productId = ctx.match[1];

        const product = await prisma.product.findUnique({ where: { id: productId } });
        if (!product || !product.isActive) {
            return ctx.reply("Sản phẩm không khả dụng.");
        }

        const presets = [2, 3, 5, 10, 20, 50, 100];
        const rows = [];
        // Row of preset numbers (4 per row)
        for (let i = 0; i < presets.length; i += 4) {
            rows.push(
                presets.slice(i, i + 4).map((n) =>
                    Markup.button.callback(String(n), `qty_set:${productId}:${n}`)
                )
            );
        }
        rows.push([Markup.button.callback("✏️ Nhập số khác...", `QTY_TYPE:${productId}`)]);
        rows.push([Markup.button.callback("← Quay lại", `product:${productId}`)]);

        await safeEditOrReply(ctx,
            `<b>Chọn số lượng</b>\n${DIVIDER}\n` +
            `Sản phẩm: <b>${escapeHtml(product.name)}</b>\n` +
            `Giá: <b>${formatPrice(product.price)}</b>/cái`,
            { parse_mode: "HTML", ...Markup.inlineKeyboard(rows) }
        );
    });

    // Tap a preset quantity number → go straight to product detail with that qty
    bot.action(/^qty_set:(.+):(\d+)$/i, async (ctx) => {
        await answerCallback(ctx);
        const productId = ctx.match[1];
        const quantity = Math.max(1, Number(ctx.match[2]));
        await showProductDetail(ctx, productId, quantity);
    });

    // "Nhập số khác" → prompt text input
    bot.action(/^QTY_TYPE:(.+)$/i, async (ctx) => {
        await answerCallback(ctx);
        const productId = ctx.match[1];

        const product = await prisma.product.findUnique({ where: { id: productId } });
        if (!product || !product.isActive) {
            return ctx.reply("Sản phẩm không khả dụng.");
        }

        ctx.session.customQuantityProduct = productId;

        await safeEditOrReply(ctx,
            `<b>Nhập số lượng</b>\n${DIVIDER}\n` +
            `Sản phẩm: <b>${escapeHtml(product.name)}</b>\n` +
            `Giá: <b>${formatPrice(product.price)}</b>\n\n` +
            `Gửi số lượng bạn muốn mua, ví dụ: <code>15</code>`,
            { parse_mode: "HTML", ...Markup.inlineKeyboard([[Markup.button.callback("← Quay lại", `product:${productId}`)]]) }
        );
    });

    // Select quantity -> Ask for coupon
    bot.action(/^QTY:(.+):(\d+)$/i, async (ctx) => {
        await answerCallback(ctx);
        const lang = getLang(ctx);
        const productId = ctx.match[1];
        const quantity = Number(ctx.match[2]);

        const product = await prisma.product.findUnique({ where: { id: productId } });
        if (!product || !product.isActive) {
            return ctx.reply(t("productOutOfStock", lang));
        }

        if (product.deliveryMode === "STOCK_LINES") {
            const stockCount = await getStockCount(product.id);
            if (stockCount < quantity) {
                return ctx.reply(`Không đủ hàng. Hiện còn ${stockCount} sản phẩm.`);
            }
        }

        ctx.session.pendingOrder = {
            productId: product.id,
            productName: product.name,
            quantity,
            unitPrice: product.price,
            amount: product.price * quantity,
            currency: product.currency,
            discount: 0,
            finalAmount: product.price * quantity,
        };

        // Go directly to payment (skip coupon)
        await processPaymentFlow(ctx, ctx.session.pendingOrder);
    });

    bot.action(/^buy_now:(.+):(\d+)$/i, async (ctx) => {
        await answerCallback(ctx, "Đang chuẩn bị đơn hàng...");
        const productId = ctx.match[1];
        const quantity = Math.max(1, Number(ctx.match[2]) || 1);

        const product = await prisma.product.findUnique({ where: { id: productId } });
        if (!product || !product.isActive || product.price <= 0) {
            return ctx.reply("Sản phẩm không khả dụng. Vui lòng chọn sản phẩm khác.");
        }

        const stockCheck = await validateStockForQuantity(product, quantity);
        if (!stockCheck.ok) {
            return ctx.reply(stockCheck.message);
        }

        const orderData = createPendingOrder(ctx, product, quantity);
        await processPaymentFlow(ctx, orderData);
    });

    // Handle coupon input
    bot.on("text", async (ctx, next) => {
        // Handle custom quantity input first
        if (ctx.session?.customQuantityProduct) {
            const productId = ctx.session.customQuantityProduct;
            const quantityText = ctx.message.text.trim();
            const quantity = parseInt(quantityText, 10);

            // Validate quantity
            if (isNaN(quantity) || quantity < 1) {
                return ctx.reply(
                    `Số lượng không hợp lệ.\n\nVui lòng nhập số nguyên dương, ví dụ: 5, 10, 15.`,
                    Markup.inlineKeyboard([[Markup.button.callback("Hủy", "LIST_PRODUCTS")]])
                );
            }

            if (quantity > 999) {
                return ctx.reply(
                    `Số lượng quá lớn.\n\nVui lòng nhập số nhỏ hơn 1000.`,
                    Markup.inlineKeyboard([[Markup.button.callback("Hủy", "LIST_PRODUCTS")]])
                );
            }

            // Get product and validate stock
            const product = await prisma.product.findUnique({ where: { id: productId } });
            if (!product || !product.isActive) {
                delete ctx.session.customQuantityProduct;
                return ctx.reply("Sản phẩm không khả dụng.");
            }

            if (product.deliveryMode === "STOCK_LINES") {
                const stockCount = await getStockCount(product.id);
                if (stockCount < quantity) {
                    return ctx.reply(
                        `Không đủ hàng.\n\nCòn: ${stockCount}\nBạn muốn: ${quantity}`,
                        Markup.inlineKeyboard([[Markup.button.callback("← Quay lại gói", `PRODUCT:${productId}`)]])
                    );
                }
            }

            // Create pending order
            ctx.session.pendingOrder = {
                productId: product.id,
                productName: product.name,
                quantity,
                unitPrice: product.price,
                amount: product.price * quantity,
                currency: product.currency,
                discount: 0,
                finalAmount: product.price * quantity,
            };

            // Clear custom quantity session
            delete ctx.session.customQuantityProduct;

            // Go to payment
            await processPaymentFlow(ctx, ctx.session.pendingOrder);
            return;
        }

        // Handle coupon input
        if (!ctx.session?.pendingOrder) return next();
        if (ctx.message.text.startsWith("/")) return next();

        const lang = getLang(ctx);
        const couponCode = ctx.message.text.trim();
        const order = ctx.session.pendingOrder;

        const result = await validateCoupon(couponCode, order.amount);

        if (!result.valid) {
            let errorMsg;
            switch (result.error) {
                case "EXPIRED": errorMsg = t("couponExpired", lang); break;
                case "USED_UP": errorMsg = t("couponUsedUp", lang); break;
                case "MIN_ORDER": errorMsg = t("couponMinOrder", lang, { min: formatPrice(result.minOrder) }); break;
                default: errorMsg = t("couponInvalid", lang);
            }


            // Delete user's invalid coupon message
            await safeDelete(ctx);

            return ctx.reply(errorMsg + "\n\n" + t("enterCoupon", lang), Markup.inlineKeyboard([
                [Markup.button.callback(t("skipCoupon", lang), "SKIP_COUPON")],
                [Markup.button.callback(t("cancel", lang), "LIST_PRODUCTS")],
            ]));
        }

        const discount = calculateDiscount(result.coupon, order.amount);
        ctx.session.pendingOrder.couponId = result.coupon.id;
        ctx.session.pendingOrder.discount = discount;
        ctx.session.pendingOrder.finalAmount = order.amount - discount;

        // Go directly to payment (VietQR only)
        await processPaymentFlow(ctx, ctx.session.pendingOrder);
    });

    // Skip coupon -> Go to payment
    bot.action("SKIP_COUPON", async (ctx) => {
        await answerCallback(ctx);
        const order = ctx.session.pendingOrder;

        if (!order) return ctx.reply("Phiên thanh toán đã hết hạn. Vui lòng đặt lại.");

        order.discount = 0;
        order.finalAmount = order.amount;

        // Go directly to payment (VietQR only)
        await processPaymentFlow(ctx, order);
    });

    // Process payment - Check wallet first, then show options
    async function processPaymentFlow(ctx, orderData) {
        const [balance, product] = await Promise.all([
            getBalance(ctx.from.id),
            prisma.product.findUnique({ where: { id: orderData.productId } }),
        ]);
        const stockCheck = await validateStockForQuantity(product, orderData.quantity);
        if (!stockCheck.ok) {
            ctx.session.pendingOrder = null;
            return ctx.reply(stockCheck.message);
        }

        // Ensure finalAmount is set (fallback for old sessions)
        if (!orderData.finalAmount) {
            orderData.finalAmount = orderData.amount || 0;
            orderData.discount = orderData.discount || 0;
        }

        // Store order data in session for later use
        ctx.session.pendingOrder = orderData;

        const missing = Math.max(0, orderData.finalAmount - balance);
        const text = checkoutMessage({ orderData, balance, missing });
        const keyboard = buildCheckoutKeyboard({ canPayWallet: balance >= orderData.finalAmount });

        if (ctx.callbackQuery) {
            return safeEditOrReply(ctx, text, keyboard);
        }

        return ctx.reply(text, { parse_mode: "HTML", ...keyboard });
    }

    bot.action("CANCEL_CHECKOUT", async (ctx) => {
        await answerCallback(ctx, "Đã hủy thao tác thanh toán.");
        ctx.session.pendingOrder = null;
        await showMainMenu(ctx, { edit: true });
    });

    // Pay with wallet
    bot.action("PAY_WALLET", async (ctx) => {
        const _clearProcessing = () => { ctx.session.processingPayment = false; };
        try {
            await answerCallback(ctx, "⏳ Đang xử lý thanh toán...");
            const orderData = ctx.session.pendingOrder;

            if (!orderData) {
                return ctx.reply("Phiên thanh toán đã hết hạn. Vui lòng đặt lại.");
            }

            if (ctx.session.processingPayment) {
                return ctx.reply("⏳ Đơn hàng đang được xử lý, vui lòng chờ.");
            }
            ctx.session.processingPayment = true;

            const user = await getOrCreateUser(ctx.from);
            const balance = await getBalance(ctx.from.id);

            // Double check balance
            if (balance < orderData.finalAmount) {
                return ctx.reply("Số dư không đủ. Vui lòng nạp thêm.");
            }

            // Create order
            const order = await prisma.order.create({
                data: {
                    odelegramId: String(ctx.from.id),
                    chatId: String(ctx.chat.id),
                    productId: orderData.productId,
                    quantity: orderData.quantity,
                    amount: orderData.amount,
                    discount: orderData.discount || 0,
                    finalAmount: orderData.finalAmount,
                    currency: orderData.currency,
                    status: "PAID",
                    paymentMethod: "wallet",
                    couponId: orderData.couponId,
                    userId: user.id,
                },
            });

            if (orderData.couponId) {
                await applyCoupon(orderData.couponId);
            }

            // Deduct from wallet
            const purchaseResult = await walletPurchase(
                ctx.from.id,
                orderData.finalAmount,
                order.id,
                `Mua ${orderData.productName} x${orderData.quantity}`
            );

            if (!purchaseResult.success) {
                await prisma.order.update({
                    where: { id: order.id },
                    data: { status: "CANCELED" },
                });
                return ctx.reply(`Lỗi thanh toán: ${purchaseResult.error}`);
            }

            sendLog("ORDER", `✅ Order Success (Wallet): User ${ctx.from.id} bought ${orderData.productName} x${orderData.quantity} - ${formatPrice(orderData.finalAmount)}`);

            ctx.session.pendingOrder = null;

            // Delete the confirmation message
            await safeDelete(ctx);

            await deliverOrder({ prisma, telegram: ctx.telegram, order });
            const updatedOrder = await prisma.order.findUnique({
                where: { id: order.id },
                include: { product: true },
            });

            await ctx.reply(
                orderSuccessMessage({
                    order: updatedOrder || order,
                    orderData,
                    balance: purchaseResult.newBalance,
                    method: "wallet",
                }),
                {
                    parse_mode: "HTML",
                    ...Markup.inlineKeyboard([
                        [Markup.button.callback("Xem đơn hàng", `ORDER:${order.id}`)],
                        [Markup.button.callback("🛒 Mua tiếp", "LIST_PRODUCTS")],
                        [Markup.button.callback("🏠 Menu", "BACK_HOME")],
                    ]),
                }
            );
        } catch (err) {
            console.error("PAY_WALLET error:", err);
            sendLog("ERROR", `❌ PAY_WALLET failed: User ${ctx.from?.id} - ${err.message}`);
            await ctx.reply(
                `<b>Lỗi thanh toán</b>\n${DIVIDER}\nCó lỗi xảy ra, vui lòng thử lại hoặc liên hệ hỗ trợ.`,
                { parse_mode: "HTML" }
            ).catch(() => { });
        } finally {
            _clearProcessing();
        }
    });

    // Pay with QR (direct)
    bot.action("PAY_QR", async (ctx) => {
        await answerCallback(ctx, "⏳ Đang tạo mã thanh toán...");
        const lang = getLang(ctx);
        const orderData = ctx.session.pendingOrder;

        if (!orderData) {
            return ctx.reply("Phiên thanh toán đã hết hạn. Vui lòng đặt lại.");
        }

        if (ctx.session.processingPayment) {
            return ctx.reply("⏳ Đơn hàng đang được xử lý, vui lòng chờ.");
        }
        ctx.session.processingPayment = true;

        let order = null;
        try {
            const user = await getOrCreateUser(ctx.from);

            order = await prisma.order.create({
                data: {
                    odelegramId: String(ctx.from.id),
                    chatId: String(ctx.chat.id),
                    productId: orderData.productId,
                    quantity: orderData.quantity,
                    amount: orderData.amount,
                    discount: orderData.discount || 0,
                    finalAmount: orderData.finalAmount,
                    currency: orderData.currency,
                    status: "PENDING",
                    paymentMethod: "vietqr",
                    couponId: orderData.couponId,
                    userId: user.id,
                },
            });

            sendLog("ORDER", `⏳ Order Created (QR Pending): User ${ctx.from.id} - ${orderData.productName} x${orderData.quantity} - ${formatPrice(orderData.finalAmount)}`);

            if (orderData.couponId) {
                await applyCoupon(orderData.couponId);
            }

            ctx.session.pendingOrder = null;

            // Create VietQR checkout
            const checkout = await createCheckout({
                orderId: order.id,
                amount: order.finalAmount,
                productName: orderData.productName,
                quantity: orderData.quantity,
            });

            await prisma.order.update({
                where: { id: order.id },
                data: { paymentRef: checkout.transferContent },
            });

            const orderKeyboard = Markup.inlineKeyboard([
                [Markup.button.url("Mở QR để quét", checkout.qrUrl)],
                [Markup.button.callback("✅ Tôi đã chuyển, kiểm tra", `ORDER_BANK_CHECK:${order.id}`)],
                [Markup.button.callback("Kiểm tra đơn hàng", `ORDER:${order.id}`)],
                [Markup.button.callback("Hủy đơn hàng", `CANCEL_ORDER:${order.id}`)],
            ]);

            // Download QR image server-side so Telegram can always receive it
            try {
                const qrRes = await fetch(checkout.qrUrl, { signal: AbortSignal.timeout(6000) });
                if (!qrRes.ok) throw new Error(`QR HTTP ${qrRes.status}`);
                const qrBuffer = Buffer.from(await qrRes.arrayBuffer());
                await ctx.replyWithPhoto(
                    { source: qrBuffer, filename: "qr.png" },
                    { caption: getPaymentMessage(checkout, lang), parse_mode: "HTML", ...orderKeyboard }
                );
            } catch (qrError) {
                console.log("❌ QR image fallback:", qrError.message);
                await ctx.reply(getPaymentMessage(checkout, lang), {
                    parse_mode: "HTML",
                    disable_web_page_preview: true,
                    ...orderKeyboard,
                });
            }

            // Remove redundant legacy message
        } catch (error) {
            console.error("PAY_QR error:", error);
            sendLog("ERROR", `❌ PAY_QR failed: User ${ctx.from?.id} - ${error.message}`);
            if (order?.id) {
                await prisma.order.update({
                    where: { id: order.id },
                    data: { status: "CANCELED" },
                }).catch(() => { });
            }
            await ctx.reply(
                `<b>Lỗi tạo thanh toán</b>\n${DIVIDER}\nCó lỗi xảy ra, vui lòng thử lại hoặc liên hệ hỗ trợ.`,
                { parse_mode: "HTML" }
            ).catch(() => { });
        } finally {
            ctx.session.processingPayment = false;
        }
    });

    // Cancel order
    bot.action(/^CANCEL:(.+)$/i, async (ctx) => {
        await answerCallback(ctx, "Đã hủy đơn.");
        const orderId = ctx.match[1];

        const order = await prisma.order.findUnique({ where: { id: orderId } });
        if (!order) return ctx.reply("Không tìm thấy đơn hàng.");
        if (order.odelegramId !== String(ctx.from.id)) return ctx.reply("Bạn không có quyền hủy đơn này.");
        if (order.status !== "PENDING") return ctx.reply("Không thể hủy đơn này.");

        await prisma.order.update({
            where: { id: orderId },
            data: { status: "CANCELED" },
        });

        await safeEditOrReply(ctx, `<b>Đã hủy đơn hàng</b>\n${DIVIDER}\nMã đơn: <code>${escapeHtml(orderId.slice(-8).toUpperCase())}</code>`, {
            ...Markup.inlineKeyboard([
                [Markup.button.callback("🛒 Mua hàng", "LIST_PRODUCTS")],
                [Markup.button.callback("🏠 Menu", "BACK_HOME")],
            ]),
        });
    });

    // Command: /order
    bot.command("order", async (ctx) => {
        const orderId = ctx.message.text.split(" ")[1];

        // If no order ID provided, show all orders
        if (!orderId) {
            const telegramId = String(ctx.from.id);
            const orders = await prisma.order.findMany({
                where: { odelegramId: telegramId },
                include: {
                    product: {
                        include: { category: true }
                    }
                },
                orderBy: { createdAt: "desc" },
                take: 20,
            });

            if (orders.length === 0) {
                return ctx.reply(ordersMessage([]), {
                    parse_mode: "HTML",
                    ...buildOrderListKeyboard([]),
                });
            }
            return ctx.reply(ordersMessage(orders), {
                parse_mode: "HTML",
                ...buildOrderListKeyboard(orders),
            });
        }

        // Show specific order details
        const order = await prisma.order.findFirst({
            where: {
                OR: [{ id: orderId }, { id: { endsWith: orderId } }],
                odelegramId: String(ctx.from.id),
            },
            include: { product: true },
        });

        if (!order) return ctx.reply("Không tìm thấy đơn hàng.");

        await ctx.reply(orderDetailMessage(order), {
            parse_mode: "HTML",
            ...buildOrderDetailKeyboard(order),
        });
    });

    // Command: /help
    bot.command("help", async (ctx) => {
        const adminUsername = process.env.ADMIN_TELEGRAM || "vanggohh";

        await ctx.reply(supportMessage(adminUsername), {
            parse_mode: "HTML",
            ...buildSupportKeyboard(adminUsername),
        });
    });

    // === REPLY KEYBOARD HANDLERS ===
    // Handle button presses from persistent keyboard
    // Delete BOTH user's button press AND previous bot message for cleaner chat

    bot.hears("💳 Nạp tiền", async (ctx) => {
        const balance = await getBalance(ctx.from.id);
        await cleanReply(ctx, walletMessage(balance), {
            parse_mode: "HTML",
            ...buildWalletKeyboard(),
        });
    });

    bot.hears("💳 Ví", async (ctx) => {
        const balance = await getBalance(ctx.from.id);
        await cleanReply(ctx, walletMessage(balance), {
            parse_mode: "HTML",
            ...buildWalletKeyboard(),
        });
    });

    bot.hears("💰 Nạp tiền", async (ctx) => {
        const balance = await getBalance(ctx.from.id);
        await cleanReply(ctx, walletMessage(balance), {
            parse_mode: "HTML",
            ...buildWalletKeyboard(),
        });
    });

    // Old handler checked - replaced by shared logic above OR restored if legacy needed
    bot.hears("🛒 Mua hàng", async (ctx) => {
        const ui = await renderProductList(ctx);
        // keepOldMenu = true: Giữ lại menu chính, hiển thị thêm list sản phẩm
        await cleanReply(ctx, ui.text, {
            parse_mode: "HTML",
            ...ui.keyboard
        }, true);
    });

    bot.hears("📦 Đơn hàng", async (ctx) => {
        const telegramId = String(ctx.from.id);
        const orders = await prisma.order.findMany({
            where: { odelegramId: telegramId },
            include: { product: true },
            orderBy: { createdAt: "desc" },
            take: 5,
        });

        await cleanReply(ctx, ordersMessage(orders), {
            parse_mode: "HTML",
            ...buildOrderListKeyboard(orders),
        });
    });

    bot.hears("📊 Lịch sử GD", async (ctx) => {
        const transactions = await getTransactionHistory(ctx.from.id, 5);
        if (transactions.length === 0) {
            return cleanReply(ctx, `<b>Lịch sử giao dịch</b>\n${DIVIDER}\nChưa có giao dịch nào.`, { parse_mode: "HTML" });
        }
        const lines = transactions.map((tx) => {
            const sign = tx.amount >= 0 ? "+" : "";
            return `${escapeHtml(tx.type)} · ${tx.status === "SUCCESS" ? "Thành công" : tx.status === "PENDING" ? "Đang chờ" : "Thất bại"}\n${sign}${formatPrice(tx.amount)} | Số dư: ${formatPrice(tx.balanceAfter)}\n${formatDateTime(tx.createdAt)}`;
        });
        await cleanReply(ctx, `<b>Lịch sử giao dịch</b>\n${DIVIDER}\n${lines.join("\n\n")}`, { parse_mode: "HTML" });
    });

    bot.hears("👤 Tài khoản", async (ctx) => {
        const telegramId = String(ctx.from.id);
        const [balance, orders] = await Promise.all([
            getBalance(ctx.from.id),
            prisma.order.findMany({ where: { odelegramId: telegramId } }),
        ]);
        const totalOrders = orders.length;
        const totalSpent = orders.filter(o => o.status === "DELIVERED" || o.status === "PAID").reduce((sum, o) => sum + o.finalAmount, 0);

        await cleanReply(ctx,
            accountMessage({ ctx, balance, orderCount: totalOrders, totalSpent }),
            {
                parse_mode: "HTML",
                ...Markup.inlineKeyboard([
                    [Markup.button.callback("💳 Mở ví", "WALLET")],
                    [Markup.button.callback("📦 Đơn hàng", "MY_ORDERS")],
                    [Markup.button.callback("🏠 Menu", "BACK_HOME")],
                ]),
            }
        );
    });

    bot.hears("🆘 Hỗ trợ", async (ctx) => {
        const adminUsername = process.env.ADMIN_TELEGRAM || "vanggohh";
        await cleanReply(ctx, supportMessage(adminUsername), {
            parse_mode: "HTML",
            ...buildSupportKeyboard(adminUsername),
        });
    });

    bot.hears("❓ Hỗ trợ", async (ctx) => {
        const adminUsername = process.env.ADMIN_TELEGRAM || "vanggohh";
        await cleanReply(ctx, supportMessage(adminUsername), {
            parse_mode: "HTML",
            ...buildSupportKeyboard(adminUsername),
        });
    });

    bot.hears("🛠️ Admin", async (ctx) => {
        if (!isAdmin(ctx.from.id)) {
            return cleanReply(ctx, "Bạn không có quyền truy cập.");
        }
        await ctx.reply("/admin");
    });

    bot.hears("🛠 Admin", async (ctx) => {
        if (!isAdmin(ctx.from.id)) {
            return cleanReply(ctx, "Bạn không có quyền truy cập.");
        }
        await ctx.reply("/admin");
    });

    bot.hears("🔧 Admin", async (ctx) => {
        if (!isAdmin(ctx.from.id)) {
            return cleanReply(ctx, "Bạn không có quyền truy cập.");
        }
        await ctx.reply("🔧 Đang mở Admin Panel...");
        // Send /admin command effect
        await ctx.telegram.sendMessage(ctx.chat.id, "/admin");
    });

    // Handle text messages (for custom deposit amount)
    bot.on("text", async (ctx, next) => {
        // Check if waiting for custom deposit amount
        if (ctx.session?.pendingAction === "DEPOSIT_AMOUNT") {
            const text = ctx.message.text.replace(/[,.\s]/g, "");
            const amount = parseInt(text, 10);

            if (isNaN(amount) || amount < 10000) {
                return ctx.reply("Số tiền không hợp lệ. Tối thiểu 10.000đ. Vui lòng nhập lại:");
            }

            ctx.session.pendingAction = null;

            const tx = await createDeposit(ctx.from.id, amount);
            const depositContent = generateDepositContent(ctx.from.id, tx.id);
            const qrUrl = generateQRUrl(amount, depositContent);
            const expireMinutes = getExpireMinutes();

            const bankName = process.env.BANK_NAME || "MBBank";
            const bankAccount = process.env.BANK_ACCOUNT || "321336";
            const accountName = process.env.BANK_ACCOUNT_NAME || "PHAM VAN VIET";
            const msg = buildDepositMsg({ amount, depositContent, bankName, bankAccount, accountName, expireMinutes });

            const depositKeyboard2 = Markup.inlineKeyboard([
                [Markup.button.url("📷 Mở QR để quét", qrUrl)],
                [Markup.button.callback("✅ Tôi đã chuyển, kiểm tra", `DEPOSIT_CHECK:${tx.id}`)],
                [Markup.button.callback("← Quay lại ví", "WALLET")],
            ]);

            await ctx.reply(msg, { parse_mode: "HTML", ...depositKeyboard2 });

            fetch(qrUrl, { signal: AbortSignal.timeout(8000) })
                .then(async (qrRes) => {
                    if (!qrRes.ok) return;
                    const qrBuffer = Buffer.from(await qrRes.arrayBuffer());
                    await ctx.replyWithPhoto({ source: qrBuffer, filename: "qr.png" },
                        { caption: `📷 QR chuyển khoản — ${formatPrice(amount)}` });
                })
                .catch(() => {});
            return;
        }

        // Pass to next handler if not handled
        return next();
    });

    bot.action(/^DEPOSIT_CHECK:(.+)$/i, async (ctx) => {
        await answerCallback(ctx, "🔍 Đang kiểm tra...");
        const transactionId = ctx.match[1];

        try {
            const result = await confirmDepositByBankScan(transactionId, ctx.from.id);

            if (result.success && result.alreadyProcessed) {
                return ctx.reply(
                    `✅ <b>Giao dịch đã được xử lý</b>\n${DIVIDER}\n💳 Số dư hiện tại: <b>${formatPrice(result.newBalance || 0)}</b>`,
                    { parse_mode: "HTML" },
                );
            }

            if (result.success) {
                sendLog("DEPOSIT", `Manual deposit confirmed: User ${ctx.from.id} - ${formatPrice(result.matched?.amount || 0)} - ${result.paymentRef}`);
                return ctx.reply(
                    `✅ <b>Nạp tiền thành công!</b>\n${DIVIDER}\n💰 Số tiền: <b>+${formatPrice(result.matched?.amount || 0)}</b>\n💳 Số dư mới: <b>${formatPrice(result.newBalance || 0)}</b>`,
                    {
                        parse_mode: "HTML",
                        ...Markup.inlineKeyboard([
                            [Markup.button.callback("💳 Xem ví", "WALLET")],
                            [Markup.button.callback("🏠 Menu", "BACK_HOME")],
                        ]),
                    },
                );
            }

            return ctx.reply(
                `⏳ <b>Chưa tìm thấy giao dịch</b>\n${DIVIDER}\nNếu vừa chuyển khoản, hãy chờ 15-30 giây rồi bấm kiểm tra lại.`,
                { parse_mode: "HTML" },
            );
        } catch (error) {
            console.error("DEPOSIT_CHECK error:", error);
            sendLog("ERROR", `DEPOSIT_CHECK failed: User ${ctx.from?.id} - ${error.message}`);
            return ctx.reply(
                `❌ <b>Không kiểm tra được lúc này</b>\n${DIVIDER}\nVui lòng thử lại sau ít phút.`,
                { parse_mode: "HTML" },
            );
        }
    });

    // Manual bank check for VietQR orders
    bot.action(/^ORDER_BANK_CHECK:(.+)$/, async (ctx) => {
        await answerCallback(ctx, "🔍 Đang kiểm tra giao dịch...");
        const orderId = ctx.match[1];

        try {
            const result = await confirmOrderByBankScan(orderId, ctx.from.id);

            if (!result.success) {
                return ctx.reply(
                    `⏳ <b>Chưa tìm thấy giao dịch</b>\n${DIVIDER}\n${escapeHtml(result.error || "")}\n\nNếu vừa chuyển khoản, hãy chờ 30–60 giây rồi bấm kiểm tra lại.`,
                    { parse_mode: "HTML" },
                );
            }

            if (result.alreadyProcessed) {
                const order = await prisma.order.findUnique({
                    where: { id: orderId },
                    include: { product: { include: { category: true } } },
                });
                return safeEditOrReply(ctx, orderDetailMessage(order), buildOrderDetailKeyboard(order));
            }

            // Deliver the order now
            await deliverOrder({ prisma, telegram: ctx.telegram, order: result.order });

            const deliveredOrder = await prisma.order.findUnique({
                where: { id: orderId },
                include: { product: { include: { category: true } } },
            });
            return safeEditOrReply(ctx, orderDetailMessage(deliveredOrder), buildOrderDetailKeyboard(deliveredOrder));
        } catch (error) {
            console.error("ORDER_BANK_CHECK error:", error);
            sendLog("ERROR", `ORDER_BANK_CHECK failed: User ${ctx.from?.id} - ${error.message}`);
            return ctx.reply(
                `❌ <b>Không kiểm tra được lúc này</b>\n${DIVIDER}\nVui lòng thử lại sau ít phút.`,
                { parse_mode: "HTML" },
            );
        }
    });

    return bot;
}
