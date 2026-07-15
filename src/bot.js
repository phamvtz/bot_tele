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
    buildBankDepositKeyboard,
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
import { formatRateHint, formatUsdPrimary, isUsdCurrency, toVndAmount } from "./money-display.js";

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
    // Node 20+ may keep a stale Telegram TLS socket alive after a network reset.
    // Fresh connections are more reliable for multipart uploads on Windows VPS.
    const tgKeepAlive = String(process.env.TELEGRAM_KEEP_ALIVE || "false").toLowerCase() === "true";
    const configuredFamily = Number(process.env.TELEGRAM_IP_FAMILY || 4);
    const tgFamily = configuredFamily === 6 ? 6 : 4;
    const tgAgent = new HttpsAgent({
        keepAlive: tgKeepAlive,
        maxSockets: Number(process.env.TELEGRAM_MAX_SOCKETS || 16),
        keepAliveMsecs: 15000,
        family: tgFamily,
    });
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

    // Helper to get user language
    const getLang = (ctx) => ctx.session?.language || "vi";

    const USER_UI = {
        vi: {
            genericError: "Có lỗi xảy ra, vui lòng thử lại hoặc liên hệ hỗ trợ.",
            depositTitle: "Nạp tiền vào ví",
            amount: "Số tiền",
            transferContent: "Nội dung CK",
            bank: "Ngân hàng",
            bankAccount: "STK",
            bankOwner: "Chủ TK",
            depositNote: (minutes) => `Chuyển đúng số tiền và đúng nội dung. Hết hạn sau <b>${minutes} phút</b>.`,
            openQr: "📷 Mở QR để quét",
            checkBank: "✅ Tôi đã chuyển, kiểm tra",
            backWallet: "← Quay lại ví",
            cancel: "Hủy",
            menu: "🏠 Menu",
            products: "📁 Danh mục",
            buy: "🛒 Mua hàng",
            viewWallet: "💳 Xem ví",
            viewOrder: "Xem đơn hàng",
            noProductsAlert: "Gói này hiện không khả dụng. Vui lòng chọn gói khác.",
            newPackages: "Gói mới",
            noNewPackages: "Hiện chưa có gói nào đang mở bán.",
            quickMenuReady: (name) => `Chào <b>${escapeHtml(name || "bạn")}</b>. Menu nhanh đã sẵn sàng ở bàn phím bên dưới.`,
            productUnavailable: "Sản phẩm không khả dụng.",
            notEnoughStock: (stock) => `Không đủ hàng. Hiện chỉ còn ${stock} sản phẩm.`,
            orderNotFound: "Không tìm thấy đơn hàng.",
            noOrderPermission: "Bạn không có quyền xem đơn hàng này.",
            noCancelPermission: "Bạn không có quyền hủy đơn hàng này.",
            noCancelPermissionShort: "Bạn không có quyền hủy đơn này.",
            cannotCancelDelivered: "Không thể hủy đơn hàng đã giao.",
            orderCanceledAlready: "Đơn hàng đã bị hủy trước đó.",
            orderCanceled: "Đơn hàng đã bị hủy.",
            cannotCancelChanged: "Không thể hủy đơn hàng (trạng thái đã thay đổi).",
            deliveredWhileCancel: "Đơn hàng đã được giao trong lúc bạn hủy. Không thể hoàn tiền.",
            cancelNowError: "Không thể hủy đơn hàng lúc này. Vui lòng liên hệ admin.",
            cancelConfirmTitle: "Xác nhận hủy đơn",
            orderCode: "Mã đơn",
            product: "Sản phẩm",
            refundToWallet: "Số tiền sẽ được hoàn lại vào ví của bạn.",
            cancelConfirmQuestion: "Bạn có chắc chắn muốn hủy đơn hàng này?",
            confirmCancel: "Xác nhận hủy",
            backOrder: "← Quay lại đơn",
            refundFailed: (error) => `Hoàn tiền thất bại: ${escapeHtml(error || "lỗi không xác định")}.\nVui lòng liên hệ admin.`,
            canceledTitle: "Đã hủy đơn hàng",
            refunded: "Đã hoàn",
            newBalance: "Số dư mới",
            orderList: "📦 Đơn hàng",
            customDepositTitle: "Nạp tiền tùy chỉnh",
            enterDepositAmount: "Nhập số tiền muốn nạp.",
            minDeposit: "Tối thiểu: <b>10.000đ</b>",
            depositExample: "Ví dụ: <code>50000</code>",
            txHistoryTitle: "Lịch sử giao dịch",
            noTransactions: "Chưa có giao dịch nào.",
            success: "Thành công",
            pending: "Đang chờ",
            failed: "Thất bại",
            balance: "Số dư",
            invalidDepositAmount: "Số tiền không hợp lệ. Tối thiểu 10.000đ. Vui lòng nhập lại:",
            maxDepositAmount: (max) => `Số tiền vượt mức tối đa ${max.toLocaleString("vi-VN")}đ mỗi lần nạp. Vui lòng nhập lại:`,
            checking: "🔍 Đang kiểm tra...",
            checkingBank: "🔍 Đang kiểm tra giao dịch...",
            creatingPayment: "⏳ Đang tạo mã thanh toán...",
            sessionExpired: "Phiên thanh toán đã hết hạn. Vui lòng đặt lại.",
            processingOrder: "⏳ Đơn hàng đang được xử lý, vui lòng chờ.",
            paymentCreateErrorTitle: "Lỗi tạo thanh toán",
            cancelOrder: "❌ Hủy đơn",
            paidCheckAgain: "✅ Tôi đã chuyển, kiểm tra",
            alreadyProcessed: "Giao dịch đã được xử lý",
            currentBalance: "Số dư hiện tại",
            depositSuccessTitle: "Nạp tiền thành công!",
            depositSuccessAmount: "Số tiền",
            txNotFoundTitle: "Chưa tìm thấy giao dịch",
            bankWait: "Nếu vừa chuyển khoản, hãy chờ 15-30 giây rồi bấm kiểm tra lại.",
            bankOrderWait: "Nếu vừa chuyển khoản, hãy chờ 30-60 giây rồi bấm kiểm tra lại.",
            cannotCheckTitle: "Không kiểm tra được lúc này",
            tryLater: "Vui lòng thử lại sau ít phút.",
            bankSlow: "Máy chủ ngân hàng phản hồi chậm. Vui lòng thử lại.",
            paymentReceivedTitle: "Đã nhận thanh toán",
            deliveringWait: "Bot đang giao hàng. Nếu Telegram gửi file chậm, vui lòng chờ thêm ít phút.",
            cannotCancelThisOrder: "Không thể hủy đơn này.",
            insufficientBalance: "Số dư không đủ. Vui lòng nạp thêm.",
            depositWallet: "💳 Nạp ví",
            checkoutCanceled: "Đã hủy thao tác thanh toán.",
            processingPayment: "⏳ Đang xử lý thanh toán...",
            loadingQr: "⏳ Đang tải QR...",
            bankDepositTitle: "Nạp ví bằng QR ngân hàng",
            chooseBankDepositAmount: "Chọn số tiền VNĐ muốn chuyển. Bot sẽ hiển thị USD tương đương để bạn dễ hình dung.",
            exactBankAmount: "Cần chuyển ngân hàng",
            usdEquivalent: "Quy đổi",
            walletUsdOnly: "Sản phẩm giá USD cần nạp ví trước rồi thanh toán bằng số dư.",
            productUnavailableLong: "Sản phẩm không tồn tại hoặc đã ngừng bán.",
            quantityPrompt: (range) => `🔖 Vui lòng nhập số lượng muốn mua${range}:`,
            chooseProductToChangeQuantity: "Bấm vào sản phẩm để chọn lại số lượng.",
            preparingOrder: "Đang chuẩn bị đơn hàng...",
            price: "Giá",
            each: "cái",
            stockLeft: (count) => `kho còn ${count}`,
            enterQuantityTitle: "Nhập số lượng",
            enterQuantity: "Nhập số lượng muốn mua",
            quantityExample: "Gửi số lượng bạn muốn mua, ví dụ: <code>15</code>",
            invalidQuantity: "Số lượng không hợp lệ.\n\nVui lòng nhập số nguyên dương, ví dụ: 5, 10, 15.",
            quantityTooLarge: "Số lượng quá lớn.\n\nVui lòng nhập số nhỏ hơn 1000.",
            backProduct: "← Quay lại gói",
            stockShortageDetail: (stock, wanted) => `Không đủ hàng.\n\nCòn: ${stock}\nBạn muốn: ${wanted}`,
            menuHidden: "Đã ẩn menu. Gõ /start hoặc /menu để mở lại.",
        },
        en: {
            genericError: "Something went wrong. Please try again or contact support.",
            depositTitle: "Top up wallet",
            amount: "Amount",
            transferContent: "Transfer note",
            bank: "Bank",
            bankAccount: "Account no.",
            bankOwner: "Account name",
            depositNote: (minutes) => `Send the exact amount and note. Expires in <b>${minutes} minutes</b>.`,
            openQr: "📷 Open QR to scan",
            checkBank: "✅ I have paid, check",
            backWallet: "← Back to wallet",
            cancel: "Cancel",
            menu: "🏠 Menu",
            products: "📁 Categories",
            buy: "🛒 Buy",
            viewWallet: "💳 View wallet",
            viewOrder: "View order",
            noProductsAlert: "This package is not available. Please choose another one.",
            newPackages: "New packages",
            noNewPackages: "No packages are on sale right now.",
            quickMenuReady: (name) => `Hi <b>${escapeHtml(name || "there")}</b>. Your quick menu is ready below.`,
            productUnavailable: "Product is not available.",
            notEnoughStock: (stock) => `Not enough stock. Only ${stock} item(s) left.`,
            orderNotFound: "Order not found.",
            noOrderPermission: "You do not have permission to view this order.",
            noCancelPermission: "You do not have permission to cancel this order.",
            noCancelPermissionShort: "You do not have permission to cancel this order.",
            cannotCancelDelivered: "Delivered orders cannot be canceled.",
            orderCanceledAlready: "This order was already canceled.",
            orderCanceled: "Order has been canceled.",
            cannotCancelChanged: "Cannot cancel this order because its status changed.",
            deliveredWhileCancel: "The order was delivered while you were canceling. Refund is not possible.",
            cancelNowError: "Cannot cancel this order right now. Please contact support.",
            cancelConfirmTitle: "Confirm cancellation",
            orderCode: "Order code",
            product: "Product",
            refundToWallet: "The amount will be refunded to your wallet.",
            cancelConfirmQuestion: "Are you sure you want to cancel this order?",
            confirmCancel: "Confirm cancellation",
            backOrder: "← Back to order",
            refundFailed: (error) => `Refund failed: ${escapeHtml(error || "unknown error")}.\nPlease contact support.`,
            canceledTitle: "Order canceled",
            refunded: "Refunded",
            newBalance: "New balance",
            orderList: "📦 Orders",
            customDepositTitle: "Custom top-up",
            enterDepositAmount: "Enter the amount you want to top up.",
            minDeposit: "Minimum: <b>10,000 VND</b>",
            depositExample: "Example: <code>50000</code>",
            txHistoryTitle: "Transaction history",
            noTransactions: "No transactions yet.",
            success: "Success",
            pending: "Pending",
            failed: "Failed",
            balance: "Balance",
            invalidDepositAmount: "Invalid amount. Minimum is 10,000 VND. Please enter again:",
            maxDepositAmount: (max) => `Amount exceeds the maximum ${max.toLocaleString("vi-VN")} VND per top-up. Please enter again:`,
            checking: "🔍 Checking...",
            checkingBank: "🔍 Checking transaction...",
            creatingPayment: "⏳ Creating payment QR...",
            sessionExpired: "Payment session expired. Please place the order again.",
            processingOrder: "⏳ Your order is being processed. Please wait.",
            paymentCreateErrorTitle: "Payment creation error",
            cancelOrder: "❌ Cancel order",
            paidCheckAgain: "✅ I have paid, check",
            alreadyProcessed: "Transaction already processed",
            currentBalance: "Current balance",
            depositSuccessTitle: "Top-up successful!",
            depositSuccessAmount: "Amount",
            txNotFoundTitle: "Transaction not found yet",
            bankWait: "If you just paid, wait 15-30 seconds and check again.",
            bankOrderWait: "If you just paid, wait 30-60 seconds and check again.",
            cannotCheckTitle: "Cannot check right now",
            tryLater: "Please try again in a few minutes.",
            bankSlow: "The bank server is responding slowly. Please try again.",
            paymentReceivedTitle: "Payment received",
            deliveringWait: "The bot is delivering your order. If Telegram sends files slowly, please wait a few minutes.",
            cannotCancelThisOrder: "This order cannot be canceled.",
            insufficientBalance: "Insufficient balance. Please top up your wallet.",
            depositWallet: "💳 Top up wallet",
            checkoutCanceled: "Payment step canceled.",
            processingPayment: "⏳ Processing payment...",
            loadingQr: "⏳ Loading QR...",
            bankDepositTitle: "Top up wallet by bank QR",
            chooseBankDepositAmount: "Choose the VND amount to transfer. The bot will show the USD equivalent for clarity.",
            exactBankAmount: "Bank transfer amount",
            usdEquivalent: "Equivalent",
            walletUsdOnly: "USD-priced products must be paid from wallet balance. Please top up first.",
            productUnavailableLong: "Product does not exist or is no longer on sale.",
            quantityPrompt: (range) => `🔖 Enter the quantity you want to buy${range}:`,
            chooseProductToChangeQuantity: "Tap the product to choose quantity again.",
            preparingOrder: "Preparing your order...",
            price: "Price",
            each: "item",
            stockLeft: (count) => `${count} left in stock`,
            enterQuantityTitle: "Enter quantity",
            enterQuantity: "Enter the quantity you want to buy",
            quantityExample: "Send the quantity you want, for example: <code>15</code>",
            invalidQuantity: "Invalid quantity.\n\nPlease enter a positive whole number, for example: 5, 10, 15.",
            quantityTooLarge: "Quantity is too large.\n\nPlease enter a number below 1000.",
            backProduct: "← Back to product",
            stockShortageDetail: (stock, wanted) => `Not enough stock.\n\nLeft: ${stock}\nYou want: ${wanted}`,
            menuHidden: "Menu hidden. Type /start or /menu to open it again.",
        },
        zh: {
            genericError: "发生错误，请重试或联系客服。",
            depositTitle: "充值钱包",
            amount: "金额",
            transferContent: "转账备注",
            bank: "银行",
            bankAccount: "账号",
            bankOwner: "户名",
            depositNote: (minutes) => `请转入准确金额并填写正确备注。<b>${minutes} 分钟</b>后过期。`,
            openQr: "📷 打开二维码扫码",
            checkBank: "✅ 我已付款，检查",
            backWallet: "← 返回钱包",
            cancel: "取消",
            menu: "🏠 菜单",
            products: "📁 分类",
            buy: "🛒 购买",
            viewWallet: "💳 查看钱包",
            viewOrder: "查看订单",
            noProductsAlert: "该套餐暂不可用，请选择其他套餐。",
            newPackages: "新套餐",
            noNewPackages: "当前没有在售套餐。",
            quickMenuReady: (name) => `您好 <b>${escapeHtml(name || "朋友")}</b>，快捷菜单已准备好。`,
            productUnavailable: "商品不可用。",
            notEnoughStock: (stock) => `库存不足。目前仅剩 ${stock} 件。`,
            orderNotFound: "未找到订单。",
            noOrderPermission: "您无权查看此订单。",
            noCancelPermission: "您无权取消此订单。",
            noCancelPermissionShort: "您无权取消此订单。",
            cannotCancelDelivered: "已发货订单无法取消。",
            orderCanceledAlready: "该订单此前已取消。",
            orderCanceled: "订单已取消。",
            cannotCancelChanged: "订单状态已变化，无法取消。",
            deliveredWhileCancel: "订单在取消时已发货，无法退款。",
            cancelNowError: "当前无法取消订单，请联系客服。",
            cancelConfirmTitle: "确认取消订单",
            orderCode: "订单号",
            product: "商品",
            refundToWallet: "金额将退回您的钱包。",
            cancelConfirmQuestion: "您确定要取消此订单吗？",
            confirmCancel: "确认取消",
            backOrder: "← 返回订单",
            refundFailed: (error) => `退款失败：${escapeHtml(error || "未知错误")}。\n请联系客服。`,
            canceledTitle: "订单已取消",
            refunded: "已退款",
            newBalance: "新余额",
            orderList: "📦 订单",
            customDepositTitle: "自定义充值",
            enterDepositAmount: "请输入要充值的金额。",
            minDeposit: "最低：<b>10,000 VND</b>",
            depositExample: "例如：<code>50000</code>",
            txHistoryTitle: "交易记录",
            noTransactions: "暂无交易。",
            success: "成功",
            pending: "处理中",
            failed: "失败",
            balance: "余额",
            invalidDepositAmount: "金额无效。最低 10,000 VND，请重新输入：",
            maxDepositAmount: (max) => `金额超过单次最高 ${max.toLocaleString("vi-VN")} VND，请重新输入：`,
            checking: "🔍 正在检查...",
            checkingBank: "🔍 正在检查交易...",
            creatingPayment: "⏳ 正在创建支付二维码...",
            sessionExpired: "支付会话已过期，请重新下单。",
            processingOrder: "⏳ 订单正在处理，请稍候。",
            paymentCreateErrorTitle: "创建支付失败",
            cancelOrder: "❌ 取消订单",
            paidCheckAgain: "✅ 我已付款，检查",
            alreadyProcessed: "交易已处理",
            currentBalance: "当前余额",
            depositSuccessTitle: "充值成功！",
            depositSuccessAmount: "金额",
            txNotFoundTitle: "暂未找到交易",
            bankWait: "如果刚刚付款，请等待 15-30 秒后再次检查。",
            bankOrderWait: "如果刚刚付款，请等待 30-60 秒后再次检查。",
            cannotCheckTitle: "暂时无法检查",
            tryLater: "请稍后再试。",
            bankSlow: "银行服务器响应较慢，请重试。",
            paymentReceivedTitle: "已收到付款",
            deliveringWait: "机器人正在发货。如果 Telegram 发送文件较慢，请稍等几分钟。",
            cannotCancelThisOrder: "此订单无法取消。",
            insufficientBalance: "余额不足，请先充值钱包。",
            depositWallet: "💳 充值钱包",
            checkoutCanceled: "已取消支付步骤。",
            processingPayment: "⏳ 正在处理付款...",
            loadingQr: "⏳ 正在加载二维码...",
            bankDepositTitle: "银行二维码充值钱包",
            chooseBankDepositAmount: "请选择要转账的 VND 金额，机器人会显示对应 USD/CNY 方便确认。",
            exactBankAmount: "银行转账金额",
            usdEquivalent: "折算",
            walletUsdOnly: "USD 商品需先充值钱包，再用余额购买。",
            productUnavailableLong: "商品不存在或已下架。",
            quantityPrompt: (range) => `🔖 请输入要购买的数量${range}:`,
            chooseProductToChangeQuantity: "请点击商品重新选择数量。",
            preparingOrder: "正在准备订单...",
            price: "价格",
            each: "件",
            stockLeft: (count) => `库存剩余 ${count}`,
            enterQuantityTitle: "输入数量",
            enterQuantity: "请输入要购买的数量",
            quantityExample: "发送要购买的数量，例如：<code>15</code>",
            invalidQuantity: "数量无效。\n\n请输入正整数，例如：5、10、15。",
            quantityTooLarge: "数量过大。\n\n请输入小于 1000 的数字。",
            backProduct: "← 返回商品",
            stockShortageDetail: (stock, wanted) => `库存不足。\n\n剩余：${stock}\n您想购买：${wanted}`,
            menuHidden: "菜单已隐藏。输入 /start 或 /menu 可重新打开。",
        },
    };
    const userUi = (lang = "vi") => USER_UI[["vi", "en", "zh"].includes(lang) ? lang : "vi"];

    // Error handling
    bot.catch((err, ctx) => {
        console.error(`Bot error for ${ctx.updateType}:`, err);
        sendLog("ERROR", `⚠️ Bot caught error: ${err.message}\nUser: ${ctx.from?.id || "unknown"}`);
        ctx.reply(userUi(getLang(ctx)).genericError).catch(() => { });
    });



    const buildDepositMsg = ({ amount, depositContent, bankName, bankAccount, accountName, expireMinutes, lang = "vi" }) => {
        const ui = userUi(lang);
        return `🏦 <b>${ui.depositTitle}</b>\n${DIVIDER}\n`
            + `💵 ${ui.usdEquivalent}: <b>${formatUsdPrimary(amount, "VND", { lang })}</b>\n`
            + `💰 ${ui.exactBankAmount}: <b>${formatPrice(amount)}</b>\n`
            + `📝 ${ui.transferContent}: <code>${escapeHtml(depositContent)}</code>\n\n`
            + `🏢 ${ui.bank}: <b>${escapeHtml(bankName)}</b>\n`
            + `💳 ${ui.bankAccount}: <code>${escapeHtml(bankAccount)}</code>\n`
            + `👤 ${ui.bankOwner}: <b>${escapeHtml(accountName)}</b>\n\n`
            + `⚠️ ${ui.depositNote(expireMinutes)}`;
    };

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
        const qrUrl = buildExternalQrUrl(qrText);
        try {
            const qrMsg = await withTimeout(ctx.replyWithPhoto(qrUrl, { caption }), 12000);
            if (isPaymentMessageActive(ctx.chat.id, paymentKey)) rememberPaymentMessage(ctx, paymentKey, qrMsg);
            return qrMsg;
        } catch (urlError) {
            console.log("[sendGeneratedQrPhoto] Gửi QR bằng URL lỗi, thử upload buffer:", urlError.message);
        }
        if (!isPaymentMessageActive(ctx.chat.id, paymentKey)) return null;
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

    const cryptoUi = (lang = "vi") => ({
        vi: {
            openQr: "📷 Mở QR USDT",
            check: "✅ Tôi đã chuyển USDT, kiểm tra",
            cancel: "❌ Hủy đơn",
            backWallet: "← Quay lại ví",
            qrCaption: (network, amount) => `QR ví ${network} - chuyển đúng ${amount} USDT`,
            creating: "⏳ Đang tạo thanh toán USDT...",
            checking: "🔍 Đang kiểm tra USDT...",
            notConfigured: (network) => `Nạp USDT ${network.toUpperCase()} chưa được cấu hình. Vui lòng chọn nạp ngân hàng hoặc liên hệ admin.`,
            depositTitle: (network) => `Nạp ví bằng USDT ${network.toUpperCase()}`,
            enterAmount: "Nhập số USDT muốn nạp vào ví.",
            minAmount: (min) => `Tối thiểu: <b>${min} USDT</b>`,
            example: "Ví dụ: <code>10</code> hoặc <code>10.5</code>",
            note: "Bot sẽ quy đổi sang VND để cộng vào ví theo tỷ giá USDT/VND thị trường hiện tại.",
            invalidAmount: (min) => `Số tiền không hợp lệ. Tối thiểu ${min} USDT. Vui lòng nhập lại:`,
            maxAmount: (max) => `Số tiền vượt mức tối đa ${max.toFixed(2)} USDT mỗi lần nạp. Vui lòng nhập lại:`,
        },
        en: {
            openQr: "📷 Open USDT QR",
            check: "✅ I sent USDT, check",
            cancel: "❌ Cancel order",
            backWallet: "← Back to wallet",
            qrCaption: (network, amount) => `${network} wallet QR - send exactly ${amount} USDT`,
            creating: "⏳ Creating USDT payment...",
            checking: "🔍 Checking USDT...",
            notConfigured: (network) => `USDT ${network.toUpperCase()} top-up is not configured. Please use bank top-up or contact support.`,
            depositTitle: (network) => `Top up wallet with USDT ${network.toUpperCase()}`,
            enterAmount: "Enter the USDT amount you want to top up.",
            minAmount: (min) => `Minimum: <b>${min} USDT</b>`,
            example: "Example: <code>10</code> or <code>10.5</code>",
            note: "The bot converts it to VND wallet balance using the current USDT/VND market rate.",
            invalidAmount: (min) => `Invalid amount. Minimum is ${min} USDT. Please enter again:`,
            maxAmount: (max) => `Amount exceeds the maximum ${max.toFixed(2)} USDT per top-up. Please enter again:`,
        },
        zh: {
            openQr: "📷 打开 USDT 二维码",
            check: "✅ 我已转 USDT，检查",
            cancel: "❌ 取消订单",
            backWallet: "← 返回钱包",
            qrCaption: (network, amount) => `${network} 钱包二维码 - 请转入 ${amount} USDT`,
            creating: "⏳ 正在创建 USDT 支付...",
            checking: "🔍 正在检查 USDT...",
            notConfigured: (network) => `USDT ${network.toUpperCase()} 充值尚未配置。请使用银行充值或联系管理员。`,
            depositTitle: (network) => `使用 USDT ${network.toUpperCase()} 充值钱包`,
            enterAmount: "请输入要充值的 USDT 数量。",
            minAmount: (min) => `最低：<b>${min} USDT</b>`,
            example: "例如：<code>10</code> 或 <code>10.5</code>",
            note: "机器人会按当前 USDT/VND 市场汇率换算为 VND 钱包余额。",
            invalidAmount: (min) => `金额无效。最低 ${min} USDT，请重新输入：`,
            maxAmount: (max) => `金额超过单次最高 ${max.toFixed(2)} USDT，请重新输入：`,
        },
    }[["vi", "en", "zh"].includes(lang) ? lang : "vi"]);

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
    const ONBOARDING_FLOW_VERSION = 2;

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
        ctx.session.onboardingFlowVersion = ONBOARDING_FLOW_VERSION;
        ctx.session.groupVerifiedAt = Date.now();
        const startParam = ctx.session.pendingStartParam;
        ctx.session.pendingStartParam = null;
        await showMainMenu(ctx);
        const replyKbd = await getUserKeyboard(ctx.from.id, null, getLang(ctx));
        const greetingTpl = getWelcomeGreetingSync() ?? DEFAULT_WELCOME_GREETING;
        const greetingText = greetingTpl.replace(/\{name\}/g, escapeHtml(ctx.from.first_name || "bạn"));
        await ctx.reply(greetingText, { parse_mode: "HTML", ...replyKbd });

        if (startParam?.startsWith("product_")) {
            const productId = startParam.replace("product_", "");
            const product = await prisma.product.findUnique({ where: { id: productId } }).catch(() => null);
            if (product?.isActive) {
                const [stockCount, soldCount, iconSetting2] = await Promise.all([
                    product.deliveryMode === "STOCK_LINES" ? getStockCount(product.id) : Promise.resolve(null),
                    getCachedSoldCount(product.id),
                    getCachedIconOverrides(),
                ]);
                const icons2 = iconSetting2?.value ? JSON.parse(iconSetting2.value) : {};
                const icon = icons2[product.id] || product.icon || "📦";
                const productDisplay = icon?.startsWith?.("tg:")
                    ? { ...product, iconEmojiId: icon.slice(3) }
                    : { ...product, icon };
                const lang = getLang(ctx);
                const inStock = product.deliveryMode !== "STOCK_LINES" || stockCount > 0;
                return ctx.reply(
                    productDetailMessage({ product: productDisplay, stockCount, soldCount, lang }),
                    {
                        parse_mode: "HTML",
                        ...buildProductDetailKeyboard({
                            productId: product.id,
                            inStock,
                            categoryId: product.categoryId,
                            stockCount,
                            deliveryMode: product.deliveryMode,
                            lang,
                        }),
                    },
                );
            }
        }
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
        const usdVndRate = getUsdVndRate();
        const unitPriceVnd = toVndAmount(product.price, product.currency, { rate: usdVndRate });
        ctx.session.pendingOrder = {
            productId: product.id,
            productName: product.name,
            quantity,
            unitPrice: unitPriceVnd,
            amount: unitPriceVnd * quantity,
            currency: "VND",
            displayCurrency: product.currency,
            displayUnitPrice: Number(product.price),
            usdVndRate,
            requiresWalletTopup: isUsdCurrency(product.currency),
            discount: 0,
            finalAmount: unitPriceVnd * quantity,
        };
        return ctx.session.pendingOrder;
    };

    const validateStockForQuantity = async (product, quantity, lang = "vi") => {
        const ui = userUi(lang);
        if (!product || !product.isActive) {
            return { ok: false, message: ui.productUnavailable };
        }
        if (product.deliveryMode !== "STOCK_LINES") {
            return { ok: true };
        }
        const stockCount = await getStockCount(product.id);
        if (stockCount < quantity) {
            return { ok: false, message: ui.notEnoughStock(stockCount) };
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
        await ctx.answerCbQuery(userUi(getLang(ctx)).noProductsAlert, { show_alert: true });
    });

    bot.action("SEARCH_PRODUCTS", async (ctx) => {
        await answerCallback(ctx);
        const lang = getLang(ctx);
        await editMenu(ctx, searchPromptMessage(), {
            ...Markup.inlineKeyboard([
                [Markup.button.callback(userUi(lang).products, "LIST_PRODUCTS")],
                [Markup.button.callback(userUi(lang).menu, "BACK_HOME")],
            ]),
        });
    });

    bot.action("HOT_PRODUCTS", async (ctx) => {
        await answerCallback(ctx);
        const lang = getLang(ctx);
        const uiText = userUi(lang);
        const products = await prisma.product.findMany({
            where: { isActive: true, price: { gt: 0 } },
            orderBy: { createdAt: "desc" },
            take: 6,
        });

        if (!products.length) {
            return editMenu(ctx, `<b>${uiText.newPackages}</b>\n${DIVIDER}\n${uiText.noNewPackages}`, {
                ...Markup.inlineKeyboard([
                    [Markup.button.callback(uiText.products, "LIST_PRODUCTS")],
                    [Markup.button.callback(uiText.menu, "BACK_HOME")],
                ]),
            });
        }

        const lines = products.map((product, index) => `<b>${index + 1}.</b> ${escapeHtml(product.name)}\n${formatUsdPrimary(product.price, product.currency, { lang })}`);
        await editMenu(ctx, `<b>${uiText.newPackages}</b>\n${DIVIDER}\n${lines.join("\n\n")}`, {
            ...Markup.inlineKeyboard([
                ...products.map((product) => [Markup.button.callback(`${truncateText(product.name, 34)}`, `product:${product.id}`)]),
                [Markup.button.callback(uiText.products, "LIST_PRODUCTS")],
                [Markup.button.callback(uiText.menu, "BACK_HOME")],
            ]),
        });
    });

    bot.action("ALL_PRODUCTS", async (ctx) => {
        await answerCallback(ctx);
        const ui = await renderAllProducts(1, { lang: getLang(ctx) });
        await editMenu(ctx, ui.text, { parse_mode: "HTML", ...ui.keyboard });
    });

    bot.action(/^all_products:(\d+)$/i, async (ctx) => {
        await answerCallback(ctx);
        const ui = await renderAllProducts(Number(ctx.match[1]), { lang: getLang(ctx) });
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
        if (existingUser?.language && !ctx.session.language) {
            ctx.session.language = existingUser.language;
        }
        ctx.session.pendingStartParam = startParam || null;
        if (ctx.session.onboardingFlowVersion !== ONBOARDING_FLOW_VERSION) {
            ctx.session.langChosen = false;
            ctx.session.onboarded = false;
            ctx.session.groupVerifiedAt = 0;
        }

        // ── Cổng onboarding ─────────────────────────────────────────────
        // 1) Mở đầu onboarding: chọn ngôn ngữ (VI/EN/ZH).
        // 2) Sau khi chọn ngôn ngữ: yêu cầu tham gia nhóm bằng ngôn ngữ đó.
        // 3) Xác minh xong mới vào menu.
        if (!ctx.session.onboarded && !ctx.session.langChosen) {
            await safeDelete(ctx, ctx.message.message_id);
            return showLanguageGate(ctx);
        }
        if (!(await isGroupMember(ctx.from.id))) {
            await safeDelete(ctx, ctx.message.message_id);
            return showJoinGate(ctx);
        }
        ctx.session.onboarded = true;
        ctx.session.onboardingFlowVersion = ONBOARDING_FLOW_VERSION;
        ctx.session.groupVerifiedAt = Date.now();

        // Deep link: /start product_PRODUCTID → mở thẳng sản phẩm
        if (startParam?.startsWith("product_")) {
            const productId = startParam.replace("product_", "");
            const product = await prisma.product.findUnique({ where: { id: productId } }).catch(() => null);
            if (product?.isActive) {
                const lang = getLang(ctx);
                const replyKbd = await getUserKeyboard(ctx.from.id, null, lang);
                await ctx.reply(userUi(lang).quickMenuReady(ctx.from.first_name), { parse_mode: "HTML", ...replyKbd });
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
                const text = productDetailMessage({ product: productDisplay2, stockCount, soldCount: soldCount + (product.soldFake || 0), lang });
                const keyboard = buildProductDetailKeyboard({ productId: product.id, inStock, categoryId: product.categoryId, stockCount, deliveryMode: product.deliveryMode, lang });
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
        const ui = await renderCategoryList(1, { lang: getLang(ctx) });
        await sendMenu(ctx, ui.text, { parse_mode: "HTML", ...ui.keyboard });
    });

    bot.command("product", async (ctx) => {
        const ui = await renderAllProducts(1, { lang: getLang(ctx) });
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
        const lang = getLang(ctx);
        const copies = {
            vi: { ok: "🔕 Đã ẩn thông báo đơn mới trong 24 giờ.", fail: "Không thể tắt thông báo lúc này, vui lòng thử lại." },
            en: { ok: "🔕 New-order notifications are muted for 24 hours.", fail: "Could not mute notifications. Please try again." },
            zh: { ok: "🔕 新订单通知已静音24小时。", fail: "暂时无法静音通知，请重试。" },
        };
        const copy = copies[lang] || copies.vi;
        const until = Date.now() + 24 * 60 * 60 * 1000;
        try {
            await prisma.user.update({
                where: { telegramId: String(ctx.from.id) },
                data: { notifyMutedUntil: until },
            });
            await ctx.answerCbQuery(copy.ok, { show_alert: true }).catch(() => {});
            await deleteCurrentCallbackMessage(ctx).catch(() => {});
        } catch {
            await ctx.answerCbQuery(copy.fail, { show_alert: true }).catch(() => {});
        }
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
            return ctx.reply(userUi(lang).orderNotFound);
        }

        if (order.odelegramId !== String(ctx.from.id) && !isAdmin(ctx.from.id)) {
            return ctx.reply(userUi(lang).noOrderPermission);
        }

        await editMenu(ctx, orderDetailMessage(order, { lang }), buildOrderDetailKeyboard(order, { lang }));
    });

    // Cancel order - Confirmation
    bot.action(/^CANCEL_ORDER:(.+)$/, async (ctx) => {
        await answerCallback(ctx);
        const lang = getLang(ctx);
        const uiText = userUi(lang);
        const orderId = ctx.match[1];

        const order = await prisma.order.findUnique({
            where: { id: orderId },
            include: { product: true }
        });

        if (!order) {
            return ctx.reply(uiText.orderNotFound);
        }

        // Verify ownership
        if (order.odelegramId !== String(ctx.from.id)) {
            return ctx.reply(uiText.noCancelPermission);
        }

        // Check if can cancel
        if (order.status === "DELIVERED") {
            return ctx.reply(uiText.cannotCancelDelivered);
        }

        if (order.status === "CANCELED") {
            return ctx.reply(uiText.orderCanceledAlready);
        }

        // Clear QR payment messages before showing cancel confirmation so the photo
        // doesn't get deleted by safeEditOrReply's fallback when the callback is on a photo msg.
        await clearPaymentMessages(ctx.chat.id, `order:${orderId}`);

        const confirmText = `<b>${uiText.cancelConfirmTitle}</b>
${DIVIDER}
${uiText.orderCode}: <code>${escapeHtml(order.id.slice(-8).toUpperCase())}</code>
${uiText.product}: <b>${escapeHtml(order.product.name)}</b>
${uiText.amount}: <b>${formatUsdPrimary(order.finalAmount, order.currency || "VND", { lang, rate: order.cryptoUsdVndRate })}</b>

${order.status === "PAID" && String(order.paymentMethod).toLowerCase() === "wallet"
            ? `${uiText.refundToWallet}\n\n`
            : ""}${uiText.cancelConfirmQuestion}`;
        const confirmKeyboard = Markup.inlineKeyboard([
            [Markup.button.callback(uiText.confirmCancel, `CONFIRM_CANCEL:${orderId}`)],
            [Markup.button.callback(uiText.backOrder, `ORDER:${orderId}`)],
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
        const lang = getLang(ctx);
        const uiText = userUi(lang);
        const orderId = ctx.match[1];

        const order = await prisma.order.findUnique({
            where: { id: orderId },
            include: { product: true, user: true }
        });

        if (!order) {
            return ctx.reply(uiText.orderNotFound);
        }

        // Verify ownership
        if (order.odelegramId !== String(ctx.from.id)) {
            return ctx.reply(uiText.noCancelPermission);
        }

        // Check if already canceled
        if (order.status === "CANCELED") {
            return ctx.reply(uiText.orderCanceled);
        }

        // Check if delivered
        if (order.status === "DELIVERED") {
            return ctx.reply(uiText.cannotCancelDelivered);
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
                    return ctx.reply(uiText.deliveredWhileCancel);
                }
                return ctx.reply(uiText.cannotCancelChanged);
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
                        `❌ <b>${uiText.cancelNowError}</b>\n${DIVIDER}\n${uiText.refundFailed(refundResult?.error)}`,
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
            let successMsg = `<b>${uiText.canceledTitle}</b>
${DIVIDER}
${uiText.orderCode}: <code>${escapeHtml(order.id.slice(-8).toUpperCase())}</code>
${uiText.product}: <b>${escapeHtml(order.product.name)}</b>`;

            if (refundAmount > 0) {
                successMsg += `\n\n${uiText.refunded}: <b>${formatUsdPrimary(refundAmount, "VND", { lang })}</b>\n`;
                successMsg += `${uiText.newBalance}: <b>${formatUsdPrimary(refundResult.newBalance, "VND", { lang })}</b>`;
            }

            await editMenu(ctx, successMsg, {
                parse_mode: "HTML",
                ...Markup.inlineKeyboard([
                    [Markup.button.callback(uiText.orderList, "MY_ORDERS")],
                    [Markup.button.callback(uiText.menu, "BACK_HOME")]
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
            await ctx.reply(uiText.cancelNowError);
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

    bot.action("DEPOSIT_BANK", async (ctx) => {
        await answerCallback(ctx);
        const lang = getLang(ctx);
        const uiText = userUi(lang);
        const presets = await getDepositPresets();
        await editMenu(ctx, `<b>${uiText.bankDepositTitle}</b>
${DIVIDER}
${uiText.chooseBankDepositAmount}

💱 ${formatRateHint(lang)}`, {
            parse_mode: "HTML",
            ...buildBankDepositKeyboard(presets, { lang }),
        });
    });

    // Deposit - Create QR for deposit
    bot.action(/^DEPOSIT:(\d+)$/, async (ctx) => {
        await answerCallback(ctx);
        const lang = getLang(ctx);
        const uiText = userUi(lang);
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

        const msg = buildDepositMsg({ amount, depositContent, bankName, bankAccount, accountName, expireMinutes, lang });

        const depositKeyboard = Markup.inlineKeyboard([
            [Markup.button.url(uiText.openQr, qrUrl)],
            [Markup.button.callback(uiText.checkBank, `DEPOSIT_CHECK:${tx.id}`)],
            [Markup.button.callback(uiText.backWallet, "WALLET")],
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
        const lang = getLang(ctx);
        const uiText = userUi(lang);

        sendLog("DEPOSIT", `User ${ctx.from.id} selected CUSTOM DEPOSIT`);

        ctx.session.pendingAction = "DEPOSIT_AMOUNT";

        await editMenu(ctx, `<b>${uiText.customDepositTitle}</b>
${DIVIDER}
${uiText.enterDepositAmount}

${uiText.minDeposit}
${uiText.depositExample}`, {
            ...Markup.inlineKeyboard([
                [Markup.button.callback(uiText.cancel, "WALLET")],
            ]),
        });
    });

    // Transaction history
    bot.action("TX_HISTORY", async (ctx) => {
        await answerCallback(ctx);
        const lang = getLang(ctx);
        const uiText = userUi(lang);
        const transactions = await getTransactionHistory(ctx.from.id, 10);

        if (transactions.length === 0) {
            return editMenu(ctx, `<b>${uiText.txHistoryTitle}</b>
${DIVIDER}
${uiText.noTransactions}`, {
                ...Markup.inlineKeyboard([[Markup.button.callback(uiText.menu, "BACK_HOME")]]),
            });
        }

        const lines = transactions.map((tx) => {
            const sign = tx.amount >= 0 ? "+" : "";
            const status = tx.status === "SUCCESS" ? uiText.success : tx.status === "PENDING" ? uiText.pending : uiText.failed;
            return `${escapeHtml(tx.type)} · ${status}
${sign}${formatUsdPrimary(Math.abs(tx.amount), "VND", { lang })} | ${uiText.balance}: ${formatUsdPrimary(tx.balanceAfter, "VND", { lang })}
${formatDateTime(tx.createdAt)}`;
        });

        await editMenu(ctx, `<b>${uiText.txHistoryTitle}</b>
${DIVIDER}
${lines.join("\n\n")}`, {
            ...Markup.inlineKeyboard([[Markup.button.callback(uiText.menu, "BACK_HOME")]]),
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
            `Đã nhận: <b>${formatUsdPrimary(stats.balance, "VND", { lang })}</b>\n` +
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
        return renderCategoryList(1, { lang: getLang(ctx) });
    };

    const showProductDetail = async (ctx, productId, quantity = 1) => {
        sendChatAction(ctx, "typing");
        const lang = getLang(ctx);
        const uiText = userUi(lang);
        const product = await getCachedProduct(productId);

        if (!product || !product.isActive) {
            return editMenu(ctx, uiText.productUnavailableLong, {
                ...Markup.inlineKeyboard([
                    [Markup.button.callback(uiText.products, "LIST_PRODUCTS")],
                    [Markup.button.callback(uiText.menu, "BACK_HOME")],
                ]),
            });
        }

        const adminUsername = process.env.ADMIN_TELEGRAM || "admin";
        if (product.deliveryMode === "CONTACT") {
            return editMenu(ctx, contactProductMessage({ product, adminUsername, lang }), {
                ...buildContactProductKeyboard(adminUsername, product.categoryId, lang),
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
        const text = productDetailMessage({ product: productDisplay, stockCount, soldCount: soldCount + (product.soldFake || 0), lang });
        const keyboard = buildProductDetailKeyboard({
            productId: product.id,
            inStock,
            categoryId: product.categoryId,
            stockCount,
            deliveryMode: product.deliveryMode,
            promptMode: usePrompt,
            lang,
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
                uiText.quantityPrompt(rangeText)
            );
            getState(ctx.chat.id).tempMessages.push(promptMsg.message_id);
        }
    };

    // List products (Inline Action)
    // Show categories
    bot.action("LIST_PRODUCTS", async (ctx) => {
        await answerCallback(ctx);
        sendChatAction(ctx, "typing");
        const ui = await renderCategoryList(1, { lang: getLang(ctx) });

        await editMenu(ctx, ui.text, ui.keyboard);
    });

    bot.action(/^category_page:(\d+)$/i, async (ctx) => {
        await answerCallback(ctx);
        sendChatAction(ctx, "typing");
        const ui = await renderCategoryList(Number(ctx.match[1]), { lang: getLang(ctx) });
        await editMenu(ctx, ui.text, ui.keyboard);
    });

    bot.hears("🛍️ Sản Phẩm", async (ctx) => {
        const ui = await renderCategoryList(1, { lang: getLang(ctx) });
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
        const ui = await renderProductsInCategory(categoryId, 1, { lang: getLang(ctx) });

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
        const ui = await renderProductsInCategory(categoryId, page, { lang: getLang(ctx) });
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
        await answerCallback(ctx, userUi(getLang(ctx)).chooseProductToChangeQuantity);
    });

    bot.action(/^noop:/i, async (ctx) => {
        await answerCallback(ctx, userUi(getLang(ctx)).chooseProductToChangeQuantity);
    });

    // Custom quantity — prompt user to type a number
    bot.action(/^CUSTOM_QTY:(.+)$/i, async (ctx) => {
        await answerCallback(ctx);
        const lang = getLang(ctx);
        const uiText = userUi(lang);
        const productId = ctx.match[1];

        const product = await prisma.product.findUnique({ where: { id: productId } });
        if (!product || !product.isActive) {
            return ctx.reply(uiText.productUnavailable);
        }

        ctx.session.customQuantityProduct = productId;

        const stockInfo = product.deliveryMode === "STOCK_LINES"
            ? ` (${uiText.stockLeft(await getStockCount(product.id))})` : "";
        await editMenu(ctx,
            `<b>${escapeHtml(product.name)}</b>\n${DIVIDER}\n` +
            `${uiText.price}: <b>${formatUsdPrimary(product.price, product.currency, { lang })}</b>/${uiText.each}${stockInfo}\n\n` +
            `${uiText.enterQuantity}:`,
            { parse_mode: "HTML" }
        );
    });

    // Fallback for old qty_set buttons â†’ buy now
    bot.action(/^qty_set:(.+):(\d+)$/i, async (ctx) => {
        const lang = getLang(ctx);
        await answerCallback(ctx, userUi(lang).preparingOrder);
        const productId = ctx.match[1];
        const quantity = Math.max(1, Number(ctx.match[2]));
        const product = await prisma.product.findUnique({ where: { id: productId } });
        if (!product || !product.isActive || product.price <= 0) return ctx.reply(userUi(lang).productUnavailable);
        const stockCheck = await validateStockForQuantity(product, quantity, lang);
        if (!stockCheck.ok) return ctx.reply(stockCheck.message);
        const orderData = createPendingOrder(ctx, product, quantity);
        await processPaymentFlow(ctx, orderData);
    });

    // "Nhập số khác" â†’ prompt text input
    bot.action(/^QTY_TYPE:(.+)$/i, async (ctx) => {
        await answerCallback(ctx);
        const lang = getLang(ctx);
        const uiText = userUi(lang);
        const productId = ctx.match[1];

        const product = await prisma.product.findUnique({ where: { id: productId } });
        if (!product || !product.isActive) {
            return ctx.reply(uiText.productUnavailable);
        }

        ctx.session.customQuantityProduct = productId;

        await editMenu(ctx,
            `<b>${uiText.enterQuantityTitle}</b>\n${DIVIDER}\n` +
            `${uiText.product}: <b>${escapeHtml(product.name)}</b>\n` +
            `${uiText.price}: <b>${formatUsdPrimary(product.price, product.currency, { lang })}</b>\n\n` +
            `${uiText.quantityExample}`,
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
                return ctx.reply(userUi(lang).notEnoughStock(stockCount));
            }
        }

        createPendingOrder(ctx, product, quantity);

        // Go directly to payment (skip coupon)
        await processPaymentFlow(ctx, ctx.session.pendingOrder);
    });

    bot.action(/^buy_now:(.+):(\d+)$/i, async (ctx) => {
        const lang = getLang(ctx);
        await answerCallback(ctx, userUi(lang).preparingOrder);
        const productId = ctx.match[1];
        const quantity = Math.max(1, Number(ctx.match[2]) || 1);

        const product = await prisma.product.findUnique({ where: { id: productId } });
        if (!product || !product.isActive || product.price <= 0) {
            return ctx.reply(userUi(lang).productUnavailable);
        }

        const stockCheck = await validateStockForQuantity(product, quantity, lang);
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
            const lang = getLang(ctx);
            const uiText = userUi(lang);
            const productId = ctx.session.customQuantityProduct;
            const quantityText = ctx.message.text.trim();
            const quantity = parseInt(quantityText, 10);

            // Validate quantity
            if (isNaN(quantity) || quantity < 1) {
                return ctx.reply(
                    uiText.invalidQuantity,
                    Markup.inlineKeyboard([[Markup.button.callback(uiText.cancel, "LIST_PRODUCTS")]])
                );
            }

            if (quantity > 999) {
                return ctx.reply(
                    uiText.quantityTooLarge,
                    Markup.inlineKeyboard([[Markup.button.callback(uiText.cancel, "LIST_PRODUCTS")]])
                );
            }

            // Get product and validate stock
            const product = await prisma.product.findUnique({ where: { id: productId } });
            if (!product || !product.isActive) {
                delete ctx.session.customQuantityProduct;
                return ctx.reply(uiText.productUnavailable);
            }

            if (product.deliveryMode === "STOCK_LINES") {
                const stockCount = await getStockCount(product.id);
                if (stockCount < quantity) {
                    return ctx.reply(
                        uiText.stockShortageDetail(stockCount, quantity),
                        Markup.inlineKeyboard([[Markup.button.callback(uiText.backProduct, `PRODUCT:${productId}`)]])
                    );
                }
            }

            // Create pending order
            createPendingOrder(ctx, product, quantity);

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
                case "MIN_ORDER": errorMsg = t("couponMinOrder", lang, { min: formatUsdPrimary(result.minOrder, "VND", { lang }) }); break;
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
        const lang = getLang(ctx);
        const order = ctx.session.pendingOrder;

        if (!order) return ctx.reply(userUi(lang).sessionExpired);

        // Bỏ coupon nhưng giữ quantity discount — processPaymentFlow tính lại
        order.couponId = null;
        order.couponDiscount = 0;

        // Go directly to payment (VietQR only)
        await processPaymentFlow(ctx, order);
    });

    // Process payment - Check wallet first, then show options
    async function processPaymentFlow(ctx, orderData) {
        const lang = getLang(ctx);
        const [balance, product] = await Promise.all([
            getBalance(ctx.from.id),
            prisma.product.findUnique({ where: { id: orderData.productId } }),
        ]);
        if (!product || !product.isActive) {
            ctx.session.pendingOrder = null;
            return ctx.reply(userUi(lang).productNotFound || userUi(lang).genericError);
        }
        const stockCheck = await validateStockForQuantity(product, orderData.quantity, lang);
        if (!stockCheck.ok) {
            ctx.session.pendingOrder = null;
            return ctx.reply(stockCheck.message);
        }

        // Recompute giá idempotent — hàm này được gọi từ nhiều luồng (mua ngay, nhập SL,
        // sau coupon, skip coupon). Luôn tính lại từ giá gốc để không cộng dồn sai.
        const usdVndRate = getUsdVndRate();
        const unitPrice = toVndAmount(product.price, product.currency, { rate: usdVndRate });
        const gross = unitPrice * orderData.quantity || orderData.amount || 0;
        const qty = await applyQuantityDiscount(orderData.productId, unitPrice, orderData.quantity);
        let couponDiscount = 0;
        if (orderData.couponId) {
            const coupon = await prisma.coupon.findUnique({ where: { id: orderData.couponId } });
            const validation = coupon ? await validateCoupon(coupon.code, gross, ctx.from.id) : { valid: false };
            if (validation.valid) {
                couponDiscount = calculateDiscount(validation.coupon, gross);
            } else {
                orderData.couponId = null;
                orderData.couponDiscount = 0;
            }
        }
        orderData.couponDiscount = couponDiscount;

        orderData.amount = gross;
        orderData.quantityDiscount = qty.discount;
        orderData.quantityDiscountPercent = qty.discountPercent;
        orderData.discount = qty.discount + couponDiscount;
        orderData.finalAmount = Math.max(0, gross - qty.discount - couponDiscount);
        orderData.currency = "VND";
        orderData.unitPrice = unitPrice;
        orderData.displayCurrency = product?.currency || "VND";
        orderData.displayUnitPrice = Number(product?.price || 0);
        orderData.displayFinalUsd = orderData.finalAmount / usdVndRate;
        orderData.usdVndRate = usdVndRate;
        orderData.requiresWalletTopup = isUsdCurrency(orderData.displayCurrency);
        orderData.lang = lang;

        // Store order data in session for later use
        ctx.session.pendingOrder = orderData;

        const missing = Math.max(0, orderData.finalAmount - balance);
        const text = checkoutMessage({ orderData, balance, missing, lang });
        const keyboard = buildCheckoutKeyboard({
            canPayWallet: balance >= orderData.finalAmount,
            requireWalletTopup: orderData.requiresWalletTopup,
            lang,
        });

        if (ctx.callbackQuery) {
            return editMenu(ctx, text, keyboard);
        }

        return sendMenu(ctx, text, { parse_mode: "HTML", ...keyboard });
    }

    async function ensureCheckoutQuoteIsCurrent(ctx, orderData) {
        const product = await prisma.product.findUnique({ where: { id: orderData.productId } });
        if (!product || !product.isActive) {
            await processPaymentFlow(ctx, orderData);
            return false;
        }

        const lockedRate = Number(orderData.usdVndRate || getUsdVndRate());
        const unitPrice = toVndAmount(product.price, product.currency, { rate: lockedRate });
        const gross = unitPrice * orderData.quantity;
        const qty = await applyQuantityDiscount(orderData.productId, unitPrice, orderData.quantity);
        let couponDiscount = 0;
        if (orderData.couponId) {
            const coupon = await prisma.coupon.findUnique({ where: { id: orderData.couponId } });
            const validation = coupon ? await validateCoupon(coupon.code, gross, ctx.from.id) : { valid: false };
            if (validation.valid) couponDiscount = calculateDiscount(validation.coupon, gross);
            else {
                await processPaymentFlow(ctx, orderData);
                return false;
            }
        }

        const finalAmount = Math.max(0, gross - qty.discount - couponDiscount);
        const unchanged = Number(product.price) === Number(orderData.displayUnitPrice)
            && String(product.currency || "VND").toUpperCase() === String(orderData.displayCurrency || "VND").toUpperCase()
            && gross === orderData.amount
            && qty.discount === Number(orderData.quantityDiscount || 0)
            && couponDiscount === Number(orderData.couponDiscount || 0)
            && finalAmount === orderData.finalAmount;

        if (!unchanged) await processPaymentFlow(ctx, orderData);
        return unchanged;
    }

    bot.action("CANCEL_CHECKOUT", async (ctx) => {
        await answerCallback(ctx, userUi(getLang(ctx)).checkoutCanceled);
        ctx.session.pendingOrder = null;
        await showMainMenu(ctx, { edit: true });
    });

    // Pay with wallet
    bot.action("PAY_WALLET", async (ctx) => {
        const _clearProcessing = () => { ctx.session.processingPayment = false; };
        try {
            const lang = getLang(ctx);
            const uiText = userUi(lang);
            await answerCallback(ctx, uiText.processingPayment);
            sendChatAction(ctx, "typing");
            const orderData = ctx.session.pendingOrder;

            if (!orderData) {
                return ctx.reply(uiText.sessionExpired, {
                    ...Markup.inlineKeyboard([[Markup.button.callback(uiText.menu, "BACK_HOME")]]),
                });
            }

            if (!await ensureCheckoutQuoteIsCurrent(ctx, orderData)) return;

            if (ctx.session.processingPayment) {
                return ctx.reply(uiText.processingOrder);
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
                return ctx.reply(uiText.insufficientBalance, {
                    ...Markup.inlineKeyboard([[Markup.button.callback(uiText.depositWallet, "WALLET"), Markup.button.callback(uiText.menu, "BACK_HOME")]]),
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
                    cryptoUsdVndRate: orderData.usdVndRate,
                    displayCurrency: orderData.displayCurrency,
                    displayUnitPrice: orderData.displayUnitPrice,
                    displayFinalUsd: orderData.displayFinalUsd,
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
        const lang = getLang(ctx);
        const ui = cryptoUi(lang);
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
            [Markup.button.url(ui.openQr, buildExternalQrUrl(qrPayload))],
            [Markup.button.callback(ui.check, `ORDER_CRYPTO_CHECK:${order.id}`)],
            [Markup.button.callback(ui.cancel, `CANCEL_ORDER:${order.id}`)],
        ]);
        const paymentKey = `order:${order.id}`;

        clearPaymentMessages(ctx.chat.id).catch(() => {});
        deleteCurrentCallbackMessage(ctx).catch(() => {});
        getState(ctx.chat.id).paymentMessages.set(paymentKey, new Set());

        const payMsg = await ctx.reply(formatCryptoPaymentMessage(checkout, { lang }), {
            parse_mode: "HTML",
            disable_web_page_preview: true,
            ...orderKeyboard,
        });
        rememberPaymentMessage(ctx, paymentKey, payMsg);

        sendGeneratedQrPhoto(
            ctx,
            paymentKey,
            qrPayload,
            ui.qrCaption(checkout.networkLabel, checkout.amountToken.toFixed(6)),
        );
    }

    bot.action(/^PAY_CRYPTO:(trc20|bep20)$/i, async (ctx) => {
        const network = String(ctx.match[1]).toLowerCase();
        const lang = getLang(ctx);
        const ui = cryptoUi(lang);
        const uiText = userUi(lang);
        await answerCallback(ctx, ui.creating);
        sendChatAction(ctx, "typing");

        const orderData = ctx.session.pendingOrder;
        if (!orderData) {
            return ctx.reply(uiText.sessionExpired);
        }
        if (!await ensureCheckoutQuoteIsCurrent(ctx, orderData)) return;
        if (orderData.requiresWalletTopup) {
            return ctx.reply(uiText.walletUsdOnly, {
                ...Markup.inlineKeyboard([[Markup.button.callback(uiText.depositWallet, "WALLET")]]),
            });
        }

        if (!getEnabledCryptoNetworks().includes(network)) {
            return ctx.reply(
                lang === "en"
                    ? `USDT ${network.toUpperCase()} payment is not configured. Please choose another method or contact support.`
                    : lang === "zh"
                        ? `USDT ${network.toUpperCase()} 支付尚未配置。请选择其他方式或联系管理员。`
                        : `Thanh toán USDT ${network.toUpperCase()} chưa được cấu hình. Vui lòng chọn phương thức khác hoặc liên hệ admin.`,
                { ...Markup.inlineKeyboard([[Markup.button.callback(lang === "en" ? "🏦 Bank QR" : lang === "zh" ? "🏦 银行二维码" : "🏦 Thanh toán QR", "PAY_QR"), Markup.button.callback(lang === "zh" ? "🏠 菜单" : "🏠 Menu", "BACK_HOME")]]) },
            );
        }

        if (ctx.session.processingPayment) {
            return ctx.reply(uiText.processingOrder);
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
                    cryptoUsdVndRate: orderData.usdVndRate,
                    displayCurrency: orderData.displayCurrency,
                    displayUnitPrice: orderData.displayUnitPrice,
                    displayFinalUsd: orderData.displayFinalUsd,
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
                lang === "en"
                    ? `<b>USDT payment error</b>\n${DIVIDER}\nSomething went wrong. Please try again or contact support.`
                    : lang === "zh"
                        ? `<b>USDT 支付创建失败</b>\n${DIVIDER}\n发生错误，请重试或联系管理员。`
                        : `<b>Lỗi tạo thanh toán USDT</b>\n${DIVIDER}\nCó lỗi xảy ra, vui lòng thử lại hoặc liên hệ hỗ trợ.`,
                { parse_mode: "HTML" },
            ).catch(() => {});
        } finally {
            ctx.session.processingPayment = false;
        }
    });

    // Pay with QR (direct)
    bot.action("PAY_QR", async (ctx) => {
        const lang = getLang(ctx);
        const uiText = userUi(lang);
        await answerCallback(ctx, uiText.creatingPayment);
        sendChatAction(ctx, "upload_photo");
        const orderData = ctx.session.pendingOrder;

        if (!orderData) {
            return ctx.reply(uiText.sessionExpired);
        }
        if (!await ensureCheckoutQuoteIsCurrent(ctx, orderData)) return;
        if (orderData.requiresWalletTopup) {
            return ctx.reply(uiText.walletUsdOnly, {
                ...Markup.inlineKeyboard([[Markup.button.callback(uiText.depositWallet, "WALLET")]]),
            });
        }

        if (ctx.session.processingPayment) {
            return ctx.reply(uiText.processingOrder);
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
                    cryptoUsdVndRate: orderData.usdVndRate,
                    displayCurrency: orderData.displayCurrency,
                    displayUnitPrice: orderData.displayUnitPrice,
                    displayFinalUsd: orderData.displayFinalUsd,
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
                [Markup.button.url(uiText.openQr, checkout.qrUrl)],
                [Markup.button.callback(uiText.paidCheckAgain, `ORDER_BANK_CHECK:${order.id}`)],
                [Markup.button.callback(uiText.cancelOrder, `CANCEL_ORDER:${order.id}`)],
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
                `<b>${uiText.paymentCreateErrorTitle}</b>\n${DIVIDER}\n${uiText.genericError}`,
                { parse_mode: "HTML" }
            ).catch(() => { });
        } finally {
            ctx.session.processingPayment = false;
        }
    });

    // Cancel order
    bot.action(/^CANCEL:(.+)$/i, async (ctx) => {
        const lang = getLang(ctx);
        const uiText = userUi(lang);
        await answerCallback(ctx, uiText.orderCanceled);
        const orderId = ctx.match[1];

        const order = await prisma.order.findUnique({ where: { id: orderId } });
        if (!order) return ctx.reply(uiText.orderNotFound);
        if (order.odelegramId !== String(ctx.from.id)) return ctx.reply(uiText.noCancelPermissionShort);
        if (order.status !== "PENDING") return ctx.reply(uiText.cannotCancelThisOrder);

        await prisma.order.update({
            where: { id: orderId },
            data: { status: "CANCELED" },
        });

        await editMenu(ctx, `<b>${uiText.canceledTitle}</b>\n${DIVIDER}\n${uiText.orderCode}: <code>${escapeHtml(orderId.slice(-8).toUpperCase())}</code>`, {
            ...Markup.inlineKeyboard([
                [Markup.button.callback(uiText.buy, "LIST_PRODUCTS")],
                [Markup.button.callback(uiText.menu, "BACK_HOME")],
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

        if (!order) return ctx.reply(userUi(lang).orderNotFound);

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
                const ui = await renderAllProducts(1, { lang: getLang(ctx) });
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
            const lang = getLang(ctx);
            const ui = cryptoUi(lang);
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
                return ctx.reply(ui.invalidAmount(minUsdt));
            }
            const maxDeposit = await getMaxDeposit();
            if (maxDeposit > 0 && amount > maxDeposit) {
                const maxUsdt = maxDeposit / usdVndRate;
                return ctx.reply(ui.maxAmount(maxUsdt));
            }
            if (!getEnabledCryptoNetworks().includes(network)) {
                ctx.session.pendingAction = null;
                return ctx.reply(ui.notConfigured(network));
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
                [Markup.button.url(ui.openQr, buildExternalQrUrl(qrPayload))],
                [Markup.button.callback(ui.check, `DEPOSIT_CRYPTO_CHECK:${tx.id}`)],
                [Markup.button.callback(ui.backWallet, "WALLET")],
            ]);

            const state = getState(ctx.chat.id);
            const oldMenuId = state.lastMenuId;
            state.lastMenuId = null;
            clearPaymentMessages(ctx.chat.id).catch(() => {});
            if (oldMenuId) safeDelete(ctx, oldMenuId).catch(() => {});
            safeDelete(ctx, ctx.message.message_id).catch(() => {});

            const depositMsg = await ctx.reply(formatCryptoDepositMessage(checkout, { lang }), {
                parse_mode: "HTML",
                disable_web_page_preview: true,
                ...depositKeyboard,
            });
            rememberPaymentMessage(ctx, paymentKey, depositMsg);

            sendGeneratedQrPhoto(
                ctx,
                paymentKey,
                qrPayload,
                ui.qrCaption(checkout.networkLabel, checkout.amountToken.toFixed(6)),
            );
            return;
        }

        // Check if waiting for custom deposit amount
        if (ctx.session?.pendingAction === "DEPOSIT_AMOUNT") {
            const lang = getLang(ctx);
            const uiText = userUi(lang);
            const text = ctx.message.text.replace(/[,.\s]/g, "");
            const amount = parseInt(text, 10);

            if (isNaN(amount)) {
                // Không phải số — user bấm nút menu, hủy flow deposit
                ctx.session.pendingAction = null;
                return next();
            }
            if (amount < 10000) {
                return ctx.reply(uiText.invalidDepositAmount);
            }
            const maxDeposit = await getMaxDeposit();
            if (maxDeposit > 0 && amount > maxDeposit) {
                return ctx.reply(uiText.maxDepositAmount(maxDeposit));
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
            const msg = buildDepositMsg({ amount, depositContent, bankName, bankAccount, accountName, expireMinutes, lang });

            const depositKeyboard2 = Markup.inlineKeyboard([
                [Markup.button.url(uiText.openQr, qrUrl)],
                [Markup.button.callback(uiText.checkBank, `DEPOSIT_CHECK:${tx.id}`)],
                [Markup.button.callback(uiText.backWallet, "WALLET")],
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
        const lang = getLang(ctx);
        const uiText = userUi(lang);
        await answerCallback(ctx, uiText.checking);
        const transactionId = ctx.match[1];

        try {
            const result = await Promise.race([
                confirmDepositByBankScan(transactionId, ctx.from.id),
                new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 10000)),
            ]);

            if (result.success && result.alreadyProcessed) {
                await clearPaymentMessages(ctx.chat.id, `deposit:${transactionId}`);
                return ctx.reply(
                    `✅ <b>${uiText.alreadyProcessed}</b>\n${DIVIDER}\n💳 ${uiText.currentBalance}: <b>${formatUsdPrimary(result.newBalance || 0, "VND", { lang })}</b>`,
                    { parse_mode: "HTML" },
                );
            }

            if (result.success) {
                sendLog("DEPOSIT", `Manual deposit confirmed: User ${ctx.from.id} - ${formatPrice(result.matched?.amount || 0)} - ${result.paymentRef}`);
                await clearPaymentMessages(ctx.chat.id, `deposit:${transactionId}`);
                return ctx.reply(
                    `✅ <b>${uiText.depositSuccessTitle}</b>\n${DIVIDER}\n💰 ${uiText.depositSuccessAmount}: <b>+${formatUsdPrimary(result.matched?.amount || 0, "VND", { lang })}</b>\n💳 ${uiText.newBalance}: <b>${formatUsdPrimary(result.newBalance || 0, "VND", { lang })}</b>`,
                    {
                        parse_mode: "HTML",
                        ...Markup.inlineKeyboard([
                            [Markup.button.callback(uiText.viewWallet, "WALLET")],
                            [Markup.button.callback(uiText.menu, "BACK_HOME")],
                        ]),
                    },
                );
            }

            return ctx.reply(
                `⏳ <b>${uiText.txNotFoundTitle}</b>\n${DIVIDER}\n${uiText.bankWait}`,
                { parse_mode: "HTML" },
            );
        } catch (error) {
            console.error("DEPOSIT_CHECK error:", error);
            sendLog("ERROR", `DEPOSIT_CHECK failed: User ${ctx.from?.id} - ${error.message}`);
            return ctx.reply(
                `❌ <b>${uiText.cannotCheckTitle}</b>\n${DIVIDER}\n${uiText.tryLater}`,
                { parse_mode: "HTML" },
            );
        }
    });

    bot.action(/^DEPOSIT_CRYPTO_CHECK:(.+)$/i, async (ctx) => {
        const lang = getLang(ctx);
        const uiText = userUi(lang);
        await answerCallback(ctx, cryptoUi(lang).checking);
        const transactionId = ctx.match[1];

        try {
            const result = await Promise.race([
                confirmDepositByCryptoScan(transactionId, ctx.from.id),
                new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 30000)),
            ]);

            if (result.success && result.alreadyProcessed) {
                await clearPaymentMessages(ctx.chat.id, `deposit:${transactionId}`);
                return ctx.reply(
                    `✅ <b>${uiText.alreadyProcessed}</b>\n${DIVIDER}\n💳 ${uiText.currentBalance}: <b>${formatUsdPrimary(result.newBalance || 0, "VND", { lang })}</b>`,
                    { parse_mode: "HTML" },
                );
            }

            if (result.success) {
                sendLog("DEPOSIT", `Manual crypto deposit confirmed: User ${ctx.from.id} - ${formatPrice(result.matched?.amount || 0)} USDT - ${result.paymentRef}`);
                await clearPaymentMessages(ctx.chat.id, `deposit:${transactionId}`);
                return ctx.reply(
                    `✅ <b>${uiText.depositSuccessTitle}</b>\n${DIVIDER}\n💰 USDT: <b>+${formatUsdPrimary(result.depositAmount || 0, "VND", { lang })}</b>\n💳 ${uiText.newBalance}: <b>${formatUsdPrimary(result.newBalance || 0, "VND", { lang })}</b>`,
                    {
                        parse_mode: "HTML",
                        ...Markup.inlineKeyboard([
                            [Markup.button.callback(uiText.viewWallet, "WALLET")],
                            [Markup.button.callback(uiText.menu, "BACK_HOME")],
                        ]),
                    },
                );
            }

            return ctx.reply(
                lang === "en"
                    ? `⏳ <b>USDT transaction not found yet</b>\n${DIVIDER}\n${escapeHtml(result.error || "")}\n\nIf you just sent it, wait for blockchain confirmation and check again.`
                    : lang === "zh"
                        ? `⏳ <b>暂未找到 USDT 交易</b>\n${DIVIDER}\n${escapeHtml(result.error || "")}\n\n如果刚刚转账，请等待区块链确认后再次检查。`
                        : `⏳ <b>Chưa tìm thấy giao dịch USDT</b>\n${DIVIDER}\n${escapeHtml(result.error || "")}\n\nNếu vừa chuyển, hãy chờ blockchain xác nhận rồi bấm kiểm tra lại.`,
                { parse_mode: "HTML" },
            );
        } catch (error) {
            console.error("DEPOSIT_CRYPTO_CHECK error:", error);
            sendLog("ERROR", `DEPOSIT_CRYPTO_CHECK failed: User ${ctx.from?.id} - ${error.message}`);
            return ctx.reply(
                lang === "en"
                    ? `❌ <b>Cannot check right now</b>\n${DIVIDER}\n${error.message === "timeout" ? "Blockchain API is slow. Please try again." : "Please try again in a few minutes."}`
                    : lang === "zh"
                        ? `❌ <b>暂时无法检查</b>\n${DIVIDER}\n${error.message === "timeout" ? "区块链 API 响应较慢，请重试。" : "请稍后再试。"}`
                        : `❌ <b>Không kiểm tra được lúc này</b>\n${DIVIDER}\n${error.message === "timeout" ? "API blockchain phản hồi chậm. Vui lòng thử lại." : "Vui lòng thử lại sau ít phút."}`,
                { parse_mode: "HTML" },
            );
        }
    });

    // Manual bank check for VietQR orders
    bot.action(/^ORDER_BANK_CHECK:(.+)$/, async (ctx) => {
        const lang = getLang(ctx);
        const uiText = userUi(lang);
        await answerCallback(ctx, uiText.checkingBank);
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
                    `⏳ <b>${uiText.txNotFoundTitle}</b>\n${DIVIDER}\n${escapeHtml(result.error || "")}\n\n${uiText.bankOrderWait}`,
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
            const paidText = `<b>${uiText.paymentReceivedTitle}</b>\n${DIVIDER}\n`
                + `${uiText.orderCode}: <code>${escapeHtml(orderId.slice(-8).toUpperCase())}</code>\n`
                + `${uiText.deliveringWait}`;
            return ctx.reply(paidText, {
                parse_mode: "HTML",
                ...Markup.inlineKeyboard([
                    [Markup.button.callback(uiText.viewOrder, `ORDER:${orderId}`)],
                    [Markup.button.callback(uiText.menu, "BACK_HOME")],
                ]),
            });
        } catch (error) {
            console.error("ORDER_BANK_CHECK error:", error);
            sendLog("ERROR", `ORDER_BANK_CHECK failed: User ${ctx.from?.id} - ${error.message}`);
            const isTimeout = error.message === "timeout";
            const isConfig = error.message?.includes("cấu hình");
            return ctx.reply(
                `❌ <b>${uiText.cannotCheckTitle}</b>\n${DIVIDER}\n${isTimeout ? uiText.bankSlow : isConfig ? error.message : uiText.tryLater}`,
                { parse_mode: "HTML" },
            );
        }
    });

    bot.action(/^ORDER_CRYPTO_CHECK:(.+)$/, async (ctx) => {
        const lang = getLang(ctx);
        await answerCallback(ctx, cryptoUi(lang).checking);
        const orderId = ctx.match[1];

        try {
            const result = await Promise.race([
                confirmOrderByCryptoScan(orderId, ctx.from.id),
                new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 30000)),
            ]);

            if (!result.success) {
                return ctx.reply(
                    lang === "en"
                        ? `⏳ <b>USDT transaction not found yet</b>\n${DIVIDER}\n${escapeHtml(result.error || "")}\n\nIf you just sent it, wait for blockchain confirmation and check again.`
                        : lang === "zh"
                            ? `⏳ <b>暂未找到 USDT 交易</b>\n${DIVIDER}\n${escapeHtml(result.error || "")}\n\n如果刚刚转账，请等待区块链确认后再次检查。`
                            : `⏳ <b>Chưa tìm thấy giao dịch USDT</b>\n${DIVIDER}\n${escapeHtml(result.error || "")}\n\nNếu vừa chuyển, hãy chờ blockchain xác nhận rồi bấm kiểm tra lại.`,
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
                (lang === "en"
                    ? `<b>USDT payment received</b>\n${DIVIDER}\nOrder: <code>${escapeHtml(orderId.slice(-8).toUpperCase())}</code>\nThe bot is delivering your order. If Telegram sends files slowly, please wait a few minutes.`
                    : lang === "zh"
                        ? `<b>已收到 USDT 付款</b>\n${DIVIDER}\n订单：<code>${escapeHtml(orderId.slice(-8).toUpperCase())}</code>\n机器人正在发货。如果 Telegram 发送文件较慢，请等待几分钟。`
                        : `<b>Đã nhận thanh toán USDT</b>\n${DIVIDER}\nMã đơn: <code>${escapeHtml(orderId.slice(-8).toUpperCase())}</code>\nBot đang giao hàng. Nếu Telegram gửi file chậm, vui lòng chờ thêm ít phút.`),
                {
                    parse_mode: "HTML",
                    ...Markup.inlineKeyboard([
                        [Markup.button.callback(lang === "en" ? "View order" : lang === "zh" ? "查看订单" : "Xem đơn hàng", `ORDER:${orderId}`)],
                        [Markup.button.callback(lang === "zh" ? "🏠 菜单" : "🏠 Menu", "BACK_HOME")],
                    ]),
                },
            );
        } catch (error) {
            console.error("ORDER_CRYPTO_CHECK error:", error);
            sendLog("ERROR", `ORDER_CRYPTO_CHECK failed: User ${ctx.from?.id} - ${error.message}`);
            return ctx.reply(
                lang === "en"
                    ? `❌ <b>Cannot check right now</b>\n${DIVIDER}\n${error.message === "timeout" ? "Blockchain API is slow. Please try again." : "Please try again in a few minutes."}`
                    : lang === "zh"
                        ? `❌ <b>暂时无法检查</b>\n${DIVIDER}\n${error.message === "timeout" ? "区块链 API 响应较慢，请重试。" : "请稍后再试。"}`
                        : `❌ <b>Không kiểm tra được lúc này</b>\n${DIVIDER}\n${error.message === "timeout" ? "API blockchain phản hồi chậm. Vui lòng thử lại." : "Vui lòng thử lại sau ít phút."}`,
                { parse_mode: "HTML" },
            );
        }
    });

    bot.action(/^SHOW_CRYPTO_PAY:(.+)$/, async (ctx) => {
        const lang = getLang(ctx);
        const uiText = userUi(lang);
        await answerCallback(ctx, lang === "en" ? "⏳ Loading USDT payment..." : lang === "zh" ? "⏳ 正在加载 USDT 支付..." : "⏳ Đang tải thanh toán USDT...");
        sendChatAction(ctx, "typing");
        const orderId = ctx.match[1];

        const order = await prisma.order.findUnique({
            where: { id: orderId },
            include: { product: true },
        });

        if (!order || order.odelegramId !== String(ctx.from.id)) {
            return ctx.reply(uiText.orderNotFound);
        }
        if (order.status !== "PENDING") {
            return editMenu(ctx, orderDetailMessage(order, { lang }), buildOrderDetailKeyboard(order, { lang }));
        }
        if (!isCryptoPaymentMethod(order.paymentMethod)) {
            return ctx.reply(lang === "en" ? "This order is not a USDT payment." : lang === "zh" ? "此订单不是 USDT 支付。" : "Đơn hàng này không phải thanh toán USDT.");
        }

        const expected = getOrderExpectedCrypto(order);
        await sendCryptoCheckout(ctx, {
            order,
            orderData: {
                productName: order.product?.name || uiText.product,
            },
            network: expected.network,
        });
    });

    bot.action(/^DEPOSIT_CRYPTO:(trc20|bep20)$/i, async (ctx) => {
        await answerCallback(ctx);
        const lang = getLang(ctx);
        const ui = cryptoUi(lang);
        const network = String(ctx.match[1]).toLowerCase();

        if (!getEnabledCryptoNetworks().includes(network)) {
            return ctx.reply(
                ui.notConfigured(network),
                { ...Markup.inlineKeyboard([[Markup.button.callback(ui.backWallet, "WALLET")]]) },
            );
        }

        sendLog("DEPOSIT", `User ${ctx.from.id} selected CRYPTO DEPOSIT ${network.toUpperCase()}`);
        ctx.session.pendingAction = `DEPOSIT_CRYPTO_AMOUNT:${network}`;

        await editMenu(ctx, `<b>${ui.depositTitle(network)}</b>
${DIVIDER}
${ui.enterAmount}

${ui.minAmount(Number(process.env.CRYPTO_MIN_DEPOSIT_USDT || 1))}
${ui.example}

💱 ${formatRateHint(lang)}

${ui.note}`, {
            parse_mode: "HTML",
            ...Markup.inlineKeyboard([
                [Markup.button.callback(ui.backWallet, "WALLET")],
            ]),
        });
    });

    // Re-show QR for existing PENDING order
    bot.action(/^SHOW_ORDER_QR:(.+)$/, async (ctx) => {
        const lang = getLang(ctx);
        const uiText = userUi(lang);
        await answerCallback(ctx, uiText.loadingQr);
        sendChatAction(ctx, "upload_photo");
        const orderId = ctx.match[1];

        const order = await prisma.order.findUnique({
            where: { id: orderId },
            include: { product: true },
        });

        if (!order || order.odelegramId !== String(ctx.from.id)) {
            return ctx.reply(uiText.orderNotFound);
        }
        if (order.status !== "PENDING") {
            return editMenu(ctx, orderDetailMessage(order, { lang }), buildOrderDetailKeyboard(order, { lang }));
        }

        const checkout = await createCheckout({
            orderId: order.id,
            amount: order.finalAmount,
            productName: order.product?.name || uiText.product,
            quantity: order.quantity,
        });

        const orderKeyboard = Markup.inlineKeyboard([
            [Markup.button.url(uiText.openQr, checkout.qrUrl)],
            [Markup.button.callback(uiText.paidCheckAgain, `ORDER_BANK_CHECK:${order.id}`)],
            [Markup.button.callback(uiText.cancelOrder, `CANCEL_ORDER:${order.id}`)],
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
