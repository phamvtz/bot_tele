import { prisma } from "./db.js";
import { logAction, Actions } from "./audit.js";
import { formatUsdPrimary, liveUsdVndRate } from "./money-display.js";
import { isOrderBotBroadcastEnabled } from "./shop-config.js";
import { getProductDeepLink } from "./telegram-links.js";
import { DEFAULT_ICONS, getMenuIconIds, getMenuIcons, iconOf } from "./menu-config.js";
import { isOrderNotificationMuted } from "./order-notifications.js";
import { formatTokens } from "./apikey-pricing.js";
import { getProfiles } from "./gpt2api.js";

/**
 * Broadcast Module
 * Send mass notifications to all users
 */

const ADMIN_IDS = (process.env.ADMIN_IDS || "").split(",").map(id => id.trim()).filter(Boolean);

/**
 * Send broadcast message to all users
 */
export async function sendBroadcast(bot, message, adminId) {
    const users = await prisma.user.findMany({
        where: { isBlocked: false },
        select: { telegramId: true },
    });

    // Create broadcast log record — non-fatal if table doesn't exist
    let broadcastId = null;
    try {
        const record = await prisma.broadcast.create({ data: { message, status: "SENDING" } });
        broadcastId = record.id;
    } catch (_) {}

    let sentCount = 0;
    let failCount = 0;

    for (const user of users) {
        try {
            await bot.telegram.sendMessage(user.telegramId, message, {
                parse_mode: "HTML",
                disable_web_page_preview: true,
            });
            sentCount++;
            await sleep(50);
        } catch (error) {
            if (error.code === 429) {
                const retryAfter = (error.parameters?.retry_after || 5) * 1000;
                await sleep(retryAfter);
                try {
                    await bot.telegram.sendMessage(user.telegramId, message, {
                        parse_mode: "HTML",
                        disable_web_page_preview: true,
                    });
                    sentCount++;
                } catch (_) { failCount++; }
                continue;
            }
            failCount++;
            console.log(`[broadcast] Failed to send to ${user.telegramId}:`, error.message);
            if (error.code === 403) {
                await prisma.user.update({
                    where: { telegramId: user.telegramId },
                    data: { isBlocked: true },
                });
            }
        }
    }

    // Update log record — non-fatal
    if (broadcastId) {
        try {
            await prisma.broadcast.update({
                where: { id: broadcastId },
                data: { sentCount, failCount, status: "COMPLETED" },
            });
        } catch (_) {}
    }

    try { await logAction(adminId, Actions.BROADCAST, null, { sentCount, failCount, total: users.length }); } catch (_) {}

    return { sentCount, failCount, total: users.length };
}

/**
 * Broadcast a photo + caption to all users
 */
export async function sendBroadcastPhoto(bot, fileId, caption, adminId) {
    const users = await prisma.user.findMany({
        where: { isBlocked: false },
        select: { telegramId: true },
    });

    let sentCount = 0;
    let failCount = 0;

    for (const user of users) {
        try {
            await bot.telegram.sendPhoto(user.telegramId, fileId, {
                caption: caption || "",
                parse_mode: "HTML",
            });
            sentCount++;
            await sleep(50);
        } catch (error) {
            if (error.code === 429) {
                const retryAfter = (error.parameters?.retry_after || 5) * 1000;
                await sleep(retryAfter);
                try {
                    await bot.telegram.sendPhoto(user.telegramId, fileId, {
                        caption: caption || "",
                        parse_mode: "HTML",
                    });
                    sentCount++;
                } catch (_) { failCount++; }
                continue;
            }
            if (error.code === 403) {
                await prisma.user.update({
                    where: { telegramId: user.telegramId },
                    data: { isBlocked: true },
                });
            }
            failCount++;
        }
    }

    try { await logAction(adminId, Actions.BROADCAST, "PHOTO", { sentCount, failCount, total: users.length }); } catch (_) {}

    return { sentCount, failCount, total: users.length };
}

/**
 * Get broadcast history
 */
export async function getBroadcastHistory(limit = 10) {
    return await prisma.broadcast.findMany({
        orderBy: { createdAt: "desc" },
        take: limit,
    });
}

/**
 * Send targeted broadcast to VIP users only
 */
export async function sendVipBroadcast(bot, message, minLevel = 1, adminId) {
    const users = await prisma.user.findMany({
        where: {
            isBlocked: false,
            vipLevel: { gte: minLevel },
        },
        select: { telegramId: true },
    });

    let sentCount = 0;
    let failCount = 0;

    for (const user of users) {
        try {
            await bot.telegram.sendMessage(user.telegramId, `${iconOf("BROADCAST_VIP")} *Thông báo VIP*\n\n${message}`, {
                parse_mode: "Markdown",
                disable_web_page_preview: true,
            });
            sentCount++;
            await sleep(50);
        } catch (error) {
            if (error.code === 429) {
                const retryAfter = (error.parameters?.retry_after || 5) * 1000;
                await sleep(retryAfter);
                try {
                    await bot.telegram.sendMessage(user.telegramId, `${iconOf("BROADCAST_VIP")} *Thông báo VIP*\n\n${message}`, {
                        parse_mode: "Markdown",
                        disable_web_page_preview: true,
                    });
                    sentCount++;
                } catch (_) { failCount++; }
                continue;
            }
            if (error.code === 403) {
                await prisma.user.update({
                    where: { telegramId: user.telegramId },
                    data: { isBlocked: true },
                });
            }
            failCount++;
        }
    }

    await logAction(adminId, Actions.BROADCAST, `VIP_${minLevel}`, { sentCount, failCount });

    return { sentCount, failCount, total: users.length };
}

function escapeHtml(str) {
    return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Broadcast stock restock notification to all users with photo + caption if available
 */
export async function broadcastStockNotify(bot, productName, productId, addedCount, currentStock, imageSource = null) {
    let botUsername = bot.botInfo?.username || process.env.TELEGRAM_BOT_USERNAME || "";
    if (!botUsername) {
        try { const me = await bot.telegram.getMe(); botUsername = me.username || ""; } catch (_) {}
    }
    const shopUrl = botUsername ? `https://t.me/${botUsername}?start=product_${productId}` : null;

    const safeName = escapeHtml(productName);
    // Dùng bộ key riêng nhóm "Nhập kho" để admin đổi được từng icon trong panel
    // (trước đây dùng chung RESTOCK/ORDER_PRODUCT/ADMIN_ADD/FIELD_SOLD nên sửa 1 icon
    // sẽ ảnh hưởng cả tin nhắn khác).
    const text = `${iconOf("RESTOCK_TITLE")} <b>Kho hàng vừa được bổ sung!</b>\n\n${iconOf("RESTOCK_PRODUCT")} <b>${safeName}</b>\n${iconOf("RESTOCK_ADDED")} Thêm: <b>${addedCount}</b> dòng\n${iconOf("RESTOCK_TOTAL")} Tồn kho hiện tại: <b>${currentStock}</b>`;

    const replyMarkup = shopUrl
        ? { inline_keyboard: [[{ text: `${iconOf("LIST_PRODUCTS")} Mua ngay`, url: shopUrl }]] }
        : undefined;

    const users = await prisma.user.findMany({
        where: { isBlocked: false },
        select: { telegramId: true },
    });

    console.log(`[broadcastStockNotify] Bắt đầu gửi tới ${users.length} users — SP: ${productName} — ảnh: ${imageSource ? "có" : "không"}`);

    let sentCount = 0;
    let failCount = 0;
    let firstError = null;

    for (const user of users) {
        try {
            if (imageSource) {
                await bot.telegram.sendPhoto(user.telegramId, imageSource, {
                    caption: text,
                    parse_mode: "HTML",
                    ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
                });
            } else {
                await bot.telegram.sendMessage(user.telegramId, text, {
                    parse_mode: "HTML",
                    ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
                });
            }
            sentCount++;
            await sleep(50);
        } catch (error) {
            if (!firstError) firstError = error;
            if (error.code === 429) {
                const retryAfter = (error.parameters?.retry_after || 5) * 1000;
                await sleep(retryAfter);
                try {
                    if (imageSource) {
                        await bot.telegram.sendPhoto(user.telegramId, imageSource, {
                            caption: text, parse_mode: "HTML",
                            ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
                        });
                    } else {
                        await bot.telegram.sendMessage(user.telegramId, text, {
                            parse_mode: "HTML",
                            ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
                        });
                    }
                    sentCount++;
                } catch (_) { failCount++; }
                continue;
            }
            if (error.code === 403) {
                await prisma.user.update({
                    where: { telegramId: user.telegramId },
                    data: { isBlocked: true },
                });
            }
            failCount++;
        }
    }

    console.log(`[broadcastStockNotify] Xong: sent=${sentCount} fail=${failCount}${firstError ? ` firstError=${firstError.message}` : ""}`);
    return { sentCount, failCount, total: users.length };
}

/**
 * Che tên người mua để bảo vệ riêng tư: nguyenhuy -> ngu***.
 */
export function maskBuyerName(name) {
    const chars = Array.from(String(name || "").trim().replace(/^@/, "") || "user");
    return `${chars.slice(0, Math.min(3, chars.length)).join("")}***`;
}

const ORDER_BROADCAST_COPY = {
    vi: {
        title: "ĐƠN HÀNG MỚI!",
        purchased: "vừa mua đơn",
        price: "Giá",
        delivery: "Giao tự động trong vài giây!",
        urgency: "Số lượng có hạn — mua ngay kẻo hết!",
        buy: "Mua",
        deposit: "Nạp tiền",
        mute: "Tắt thông báo 1 ngày",
        server: "Server",
        apikeySpec: ({ tokens, rpm, validDays }) => [
            `${formatTokens(tokens)} token`,
            rpm > 0 ? `RPM ${rpm}` : null,
            validDays > 0 ? `${validDays} ngày` : "không hết hạn",
        ].filter(Boolean).join(" · "),
    },
    en: {
        title: "NEW ORDER!",
        purchased: "just purchased",
        price: "Price",
        delivery: "Automatic delivery in a few seconds!",
        urgency: "Limited availability — order before it runs out!",
        buy: "Buy",
        deposit: "Deposit",
        mute: "Mute for 1 day",
        server: "Server",
        apikeySpec: ({ tokens, rpm, validDays }) => [
            `${formatTokens(tokens)} tokens`,
            rpm > 0 ? `RPM ${rpm}` : null,
            validDays > 0 ? `${validDays} days` : "no expiry",
        ].filter(Boolean).join(" · "),
    },
    zh: {
        title: "新订单！",
        purchased: "刚刚购买了",
        price: "价格",
        delivery: "几秒内自动发货！",
        urgency: "数量有限，请及时购买！",
        buy: "购买",
        deposit: "充值",
        mute: "静音一天",
        server: "服务器",
        apikeySpec: ({ tokens, rpm, validDays }) => [
            `${formatTokens(tokens)} token`,
            rpm > 0 ? `RPM ${rpm}` : null,
            validDays > 0 ? `${validDays} 天` : "永不过期",
        ].filter(Boolean).join(" · "),
    },
};

function orderBroadcastCopy(lang = "vi") {
    return ORDER_BROADCAST_COPY[lang] || ORDER_BROADCAST_COPY.vi;
}

/**
 * Thân tin "ĐƠN HÀNG MỚI". Tách riêng cho test được mà không cần Telegram/DB
 * (giống buildGiftRedeemMessage) — `masked`/`safeName` đã escape sẵn ở caller.
 *
 * `serverName` rỗng = KHÔNG hiện dòng server. Caller quyết định: tên chỉ có
 * nghĩa khi shop mở nhiều server, một server thì đó chỉ là chữ thừa.
 */
export function buildNewOrderText({
    lang = "vi", masked = "", safeName = "", quantity = 1,
    price = 0, currency = "VND", apikey = null, serverName = "",
} = {}) {
    const copy = orderBroadcastCopy(lang);
    const priceText = escapeHtml(formatUsdPrimary(price, currency, { lang: lang || "vi", rate: liveUsdVndRate() }));
    const quantityText = Number(quantity) > 1 ? ` × ${Number(quantity)}` : "";
    const apikeyLine = apikey && apikey.tokens > 0
        ? `${iconOf("APIKEY_QUOTA")} ${escapeHtml(copy.apikeySpec(apikey))}\n`
        : "";
    // Mỗi server một nhóm model + một giá, nên đây là thông tin bán hàng thật:
    // người xem biết đơn vừa rồi là của server nào.
    const serverLine = serverName
        ? `${iconOf("APIKEY_BUY")} ${copy.server}: <b>${escapeHtml(serverName)}</b>\n`
        : "";
    return `${iconOf("SOCIAL_PROOF")} <b>${copy.title}</b>\n\n`
        + `${iconOf("ACCOUNT")} <b>${masked}</b> ${copy.purchased} “<b>${safeName}</b>”${quantityText}\n`
        + `${iconOf("FIELD_PRICE")} ${copy.price}: <b>${priceText}</b>\n`
        + apikeyLine
        + serverLine
        + `${iconOf("ORDER_DELIVERY")} ${copy.delivery}\n`
        + `${iconOf("LIST_PRODUCTS")} ${copy.urgency}`;
}

/**
 * Broadcast thông báo "ĐƠN HÀNG MỚI" tới tất cả user (trừ người mua và những
 * ai đã tắt thông báo). Chạy nền (fire-and-forget) — KHÔNG await trong luồng giao hàng.
 *
 * @param {{telegram: object}} botLike - object có .telegram (giống trong delivery.js)
 * @param {object} info - { productName, productId, quantity, price, currency, buyerName, buyerTelegramId }
 */
export async function broadcastNewOrder(botLike, info) {
    if (!(await isOrderBotBroadcastEnabled())) return { skipped: true };
    const telegram = botLike?.telegram;
    if (!telegram) return { skipped: true };

    const {
        productName = "Sản phẩm", productId = "", quantity = 1,
        price = 0, currency = "VND", buyerName = "", buyerTelegramId = "",
        buyUrl = null, apikey = null,
    } = info || {};

    const masked = escapeHtml(maskBuyerName(buyerName));
    const safeName = escapeHtml(productName);
    // buyUrl override (vd deep link Claude Key). Nếu không có thì dùng deep link sản phẩm.
    const productUrl = buyUrl || (productId ? await getProductDeepLink(telegram, productId) : null);
    const hasBuyTarget = !!(productUrl || productId);

    // Tên server chỉ có nghĩa khi shop mở NHIỀU server — một server thì tên
    // ("Mặc định") chỉ làm tin dài thêm mà không nói lên điều gì. Hỏi một lần cho
    // cả đợt broadcast, không phải mỗi người nhận; getProfiles đọc cache 30s.
    const serverName = String(apikey?.server || "").trim();
    const showServer = serverName
        ? await getProfiles().then((list) => (list?.length || 0) > 1).catch(() => false)
        : false;

    const now = Date.now();
    const [users, menuIcons, menuIconIds] = await Promise.all([
        prisma.user.findMany({
            where: { isBlocked: false },
            select: { telegramId: true, notifyMutedUntil: true, language: true },
        }),
        getMenuIcons(),
        getMenuIconIds(),
    ]);
    const configuredButton = (action, label, target) => {
        const id = menuIconIds[action];
        return {
            text: id ? label : `${menuIcons[action] ?? DEFAULT_ICONS[action] ?? ""} ${label}`.trim(),
            ...target,
            ...(id ? { icon_custom_emoji_id: id } : {}),
        };
    };

    let sentCount = 0;
    let failCount = 0;
    for (const user of users) {
        // Bỏ qua người mua và người đã tắt thông báo (mute còn hiệu lực)
        if (String(user.telegramId) === String(buyerTelegramId)) continue;
        if (isOrderNotificationMuted(user.notifyMutedUntil, now)) continue;

        const copy = orderBroadcastCopy(user.language);
        const text = buildNewOrderText({
            lang: user.language, masked, safeName, quantity, price, currency,
            apikey, serverName: showServer ? serverName : "",
        });
        const buyLabel = `${copy.buy} ${productName}`.slice(0, 40);
        const reply_markup = {
            inline_keyboard: [
                hasBuyTarget ? [configuredButton(
                    "BROADCAST_BUY",
                    buyLabel,
                    productUrl ? { url: productUrl } : { callback_data: `product:${productId}` },
                )] : [],
                [configuredButton("WALLET_DEPOSIT", copy.deposit, { callback_data: "WALLET" })],
                [configuredButton("MUTE_NOTIFY", copy.mute, { callback_data: "MUTE_ORDER_NOTIFY" })],
            ].filter(row => row.length),
        };

        try {
            await telegram.sendMessage(user.telegramId, text, { parse_mode: "HTML", reply_markup });
            sentCount++;
            await sleep(50);
        } catch (error) {
            if (error.code === 429) {
                const retryAfter = (error.parameters?.retry_after || 5) * 1000;
                await sleep(retryAfter);
                try {
                    await telegram.sendMessage(user.telegramId, text, { parse_mode: "HTML", reply_markup });
                    sentCount++;
                } catch (_) { failCount++; }
                continue;
            }
            if (error.code === 403) {
                await prisma.user.update({ where: { telegramId: user.telegramId }, data: { isBlocked: true } }).catch(() => {});
            }
            failCount++;
        }
    }
    return { sentCount, failCount, total: users.length };
}

const GIFT_BROADCAST_COPY = {
    vi: {
        title: "CÓ NGƯỜI NHẬN QUÀ!",
        got: "vừa nhận quà",
        reward: "Phần thưởng",
        apikey: (t) => `API key ${t} token miễn phí`,
        wallet: "Quà tặng vào ví",
        cta: "Nhập GIFTCODE ngay",
        mute: "Tắt thông báo 1 ngày",
    },
    en: {
        title: "SOMEONE GOT A GIFT!",
        got: "just claimed a gift",
        reward: "Reward",
        apikey: (t) => `${t} tokens free API key`,
        wallet: "Wallet gift",
        cta: "Enter a GIFTCODE",
        mute: "Mute for 1 day",
    },
    zh: {
        title: "有人领取了礼物！",
        got: "刚刚领取了礼物",
        reward: "奖励",
        apikey: (t) => `${t} token 免费 API 密钥`,
        wallet: "钱包礼物",
        cta: "立即输入礼品码",
        mute: "静音一天",
    },
};

function giftBroadcastCopy(lang = "vi") {
    return GIFT_BROADCAST_COPY[lang] || GIFT_BROADCAST_COPY.vi;
}

/**
 * Dựng nội dung + bàn phím cho broadcast "nhận quà". THUẦN (không I/O) để test —
 * `button` là hàm dựng nút (inject để đỡ phụ thuộc menu-config trong test).
 */
export function buildGiftRedeemMessage({ rewardType = "WALLET", quotaTokens = 0, receiverName = "", lang = "vi" } = {}, button = (_a, label, target) => ({ text: label, ...target })) {
    const copy = giftBroadcastCopy(lang);
    const masked = escapeHtml(maskBuyerName(receiverName));
    const rewardText = rewardType === "APIKEY"
        ? copy.apikey(formatTokens(quotaTokens))
        : copy.wallet;
    const text = `${iconOf("SOCIAL_PROOF_GIFT")} <b>${copy.title}</b>\n\n`
        + `${iconOf("ACCOUNT")} <b>${masked}</b> ${copy.got}\n`
        + `${iconOf("APIKEY_QUOTA")} ${copy.reward}: <b>${escapeHtml(rewardText)}</b>`;
    const reply_markup = {
        inline_keyboard: [
            [button("REDEEM_GIFTCODE", copy.cta, { callback_data: "REDEEM_GIFTCODE" })],
            [button("MUTE_NOTIFY", copy.mute, { callback_data: "MUTE_ORDER_NOTIFY" })],
        ],
    };
    return { text, reply_markup };
}

/**
 * Broadcast "CÓ NGƯỜI NHẬN QUÀ" tới tất cả user khi có người đổi giftcode thành
 * công. KHÁC broadcastNewOrder: đây là quà (miễn phí), không phải đơn mua — dùng
 * từ "nhận quà", không "mua đơn".
 *
 * Gate và mute DÙNG CHUNG với broadcast đơn hàng (isOrderBotBroadcastEnabled +
 * notifyMutedUntil) — user đã tắt thông báo hype thì tắt cả hai loại.
 *
 * @param {{telegram: object}} botLike
 * @param {object} info - { rewardType, quotaTokens, receiverName, receiverTelegramId }
 */
export async function broadcastGiftRedeem(botLike, info) {
    if (!(await isOrderBotBroadcastEnabled())) return { skipped: true };
    const telegram = botLike?.telegram;
    if (!telegram) return { skipped: true };

    const {
        rewardType = "WALLET", quotaTokens = 0,
        receiverName = "", receiverTelegramId = "",
    } = info || {};

    const now = Date.now();
    const [users, menuIcons, menuIconIds] = await Promise.all([
        prisma.user.findMany({
            where: { isBlocked: false },
            select: { telegramId: true, notifyMutedUntil: true, language: true },
        }),
        getMenuIcons(),
        getMenuIconIds(),
    ]);
    const configuredButton = (action, label, target) => {
        const id = menuIconIds[action];
        return {
            text: id ? label : `${menuIcons[action] ?? DEFAULT_ICONS[action] ?? ""} ${label}`.trim(),
            ...target,
            ...(id ? { icon_custom_emoji_id: id } : {}),
        };
    };

    let sentCount = 0;
    let failCount = 0;
    for (const user of users) {
        if (String(user.telegramId) === String(receiverTelegramId)) continue;
        if (isOrderNotificationMuted(user.notifyMutedUntil, now)) continue;

        const { text, reply_markup } = buildGiftRedeemMessage(
            { rewardType, quotaTokens, receiverName, lang: user.language },
            configuredButton,
        );

        try {
            await telegram.sendMessage(user.telegramId, text, { parse_mode: "HTML", reply_markup });
            sentCount++;
            await sleep(50);
        } catch (error) {
            if (error.code === 429) {
                const retryAfter = (error.parameters?.retry_after || 5) * 1000;
                await sleep(retryAfter);
                try {
                    await telegram.sendMessage(user.telegramId, text, { parse_mode: "HTML", reply_markup });
                    sentCount++;
                } catch (_) { failCount++; }
                continue;
            }
            if (error.code === 403) {
                await prisma.user.update({ where: { telegramId: user.telegramId }, data: { isBlocked: true } }).catch(() => {});
            }
            failCount++;
        }
    }
    return { sentCount, failCount, total: users.length };
}

/**
 * Notify admins
 */
export async function notifyAdmins(bot, message) {
    for (const adminId of ADMIN_IDS) {
        try {
            await bot.telegram.sendMessage(adminId, message, {
                parse_mode: "Markdown",
                disable_web_page_preview: true,
            });
        } catch (error) {
            console.log(`Failed to notify admin ${adminId}`);
        }
    }
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

export default {
    sendBroadcast,
    getBroadcastHistory,
    sendVipBroadcast,
    broadcastNewOrder,
    broadcastGiftRedeem,
    notifyAdmins,
};
