import { Telegraf, Markup, session } from "telegraf";
import { prisma } from "./db.js";
import { t, getLanguages } from "./i18n/index.js";
import { rateLimitMiddleware } from "./ratelimit.js";
import { getStockCount, checkStock } from "./inventory.js";
import { validateCoupon, calculateDiscount, applyCoupon } from "./coupon.js";
import { getOrCreateUser, getReferralStats, getReferralLink, processReferralCommission } from "./referral.js";
import { renderCategoryList, renderProductsInCategory, renderAllProducts } from "./category.js";
import { createCheckout, getPaymentMessage, getExpireMinutes } from "./payment/provider.js";
import { generateQRUrl, generateTransferContent } from "./payment/vietqr.js";
import {
    getBalance,
    createDeposit,
    confirmDepositByBankScan,
    getTransactionHistory,
    formatTransaction,
    generateDepositContent,
    purchase as walletPurchase,
    refund as walletRefund,
    getOrCreateWallet,
} from "./wallet.js";
import { deliverOrder } from "./delivery.js";
import { sendLog } from "./lib/logger.js";
import {
    formatCurrency,
    escapeHtml,
    formatDateTime,
    getShopName,
    statusLabel,
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
        ctx.reply("❌ Có lỗi xảy ra, vui lòng thử lại hoặc liên hệ hỗ trợ.").catch(() => { });
    });



    // Helper to get user language
    const getLang = (ctx) => ctx.session?.language || "vi";

    // Helper to format price
    const formatPrice = (amount, currency = "VND") => {
        return formatCurrency(amount, currency);
    };

    // cleanReply = alias for sendMenu (backward compatibility)
    const cleanReply = sendMenu;

    const buildDepositKeyboard = (qrUrl, transactionId) => Markup.inlineKeyboard([
        [Markup.button.url("📱 Mở QR để quét", qrUrl)],
        [Markup.button.callback("✅ Tôi đã chuyển, kiểm tra lại", `DEPOSIT_CHECK:${transactionId}`)],
        [Markup.button.callback("⬅️ Quay lại", "WALLET")],
    ]);

    const buildDepositCheckKeyboard = (transactionId) => Markup.inlineKeyboard([
        [Markup.button.callback("✅ Tôi đã chuyển, kiểm tra lại", `DEPOSIT_CHECK:${transactionId}`)],
        [Markup.button.callback("⬅️ Quay lại", "WALLET")],
    ]);

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
            prisma.product.count({ where: { isActive: true } }),
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
        await ctx.answerCbQuery("📭 Chưa có sản phẩm. Vui lòng quay lại sau!", { show_alert: true });
    });

    bot.action("SEARCH_PRODUCTS", async (ctx) => {
        await answerCallback(ctx);
        await safeEditOrReply(ctx, searchPromptMessage(), {
            ...Markup.inlineKeyboard([
                [Markup.button.callback("📂 Xem danh mục", "LIST_PRODUCTS")],
                [Markup.button.callback("🏠 Menu chính", "BACK_HOME")],
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
            return safeEditOrReply(ctx, "🔥 <b>Sản phẩm hot</b>\n\nHiện chưa có sản phẩm đang mở bán.", {
                ...Markup.inlineKeyboard([
                    [Markup.button.callback("📂 Danh mục", "LIST_PRODUCTS")],
                    [Markup.button.callback("🏠 Menu chính", "BACK_HOME")],
                ]),
            });
        }

        const lines = products.map((product, index) => `${index + 1}. <b>${escapeHtml(product.name)}</b>\n💰 ${formatPrice(product.price, product.currency)}`);
        await safeEditOrReply(ctx, `🔥 <b>Sản phẩm hot</b>\n\n${lines.join("\n\n")}`, {
            ...Markup.inlineKeyboard([
                ...products.map((product) => [Markup.button.callback(`🧾 ${truncateText(product.name, 34)}`, `product:${product.id}`)]),
                [Markup.button.callback("📂 Danh mục", "LIST_PRODUCTS")],
                [Markup.button.callback("🏠 Menu chính", "BACK_HOME")],
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
        await ctx.reply(`👋 Chào <b>${ctx.from.first_name || "bạn"}</b>! Dùng menu bên dưới để điều hướng.`, { parse_mode: "HTML", ...replyKbd });

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

        await ctx.editMessageText(
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

        await ctx.editMessageText(
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
        await safeEditOrReply(ctx, `📘 <b>Hướng dẫn mua hàng</b>

1. Bấm <b>🛒 Mua hàng</b> hoặc <b>📂 Danh mục</b>.
2. Chọn danh mục và sản phẩm cần mua.
3. Chọn số lượng, thêm vào giỏ hoặc mua ngay.
4. Kiểm tra đơn hàng và chọn ví hoặc chuyển khoản QR.
5. Sau khi thanh toán thành công, bot giao hàng tự động.`, {
            ...Markup.inlineKeyboard([
                [Markup.button.callback("🛒 Mua hàng", "LIST_PRODUCTS")],
                [Markup.button.callback("⬅️ Quay lại", "HELP")],
            ]),
        });
    });

    bot.action("HELP:WALLET", async (ctx) => {
        await answerCallback(ctx);
        await safeEditOrReply(ctx, `💳 <b>Ví và nạp tiền</b>

Bạn có thể nạp trước vào ví để mua nhanh hơn.
Khi nạp tiền, hãy chuyển đúng số tiền và đúng nội dung QR.
Số dư sẽ được cộng tự động sau khi hệ thống nhận giao dịch.`, {
            ...Markup.inlineKeyboard([
                [Markup.button.callback("💳 Nạp tiền", "WALLET")],
                [Markup.button.callback("⬅️ Quay lại", "HELP")],
            ]),
        });
    });

    bot.action("HELP:PAYMENT", async (ctx) => {
        await answerCallback(ctx);
        await safeEditOrReply(ctx, `❓ <b>Câu hỏi thường gặp</b>

<b>Thanh toán xong bao lâu nhận hàng?</b>
Thông thường 1-3 phút sau khi hệ thống xác nhận giao dịch.

<b>Chuyển sai nội dung thì sao?</b>
Hãy liên hệ admin và gửi ảnh giao dịch kèm mã đơn.

<b>Đơn hết hạn có thanh toán được không?</b>
Không nên thanh toán đơn đã hết hạn. Hãy tạo đơn mới để tránh sai lệch.`, {
            ...Markup.inlineKeyboard([[Markup.button.callback("⬅️ Quay lại", "HELP")]]),
        });
    });

    bot.action("HELP:REFERRAL", async (ctx) => {
        await answerCallback(ctx);
        await safeEditOrReply(ctx, `🎁 <b>Giới thiệu bạn bè</b>

Lấy link giới thiệu trong menu, gửi cho bạn bè.
Khi người được giới thiệu mua hàng thành công, hoa hồng sẽ được ghi nhận theo cấu hình shop.`, {
            ...Markup.inlineKeyboard([[Markup.button.callback("⬅️ Quay lại", "HELP")]]),
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
        const completedOrders = orders.filter(o => o.status === "DELIVERED").length;
        const totalSpent = orders
            .filter(o => o.status === "DELIVERED" || o.status === "PAID")
            .reduce((sum, o) => sum + o.finalAmount, 0);

        await ctx.reply(
            accountMessage({ ctx, balance, orderCount: totalOrders, totalSpent }),
            {
                parse_mode: "HTML",
                ...Markup.inlineKeyboard([
                    [Markup.button.callback("💳 Nạp tiền", "WALLET")],
                    [Markup.button.callback("📦 Đơn hàng của tôi", "MY_ORDERS")],
                    [Markup.button.callback("🏠 Menu chính", "BACK_HOME")],
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
                [Markup.button.callback("💳 Nạp tiền", "WALLET")],
                [Markup.button.callback("📦 Đơn hàng của tôi", "MY_ORDERS")],
                [Markup.button.callback("🏠 Menu chính", "BACK_HOME")],
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
            return ctx.reply("❌ Không tìm thấy đơn hàng");
        }

        if (order.odelegramId !== String(ctx.from.id) && !isAdmin(ctx.from.id)) {
            return ctx.reply("❌ Bạn không có quyền xem đơn hàng này.");
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
            return ctx.reply("❌ Không tìm thấy đơn hàng");
        }

        // Verify ownership
        if (order.odelegramId !== String(ctx.from.id)) {
            return ctx.reply("❌ Bạn không có quyền huỷ đơn hàng này");
        }

        // Check if can cancel
        if (order.status === "DELIVERED") {
            return ctx.reply("❌ Không thể huỷ đơn hàng đã giao");
        }

        if (order.status === "CANCELED") {
            return ctx.reply("❌ Đơn hàng đã bị huỷ trước đó");
        }

        // Show confirmation
        await safeEditOrReply(ctx, `⚠️ <b>Xác nhận hủy đơn hàng</b>

Mã đơn: <code>${escapeHtml(order.id.slice(-8).toUpperCase())}</code>
Sản phẩm: <b>${escapeHtml(order.product.name)}</b>
Số tiền: <b>${formatPrice(order.finalAmount)}</b>

${order.status === "PAID" && String(order.paymentMethod).toLowerCase() === "wallet"
                ? "Số tiền sẽ được hoàn lại vào ví của bạn.\n\n"
                : ""}Bạn có chắc chắn muốn hủy đơn hàng này?`, {
            ...Markup.inlineKeyboard([
                [Markup.button.callback("✅ Xác nhận hủy", `CONFIRM_CANCEL:${orderId}`)],
                [Markup.button.callback("⬅️ Quay lại", `ORDER:${orderId}`)],
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
            return ctx.reply("❌ Không tìm thấy đơn hàng");
        }

        // Verify ownership
        if (order.odelegramId !== String(ctx.from.id)) {
            return ctx.reply("❌ Bạn không có quyền huỷ đơn hàng này");
        }

        // Check if already canceled
        if (order.status === "CANCELED") {
            return ctx.reply("❌ Đơn hàng đã bị huỷ");
        }

        // Check if delivered
        if (order.status === "DELIVERED") {
            return ctx.reply("❌ Không thể huỷ đơn hàng đã giao");
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
            let successMsg = `✅ <b>Đã hủy đơn hàng</b>

Mã đơn: <code>${escapeHtml(order.id.slice(-8).toUpperCase())}</code>
Sản phẩm: <b>${escapeHtml(order.product.name)}</b>`;

            if (refundAmount > 0) {
                const newBalance = refundResult?.newBalance ?? await getBalance(order.odelegramId);
                successMsg += `\n\n💰 Đã hoàn: <b>${formatPrice(refundAmount)}</b>\n`;
                successMsg += `💵 Số dư mới: <b>${formatPrice(newBalance)}</b>`;
            }

            await ctx.editMessageText(successMsg, {
                parse_mode: "HTML",
                ...Markup.inlineKeyboard([
                    [Markup.button.callback("📦 Đơn hàng của tôi", "MY_ORDERS")],
                    [Markup.button.callback("🏠 Menu chính", "BACK_HOME")]
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
            await ctx.reply("❌ Lỗi khi huỷ đơn hàng. Vui lòng liên hệ admin.");
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
        await answerCallback(ctx, "⏳ Đang tạo mã QR...");
        const amount = parseInt(ctx.match[1], 10);

        sendLog("DEPOSIT", `User ${ctx.from.id} requested DEPOSIT: ${amount} VND`);

        // Create pending deposit transaction
        const tx = await createDeposit(ctx.from.id, amount);
        const depositContent = generateDepositContent(ctx.from.id, tx.id);
        const qrUrl = generateQRUrl(amount, depositContent);

        console.log("📱 QR URL:", qrUrl); // Debug log

        const expireMinutes = getExpireMinutes();

        const bankAccount = process.env.BANK_ACCOUNT || "321336";
        const bankName = process.env.BANK_NAME || "MBBank";
        const accountName = process.env.BANK_ACCOUNT_NAME || "PHAM VAN VIET";

        const msg = `💳 <b>Nạp tiền vào ví</b>

━━━━━━━━━━━━━━
Số tiền: <b>${formatPrice(amount)}</b>
Nội dung CK: <code>${escapeHtml(depositContent)}</code>

Ngân hàng: <b>${escapeHtml(bankName)}</b>
STK: <code>${escapeHtml(bankAccount)}</code>
Chủ TK: <b>${escapeHtml(accountName)}</b>

⚠️ Chuyển đúng số tiền và ghi đúng nội dung.
Mã nạp hết hạn sau <b>${expireMinutes} phút</b>.

Số dư sẽ được cộng tự động trong 1-3 phút.`;

        const depositKeyboard = Markup.inlineKeyboard([
            [Markup.button.url("📱 Mở QR để quét", qrUrl)],
            [Markup.button.callback("✅ Đã chuyển — kiểm tra ngay", `DEPOSIT_CHECK:${tx.id}`)],
            [Markup.button.callback("⬅️ Quay lại", "WALLET")],
        ]);

        try {
            const qrRes = await fetch(qrUrl, { signal: AbortSignal.timeout(6000) });
            if (!qrRes.ok) throw new Error(`QR HTTP ${qrRes.status}`);
            const qrBuffer = Buffer.from(await qrRes.arrayBuffer());
            await ctx.replyWithPhoto({ source: qrBuffer, filename: "qr.png" }, { caption: msg, parse_mode: "HTML", ...depositKeyboard });
        } catch {
            await ctx.reply(msg, { parse_mode: "HTML", ...depositKeyboard });
        }
    });

    // ... (rest of code) ...
    // ... (rest of code) ...
    bot.action("DEPOSIT:CUSTOM", async (ctx) => {
        await answerCallback(ctx);

        sendLog("DEPOSIT", `User ${ctx.from.id} selected CUSTOM DEPOSIT`);

        ctx.session.pendingAction = "DEPOSIT_AMOUNT";

        await safeEditOrReply(ctx, `💳 <b>Nạp tiền vào ví</b>

Nhập số tiền muốn nạp.
Tối thiểu: <b>10.000đ</b>

Ví dụ: <code>50000</code>`, {
            ...Markup.inlineKeyboard([
                [Markup.button.callback("❌ Hủy", "WALLET")],
            ]),
        });
    });

    // Transaction history
    bot.action("TX_HISTORY", async (ctx) => {
        await answerCallback(ctx);
        const transactions = await getTransactionHistory(ctx.from.id, 10);

        if (transactions.length === 0) {
            return safeEditOrReply(ctx, `📊 <b>Lịch sử giao dịch</b>

Chưa có giao dịch nào.`, {
                ...Markup.inlineKeyboard([[Markup.button.callback("🏠 Menu chính", "BACK_HOME")]]),
            });
        }

        const lines = transactions.map((tx) => {
            const sign = tx.amount >= 0 ? "+" : "";
            return `${escapeHtml(tx.type)} ${tx.status === "SUCCESS" ? "✅" : tx.status === "PENDING" ? "⏳" : "❌"}
${sign}${formatPrice(tx.amount)} | Số dư: ${formatPrice(tx.balanceAfter)}
${formatDateTime(tx.createdAt)}`;
        });

        await safeEditOrReply(ctx, `📊 <b>Lịch sử giao dịch</b>

${lines.join("\n\n")}`, {
            ...Markup.inlineKeyboard([[Markup.button.callback("🏠 Menu chính", "BACK_HOME")]]),
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

        if (!user) return ctx.reply("❌ User not found");

        const stats = await getReferralStats(user.id);
        const link = getReferralLink(botInfo.username, stats.referralCode);

        await ctx.editMessageText(
            `👥 <b>Chương trình giới thiệu</b>\n\n` +
            `🔗 Mã của bạn: <code>${stats.referralCode}</code>\n` +
            `📎 Link: ${link}\n\n` +
            `💰 Đã nhận: ${formatPrice(stats.balance)}\n` +
            `👥 Đã giới thiệu: ${stats.referralCount} người\n` +
            `🎁 Hoa hồng: ${stats.commissionPercent}% mỗi đơn`,
            {
                parse_mode: "HTML",
                disable_web_page_preview: true,
                ...Markup.inlineKeyboard([[Markup.button.callback(t("back", lang), "BACK_HOME")]]),
            }
        );
    });

    // Helper: Shared Product List UI
    const renderProductList = async (ctx) => {
        return renderCategoryList();
    };

    const showProductDetail = async (ctx, productId, quantity = 1) => {
        const product = await prisma.product.findUnique({
            where: { id: productId },
            include: { category: true },
        });

        if (!product || !product.isActive) {
            return safeEditOrReply(ctx, "❌ Sản phẩm không tồn tại hoặc đã ngừng bán.", {
                ...Markup.inlineKeyboard([
                    [Markup.button.callback("📂 Danh mục", "LIST_PRODUCTS")],
                    [Markup.button.callback("🏠 Menu chính", "BACK_HOME")],
                ]),
            });
        }

        const adminUsername = process.env.ADMIN_TELEGRAM || "vanggohh";
        if (product.price <= 0) {
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

        return safeEditOrReply(ctx, productDetailMessage({
            product,
            quantity: safeQuantity,
            stockCount,
            soldCount,
        }), {
            ...buildProductDetailKeyboard({
                productId: product.id,
                quantity: safeQuantity,
                inStock,
                categoryId: product.categoryId,
            }),
        });
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
        await ctx.reply("✅ Đã đóng menu. Gõ /start hoặc /menu để mở lại.", Markup.removeKeyboard());
    });

    bot.hears("🛒 Mua hàng", async (ctx) => {
        const ui = await renderCategoryList();
        await cleanReply(ctx, ui.text, {
            parse_mode: "HTML",
            ...ui.keyboard
        });
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

    // Custom quantity input
    bot.action(/^CUSTOM_QTY:(.+)$/i, async (ctx) => {
        await answerCallback(ctx);
        const productId = ctx.match[1];

        const product = await prisma.product.findUnique({ where: { id: productId } });
        if (!product || !product.isActive) {
            return ctx.reply("❌ Sản phẩm không khả dụng");
        }

        ctx.session.customQuantityProduct = productId;

        await safeEditOrReply(ctx,
            `📝 <b>Nhập số lượng</b>\n\n` +
            `📦 Sản phẩm: ${escapeHtml(product.name)}\n` +
            `💰 Giá: ${formatPrice(product.price)}\n\n` +
            `Gửi số lượng bạn muốn mua (ví dụ: 15):`,
            {
                ...Markup.inlineKeyboard([[Markup.button.callback("❌ Huỷ", "LIST_PRODUCTS")]]),
            }
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
            return ctx.reply("❌ " + t("productOutOfStock", lang));
        }

        if (product.deliveryMode === "STOCK_LINES") {
            const stockCount = await getStockCount(product.id);
            if (stockCount < quantity) {
                return ctx.reply(`❌ Không đủ hàng! Còn ${stockCount} sản phẩm.`);
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
            return ctx.reply("❌ Sản phẩm không khả dụng. Vui lòng chọn sản phẩm khác.");
        }

        const stockCheck = await validateStockForQuantity(product, quantity);
        if (!stockCheck.ok) {
            return ctx.reply(`❌ ${stockCheck.message}`);
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
                    `❌ Số lượng không hợp lệ!\n\nVui lòng nhập số nguyên dương (ví dụ: 5, 10, 15)`,
                    Markup.inlineKeyboard([[Markup.button.callback("❌ Huỷ", "LIST_PRODUCTS")]])
                );
            }

            if (quantity > 999) {
                return ctx.reply(
                    `❌ Số lượng quá lớn!\n\nVui lòng nhập số nhỏ hơn 1000`,
                    Markup.inlineKeyboard([[Markup.button.callback("❌ Huỷ", "LIST_PRODUCTS")]])
                );
            }

            // Get product and validate stock
            const product = await prisma.product.findUnique({ where: { id: productId } });
            if (!product || !product.isActive) {
                delete ctx.session.customQuantityProduct;
                return ctx.reply("❌ Sản phẩm không khả dụng");
            }

            if (product.deliveryMode === "STOCK_LINES") {
                const stockCount = await getStockCount(product.id);
                if (stockCount < quantity) {
                    return ctx.reply(
                        `❌ Không đủ hàng!\n\nCòn: ${stockCount} sản phẩm\nBạn muốn: ${quantity}`,
                        Markup.inlineKeyboard([[Markup.button.callback("🔙 Quay lại", `PRODUCT:${productId}`)]])
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

        if (!order) return ctx.reply("❌ Session expired");

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
            return ctx.reply(`❌ ${stockCheck.message}`);
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
        try {
            await answerCallback(ctx, "⏳ Đang xử lý thanh toán...");
            const orderData = ctx.session.pendingOrder;

            if (!orderData) {
                return ctx.reply("❌ Phiên thanh toán đã hết hạn. Vui lòng đặt lại.");
            }

            if (ctx.session.processingPayment) {
                return ctx.reply("⏳ Đơn hàng đang được xử lý, vui lòng chờ.");
            }
            ctx.session.processingPayment = true;

            const user = await getOrCreateUser(ctx.from);
            const balance = await getBalance(ctx.from.id);

            // Double check balance
            if (balance < orderData.finalAmount) {
                ctx.session.processingPayment = false;
                return ctx.reply("❌ Số dư không đủ. Vui lòng nạp thêm.");
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
                ctx.session.processingPayment = false;
                return ctx.reply(`❌ Lỗi thanh toán: ${purchaseResult.error}`);
            }

            sendLog("ORDER", `✅ Order Success (Wallet): User ${ctx.from.id} bought ${orderData.productName} x${orderData.quantity} - ${formatPrice(orderData.finalAmount)}`);

            ctx.session.pendingOrder = null;
            ctx.session.processingPayment = false;

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
                        [Markup.button.callback("📦 Xem đơn hàng", `ORDER:${order.id}`)],
                        [Markup.button.callback("🛒 Mua tiếp", "LIST_PRODUCTS")],
                        [Markup.button.callback("🏠 Menu chính", "BACK_HOME")],
                    ]),
                }
            );
        } catch (err) {
            ctx.session.processingPayment = false;
            console.error("PAY_WALLET error:", err);
            sendLog("ERROR", `❌ PAY_WALLET failed: User ${ctx.from?.id} - ${err.message}`);
            await ctx.reply(
                `❌ <b>Lỗi thanh toán</b>\n\nCó lỗi xảy ra, vui lòng thử lại hoặc liên hệ hỗ trợ.`,
                { parse_mode: "HTML" }
            ).catch(() => { });
        }
    });

    // Pay with QR (direct)
    bot.action("PAY_QR", async (ctx) => {
        await answerCallback(ctx, "⏳ Đang tạo mã thanh toán...");
        const lang = getLang(ctx);
        const orderData = ctx.session.pendingOrder;

        if (!orderData) {
            return ctx.reply("❌ Phiên thanh toán đã hết hạn. Vui lòng đặt lại.");
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
                [Markup.button.url("📱 Mở QR để quét", checkout.qrUrl)],
                [Markup.button.callback("🔄 Kiểm tra trạng thái", `ORDER:${order.id}`)],
                [Markup.button.callback("❌ Hủy đơn hàng", `CANCEL_ORDER:${order.id}`)],
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
                `❌ <b>Lỗi tạo thanh toán</b>\n\nCó lỗi xảy ra, vui lòng thử lại hoặc liên hệ hỗ trợ.`,
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
        if (!order) return ctx.reply("❌ Không tìm thấy đơn hàng.");
        if (order.odelegramId !== String(ctx.from.id)) return ctx.reply("❌ Bạn không có quyền hủy đơn này.");
        if (order.status !== "PENDING") return ctx.reply("❌ Không thể hủy đơn này.");

        await prisma.order.update({
            where: { id: orderId },
            data: { status: "CANCELED" },
        });

        await safeEditOrReply(ctx, `❌ <b>Đã hủy đơn hàng</b>\n\nMã đơn: <code>${escapeHtml(orderId.slice(-8).toUpperCase())}</code>`, {
            ...Markup.inlineKeyboard([
                [Markup.button.callback("🛒 Mua hàng", "LIST_PRODUCTS")],
                [Markup.button.callback("🏠 Menu chính", "BACK_HOME")],
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

        if (!order) return ctx.reply("❌ Không tìm thấy đơn hàng");

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

    bot.hears("💰 Nạp tiền", async (ctx) => {
        const balance = await getBalance(ctx.from.id);
        await cleanReply(ctx,
            `💰 *SỐ DƯ VÍ*\n\n💵 Số dư: *${balance.toLocaleString()}đ*\n\nChọn số tiền nạp:`,
            {
                parse_mode: "Markdown",
                ...Markup.inlineKeyboard([
                    [Markup.button.callback("50K", "DEPOSIT:50000"), Markup.button.callback("100K", "DEPOSIT:100000"), Markup.button.callback("200K", "DEPOSIT:200000")],
                    [Markup.button.callback("500K", "DEPOSIT:500000"), Markup.button.callback("1M", "DEPOSIT:1000000")],
                    [Markup.button.callback("💎 Số khác", "DEPOSIT:CUSTOM")],
                ]),
            }
        );
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
            return cleanReply(ctx, "📭 *Chưa có giao dịch*", { parse_mode: "Markdown" });
        }
        let msg = `📊 *LỊCH SỬ GIAO DỊCH*\n${"─".repeat(20)}\n`;
        for (const tx of transactions) {
            msg += formatTransaction(tx) + "\n";
        }
        await cleanReply(ctx, msg, { parse_mode: "Markdown" });
    });

    bot.hears("👤 Tài khoản", async (ctx) => {
        const telegramId = String(ctx.from.id);
        const [balance, orders] = await Promise.all([
            getBalance(ctx.from.id),
            prisma.order.findMany({ where: { odelegramId: telegramId } }),
        ]);
        const totalOrders = orders.length;
        const completedOrders = orders.filter(o => o.status === "DELIVERED").length;
        const totalSpent = orders.filter(o => o.status === "DELIVERED" || o.status === "PAID").reduce((sum, o) => sum + o.finalAmount, 0);

        const vipEmoji = totalSpent > 1000000 ? "💎" : totalSpent > 500000 ? "🥇" : totalSpent > 100000 ? "🥈" : "🥉";

        await cleanReply(ctx,
            accountMessage({ ctx, balance, orderCount: totalOrders, totalSpent }),
            {
                parse_mode: "HTML",
                ...Markup.inlineKeyboard([
                    [Markup.button.callback("💳 Nạp tiền", "WALLET")],
                    [Markup.button.callback("📦 Đơn hàng của tôi", "MY_ORDERS")],
                    [Markup.button.callback("🏠 Menu chính", "BACK_HOME")],
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
            return cleanReply(ctx, "❌ Bạn không có quyền truy cập.");
        }
        await ctx.reply("/admin");
    });

    bot.hears("🔧 Admin", async (ctx) => {
        if (!isAdmin(ctx.from.id)) {
            return cleanReply(ctx, "❌ Bạn không có quyền truy cập.");
        }
        // Trigger admin panel
        const { setupAdmin } = await import("./admin.js");
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
                return ctx.reply("❌ Số tiền không hợp lệ. Tối thiểu 10.000đ. Vui lòng nhập lại:");
            }

            ctx.session.pendingAction = null;

            // Create pending deposit transaction
            const tx = await createDeposit(ctx.from.id, amount);
            const depositContent = generateDepositContent(ctx.from.id, tx.id);
            const qrUrl = generateQRUrl(amount, depositContent);

            const expireMinutes = getExpireMinutes();

            const bankName = process.env.BANK_NAME || "MBBank";
            const bankAccount = process.env.BANK_ACCOUNT || "321336";
            const accountName = process.env.BANK_ACCOUNT_NAME || "PHAM VAN VIET";
            const msg = `💳 <b>Nạp tiền vào ví</b>

Số tiền: <b>${formatPrice(amount)}</b>
Nội dung CK: <code>${escapeHtml(depositContent)}</code>

Ngân hàng: <b>${escapeHtml(bankName)}</b>
STK: <code>${escapeHtml(bankAccount)}</code>
Chủ TK: <b>${escapeHtml(accountName)}</b>

Chuyển đúng số tiền và ghi đúng nội dung.
Mã nạp hết hạn sau <b>${expireMinutes} phút</b>.`;

            const depositKeyboard2 = Markup.inlineKeyboard([
                [Markup.button.url("📱 Mở QR để quét", qrUrl)],
                [Markup.button.callback("✅ Đã chuyển — kiểm tra ngay", `DEPOSIT_CHECK:${tx.id}`)],
                [Markup.button.callback("⬅️ Quay lại", "WALLET")],
            ]);
            try {
                const qrRes = await fetch(qrUrl, { signal: AbortSignal.timeout(6000) });
                if (!qrRes.ok) throw new Error(`QR HTTP ${qrRes.status}`);
                const qrBuffer = Buffer.from(await qrRes.arrayBuffer());
                await ctx.replyWithPhoto({ source: qrBuffer, filename: "qr.png" }, { caption: msg, parse_mode: "HTML", ...depositKeyboard2 });
            } catch {
                await ctx.reply(msg, { parse_mode: "HTML", ...depositKeyboard2 });
            }
            return;
        }

        // Pass to next handler if not handled
        return next();
    });

    bot.action(/^DEPOSIT_CHECK:(.+)$/i, async (ctx) => {
        await answerCallback(ctx, "⏳ Đang kiểm tra giao dịch...");
        const transactionId = ctx.match[1];

        try {
            const result = await confirmDepositByBankScan(transactionId, ctx.from.id);

            if (result.success && result.alreadyProcessed) {
                return ctx.reply(
                    `✅ <b>Lệnh nạp này đã được cộng trước đó.</b>\n\nSố dư hiện tại: <b>${formatPrice(result.newBalance || 0)}</b>`,
                    { parse_mode: "HTML" },
                );
            }

            if (result.success) {
                sendLog("DEPOSIT", `Manual deposit confirmed: User ${ctx.from.id} - ${formatPrice(result.matched?.amount || 0)} - ${result.paymentRef}`);
                return ctx.reply(
                    `✅ <b>Nạp tiền thành công!</b>\n\nSố tiền: <b>${formatPrice(result.matched?.amount || 0)}</b>\nSố dư mới: <b>${formatPrice(result.newBalance || 0)}</b>`,
                    {
                        parse_mode: "HTML",
                        ...Markup.inlineKeyboard([
                            [Markup.button.callback("💳 Xem ví", "WALLET")],
                            [Markup.button.callback("🏠 Menu chính", "BACK_HOME")],
                        ]),
                    },
                );
            }

            return ctx.reply(
                "⏳ <b>Chưa tìm thấy giao dịch phù hợp.</b>\n\nNếu bạn vừa chuyển khoản, hãy chờ thêm 10–30 giây rồi bấm kiểm tra lại.",
                { parse_mode: "HTML" },
            );
        } catch (error) {
            console.error("DEPOSIT_CHECK error:", error);
            sendLog("ERROR", `DEPOSIT_CHECK failed: User ${ctx.from?.id} - ${error.message}`);
            return ctx.reply(
                "❌ <b>Không kiểm tra được giao dịch lúc này.</b>\n\nVui lòng thử lại sau ít phút.",
                { parse_mode: "HTML" },
            );
        }
    });

    return bot;
}
