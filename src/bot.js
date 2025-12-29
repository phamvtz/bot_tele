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

/**
 * Create and configure the Telegram bot v3
 * VietQR payment only
 */
export function createBot({ paymentProvider }) {
    const bot = new Telegraf(process.env.BOT_TOKEN);

    // Session middleware
    bot.use(session({ defaultSession: () => ({ language: "vi", pendingOrder: null }) }));

    // Rate limiting middleware
    bot.use(rateLimitMiddleware());

    // Error handling
    bot.catch((err, ctx) => {
        console.error(`Bot error for ${ctx.updateType}:`, err);
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

        await ctx.reply(
            t("welcome", lang, { name: userName }) + "\n\n" +
            t("shopName", lang) + "\n" +
            `💰 Số dư: ${balance.toLocaleString()}đ\n\n` +
            t("selectOption", lang),
            Markup.inlineKeyboard([
                [Markup.button.callback("🛒 Mua hàng", "LIST_PRODUCTS")],
                [Markup.button.callback("💰 Số dư & Nạp tiền", "WALLET")],
                [Markup.button.callback("📦 Đơn hàng của tôi", "MY_ORDERS")],
                [Markup.button.callback("📊 Lịch sử giao dịch", "TX_HISTORY")],
                [
                    Markup.button.callback("🎁 Giới thiệu", "REFERRAL"),
                    Markup.button.callback("❓ Trợ giúp", "HELP"),
                ],
            ])
        );
    });

    // Back to home
    bot.action("BACK_HOME", async (ctx) => {
        await ctx.answerCbQuery();
        const lang = getLang(ctx);
        const balance = await getBalance(ctx.from.id);

        await ctx.editMessageText(
            t("shopName", lang) + "\n" +
            `💰 Số dư: ${balance.toLocaleString()}đ\n\n` +
            t("selectOption", lang),
            Markup.inlineKeyboard([
                [Markup.button.callback("🛒 Mua hàng", "LIST_PRODUCTS")],
                [Markup.button.callback("💰 Số dư & Nạp tiền", "WALLET")],
                [Markup.button.callback("📦 Đơn hàng của tôi", "MY_ORDERS")],
                [Markup.button.callback("📊 Lịch sử giao dịch", "TX_HISTORY")],
                [
                    Markup.button.callback("🎁 Giới thiệu", "REFERRAL"),
                    Markup.button.callback("❓ Trợ giúp", "HELP"),
                ],
            ])
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

    // === WALLET SECTION ===

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
        await ctx.answerCbQuery();
        const amount = parseInt(ctx.match[1], 10);

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
            // Fallback to text if QR fails
            await ctx.reply(msg, {
                parse_mode: "Markdown",
                ...Markup.inlineKeyboard([
                    [Markup.button.callback("🔙 Quay lại", "WALLET")],
                ]),
            });
        }
    });

    // Deposit custom amount - ask for input
    bot.action("DEPOSIT:CUSTOM", async (ctx) => {
        await ctx.answerCbQuery();
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

    // List products
    bot.action("LIST_PRODUCTS", async (ctx) => {
        await ctx.answerCbQuery();
        const lang = getLang(ctx);

        const products = await prisma.product.findMany({
            where: { isActive: true },
            orderBy: { createdAt: "desc" },
        });

        if (!products.length) {
            return ctx.editMessageText(
                t("productEmpty", lang),
                Markup.inlineKeyboard([[Markup.button.callback(t("back", lang), "BACK_HOME")]])
            );
        }

        const buttons = await Promise.all(
            products.map(async (p) => {
                let label = `🧾 ${p.name} - ${formatPrice(p.price, p.currency)}`;
                if (p.deliveryMode === "STOCK_LINES") {
                    const stock = await getStockCount(p.id);
                    label += ` (${stock})`;
                }
                return [Markup.button.callback(label, `PRODUCT:${p.id}`)];
            })
        );

        buttons.push([Markup.button.callback(t("back", lang), "BACK_HOME")]);

        await ctx.editMessageText(t("productList", lang), {
            parse_mode: "Markdown",
            ...Markup.inlineKeyboard(buttons),
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

        ctx.session.pendingOrder = null;

        // Deliver order
        const { deliverOrder } = await import("./delivery.js");
        await deliverOrder({ prisma, bot: ctx.telegram, order });

        await ctx.reply(
            `✅ *THANH TOÁN THÀNH CÔNG!*\n\n` +
            `📦 Sản phẩm: ${orderData.productName}\n` +
            `💰 Đã trừ: ${orderData.finalAmount.toLocaleString()}đ\n` +
            `💵 Số dư còn: ${purchaseResult.newBalance.toLocaleString()}đ\n\n` +
            `📦 Đơn hàng đang được giao...`,
            { parse_mode: "Markdown" }
        );
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
            try {
                await ctx.replyWithPhoto(checkout.qrUrl, {
                    caption: getPaymentMessage(checkout, lang),
                    parse_mode: "Markdown",
                });
            } catch (qrError) {
                console.log("QR image failed, sending text instead:", qrError.message);
                await ctx.reply(getPaymentMessage(checkout, lang), {
                    parse_mode: "Markdown",
                });
            }

            // Send order ID and cancel button
            await ctx.reply(
                `🆔 Mã đơn: \`${order.id.slice(-8)}\`\n⏰ Hết hạn sau ${getExpireMinutes()} phút`,
                {
                    parse_mode: "Markdown",
                    ...Markup.inlineKeyboard([
                        [Markup.button.callback("❌ Huỷ đơn", `CANCEL:${order.id}`)],
                    ]),
                }
            );
        } catch (error) {
            console.error("Payment error:", error);
            await prisma.order.update({
                where: { id: order.id },
                data: { status: "CANCELED" },
            });
            await ctx.reply("❌ Lỗi tạo thanh toán: " + error.message);
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
                await ctx.reply(msg, {
                    parse_mode: "Markdown",
                    ...Markup.inlineKeyboard([
                        [Markup.button.callback("🔙 Quay lại", "WALLET")],
                    ]),
                });
            }
            return;
        }

        // Pass to next handler if not handled
        return next();
    });

    return bot;
}
