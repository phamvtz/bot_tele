import { Telegraf, Markup, session } from "telegraf";
import { Agent as HttpsAgent } from "node:https";
import QRCode from "qrcode";
import { createMongoSessionStore } from "./lib/session-store.js";
import { balanceCache } from "./lib/cache.js";
import { prisma } from "./db.js";
import { t, getLanguages } from "./i18n/index.js";
import { rateLimitMiddleware } from "./ratelimit.js";
import { getStockCount } from "./inventory.js";
import { validateCoupon, calculateDiscount, applyCoupon, releaseCoupon } from "./coupon.js";
import { applyQuantityDiscount } from "./quantity-discount.js";
import { getBankConfig, getBankConfigSync, getMaxDeposit, getDepositPresets } from "./shop-config.js";
import { getOrCreateUser, getReferralStats, getReferralLink } from "./referral.js";
import { renderCategoryList, renderProductsInCategory, renderAllProducts } from "./category.js";
import { getMenuIcons, getMenuIconIds, setMenuIcon, invalidateMenuCache, BUTTON_LABELS, DEFAULT_ICONS, getWelcomeGreeting, getWelcomeGreetingSync, DEFAULT_WELCOME_GREETING } from "./menu-config.js";
import { showAdminPanel, hasAdminSession } from "./admin.js";
import { createCheckout, getPaymentMessage, getExpireMinutes } from "./payment/provider.js";
import { generateQRUrl } from "./payment/vietqr.js";
import {
    buildCryptoPaymentRef,
    buildCryptoDepositRef,
    createCryptoCheckout,
    createCryptoDepositCheckout,
    formatCryptoDepositMessage,
    formatCryptoPaymentMessage,
    getEnabledCryptoNetworks,
    getOrderExpectedCrypto,
    getUsdVndRate,
    isCryptoPaymentMethod,
} from "./payment/crypto.js";
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
import { confirmDepositByCryptoScan, confirmOrderByCryptoScan } from "./crypto-poller.js";
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
    const webhookMode = Boolean(process.env.WEBHOOK_URL)
        && process.env.WEBHOOK_ENABLED !== "false"
        && String(process.env.BOT_MODE || "").toLowerCase() !== "polling";
    // HTTP keep-alive agent: tái dùng kết nối TLS tới api.telegram.org thay vì mở
    // mới mỗi lệnh. Giảm mạnh độ trễ + lỗi "socket hang up" trên mạng VPS chập chờn.
    const tgAgent = new HttpsAgent({ keepAlive: true, maxSockets: 64, keepAliveMsecs: 30000 });
    const bot = new Telegraf(botToken, {
        telegram: {
            agent: tgAgent,
            apiRoot: process.env.TELEGRAM_API_ROOT || "https://api.telegram.org",
            // webhookReply: gửi phản hồi ĐẦU TIÊN ngay trong HTTP response của webhook
            // → tiết kiệm 1 round-trip VPS→Telegram cho mỗi lần bấm nút (mượt hơn rõ khi
            //   mạng chậm). Chỉ dùng nếu chạy webhook mode.
            webhookReply: webhookMode,
        },
        handlerTimeout: 90_000,
    });

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

    const scheduleOrderDelivery = ({ telegram, order, source = "manual" }) => {
        if (!order?.id) return;
        setTimeout(async () => {
            try {
                await deliverOrder({ prisma, telegram, order });
            } catch (error) {
                console.error(`[delivery:${source}] pending order ${order.id}:`, error.message);
                sendLog("ERROR", `⚠️ Delivery pending (${source}): Order ${order.id} - ${error.message}`);
            }
        }, 0);
    };

    const parseUsdtInput = (value) => {
        const raw = String(value || "").trim().replace(/\s+/g, "");
        if (!raw) return NaN;
        const normalized = raw.includes(",") && !raw.includes(".")
            ? raw.replace(",", ".")
            : raw.replace(/,/g, "");
        return Number(normalized);
    };

    // Gửi ảnh QR (chạy nền). Ưu tiên để Telegram TỰ FETCH url (mạng Telegram ổn định
    // hơn VPS ra ngoài); nếu Telegram không fetch được thì mới tải về buffer rồi gửi.
    const sendQrPhoto = (ctx, paymentKey, qrUrl, amount, captionOverride = null) => {
        (async () => {
            const caption = captionOverride || `📷 QR chuyển khoản — ${formatPrice(amount)}`;
            if (!isPaymentMessageActive(ctx.chat.id, paymentKey)) return;
            try {
                const qrMsg = await ctx.replyWithPhoto(qrUrl, { caption });
                if (isPaymentMessageActive(ctx.chat.id, paymentKey)) rememberPaymentMessage(ctx, paymentKey, qrMsg);
                return;
            } catch (e) {
                console.log("[sendQrPhoto] Telegram fetch URL lỗi, thử tải buffer:", e.message);
            }
            try {
                const qrRes = await fetch(qrUrl, { signal: AbortSignal.timeout(8000) });
                if (!qrRes.ok || !isPaymentMessageActive(ctx.chat.id, paymentKey)) return;
                const qrBuffer = Buffer.from(await qrRes.arrayBuffer());
                if (!isPaymentMessageActive(ctx.chat.id, paymentKey)) return;
                const qrMsg = await ctx.replyWithPhoto({ source: qrBuffer, filename: "qr.png" }, { caption });
                rememberPaymentMessage(ctx, paymentKey, qrMsg);
            } catch (e2) {
                console.log("[sendQrPhoto] Tải QR buffer cũng lỗi:", e2.message);
            }
        })();
    };

    const sendGeneratedQrPhoto = async (ctx, paymentKey, qrText, caption) => {
        if (!isPaymentMessageActive(ctx.chat.id, paymentKey)) return null;
        const withTimeout = (promise, ms = 8000) => Promise.race([
            promise,
            new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), ms)),
        ]);
        try {
            const qrBuffer = await QRCode.toBuffer(qrText, {
                type: "png",
                width: 520,
                margin: 3,
                errorCorrectionLevel: "M",
            });
            if (!isPaymentMessageActive(ctx.chat.id, paymentKey)) return null;
            try {
                const qrMsg = await withTimeout(ctx.replyWithPhoto(
                    { source: qrBuffer, filename: "usdt-qr.png" },
                    { caption },
                ));
                rememberPaymentMessage(ctx, paymentKey, qrMsg);
                return qrMsg;
            } catch (photoError) {
                console.log("[sendGeneratedQrPhoto] Gửi QR photo lỗi, thử gửi file:", photoError.message);
                if (!isPaymentMessageActive(ctx.chat.id, paymentKey)) return null;
                const docMsg = await withTimeout(ctx.replyWithDocument(
                    { source: qrBuffer, filename: "usdt-qr.png" },
                    { caption },
                ));
                rememberPaymentMessage(ctx, paymentKey, docMsg);
                return docMsg;
            }
        } catch (error) {
            console.log("[sendGeneratedQrPhoto] Tạo/gửi QR lỗi:", error.message);
            return null;
        }
    };

    const buildExternalQrUrl = (qrText) => {
        const size = "360x360";
        return `https://api.qrserver.com/v1/create-qr-code/?size=${size}&margin=12&data=${encodeURIComponent(qrText)}`;
    };

    const buildCryptoQrPayload = (checkout) =>
        `USDT ${checkout.networkLabel}\nAddress: ${checkout.address}\nAmount: ${checkout.amountToken.toFixed(6)} USDT`;

    // cleanReply = alias for sendMenu (backward compatibility)
    const cleanReply = sendMenu;

    // Helper to build dynamic main menu â€” nháº­n productCount tá»« ngoÃ i, khÃ´ng query thÃªm
    const buildMainMenu = async (ctx) => {
        const [icons, iconIds] = await Promise.all([getMenuIcons(), getMenuIconIds()]);
        return buildMainMenuKeyboard({ isAdmin: isAdmin(ctx.from.id), icons, iconIds, lang: getLang(ctx) });
    };

    // Share icon fetch between buildMainMenu and getUserKeyboard when called together
    const getUserKeyboard = async (userId, iconsCache, lang = "vi") => {
        const icons = iconsCache || await getMenuIcons();
        return buildReplyKeyboard({ isAdmin: isAdmin(userId), icons, lang });
    };

    const _adminSet = new Set((process.env.ADMIN_IDS || "").split(",").filter(Boolean));
    const isAdmin = (userId) => _adminSet.has(String(userId));

    // ============================================
    // ONBOARDING GATE — yêu cầu tham gia nhóm/kênh
    // ============================================
    const REQUIRED_GROUP = process.env.REQUIRED_GROUP || process.env.ORDER_NOTIFY_CHANNEL || "";
    const GROUP_LINK = process.env.REQUIRED_GROUP_URL || process.env.SUPPORT_CHANNEL_URL || "https://t.me/vpluschannelkh";
    const REQUIRE_GROUP_JOIN = process.env.REQUIRE_GROUP_JOIN !== "false";
    // Mặc định FAIL-CLOSED: nếu bot không kiểm tra được (chưa là admin của nhóm) thì
    // CHẶN, buộc chủ shop phải thêm bot làm admin. Đặt GROUP_GATE_FAILOPEN=true để cho qua.
    const GROUP_GATE_FAILOPEN = process.env.GROUP_GATE_FAILOPEN === "true";
    // Mặc định admin KHÔNG được bỏ qua cổng (để test được + admin vốn đã ở trong nhóm).
    // Đặt GROUP_GATE_ADMIN_BYPASS=true nếu muốn admin luôn bỏ qua.
    const GROUP_GATE_ADMIN_BYPASS = process.env.GROUP_GATE_ADMIN_BYPASS === "true";

    // Kiểm tra user đã là thành viên nhóm/kênh bắt buộc chưa.
    const isGroupMember = async (userId) => {
        if (!REQUIRE_GROUP_JOIN || !REQUIRED_GROUP) return true;
        if (GROUP_GATE_ADMIN_BYPASS && isAdmin(userId)) return true;
        try {
            const member = await bot.telegram.getChatMember(REQUIRED_GROUP, userId);
            const status = member?.status;
            if (status === "restricted") return member?.is_member !== false;
            return ["creator", "administrator", "member"].includes(status);
        } catch (e) {
            console.error(`[group-gate] KHÔNG kiểm tra được thành viên ${REQUIRED_GROUP}: ${e.message}. ` +
                `Bot PHẢI là ADMIN của nhóm/kênh này. ${GROUP_GATE_FAILOPEN ? "Tạm cho qua (FAILOPEN=true)." : "Đang CHẶN (đặt GROUP_GATE_FAILOPEN=true để cho qua)."}`);
            return GROUP_GATE_FAILOPEN;
        }
    };

    const buildJoinKeyboard = (lang) => Markup.inlineKeyboard([
        [Markup.button.url(t("joinGroupButton", lang), GROUP_LINK)],
        [Markup.button.callback(t("joinedButton", lang), "VERIFY_JOIN")],
    ]);

    const showLanguageGate = async (ctx) => {
        const languages = getLanguages();
        await ctx.reply(t("selectLanguage", getLang(ctx)), Markup.inlineKeyboard(
            languages.map((l) => [Markup.button.callback(l.name, `ONBOARD_LANG:${l.code}`)])
        ));
    };

    const showJoinGate = async (ctx, { edit = false } = {}) => {
        const lang = getLang(ctx);
        const text = `${t("joinGroupTitle", lang)}\n${DIVIDER}\n${t("joinGroupPrompt", lang)}`;
        const kb = buildJoinKeyboard(lang);
        if (edit && ctx.callbackQuery) return editMenu(ctx, text, { parse_mode: "HTML", ...kb });
        return ctx.reply(text, { parse_mode: "HTML", ...kb });
    };

    // Sau khi qua cổng onboarding → hiện menu chính + reply keyboard.
    const finishOnboarding = async (ctx) => {
        ctx.session.onboarded = true;
        ctx.session.groupVerifiedAt = Date.now();
        await showMainMenu(ctx);
        const replyKbd = await getUserKeyboard(ctx.from.id, null, getLang(ctx));
        const greetingTpl = getWelcomeGreetingSync() ?? DEFAULT_WELCOME_GREETING;
        const greetingText = greetingTpl.replace(/\{name\}/g, escapeHtml(ctx.from.first_name || "bạn"));
        await ctx.reply(greetingText, { parse_mode: "HTML", ...replyKbd });
    };

    // Middleware chặn toàn cục: user CHƯA vào nhóm không dùng được bất kỳ chức năng
    // nào (kể cả bấm nút reply keyboard cũ). Chỉ cho phép /start và các nút onboarding.
    const GROUP_VERIFY_TTL = 6 * 60 * 60 * 1000; // 6h cache trong session
    bot.use(async (ctx, next) => {
        if (!REQUIRE_GROUP_JOIN || !REQUIRED_GROUP) return next();
        if (ctx.chat?.type && ctx.chat.type !== "private") return next(); // bỏ qua update từ nhóm/kênh
        if (!ctx.from) return next();
        if (GROUP_GATE_ADMIN_BYPASS && isAdmin(ctx.from.id)) return next();

        // Cho phép /start (tự xử lý cổng) và các callback onboarding
        const text = ctx.message?.text || "";
        if (text.startsWith("/start")) return next();
        const data = ctx.callbackQuery?.data || "";
        if (data.startsWith("ONBOARD_LANG:") || data === "VERIFY_JOIN") return next();

        // Chưa chọn ngôn ngữ → ép về luồng /start (chọn ngôn ngữ trước)
        if (!ctx.session?.langChosen) {
            await showLanguageGate(ctx).catch(() => {});
            return;
        }

        // Đã verify gần đây trong session → cho qua, khỏi gọi API
        const verifiedAt = ctx.session?.groupVerifiedAt || 0;
        if (verifiedAt && Date.now() - verifiedAt < GROUP_VERIFY_TTL) return next();

        if (await isGroupMember(ctx.from.id)) {
            if (ctx.session) ctx.session.groupVerifiedAt = Date.now();
            return next();
        }

        // Chưa vào nhóm → chặn và hiện cổng tham gia
        if (ctx.callbackQuery) {
            await ctx.answerCbQuery(t("notJoinedYet", getLang(ctx)), { show_alert: true }).catch(() => {});
        }
        await showJoinGate(ctx).catch(() => {});
    });

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

    // Cache VIP display data per-user 30s — tránh query user mỗi lần mở/điều hướng menu.
    const _vipDisplayCache = new Map();
    const getCachedVipDisplay = async (telegramId) => {
        const entry = _vipDisplayCache.get(String(telegramId));
        if (entry && Date.now() - entry.ts < 30000) return entry.value;
        const [user, levels] = await Promise.all([
            prisma.user.findUnique({ where: { telegramId: String(telegramId) }, select: { vipLevel: true, totalSpent: true } }),
            getVipLevels(),
        ]);
        let value = {};
        if (user && levels?.length) {
            const currentLevel = levels.find(l => l.level === user.vipLevel) || levels[0];
            const nextLevel = levels.find(l => l.level === (user.vipLevel ?? 0) + 1) || null;
            value = {
                vipEmoji: getVipEmoji(user.vipLevel ?? 0),
                vipName: currentLevel?.name || "Thường",
                totalSpent: user.totalSpent || 0,
                nextLevelName: nextLevel?.name || null,
                nextLevelMinSpent: nextLevel?.minSpent || 0,
            };
        }
        _vipDisplayCache.set(String(telegramId), { value, ts: Date.now() });
        return value;
    };

    const showMainMenu = async (ctx, { edit = false } = {}) => {
        const [balance, productCount, keyboard, vipData, memberCount] = await Promise.all([
            getBalance(ctx.from.id).catch(() => 0),
            getCachedProductCount(),
            buildMainMenu(ctx),
            getCachedVipDisplay(ctx.from.id).catch(() => ({})),
            getCachedMemberCount().catch(() => null),
        ]);
        const text = mainMenuMessage({
            firstName: ctx.from.first_name || "bạn",
            balance,
            productCount,
            memberCount,
            lang: getLang(ctx),
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
        const existingUser = await prisma.user.findUnique({
            where: { telegramId: String(ctx.from.id) },
            select: { language: true },
        }).catch(() => null);
        await getOrCreateUser(ctx.from, referralCode).catch(() => {});
        if (existingUser?.language) {
            ctx.session.language = existingUser.language;
            ctx.session.langChosen = true;
        }

        // ── Cổng onboarding ─────────────────────────────────────────────
        // 1) Lần đầu chưa chọn ngôn ngữ → hiện chọn ngôn ngữ (VI/EN/ZH).
        // 2) Chưa tham gia nhóm bắt buộc → yêu cầu tham gia rồi mới vào menu.
        if (!ctx.session.langChosen) {
            await safeDelete(ctx, ctx.message.message_id);
            return showLanguageGate(ctx);
        }
        if (!(await isGroupMember(ctx.from.id))) {
            await safeDelete(ctx, ctx.message.message_id);
            return showJoinGate(ctx);
        }
        ctx.session.groupVerifiedAt = Date.now();

        // Deep link: /start product_PRODUCTID → mở thẳng sản phẩm
        if (startParam?.startsWith("product_")) {
            const productId = startParam.replace("product_", "");
            const product = await prisma.product.findUnique({ where: { id: productId } }).catch(() => null);
            if (product?.isActive) {
                const replyKbd = await getUserKeyboard(ctx.from.id, null, getLang(ctx));
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

        const replyKbd = await getUserKeyboard(ctx.from.id, null, getLang(ctx));
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
        const lang = getLang(ctx);
        const [balance, presets] = await Promise.all([getBalance(ctx.from.id), getDepositPresets()]);
        await sendMenu(ctx, walletMessage(balance, { lang }), { parse_mode: "HTML", ...buildWalletKeyboard(presets, { lang }) });
    });

    // /orders command — show user's orders
    bot.command("orders", async (ctx) => {
        const lang = getLang(ctx);
        const telegramId = String(ctx.from.id);
        const orders = await prisma.order.findMany({
            where: { odelegramId: telegramId },
            include: { product: true },
            orderBy: { createdAt: "desc" },
            take: 20,
        });
        await sendMenu(ctx, ordersMessage(orders, { lang }), { parse_mode: "HTML", ...buildOrderListKeyboard(orders, { lang }) });
    });

    // /support command — show support screen
    bot.command("support", async (ctx) => {
        const lang = getLang(ctx);
        const adminUsername = process.env.ADMIN_TELEGRAM || "admin";
        await sendMenu(ctx, supportMessage(adminUsername, { lang }), { parse_mode: "HTML", ...buildSupportKeyboard(adminUsername, { lang }) });
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
        const replyKbd = await getUserKeyboard(ctx.from.id, null, newLang);
        await ctx.reply(t("languageChanged", newLang), { parse_mode: "HTML", ...replyKbd }).catch(() => {});
    });

    // Onboarding: chọn ngôn ngữ lần đầu → chuyển sang cổng tham gia nhóm.
    bot.action(/^ONBOARD_LANG:(.+)$/, async (ctx) => {
        await answerCallback(ctx);
        const newLang = ctx.match[1];
        ctx.session.language = newLang;
        ctx.session.langChosen = true;

        await prisma.user.update({
            where: { telegramId: String(ctx.from.id) },
            data: { language: newLang },
        }).catch(() => {});

        // Chưa vào nhóm → hiện cổng tham gia. Đã vào (hoặc không yêu cầu) → vào menu.
        if (!(await isGroupMember(ctx.from.id))) {
            return showJoinGate(ctx, { edit: true });
        }
        await deleteCurrentCallbackMessage(ctx);
        await finishOnboarding(ctx);
    });

    // Onboarding: kiểm tra đã tham gia nhóm chưa.
    bot.action("VERIFY_JOIN", async (ctx) => {
        const lang = getLang(ctx);
        if (!(await isGroupMember(ctx.from.id))) {
            return ctx.answerCbQuery(t("notJoinedYet", lang), { show_alert: true }).catch(() => {});
        }
        await ctx.answerCbQuery(t("joinedOk", lang)).catch(() => {});
        await deleteCurrentCallbackMessage(ctx);
        await finishOnboarding(ctx);
    });

    // Tắt thông báo "đơn hàng mới" trong 24 giờ.
    bot.action("MUTE_ORDER_NOTIFY", async (ctx) => {
        const until = Date.now() + 24 * 60 * 60 * 1000;
        await prisma.user.update({
            where: { telegramId: String(ctx.from.id) },
            data: { notifyMutedUntil: until },
        }).catch(() => {});
        await ctx.answerCbQuery("🔕 Đã tắt thông báo đơn mới trong 24 giờ.", { show_alert: true }).catch(() => {});
        await deleteCurrentCallbackMessage(ctx).catch(() => {});
    });

    // Help - Main menu
    bot.action("HELP", async (ctx) => {
        await answerCallback(ctx);
        const adminUsername = process.env.ADMIN_TELEGRAM || "admin";
        const lang = getLang(ctx);
        await editMenu(ctx, supportMessage(adminUsername, { lang }), buildSupportKeyboard(adminUsername, { lang }));
    });

    bot.action("HELP:BUYING", async (ctx) => {
        await answerCallback(ctx);
        const lang = getLang(ctx);
        await editMenu(ctx, t("helpBuyingText", lang), {
            ...Markup.inlineKeyboard([
                [Markup.button.callback(t("menuProducts", lang), "LIST_PRODUCTS")],
                [Markup.button.callback(t("back", lang), "HELP")],
            ]),
        });
    });

    bot.action("HELP:WALLET", async (ctx) => {
        await answerCallback(ctx);
        const lang = getLang(ctx);
        const walletLabel = lang === "en" ? "💰 Wallet" : lang === "zh" ? "💰 钱包" : "💰 Ví";
        await editMenu(ctx, t("helpWalletText", lang), {
            ...Markup.inlineKeyboard([
                [Markup.button.callback(walletLabel, "WALLET")],
                [Markup.button.callback(t("back", lang), "HELP")],
            ]),
        });
    });

    bot.action("HELP:PAYMENT", async (ctx) => {
        await answerCallback(ctx);
        const lang = getLang(ctx);
        await editMenu(ctx, t("helpPaymentText", lang), {
            ...Markup.inlineKeyboard([[Markup.button.callback(t("back", lang), "HELP")]]),
        });
    });

    bot.action("HELP:REFERRAL", async (ctx) => {
        await answerCallback(ctx);
        const lang = getLang(ctx);
        await editMenu(ctx, t("helpReferralText", lang), {
            ...Markup.inlineKeyboard([[Markup.button.callback(t("back", lang), "HELP")]]),
        });
    });

    bot.action("HELP:CONTACT", async (ctx) => {
        await answerCallback(ctx);

        const adminUsername = process.env.ADMIN_TELEGRAM || "admin";

        const lang = getLang(ctx);
        await editMenu(ctx, supportMessage(adminUsername, { lang }), buildSupportKeyboard(adminUsername, { lang }));
    });

    // === USER PROFILE SECTION ===

    // /me command - User profile with order stats
    bot.command("me", async (ctx) => {
        const lang = getLang(ctx);
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
            accountMessage({ ctx, balance, orderCount: totalOrders, totalSpent, lang }),
            {
                parse_mode: "HTML",
                ...buildAccountKeyboard({ lang }),
            }
        );
    });

    bot.action("ACCOUNT", async (ctx) => {
        await answerCallback(ctx);
        const lang = getLang(ctx);
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
            lang,
        }), {
            ...buildAccountKeyboard({ lang }),
        });
    });

    // MY_ORDERS - Show user's orders with clickable list
    bot.action("MY_ORDERS", async (ctx) => {
        await answerCallback(ctx);
        sendChatAction(ctx, "typing");
        const lang = getLang(ctx);
        const telegramId = String(ctx.from.id);

        const orders = await prisma.order.findMany({
            where: { odelegramId: telegramId },
            include: { product: true },
            orderBy: { createdAt: "desc" },
            take: 20,
        });

        await editMenu(ctx, ordersMessage(orders, { lang }), buildOrderListKeyboard(orders, { lang }));
    });

    // ORDER detail - Show single order details
    bot.action(/^ORDER:(.+)$/, async (ctx) => {
        await answerCallback(ctx);
        sendChatAction(ctx, "typing");
        const lang = getLang(ctx);
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

        await editMenu(ctx, orderDetailMessage(order, { lang }), buildOrderDetailKeyboard(order, { lang }));
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
        const lang = getLang(ctx);
        const [balance, presets] = await Promise.all([getBalance(ctx.from.id), getDepositPresets()]);

        await sendMenu(
            ctx,
            walletMessage(balance, { lang }),
            {
                parse_mode: "HTML",
                ...buildWalletKeyboard(presets, { lang }),
            }
        );
    });

    // Wallet - Show balance and deposit options
    bot.action("WALLET", async (ctx) => {
        await answerCallback(ctx);
        sendChatAction(ctx, "typing");
        const lang = getLang(ctx);
        const [balance, , presets] = await Promise.all([
            getBalance(ctx.from.id),
            clearPaymentMessages(ctx.chat.id),
            getDepositPresets(),
        ]);
        await editMenu(ctx, walletMessage(balance, { lang }), buildWalletKeyboard(presets, { lang }));
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

        // Dùng bank config SYNC (cache đã warm) — bỏ 1 round-trip DB (~200ms Atlas).
        const bank = getBankConfigSync();
        const bankAccount = bank.accountNumber;
        const bankName = bank.bankName;
        const accountName = bank.accountName;

        const msg = buildDepositMsg({ amount, depositContent, bankName, bankAccount, accountName, expireMinutes });

        const depositKeyboard = Markup.inlineKeyboard([
            [Markup.button.url("📷 Mở QR để quét", qrUrl)],
            [Markup.button.callback("✅ Tôi đã chuyển, kiểm tra", `DEPOSIT_CHECK:${tx.id}`)],
            [Markup.button.callback("← Quay lại ví", "WALLET")],
        ]);

        // Dọn tin cũ chạy nền — KHÔNG chờ, để text QR hiện ngay lập tức.
        clearPaymentMessages(ctx.chat.id).catch(() => {});
        deleteCurrentCallbackMessage(ctx).catch(() => {});

        // Send text immediately — no delay for user
        const depositMsg = await ctx.reply(msg, { parse_mode: "HTML", ...depositKeyboard });
        rememberPaymentMessage(ctx, paymentKey, depositMsg);

        // Ảnh QR gửi nền — Telegram tự fetch URL (ổn định hơn), fallback buffer.
        sendQrPhoto(ctx, paymentKey, qrUrl, amount);
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

        const lang = getLang(ctx);
        const missing = Math.max(0, orderData.finalAmount - balance);
        const text = checkoutMessage({ orderData, balance, missing, lang });
        const keyboard = buildCheckoutKeyboard({ canPayWallet: balance >= orderData.finalAmount, lang });

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

            scheduleOrderDelivery({ telegram: ctx.telegram, order, source: "wallet" });
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

    async function sendCryptoCheckout(ctx, { order, orderData, network }) {
        const checkout = createCryptoCheckout({
            orderId: order.id,
            amount: order.finalAmount,
            productName: orderData.productName,
            quantity: order.quantity,
            network,
        });

        await prisma.order.update({
            where: { id: order.id },
            data: {
                paymentRef: buildCryptoPaymentRef(checkout),
                cryptoNetwork: checkout.network,
                cryptoAmount: checkout.amountToken,
                cryptoAddress: checkout.address,
                cryptoToken: checkout.token,
                cryptoUsdVndRate: checkout.usdVndRate,
            },
        });

        const qrPayload = buildCryptoQrPayload(checkout);
        const orderKeyboard = Markup.inlineKeyboard([
            [Markup.button.url("📷 Mở QR USDT", buildExternalQrUrl(qrPayload))],
            [Markup.button.callback("✅ Tôi đã chuyển USDT, kiểm tra", `ORDER_CRYPTO_CHECK:${order.id}`)],
            [Markup.button.callback("❌ Hủy đơn", `CANCEL_ORDER:${order.id}`)],
        ]);
        const paymentKey = `order:${order.id}`;

        clearPaymentMessages(ctx.chat.id).catch(() => {});
        deleteCurrentCallbackMessage(ctx).catch(() => {});
        getState(ctx.chat.id).paymentMessages.set(paymentKey, new Set());

        const payMsg = await ctx.reply(formatCryptoPaymentMessage(checkout), {
            parse_mode: "HTML",
            disable_web_page_preview: true,
            ...orderKeyboard,
        });
        rememberPaymentMessage(ctx, paymentKey, payMsg);

        sendGeneratedQrPhoto(
            ctx,
            paymentKey,
            qrPayload,
            `QR ví ${checkout.networkLabel} - chuyển ${checkout.amountToken.toFixed(6)} USDT`,
        );
    }

    bot.action(/^PAY_CRYPTO:(trc20|bep20)$/i, async (ctx) => {
        const network = String(ctx.match[1]).toLowerCase();
        await answerCallback(ctx, "⏳ Đang tạo thanh toán USDT...");
        sendChatAction(ctx, "typing");

        const orderData = ctx.session.pendingOrder;
        if (!orderData) {
            return ctx.reply("Phiên thanh toán đã hết hạn. Vui lòng đặt lại.");
        }

        if (!getEnabledCryptoNetworks().includes(network)) {
            return ctx.reply(
                `Thanh toán USDT ${network.toUpperCase()} chưa được cấu hình. Vui lòng chọn phương thức khác hoặc liên hệ admin.`,
                { ...Markup.inlineKeyboard([[Markup.button.callback("🏦 Thanh toán QR", "PAY_QR"), Markup.button.callback("🏠 Menu", "BACK_HOME")]]) },
            );
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
                    paymentMethod: `crypto_${network}`,
                    couponId: orderData.couponId,
                    userId: user.id,
                },
            });

            if (orderData.couponId) await applyCoupon(orderData.couponId).catch(() => {});
            ctx.session.pendingOrder = null;

            await sendCryptoCheckout(ctx, { order, orderData, network });
            sendLog("ORDER", `⏳ Order Created (USDT ${network.toUpperCase()} Pending): User ${ctx.from.id} - ${orderData.productName} x${orderData.quantity}`);
        } catch (error) {
            console.error("PAY_CRYPTO error:", error);
            sendLog("ERROR", `❌ PAY_CRYPTO failed: User ${ctx.from?.id} - ${error.message}`);
            if (order?.id) {
                await prisma.order.update({
                    where: { id: order.id },
                    data: { status: "CANCELED" },
                }).catch(() => {});
                if (order.couponId) await releaseCoupon(order.couponId).catch(() => {});
            }
            await ctx.reply(
                `<b>Lỗi tạo thanh toán USDT</b>\n${DIVIDER}\nCó lỗi xảy ra, vui lòng thử lại hoặc liên hệ hỗ trợ.`,
                { parse_mode: "HTML" },
            ).catch(() => {});
        } finally {
            ctx.session.processingPayment = false;
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

            // Dọn tin cũ chạy nền — KHÔNG chờ, để tin thanh toán hiện ngay.
            clearPaymentMessages(ctx.chat.id).catch(() => {});
            deleteCurrentCallbackMessage(ctx).catch(() => {});
            getState(ctx.chat.id).paymentMessages.set(paymentKey, new Set());

            // Gửi tin thanh toán NGAY (kèm nút "Mở QR để quét") — user thao tác được liền,
            // không phải chờ tải ảnh QR.
            const payMsg = await ctx.reply(getPaymentMessage(checkout, lang), {
                parse_mode: "HTML",
                disable_web_page_preview: true,
                ...orderKeyboard,
            });
            rememberPaymentMessage(ctx, paymentKey, payMsg);

            // Ảnh QR gửi nền — Telegram tự fetch URL (ổn định hơn), fallback buffer.
            sendQrPhoto(ctx, paymentKey, checkout.qrUrl, checkout.amount);

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
        const lang = getLang(ctx);
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
                return sendMenu(ctx, ordersMessage([], { lang }), {
                    parse_mode: "HTML",
                    ...buildOrderListKeyboard([], { lang }),
                });
            }
            return sendMenu(ctx, ordersMessage(orders, { lang }), {
                parse_mode: "HTML",
                ...buildOrderListKeyboard(orders, { lang }),
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

        await sendMenu(ctx, orderDetailMessage(order, { lang }), {
            parse_mode: "HTML",
            ...buildOrderDetailKeyboard(order, { lang }),
        });
    });

    // Command: /help
    bot.command("help", async (ctx) => {
        const lang = getLang(ctx);
        const adminUsername = process.env.ADMIN_TELEGRAM || "admin";

        await sendMenu(ctx, supportMessage(adminUsername, { lang }), {
            parse_mode: "HTML",
            ...buildSupportKeyboard(adminUsername, { lang }),
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
            const icon = icons[action] ?? DEFAULT_ICONS[action] ?? "";
            textMap.set(`${icon} ${label}`.trim(), action);
        }
        const localizedReplyLabels = {
            LIST_PRODUCTS: ["Mua hàng", "Buy", "购买"],
            MY_ORDERS: ["Đơn hàng", "Orders", "订单"],
            WALLET: ["Ví", "Wallet", "钱包"],
            ACCOUNT: ["Tài khoản", "Account", "账户"],
            ALL_PRODUCTS: ["Sản phẩm", "Products", "商品"],
            HELP: ["Hỗ trợ", "Help", "帮助"],
            REFERRAL: ["Giới thiệu", "Referral", "推荐"],
            LANGUAGE: ["Ngôn ngữ", "Language", "语言"],
            HIDE_MENU: ["Ẩn menu", "Hide menu", "隐藏菜单"],
        };
        for (const [action, labels] of Object.entries(localizedReplyLabels)) {
            const icon = icons[action] ?? DEFAULT_ICONS[action] ?? "";
            for (const label of labels) {
                textMap.set(`${icon} ${label}`.trim(), action);
            }
        }
        // Legacy aliases for old keyboards already sent to users
        textMap.set("💳 Nạp tiền", "WALLET");
        textMap.set("💰 Nạp tiền", "WALLET");

        const action = textMap.get(text);
        if (!action) return next();

        switch (action) {
            case "WALLET": {
                const lang = getLang(ctx);
                const [balance, presets] = await Promise.all([getBalance(ctx.from.id), getDepositPresets()]);
                await cleanReply(ctx, walletMessage(balance, { lang }), { parse_mode: "HTML", ...buildWalletKeyboard(presets, { lang }) });
                break;
            }
            case "LIST_PRODUCTS": {
                const ui = await renderProductList(ctx);
                await cleanReply(ctx, ui.text, { parse_mode: "HTML", ...ui.keyboard });
                break;
            }
            case "MY_ORDERS": {
                const lang = getLang(ctx);
                const telegramId = String(ctx.from.id);
                const orders = await prisma.order.findMany({
                    where: { odelegramId: telegramId },
                    include: { product: true },
                    orderBy: { createdAt: "desc" },
                    take: 5,
                });
                await cleanReply(ctx, ordersMessage(orders, { lang }), { parse_mode: "HTML", ...buildOrderListKeyboard(orders, { lang }) });
                break;
            }
            case "ACCOUNT": {
                const lang = getLang(ctx);
                const telegramId = String(ctx.from.id);
                const [balance, orders] = await Promise.all([
                    getBalance(ctx.from.id),
                    prisma.order.findMany({ where: { odelegramId: telegramId } }),
                ]);
                const totalOrders = orders.length;
                const totalSpent = orders
                    .filter(o => o.status === "DELIVERED" || o.status === "PAID")
                    .reduce((sum, o) => sum + o.finalAmount, 0);
                await cleanReply(ctx, accountMessage({ ctx, balance, orderCount: totalOrders, totalSpent, lang }), {
                    parse_mode: "HTML",
                    ...buildAccountKeyboard({ lang }),
                });
                break;
            }
            case "HELP": {
                const lang = getLang(ctx);
                const adminUsername = process.env.ADMIN_TELEGRAM || "admin";
                await cleanReply(ctx, supportMessage(adminUsername, { lang }), { parse_mode: "HTML", ...buildSupportKeyboard(adminUsername, { lang }) });
                break;
            }
            case "LANGUAGE": {
                const lang = getLang(ctx);
                const languages = getLanguages();
                await cleanReply(ctx, t("selectLanguage", lang), {
                    parse_mode: "HTML",
                    ...Markup.inlineKeyboard([
                        ...languages.map((l) => [Markup.button.callback(l.name, `SET_LANG:${l.code}`)]),
                        [Markup.button.callback(t("back", lang), "BACK_HOME")],
                    ]),
                });
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

        if (String(ctx.session?.pendingAction || "").startsWith("DEPOSIT_CRYPTO_AMOUNT:")) {
            const network = String(ctx.session.pendingAction).split(":")[1];
            const amountUsdt = parseUsdtInput(ctx.message.text);
            const usdVndRate = getUsdVndRate();
            const amount = Math.round(amountUsdt * usdVndRate);
            const minUsdt = Number(process.env.CRYPTO_MIN_DEPOSIT_USDT || 1);

            if (!Number.isFinite(amountUsdt)) {
                ctx.session.pendingAction = null;
                return next();
            }
            if (amountUsdt < minUsdt) {
                return ctx.reply(`Số tiền không hợp lệ. Tối thiểu ${minUsdt} USDT. Vui lòng nhập lại:`);
            }
            const maxDeposit = await getMaxDeposit();
            if (maxDeposit > 0 && amount > maxDeposit) {
                const maxUsdt = maxDeposit / usdVndRate;
                return ctx.reply(`Số tiền vượt mức tối đa ${maxUsdt.toFixed(2)} USDT mỗi lần nạp. Vui lòng nhập lại:`);
            }
            if (!getEnabledCryptoNetworks().includes(network)) {
                ctx.session.pendingAction = null;
                return ctx.reply("Nạp USDT chưa được cấu hình. Vui lòng chọn phương thức khác.");
            }

            ctx.session.pendingAction = null;

            const tx = await createDeposit(ctx.from.id, amount);
            const checkout = createCryptoDepositCheckout({
                transactionId: tx.id,
                amount,
                amountUsd: amountUsdt,
                network,
            });

            await prisma.walletTransaction.update({
                where: { id: tx.id },
                data: {
                    paymentRef: buildCryptoDepositRef(checkout),
                    cryptoNetwork: checkout.network,
                    cryptoAmount: checkout.amountToken,
                    cryptoAddress: checkout.address,
                    cryptoToken: checkout.token,
                    cryptoUsdVndRate: checkout.usdVndRate,
                    description: `Nạp ${amountUsdt.toFixed(6)} USDT ${checkout.networkLabel} (~${amount.toLocaleString("vi-VN")}đ)`,
                },
            });

            const paymentKey = `deposit:${tx.id}`;
            const qrPayload = buildCryptoQrPayload(checkout);
            const depositKeyboard = Markup.inlineKeyboard([
                [Markup.button.url("📷 Mở QR USDT", buildExternalQrUrl(qrPayload))],
                [Markup.button.callback("✅ Tôi đã chuyển USDT, kiểm tra", `DEPOSIT_CRYPTO_CHECK:${tx.id}`)],
                [Markup.button.callback("← Quay lại ví", "WALLET")],
            ]);

            const state = getState(ctx.chat.id);
            const oldMenuId = state.lastMenuId;
            state.lastMenuId = null;
            clearPaymentMessages(ctx.chat.id).catch(() => {});
            if (oldMenuId) safeDelete(ctx, oldMenuId).catch(() => {});
            safeDelete(ctx, ctx.message.message_id).catch(() => {});

            const depositMsg = await ctx.reply(formatCryptoDepositMessage(checkout), {
                parse_mode: "HTML",
                disable_web_page_preview: true,
                ...depositKeyboard,
            });
            rememberPaymentMessage(ctx, paymentKey, depositMsg);

            sendGeneratedQrPhoto(
                ctx,
                paymentKey,
                qrPayload,
                `QR ví ${checkout.networkLabel} - chuyển ${checkout.amountToken.toFixed(6)} USDT`,
            );
            return;
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

            const bank = getBankConfigSync();
            const bankName = bank.bankName;
            const bankAccount = bank.accountNumber;
            const accountName = bank.accountName;
            const msg = buildDepositMsg({ amount, depositContent, bankName, bankAccount, accountName, expireMinutes });

            const depositKeyboard2 = Markup.inlineKeyboard([
                [Markup.button.url("📷 Mở QR để quét", qrUrl)],
                [Markup.button.callback("✅ Tôi đã chuyển, kiểm tra", `DEPOSIT_CHECK:${tx.id}`)],
                [Markup.button.callback("← Quay lại ví", "WALLET")],
            ]);

            // Dọn tin cũ chạy nền — không chặn hiện text QR.
            const state = getState(ctx.chat.id);
            const oldMenuId = state.lastMenuId;
            state.lastMenuId = null;
            clearPaymentMessages(ctx.chat.id).catch(() => {});
            if (oldMenuId) safeDelete(ctx, oldMenuId).catch(() => {});
            safeDelete(ctx, ctx.message.message_id).catch(() => {});

            const depositMsg = await ctx.reply(msg, { parse_mode: "HTML", ...depositKeyboard2 });
            rememberPaymentMessage(ctx, paymentKey, depositMsg);

            sendQrPhoto(ctx, paymentKey, qrUrl, amount);
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

    bot.action(/^DEPOSIT_CRYPTO_CHECK:(.+)$/i, async (ctx) => {
        await answerCallback(ctx, "🔍 Đang kiểm tra USDT...");
        const transactionId = ctx.match[1];

        try {
            const result = await Promise.race([
                confirmDepositByCryptoScan(transactionId, ctx.from.id),
                new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 30000)),
            ]);

            if (result.success && result.alreadyProcessed) {
                await clearPaymentMessages(ctx.chat.id, `deposit:${transactionId}`);
                return ctx.reply(
                    `✅ <b>Giao dịch đã được xử lý</b>\n${DIVIDER}\n💳 Số dư hiện tại: <b>${formatPrice(result.newBalance || 0)}</b>`,
                    { parse_mode: "HTML" },
                );
            }

            if (result.success) {
                sendLog("DEPOSIT", `Manual crypto deposit confirmed: User ${ctx.from.id} - ${formatPrice(result.matched?.amount || 0)} USDT - ${result.paymentRef}`);
                await clearPaymentMessages(ctx.chat.id, `deposit:${transactionId}`);
                return ctx.reply(
                    `✅ <b>Nạp ví USDT thành công!</b>\n${DIVIDER}\n💰 Số tiền: <b>+${formatPrice(result.depositAmount || 0)}</b>\n💳 Số dư mới: <b>${formatPrice(result.newBalance || 0)}</b>`,
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
                `⏳ <b>Chưa tìm thấy giao dịch USDT</b>\n${DIVIDER}\n${escapeHtml(result.error || "")}\n\nNếu vừa chuyển, hãy chờ blockchain xác nhận rồi bấm kiểm tra lại.`,
                { parse_mode: "HTML" },
            );
        } catch (error) {
            console.error("DEPOSIT_CRYPTO_CHECK error:", error);
            sendLog("ERROR", `DEPOSIT_CRYPTO_CHECK failed: User ${ctx.from?.id} - ${error.message}`);
            return ctx.reply(
                `❌ <b>Không kiểm tra được lúc này</b>\n${DIVIDER}\n${error.message === "timeout" ? "API blockchain phản hồi chậm. Vui lòng thử lại." : "Vui lòng thử lại sau ít phút."}`,
                { parse_mode: "HTML" },
            );
        }
    });

    // Manual bank check for VietQR orders
    bot.action(/^ORDER_BANK_CHECK:(.+)$/, async (ctx) => {
        await answerCallback(ctx, "🔍 Đang kiểm tra giao dịch...");
        const lang = getLang(ctx);
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
                if (order?.status === "PAID") {
                    scheduleOrderDelivery({ telegram: ctx.telegram, order, source: "bank-check-retry" });
                }
                if (deletedQr) {
                    return ctx.reply(orderDetailMessage(order, { lang }), {
                        parse_mode: "HTML",
                        ...buildOrderDetailKeyboard(order, { lang }),
                    });
                }
                return editMenu(ctx, orderDetailMessage(order, { lang }), buildOrderDetailKeyboard(order, { lang }));
            }

            scheduleOrderDelivery({ telegram: ctx.telegram, order: result.order, source: "bank-check" });
            await clearPaymentMessages(ctx.chat.id, `order:${orderId}`);
            const paidText = `<b>Đã nhận thanh toán</b>\n${DIVIDER}\n`
                + `Mã đơn: <code>${escapeHtml(orderId.slice(-8).toUpperCase())}</code>\n`
                + `Bot đang giao hàng. Nếu Telegram gửi file chậm, vui lòng chờ thêm ít phút.`;
            return ctx.reply(paidText, {
                parse_mode: "HTML",
                ...Markup.inlineKeyboard([
                    [Markup.button.callback("Xem đơn hàng", `ORDER:${orderId}`)],
                    [Markup.button.callback("🏠 Menu", "BACK_HOME")],
                ]),
            });
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

    bot.action(/^ORDER_CRYPTO_CHECK:(.+)$/, async (ctx) => {
        await answerCallback(ctx, "🔍 Đang kiểm tra USDT...");
        const lang = getLang(ctx);
        const orderId = ctx.match[1];

        try {
            const result = await Promise.race([
                confirmOrderByCryptoScan(orderId, ctx.from.id),
                new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 30000)),
            ]);

            if (!result.success) {
                return ctx.reply(
                    `⏳ <b>Chưa tìm thấy giao dịch USDT</b>\n${DIVIDER}\n${escapeHtml(result.error || "")}\n\nNếu vừa chuyển, hãy chờ blockchain xác nhận rồi bấm kiểm tra lại.`,
                    { parse_mode: "HTML" },
                );
            }

            const order = result.order || await prisma.order.findUnique({
                where: { id: orderId },
                include: { product: { include: { category: true } } },
            });
            if (!result.alreadyProcessed || order?.status === "PAID") {
                scheduleOrderDelivery({ telegram: ctx.telegram, order, source: "crypto-check" });
            }

            await clearPaymentMessages(ctx.chat.id, `order:${orderId}`);
            if (order?.status === "DELIVERED") {
                return ctx.reply(orderDetailMessage(order, { lang }), {
                    parse_mode: "HTML",
                    ...buildOrderDetailKeyboard(order, { lang }),
                });
            }
            return ctx.reply(
                `<b>Đã nhận thanh toán USDT</b>\n${DIVIDER}\n`
                + `Mã đơn: <code>${escapeHtml(orderId.slice(-8).toUpperCase())}</code>\n`
                + `Bot đang giao hàng. Nếu Telegram gửi file chậm, vui lòng chờ thêm ít phút.`,
                {
                    parse_mode: "HTML",
                    ...Markup.inlineKeyboard([
                        [Markup.button.callback("Xem đơn hàng", `ORDER:${orderId}`)],
                        [Markup.button.callback("🏠 Menu", "BACK_HOME")],
                    ]),
                },
            );
        } catch (error) {
            console.error("ORDER_CRYPTO_CHECK error:", error);
            sendLog("ERROR", `ORDER_CRYPTO_CHECK failed: User ${ctx.from?.id} - ${error.message}`);
            return ctx.reply(
                `❌ <b>Không kiểm tra được lúc này</b>\n${DIVIDER}\n${error.message === "timeout" ? "API blockchain phản hồi chậm. Vui lòng thử lại." : "Vui lòng thử lại sau ít phút."}`,
                { parse_mode: "HTML" },
            );
        }
    });

    bot.action(/^SHOW_CRYPTO_PAY:(.+)$/, async (ctx) => {
        await answerCallback(ctx, "⏳ Đang tải thanh toán USDT...");
        sendChatAction(ctx, "typing");
        const lang = getLang(ctx);
        const orderId = ctx.match[1];

        const order = await prisma.order.findUnique({
            where: { id: orderId },
            include: { product: true },
        });

        if (!order || order.odelegramId !== String(ctx.from.id)) {
            return ctx.reply("Không tìm thấy đơn hàng.");
        }
        if (order.status !== "PENDING") {
            return editMenu(ctx, orderDetailMessage(order, { lang }), buildOrderDetailKeyboard(order, { lang }));
        }
        if (!isCryptoPaymentMethod(order.paymentMethod)) {
            return ctx.reply("Đơn hàng này không phải thanh toán USDT.");
        }

        const expected = getOrderExpectedCrypto(order);
        await sendCryptoCheckout(ctx, {
            order,
            orderData: {
                productName: order.product?.name || "Sản phẩm",
            },
            network: expected.network,
        });
    });

    bot.action(/^DEPOSIT_CRYPTO:(trc20|bep20)$/i, async (ctx) => {
        await answerCallback(ctx);
        const network = String(ctx.match[1]).toLowerCase();

        if (!getEnabledCryptoNetworks().includes(network)) {
            return ctx.reply(
                `Nạp USDT ${network.toUpperCase()} chưa được cấu hình. Vui lòng chọn nạp ngân hàng hoặc liên hệ admin.`,
                { ...Markup.inlineKeyboard([[Markup.button.callback("← Quay lại ví", "WALLET")]]) },
            );
        }

        sendLog("DEPOSIT", `User ${ctx.from.id} selected CRYPTO DEPOSIT ${network.toUpperCase()}`);
        ctx.session.pendingAction = `DEPOSIT_CRYPTO_AMOUNT:${network}`;

        await editMenu(ctx, `<b>Nạp ví bằng USDT ${network.toUpperCase()}</b>
${DIVIDER}
Nhập số USDT muốn nạp vào ví.

Tối thiểu: <b>${Number(process.env.CRYPTO_MIN_DEPOSIT_USDT || 1)} USDT</b>
Ví dụ: <code>10</code> hoặc <code>10.5</code>

Bot sẽ quy đổi sang VND để cộng vào ví theo tỷ giá cấu hình.`, {
            parse_mode: "HTML",
            ...Markup.inlineKeyboard([
                [Markup.button.callback("Hủy", "WALLET")],
            ]),
        });
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
            return editMenu(ctx, orderDetailMessage(order, { lang }), buildOrderDetailKeyboard(order, { lang }));
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

        // Dọn tin cũ chạy nền — không chặn hiện tin thanh toán.
        clearPaymentMessages(ctx.chat.id, paymentKey).catch(() => {});
        deleteCurrentCallbackMessage(ctx).catch(() => {});
        getState(ctx.chat.id).paymentMessages.set(paymentKey, new Set());

        // Gửi tin thanh toán NGAY (kèm nút mở QR), ảnh QR tải nền.
        const payMsg = await ctx.reply(getPaymentMessage(checkout, lang), {
            parse_mode: "HTML",
            disable_web_page_preview: true,
            ...orderKeyboard,
        });
        rememberPaymentMessage(ctx, paymentKey, payMsg);

        sendQrPhoto(ctx, paymentKey, checkout.qrUrl, checkout.amount);
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
