import { Telegraf, Markup, session } from "telegraf";
import { prisma } from "./db.js";
import { t, getLanguages } from "./i18n/index.js";
import { rateLimitMiddleware } from "./ratelimit.js";
import { getStockCount, checkStock } from "./inventory.js";
import { validateCoupon, calculateDiscount, applyCoupon } from "./coupon.js";
import { getOrCreateUser, getReferralStats, getReferralLink } from "./referral.js";
import { createCheckout, getPaymentMessage, getExpireMinutes } from "./payment/provider.js";
import { generateQRUrl, generateTransferContent } from "./payment/vietqr.js";
import {
    getBalance,
    createDeposit,
    getTransactionHistory,
    formatTransaction,
    generateDepositContent,
    purchase as walletPurchase,
    getOrCreateWallet,
} from "./wallet.js";
import { sendLog } from "./lib/logger.js";

/**

/**
 * Create and configure the Telegram bot v3
 * VietQR payment only
 */
export function createBot({ paymentProvider }) {
    const bot = new Telegraf(process.env.BOT_TOKEN);

    // ============================================
    // CHAT STATE MANAGEMENT (CORE)
    // ============================================
    const chatState = new Map();
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
        const chatId = ctx.chat.id;
        const state = getState(chatId);

        for (const id of state.tempMessages) {
            await safeDelete(ctx, id);
        }
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
            if (!e.message?.includes("message is not modified")) {
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
        sendLog("ERROR", `⚠️ Bot caught error: ${err.message}\nUser: ${ctx.from.id}`);
        ctx.reply("❌ Đã xảy ra lỗi. Vui lòng thử lại sau.").catch(() => { });
    });



    // Helper to get user language
    const getLang = (ctx) => ctx.session?.language || "vi";

    // Helper to format price
    const formatPrice = (amount, currency = "VND") => {
        if (currency === "VND") {
            return new Intl.NumberFormat("vi-VN").format(amount) + "đ";
        }
        return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(amount / 100);
    };

    // cleanReply = alias for sendMenu (backward compatibility)
    const cleanReply = sendMenu;

    // Helper to build dynamic main menu based on context
    const buildMainMenu = async (balance) => {
        const hasProducts = await prisma.product.count({ where: { isActive: true } }) > 0;
        const lowBalance = balance < 50000;

        const buttons = [];

        // Row 1: Products (only if available)
        if (hasProducts) {
            buttons.push([Markup.button.callback("🛒 Mua hàng", "LIST_PRODUCTS")]);
        } else {
            buttons.push([Markup.button.callback("📭 Chưa có SP", "NO_PRODUCTS")]);
        }

        // Row 2: Wallet (highlight if low balance)
        if (lowBalance) {
            buttons.push([Markup.button.callback("💰 Nạp tiền ngay!", "WALLET")]);
        } else {
            buttons.push([Markup.button.callback("💰 Số dư và Nạp tiền", "WALLET")]);
        }

        // Row 3: Orders & History
        buttons.push([Markup.button.callback("📦 Đơn hàng", "MY_ORDERS"), Markup.button.callback("📊 Lịch sử GD", "TX_HISTORY")]);

        // Row 4: Referral & Help
        buttons.push([Markup.button.callback("🎁 Giới thiệu", "REFERRAL"), Markup.button.callback("❓ Trợ giúp", "HELP")]);

        return Markup.inlineKeyboard(buttons);
    };

    // Reply keyboard for regular users (persistent at bottom)
    const userKeyboard = Markup.keyboard([
        ["💰 Nạp tiền", "🛒 Mua hàng"],
        ["📦 Đơn hàng", "📊 Lịch sử GD"],
        ["👤 Tài khoản", "❓ Hỗ trợ"],
    ]).resize();

    // Reply keyboard for admins (with admin button)
    const adminKeyboard = Markup.keyboard([
        ["💰 Nạp tiền", "🛒 Mua hàng"],
        ["📦 Đơn hàng", "📊 Lịch sử GD"],
        ["👤 Tài khoản", "🔧 Admin"],
        ["❓ Hỗ trợ"],
    ]).resize();

    // Check if user is admin
    const isAdmin = (userId) => {
        const adminIds = (process.env.ADMIN_IDS || "").split(",").filter(Boolean);
        return adminIds.includes(String(userId));
    };

    // No products action
    bot.action("NO_PRODUCTS", async (ctx) => {
        await ctx.answerCbQuery("📭 Chưa có sản phẩm. Vui lòng quay lại sau!", { show_alert: true });
    });

    // /start command
    bot.start(async (ctx) => {
        // Check for referral code
        const startParam = ctx.message.text.split(" ")[1];
        let referralCode = null;
        if (startParam?.startsWith("ref_")) {
            referralCode = startParam.replace("ref_", "");
        }

        // Get or create user
        await getOrCreateUser(ctx.from, referralCode);

        const lang = getLang(ctx);
        const userName = ctx.from.first_name || "bạn";
        const balance = await getBalance(ctx.from.id);
        const keyboard = isAdmin(ctx.from.id) ? adminKeyboard : userKeyboard;

        await ctx.reply(
            t("welcome", lang, { name: userName }) + "\n\n" +
            `💰 *Số dư ví:* ${balance.toLocaleString()}đ`,
            { parse_mode: "Markdown", ...keyboard }
        );
    });

    // /menu command - Open Main Menu (Inline)
    bot.command("menu", async (ctx) => {
        const balance = await getBalance(ctx.from.id);
        const menu = await buildMainMenu(balance);

        // Use sendMenu to clean old messages and track new one
        await sendMenu(ctx,
            `🏪 *Shop Bot*\n💰 Số dư: ${formatPrice(balance)}`,
            { parse_mode: "Markdown", ...menu }
        );
    });

    // Back to home - edit current message
    bot.action("BACK_HOME", async (ctx) => {
        await ctx.answerCbQuery();
        const balance = await getBalance(ctx.from.id);
        const menu = await buildMainMenu(balance);

        await ctx.editMessageText(
            `🏪 *Shop Bot*\n💰 Số dư: ${balance.toLocaleString()}đ`,
            { parse_mode: "Markdown", ...menu }
        );
    });

    // Language selection
    bot.action("LANGUAGE", async (ctx) => {
        await ctx.answerCbQuery();
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
        await ctx.answerCbQuery();
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
        await ctx.answerCbQuery();
        const lang = getLang(ctx);

        await ctx.editMessageText(t("helpTitle", lang), {
            parse_mode: "Markdown",
            ...Markup.inlineKeyboard([
                [Markup.button.callback(t("helpBuying", lang), "HELP:BUYING")],
                [Markup.button.callback(t("helpWallet", lang), "HELP:WALLET")],
                [Markup.button.callback(t("helpPayment", lang), "HELP:PAYMENT")],
                [Markup.button.callback(t("helpReferralGuide", lang), "HELP:REFERRAL")],
                [Markup.button.callback(t("helpContact", lang), "HELP:CONTACT")],
                [Markup.button.callback(t("back", lang), "BACK_HOME")],
            ]),
        });
    });

    bot.action("HELP:BUYING", async (ctx) => {
        await ctx.answerCbQuery();
        const lang = getLang(ctx);
        await ctx.editMessageText(t("helpBuyingText", lang), {
            parse_mode: "Markdown",
            ...Markup.inlineKeyboard([[Markup.button.callback(t("back", lang), "HELP")]]),
        });
    });

    bot.action("HELP:WALLET", async (ctx) => {
        await ctx.answerCbQuery();
        const lang = getLang(ctx);
        await ctx.editMessageText(t("helpWalletText", lang), {
            parse_mode: "Markdown",
            ...Markup.inlineKeyboard([[Markup.button.callback(t("back", lang), "HELP")]]),
        });
    });

    bot.action("HELP:PAYMENT", async (ctx) => {
        await ctx.answerCbQuery();
        const lang = getLang(ctx);
        await ctx.editMessageText(t("helpPaymentText", lang), {
            parse_mode: "Markdown",
            ...Markup.inlineKeyboard([[Markup.button.callback(t("back", lang), "HELP")]]),
        });
    });

    bot.action("HELP:REFERRAL", async (ctx) => {
        await ctx.answerCbQuery();
        const lang = getLang(ctx);
        await ctx.editMessageText(t("helpReferralText", lang), {
            parse_mode: "Markdown",
            ...Markup.inlineKeyboard([[Markup.button.callback(t("back", lang), "HELP")]]),
        });
    });

    bot.action("HELP:CONTACT", async (ctx) => {
        await ctx.answerCbQuery();
        const lang = getLang(ctx);
        await ctx.editMessageText(t("helpContactText", lang), {
            parse_mode: "Markdown",
            ...Markup.inlineKeyboard([[Markup.button.callback(t("back", lang), "HELP")]]),
        });
    });

    // === USER PROFILE SECTION ===

    // /me command - User profile with order stats
    bot.command("me", async (ctx) => {
        const telegramId = String(ctx.from.id);
        const balance = await getBalance(ctx.from.id);

        // Get order stats
        const orders = await prisma.order.findMany({
            where: { odelegramId: telegramId },
        });

        const totalOrders = orders.length;
        const completedOrders = orders.filter(o => o.status === "DELIVERED").length;
        const totalSpent = orders
            .filter(o => o.status === "DELIVERED" || o.status === "PAID")
            .reduce((sum, o) => sum + o.finalAmount, 0);

        await ctx.reply(
            `👤 *THÔNG TIN TÀI KHOẢN*\n\n` +
            `🆔 ID: \`${telegramId}\`\n` +
            `💰 Số dư: *${balance.toLocaleString()}đ*\n\n` +
            `📊 *Thống kê:*\n` +
            `├ Tổng đơn: ${totalOrders}\n` +
            `├ Hoàn thành: ${completedOrders}\n` +
            `└ Tổng chi: ${totalSpent.toLocaleString()}đ`,
            {
                parse_mode: "Markdown",
                ...Markup.inlineKeyboard([
                    [Markup.button.callback("🛒 Mua hàng", "LIST_PRODUCTS")],
                    [Markup.button.callback("📦 Đơn hàng của tôi", "MY_ORDERS")],
                    [Markup.button.callback("📞 Hỗ trợ", "HELP:CONTACT")],
                    [Markup.button.callback("🔙 Menu", "BACK_HOME")],
                ]),
            }
        );
    });

    // MY_ORDERS - Show user's orders with clickable list
    bot.action("MY_ORDERS", async (ctx) => {
        await ctx.answerCbQuery();
        const telegramId = String(ctx.from.id);

        const orders = await prisma.order.findMany({
            where: { odelegramId: telegramId },
            include: { product: true },
            orderBy: { createdAt: "desc" },
            take: 10,
        });

        if (orders.length === 0) {
            await ctx.editMessageText(
                `📦 *ĐƠN HÀNG CỦA TÔI*\n\n📭 Bạn chưa có đơn hàng nào.`,
                {
                    parse_mode: "Markdown",
                    ...Markup.inlineKeyboard([
                        [Markup.button.callback("🛒 Mua ngay", "LIST_PRODUCTS")],
                        [Markup.button.callback("🔙 Menu", "BACK_HOME")],
                    ]),
                }
            );
            return;
        }

        const statusEmoji = { PENDING: "🟡", PAID: "🟢", DELIVERED: "✅", CANCELED: "❌" };

        let msg = `📦 *ĐƠN HÀNG CỦA TÔI*\n\n`;
        const buttons = [];

        for (const order of orders) {
            const emoji = statusEmoji[order.status] || "⚪";
            const shortId = order.id.slice(-6).toUpperCase();
            const date = order.createdAt.toLocaleDateString("vi-VN");
            msg += `${emoji} \`${shortId}\` - ${order.product?.name?.slice(0, 15) || "SP"} - ${order.finalAmount.toLocaleString()}đ\n`;
            buttons.push(Markup.button.callback(`${emoji} ${shortId}`, `ORDER:${order.id}`));
        }

        // Group buttons 3 per row
        const buttonRows = [];
        for (let i = 0; i < buttons.length; i += 3) {
            buttonRows.push(buttons.slice(i, i + 3));
        }
        buttonRows.push([Markup.button.callback("🛒 Mua thêm", "LIST_PRODUCTS")]);
        buttonRows.push([Markup.button.callback("🔙 Menu", "BACK_HOME")]);

        await ctx.editMessageText(msg, {
            parse_mode: "Markdown",
            ...Markup.inlineKeyboard(buttonRows),
        });
    });

    // ORDER detail - Show single order details
    bot.action(/^ORDER:(.+)$/, async (ctx) => {
        await ctx.answerCbQuery();
        const orderId = ctx.match[1];

        const order = await prisma.order.findUnique({
            where: { id: orderId },
            include: { product: true },
        });

        if (!order) {
            return ctx.reply("❌ Không tìm thấy đơn hàng");
        }

        const statusText = { PENDING: "🟡 Chờ thanh toán", PAID: "🟢 Đã thanh toán", DELIVERED: "✅ Đã giao", CANCELED: "❌ Đã huỷ" };

        await ctx.editMessageText(
            `📦 *CHI TIẾT ĐƠN HÀNG*\n\n` +
            `🆔 Mã: \`${order.id.slice(-8).toUpperCase()}\`\n` +
            `📦 SP: ${order.product?.name || "N/A"}\n` +
            `📊 SL: ${order.quantity}\n` +
            `💰 Tiền: ${order.finalAmount.toLocaleString()}đ\n` +
            `📋 TT: ${statusText[order.status]}\n` +
            `📅 Ngày: ${order.createdAt.toLocaleString("vi-VN")}`,
            {
                parse_mode: "Markdown",
                ...Markup.inlineKeyboard([
                    [Markup.button.callback("📦 Tất cả đơn", "MY_ORDERS")],
                    [Markup.button.callback("🔙 Menu", "BACK_HOME")],
                ]),
            }
        );
    });

    // === WALLET SECTION ===

    // /wallet command - quick access to wallet
    bot.command("wallet", async (ctx) => {
        const balance = await getBalance(ctx.from.id);

        await ctx.reply(
            `💰 *SỐ DƯ VÍ*\n\n` +
            `💵 Số dư: *${balance.toLocaleString()}đ*\n\n` +
            `Chọn số tiền nạp:`,
            {
                parse_mode: "Markdown",
                ...Markup.inlineKeyboard([
                    [
                        Markup.button.callback("50K", "DEPOSIT:50000"),
                        Markup.button.callback("100K", "DEPOSIT:100000"),
                        Markup.button.callback("200K", "DEPOSIT:200000"),
                    ],
                    [Markup.button.callback("500K", "DEPOSIT:500000"), Markup.button.callback("💎 Số khác", "DEPOSIT:CUSTOM")],
                    [Markup.button.callback("🔙 Menu", "BACK_HOME")],
                ]),
            }
        );
    });

    // Wallet - Show balance and deposit options
    bot.action("WALLET", async (ctx) => {
        await ctx.answerCbQuery();
        const balance = await getBalance(ctx.from.id);

        await ctx.editMessageText(
            `💰 *SỐ DƯ VÍ*\n\n` +
            `💵 Số dư hiện tại: *${balance.toLocaleString()}đ*\n\n` +
            `Chọn số tiền muốn nạp:`,
            {
                parse_mode: "Markdown",
                ...Markup.inlineKeyboard([
                    [
                        Markup.button.callback("50.000đ", "DEPOSIT:50000"),
                        Markup.button.callback("100.000đ", "DEPOSIT:100000"),
                    ],
                    [
                        Markup.button.callback("200.000đ", "DEPOSIT:200000"),
                        Markup.button.callback("500.000đ", "DEPOSIT:500000"),
                    ],
                    [Markup.button.callback("💎 Số khác", "DEPOSIT:CUSTOM")],
                    [Markup.button.callback("🔙 Quay lại", "BACK_HOME")],
                ]),
            }
        );
    });

    // Deposit - Create QR for deposit
    bot.action(/^DEPOSIT:(\d+)$/, async (ctx) => {
        await ctx.answerCbQuery("⏳ Đang tạo mã QR...");
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

        const msg = `💰 *NẠP TIỀN VÀO VÍ*\n${"─".repeat(25)}\n\n` +
            `💵 Số tiền: *${formatPrice(amount)}*\n` +
            `📝 Nội dung: \`${depositContent}\`\n\n` +
            `🏦 *${bankName}*\n` +
            `├ STK: \`${bankAccount}\`\n` +
            `└ Chủ TK: *${accountName}*\n\n` +
            `⚠️ *Lưu ý:*\n` +
            `├ Chuyển ĐÚNG số tiền\n` +
            `├ Ghi ĐÚNG nội dung\n` +
            `└ Hết hạn: *${expireMinutes} phút*\n\n` +
            `✅ Số dư cộng TỰ ĐỘNG trong 1-3 phút`;

        // Try to send QR image first
        try {
            await ctx.replyWithPhoto(
                { url: qrUrl },
                {
                    caption: msg,
                    parse_mode: "Markdown",
                    ...Markup.inlineKeyboard([
                        [Markup.button.url("📱 Mở QR để quét", qrUrl)],
                        [Markup.button.callback("🔙 Quay lại", "WALLET")],
                    ]),
                }
            );
            console.log("✅ QR image sent successfully");
        } catch (e) {
            console.log("❌ QR image failed, using visible text fallback:", e.message);
            // Fallback: Link text hiển thị rõ ràng
            await ctx.reply(
                msg + `\n\n🔗 [Bấm vào đây để mở mã QR](${qrUrl})`,
                {
                    parse_mode: "Markdown",
                    ...Markup.inlineKeyboard([
                        [Markup.button.url("📱 Mở QR để quét", qrUrl)],
                        [Markup.button.callback("🔙 Quay lại", "WALLET")],
                    ]),
                }
            );
        }
    });

    // ... (rest of code) ...

    // ... (rest of code) ...
    bot.action("DEPOSIT:CUSTOM", async (ctx) => {
        await ctx.answerCbQuery();

        sendLog("DEPOSIT", `User ${ctx.from.id} selected CUSTOM DEPOSIT`);

        ctx.session.pendingAction = "DEPOSIT_AMOUNT";

        await ctx.editMessageText(
            `💰 *NẠP TIỀN VÀO VÍ*\n\n` +
            `Nhập số tiền muốn nạp (tối thiểu 10.000đ):`,
            {
                parse_mode: "Markdown",
                ...Markup.inlineKeyboard([
                    [Markup.button.callback("❌ Huỷ", "WALLET")],
                ]),
            }
        );
    });

    // Transaction history
    bot.action("TX_HISTORY", async (ctx) => {
        await ctx.answerCbQuery();
        const transactions = await getTransactionHistory(ctx.from.id, 10);

        if (transactions.length === 0) {
            await ctx.editMessageText(
                `📊 *LỊCH SỬ GIAO DỊCH*\n\n` +
                `Chưa có giao dịch nào.`,
                {
                    parse_mode: "Markdown",
                    ...Markup.inlineKeyboard([
                        [Markup.button.callback("🔙 Quay lại", "BACK_HOME")],
                    ]),
                }
            );
            return;
        }

        let msg = `📊 *LỊCH SỬ GIAO DỊCH*\n\n`;
        for (const tx of transactions) {
            msg += formatTransaction(tx) + "\n\n";
        }

        await ctx.editMessageText(msg, {
            parse_mode: "Markdown",
            ...Markup.inlineKeyboard([
                [Markup.button.callback("🔙 Quay lại", "BACK_HOME")],
            ]),
        });
    });

    // Referral
    bot.action("REFERRAL", async (ctx) => {
        await ctx.answerCbQuery();
        const lang = getLang(ctx);

        const user = await prisma.user.findUnique({
            where: { telegramId: String(ctx.from.id) },
        });

        if (!user) return ctx.reply("❌ User not found");

        const stats = await getReferralStats(user.id);
        const botInfo = await bot.telegram.getMe();
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
        const lang = getLang(ctx);
        const products = await prisma.product.findMany({
            where: { isActive: true },
            orderBy: { createdAt: "desc" },
        });

        if (!products.length) {
            return {
                text: t("productEmpty", lang),
                keyboard: Markup.inlineKeyboard([[Markup.button.callback(t("back", lang), "BACK_HOME")]]),
                isEmpty: true
            };
        }

        const buttons = await Promise.all(
            products.map(async (p) => {
                let stockEmoji = "🟢"; // Default
                let stockCount = "∞";

                if (p.deliveryMode === "STOCK_LINES") {
                    const count = await getStockCount(p.id);
                    stockCount = String(count);
                    stockEmoji = count > 5 ? "🟢" : count > 0 ? "🟡" : "🔴";
                }

                return [Markup.button.callback(
                    `${stockEmoji} ${p.name} • ${formatPrice(p.price, p.currency)} (${stockCount})`,
                    `PRODUCT:${p.id}`
                )];
            })
        );

        buttons.push([Markup.button.callback(t("back", lang), "BACK_HOME")]);

        return {
            text: t("productList", lang) + "\n\n🟢 Còn hàng  🟡 Sắp hết  🔴 Hết",
            keyboard: Markup.inlineKeyboard(buttons),
            isEmpty: false
        };
    };

    // List products (Inline Action)
    bot.action("LIST_PRODUCTS", async (ctx) => {
        await ctx.answerCbQuery();
        const ui = await renderProductList(ctx);

        await ctx.editMessageText(ui.text, {
            parse_mode: "Markdown",
            ...ui.keyboard
        });
    });

    // ... (rest of code) ...

    bot.hears("🛒 Mua hàng", async (ctx) => {
        const ui = await renderProductList(ctx);
        await cleanReply(ctx, ui.text, {
            parse_mode: "Markdown",
            ...ui.keyboard
        });
    });

    // Product detail
    bot.action(/^PRODUCT:(.+)$/i, async (ctx) => {
        await ctx.answerCbQuery();
        const lang = getLang(ctx);
        const productId = ctx.match[1];

        const product = await prisma.product.findUnique({ where: { id: productId } });
        if (!product || !product.isActive) {
            return ctx.reply("❌ " + t("productOutOfStock", lang));
        }

        let stock = "∞";
        if (product.deliveryMode === "STOCK_LINES") {
            stock = String(await getStockCount(product.id));
        }

        await ctx.editMessageText(
            t("productDetail", lang, {
                name: product.name,
                price: formatPrice(product.price, product.currency),
                stock,
            }) + "\n\n" + t("selectQuantity", lang),
            {
                parse_mode: "Markdown",
                ...Markup.inlineKeyboard([
                    [1, 2, 3, 5, 10].map((q) => Markup.button.callback(String(q), `QTY:${product.id}:${q}`)),
                    [Markup.button.callback(t("back", lang), "LIST_PRODUCTS")],
                ]),
            }
        );
    });

    // Select quantity -> Ask for coupon
    bot.action(/^QTY:(.+):(\d+)$/i, async (ctx) => {
        await ctx.answerCbQuery();
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
        };

        await ctx.editMessageText(
            `📦 ${product.name} x${quantity}\n💰 ${formatPrice(product.price * quantity)}\n\n` +
            t("enterCoupon", lang),
            Markup.inlineKeyboard([
                [Markup.button.callback(t("skipCoupon", lang), "SKIP_COUPON")],
                [Markup.button.callback(t("cancel", lang), "LIST_PRODUCTS")],
            ])
        );
    });

    // Handle coupon input
    bot.on("text", async (ctx, next) => {
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
        await ctx.answerCbQuery();
        const order = ctx.session.pendingOrder;

        if (!order) return ctx.reply("❌ Session expired");

        order.discount = 0;
        order.finalAmount = order.amount;

        // Go directly to payment (VietQR only)
        await processPaymentFlow(ctx, order);
    });

    // Process payment - Check wallet first, then show options
    async function processPaymentFlow(ctx, orderData) {
        const lang = getLang(ctx);
        const user = await getOrCreateUser(ctx.from);
        const balance = await getBalance(ctx.from.id);

        // Store order data in session for later use
        ctx.session.pendingOrder = orderData;

        const productInfo = `📦 *Sản phẩm:* ${orderData.productName}\n` +
            `📊 *Số lượng:* ${orderData.quantity}\n` +
            `💰 *Tổng tiền:* ${formatPrice(orderData.finalAmount)}\n` +
            `💵 *Số dư ví:* ${balance.toLocaleString()}đ\n`;

        // Check if wallet has enough balance
        if (balance >= orderData.finalAmount) {
            // Wallet has enough - show option to pay with wallet or QR
            await ctx.reply(
                `✅ *XÁC NHẬN THANH TOÁN*\n\n` +
                productInfo + `\n` +
                `✅ Số dư đủ để thanh toán!\n\n` +
                `Chọn phương thức:`,
                {
                    parse_mode: "Markdown",
                    ...Markup.inlineKeyboard([
                        [Markup.button.callback("💰 Thanh toán bằng ví", "PAY_WALLET")],
                        [Markup.button.callback("🏦 Chuyển khoản QR", "PAY_QR")],
                        [Markup.button.callback("❌ Huỷ", "LIST_PRODUCTS")],
                    ]),
                }
            );
        } else {
            // Wallet not enough - show both options
            const missing = orderData.finalAmount - balance;
            await ctx.reply(
                `⚠️ *THANH TOÁN*\n\n` +
                productInfo + `\n` +
                `❌ Số dư không đủ! Cần thêm: *${missing.toLocaleString()}đ*\n\n` +
                `Chọn phương thức:`,
                {
                    parse_mode: "Markdown",
                    ...Markup.inlineKeyboard([
                        [Markup.button.callback("💳 Nạp tiền vào ví", "WALLET")],
                        [Markup.button.callback("🏦 Chuyển khoản QR trực tiếp", "PAY_QR")],
                        [Markup.button.callback("❌ Huỷ", "LIST_PRODUCTS")],
                    ]),
                }
            );
        }
    }

    // Pay with wallet
    bot.action("PAY_WALLET", async (ctx) => {
        try {
            await ctx.answerCbQuery();
            const lang = getLang(ctx);
            const orderData = ctx.session.pendingOrder;

            if (!orderData) {
                return ctx.reply("❌ Session hết hạn. Vui lòng đặt lại.");
            }

            const user = await getOrCreateUser(ctx.from);
            const balance = await getBalance(ctx.from.id);

            // Double check balance
            if (balance < orderData.finalAmount) {
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
                return ctx.reply("❌ Lỗi thanh toán: " + purchaseResult.error);
            }

            sendLog("ORDER", `✅ Order Success (Wallet): User ${ctx.from.id} bought ${orderData.productName} x${orderData.quantity} - ${formatPrice(orderData.finalAmount)}`);

            ctx.session.pendingOrder = null;

            // Delete the confirmation message
            await safeDelete(ctx);

            // Deliver order
            const { deliverOrder } = await import("./delivery.js");
            await deliverOrder({ prisma, bot, order });

            await ctx.reply(
                `✅ *THANH TOÁN THÀNH CÔNG!*\n\n` +
                `📦 SP: ${orderData.productName}\n` +
                `💰 Trừ: ${orderData.finalAmount.toLocaleString()}đ\n` +
                `💵 Còn: ${purchaseResult.newBalance.toLocaleString()}đ`,
                { parse_mode: "Markdown" }
            );
        } catch (err) {
            console.error("PAY_WALLET error:", err);
            sendLog("ERROR", `❌ PAY_WALLET failed: User ${ctx.from?.id} - ${err.message}`);
            await ctx.reply(
                `❌ *LỖI THANH TOÁN*\n\n` +
                `Chi tiết: ${err.message}\n\n` +
                `Vui lòng thử lại hoặc liên hệ Admin.`,
                { parse_mode: "Markdown" }
            ).catch(() => { });
        }
    });

    // Pay with QR (direct)
    bot.action("PAY_QR", async (ctx) => {
        await ctx.answerCbQuery();
        const lang = getLang(ctx);
        const orderData = ctx.session.pendingOrder;

        if (!orderData) {
            return ctx.reply("❌ Session hết hạn. Vui lòng đặt lại.");
        }

        const user = await getOrCreateUser(ctx.from);

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

        try {
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

            // Try to send QR image, fallback to text if fails
            console.log("📱 Order QR URL:", checkout.qrUrl);

            try {
                await ctx.replyWithPhoto(
                    { url: checkout.qrUrl },
                    {
                        caption: getPaymentMessage(checkout, lang),
                        parse_mode: "Markdown",
                        ...Markup.inlineKeyboard([
                            [Markup.button.url("📱 Mở QR để quét", checkout.qrUrl)],
                            [Markup.button.callback("❌ Huỷ đơn", `CANCEL:${order.id}`)],
                        ]),
                    }
                );
                console.log("✅ Order QR image sent successfully");
            } catch (qrError) {
                console.log("❌ Order QR image failed, using preview fallback:", qrError.message);

                // Smart Fallback with Preview
                await ctx.reply(
                    `[​​​​​​​​​​​](${checkout.qrUrl})` + getPaymentMessage(checkout, lang),
                    {
                        parse_mode: "Markdown",
                        disable_web_page_preview: false, // FORCE PREVIEW
                        ...Markup.inlineKeyboard([
                            [Markup.button.url("📱 Mở QR để quét", checkout.qrUrl)],
                            [Markup.button.callback("❌ Huỷ đơn", `CANCEL:${order.id}`)],
                        ]),
                    }
                );
            }

            // Remove redundant legacy message
        } catch (error) {
            console.error("PAY_QR error:", error);
            sendLog("ERROR", `❌ PAY_QR failed: User ${ctx.from?.id} - ${error.message}`);
            await prisma.order.update({
                where: { id: order.id },
                data: { status: "CANCELED" },
            });
            await ctx.reply(
                `❌ *LỖI TẠO THANH TOÁN*\n\n` +
                `Chi tiết: ${error.message}\n\n` +
                `Vui lòng thử lại hoặc liên hệ Admin.`,
                { parse_mode: "Markdown" }
            ).catch(() => { });
        }
    });

    // Cancel order
    bot.action(/^CANCEL:(.+)$/i, async (ctx) => {
        await ctx.answerCbQuery();
        const lang = getLang(ctx);
        const orderId = ctx.match[1];

        const order = await prisma.order.findUnique({ where: { id: orderId } });
        if (!order) return ctx.reply("❌ Không tìm thấy đơn hàng");
        if (order.odelegramId !== String(ctx.from.id)) return ctx.reply("❌ Không có quyền");
        if (order.status !== "PENDING") return ctx.reply("❌ Không thể huỷ đơn này");

        await prisma.order.update({
            where: { id: orderId },
            data: { status: "CANCELED" },
        });

        await ctx.editMessageText(
            t("orderCanceled", lang, { orderId: orderId.slice(-8) }),
            Markup.inlineKeyboard([[Markup.button.callback(t("menuProducts", lang), "LIST_PRODUCTS")]])
        );
    });

    // My orders
    bot.action("MY_ORDERS", async (ctx) => {
        await ctx.answerCbQuery();
        const lang = getLang(ctx);

        const orders = await prisma.order.findMany({
            where: { odelegramId: String(ctx.from.id) },
            orderBy: { createdAt: "desc" },
            take: 10,
            include: { product: true },
        });

        if (!orders.length) {
            return ctx.editMessageText(
                t("orderEmpty", lang),
                Markup.inlineKeyboard([
                    [Markup.button.callback(t("menuProducts", lang), "LIST_PRODUCTS")],
                    [Markup.button.callback(t("back", lang), "BACK_HOME")],
                ])
            );
        }

        const statusEmoji = { PENDING: "⏳", PAID: "💰", DELIVERED: "✅", CANCELED: "❌" };
        const lines = orders.map((o) => {
            const emoji = statusEmoji[o.status] || "❓";
            const date = o.createdAt.toLocaleDateString("vi-VN");
            return `${emoji} \`${o.id.slice(-8)}\` | ${o.product.name} x${o.quantity} | ${formatPrice(o.finalAmount)} | ${date}`;
        });

        await ctx.editMessageText(
            t("orderHistory", lang) + "\n\n" + lines.join("\n"),
            {
                parse_mode: "Markdown",
                ...Markup.inlineKeyboard([[Markup.button.callback(t("back", lang), "BACK_HOME")]]),
            }
        );
    });

    // Command: /order
    bot.command("order", async (ctx) => {
        const orderId = ctx.message.text.split(" ")[1];
        if (!orderId) return ctx.reply("Sử dụng: /order <mã_đơn>");

        const order = await prisma.order.findFirst({
            where: {
                OR: [{ id: orderId }, { id: { endsWith: orderId } }],
                odelegramId: String(ctx.from.id),
            },
            include: { product: true },
        });

        if (!order) return ctx.reply("❌ Không tìm thấy đơn hàng");

        const statusText = { PENDING: "⏳ Chờ thanh toán", PAID: "💰 Đã thanh toán", DELIVERED: "✅ Đã giao", CANCELED: "❌ Đã huỷ" };

        await ctx.reply(
            `📦 *Chi tiết đơn hàng*\n\n` +
            `🆔 Mã: \`${order.id}\`\n` +
            `📦 SP: ${order.product.name}\n` +
            `📊 SL: ${order.quantity}\n` +
            `💰 Tổng: ${formatPrice(order.finalAmount)}\n` +
            `📋 TT: ${statusText[order.status]}\n` +
            `📅 Ngày: ${order.createdAt.toLocaleString("vi-VN")}`,
            { parse_mode: "Markdown" }
        );
    });

    // Command: /help
    bot.command("help", async (ctx) => {
        const lang = getLang(ctx);

        await ctx.reply(t("helpTitle", lang), {
            parse_mode: "Markdown",
            ...Markup.inlineKeyboard([
                [Markup.button.callback(t("helpBuying", lang), "HELP:BUYING")],
                [Markup.button.callback(t("helpPayment", lang), "HELP:PAYMENT")],
                [Markup.button.callback(t("helpReferralGuide", lang), "HELP:REFERRAL")],
                [Markup.button.callback(t("helpContact", lang), "HELP:CONTACT")],
                [Markup.button.callback(t("back", lang), "BACK_HOME")],
            ]),
        });
    });

    // === REPLY KEYBOARD HANDLERS ===
    // Handle button presses from persistent keyboard
    // Delete BOTH user's button press AND previous bot message for cleaner chat

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
            parse_mode: "Markdown",
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

        if (orders.length === 0) {
            return cleanReply(ctx, "📭 *Chưa có đơn hàng*\n\n_Hãy mua sản phẩm đầu tiên!_", { parse_mode: "Markdown", ...Markup.inlineKeyboard([[Markup.button.callback("🛒 Mua ngay", "LIST_PRODUCTS")]]) });
        }

        const statusEmoji = { PENDING: "⏳", PAID: "💰", DELIVERED: "✅", CANCELED: "❌" };
        let msg = `📦 *ĐƠN HÀNG GẦN ĐÂY*\n${"─".repeat(20)}\n`;
        for (const order of orders) {
            const emoji = statusEmoji[order.status] || "⚪";
            const date = new Date(order.createdAt).toLocaleDateString("vi-VN");
            msg += `${emoji} \`${order.id.slice(-6).toUpperCase()}\` • ${formatPrice(order.finalAmount)}\n   └ _${order.product?.name?.slice(0, 20) || "SP"} • ${date}_\n`;
        }
        await cleanReply(ctx, msg, { parse_mode: "Markdown" });
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
        const balance = await getBalance(ctx.from.id);
        const orders = await prisma.order.findMany({ where: { odelegramId: telegramId } });
        const totalOrders = orders.length;
        const completedOrders = orders.filter(o => o.status === "DELIVERED").length;
        const totalSpent = orders.filter(o => o.status === "DELIVERED" || o.status === "PAID").reduce((sum, o) => sum + o.finalAmount, 0);

        const vipEmoji = totalSpent > 1000000 ? "💎" : totalSpent > 500000 ? "🥇" : totalSpent > 100000 ? "🥈" : "🥉";

        await cleanReply(ctx,
            `👤 *TÀI KHOẢN CỦA TÔI*\n${"─".repeat(20)}\n\n` +
            `🆔 ID: \`${telegramId}\`\n` +
            `💰 Số dư: *${formatPrice(balance)}*\n\n` +
            `${vipEmoji} *Thống kê*\n` +
            `├ 📦 Đơn hàng: ${totalOrders}\n` +
            `├ ✅ Hoàn thành: ${completedOrders}\n` +
            `└ 💵 Tổng chi: *${formatPrice(totalSpent)}*`,
            { parse_mode: "Markdown" }
        );
    });

    bot.hears("❓ Hỗ trợ", async (ctx) => {
        const lang = getLang(ctx);
        await cleanReply(ctx, t("helpTitle", lang), {
            parse_mode: "Markdown",
            ...Markup.inlineKeyboard([
                [Markup.button.callback(t("helpBuying", lang), "HELP:BUYING")],
                [Markup.button.callback(t("helpWallet", lang), "HELP:WALLET")],
                [Markup.button.callback(t("helpContact", lang), "HELP:CONTACT")],
            ]),
        });
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
                return ctx.reply("❌ Số tiền không hợp lệ. Tối thiểu 10.000đ. Nhập lại:");
            }

            ctx.session.pendingAction = null;

            // Create pending deposit transaction
            const tx = await createDeposit(ctx.from.id, amount);
            const depositContent = generateDepositContent(ctx.from.id, tx.id);
            const qrUrl = generateQRUrl(amount, depositContent);

            const expireMinutes = getExpireMinutes();

            const msg = `💰 *NẠP TIỀN VÀO VÍ*\n\n` +
                `💵 Số tiền: *${amount.toLocaleString()}đ*\n` +
                `📝 Nội dung CK: \`${depositContent}\`\n\n` +
                `🏦 Ngân hàng: *MBBank*\n` +
                `🔢 STK: \`${process.env.BANK_ACCOUNT || "321336"}\`\n` +
                `👤 Chủ TK: *${process.env.BANK_ACCOUNT_NAME || "PHAM VAN VIET"}*\n\n` +
                `⚠️ *LƯU Ý:*\n` +
                `• Chuyển ĐÚNG SỐ TIỀN\n` +
                `• Ghi ĐÚNG NỘI DUNG\n` +
                `• Đơn hết hạn sau ${expireMinutes} phút\n\n` +
                `✅ Sau khi chuyển khoản, số dư sẽ được cộng TỰ ĐỘNG trong 1-3 phút.`;

            try {
                await ctx.replyWithPhoto(qrUrl, {
                    caption: msg,
                    parse_mode: "Markdown",
                    ...Markup.inlineKeyboard([
                        [Markup.button.callback("🔙 Quay lại", "WALLET")],
                    ]),
                });
            } catch (e) {
                // Fallback: Link text hiển thị rõ ràng
                await ctx.reply(
                    msg + `\n\n🔗 [Bấm vào đây để mở mã QR](${qrUrl})`,
                    {
                        parse_mode: "Markdown",
                        ...Markup.inlineKeyboard([
                            [Markup.button.url("📱 Mở QR", qrUrl)],
                            [Markup.button.callback("🔙 Quay lại", "WALLET")],
                        ]),
                    }
                );
            }
            return;
        }

        // Pass to next handler if not handled
        return next();
    });

    return bot;
}
