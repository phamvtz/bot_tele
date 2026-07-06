import { Telegraf, Markup, session } from "telegraf";
import { createMongoSessionStore } from "./lib/session-store.js";
import { balanceCache } from "./lib/cache.js";
import { prisma } from "./db.js";
import { t, getLanguages } from "./i18n/index.js";
import { rateLimitMiddleware } from "./ratelimit.js";
import { getStockCount } from "./inventory.js";
import { validateCoupon, calculateDiscount, applyCoupon, releaseCoupon } from "./coupon.js";
import { applyQuantityDiscount } from "./quantity-discount.js";
import { getBankConfig, getMaxDeposit, getDepositPresets } from "./shop-config.js";
import { getOrCreateUser, getReferralStats, getReferralLink } from "./referral.js";
import { renderCategoryList, renderProductsInCategory, renderAllProducts } from "./category.js";
import { getMenuIcons, getMenuIconIds, setMenuIcon, invalidateMenuCache, BUTTON_LABELS, DEFAULT_ICONS, getWelcomeGreeting, getWelcomeGreetingSync, DEFAULT_WELCOME_GREETING } from "./menu-config.js";
import { showAdminPanel, hasAdminSession } from "./admin.js";
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
    invalidateWalletCache,
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
    buildAccountKeyboard,
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
import { answerCallback, safeEditOrReply, sendChatAction } from "./bot-ui/safe.js";
import { getVipLevels, getVipEmoji } from "./vip.js";

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
        const cutoff = Date.now() - 15 * 60 * 1000;
        for (const [id, s] of chatState.entries()) {
            if ((s.lastActionAt || 0) < cutoff) chatState.delete(id);
        }
    }, 5 * 60 * 1000);

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
            const results = await Promise.all([...ids].map((id) => safeDeleteByChat(chatId, id)));
            results.forEach((ok, i) => {
                if (ok) deleted += 1;
                if (state.lastMenuId === [...ids][i]) state.lastMenuId = null;
            });
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

        // Gui menu moi TRUOC de user thay phan hoi ngay; don tin cu chay nen.
        // Truoc day xoa tuan tu (await) 2-4 tin trc khi reply -> moi lan bam cho vai round-trip.
        const oldMenuId = (state.lastMenuId && !keepOldMenu) ? state.lastMenuId : null;
        const userMsgId = ctx.message?.message_id || null;

        const msg = await ctx.reply(text, { parse_mode: "Markdown", ...options });
        state.lastMenuId = msg.message_id;

        // Background cleanup — khong await de khong chan phan hoi
        clearTemp(ctx).catch(() => {});
        clearPaymentMessages(chatId).catch(() => {});
        if (userMsgId) safeDelete(ctx, userMsgId).catch(() => {});
        if (oldMenuId) safeDelete(ctx, oldMenuId).catch(() => {});

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

    // Edit message smoothly (for callback queries).
    // Bỏ throttle 500ms — rate-limit thật nằm ở src/ratelimit.js (30 req/phút).
    // Throttle ở đây gây cảm giác delay khi user click nhanh.
    const smoothEdit = async (ctx, text, options = {}) => {
        try {
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

    // Session middleware — persistent qua MongoDB. Session vẫn tồn tại sau restart.
    bot.use(session({
        defaultSession: () => ({ language: "vi", pendingOrder: null }),
        store: createMongoSessionStore(),
    }));

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

    // Helper to build dynamic main menu â€” nháº­n productCount tá»« ngoÃ i, khÃ´ng query thÃªm
    const buildMainMenu = async (ctx) => {
        const [icons, iconIds] = await Promise.all([getMenuIcons(), getMenuIconIds()]);
        return buildMainMenuKeyboard({ isAdmin: isAdmin(ctx.from.id), icons, iconIds });
    };

    // Share icon fetch between buildMainMenu and getUserKeyboard when called together
    const getUserKeyboard = async (userId, iconsCache) => {
        const icons = iconsCache || await getMenuIcons();
        return buildReplyKeyboard({ isAdmin: isAdmin(userId), icons });
    };

    const _adminSet = new Set((process.env.ADMIN_IDS || "").split(",").filter(Boolean));
    const isAdmin = (userId) => _adminSet.has(String(userId));

    // Cache productCount 60s to reduce DB queries on every menu open
    let _productCountCache = { count: 0, ts: 0 };
    const getCachedProductCount = async () => {
        if (Date.now() - _productCountCache.ts < 60000) return _productCountCache.count;
        try {
            const count = await prisma.product.count({ where: { isActive: true } });
            _productCountCache = { count, ts: Date.now() };
            return count;
        } catch {
            return _productCountCache.count;
        }
    };

    // Cache product detail 120s
    const _productCache = new Map();
    const getCachedProduct = async (productId) => {
        const entry = _productCache.get(productId);
        if (entry && Date.now() - entry.ts < 120000) return entry.value;
        const product = await prisma.product.findUnique({ where: { id: productId }, include: { category: true } });
        if (product) _productCache.set(productId, { value: product, ts: Date.now() });
        return product;
    };
    const invalidateProductCache = (productId) => { if (productId) _productCache.delete(productId); else _productCache.clear(); };

    // Cache icon_overrides setting 5 min (changes only when admin edits icons)
    let _iconOverridesCache = { value: null, ts: 0 };
    const getCachedIconOverrides = async () => {
        if (Date.now() - _iconOverridesCache.ts < 300000) return _iconOverridesCache.value;
        const setting = await prisma.setting.findUnique({ where: { key: 'icon_overrides' } }).catch(() => null);
        _iconOverridesCache = { value: setting, ts: Date.now() };
        return setting;
    };

    // Cache sold count per product 60s
    const _soldCountCache = new Map();
    const getCachedSoldCount = async (productId) => {
        const entry = _soldCountCache.get(productId);
        if (entry && Date.now() - entry.ts < 60000) return entry.value;
        const count = await prisma.order.count({ where: { productId, status: { in: ['PAID', 'DELIVERED'] } } });
        _soldCountCache.set(productId, { value: count, ts: Date.now() });
        return count;
    };
    const invalidateSoldCountCache = (productId) => { if (productId) _soldCountCache.delete(productId); else _soldCountCache.clear(); };

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

    // Cache user count + offset 30 min
    let _userCountCache = { value: null, ts: 0 };
    const getCachedMemberCount = async () => {
        if (_userCountCache.value !== null && Date.now() - _userCountCache.ts < 1800000) return _userCountCache.value;
        try {
            const [total, offsetSetting] = await Promise.all([
                prisma.user.count(),
                prisma.setting.findUnique({ where: { key: "USER_COUNT_OFFSET" } }),
            ]);
            const offset = Number(offsetSetting?.value || 0) || 0;
            _userCountCache = { value: total + offset, ts: Date.now() };
        } catch { _userCountCache = { value: null, ts: Date.now() }; }
        return _userCountCache.value;
    };

    const showMainMenu = async (ctx, { edit = false } = {}) => {
        const [balance, productCount, keyboard, vipData, memberCount] = await Promise.all([
            getBalance(ctx.from.id).catch(() => 0),
            getCachedProductCount(),
            buildMainMenu(ctx),
            (async () => {
                const [user, levels] = await Promise.all([
                    prisma.user.findUnique({ where: { telegramId: String(ctx.from.id) }, select: { vipLevel: true, totalSpent: true } }),
                    getVipLevels(),
                ]);
                if (!user || !levels?.length) return {};
                const currentLevel = levels.find(l => l.level === user.vipLevel) || levels[0];
                const nextLevel = levels.find(l => l.level === (user.vipLevel ?? 0) + 1) || null;
                return {
                    vipEmoji: getVipEmoji(user.vipLevel ?? 0),
                    vipName: currentLevel?.name || "Thường",
                    totalSpent: user.totalSpent || 0,
                    nextLevelName: nextLevel?.name || null,
                    nextLevelMinSpent: nextLevel?.minSpent || 0,
                };
            })().catch(() => ({})),
            getCachedMemberCount().catch(() => null),
        ]);
        const text = mainMenuMessage({
            firstName: ctx.from.first_name || "bạn",
            balance,
            productCount,
            memberCount,
            ...vipData,
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
        await ctx.answerCbQuery("Gói này hiện không khả dụng. Vui lòng chọn gói khác.", { show_alert: true });
    });

    bot.action("SEARCH_PRODUCTS", async (ctx) => {
        await answerCallback(ctx);
        await editMenu(ctx, searchPromptMessage(), {
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
            return editMenu(ctx, `<b>Gói mới</b>\n${DIVIDER}\nHiện chưa có gói nào đang mở bán.`, {
                ...Markup.inlineKeyboard([
                    [Markup.button.callback("📁 Danh mục", "LIST_PRODUCTS")],
                    [Markup.button.callback("🏠 Menu", "BACK_HOME")],
                ]),
            });
        }

        const lines = products.map((product, index) => `<b>${index + 1}.</b> ${escapeHtml(product.name)}\n${formatPrice(product.price, product.currency)}`);
        await editMenu(ctx, `<b>Gói mới</b>\n${DIVIDER}\n${lines.join("\n\n")}`, {
            ...Markup.inlineKeyboard([
                ...products.map((product) => [Markup.button.callback(`${truncateText(product.name, 34)}`, `product:${product.id}`)]),
                [Markup.button.callback("📁 Danh mục", "LIST_PRODUCTS")],
                [Markup.button.callback("🏠 Menu", "BACK_HOME")],
            ]),
        });
    });

    bot.action("ALL_PRODUCTS", async (ctx) => {
        await answerCallback(ctx);
        const ui = await renderAllProducts(1);
        await editMenu(ctx, ui.text, { parse_mode: "HTML", ...ui.keyboard });
    });

    bot.action(/^all_products:(\d+)$/i, async (ctx) => {
        await answerCallback(ctx);
        const ui = await renderAllProducts(Number(ctx.match[1]));
        await editMenu(ctx, ui.text, { parse_mode: "HTML", ...ui.keyboard });
    });

    // /start command — show reply keyboard + category list with optional banner
    bot.start(async (ctx) => {
        const startParam = ctx.message.text.split(" ")[1];
        let referralCode = null;
        if (startParam?.startsWith("ref_")) {
            referralCode = startParam.replace("ref_", "");
        }
        await getOrCreateUser(ctx.from, referralCode).catch(() => {});

        // Deep link: /start product_PRODUCTID → mở thẳng sản phẩm
        if (startParam?.startsWith("product_")) {
            const productId = startParam.replace("product_", "");
            const product = await prisma.product.findUnique({ where: { id: productId } }).catch(() => null);
            if (product?.isActive) {
                const replyKbd = await getUserKeyboard(ctx.from.id);
                await ctx.reply(`Chào <b>${escapeHtml(ctx.from.first_name || "bạn")}</b>. Menu nhanh đã sẵn sàng ở bàn phím bên dưới.`, { parse_mode: "HTML", ...replyKbd });
                const [stockCount, soldCount, iconSetting2] = await Promise.all([
                    product.deliveryMode === "STOCK_LINES" ? getStockCount(product.id) : Promise.resolve(null),
                    getCachedSoldCount(product.id),
                    getCachedIconOverrides(),
                ]);
                const inStock = product.deliveryMode !== "STOCK_LINES" || stockCount > 0;
                let productDisplay2 = product;
                try {
                    const iconOvs = iconSetting2 ? JSON.parse(iconSetting2.value) : {};
                    const ov2 = iconOvs[product.id];
                    if (ov2?.startsWith("tg:") && !product.iconEmojiId) productDisplay2 = { ...product, iconEmojiId: ov2.slice(3) };
                } catch {}
                const text = productDetailMessage({ product: productDisplay2, stockCount, soldCount: soldCount + (product.soldFake || 0) });
                const keyboard = buildProductDetailKeyboard({ productId: product.id, inStock, categoryId: product.categoryId, stockCount, deliveryMode: product.deliveryMode });
                const imageSource2 = product.imageFileId || product.imageUrl;
                if (imageSource2) {
                    try {
                        const caption = text.length > 1024 ? text.slice(0, 1021) + "..." : text;
                        const msg = await ctx.replyWithPhoto(imageSource2, { caption, parse_mode: "HTML", ...keyboard });
                        getState(ctx.chat.id).lastMenuId = msg.message_id;
                        return;
                    } catch {}
                }
                await sendMenu(ctx, text, { parse_mode: "HTML", ...keyboard });
                return;
            }
        }

        await clearTemp(ctx);
        await clearPaymentMessages(ctx.chat.id);
        const state = getState(ctx.chat.id);
        if (state.lastMenuId) {
            await safeDelete(ctx, state.lastMenuId);
            state.lastMenuId = null;
        }
        await safeDelete(ctx, ctx.message.message_id);

        const replyKbd = await getUserKeyboard(ctx.from.id);
        await showMainMenu(ctx);
        // Hiện reply keyboard (bottom keyboard) — dùng cùng greeting template với main menu
        const greetingTpl = getWelcomeGreetingSync() ?? DEFAULT_WELCOME_GREETING;
        const greetingText = greetingTpl.replace(/\{name\}/g, escapeHtml(ctx.from.first_name || "bạn"));
        await ctx.reply(greetingText, { parse_mode: "HTML", ...replyKbd });
    });

    // /menu command — show main menu
    bot.command("menu", async (ctx) => {
        await showMainMenu(ctx);
    });

    // /api — Personal API key + docs
    const showApiInfo = async (ctx) => {
        const { getUserApiKey } = await import("./user-api.js");
        const telegramId = ctx.from.id;
        const userKey = getUserApiKey(telegramId);
        // Lấy public base URL hợp lệ (http/https + host thật). Trả null nếu chỉ có
        // placeholder như "SERVER" — tránh tạo inline button URL không hợp lệ khiến
        // Telegram từ chối ("Wrong HTTP URL").
        const rawBase = (process.env.API_PUBLIC_URL || process.env.PUBLIC_URL || process.env.WEBHOOK_URL || "")
            .replace(/\/$/, "")
            .replace(/\/bot[\w:-]+$/i, "");
        const publicBase = (/^https?:\/\/[^/\s]+/i.test(rawBase) && !/SERVER/i.test(rawBase)) ? rawBase : null;
        const apiBase = publicBase ? `${publicBase}/api/user` : "/api/user";

        const msg = `🔗 <b>Liên kết API</b>
━━━━━━━━━━━━━━━━
API Key của bạn là:

<code>${userKey}</code>

<b>Base URL:</b>
<code>${apiBase}</code>

<b>Danh sách API:</b>
• <code>GET  /me</code> — Thông tin tài khoản + số dư
• <code>GET  /products</code> — Danh sách sản phẩm
• <code>POST /purchase</code> — Mua hàng bằng số dư ví
• <code>GET  /orders</code> — Lịch sử đơn hàng
• <code>GET  /orders/:id</code> — Chi tiết đơn

<b>Ví dụ mua hàng:</b>
<code>POST ${apiBase}/purchase
Authorization: Bearer ${userKey.slice(0, 20)}...
{
  "productId": "clx...",
  "quantity": 1
}</code>

<i>Lưu ý: Cần có số dư ví trước khi mua qua API.</i>`;

        const btns = [];
        // Chỉ thêm nút "Tài liệu đầy đủ" khi có public URL hợp lệ (Telegram yêu cầu
        // URL http/https với host hợp lệ). Nếu không, tài liệu vẫn có trong text ở trên.
        if (publicBase) btns.push([Markup.button.url("📄 Tài liệu đầy đủ", `${publicBase}/api/user/docs`)]);
        if (isAdmin(telegramId)) btns.push([Markup.button.callback("🔑 API Seller (Admin)", "ADMIN:SELLER_API")]);

        await ctx.reply(msg, { parse_mode: "HTML", ...(btns.length ? Markup.inlineKeyboard(btns) : {}) });
    };

    bot.command("api", showApiInfo);

    // Handle API button — match any single emoji/icon prefix + "API"
    bot.hears(/^.{0,5}\s?API$/u, showApiInfo);

    bot.command("products", async (ctx) => {
        const ui = await renderCategoryList();
        await sendMenu(ctx, ui.text, { parse_mode: "HTML", ...ui.keyboard });
    });

    bot.command("product", async (ctx) => {
        const ui = await renderAllProducts(1);
        await sendMenu(ctx, ui.text, { parse_mode: "HTML", ...ui.keyboard });
    });

    // /topup command — quick access to wallet top-up
    bot.command("topup", async (ctx) => {
        const [balance, presets] = await Promise.all([getBalance(ctx.from.id), getDepositPresets()]);
        await sendMenu(ctx, walletMessage(balance), { parse_mode: "HTML", ...buildWalletKeyboard(presets) });
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
        await sendMenu(ctx, ordersMessage(orders), { parse_mode: "HTML", ...buildOrderListKeyboard(orders) });
    });

    // /support command — show support screen
    bot.command("support", async (ctx) => {
        const adminUsername = process.env.ADMIN_TELEGRAM || "admin";
        await sendMenu(ctx, supportMessage(adminUsername), { parse_mode: "HTML", ...buildSupportKeyboard(adminUsername) });
    });

    // Back to home - edit current message
    bot.action("BACK_HOME", async (ctx) => {
        await answerCallback(ctx);
        delete ctx.session?.customQuantityProduct;
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
        const adminUsername = process.env.ADMIN_TELEGRAM || "admin";
        await editMenu(ctx, supportMessage(adminUsername), buildSupportKeyboard(adminUsername));
    });

    bot.action("HELP:BUYING", async (ctx) => {
        await answerCallback(ctx);
        await editMenu(ctx, `<b>Cách mua hàng</b>
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
        await editMenu(ctx, `<b>Ví và nạp tiền</b>
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
        await editMenu(ctx, `<b>Thanh toán & giao hàng</b>
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
        await editMenu(ctx, `<b>Giới thiệu bạn bè</b>
${DIVIDER}
Lấy link giới thiệu trong menu và gửi cho bạn bè.

Khi người được giới thiệu mua hàng thành công, hoa hồng sẽ được ghi nhận theo cấu hình shop.`, {
            ...Markup.inlineKeyboard([[Markup.button.callback("← Hỗ trợ", "HELP")]]),
        });
    });

    bot.action("HELP:CONTACT", async (ctx) => {
        await answerCallback(ctx);

        const adminUsername = process.env.ADMIN_TELEGRAM || "admin";

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
                ...buildAccountKeyboard(),
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
            ...buildAccountKeyboard(),
        });
    });

    // MY_ORDERS - Show user's orders with clickable list
    bot.action("MY_ORDERS", async (ctx) => {
        await answerCallback(ctx);
        sendChatAction(ctx, "typing");
        const telegramId = String(ctx.from.id);

        const orders = await prisma.order.findMany({
            where: { odelegramId: telegramId },
            include: { product: true },
            orderBy: { createdAt: "desc" },
            take: 20,
        });

        await editMenu(ctx, ordersMessage(orders), buildOrderListKeyboard(orders));
    });

    // ORDER detail - Show single order details
    bot.action(/^ORDER:(.+)$/, async (ctx) => {
        await answerCallback(ctx);
        sendChatAction(ctx, "typing");
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

        // Clear QR payment messages before showing cancel confirmation so the photo
        // doesn't get deleted by safeEditOrReply's fallback when the callback is on a photo msg.
        await clearPaymentMessages(ctx.chat.id, `order:${orderId}`);

        const confirmText = `<b>Xác nhận hủy đơn</b>
${DIVIDER}
Mã đơn: <code>${escapeHtml(order.id.slice(-8).toUpperCase())}</code>
Sản phẩm: <b>${escapeHtml(order.product.name)}</b>
Số tiền: <b>${formatPrice(order.finalAmount)}</b>

${order.status === "PAID" && String(order.paymentMethod).toLowerCase() === "wallet"
            ? "Số tiền sẽ được hoàn lại vào ví của bạn.\n\n"
            : ""}Bạn có chắc chắn muốn hủy đơn hàng này?`;
        const confirmKeyboard = Markup.inlineKeyboard([
            [Markup.button.callback("Xác nhận hủy", `CONFIRM_CANCEL:${orderId}`)],
            [Markup.button.callback("← Quay lại đơn", `ORDER:${orderId}`)],
        ]);

        // The callback may come from a photo message (QR) — delete it first, then reply
        const cbMsg = ctx.callbackQuery?.message;
        if (cbMsg?.photo || cbMsg?.document) {
            await ctx.deleteMessage().catch(() => {});
            const confirmMsg = await ctx.reply(confirmText, { parse_mode: "HTML", ...confirmKeyboard });
            getState(ctx.chat.id).lastMenuId = confirmMsg.message_id;
        } else {
            await editMenu(ctx, confirmText, confirmKeyboard);
        }
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
            // Atomic gate: chỉ cancel được nếu order vẫn ở PENDING/PAID.
            // Tránh race: user spam cancel trong khi deliverOrder đang chạy.
            const claimed = await prisma.order.updateMany({
                where: { id: orderId, status: { in: ["PENDING", "PAID"] } },
                data: { status: "CANCELING" },
            });
            if (claimed.count === 0) {
                const fresh = await prisma.order.findUnique({ where: { id: orderId } });
                if (fresh?.status === "DELIVERED") {
                    return ctx.reply("Đơn hàng đã được giao trong lúc bạn hủy. Không thể hoàn tiền.");
                }
                return ctx.reply("Không thể hủy đơn hàng (trạng thái đã thay đổi).");
            }

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
                    // Rollback CANCELING → PAID
                    await prisma.order.update({
                        where: { id: orderId },
                        data: { status: "PAID" },
                    }).catch(() => {});
                    return ctx.reply(
                        `❌ <b>Không thể hủy đơn hàng</b>\n${DIVIDER}\nHoàn tiền thất bại: ${refundResult?.error || "lỗi không xác định"}.\nVui lòng liên hệ admin.`,
                        { parse_mode: "HTML" }
                    );
                }
            }

            // Update order status (CANCELING → CANCELED)
            await prisma.order.update({
                where: { id: orderId },
                data: { status: "CANCELED", canceledAt: new Date(), cancelReason: "User canceled" }
            });
            // Release coupon usage if order had one applied
            if (order.couponId) await releaseCoupon(order.couponId).catch(() => {});

            // Success message
            let successMsg = `<b>Đã hủy đơn hàng</b>
${DIVIDER}
Mã đơn: <code>${escapeHtml(order.id.slice(-8).toUpperCase())}</code>
Sản phẩm: <b>${escapeHtml(order.product.name)}</b>`;

            if (refundAmount > 0) {
                successMsg += `\n\nĐã hoàn: <b>${formatPrice(refundAmount)}</b>\n`;
                successMsg += `Số dư mới: <b>${formatPrice(refundResult.newBalance)}</b>`;
            }

            await editMenu(ctx, successMsg, {
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
        const [balance, presets] = await Promise.all([getBalance(ctx.from.id), getDepositPresets()]);

        await sendMenu(
            ctx,
            walletMessage(balance),
            {
                parse_mode: "HTML",
                ...buildWalletKeyboard(presets),
            }
        );
    });

    // Wallet - Show balance and deposit options
    bot.action("WALLET", async (ctx) => {
        await answerCallback(ctx);
        sendChatAction(ctx, "typing");
        const [balance, , presets] = await Promise.all([
            getBalance(ctx.from.id),
            clearPaymentMessages(ctx.chat.id),
            getDepositPresets(),
        ]);
        await editMenu(ctx, walletMessage(balance), buildWalletKeyboard(presets));
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

        const bank = await getBankConfig();
        const bankAccount = bank.accountNumber;
        const bankName = bank.bankName;
        const accountName = bank.accountName;

        const msg = buildDepositMsg({ amount, depositContent, bankName, bankAccount, accountName, expireMinutes });

        const depositKeyboard = Markup.inlineKeyboard([
            [Markup.button.url("📷 Mở QR để quét", qrUrl)],
            [Markup.button.callback("✅ Tôi đã chuyển, kiểm tra", `DEPOSIT_CHECK:${tx.id}`)],
            [Markup.button.callback("← Quay lại ví", "WALLET")],
        ]);

        await clearPaymentMessages(ctx.chat.id);
        await deleteCurrentCallbackMessage(ctx);

        // Send text immediately — no delay for user
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
                    { caption: `📷 QR chuyển khoản — ${formatPrice(amount)}` });
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

        await editMenu(ctx, `<b>Nạp tiền tùy chỉnh</b>
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
            return editMenu(ctx, `<b>Lịch sử giao dịch</b>
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

        await editMenu(ctx, `<b>Lịch sử giao dịch</b>
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

        await editMenu(
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
        sendChatAction(ctx, "typing");
        const product = await getCachedProduct(productId);

        if (!product || !product.isActive) {
            return editMenu(ctx, "Sản phẩm không tồn tại hoặc đã ngừng bán.", {
                ...Markup.inlineKeyboard([
                    [Markup.button.callback("📁 Danh mục", "LIST_PRODUCTS")],
                    [Markup.button.callback("🏠 Menu", "BACK_HOME")],
                ]),
            });
        }

        const adminUsername = process.env.ADMIN_TELEGRAM || "admin";
        if (product.deliveryMode === "CONTACT") {
            return editMenu(ctx, contactProductMessage({ product, adminUsername }), {
                ...buildContactProductKeyboard(adminUsername, product.categoryId),
            });
        }

        const [stockCount, soldCount, iconSetting] = await Promise.all([
            product.deliveryMode === "STOCK_LINES" ? getStockCount(product.id) : Promise.resolve(null),
            getCachedSoldCount(product.id),
            getCachedIconOverrides(),
        ]);
        const inStock = product.deliveryMode !== "STOCK_LINES" || stockCount > 0;

        // Inject tg: icon from icon_overrides if product has no iconEmojiId set
        let productDisplay = product;
        try {
            const iconOverrides = iconSetting ? JSON.parse(iconSetting.value) : {};
            const ov = iconOverrides[product.id];
            if (ov?.startsWith("tg:") && !product.iconEmojiId) {
                productDisplay = { ...product, iconEmojiId: ov.slice(3) };
            }
        } catch {}

        // promptMode: sản phẩm có giá > 0 và còn hàng → dùng text input thay vì nút qty
        const usePrompt = inStock && product.price > 0;
        const text = productDetailMessage({ product: productDisplay, stockCount, soldCount: soldCount + (product.soldFake || 0) });
        const keyboard = buildProductDetailKeyboard({
            productId: product.id,
            inStock,
            categoryId: product.categoryId,
            stockCount,
            deliveryMode: product.deliveryMode,
            promptMode: usePrompt,
        });

        const imageSource = product.imageFileId || product.imageUrl;
        if (imageSource) {
            const isPhotoMsg = !!(ctx.callbackQuery?.message?.photo?.length);
            if (isPhotoMsg) {
                try {
                    const caption = text.length > 1024 ? text.slice(0, 1021) + "..." : text;
                    await ctx.editMessageCaption(caption, { parse_mode: "HTML", ...keyboard });
                } catch (e) {
                    if (!e.message?.includes("message is not modified")) {
                        await editMenu(ctx, text, keyboard);
                    }
                }
            } else {
                try {
                    try { await ctx.deleteMessage(); } catch {}
                    const state = getState(ctx.chat.id);
                    if (state.lastMenuId) {
                        try { await ctx.telegram.deleteMessage(ctx.chat.id, state.lastMenuId); } catch {}
                        state.lastMenuId = null;
                    }
                    await clearTemp(ctx);
                    const caption = text.length > 1024 ? text.slice(0, 1021) + "..." : text;
                    const msg = await ctx.replyWithPhoto(imageSource, { caption, parse_mode: "HTML", ...keyboard });
                    state.lastMenuId = msg.message_id;
                } catch {
                    await editMenu(ctx, text, keyboard);
                }
            }
        } else {
            await editMenu(ctx, text, keyboard);
        }

        // Gửi prompt nhập số lượng ngay sau khi hiện sản phẩm
        if (usePrompt) {
            ctx.session.customQuantityProduct = product.id;
            const maxStock = product.deliveryMode === "STOCK_LINES" && stockCount > 0 ? stockCount : null;
            const rangeText = maxStock ? ` (1-${maxStock})` : "";
            const promptMsg = await ctx.reply(
                `🔖 Vui lòng nhập số lượng muốn mua${rangeText}:`
            );
            getState(ctx.chat.id).tempMessages.push(promptMsg.message_id);
        }
    };

    // List products (Inline Action)
    // Show categories
    bot.action("LIST_PRODUCTS", async (ctx) => {
        await answerCallback(ctx);
        sendChatAction(ctx, "typing");
        const ui = await renderCategoryList();

        await editMenu(ctx, ui.text, ui.keyboard);
    });

    bot.action(/^category_page:(\d+)$/i, async (ctx) => {
        await answerCallback(ctx);
        sendChatAction(ctx, "typing");
        const ui = await renderCategoryList(Number(ctx.match[1]));
        await editMenu(ctx, ui.text, ui.keyboard);
    });

    bot.hears("🛍️ Sản Phẩm", async (ctx) => {
        const ui = await renderCategoryList();
        await cleanReply(ctx, ui.text, { parse_mode: "HTML", ...ui.keyboard });
    });

    bot.hears("❌ Đóng", async (ctx) => {
        try { await ctx.deleteMessage(); } catch {}
        await ctx.reply("Đã đóng menu. Gõ /start hoặc /menu để mở lại.", Markup.removeKeyboard());
    });

    bot.hears(/^.{0,5}\s?Ẩn menu$/u, async (ctx) => {
        try { await ctx.deleteMessage(); } catch {}
        await ctx.reply("Đã ẩn menu. Gõ /start hoặc /menu để mở lại.", Markup.removeKeyboard());
    });

    // Show products in category
    bot.action(/^(?:CATEGORY:|category:)(.+)$/i, async (ctx) => {
        await answerCallback(ctx);
        sendChatAction(ctx, "typing");
        const categoryId = ctx.match[1];
        const ui = await renderProductsInCategory(categoryId);

        if (ui.imageFileId) {
            // Delete old menu, then send photo as new menu
            const state = getState(ctx.chat.id);
            if (state.lastMenuId) {
                await safeDelete(ctx, state.lastMenuId);
                state.lastMenuId = null;
            }
            try {
                const imgMsg = await ctx.telegram.sendPhoto(ctx.chat.id, ui.imageFileId, {
                    caption: ui.text,
                    parse_mode: "HTML",
                    ...ui.keyboard,
                });
                state.lastMenuId = imgMsg.message_id;
                return;
            } catch {
                // fallback to text if photo send fails
            }
        }

        await editMenu(ctx, ui.text, ui.keyboard);
    });

    bot.action(/^products:(.+):(\d+)$/i, async (ctx) => {
        await answerCallback(ctx);
        sendChatAction(ctx, "typing");
        const categoryId = ctx.match[1];
        const page = Number(ctx.match[2]);
        const ui = await renderProductsInCategory(categoryId, page);
        await editMenu(ctx, ui.text, ui.keyboard);
    });

    // Product detail
    bot.action(/^(?:PRODUCT:|product:)(.+)$/i, async (ctx) => {
        await answerCallback(ctx);
        const productId = ctx.match[1];
        delete ctx.session?.customQuantityProduct;
        await showProductDetail(ctx, productId, 1);
    });

    bot.action(/^qty_(inc|dec):(.+):(\d+)$/i, async (ctx) => {
        await answerCallback(ctx, "Bấm vào sản phẩm để chọn lại số lượng.");
    });

    bot.action(/^noop:/i, async (ctx) => {
        await answerCallback(ctx, "Bấm vào sản phẩm để chọn lại số lượng.");
    });

    // Custom quantity — prompt user to type a number
    bot.action(/^CUSTOM_QTY:(.+)$/i, async (ctx) => {
        await answerCallback(ctx);
        const productId = ctx.match[1];

        const product = await prisma.product.findUnique({ where: { id: productId } });
        if (!product || !product.isActive) {
            return ctx.reply("Sản phẩm không khả dụng.");
        }

        ctx.session.customQuantityProduct = productId;

        const stockInfo = product.deliveryMode === "STOCK_LINES"
            ? ` (kho còn ${await getStockCount(product.id)})` : "";
        await editMenu(ctx,
            `<b>${escapeHtml(product.name)}</b>\n${DIVIDER}\n` +
            `Giá: <b>${formatPrice(product.price)}</b>/cái${stockInfo}\n\n` +
            `Nhập số lượng muốn mua:`,
            { parse_mode: "HTML" }
        );
    });

    // Fallback for old qty_set buttons â†’ buy now
    bot.action(/^qty_set:(.+):(\d+)$/i, async (ctx) => {
        await answerCallback(ctx, "Đang chuẩn bị đơn hàng...");
        const productId = ctx.match[1];
        const quantity = Math.max(1, Number(ctx.match[2]));
        const product = await prisma.product.findUnique({ where: { id: productId } });
        if (!product || !product.isActive || product.price <= 0) return ctx.reply("Sản phẩm không khả dụng.");
        const stockCheck = await validateStockForQuantity(product, quantity);
        if (!stockCheck.ok) return ctx.reply(stockCheck.message);
        const orderData = createPendingOrder(ctx, product, quantity);
        await processPaymentFlow(ctx, orderData);
    });

    // "Nhập số khác" â†’ prompt text input
    bot.action(/^QTY_TYPE:(.+)$/i, async (ctx) => {
        await answerCallback(ctx);
        const productId = ctx.match[1];

        const product = await prisma.product.findUnique({ where: { id: productId } });
        if (!product || !product.isActive) {
            return ctx.reply("Sản phẩm không khả dụng.");
        }

        ctx.session.customQuantityProduct = productId;

        await editMenu(ctx,
            `<b>Nhập số lượng</b>\n${DIVIDER}\n` +
            `Sản phẩm: <b>${escapeHtml(product.name)}</b>\n` +
            `Giá: <b>${formatPrice(product.price)}</b>\n\n` +
            `Gửi số lượng bạn muốn mua, ví dụ: <code>15</code>`,
            { parse_mode: "HTML" }
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

    // Reply-keyboard menu labels — never treat these as coupon/quantity input
    const MENU_KEYWORDS = ["Mua hàng", "Ví", "Đơn hàng", "Tài khoản", "Sản phẩm", "Hỗ trợ", "Giới thiệu", "Ẩn menu", "Admin"];

    // Handle coupon input
    bot.on("text", async (ctx, next) => {
        // Yield to admin session handler (registered after createBot via registerAdminCommands)
        if (hasAdminSession(ctx.from?.id)) return next();

        // If user tapped a reply-keyboard button, clear any active input session and pass through
        const rawText = ctx.message.text.trim();
        if (MENU_KEYWORDS.some(kw => rawText === kw || rawText.endsWith(" " + kw))) {
            delete ctx.session?.customQuantityProduct;
            delete ctx.session?.pendingOrder;
            return next();
        }

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

        const result = await validateCoupon(couponCode, order.amount, ctx.from.id);

        if (!result.valid) {
            let errorMsg;
            switch (result.error) {
                case "EXPIRED": errorMsg = t("couponExpired", lang); break;
                case "USED_UP": errorMsg = t("couponUsedUp", lang); break;
                case "MIN_ORDER": errorMsg = t("couponMinOrder", lang, { min: formatPrice(result.minOrder) }); break;
                case "VIP_REQUIRED": errorMsg = `❌ Mã này chỉ dành cho thành viên VIP${result.vipLevel > 1 ? ` cấp ${result.vipLevel}` : ""}+`; break;
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
        ctx.session.pendingOrder.couponDiscount = discount;

        // processPaymentFlow sẽ stack coupon + quantity discount và tính finalAmount
        await processPaymentFlow(ctx, ctx.session.pendingOrder);
    });

    // Skip coupon -> Go to payment
    bot.action("SKIP_COUPON", async (ctx) => {
        await answerCallback(ctx);
        const order = ctx.session.pendingOrder;

        if (!order) return ctx.reply("Phiên thanh toán đã hết hạn. Vui lòng đặt lại.");

        // Bỏ coupon nhưng giữ quantity discount — processPaymentFlow tính lại
        order.couponId = null;
        order.couponDiscount = 0;

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

        // Recompute giá idempotent — hàm này được gọi từ nhiều luồng (mua ngay, nhập SL,
        // sau coupon, skip coupon). Luôn tính lại từ giá gốc để không cộng dồn sai.
        const unitPrice = orderData.unitPrice || (orderData.quantity ? Math.floor((orderData.amount || 0) / orderData.quantity) : 0);
        const gross = unitPrice * orderData.quantity || orderData.amount || 0;
        const qty = await applyQuantityDiscount(orderData.productId, unitPrice, orderData.quantity);
        const couponDiscount = orderData.couponDiscount || 0;

        orderData.amount = gross;
        orderData.quantityDiscount = qty.discount;
        orderData.quantityDiscountPercent = qty.discountPercent;
        orderData.discount = qty.discount + couponDiscount;
        orderData.finalAmount = Math.max(0, gross - qty.discount - couponDiscount);

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
        await answerCallback(ctx, "Đã hủy thao tác thanh toán.");
        ctx.session.pendingOrder = null;
        await showMainMenu(ctx, { edit: true });
    });

    // Pay with wallet
    bot.action("PAY_WALLET", async (ctx) => {
        const _clearProcessing = () => { ctx.session.processingPayment = false; };
        try {
            await answerCallback(ctx, "⏳ Đang xử lý thanh toán...");
            sendChatAction(ctx, "typing");
            const orderData = ctx.session.pendingOrder;

            if (!orderData) {
                return ctx.reply("Phiên thanh toán đã hết hạn. Vui lòng đặt lại.", {
                    ...Markup.inlineKeyboard([[Markup.button.callback("🏠 Menu", "BACK_HOME")]]),
                });
            }

            if (ctx.session.processingPayment) {
                return ctx.reply("⏳ Đơn hàng đang được xử lý, vui lòng chờ.");
            }
            ctx.session.processingPayment = true;

            // Invalidate cả balanceCache lẫn wallet cache nội bộ — getBalance dùng
            // getOrCreateWallet có cache TTL 15s, nếu chỉ xóa balanceCache thì có thể
            // đọc lại số dư stale từ wallet cache.
            balanceCache.invalidate(String(ctx.from.id));
            invalidateWalletCache(ctx.from.id);
            const [user, balance] = await Promise.all([
                getOrCreateUser(ctx.from),
                getBalance(ctx.from.id),
            ]);

            // Double check balance
            if (balance < orderData.finalAmount) {
                return ctx.reply("Số dư không đủ. Vui lòng nạp thêm.", {
                    ...Markup.inlineKeyboard([[Markup.button.callback("💳 Nạp ví", "WALLET"), Markup.button.callback("🏠 Menu", "BACK_HOME")]]),
                });
            }

            // Tạo order ở PENDING trước. Chỉ promote lên PAID khi đã trừ ví thành công.
            // Nếu process crash giữa create() và walletPurchase() thì order vẫn ở PENDING
            // và bị cancelExpiredOrders dọn sau 10 phút — không có chuyện order PAID mà ví chưa trừ.
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
                    status: "PENDING",
                    paymentMethod: "wallet",
                    couponId: orderData.couponId,
                    userId: user.id,
                },
            });

            const purchaseResult = await walletPurchase(ctx.from.id, orderData.finalAmount, order.id, `Mua ${orderData.productName} x${orderData.quantity}`);

            if (!purchaseResult.success) {
                await prisma.order.update({ where: { id: order.id }, data: { status: "CANCELED" } });
                return ctx.reply(`Lỗi thanh toán: ${purchaseResult.error}`, {
                    ...Markup.inlineKeyboard([[Markup.button.callback("💳 Nạp ví", "WALLET"), Markup.button.callback("🏠 Menu", "BACK_HOME")]]),
                });
            }

            // Promote PENDING → PAID. Gắn paymentRef = walletTx.id để có thể đối soát.
            await prisma.order.update({
                where: { id: order.id },
                data: {
                    status: "PAID",
                    paymentRef: purchaseResult.transaction?.id || `WALLET:${order.id}`,
                },
            });
            order.status = "PAID";
            order.paymentRef = purchaseResult.transaction?.id || `WALLET:${order.id}`;

            // Apply coupon AFTER successful purchase — prevents coupon waste on failed payment
            if (orderData.couponId) await applyCoupon(orderData.couponId).catch(() => {});

            sendLog("ORDER", `✅ Order Success (Wallet): User ${ctx.from.id} bought ${orderData.productName} x${orderData.quantity} - ${formatPrice(orderData.finalAmount)}`);

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
                { parse_mode: "HTML", ...Markup.inlineKeyboard([[Markup.button.callback("🏠 Menu", "BACK_HOME")]]) }
            ).catch(() => { });
        } finally {
            _clearProcessing();
        }
    });

    // Pay with QR (direct)
    bot.action("PAY_QR", async (ctx) => {
        await answerCallback(ctx, "⏳ Đang tạo mã thanh toán...");
        sendChatAction(ctx, "upload_photo");
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

            ctx.session.pendingOrder = null;

            const [, checkout] = await Promise.all([
                orderData.couponId ? applyCoupon(orderData.couponId).catch(() => {}) : Promise.resolve(),
                createCheckout({
                    orderId: order.id,
                    amount: order.finalAmount,
                    productName: orderData.productName,
                    quantity: orderData.quantity,
                }),
            ]);

            await prisma.order.update({
                where: { id: order.id },
                data: { paymentRef: checkout.transferContent },
            });

            const orderKeyboard = Markup.inlineKeyboard([
                [Markup.button.url("📷 Mở QR để quét", checkout.qrUrl)],
                [Markup.button.callback("✅ Tôi đã chuyển, kiểm tra", `ORDER_BANK_CHECK:${order.id}`)],
                [Markup.button.callback("❌ Hủy đơn", `CANCEL_ORDER:${order.id}`)],
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
                console.log("❌ QR image fallback:", qrError.message);
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
            sendLog("ERROR", `❌ PAY_QR failed: User ${ctx.from?.id} - ${error.message}`);
            if (order?.id) {
                await prisma.order.update({
                    where: { id: order.id },
                    data: { status: "CANCELED" },
                }).catch(() => { });
                // Release coupon nếu đã applyCoupon (chạy song song với createCheckout) —
                // tránh usedCount bị tăng vĩnh viễn cho đơn không bao giờ thành công.
                if (order.couponId) await releaseCoupon(order.couponId).catch(() => {});
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

        await editMenu(ctx, `<b>Đã hủy đơn hàng</b>\n${DIVIDER}\nMã đơn: <code>${escapeHtml(orderId.slice(-8).toUpperCase())}</code>`, {
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

        if (!order) return ctx.reply("Không tìm thấy đơn hàng.");

        await sendMenu(ctx, orderDetailMessage(order), {
            parse_mode: "HTML",
            ...buildOrderDetailKeyboard(order),
        });
    });

    // Command: /help
    bot.command("help", async (ctx) => {
        const adminUsername = process.env.ADMIN_TELEGRAM || "admin";

        await sendMenu(ctx, supportMessage(adminUsername), {
            parse_mode: "HTML",
            ...buildSupportKeyboard(adminUsername),
        });
    });

    // === REPLY KEYBOARD HANDLERS ===
    // Single dispatcher - reads icon config from DB, matches dynamically
    bot.on("text", async (ctx, next) => {
        if (hasAdminSession(ctx.from?.id)) return next();
        const text = ctx.message?.text;
        if (!text) return next();

        if (ctx.session?.pendingAction) return next();

        const icons = await getMenuIcons();
        const textMap = new Map();
        for (const [action, label] of Object.entries(BUTTON_LABELS)) {
            textMap.set(`${icons[action] ?? DEFAULT_ICONS[action]} ${label}`, action);
        }
        // Legacy aliases for old keyboards already sent to users
        textMap.set("💳 Nạp tiền", "WALLET");
        textMap.set("💰 Nạp tiền", "WALLET");

        const action = textMap.get(text);
        if (!action) return next();

        switch (action) {
            case "WALLET": {
                const [balance, presets] = await Promise.all([getBalance(ctx.from.id), getDepositPresets()]);
                await cleanReply(ctx, walletMessage(balance), { parse_mode: "HTML", ...buildWalletKeyboard(presets) });
                break;
            }
            case "LIST_PRODUCTS": {
                const ui = await renderProductList(ctx);
                await cleanReply(ctx, ui.text, { parse_mode: "HTML", ...ui.keyboard });
                break;
            }
            case "MY_ORDERS": {
                const telegramId = String(ctx.from.id);
                const orders = await prisma.order.findMany({
                    where: { odelegramId: telegramId },
                    include: { product: true },
                    orderBy: { createdAt: "desc" },
                    take: 5,
                });
                await cleanReply(ctx, ordersMessage(orders), { parse_mode: "HTML", ...buildOrderListKeyboard(orders) });
                break;
            }
            case "ACCOUNT": {
                const telegramId = String(ctx.from.id);
                const [balance, orders] = await Promise.all([
                    getBalance(ctx.from.id),
                    prisma.order.findMany({ where: { odelegramId: telegramId } }),
                ]);
                const totalOrders = orders.length;
                const totalSpent = orders
                    .filter(o => o.status === "DELIVERED" || o.status === "PAID")
                    .reduce((sum, o) => sum + o.finalAmount, 0);
                await cleanReply(ctx, accountMessage({ ctx, balance, orderCount: totalOrders, totalSpent }), {
                    parse_mode: "HTML",
                    ...buildAccountKeyboard(),
                });
                break;
            }
            case "HELP": {
                const adminUsername = process.env.ADMIN_TELEGRAM || "admin";
                await cleanReply(ctx, supportMessage(adminUsername), { parse_mode: "HTML", ...buildSupportKeyboard(adminUsername) });
                break;
            }
            case "ALL_PRODUCTS": {
                const ui = await renderAllProducts(1);
                await cleanReply(ctx, ui.text, { parse_mode: "HTML", ...ui.keyboard });
                break;
            }
            case "ADMIN_PANEL": {
                if (!isAdmin(ctx.from.id)) {
                    return cleanReply(ctx, "Bạn không có quyền truy cập.");
                }
                await showAdminPanel(ctx, false);
                break;
            }
        }
    });

    // Handle text messages (for custom deposit amount)
    bot.on("text", async (ctx, next) => {
        if (hasAdminSession(ctx.from?.id)) return next();
        // Bỏ qua command (/admin, /start, /menu...) — không nuốt vào deposit handler.
        // Đồng thời clear pendingAction để session không bị kẹt sau khi user
        // gõ command thoát giữa flow nhập số tiền.
        if (ctx.message?.text?.startsWith("/")) {
            if (ctx.session?.pendingAction) {
                ctx.session.pendingAction = null;
            }
            return next();
        }

        // Check if waiting for custom deposit amount
        if (ctx.session?.pendingAction === "DEPOSIT_AMOUNT") {
            const text = ctx.message.text.replace(/[,.\s]/g, "");
            const amount = parseInt(text, 10);

            if (isNaN(amount)) {
                // Không phải số — user bấm nút menu, hủy flow deposit
                ctx.session.pendingAction = null;
                return next();
            }
            if (amount < 10000) {
                return ctx.reply("Số tiền không hợp lệ. Tối thiểu 10.000đ. Vui lòng nhập lại:");
            }
            const maxDeposit = await getMaxDeposit();
            if (maxDeposit > 0 && amount > maxDeposit) {
                return ctx.reply(`Số tiền vượt mức tối đa ${maxDeposit.toLocaleString("vi-VN")}đ mỗi lần nạp. Vui lòng nhập lại:`);
            }

            ctx.session.pendingAction = null;

            const tx = await createDeposit(ctx.from.id, amount);
            const depositContent = generateDepositContent(ctx.from.id, tx.id);
            const qrUrl = generateQRUrl(amount, depositContent);
            const expireMinutes = getExpireMinutes();
            const paymentKey = `deposit:${tx.id}`;

            const bank = await getBankConfig();
            const bankName = bank.bankName;
            const bankAccount = bank.accountNumber;
            const accountName = bank.accountName;
            const msg = buildDepositMsg({ amount, depositContent, bankName, bankAccount, accountName, expireMinutes });

            const depositKeyboard2 = Markup.inlineKeyboard([
                [Markup.button.url("📷 Mở QR để quét", qrUrl)],
                [Markup.button.callback("✅ Tôi đã chuyển, kiểm tra", `DEPOSIT_CHECK:${tx.id}`)],
                [Markup.button.callback("← Quay lại ví", "WALLET")],
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
                        { caption: `📷 QR chuyển khoản — ${formatPrice(amount)}` });
                    rememberPaymentMessage(ctx, paymentKey, qrMsg);
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
            const result = await Promise.race([
                confirmDepositByBankScan(transactionId, ctx.from.id),
                new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 10000)),
            ]);

            if (result.success && result.alreadyProcessed) {
                await clearPaymentMessages(ctx.chat.id, `deposit:${transactionId}`);
                return ctx.reply(
                    `✅ <b>Giao dịch đã được xử lý</b>\n${DIVIDER}\n💳 Số dư hiện tại: <b>${formatPrice(result.newBalance || 0)}</b>`,
                    { parse_mode: "HTML" },
                );
            }

            if (result.success) {
                sendLog("DEPOSIT", `Manual deposit confirmed: User ${ctx.from.id} - ${formatPrice(result.matched?.amount || 0)} - ${result.paymentRef}`);
                await clearPaymentMessages(ctx.chat.id, `deposit:${transactionId}`);
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
            const result = await Promise.race([
                confirmOrderByBankScan(orderId, ctx.from.id),
                new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 30000)),
            ]);

            if (!result.success) {
                const state = getState(ctx.chat.id);
                // Delete previous "not found" notice for this order (if any) to avoid pile-up
                if (state.bankCheckMsg?.orderId === orderId && state.bankCheckMsg?.messageId) {
                    await safeDeleteByChat(ctx.chat.id, state.bankCheckMsg.messageId);
                    state.bankCheckMsg = null;
                }
                const noticeMsg = await ctx.reply(
                    `⏳ <b>Chưa tìm thấy giao dịch</b>\n${DIVIDER}\n${escapeHtml(result.error || "")}\n\nNếu vừa chuyển khoản, hãy chờ 30–60 giây rồi bấm kiểm tra lại.`,
                    { parse_mode: "HTML" },
                );
                state.bankCheckMsg = { orderId, messageId: noticeMsg.message_id };
                return;
            }
            // Payment found — clear the "not found" notice
            const state = getState(ctx.chat.id);
            if (state.bankCheckMsg?.orderId === orderId && state.bankCheckMsg?.messageId) {
                await safeDeleteByChat(ctx.chat.id, state.bankCheckMsg.messageId).catch(() => {});
                state.bankCheckMsg = null;
            }

            if (result.alreadyProcessed) {
                const [order, deletedQr] = await Promise.all([
                    prisma.order.findUnique({
                        where: { id: orderId },
                        include: { product: { include: { category: true } } },
                    }),
                    clearPaymentMessages(ctx.chat.id, `order:${orderId}`),
                ]);
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

            const [deliveredOrder, deletedQr] = await Promise.all([
                prisma.order.findUnique({
                    where: { id: orderId },
                    include: { product: { include: { category: true } } },
                }),
                clearPaymentMessages(ctx.chat.id, `order:${orderId}`),
            ]);
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
            const isTimeout = error.message === "timeout";
            const isConfig = error.message?.includes("cấu hình");
            return ctx.reply(
                `❌ <b>Không kiểm tra được lúc này</b>\n${DIVIDER}\n${isTimeout ? "Máy chủ ngân hàng phản hồi chậm. Vui lòng thử lại." : isConfig ? error.message : "Vui lòng thử lại sau ít phút."}`,
                { parse_mode: "HTML" },
            );
        }
    });

    // Re-show QR for existing PENDING order
    bot.action(/^SHOW_ORDER_QR:(.+)$/, async (ctx) => {
        await answerCallback(ctx, "⏳ Đang tải QR...");
        sendChatAction(ctx, "upload_photo");
        const orderId = ctx.match[1];
        const lang = getLang(ctx);

        const order = await prisma.order.findUnique({
            where: { id: orderId },
            include: { product: true },
        });

        if (!order || order.odelegramId !== String(ctx.from.id)) {
            return ctx.reply("Không tìm thấy đơn hàng.");
        }
        if (order.status !== "PENDING") {
            return editMenu(ctx, orderDetailMessage(order), buildOrderDetailKeyboard(order));
        }

        const checkout = await createCheckout({
            orderId: order.id,
            amount: order.finalAmount,
            productName: order.product?.name || "Sản phẩm",
            quantity: order.quantity,
        });

        const orderKeyboard = Markup.inlineKeyboard([
            [Markup.button.url("📷 Mở QR để quét", checkout.qrUrl)],
            [Markup.button.callback("✅ Tôi đã chuyển, kiểm tra", `ORDER_BANK_CHECK:${order.id}`)],
            [Markup.button.callback("❌ Hủy đơn", `CANCEL_ORDER:${order.id}`)],
        ]);
        const paymentKey = `order:${order.id}`;

        await clearPaymentMessages(ctx.chat.id, paymentKey);
        await deleteCurrentCallbackMessage(ctx);
        getState(ctx.chat.id).paymentMessages.set(paymentKey, new Set());

        try {
            const qrRes = await fetch(checkout.qrUrl, { signal: AbortSignal.timeout(6000) });
            if (!qrRes.ok) throw new Error(`QR HTTP ${qrRes.status}`);
            const qrBuffer = Buffer.from(await qrRes.arrayBuffer());
            const qrMsg = await ctx.replyWithPhoto(
                { source: qrBuffer, filename: "qr.png" },
                { caption: getPaymentMessage(checkout, lang), parse_mode: "HTML", ...orderKeyboard }
            );
            rememberPaymentMessage(ctx, paymentKey, qrMsg);
        } catch {
            const qrMsg = await ctx.reply(getPaymentMessage(checkout, lang), {
                parse_mode: "HTML",
                disable_web_page_preview: true,
                ...orderKeyboard,
            });
            rememberPaymentMessage(ctx, paymentKey, qrMsg);
        }
    });

    // Admin: forward animated emoji/sticker → bot replies with emoji document_id
    bot.on(["sticker", "message"], async (ctx, next) => {
        if (!isAdmin(ctx.from?.id)) return next();
        // If admin is mid-session (e.g. EDIT_MENU_ICON), let the session handler process first
        if (hasAdminSession(ctx.from.id)) return next();
        const msg = ctx.message;
        if (!msg) return next();

        // Custom emoji entities in a text/caption message
        const entities = msg.entities || msg.caption_entities || [];
        const tgEmojis = entities.filter((e) => e.type === "custom_emoji");
        if (tgEmojis.length > 0) {
            const lines = tgEmojis.map((e) => `<code>tg:${e.custom_emoji_id}</code>`);
            return ctx.reply(
                `✨ <b>Telegram Emoji ID:</b>\n${lines.join("\n")}\n\n` +
                `Dán vào ô <b>Telegram Emoji ID</b> trong icon manager.`,
                { parse_mode: "HTML" }
            );
        }

        // Animated sticker
        if (msg.sticker && msg.sticker.is_animated) {
            const id = msg.sticker.file_id;
            return ctx.reply(
                `🎭 <b>Animated Sticker ID:</b>\n<code>tg:${id}</code>\n\n` +
                `Dán vào ô <b>Telegram Emoji ID</b> trong icon manager.`,
                { parse_mode: "HTML" }
            );
        }

        // Animated emoji (dice, etc.)
        if (msg.animation) {
            const id = msg.animation.file_unique_id;
            return ctx.reply(
                `🎬 <b>Animation ID:</b>\n<code>tg:${id}</code>`,
                { parse_mode: "HTML" }
            );
        }

        return next();
    });

    // Pre-warm all caches on startup so first user gets instant response
    Promise.allSettled([
        getMenuIcons(),
        getMenuIconIds(),
        getWelcomeGreeting(),
        getCachedProductCount(),
        getCachedMemberCount(),
    ]).then(() => console.log("✅ Bot caches pre-warmed"));

    return bot;
}
