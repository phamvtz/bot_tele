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

    // Dá»n state cÅ© má»—i 10 phÃºt â€” trÃ¡nh memory leak
    setInterval(() => {
        const cutoff = Date.now() - 30 * 60 * 1000;
        for (const [id, s] of chatState.entries()) {
            if (s.lastActionAt < cutoff) chatState.delete(id);
        }
    }, 10 * 60 * 1000);

    // Cache bot info â€” trÃ¡nh gá»i API má»—i láº§n báº¥m REFERRAL
    let _botInfo = null;
    const getBotInfo = () => { _botInfo ??= bot.telegram.getMe(); return _botInfo; };
    /*
    chatState = {
      chatId: {
        lastMenuId: number,      // ID menu cuá»‘i cÃ¹ng
        tempMessages: number[],  // CÃ¡c tin nháº¯n táº¡m
        paymentMessages: Map,    // QR/order/deposit messages to clean up
        lastActionAt: number     // Thá»i Ä‘iá»ƒm action cuá»‘i
      }
    }
    */

    // Get or create chat state for user
    const getState = (chatId) => {
        const stateKey = String(chatId);
        if (!chatState.has(stateKey)) {
            chatState.set(stateKey, {
                lastMenuId: null,
                tempMessages: [],
                paymentMessages: new Map(),
                lastActionAt: 0,
            });
        }
        const state = chatState.get(stateKey);
        if (!Array.isArray(state.tempMessages)) state.tempMessages = [];
        if (!(state.paymentMessages instanceof Map)) state.paymentMessages = new Map();
        return state;
    };

    // Rate limit check - chá»‘ng spam báº¥m menu
    const isSpam = (chatId, delay = 800) => {
        const state = getState(chatId);
        const now = Date.now();
        if (now - state.lastActionAt < delay) return true;
        state.lastActionAt = now;
        return false;
    };

    // Safe delete message (khÃ´ng throw error)
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

    const safeDeleteByChat = async (chatId, messageId) => {
        if (!chatId || !messageId) return false;
        try {
            await bot.telegram.deleteMessage(chatId, messageId);
            return true;
        } catch {
            return false;
        }
    };

    const rememberPaymentMessage = (ctx, paymentKey, message) => {
        const messageId = message?.message_id;
        if (!paymentKey || !messageId) return message;
        const state = getState(ctx.chat.id);
        if (!state.paymentMessages.has(paymentKey)) {
            state.paymentMessages.set(paymentKey, new Set());
        }
        state.paymentMessages.get(paymentKey).add(messageId);
        return message;
    };

    const isPaymentMessageActive = (chatId, paymentKey) => {
        return getState(chatId).paymentMessages.has(paymentKey);
    };

    const clearPaymentMessages = async (chatId, paymentKey = null) => {
        const state = getState(chatId);
        const keys = paymentKey ? [paymentKey] : [...state.paymentMessages.keys()];
        let deleted = 0;

        for (const key of keys) {
            const ids = state.paymentMessages.get(key);
            if (!ids) continue;
            for (const id of ids) {
                if (await safeDeleteByChat(chatId, id)) deleted += 1;
                if (state.lastMenuId === id) state.lastMenuId = null;
            }
            state.paymentMessages.delete(key);
        }

        return deleted;
    };

    const deleteCurrentCallbackMessage = async (ctx) => {
        const messageId = ctx.callbackQuery?.message?.message_id;
        if (!messageId) return;
        await safeDelete(ctx, messageId);
        const state = getState(ctx.chat.id);
        if (state.lastMenuId === messageId) state.lastMenuId = null;
        for (const [key, ids] of state.paymentMessages.entries()) {
            ids.delete(messageId);
            if (ids.size === 0) state.paymentMessages.delete(key);
        }
    };

    bot.clearPaymentMessages = clearPaymentMessages;

    // Send MENU - tá»± Ä‘á»™ng xÃ³a menu cÅ© (QUAN TRá»ŒNG NHáº¤T)
    const sendMenu = async (ctx, text, options = {}, keepOldMenu = false) => {
        const chatId = ctx.chat.id;
        const state = getState(chatId);

        await clearTemp(ctx);
        await clearPaymentMessages(chatId);

        // XÃ³a user's button press message (náº¿u tá»« keyboard)
        if (ctx.message?.message_id) {
            await safeDelete(ctx, ctx.message.message_id);
        }

        // XÃ³a menu cÅ© (náº¿u khÃ´ng yÃªu cáº§u giá»¯ láº¡i)
        if (state.lastMenuId && !keepOldMenu) {
            await safeDelete(ctx, state.lastMenuId);
        }

        // Gá»­i menu má»›i
        const msg = await ctx.reply(text, { parse_mode: "Markdown", ...options });
        state.lastMenuId = msg.message_id;
        return msg;
    };

    // Send TEMP message - tá»± Ä‘á»™ng xÃ³a sau TTL
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

    // Send IMPORTANT message - KHÃ”NG BAO GIá»œ XÃ“A (náº¡p/Ä‘Æ¡n thÃ nh cÃ´ng)
    const sendImportant = async (ctx, text, options = {}) => {
        return ctx.reply(text, { parse_mode: "Markdown", ...options });
    };

    // Clear all temp messages (khi quay vá» menu chÃ­nh)
    const clearTemp = async (ctx) => {
        const state = getState(ctx.chat.id);
        await Promise.all(state.tempMessages.map((id) => safeDelete(ctx, id)));
        state.tempMessages = [];
    };

    const editMenu = async (ctx, text, options = {}) => {
        const msg = await safeEditOrReply(ctx, text, options);
        const messageId = msg?.message_id || ctx.callbackQuery?.message?.message_id;
        if (messageId) {
            getState(ctx.chat.id).lastMenuId = messageId;
        }
        return msg;
    };

    // Edit message smoothly (for callback queries)
    const smoothEdit = async (ctx, text, options = {}) => {
        try {
            const chatId = ctx.chat.id;
            if (isSpam(chatId, 500)) {
                await ctx.answerCbQuery("â³ Äang xá»­ lÃ½...");
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
        sendLog("ERROR", `âš ï¸ Bot caught error: ${err.message}\nUser: ${ctx.from?.id || "unknown"}`);
        ctx.reply("CÃ³ lá»—i xáº£y ra, vui lÃ²ng thá»­ láº¡i hoáº·c liÃªn há»‡ há»— trá»£.").catch(() => { });
    });



    const buildDepositMsg = ({ amount, depositContent, bankName, bankAccount, accountName, expireMinutes }) =>
        `ðŸ¦ <b>Náº¡p tiá»n vÃ o vÃ­</b>\n${DIVIDER}\n`
        + `ðŸ’° Sá»‘ tiá»n: <b>${formatPrice(amount)}</b>\n`
        + `ðŸ“ Ná»™i dung CK: <code>${escapeHtml(depositContent)}</code>\n\n`
        + `ðŸ¢ NgÃ¢n hÃ ng: <b>${escapeHtml(bankName)}</b>\n`
        + `ðŸ’³ STK: <code>${escapeHtml(bankAccount)}</code>\n`
        + `ðŸ‘¤ Chá»§ TK: <b>${escapeHtml(accountName)}</b>\n\n`
        + `âš ï¸ Chuyá»ƒn Ä‘Ãºng sá»‘ tiá»n vÃ  Ä‘Ãºng ná»™i dung. Háº¿t háº¡n sau <b>${expireMinutes} phÃºt</b>.`;

    // Helper to get user language
    const getLang = (ctx) => ctx.session?.language || "vi";

    // Helper to format price
    const formatPrice = (amount, currency = "VND") => {
        return formatCurrency(amount, currency);
    };

    // cleanReply = alias for sendMenu (backward compatibility)
    const cleanReply = sendMenu;

    // Helper to build dynamic main menu â€” nháº­n productCount tá»« ngoÃ i, khÃ´ng query thÃªm
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

    // Cache product detail 30s â€” trÃ¡nh query DB má»—i láº§n user click vÃ o sáº£n pháº©m
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
            return { ok: false, message: "Sáº£n pháº©m khÃ´ng kháº£ dá»¥ng." };
        }
        if (product.deliveryMode !== "STOCK_LINES") {
            return { ok: true };
        }
        const stockCount = await getStockCount(product.id);
        if (stockCount < quantity) {
            return { ok: false, message: `KhÃ´ng Ä‘á»§ hÃ ng. Hiá»‡n chá»‰ cÃ²n ${stockCount} sáº£n pháº©m.` };
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
            firstName: ctx.from.first_name || "báº¡n",
            balance,
            productCount,
        });

        if (edit || ctx.callbackQuery) {
            await clearTemp(ctx);
            await clearPaymentMessages(ctx.chat.id);
            return editMenu(ctx, text, keyboard);
        }

        return sendMenu(ctx, text, { parse_mode: "HTML", ...keyboard });
    };

    // No products action
    bot.action("NO_PRODUCTS", async (ctx) => {
        await ctx.answerCbQuery("GÃ³i nÃ y hiá»‡n khÃ´ng kháº£ dá»¥ng. Vui lÃ²ng chá»n gÃ³i khÃ¡c.", { show_alert: true });
    });

    bot.action("SEARCH_PRODUCTS", async (ctx) => {
        await answerCallback(ctx);
        await editMenu(ctx, searchPromptMessage(), {
            ...Markup.inlineKeyboard([
                [Markup.button.callback("ðŸ“ Xem danh má»¥c", "LIST_PRODUCTS")],
                [Markup.button.callback("ðŸ  Menu", "BACK_HOME")],
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
            return editMenu(ctx, `<b>GÃ³i má»›i</b>\n${DIVIDER}\nHiá»‡n chÆ°a cÃ³ gÃ³i nÃ o Ä‘ang má»Ÿ bÃ¡n.`, {
                ...Markup.inlineKeyboard([
                    [Markup.button.callback("ðŸ“ Danh má»¥c", "LIST_PRODUCTS")],
                    [Markup.button.callback("ðŸ  Menu", "BACK_HOME")],
                ]),
            });
        }

        const lines = products.map((product, index) => `<b>${index + 1}.</b> ${escapeHtml(product.name)}\n${formatPrice(product.price, product.currency)}`);
        await editMenu(ctx, `<b>GÃ³i má»›i</b>\n${DIVIDER}\n${lines.join("\n\n")}`, {
            ...Markup.inlineKeyboard([
                ...products.map((product) => [Markup.button.callback(`${truncateText(product.name, 34)}`, `product:${product.id}`)]),
                [Markup.button.callback("ðŸ“ Danh má»¥c", "LIST_PRODUCTS")],
                [Markup.button.callback("ðŸ  Menu", "BACK_HOME")],
            ]),
        });
    });

    // ALL_PRODUCTS â†’ redirect to category list
    bot.action("ALL_PRODUCTS", async (ctx) => {
        await answerCallback(ctx);
        const ui = await renderCategoryList();
        await editMenu(ctx, ui.text, ui.keyboard);
    });

    bot.action(/^all_products:(\d+)$/i, async (ctx) => {
        await answerCallback(ctx);
        const ui = await renderCategoryList();
        await editMenu(ctx, ui.text, ui.keyboard);
    });

    // /start command â€” show reply keyboard + category list with optional banner
    bot.start(async (ctx) => {
        const startParam = ctx.message.text.split(" ")[1];
        let referralCode = null;
        if (startParam?.startsWith("ref_")) {
            referralCode = startParam.replace("ref_", "");
        }
        await getOrCreateUser(ctx.from, referralCode);

        await clearTemp(ctx);
        await clearPaymentMessages(ctx.chat.id);
        const state = getState(ctx.chat.id);
        if (state.lastMenuId) {
            await safeDelete(ctx, state.lastMenuId);
            state.lastMenuId = null;
        }
        await safeDelete(ctx, ctx.message.message_id);

        const replyKbd = isAdmin(ctx.from.id) ? adminKeyboard : userKeyboard;
        await ctx.reply(`ChÃ o <b>${escapeHtml(ctx.from.first_name || "báº¡n")}</b>. Menu nhanh Ä‘Ã£ sáºµn sÃ ng á»Ÿ bÃ n phÃ­m bÃªn dÆ°á»›i.`, { parse_mode: "HTML", ...replyKbd });

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

    // /menu command â€” show main menu
    bot.command("menu", async (ctx) => {
        await showMainMenu(ctx);
    });

    // /products command â€” show category list
    bot.command("products", async (ctx) => {
        const ui = await renderCategoryList();
        await sendMenu(ctx, ui.text, { parse_mode: "HTML", ...ui.keyboard });
    });

    // /topup command â€” quick access to wallet top-up
    bot.command("topup", async (ctx) => {
        const balance = await getBalance(ctx.from.id);
        await sendMenu(ctx, walletMessage(balance), { parse_mode: "HTML", ...buildWalletKeyboard() });
    });

    // /orders command â€” show user's orders
    bot.command("orders", async (ctx) => {
        const telegramId = String(ctx.from.id);
        const orders = await prisma.order.findMany({
            where: { odelegramId: telegramId },
            include: { product: true },
            orderBy: { createdAt: "desc" },
            take: 20,
        });
        await sendMenu(ctx, ordersMessage(orders), { parse_mode: "HTML", ...buildOrderListKeyboard(orders) });
    });

    // /support command â€” show support screen
    bot.command("support", async (ctx) => {
        const adminUsername = process.env.ADMIN_TELEGRAM || "vanggohh";
        await sendMenu(ctx, supportMessage(adminUsername), { parse_mode: "HTML", ...buildSupportKeyboard(adminUsername) });
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

        await editMenu(
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

        await editMenu(
            ctx,
            t("languageChanged", newLang),
            Markup.inlineKeyboard([[Markup.button.callback(t("back", newLang), "BACK_HOME")]])
        );
    });

    // Help - Main menu
    bot.action("HELP", async (ctx) => {
        await answerCallback(ctx);
        const adminUsername = process.env.ADMIN_TELEGRAM || "vanggohh";
        await editMenu(ctx, supportMessage(adminUsername), buildSupportKeyboard(adminUsername));
    });

    bot.action("HELP:BUYING", async (ctx) => {
        await answerCallback(ctx);
        await editMenu(ctx, `<b>CÃ¡ch mua hÃ ng</b>
${DIVIDER}
1. Chá»n <b>Mua hÃ ng</b>.
2. Chá»n danh má»¥c vÃ  gÃ³i cáº§n mua.
3. Kiá»ƒm tra giÃ¡, kho vÃ  sá»‘ lÆ°á»£ng.
4. Thanh toÃ¡n báº±ng vÃ­ hoáº·c QR ngÃ¢n hÃ ng.
5. Bot tá»± Ä‘á»™ng giao hÃ ng sau khi Ä‘Æ¡n Ä‘Æ°á»£c xÃ¡c nháº­n.`, {
            ...Markup.inlineKeyboard([
                [Markup.button.callback("ðŸ›’ Mua hÃ ng", "LIST_PRODUCTS")],
                [Markup.button.callback("â† Há»— trá»£", "HELP")],
            ]),
        });
    });

    bot.action("HELP:WALLET", async (ctx) => {
        await answerCallback(ctx);
        await editMenu(ctx, `<b>VÃ­ vÃ  náº¡p tiá»n</b>
${DIVIDER}
Náº¡p trÆ°á»›c vÃ o vÃ­ Ä‘á»ƒ mua nhanh hÆ¡n.

Khi náº¡p tiá»n, hÃ£y chuyá»ƒn Ä‘Ãºng sá»‘ tiá»n vÃ  Ä‘Ãºng ná»™i dung QR. Há»‡ thá»‘ng sáº½ cá»™ng vÃ­ tá»± Ä‘á»™ng sau khi nháº­n giao dá»‹ch.`, {
            ...Markup.inlineKeyboard([
                [Markup.button.callback("ðŸ’³ Má»Ÿ vÃ­", "WALLET")],
                [Markup.button.callback("â† Há»— trá»£", "HELP")],
            ]),
        });
    });

    bot.action("HELP:PAYMENT", async (ctx) => {
        await answerCallback(ctx);
        await editMenu(ctx, `<b>Thanh toÃ¡n & giao hÃ ng</b>
${DIVIDER}
<b>Bao lÃ¢u nháº­n hÃ ng?</b>
ThÆ°á»ng trong 1-3 phÃºt sau khi há»‡ thá»‘ng xÃ¡c nháº­n thanh toÃ¡n.

<b>Chuyá»ƒn sai ná»™i dung?</b>
LiÃªn há»‡ admin vÃ  gá»­i áº£nh giao dá»‹ch kÃ¨m mÃ£ Ä‘Æ¡n.

<b>ÄÆ¡n háº¿t háº¡n?</b>
KhÃ´ng thanh toÃ¡n Ä‘Æ¡n Ä‘Ã£ háº¿t háº¡n. HÃ£y táº¡o Ä‘Æ¡n má»›i Ä‘á»ƒ trÃ¡nh sai lá»‡ch.`, {
            ...Markup.inlineKeyboard([[Markup.button.callback("â† Há»— trá»£", "HELP")]]),
        });
    });

    bot.action("HELP:REFERRAL", async (ctx) => {
        await answerCallback(ctx);
        await editMenu(ctx, `<b>Giá»›i thiá»‡u báº¡n bÃ¨</b>
${DIVIDER}
Láº¥y link giá»›i thiá»‡u trong menu vÃ  gá»­i cho báº¡n bÃ¨.

Khi ngÆ°á»i Ä‘Æ°á»£c giá»›i thiá»‡u mua hÃ ng thÃ nh cÃ´ng, hoa há»“ng sáº½ Ä‘Æ°á»£c ghi nháº­n theo cáº¥u hÃ¬nh shop.`, {
            ...Markup.inlineKeyboard([[Markup.button.callback("â† Há»— trá»£", "HELP")]]),
        });
    });

    bot.action("HELP:CONTACT", async (ctx) => {
        await answerCallback(ctx);

        const adminUsername = process.env.ADMIN_TELEGRAM || "vanggohh";

        await editMenu(ctx, supportMessage(adminUsername), buildSupportKeyboard(adminUsername));
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

        await sendMenu(
            ctx,
            accountMessage({ ctx, balance, orderCount: totalOrders, totalSpent }),
            {
                parse_mode: "HTML",
                ...Markup.inlineKeyboard([
                    [Markup.button.callback("ðŸ’³ Má»Ÿ vÃ­", "WALLET")],
                    [Markup.button.callback("ðŸ“¦ ÄÆ¡n hÃ ng", "MY_ORDERS")],
                    [Markup.button.callback("ðŸ  Menu", "BACK_HOME")],
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

        await editMenu(ctx, accountMessage({
            ctx,
            balance,
            orderCount: orders.length,
            totalSpent,
        }), {
            ...Markup.inlineKeyboard([
                [Markup.button.callback("ðŸ’³ Má»Ÿ vÃ­", "WALLET")],
                [Markup.button.callback("ðŸ“¦ ÄÆ¡n hÃ ng", "MY_ORDERS")],
                [Markup.button.callback("ðŸ  Menu", "BACK_HOME")],
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

        await editMenu(ctx, ordersMessage(orders), buildOrderListKeyboard(orders));
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
            return ctx.reply("KhÃ´ng tÃ¬m tháº¥y Ä‘Æ¡n hÃ ng.");
        }

        if (order.odelegramId !== String(ctx.from.id) && !isAdmin(ctx.from.id)) {
            return ctx.reply("Báº¡n khÃ´ng cÃ³ quyá»n xem Ä‘Æ¡n hÃ ng nÃ y.");
        }

        await editMenu(ctx, orderDetailMessage(order), buildOrderDetailKeyboard(order));
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
            return ctx.reply("KhÃ´ng tÃ¬m tháº¥y Ä‘Æ¡n hÃ ng.");
        }

        // Verify ownership
        if (order.odelegramId !== String(ctx.from.id)) {
            return ctx.reply("Báº¡n khÃ´ng cÃ³ quyá»n há»§y Ä‘Æ¡n hÃ ng nÃ y.");
        }

        // Check if can cancel
        if (order.status === "DELIVERED") {
            return ctx.reply("KhÃ´ng thá»ƒ há»§y Ä‘Æ¡n hÃ ng Ä‘Ã£ giao.");
        }

        if (order.status === "CANCELED") {
            return ctx.reply("ÄÆ¡n hÃ ng Ä‘Ã£ bá»‹ há»§y trÆ°á»›c Ä‘Ã³.");
        }

        // Show confirmation
        await editMenu(ctx, `<b>XÃ¡c nháº­n há»§y Ä‘Æ¡n</b>
${DIVIDER}
MÃ£ Ä‘Æ¡n: <code>${escapeHtml(order.id.slice(-8).toUpperCase())}</code>
Sáº£n pháº©m: <b>${escapeHtml(order.product.name)}</b>
Sá»‘ tiá»n: <b>${formatPrice(order.finalAmount)}</b>

${order.status === "PAID" && String(order.paymentMethod).toLowerCase() === "wallet"
                ? "Sá»‘ tiá»n sáº½ Ä‘Æ°á»£c hoÃ n láº¡i vÃ o vÃ­ cá»§a báº¡n.\n\n"
                : ""}Báº¡n cÃ³ cháº¯c cháº¯n muá»‘n há»§y Ä‘Æ¡n hÃ ng nÃ y?`, {
            ...Markup.inlineKeyboard([
                [Markup.button.callback("XÃ¡c nháº­n há»§y", `CONFIRM_CANCEL:${orderId}`)],
                [Markup.button.callback("â† Quay láº¡i Ä‘Æ¡n", `ORDER:${orderId}`)],
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
            return ctx.reply("KhÃ´ng tÃ¬m tháº¥y Ä‘Æ¡n hÃ ng.");
        }

        // Verify ownership
        if (order.odelegramId !== String(ctx.from.id)) {
            return ctx.reply("Báº¡n khÃ´ng cÃ³ quyá»n há»§y Ä‘Æ¡n hÃ ng nÃ y.");
        }

        // Check if already canceled
        if (order.status === "CANCELED") {
            return ctx.reply("ÄÆ¡n hÃ ng Ä‘Ã£ bá»‹ há»§y.");
        }

        // Check if delivered
        if (order.status === "DELIVERED") {
            return ctx.reply("KhÃ´ng thá»ƒ há»§y Ä‘Æ¡n hÃ ng Ä‘Ã£ giao.");
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
                    `HoÃ n tiá»n Ä‘Æ¡n hÃ ng #${order.id.slice(-8).toUpperCase()}`
                );
                if (!refundResult?.success) {
                    return ctx.reply(
                        `âŒ <b>KhÃ´ng thá»ƒ há»§y Ä‘Æ¡n hÃ ng</b>\n${DIVIDER}\nHoÃ n tiá»n tháº¥t báº¡i: ${refundResult?.error || "lá»—i khÃ´ng xÃ¡c Ä‘á»‹nh"}.\nVui lÃ²ng liÃªn há»‡ admin.`,
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
            let successMsg = `<b>ÄÃ£ há»§y Ä‘Æ¡n hÃ ng</b>
${DIVIDER}
MÃ£ Ä‘Æ¡n: <code>${escapeHtml(order.id.slice(-8).toUpperCase())}</code>
Sáº£n pháº©m: <b>${escapeHtml(order.product.name)}</b>`;

            if (refundAmount > 0) {
                const newBalance = refundResult?.newBalance ?? await getBalance(order.odelegramId);
                successMsg += `\n\nÄÃ£ hoÃ n: <b>${formatPrice(refundAmount)}</b>\n`;
                successMsg += `Sá»‘ dÆ° má»›i: <b>${formatPrice(newBalance)}</b>`;
            }

            await editMenu(ctx, successMsg, {
                parse_mode: "HTML",
                ...Markup.inlineKeyboard([
                    [Markup.button.callback("ðŸ“¦ ÄÆ¡n hÃ ng", "MY_ORDERS")],
                    [Markup.button.callback("ðŸ  Menu", "BACK_HOME")]
                ])
            });

            // Notify admin
            sendLog("ORDER",
                `âŒ *ÄÆ N HÃ€NG Bá»Š HUá»¶*\n` +
                `ðŸ‘¤ User: \`${order.odelegramId}\`\n` +
                `ðŸ†” Order: \`${order.id.slice(-8)}\`\n` +
                `ðŸ“¦ SP: ${order.product.name}\n` +
                `ðŸ’° Sá»‘ tiá»n: ${order.finalAmount.toLocaleString()}Ä‘\n` +
                (refundAmount > 0 ? `ðŸ” ÄÃ£ hoÃ n vá» vÃ­: ${refundAmount.toLocaleString()}Ä‘` : "")
            );

        } catch (error) {
            console.error("Cancel order error:", error);
            await ctx.reply("KhÃ´ng thá»ƒ há»§y Ä‘Æ¡n hÃ ng lÃºc nÃ y. Vui lÃ²ng liÃªn há»‡ admin.");
        }
    });

    // === WALLET SECTION ===

    // /wallet command - quick access to wallet
    bot.command("wallet", async (ctx) => {
        const balance = await getBalance(ctx.from.id);

        await sendMenu(
            ctx,
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

        await clearPaymentMessages(ctx.chat.id);
        await editMenu(ctx, walletMessage(balance), buildWalletKeyboard());
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
        const paymentKey = `deposit:${tx.id}`;

        const bankAccount = process.env.BANK_ACCOUNT || "321336";
        const bankName = process.env.BANK_NAME || "MBBank";
        const accountName = process.env.BANK_ACCOUNT_NAME || "PHAM VAN VIET";

        const msg = buildDepositMsg({ amount, depositContent, bankName, bankAccount, accountName, expireMinutes });

        const depositKeyboard = Markup.inlineKeyboard([
            [Markup.button.url("ðŸ“· Má»Ÿ QR Ä‘á»ƒ quÃ©t", qrUrl)],
            [Markup.button.callback("âœ… TÃ´i Ä‘Ã£ chuyá»ƒn, kiá»ƒm tra", `DEPOSIT_CHECK:${tx.id}`)],
            [Markup.button.callback("â† Quay láº¡i vÃ­", "WALLET")],
        ]);

        await clearPaymentMessages(ctx.chat.id);
        await deleteCurrentCallbackMessage(ctx);

        // Send text immediately â€” no delay for user
        const depositMsg = await ctx.reply(msg, { parse_mode: "HTML", ...depositKeyboard });
        rememberPaymentMessage(ctx, paymentKey, depositMsg);

        // Then try to send QR image in background (non-blocking)
        fetch(qrUrl, { signal: AbortSignal.timeout(8000) })
            .then(async (qrRes) => {
                if (!isPaymentMessageActive(ctx.chat.id, paymentKey)) return;
                if (!qrRes.ok) return;
                const qrBuffer = Buffer.from(await qrRes.arrayBuffer());
                if (!isPaymentMessageActive(ctx.chat.id, paymentKey)) return;
                const qrMsg = await ctx.replyWithPhoto({ source: qrBuffer, filename: "qr.png" },
                    { caption: `ðŸ“· QR chuyá»ƒn khoáº£n â€” ${formatPrice(amount)}` });
                rememberPaymentMessage(ctx, paymentKey, qrMsg);
            })
            .catch(() => {});
    });

    // ... (rest of code) ...
    // ... (rest of code) ...
    bot.action("DEPOSIT:CUSTOM", async (ctx) => {
        await answerCallback(ctx);

        sendLog("DEPOSIT", `User ${ctx.from.id} selected CUSTOM DEPOSIT`);

        ctx.session.pendingAction = "DEPOSIT_AMOUNT";

        await editMenu(ctx, `<b>Náº¡p tiá»n tÃ¹y chá»‰nh</b>
${DIVIDER}
Nháº­p sá»‘ tiá»n muá»‘n náº¡p.

Tá»‘i thiá»ƒu: <b>10.000Ä‘</b>
VÃ­ dá»¥: <code>50000</code>`, {
            ...Markup.inlineKeyboard([
                [Markup.button.callback("Há»§y", "WALLET")],
            ]),
        });
    });

    // Transaction history
    bot.action("TX_HISTORY", async (ctx) => {
        await answerCallback(ctx);
        const transactions = await getTransactionHistory(ctx.from.id, 10);

        if (transactions.length === 0) {
            return editMenu(ctx, `<b>Lá»‹ch sá»­ giao dá»‹ch</b>
${DIVIDER}
ChÆ°a cÃ³ giao dá»‹ch nÃ o.`, {
                ...Markup.inlineKeyboard([[Markup.button.callback("ðŸ  Menu", "BACK_HOME")]]),
            });
        }

        const lines = transactions.map((tx) => {
            const sign = tx.amount >= 0 ? "+" : "";
            return `${escapeHtml(tx.type)} Â· ${tx.status === "SUCCESS" ? "ThÃ nh cÃ´ng" : tx.status === "PENDING" ? "Äang chá»" : "Tháº¥t báº¡i"}
${sign}${formatPrice(tx.amount)} | Sá»‘ dÆ°: ${formatPrice(tx.balanceAfter)}
${formatDateTime(tx.createdAt)}`;
        });

        await editMenu(ctx, `<b>Lá»‹ch sá»­ giao dá»‹ch</b>
${DIVIDER}
${lines.join("\n\n")}`, {
            ...Markup.inlineKeyboard([[Markup.button.callback("ðŸ  Menu", "BACK_HOME")]]),
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

        if (!user) return ctx.reply("KhÃ´ng tÃ¬m tháº¥y tÃ i khoáº£n.");

        const stats = await getReferralStats(user.id);
        const link = getReferralLink(botInfo.username, stats.referralCode);

        await editMenu(
            ctx,
            `<b>Giá»›i thiá»‡u báº¡n bÃ¨</b>\n${DIVIDER}\n` +
            `MÃ£ cá»§a báº¡n: <code>${stats.referralCode}</code>\n` +
            `Link: ${link}\n\n` +
            `ÄÃ£ nháº­n: <b>${formatPrice(stats.balance)}</b>\n` +
            `ÄÃ£ giá»›i thiá»‡u: <b>${stats.referralCount}</b> ngÆ°á»i\n` +
            `Hoa há»“ng: <b>${stats.commissionPercent}%</b> má»—i Ä‘Æ¡n`,
            {
                parse_mode: "HTML",
                disable_web_page_preview: true,
                ...Markup.inlineKeyboard([[Markup.button.callback("ðŸ  Menu", "BACK_HOME")]]),
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
            return editMenu(ctx, "Sáº£n pháº©m khÃ´ng tá»“n táº¡i hoáº·c Ä‘Ã£ ngá»«ng bÃ¡n.", {
                ...Markup.inlineKeyboard([
                    [Markup.button.callback("ðŸ“ Danh má»¥c", "LIST_PRODUCTS")],
                    [Markup.button.callback("ðŸ  Menu", "BACK_HOME")],
                ]),
            });
        }

        const adminUsername = process.env.ADMIN_TELEGRAM || "vanggohh";
        if (product.price <= 0 || product.deliveryMode === "CONTACT") {
            return editMenu(ctx, contactProductMessage({ product, adminUsername }), {
                ...buildContactProductKeyboard(adminUsername, product.categoryId),
            });
        }

        const [stockCount, soldCount] = await Promise.all([
            product.deliveryMode === "STOCK_LINES" ? getStockCount(product.id) : Promise.resolve(null),
            prisma.order.count({ where: { productId: product.id, status: { in: ["PAID", "DELIVERED"] } } }),
        ]);
        const inStock = product.deliveryMode !== "STOCK_LINES" || stockCount > 0;

        const text = productDetailMessage({ product, stockCount, soldCount });
        const keyboard = buildProductDetailKeyboard({
            productId: product.id,
            inStock,
            categoryId: product.categoryId,
            stockCount,
            deliveryMode: product.deliveryMode,
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

        return editMenu(ctx, text, keyboard);
    };

    // List products (Inline Action)
    // Show categories
    bot.action("LIST_PRODUCTS", async (ctx) => {
        await answerCallback(ctx);
        const ui = await renderCategoryList();

        await editMenu(ctx, ui.text, ui.keyboard);
    });

    bot.action(/^category_page:(\d+)$/i, async (ctx) => {
        await answerCallback(ctx);
        const ui = await renderCategoryList(Number(ctx.match[1]));
        await editMenu(ctx, ui.text, ui.keyboard);
    });

    bot.hears("ðŸ›ï¸ Sáº£n Pháº©m", async (ctx) => {
        const ui = await renderCategoryList();
        await cleanReply(ctx, ui.text, { parse_mode: "HTML", ...ui.keyboard });
    });

    bot.hears("âŒ ÄÃ³ng", async (ctx) => {
        try { await ctx.deleteMessage(); } catch {}
        await ctx.reply("ÄÃ£ Ä‘Ã³ng menu. GÃµ /start hoáº·c /menu Ä‘á»ƒ má»Ÿ láº¡i.", Markup.removeKeyboard());
    });

    bot.hears("áº¨n menu", async (ctx) => {
        try { await ctx.deleteMessage(); } catch {}
        await ctx.reply("ÄÃ£ áº©n menu. GÃµ /start hoáº·c /menu Ä‘á»ƒ má»Ÿ láº¡i.", Markup.removeKeyboard());
    });

    // Show products in category
    bot.action(/^(?:CATEGORY:|category:)(.+)$/i, async (ctx) => {
        await answerCallback(ctx);
        const categoryId = ctx.match[1];
        const ui = await renderProductsInCategory(categoryId);

        await editMenu(ctx, ui.text, ui.keyboard);
    });

    bot.action(/^products:(.+):(\d+)$/i, async (ctx) => {
        await answerCallback(ctx);
        const categoryId = ctx.match[1];
        const page = Number(ctx.match[2]);
        const ui = await renderProductsInCategory(categoryId, page);
        await editMenu(ctx, ui.text, ui.keyboard);
    });

    // Product detail
    bot.action(/^(?:PRODUCT:|product:)(.+)$/i, async (ctx) => {
        await answerCallback(ctx);
        const productId = ctx.match[1];
        await showProductDetail(ctx, productId, 1);
    });

    bot.action(/^qty_(inc|dec):(.+):(\d+)$/i, async (ctx) => {
        await answerCallback(ctx, "Báº¥m vÃ o sáº£n pháº©m Ä‘á»ƒ chá»n láº¡i sá»‘ lÆ°á»£ng.");
    });

    bot.action(/^noop:/i, async (ctx) => {
        await answerCallback(ctx, "Báº¥m vÃ o sáº£n pháº©m Ä‘á»ƒ chá»n láº¡i sá»‘ lÆ°á»£ng.");
    });

    // Custom quantity â€” full stock range or large presets
    bot.action(/^CUSTOM_QTY:(.+)$/i, async (ctx) => {
        await answerCallback(ctx);
        const productId = ctx.match[1];

        const product = await prisma.product.findUnique({ where: { id: productId } });
        if (!product || !product.isActive) {
            return ctx.reply("Sáº£n pháº©m khÃ´ng kháº£ dá»¥ng.");
        }

        let numbers = [];
        if (product.deliveryMode === "STOCK_LINES") {
            const stock = await getStockCount(product.id);
            const max = Math.min(stock, 30);
            numbers = Array.from({ length: max }, (_, i) => i + 1);
        }
        if (!numbers.length) {
            numbers = [1, 2, 3, 5, 10, 15, 20, 30, 50, 100];
        }

        const rows = [];
        for (let i = 0; i < numbers.length; i += 5) {
            rows.push(
                numbers.slice(i, i + 5).map((n) =>
                    Markup.button.callback(String(n), `buy_now:${productId}:${n}`)
                )
            );
        }
        rows.push([Markup.button.callback("â† Quay láº¡i", `product:${productId}`)]);

        const stockInfo = product.deliveryMode === "STOCK_LINES"
            ? `\nKho cÃ²n: <b>${numbers.length}</b>` : "";
        await editMenu(ctx,
            `<b>Chá»n sá»‘ lÆ°á»£ng</b>\n${DIVIDER}\n` +
            `Sáº£n pháº©m: <b>${escapeHtml(product.name)}</b>\n` +
            `GiÃ¡: <b>${formatPrice(product.price)}</b>/cÃ¡i${stockInfo}`,
            { parse_mode: "HTML", ...Markup.inlineKeyboard(rows) }
        );
    });

    // Fallback for old qty_set buttons â†’ buy now
    bot.action(/^qty_set:(.+):(\d+)$/i, async (ctx) => {
        await answerCallback(ctx, "Äang chuáº©n bá»‹ Ä‘Æ¡n hÃ ng...");
        const productId = ctx.match[1];
        const quantity = Math.max(1, Number(ctx.match[2]));
        const product = await prisma.product.findUnique({ where: { id: productId } });
        if (!product || !product.isActive || product.price <= 0) return ctx.reply("Sáº£n pháº©m khÃ´ng kháº£ dá»¥ng.");
        const stockCheck = await validateStockForQuantity(product, quantity);
        if (!stockCheck.ok) return ctx.reply(stockCheck.message);
        const orderData = createPendingOrder(ctx, product, quantity);
        await processPaymentFlow(ctx, orderData);
    });

    // "Nháº­p sá»‘ khÃ¡c" â†’ prompt text input
    bot.action(/^QTY_TYPE:(.+)$/i, async (ctx) => {
        await answerCallback(ctx);
        const productId = ctx.match[1];

        const product = await prisma.product.findUnique({ where: { id: productId } });
        if (!product || !product.isActive) {
            return ctx.reply("Sáº£n pháº©m khÃ´ng kháº£ dá»¥ng.");
        }

        ctx.session.customQuantityProduct = productId;

        await editMenu(ctx,
            `<b>Nháº­p sá»‘ lÆ°á»£ng</b>\n${DIVIDER}\n` +
            `Sáº£n pháº©m: <b>${escapeHtml(product.name)}</b>\n` +
            `GiÃ¡: <b>${formatPrice(product.price)}</b>\n\n` +
            `Gá»­i sá»‘ lÆ°á»£ng báº¡n muá»‘n mua, vÃ­ dá»¥: <code>15</code>`,
            { parse_mode: "HTML", ...Markup.inlineKeyboard([[Markup.button.callback("â† Quay láº¡i", `product:${productId}`)]]) }
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
                return ctx.reply(`KhÃ´ng Ä‘á»§ hÃ ng. Hiá»‡n cÃ²n ${stockCount} sáº£n pháº©m.`);
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
        await answerCallback(ctx, "Äang chuáº©n bá»‹ Ä‘Æ¡n hÃ ng...");
        const productId = ctx.match[1];
        const quantity = Math.max(1, Number(ctx.match[2]) || 1);

        const product = await prisma.product.findUnique({ where: { id: productId } });
        if (!product || !product.isActive || product.price <= 0) {
            return ctx.reply("Sáº£n pháº©m khÃ´ng kháº£ dá»¥ng. Vui lÃ²ng chá»n sáº£n pháº©m khÃ¡c.");
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
                    `Sá»‘ lÆ°á»£ng khÃ´ng há»£p lá»‡.\n\nVui lÃ²ng nháº­p sá»‘ nguyÃªn dÆ°Æ¡ng, vÃ­ dá»¥: 5, 10, 15.`,
                    Markup.inlineKeyboard([[Markup.button.callback("Há»§y", "LIST_PRODUCTS")]])
                );
            }

            if (quantity > 999) {
                return ctx.reply(
                    `Sá»‘ lÆ°á»£ng quÃ¡ lá»›n.\n\nVui lÃ²ng nháº­p sá»‘ nhá» hÆ¡n 1000.`,
                    Markup.inlineKeyboard([[Markup.button.callback("Há»§y", "LIST_PRODUCTS")]])
                );
            }

            // Get product and validate stock
            const product = await prisma.product.findUnique({ where: { id: productId } });
            if (!product || !product.isActive) {
                delete ctx.session.customQuantityProduct;
                return ctx.reply("Sáº£n pháº©m khÃ´ng kháº£ dá»¥ng.");
            }

            if (product.deliveryMode === "STOCK_LINES") {
                const stockCount = await getStockCount(product.id);
                if (stockCount < quantity) {
                    return ctx.reply(
                        `KhÃ´ng Ä‘á»§ hÃ ng.\n\nCÃ²n: ${stockCount}\nBáº¡n muá»‘n: ${quantity}`,
                        Markup.inlineKeyboard([[Markup.button.callback("â† Quay láº¡i gÃ³i", `PRODUCT:${productId}`)]])
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

        if (!order) return ctx.reply("PhiÃªn thanh toÃ¡n Ä‘Ã£ háº¿t háº¡n. Vui lÃ²ng Ä‘áº·t láº¡i.");

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
            return editMenu(ctx, text, keyboard);
        }

        return sendMenu(ctx, text, { parse_mode: "HTML", ...keyboard });
    }

    bot.action("CANCEL_CHECKOUT", async (ctx) => {
        await answerCallback(ctx, "ÄÃ£ há»§y thao tÃ¡c thanh toÃ¡n.");
        ctx.session.pendingOrder = null;
        await showMainMenu(ctx, { edit: true });
    });

    // Pay with wallet
    bot.action("PAY_WALLET", async (ctx) => {
        const _clearProcessing = () => { ctx.session.processingPayment = false; };
        try {
            await answerCallback(ctx, "â³ Äang xá»­ lÃ½ thanh toÃ¡n...");
            const orderData = ctx.session.pendingOrder;

            if (!orderData) {
                return ctx.reply("PhiÃªn thanh toÃ¡n Ä‘Ã£ háº¿t háº¡n. Vui lÃ²ng Ä‘áº·t láº¡i.");
            }

            if (ctx.session.processingPayment) {
                return ctx.reply("â³ ÄÆ¡n hÃ ng Ä‘ang Ä‘Æ°á»£c xá»­ lÃ½, vui lÃ²ng chá».");
            }
            ctx.session.processingPayment = true;

            const user = await getOrCreateUser(ctx.from);
            const balance = await getBalance(ctx.from.id);

            // Double check balance
            if (balance < orderData.finalAmount) {
                return ctx.reply("Sá»‘ dÆ° khÃ´ng Ä‘á»§. Vui lÃ²ng náº¡p thÃªm.");
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
                return ctx.reply(`Lá»—i thanh toÃ¡n: ${purchaseResult.error}`);
            }

            sendLog("ORDER", `âœ… Order Success (Wallet): User ${ctx.from.id} bought ${orderData.productName} x${orderData.quantity} - ${formatPrice(orderData.finalAmount)}`);

            ctx.session.pendingOrder = null;

            // Delete the confirmation message
            await deleteCurrentCallbackMessage(ctx);

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
                        [Markup.button.callback("Xem Ä‘Æ¡n hÃ ng", `ORDER:${order.id}`)],
                        [Markup.button.callback("ðŸ›’ Mua tiáº¿p", "LIST_PRODUCTS")],
                        [Markup.button.callback("ðŸ  Menu", "BACK_HOME")],
                    ]),
                }
            );
        } catch (err) {
            console.error("PAY_WALLET error:", err);
            sendLog("ERROR", `âŒ PAY_WALLET failed: User ${ctx.from?.id} - ${err.message}`);
            await ctx.reply(
                `<b>Lá»—i thanh toÃ¡n</b>\n${DIVIDER}\nCÃ³ lá»—i xáº£y ra, vui lÃ²ng thá»­ láº¡i hoáº·c liÃªn há»‡ há»— trá»£.`,
                { parse_mode: "HTML" }
            ).catch(() => { });
        } finally {
            _clearProcessing();
        }
    });

    // Pay with QR (direct)
    bot.action("PAY_QR", async (ctx) => {
        await answerCallback(ctx, "â³ Äang táº¡o mÃ£ thanh toÃ¡n...");
        const lang = getLang(ctx);
        const orderData = ctx.session.pendingOrder;

        if (!orderData) {
            return ctx.reply("PhiÃªn thanh toÃ¡n Ä‘Ã£ háº¿t háº¡n. Vui lÃ²ng Ä‘áº·t láº¡i.");
        }

        if (ctx.session.processingPayment) {
            return ctx.reply("â³ ÄÆ¡n hÃ ng Ä‘ang Ä‘Æ°á»£c xá»­ lÃ½, vui lÃ²ng chá».");
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

            sendLog("ORDER", `â³ Order Created (QR Pending): User ${ctx.from.id} - ${orderData.productName} x${orderData.quantity} - ${formatPrice(orderData.finalAmount)}`);

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
                [Markup.button.url("Má»Ÿ QR Ä‘á»ƒ quÃ©t", checkout.qrUrl)],
                [Markup.button.callback("âœ… TÃ´i Ä‘Ã£ chuyá»ƒn, kiá»ƒm tra", `ORDER_BANK_CHECK:${order.id}`)],
                [Markup.button.callback("Kiá»ƒm tra Ä‘Æ¡n hÃ ng", `ORDER:${order.id}`)],
                [Markup.button.callback("Há»§y Ä‘Æ¡n hÃ ng", `CANCEL_ORDER:${order.id}`)],
            ]);
            const paymentKey = `order:${order.id}`;

            await clearPaymentMessages(ctx.chat.id);
            await deleteCurrentCallbackMessage(ctx);
            getState(ctx.chat.id).paymentMessages.set(paymentKey, new Set());

            // Download QR image server-side so Telegram can always receive it
            try {
                const qrRes = await fetch(checkout.qrUrl, { signal: AbortSignal.timeout(6000) });
                if (!isPaymentMessageActive(ctx.chat.id, paymentKey)) return;
                if (!qrRes.ok) throw new Error(`QR HTTP ${qrRes.status}`);
                const qrBuffer = Buffer.from(await qrRes.arrayBuffer());
                if (!isPaymentMessageActive(ctx.chat.id, paymentKey)) return;
                const qrMsg = await ctx.replyWithPhoto(
                    { source: qrBuffer, filename: "qr.png" },
                    { caption: getPaymentMessage(checkout, lang), parse_mode: "HTML", ...orderKeyboard }
                );
                rememberPaymentMessage(ctx, paymentKey, qrMsg);
            } catch (qrError) {
                if (!isPaymentMessageActive(ctx.chat.id, paymentKey)) return;
                console.log("âŒ QR image fallback:", qrError.message);
                const qrMsg = await ctx.reply(getPaymentMessage(checkout, lang), {
                    parse_mode: "HTML",
                    disable_web_page_preview: true,
                    ...orderKeyboard,
                });
                rememberPaymentMessage(ctx, paymentKey, qrMsg);
            }

            // Remove redundant legacy message
        } catch (error) {
            console.error("PAY_QR error:", error);
            sendLog("ERROR", `âŒ PAY_QR failed: User ${ctx.from?.id} - ${error.message}`);
            if (order?.id) {
                await prisma.order.update({
                    where: { id: order.id },
                    data: { status: "CANCELED" },
                }).catch(() => { });
            }
            await ctx.reply(
                `<b>Lá»—i táº¡o thanh toÃ¡n</b>\n${DIVIDER}\nCÃ³ lá»—i xáº£y ra, vui lÃ²ng thá»­ láº¡i hoáº·c liÃªn há»‡ há»— trá»£.`,
                { parse_mode: "HTML" }
            ).catch(() => { });
        } finally {
            ctx.session.processingPayment = false;
        }
    });

    // Cancel order
    bot.action(/^CANCEL:(.+)$/i, async (ctx) => {
        await answerCallback(ctx, "ÄÃ£ há»§y Ä‘Æ¡n.");
        const orderId = ctx.match[1];

        const order = await prisma.order.findUnique({ where: { id: orderId } });
        if (!order) return ctx.reply("KhÃ´ng tÃ¬m tháº¥y Ä‘Æ¡n hÃ ng.");
        if (order.odelegramId !== String(ctx.from.id)) return ctx.reply("Báº¡n khÃ´ng cÃ³ quyá»n há»§y Ä‘Æ¡n nÃ y.");
        if (order.status !== "PENDING") return ctx.reply("KhÃ´ng thá»ƒ há»§y Ä‘Æ¡n nÃ y.");

        await prisma.order.update({
            where: { id: orderId },
            data: { status: "CANCELED" },
        });

        await editMenu(ctx, `<b>ÄÃ£ há»§y Ä‘Æ¡n hÃ ng</b>\n${DIVIDER}\nMÃ£ Ä‘Æ¡n: <code>${escapeHtml(orderId.slice(-8).toUpperCase())}</code>`, {
            ...Markup.inlineKeyboard([
                [Markup.button.callback("ðŸ›’ Mua hÃ ng", "LIST_PRODUCTS")],
                [Markup.button.callback("ðŸ  Menu", "BACK_HOME")],
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
                return sendMenu(ctx, ordersMessage([]), {
                    parse_mode: "HTML",
                    ...buildOrderListKeyboard([]),
                });
            }
            return sendMenu(ctx, ordersMessage(orders), {
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

        if (!order) return ctx.reply("KhÃ´ng tÃ¬m tháº¥y Ä‘Æ¡n hÃ ng.");

        await sendMenu(ctx, orderDetailMessage(order), {
            parse_mode: "HTML",
            ...buildOrderDetailKeyboard(order),
        });
    });

    // Command: /help
    bot.command("help", async (ctx) => {
        const adminUsername = process.env.ADMIN_TELEGRAM || "vanggohh";

        await sendMenu(ctx, supportMessage(adminUsername), {
            parse_mode: "HTML",
            ...buildSupportKeyboard(adminUsername),
        });
    });

    // === REPLY KEYBOARD HANDLERS ===
    // Handle button presses from persistent keyboard
    // Delete BOTH user's button press AND previous bot message for cleaner chat

    bot.hears("ðŸ’³ Náº¡p tiá»n", async (ctx) => {
        const balance = await getBalance(ctx.from.id);
        await cleanReply(ctx, walletMessage(balance), {
            parse_mode: "HTML",
            ...buildWalletKeyboard(),
        });
    });

    bot.hears("ðŸ’³ VÃ­", async (ctx) => {
        const balance = await getBalance(ctx.from.id);
        await cleanReply(ctx, walletMessage(balance), {
            parse_mode: "HTML",
            ...buildWalletKeyboard(),
        });
    });

    bot.hears("ðŸ’° Náº¡p tiá»n", async (ctx) => {
        const balance = await getBalance(ctx.from.id);
        await cleanReply(ctx, walletMessage(balance), {
            parse_mode: "HTML",
            ...buildWalletKeyboard(),
        });
    });

    // Old handler checked - replaced by shared logic above OR restored if legacy needed
    bot.hears("ðŸ›’ Mua hÃ ng", async (ctx) => {
        const ui = await renderProductList(ctx);
        await cleanReply(ctx, ui.text, {
            parse_mode: "HTML",
            ...ui.keyboard
        });
    });

    bot.hears("ðŸ“¦ ÄÆ¡n hÃ ng", async (ctx) => {
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

    bot.hears("ðŸ“Š Lá»‹ch sá»­ GD", async (ctx) => {
        const transactions = await getTransactionHistory(ctx.from.id, 5);
        if (transactions.length === 0) {
            return cleanReply(ctx, `<b>Lá»‹ch sá»­ giao dá»‹ch</b>\n${DIVIDER}\nChÆ°a cÃ³ giao dá»‹ch nÃ o.`, { parse_mode: "HTML" });
        }
        const lines = transactions.map((tx) => {
            const sign = tx.amount >= 0 ? "+" : "";
            return `${escapeHtml(tx.type)} Â· ${tx.status === "SUCCESS" ? "ThÃ nh cÃ´ng" : tx.status === "PENDING" ? "Äang chá»" : "Tháº¥t báº¡i"}\n${sign}${formatPrice(tx.amount)} | Sá»‘ dÆ°: ${formatPrice(tx.balanceAfter)}\n${formatDateTime(tx.createdAt)}`;
        });
        await cleanReply(ctx, `<b>Lá»‹ch sá»­ giao dá»‹ch</b>\n${DIVIDER}\n${lines.join("\n\n")}`, { parse_mode: "HTML" });
    });

    bot.hears("ðŸ‘¤ TÃ i khoáº£n", async (ctx) => {
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
                    [Markup.button.callback("ðŸ’³ Má»Ÿ vÃ­", "WALLET")],
                    [Markup.button.callback("ðŸ“¦ ÄÆ¡n hÃ ng", "MY_ORDERS")],
                    [Markup.button.callback("ðŸ  Menu", "BACK_HOME")],
                ]),
            }
        );
    });

    bot.hears("ðŸ†˜ Há»— trá»£", async (ctx) => {
        const adminUsername = process.env.ADMIN_TELEGRAM || "vanggohh";
        await cleanReply(ctx, supportMessage(adminUsername), {
            parse_mode: "HTML",
            ...buildSupportKeyboard(adminUsername),
        });
    });

    bot.hears("â“ Há»— trá»£", async (ctx) => {
        const adminUsername = process.env.ADMIN_TELEGRAM || "vanggohh";
        await cleanReply(ctx, supportMessage(adminUsername), {
            parse_mode: "HTML",
            ...buildSupportKeyboard(adminUsername),
        });
    });

    bot.hears("ðŸ› ï¸ Admin", async (ctx) => {
        if (!isAdmin(ctx.from.id)) {
            return cleanReply(ctx, "Báº¡n khÃ´ng cÃ³ quyá»n truy cáº­p.");
        }
        await ctx.reply("/admin");
    });

    bot.hears("ðŸ›  Admin", async (ctx) => {
        if (!isAdmin(ctx.from.id)) {
            return cleanReply(ctx, "Báº¡n khÃ´ng cÃ³ quyá»n truy cáº­p.");
        }
        await ctx.reply("/admin");
    });

    bot.hears("ðŸ”§ Admin", async (ctx) => {
        if (!isAdmin(ctx.from.id)) {
            return cleanReply(ctx, "Báº¡n khÃ´ng cÃ³ quyá»n truy cáº­p.");
        }
        await ctx.reply("ðŸ”§ Äang má»Ÿ Admin Panel...");
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
                return ctx.reply("Sá»‘ tiá»n khÃ´ng há»£p lá»‡. Tá»‘i thiá»ƒu 10.000Ä‘. Vui lÃ²ng nháº­p láº¡i:");
            }

            ctx.session.pendingAction = null;

            const tx = await createDeposit(ctx.from.id, amount);
            const depositContent = generateDepositContent(ctx.from.id, tx.id);
            const qrUrl = generateQRUrl(amount, depositContent);
            const expireMinutes = getExpireMinutes();
            const paymentKey = `deposit:${tx.id}`;

            const bankName = process.env.BANK_NAME || "MBBank";
            const bankAccount = process.env.BANK_ACCOUNT || "321336";
            const accountName = process.env.BANK_ACCOUNT_NAME || "PHAM VAN VIET";
            const msg = buildDepositMsg({ amount, depositContent, bankName, bankAccount, accountName, expireMinutes });

            const depositKeyboard2 = Markup.inlineKeyboard([
                [Markup.button.url("ðŸ“· Má»Ÿ QR Ä‘á»ƒ quÃ©t", qrUrl)],
                [Markup.button.callback("âœ… TÃ´i Ä‘Ã£ chuyá»ƒn, kiá»ƒm tra", `DEPOSIT_CHECK:${tx.id}`)],
                [Markup.button.callback("â† Quay láº¡i vÃ­", "WALLET")],
            ]);

            await clearPaymentMessages(ctx.chat.id);
            const state = getState(ctx.chat.id);
            if (state.lastMenuId) {
                await safeDelete(ctx, state.lastMenuId);
                state.lastMenuId = null;
            }
            await safeDelete(ctx, ctx.message.message_id);

            const depositMsg = await ctx.reply(msg, { parse_mode: "HTML", ...depositKeyboard2 });
            rememberPaymentMessage(ctx, paymentKey, depositMsg);

            fetch(qrUrl, { signal: AbortSignal.timeout(8000) })
                .then(async (qrRes) => {
                    if (!isPaymentMessageActive(ctx.chat.id, paymentKey)) return;
                    if (!qrRes.ok) return;
                    const qrBuffer = Buffer.from(await qrRes.arrayBuffer());
                    if (!isPaymentMessageActive(ctx.chat.id, paymentKey)) return;
                    const qrMsg = await ctx.replyWithPhoto({ source: qrBuffer, filename: "qr.png" },
                        { caption: `ðŸ“· QR chuyá»ƒn khoáº£n â€” ${formatPrice(amount)}` });
                    rememberPaymentMessage(ctx, paymentKey, qrMsg);
                })
                .catch(() => {});
            return;
        }

        // Pass to next handler if not handled
        return next();
    });

    bot.action(/^DEPOSIT_CHECK:(.+)$/i, async (ctx) => {
        await answerCallback(ctx, "ðŸ” Äang kiá»ƒm tra...");
        const transactionId = ctx.match[1];

        try {
            const result = await confirmDepositByBankScan(transactionId, ctx.from.id);

            if (result.success && result.alreadyProcessed) {
                await clearPaymentMessages(ctx.chat.id, `deposit:${transactionId}`);
                return ctx.reply(
                    `âœ… <b>Giao dá»‹ch Ä‘Ã£ Ä‘Æ°á»£c xá»­ lÃ½</b>\n${DIVIDER}\nðŸ’³ Sá»‘ dÆ° hiá»‡n táº¡i: <b>${formatPrice(result.newBalance || 0)}</b>`,
                    { parse_mode: "HTML" },
                );
            }

            if (result.success) {
                sendLog("DEPOSIT", `Manual deposit confirmed: User ${ctx.from.id} - ${formatPrice(result.matched?.amount || 0)} - ${result.paymentRef}`);
                await clearPaymentMessages(ctx.chat.id, `deposit:${transactionId}`);
                return ctx.reply(
                    `âœ… <b>Náº¡p tiá»n thÃ nh cÃ´ng!</b>\n${DIVIDER}\nðŸ’° Sá»‘ tiá»n: <b>+${formatPrice(result.matched?.amount || 0)}</b>\nðŸ’³ Sá»‘ dÆ° má»›i: <b>${formatPrice(result.newBalance || 0)}</b>`,
                    {
                        parse_mode: "HTML",
                        ...Markup.inlineKeyboard([
                            [Markup.button.callback("ðŸ’³ Xem vÃ­", "WALLET")],
                            [Markup.button.callback("ðŸ  Menu", "BACK_HOME")],
                        ]),
                    },
                );
            }

            return ctx.reply(
                `â³ <b>ChÆ°a tÃ¬m tháº¥y giao dá»‹ch</b>\n${DIVIDER}\nNáº¿u vá»«a chuyá»ƒn khoáº£n, hÃ£y chá» 15-30 giÃ¢y rá»“i báº¥m kiá»ƒm tra láº¡i.`,
                { parse_mode: "HTML" },
            );
        } catch (error) {
            console.error("DEPOSIT_CHECK error:", error);
            sendLog("ERROR", `DEPOSIT_CHECK failed: User ${ctx.from?.id} - ${error.message}`);
            return ctx.reply(
                `âŒ <b>KhÃ´ng kiá»ƒm tra Ä‘Æ°á»£c lÃºc nÃ y</b>\n${DIVIDER}\nVui lÃ²ng thá»­ láº¡i sau Ã­t phÃºt.`,
                { parse_mode: "HTML" },
            );
        }
    });

    // Manual bank check for VietQR orders
    bot.action(/^ORDER_BANK_CHECK:(.+)$/, async (ctx) => {
        await answerCallback(ctx, "ðŸ” Äang kiá»ƒm tra giao dá»‹ch...");
        const orderId = ctx.match[1];

        try {
            const result = await confirmOrderByBankScan(orderId, ctx.from.id);

            if (!result.success) {
                return ctx.reply(
                    `â³ <b>ChÆ°a tÃ¬m tháº¥y giao dá»‹ch</b>\n${DIVIDER}\n${escapeHtml(result.error || "")}\n\nNáº¿u vá»«a chuyá»ƒn khoáº£n, hÃ£y chá» 30â€“60 giÃ¢y rá»“i báº¥m kiá»ƒm tra láº¡i.`,
                    { parse_mode: "HTML" },
                );
            }

            if (result.alreadyProcessed) {
                const order = await prisma.order.findUnique({
                    where: { id: orderId },
                    include: { product: { include: { category: true } } },
                });
                const deletedQr = await clearPaymentMessages(ctx.chat.id, `order:${orderId}`);
                if (deletedQr) {
                    return ctx.reply(orderDetailMessage(order), {
                        parse_mode: "HTML",
                        ...buildOrderDetailKeyboard(order),
                    });
                }
                return editMenu(ctx, orderDetailMessage(order), buildOrderDetailKeyboard(order));
            }

            // Deliver the order now
            await deliverOrder({ prisma, telegram: ctx.telegram, order: result.order });

            const deliveredOrder = await prisma.order.findUnique({
                where: { id: orderId },
                include: { product: { include: { category: true } } },
            });
            const deletedQr = await clearPaymentMessages(ctx.chat.id, `order:${orderId}`);
            if (deletedQr) {
                return ctx.reply(orderDetailMessage(deliveredOrder), {
                    parse_mode: "HTML",
                    ...buildOrderDetailKeyboard(deliveredOrder),
                });
            }
            return editMenu(ctx, orderDetailMessage(deliveredOrder), buildOrderDetailKeyboard(deliveredOrder));
        } catch (error) {
            console.error("ORDER_BANK_CHECK error:", error);
            sendLog("ERROR", `ORDER_BANK_CHECK failed: User ${ctx.from?.id} - ${error.message}`);
            return ctx.reply(
                `âŒ <b>KhÃ´ng kiá»ƒm tra Ä‘Æ°á»£c lÃºc nÃ y</b>\n${DIVIDER}\nVui lÃ²ng thá»­ láº¡i sau Ã­t phÃºt.`,
                { parse_mode: "HTML" },
            );
        }
    });

    return bot;
}
