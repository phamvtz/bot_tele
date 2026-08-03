import { Markup } from "telegraf";
import { prisma } from "./db.js";
import { invalidateCategoryCache } from "./category.js";
import { getProductDeepLink } from "./telegram-links.js";
import { getStatsMessage, getRevenueByDay, generateTextChart } from "./stats.js";
import { createCoupon, listCoupons, toggleCoupon, deleteCoupon } from "./coupon.js";
import { createBackup, listBackups } from "./backup.js";
import { logAction, Actions, getRecentLogs, formatLog } from "./audit.js";
import { sendBroadcast, sendBroadcastPhoto, getBroadcastHistory } from "./broadcast.js";
import { exportOrdersCSV, exportRevenueCSV, exportUsersCSV, exportProductsCSV } from "./export.js";
import { getVipLevels, getUserVipInfo, setVipLevel, getVipEmoji } from "./vip.js";
import { adminAddBalance, adminDeductBalance, getBalance, getTransactionHistory } from "./wallet.js";
import { adminPanelMessage } from "./bot-ui/messages.js";
import { escapeHtml } from "./bot-ui/format.js";
import { buildAdminMenuKeyboard, buildReplyKeyboard } from "./bot-ui/keyboards.js";
import { generateApiKey } from "./seller-api.js";
import { getMenuIcons, getMenuIconIds, setMenuIcon, resetAllMenuIcons, iconOf, invalidateMenuCache, BUTTON_LABELS, DEFAULT_ICONS, getWelcomeGreeting, setWelcomeGreeting, DEFAULT_WELCOME_GREETING, getProductDisplaySettings, setProductDisplaySettings } from "./menu-config.js";
import { extractIconPayloadFromText } from "./icon-utils.js";
import { invalidateEmojiCache } from "./emoji-map.js";

/**
 * Admin Module v3 - Full Featured
 */

const ADMIN_IDS = (process.env.ADMIN_IDS || "").split(",").map((id) => id.trim()).filter(Boolean);
const ADMIN_SET = new Set(ADMIN_IDS);

function isAdmin(userId) {
    return ADMIN_SET.has(String(userId));
}

function extractIconPayloadFromTextMessage(message, fallbackIcon = "✨") {
    return extractIconPayloadFromText(message, fallbackIcon);
}

function extractIconPayloadFromStickerMessage(message) {
    const sticker = message?.sticker;
    if (!sticker) return null;
    // Only custom emoji stickers carry a custom_emoji_id; regular pack stickers don't
    if (!sticker.custom_emoji_id) return null;
    return {
        icon: sticker.emoji || iconOf("ADMIN_PRODUCTS"),
        iconEmojiId: sticker.custom_emoji_id,
    };
}

async function saveCategoryIconSession(ctx, session, iconPayload) {
    if (!iconPayload?.icon) {
        await ctx.reply(`${iconOf("STATUS_ERROR")} Không đọc được icon. Hãy gửi emoji thường (ví dụ: 🎨) hoặc custom emoji Telegram.`);
        return;
    }

    if (session.action === "ADD_CATEGORY_ICON") {
        const maxOrder = await prisma.category.findFirst({
            orderBy: { order: "desc" },
            select: { order: true }
        });
        const nextOrder = (maxOrder?.order || 0) + 1;

        await prisma.category.create({
            data: {
                name: session.name,
                icon: iconPayload.icon,
                iconEmojiId: iconPayload.iconEmojiId,
                order: nextOrder,
                description: session.description || null,
            }
        });
        invalidateCategoryCache();

        adminSessions.delete(ctx.from.id);
        await ctx.reply(`${iconOf("STATUS_SUCCESS")} Đã tạo danh mục: ${iconPayload.icon} ${session.name}`);
        return;
    }

    if (session.action === "EDIT_CATEGORY_ICON") {
        await prisma.category.update({
            where: { id: session.categoryId },
            data: {
                icon: iconPayload.icon,
                iconEmojiId: iconPayload.iconEmojiId
            }
        });
        invalidateCategoryCache();

        adminSessions.delete(ctx.from.id);
        await ctx.reply(`${iconOf("STATUS_SUCCESS")} Đã đổi icon danh mục thành: ${iconPayload.icon}`);
    }
}

function adminOnly(ctx, next) {
    if (!isAdmin(ctx.from.id)) {
        return ctx.reply(`${iconOf("STATUS_ERROR")} Không có quyền truy cập.`);
    }
    return next();
}

// Sessions for multi-step operations
const adminSessions = new Map();

export function hasAdminSession(userId) {
    return adminSessions.has(userId);
}

export async function showAdminPanel(ctx, edit = false) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const [revenue, todayOrders, newUsers] = await Promise.all([
        prisma.order.aggregate({
            where: { createdAt: { gte: today }, status: { in: ["PAID", "DELIVERED"] } },
            _sum: { finalAmount: true },
        }).catch(() => ({ _sum: { finalAmount: 0 } })),
        prisma.order.count({ where: { createdAt: { gte: today } } }).catch(() => 0),
        prisma.user.count({ where: { createdAt: { gte: today } } }).catch(() => 0),
    ]);

    const msg = adminPanelMessage({
        todayRevenue: revenue._sum.finalAmount || 0,
        todayOrders,
        newUsers,
    });
    const keyboard = buildAdminMenuKeyboard();

    if (edit) {
        await ctx.editMessageText(msg, { parse_mode: "HTML", ...keyboard });
    } else {
        await ctx.reply(msg, { parse_mode: "HTML", ...keyboard });
    }
}

function buildHtmlFromMessage(text, entities) {
    const customEmojis = (entities || [])
        .filter((e) => e.type === "custom_emoji")
        .sort((a, b) => a.offset - b.offset);
    if (!customEmojis.length) return escapeHtml(text);
    let result = "";
    let last = 0;
    for (const e of customEmojis) {
        result += escapeHtml(text.slice(last, e.offset));
        const char = text.slice(e.offset, e.offset + e.length);
        result += `<tg-emoji emoji-id="${e.custom_emoji_id}">${escapeHtml(char)}</tg-emoji>`;
        last = e.offset + e.length;
    }
    result += escapeHtml(text.slice(last));
    return result;
}

export function registerAdminCommands(bot) {
    // /admin - Admin Panel
    bot.command("admin", adminOnly, async (ctx) => {
        await showAdminPanel(ctx);
    });

    bot.action("ADMIN:PANEL", adminOnly, async (ctx) => {
        await ctx.answerCbQuery();
        await showAdminPanel(ctx, true);
    });

    bot.action(["SHOW_ADMIN_PANEL", "ADMIN_PANEL"], adminOnly, async (ctx) => {
        await ctx.answerCbQuery();
        await showAdminPanel(ctx, true);
    });

    // === PRODUCTS MANAGEMENT ===
    bot.action("ADMIN:PRODUCTS", adminOnly, async (ctx) => {
        await ctx.answerCbQuery();

        const products = await prisma.product.findMany({ orderBy: { createdAt: "desc" } });

        // Đếm stock song song thay vì tuần tự trong loop
        const stockLineProducts = products.filter(p => p.deliveryMode === "STOCK_LINES");
        const stockCountResults = await Promise.all(
            stockLineProducts.map(p => prisma.stockItem.count({ where: { productId: p.id, isSold: false } }))
        );
        const stockMap = Object.fromEntries(stockLineProducts.map((p, i) => [p.id, stockCountResults[i]]));

        let msg = `${iconOf("ADMIN_PRODUCTS")} *Quản lý sản phẩm*\n\n`;
        for (const p of products) {
            const status = iconOf(p.isActive ? "ADMIN_TOGGLE_ON" : "ADMIN_TOGGLE_OFF");
            let stock = "";
            if (p.deliveryMode === "STOCK_LINES") {
                stock = ` [${stockMap[p.id] ?? 0}]`;
            }
            msg += `${status} \`${p.code}\` - ${p.name} - ${p.price.toLocaleString()}đ${stock}\n`;
        }

        await ctx.editMessageText(msg, {
            parse_mode: "Markdown",
            ...Markup.inlineKeyboard([
                [Markup.button.callback(`${iconOf("ADMIN_ADD")} Thêm sản phẩm`, "ADMIN:ADD_PRODUCT")],
                [Markup.button.callback(`${iconOf("ADMIN_NOTE")} Sửa sản phẩm`, "ADMIN:EDIT_PRODUCT")],
                [Markup.button.callback(`${iconOf("ADMIN_STATS")} Nạp stock`, "ADMIN:ADD_STOCK")],
                [Markup.button.callback(`${iconOf("NAV_BACK")} Quay lại`, "ADMIN:PANEL")],
            ]),
        });
    });

    // Add product - Step 1: Select category
    bot.action("ADMIN:ADD_PRODUCT", adminOnly, async (ctx) => {
        await ctx.answerCbQuery();

        const categories = await prisma.category.findMany({
            where: { isActive: true },
            orderBy: { order: 'asc' }
        });

        if (categories.length === 0) {
            return ctx.editMessageText(
                `${iconOf("STATUS_ERROR")} Chưa có danh mục nào!\n\nVui lòng tạo danh mục trước.`,
                {
                    parse_mode: "Markdown",
                    ...Markup.inlineKeyboard([[Markup.button.callback(`${iconOf("ADMIN_CATEGORIES")} Quản lý danh mục`, "ADMIN:CATEGORIES")]])
                }
            );
        }

        const categoryButtons = categories.map(cat => [
            Markup.button.callback(`${cat.icon} ${cat.name}`, `ADMIN:ADD_PROD_CAT:${cat.id}`)
        ]);
        categoryButtons.push([Markup.button.callback(`${iconOf("ADMIN_CANCEL")} Huỷ`, "ADMIN:PRODUCTS")]);

        await ctx.editMessageText(
            `${iconOf("ADMIN_ADD")} *Thêm sản phẩm mới*\n\n${iconOf("ADMIN_CATEGORIES")} Bước 1/4: Chọn danh mục:`,
            {
                parse_mode: "Markdown",
                ...Markup.inlineKeyboard(categoryButtons)
            }
        );
    });

    // Add product - Step 2: Enter name after selecting category
    bot.action(/^ADMIN:ADD_PROD_CAT:(.+)$/i, adminOnly, async (ctx) => {
        await ctx.answerCbQuery();
        const categoryId = ctx.match[1];

        const category = await prisma.category.findUnique({ where: { id: categoryId } });
        if (!category) {
            return ctx.reply(`${iconOf("STATUS_ERROR")} Danh mục không tồn tại`);
        }

        // Auto-generate random product code
        const randomCode = "P" + Math.random().toString(36).substring(2, 8).toUpperCase();

        adminSessions.set(ctx.from.id, {
            action: "ADD_PRODUCT",
            step: 2,
            code: randomCode,
            categoryId: categoryId,
            categoryName: category.name
        });

        await ctx.editMessageText(
            `${iconOf("ADMIN_ADD")} *Thêm sản phẩm mới*\n\n` +
            `${iconOf("ADMIN_CATEGORIES")} Danh mục: ${category.icon} ${category.name}\n` +
            `${iconOf("ADMIN_NOTE")} Mã SP: \`${randomCode}\`\n\n` +
            `Bước 2/5: Nhập tên sản phẩm:`,
            { parse_mode: "Markdown", ...Markup.inlineKeyboard([[Markup.button.callback(`${iconOf("ADMIN_CANCEL")} Huỷ`, "ADMIN:PRODUCTS")]]) }
        );
    });

    // Edit product - Select product
    bot.action("ADMIN:EDIT_PRODUCT", adminOnly, async (ctx) => {
        await ctx.answerCbQuery();

        const products = await prisma.product.findMany({ orderBy: { createdAt: "desc" } });

        await ctx.editMessageText(
            `${iconOf("ADMIN_NOTE")} *Chọn sản phẩm để sửa:*`,
            {
                parse_mode: "Markdown",
                ...Markup.inlineKeyboard([
                    ...products.map((p) => [Markup.button.callback(`${iconOf(p.isActive ? "ADMIN_TOGGLE_ON" : "ADMIN_TOGGLE_OFF")} ${p.code} - ${p.name}`, `ADMIN:EDIT:${p.id}`)]),
                    [Markup.button.callback(`${iconOf("NAV_BACK")} Quay lại`, "ADMIN:PRODUCTS")],
                ]),
            }
        );
    });

    // Edit specific product
    bot.action(/^ADMIN:EDIT:(.+)$/, adminOnly, async (ctx) => {
        await ctx.answerCbQuery();
        const productId = ctx.match[1];

        const product = await prisma.product.findUnique({ where: { id: productId } });
        if (!product) return ctx.reply(`${iconOf("STATUS_ERROR")} Không tìm thấy`);

        let stockInfo = "";
        if (product.deliveryMode === "STOCK_LINES") {
            const [total, sold] = await Promise.all([
                prisma.stockItem.count({ where: { productId: product.id } }),
                prisma.stockItem.count({ where: { productId: product.id, isSold: true } }),
            ]);
            stockInfo = `\n${iconOf("ADMIN_STATS")} Stock: ${total - sold}/${total}`;
        }

        await ctx.editMessageText(
            `${iconOf("ADMIN_PRODUCTS")} <b>${escapeHtml(product.name)}</b>\n\n` +
            `Code: <code>${escapeHtml(product.code)}</code>\n` +
            `Giá: ${String(product.currency || "VND").toUpperCase() === "USD" ? `$${(product.price ?? 0).toLocaleString("en-US")}` : `${(product.price ?? 0).toLocaleString("vi-VN")}đ`}\n` +
            `Mode: ${escapeHtml(product.deliveryMode)}\n` +
            `Trạng thái: ${!product.isActive ? `${iconOf("STATUS_ERROR")} Tắt` : product.unlisted ? `${iconOf("STATUS_WARNING")} Bán riêng qua link` : `${iconOf("STATUS_SUCCESS")} Đang bán`}` +
            escapeHtml(stockInfo),
            {
                parse_mode: "HTML",
                ...Markup.inlineKeyboard([
                    [Markup.button.callback(product.isActive ? `${iconOf("STATUS_ERROR")} Tắt` : `${iconOf("STATUS_SUCCESS")} Bật`, `ADMIN:TOGGLE:${product.id}`)],
                    // Chỉ hiện khi đang bật — unlisted không có nghĩa nếu SP đã tắt.
                    ...(product.isActive ? [[Markup.button.callback(
                        product.unlisted ? `${iconOf("STATUS_SUCCESS")} Hiện công khai` : `${iconOf("STATUS_WARNING")} Ẩn, chỉ bán qua link`,
                        `ADMIN:UNLIST:${product.id}`,
                    )]] : []),
                    [Markup.button.callback(`${iconOf("ADMIN_EDIT")} Sửa tên`, `ADMIN:RENAME:${product.id}`), Markup.button.callback(`${iconOf("ADMIN_NOTE")} Đổi mã SP`, `ADMIN:RECODE:${product.id}`)],
                    [Markup.button.callback(`${iconOf("ADMIN_MONEY")} Đổi giá`, `ADMIN:PRICE:${product.id}`), Markup.button.callback(`${iconOf("VIP_TIER_3")} Giá VIP`, `ADMIN:VIP_PRICE:${product.id}`)],
                    [Markup.button.callback(`${iconOf("ADMIN_ICON_EDIT")} Sửa icon`, `ADMIN:ICON_PRODUCT:${product.id}`), Markup.button.callback(`${iconOf("ADMIN_IMAGE")} Đổi ảnh`, `ADMIN:IMG:${product.id}`)],
                    ...(product.imageFileId || product.imageUrl ? [[Markup.button.callback(`${iconOf("ADMIN_DELETE")} Xóa ảnh`, `ADMIN:IMG_DEL:${product.id}`)]] : []),
                    [Markup.button.callback(`${iconOf("ADMIN_DOC")} Sửa mô tả`, `ADMIN:DESC:${product.id}`), Markup.button.callback(`${iconOf("ADMIN_NOTE")} Đổi payload`, `ADMIN:PAYLOAD:${product.id}`)],
                    [Markup.button.callback(`${iconOf("ADMIN_CATEGORIES")} Đổi danh mục`, `ADMIN:MOVE_CAT:${product.id}`), Markup.button.callback(`${iconOf("ADMIN_STATS")} Lượt bán ảo`, `ADMIN:FAKE_SOLD:${product.id}`)],
                    [Markup.button.callback(`${iconOf("ADMIN_DELETE")} Xoá sản phẩm`, `ADMIN:DELETE:${product.id}`)],
                    [Markup.button.callback(`${iconOf("NAV_BACK")} Quay lại`, "ADMIN:PRODUCTS")],
                ]),
            }
        );
    });

    // Toggle product
    bot.action(/^ADMIN:TOGGLE:(.+)$/, adminOnly, async (ctx) => {
        const productId = ctx.match[1];

        const product = await prisma.product.findUnique({ where: { id: productId } });
        await prisma.product.update({
            where: { id: productId },
            data: { isActive: !product.isActive },
        });
        invalidateCategoryCache();
        await ctx.answerCbQuery("Đã cập nhật!");

        const updated = await prisma.product.findUnique({ where: { id: productId } });
        await ctx.editMessageText(
            `${iconOf("STATUS_SUCCESS")} Đã ${updated.isActive ? "BẬT" : "TẮT"}: ${updated.name}`,
            Markup.inlineKeyboard([[Markup.button.callback(`${iconOf("NAV_BACK")} Quay lại`, "ADMIN:PRODUCTS")]])
        );
    });

    // Toggle unlisted: ẩn khỏi danh mục/web shop nhưng vẫn bán được qua deep link.
    // Khác ADMIN:TOGGLE (tắt hẳn, không ai mua được).
    bot.action(/^ADMIN:UNLIST:(.+)$/, adminOnly, async (ctx) => {
        const productId = ctx.match[1];
        const product = await prisma.product.findUnique({ where: { id: productId } });
        if (!product) return ctx.answerCbQuery("Không tìm thấy sản phẩm");

        // Hàng cũ chưa có field unlisted → undefined, coi như đang công khai.
        const next = !(product.unlisted === true);
        await prisma.product.update({ where: { id: productId }, data: { unlisted: next } });
        invalidateCategoryCache();
        await ctx.answerCbQuery(next ? "Đã ẩn — chỉ bán qua link" : "Đã hiện công khai");

        const link = next ? await getProductDeepLink(ctx.telegram, productId).catch(() => null) : null;
        const body = next
            ? `${iconOf("STATUS_WARNING")} <b>${escapeHtml(product.name)}</b> giờ chỉ bán qua link.\n\n` +
              `Không hiện trong danh mục bot và web shop. Ai có link vẫn mua bình thường.\n\n` +
              (link ? `${iconOf("ADMIN_NOTE")} <code>${escapeHtml(link)}</code>` : `${iconOf("STATUS_WARNING")} Chưa lấy được link — đặt TELEGRAM_BOT_USERNAME trong .env`)
            : `${iconOf("STATUS_SUCCESS")} <b>${escapeHtml(product.name)}</b> đã hiện công khai trở lại.`;

        await ctx.editMessageText(body, {
            parse_mode: "HTML",
            ...Markup.inlineKeyboard([[Markup.button.callback(`${iconOf("NAV_BACK")} Về sản phẩm`, `ADMIN:EDIT:${productId}`)]]),
        });
    });

    // Delete product
    bot.action(/^ADMIN:DELETE:(.+)$/, adminOnly, async (ctx) => {
        await ctx.answerCbQuery();
        const productId = ctx.match[1];

        const product = await prisma.product.findUnique({ where: { id: productId } });

        await ctx.editMessageText(
            `${iconOf("STATUS_WARNING")} Xác nhận xoá: *${product.name}*?`,
            {
                parse_mode: "Markdown",
                ...Markup.inlineKeyboard([
                    [Markup.button.callback(`${iconOf("ADMIN_CONFIRM")} Xác nhận xoá`, `ADMIN:CONFIRM_DELETE:${productId}`)],
                    [Markup.button.callback(`${iconOf("ADMIN_CANCEL")} Huỷ`, `ADMIN:EDIT:${productId}`)],
                ]),
            }
        );
    });

    bot.action(/^ADMIN:CONFIRM_DELETE:(.+)$/, adminOnly, async (ctx) => {
        await ctx.answerCbQuery("Đã xoá!");
        const productId = ctx.match[1];

        // Delete stock items first
        await prisma.stockItem.deleteMany({ where: { productId } });
        await prisma.product.delete({ where: { id: productId } });
        invalidateCategoryCache();

        await ctx.editMessageText(
            `${iconOf("STATUS_SUCCESS")} Đã xoá sản phẩm.`,
            Markup.inlineKeyboard([[Markup.button.callback(`${iconOf("NAV_BACK")} Quay lại`, "ADMIN:PRODUCTS")]])
        );
    });

    // Change price - Ask for new price
    bot.action(/^ADMIN:PRICE:(.+)$/, adminOnly, async (ctx) => {
        await ctx.answerCbQuery();
        const productId = ctx.match[1];

        const product = await prisma.product.findUnique({ where: { id: productId } });
        const currency = String(product.currency || "VND").toUpperCase();
        const priceLabel = currency === "USD" ? `$${product.price.toLocaleString("en-US")}` : `${product.price.toLocaleString("vi-VN")}đ`;
        adminSessions.set(ctx.from.id, { action: "CHANGE_PRICE", productId, productName: product.name, currency });

        await ctx.editMessageText(
            `${iconOf("ADMIN_MONEY")} *Đổi giá: ${product.name}*\n\nGiá hiện tại: ${priceLabel}\n\nNhập giá mới (${currency}):`,
            { parse_mode: "Markdown", ...Markup.inlineKeyboard([[Markup.button.callback(`${iconOf("ADMIN_CANCEL")} Huỷ`, `ADMIN:EDIT:${productId}`)]]) }
        );
    });

    // Change payload - Ask for new payload
    bot.action(/^ADMIN:PAYLOAD:(.+)$/, adminOnly, async (ctx) => {
        await ctx.answerCbQuery();
        const productId = ctx.match[1];

        const product = await prisma.product.findUnique({ where: { id: productId } });
        adminSessions.set(ctx.from.id, { action: "CHANGE_PAYLOAD", productId, productName: product.name, mode: product.deliveryMode });

        let hint = "";
        if (product.deliveryMode === "TEXT") {
            hint = "Nhập nội dung text sẽ gửi cho khách:";
        } else if (product.deliveryMode === "FILE") {
            hint = "Nhập đường dẫn file (vd: files/ebook.pdf):";
        } else {
            hint = "Sản phẩm này dùng STOCK_LINES, không cần payload.";
        }

        await ctx.editMessageText(
            `${iconOf("ADMIN_NOTE")} *Đổi payload: ${product.name}*\n\nPayload hiện tại: ${product.payload || "(trống)"}\n\n${hint}`,
            { parse_mode: "Markdown", ...Markup.inlineKeyboard([[Markup.button.callback(`${iconOf("ADMIN_CANCEL")} Huỷ`, `ADMIN:EDIT:${productId}`)]]) }
        );
    });


    // Rename product
    bot.action(/^ADMIN:RENAME:(.+)$/, adminOnly, async (ctx) => {
        await ctx.answerCbQuery();
        const productId = ctx.match[1];
        const product = await prisma.product.findUnique({ where: { id: productId } });
        if (!product) return ctx.reply(`${iconOf("STATUS_ERROR")} Không tìm thấy sản phẩm`);

        adminSessions.set(ctx.from.id, { action: "RENAME_PRODUCT", productId, productName: product.name });
        await ctx.editMessageText(
            `${iconOf("ADMIN_EDIT")} <b>Sửa tên: ${escapeHtml(product.name)}</b>\n\nNhập tên mới:`,
            { parse_mode: "HTML", ...Markup.inlineKeyboard([[Markup.button.callback(`${iconOf("ADMIN_CANCEL")} Huỷ`, `ADMIN:EDIT:${productId}`)]]) }
        );
    });

    // Recode product
    bot.action(/^ADMIN:RECODE:(.+)$/, adminOnly, async (ctx) => {
        await ctx.answerCbQuery();
        const productId = ctx.match[1];
        const product = await prisma.product.findUnique({ where: { id: productId } });
        if (!product) return ctx.reply(`${iconOf("STATUS_ERROR")} Không tìm thấy sản phẩm`);

        adminSessions.set(ctx.from.id, { action: "RECODE_PRODUCT", productId, productName: product.name });
        await ctx.editMessageText(
            `${iconOf("ADMIN_NOTE")} <b>Đổi mã SP: ${escapeHtml(product.name)}</b>\n\nMã hiện tại: <code>${escapeHtml(product.code)}</code>\n\nNhập mã mới:`,
            { parse_mode: "HTML", ...Markup.inlineKeyboard([[Markup.button.callback(`${iconOf("ADMIN_CANCEL")} Huỷ`, `ADMIN:EDIT:${productId}`)]]) }
        );
    });

    // VIP price
    bot.action(/^ADMIN:VIP_PRICE:(.+)$/, adminOnly, async (ctx) => {
        await ctx.answerCbQuery();
        const productId = ctx.match[1];
        const product = await prisma.product.findUnique({ where: { id: productId } });
        if (!product) return ctx.reply(`${iconOf("STATUS_ERROR")} Không tìm thấy sản phẩm`);

        const currency = String(product.currency || "VND").toUpperCase();
        const vipLabel = product.vipPrice
            ? (currency === "USD" ? `$${product.vipPrice.toLocaleString("en-US")}` : `${product.vipPrice.toLocaleString("vi-VN")}đ`)
            : "Chưa có";
        adminSessions.set(ctx.from.id, { action: "CHANGE_VIP_PRICE", productId, productName: product.name, currency });
        await ctx.editMessageText(
            `${iconOf("VIP_TIER_3")} <b>Giá VIP: ${escapeHtml(product.name)}</b>\n\nGiá VIP hiện tại: <b>${vipLabel}</b>\n\nNhập giá VIP mới (${currency}):\n<i>Gửi "xoa" để xóa giá VIP.</i>`,
            { parse_mode: "HTML", ...Markup.inlineKeyboard([[Markup.button.callback(`${iconOf("ADMIN_CANCEL")} Huỷ`, `ADMIN:EDIT:${productId}`)]]) }
        );
    });

    // Move to category
    bot.action(/^ADMIN:MOVE_CAT:(.+)$/, adminOnly, async (ctx) => {
        await ctx.answerCbQuery();
        const productId = ctx.match[1];
        const product = await prisma.product.findUnique({ where: { id: productId } });
        if (!product) return ctx.reply(`${iconOf("STATUS_ERROR")} Không tìm thấy sản phẩm`);

        const categories = await prisma.category.findMany({ orderBy: { order: "asc" } });
        await ctx.editMessageText(
            `${iconOf("ADMIN_CATEGORIES")} <b>Đổi danh mục: ${escapeHtml(product.name)}</b>\n\nChọn danh mục mới:`,
            {
                parse_mode: "HTML",
                ...Markup.inlineKeyboard([
                    ...categories.map(cat => [Markup.button.callback(
                        `${cat.icon} ${cat.name}${cat.id === product.categoryId ? " ✓" : ""}`,
                        `ADMIN:SET_CAT:${productId}:${cat.id}`
                    )]),
                    [Markup.button.callback(`${iconOf("ADMIN_CANCEL")} Huỷ`, `ADMIN:EDIT:${productId}`)],
                ]),
            }
        );
    });

    bot.action(/^ADMIN:SET_CAT:(.+):(.+)$/, adminOnly, async (ctx) => {
        await ctx.answerCbQuery();
        const productId = ctx.match[1];
        const categoryId = ctx.match[2];
        const [product, category] = await Promise.all([
            prisma.product.findUnique({ where: { id: productId } }),
            prisma.category.findUnique({ where: { id: categoryId } }),
        ]);
        if (!product || !category) return ctx.reply(`${iconOf("STATUS_ERROR")} Không tìm thấy`);

        await prisma.product.update({ where: { id: productId }, data: { categoryId } });
        invalidateCategoryCache();
        await ctx.editMessageText(
            `${iconOf("STATUS_SUCCESS")} Đã chuyển <b>${escapeHtml(product.name)}</b> sang danh mục <b>${escapeHtml(category.icon)} ${escapeHtml(category.name)}</b>`,
            { parse_mode: "HTML", ...Markup.inlineKeyboard([[Markup.button.callback(`${iconOf("NAV_BACK")} Về sản phẩm`, `ADMIN:EDIT:${productId}`)]])}
        );
    });

    // Change product description
    bot.action(/^ADMIN:DESC:(.+)$/, adminOnly, async (ctx) => {
        await ctx.answerCbQuery();
        const productId = ctx.match[1];

        const product = await prisma.product.findUnique({ where: { id: productId } });
        if (!product) return ctx.reply(`${iconOf("STATUS_ERROR")} Không tìm thấy sản phẩm`);

        adminSessions.set(ctx.from.id, { action: "CHANGE_DESC", productId, productName: product.name });

        const current = product.description
            ? `Mô tả hiện tại:\n<blockquote>${escapeHtml(product.description)}</blockquote>\n\n`
            : `Chưa có mô tả.\n\n`;

        await ctx.editMessageText(
            `${iconOf("ADMIN_DOC")} <b>Sửa mô tả: ${escapeHtml(product.name)}</b>\n\n` +
            current +
            `Nhập mô tả mới (hỗ trợ nhiều dòng):\n` +
            `<i>Gửi "xoa" để xóa mô tả hiện tại.</i>`,
            {
                parse_mode: "HTML",
                ...Markup.inlineKeyboard([[Markup.button.callback(`${iconOf("ADMIN_CANCEL")} Huỷ`, `ADMIN:EDIT:${productId}`)]]),
            }
        );
    });

    // Set fake sold count
    bot.action(/^ADMIN:FAKE_SOLD:(.+)$/, adminOnly, async (ctx) => {
        await ctx.answerCbQuery();
        const productId = ctx.match[1];
        const product = await prisma.product.findUnique({ where: { id: productId } });
        if (!product) return ctx.reply(`${iconOf("STATUS_ERROR")} Không tìm thấy sản phẩm`);

        adminSessions.set(ctx.from.id, { action: "CHANGE_FAKE_SOLD", productId, productName: product.name });

        await ctx.editMessageText(
            `${iconOf("ADMIN_STATS")} <b>Lượt bán ảo: ${escapeHtml(product.name)}</b>\n\n` +
            `Lượt bán ảo hiện tại: <b>${(product.soldFake || 0).toLocaleString("vi-VN")}</b>\n\n` +
            `Nhập số lượt bán ảo muốn cộng thêm vào lượt bán thật:\n` +
            `<i>Ví dụ: 500 → hiển thị = thực + 500\nGửi 0 để tắt.</i>`,
            {
                parse_mode: "HTML",
                ...Markup.inlineKeyboard([[Markup.button.callback(`${iconOf("ADMIN_CANCEL")} Huỷ`, `ADMIN:EDIT:${productId}`)]]),
            }
        );
    });

    // Change product icon
    bot.action(/^ADMIN:ICON_PRODUCT:(.+)$/, adminOnly, async (ctx) => {
        await ctx.answerCbQuery();
        const productId = ctx.match[1];
        const product = await prisma.product.findUnique({ where: { id: productId } });
        if (!product) return ctx.reply(`${iconOf("STATUS_ERROR")} Không tìm thấy sản phẩm`);

        adminSessions.set(ctx.from.id, {
            action: "CHANGE_PRODUCT_ICON",
            productId,
            productName: product.name,
            currentIcon: product.icon || iconOf("ADMIN_PRODUCTS"),
        });
        const current = product.icon
            ? `Icon hiện tại: ${product.icon}${product.iconEmojiId ? `\nID: \`${product.iconEmojiId}\`` : ""}`
            : "Chưa có icon tùy chỉnh (đang dùng auto)";
        await ctx.editMessageText(
            `${iconOf("ADMIN_ICON_EDIT")} *Sửa icon: ${product.name}*\n\n${current}\n\nGửi emoji, custom emoji sticker hoặc dán Custom Emoji ID:\n_Gửi "reset" để xóa icon tùy chỉnh_`,
            { parse_mode: "Markdown", ...Markup.inlineKeyboard([[Markup.button.callback(`${iconOf("ADMIN_CANCEL")} Huỷ`, `ADMIN:EDIT:${productId}`)]]) }
        );
    });

    // Set product image
    bot.action(/^ADMIN:IMG:(.+)$/, adminOnly, async (ctx) => {
        await ctx.answerCbQuery();
        const productId = ctx.match[1];
        const product = await prisma.product.findUnique({ where: { id: productId } });
        if (!product) return ctx.reply(`${iconOf("STATUS_ERROR")} Không tìm thấy sản phẩm`);
        adminSessions.set(ctx.from.id, { action: "SET_PRODUCT_IMAGE", productId, productName: product.name });
        const currentLine = product.imageFileId ? `${iconOf("STATUS_SUCCESS")} Đã có ảnh` : "Chưa có ảnh";
        await ctx.editMessageText(
            `${iconOf("ADMIN_IMAGE")} <b>Đổi ảnh: ${escapeHtml(product.name)}</b>\n\n${currentLine}\n\nGửi ảnh mới vào đây (hoặc /cancel để huỷ):`,
            { parse_mode: "HTML", ...Markup.inlineKeyboard([[Markup.button.callback(`${iconOf("ADMIN_CANCEL")} Huỷ`, `ADMIN:EDIT:${productId}`)]]) }
        );
    });

    // Delete product image
    bot.action(/^ADMIN:IMG_DEL:(.+)$/, adminOnly, async (ctx) => {
        await ctx.answerCbQuery();
        const productId = ctx.match[1];
        await prisma.product.update({ where: { id: productId }, data: { imageFileId: null, imageUrl: null } });
        invalidateCategoryCache();
        await ctx.editMessageText(`${iconOf("STATUS_SUCCESS")} Đã xóa ảnh sản phẩm.`, Markup.inlineKeyboard([[Markup.button.callback(`${iconOf("NAV_BACK")} Quay lại`, `ADMIN:EDIT:${productId}`)]]));
    });

    // Add stock - Select product
    bot.action("ADMIN:ADD_STOCK", adminOnly, async (ctx) => {
        await ctx.answerCbQuery();

        const products = await prisma.product.findMany({
            where: { deliveryMode: "STOCK_LINES" },
            orderBy: { createdAt: "desc" },
        });

        if (!products.length) {
            return ctx.editMessageText(
                `${iconOf("STATUS_ERROR")} Không có sản phẩm nào dùng STOCK_LINES`,
                Markup.inlineKeyboard([[Markup.button.callback(`${iconOf("NAV_BACK")} Quay lại`, "ADMIN:PRODUCTS")]])
            );
        }

        await ctx.editMessageText(
            `${iconOf("ADMIN_STATS")} *Chọn sản phẩm để nạp stock:*`,
            {
                parse_mode: "Markdown",
                ...Markup.inlineKeyboard([
                    ...products.map((p) => [Markup.button.callback(p.name, `ADMIN:STOCK:${p.id}`)]),
                    [Markup.button.callback(`${iconOf("NAV_BACK")} Quay lại`, "ADMIN:PRODUCTS")],
                ]),
            }
        );
    });

    bot.action(/^ADMIN:STOCK:(.+)$/, adminOnly, async (ctx) => {
        await ctx.answerCbQuery();
        const productId = ctx.match[1];

        const product = await prisma.product.findUnique({ where: { id: productId } });
        const available = await prisma.stockItem.count({ where: { productId, isSold: false } });
        // Reset session — chờ user chọn chế độ nhập
        adminSessions.delete(ctx.from.id);

        await ctx.editMessageText(
            `${iconOf("ADMIN_STATS")} *Nạp stock: ${product.name}*\n\n` +
            `Còn: ${available} items\n\n` +
            `Chọn chế độ nhập:\n` +
            `${iconOf("ADMIN_NOTE")} *Theo dòng* — mỗi dòng / file .txt nhiều dòng = 1 tài khoản\n` +
            `${iconOf("ADMIN_CATEGORIES")} *Mỗi file 1 sản phẩm* — toàn bộ nội dung file .txt = 1 tài khoản (giữ nguyên xuống dòng, hướng dẫn dài, v.v.)`,
            {
                parse_mode: "Markdown",
                ...Markup.inlineKeyboard([
                    [Markup.button.callback(`${iconOf("ADMIN_NOTE")} Theo dòng`, `ADMIN:STOCK_LINES:${productId}`)],
                    [Markup.button.callback(`${iconOf("ADMIN_CATEGORIES")} Mỗi file 1 sản phẩm`, `ADMIN:STOCK_FILE:${productId}`)],
                    [Markup.button.callback(`${iconOf("ADMIN_DELETE")} Xóa toàn bộ kho`, `ADMIN:CLEAR_STOCK:${productId}`)],
                    [Markup.button.callback(`${iconOf("ADMIN_CANCEL")} Huỷ`, "ADMIN:PRODUCTS")],
                ]),
            }
        );
    });

    // Mode 1: nhập theo dòng (text hoặc .txt nhiều dòng)
    bot.action(/^ADMIN:STOCK_LINES:(.+)$/, adminOnly, async (ctx) => {
        await ctx.answerCbQuery();
        const productId = ctx.match[1];
        const product = await prisma.product.findUnique({ where: { id: productId } });
        if (!product) return ctx.reply(`${iconOf("STATUS_ERROR")} Sản phẩm không tồn tại`);

        adminSessions.set(ctx.from.id, { action: "ADD_STOCK", productId, productName: product.name });

        await ctx.editMessageText(
            `${iconOf("ADMIN_NOTE")} *Nạp stock theo dòng: ${product.name}*\n\n` +
            `Gửi danh sách (mỗi dòng = 1 tài khoản)\n` +
            `Hoặc upload file .txt — mỗi dòng trong file = 1 tài khoản`,
            {
                parse_mode: "Markdown",
                ...Markup.inlineKeyboard([
                    [Markup.button.callback(`${iconOf("NAV_BACK")} Quay lại`, `ADMIN:STOCK:${productId}`)],
                ]),
            }
        );
    });

    // Mode 2: mỗi file .txt = 1 stock item nguyên content
    bot.action(/^ADMIN:STOCK_FILE:(.+)$/, adminOnly, async (ctx) => {
        await ctx.answerCbQuery();
        const productId = ctx.match[1];
        const product = await prisma.product.findUnique({ where: { id: productId } });
        if (!product) return ctx.reply(`${iconOf("STATUS_ERROR")} Sản phẩm không tồn tại`);

        adminSessions.set(ctx.from.id, {
            action: "ADD_STOCK_FILE_PER_ITEM",
            productId,
            productName: product.name,
            uploadedCount: 0,
        });

        await ctx.editMessageText(
            `${iconOf("ADMIN_CATEGORIES")} *Nạp mỗi file = 1 sản phẩm: ${product.name}*\n\n` +
            `Upload từng file .txt — mỗi file là 1 tài khoản (giữ nguyên cả nội dung, kể cả xuống dòng).\n\n` +
            `Có thể upload liên tiếp nhiều file. Bấm *Xong* khi hết.`,
            {
                parse_mode: "Markdown",
                ...Markup.inlineKeyboard([
                    [Markup.button.callback(`${iconOf("ADMIN_CONFIRM")} Xong`, `ADMIN:STOCK_FILE_DONE:${productId}`)],
                    [Markup.button.callback(`${iconOf("NAV_BACK")} Quay lại`, `ADMIN:STOCK:${productId}`)],
                ]),
            }
        );
    });

    bot.action(/^ADMIN:STOCK_FILE_DONE:(.+)$/, adminOnly, async (ctx) => {
        await ctx.answerCbQuery();
        const productId = ctx.match[1];
        const session = adminSessions.get(ctx.from.id);
        const uploaded = session?.action === "ADD_STOCK_FILE_PER_ITEM" ? (session.uploadedCount || 0) : 0;
        adminSessions.delete(ctx.from.id);

        const total = await prisma.stockItem.count({ where: { productId, isSold: false } });
        await ctx.editMessageText(
            `${iconOf("STATUS_SUCCESS")} *Hoàn tất nạp stock*\n\n` +
            `Đã thêm: ${uploaded} sản phẩm trong session\n` +
            `Tổng còn: ${total}`,
            {
                parse_mode: "Markdown",
                ...Markup.inlineKeyboard([
                    [Markup.button.callback(`${iconOf("ADMIN_STATS")} Nạp tiếp`, `ADMIN:STOCK:${productId}`)],
                    [Markup.button.callback(`${iconOf("NAV_BACK")} Sản phẩm`, "ADMIN:PRODUCTS")],
                ]),
            }
        );
    });

    bot.action(/^ADMIN:CLEAR_STOCK:(.+)$/, adminOnly, async (ctx) => {
        await ctx.answerCbQuery();
        const productId = ctx.match[1];
        const product = await prisma.product.findUnique({ where: { id: productId } });

        await ctx.editMessageText(
            `${iconOf("ADMIN_DELETE")} *Xóa kho: ${product.name}*\n\n${iconOf("STATUS_WARNING")} Xóa toàn bộ hàng chưa bán?\nThao tác không thể hoàn tác!`,
            {
                parse_mode: "Markdown",
                ...Markup.inlineKeyboard([
                    [Markup.button.callback(`${iconOf("ADMIN_CONFIRM")} Xác nhận xóa kho`, `ADMIN:CLEAR_STOCK_CONFIRM:${productId}`)],
                    [Markup.button.callback(`${iconOf("ADMIN_CANCEL")} Huỷ`, `ADMIN:STOCK:${productId}`)],
                ]),
            }
        );
    });

    bot.action(/^ADMIN:CLEAR_STOCK_CONFIRM:(.+)$/, adminOnly, async (ctx) => {
        await ctx.answerCbQuery("Đang xóa kho...");
        const productId = ctx.match[1];

        const result = await prisma.stockItem.deleteMany({ where: { productId, isSold: false } });

        adminSessions.delete(ctx.from.id);
        await ctx.editMessageText(
            `${iconOf("STATUS_SUCCESS")} Đã xóa ${result.count} items khỏi kho.`,
            Markup.inlineKeyboard([[Markup.button.callback(`${iconOf("NAV_BACK")} Quay lại`, "ADMIN:PRODUCTS")]])
        );
    });

    // === ORDERS ===
    bot.action("ADMIN:ORDERS", adminOnly, async (ctx) => {
        await ctx.answerCbQuery();

        const orders = await prisma.order.findMany({
            orderBy: { createdAt: "desc" },
            take: 20,
            include: { product: true },
        });

        const emoji = {
            PENDING: iconOf("STATUS_PENDING"),
            PAID: iconOf("ADMIN_MONEY"),
            DELIVERED: iconOf("STATUS_SUCCESS"),
            CANCELED: iconOf("STATUS_ERROR"),
        };
        let msg = `${iconOf("ADMIN_ORDERS")} *Đơn hàng gần đây*\n\n`;

        for (const o of orders) {
            msg += `${emoji[o.status]} \`${o.id.slice(-8)}\` | ${o.product.code} x${o.quantity} | ${o.finalAmount.toLocaleString()}đ\n`;
        }

        await ctx.editMessageText(msg, {
            parse_mode: "Markdown",
            ...Markup.inlineKeyboard([
                [Markup.button.callback(`${iconOf("STATUS_PENDING")} Chờ thanh toán`, "ADMIN:ORDERS:PENDING")],
                [Markup.button.callback(`${iconOf("NAV_BACK")} Quay lại`, "ADMIN:PANEL")],
            ]),
        });
    });

    // Pending orders (for manual confirmation)
    bot.action("ADMIN:ORDERS:PENDING", adminOnly, async (ctx) => {
        await ctx.answerCbQuery();

        const orders = await prisma.order.findMany({
            where: { status: "PENDING", paymentMethod: "bank" },
            orderBy: { createdAt: "desc" },
            include: { product: true },
        });

        if (!orders.length) {
            return ctx.editMessageText(
                `${iconOf("STATUS_SUCCESS")} Không có đơn chờ xác nhận`,
                Markup.inlineKeyboard([[Markup.button.callback(`${iconOf("NAV_BACK")} Quay lại`, "ADMIN:ORDERS")]])
            );
        }

        await ctx.editMessageText(
            `${iconOf("STATUS_PENDING")} *Đơn chờ xác nhận (Bank Transfer)*\n\n` +
            orders.map((o) => `\`${o.id.slice(-8)}\` | ${o.product.name} | ${o.finalAmount.toLocaleString()}đ`).join("\n"),
            {
                parse_mode: "Markdown",
                ...Markup.inlineKeyboard([
                    ...orders.slice(0, 5).map((o) => [Markup.button.callback(`${iconOf("STATUS_SUCCESS")} Xác nhận ${o.id.slice(-8)}`, `ADMIN:CONFIRM_PAY:${o.id}`)]),
                    [Markup.button.callback(`${iconOf("NAV_BACK")} Quay lại`, "ADMIN:ORDERS")],
                ]),
            }
        );
    });

    // ============================================
    // CATEGORY MANAGEMENT
    // ============================================

    // List categories
    bot.action("ADMIN:CATEGORIES", adminOnly, async (ctx) => {
        await ctx.answerCbQuery();

        const categories = await prisma.category.findMany({
            orderBy: [{ order: 'asc' }, { name: 'asc' }],
            include: {
                _count: { select: { products: true } }
            }
        });

        let msg = `${iconOf("ADMIN_CATEGORIES")} *QUẢN LÝ DANH MỤC*\n\n`;

        if (categories.length === 0) {
            msg += `${iconOf("ADMIN_EMPTY")} Chưa có danh mục nào`;
        } else {
            categories.forEach((cat, i) => {
                const status = iconOf(cat.isActive ? "ADMIN_TOGGLE_ON" : "ADMIN_TOGGLE_OFF");
                msg += `${i + 1}. ${cat.icon} *${cat.name}*\n`;
                msg += `   Trạng thái: ${status} | Sản phẩm: ${cat._count.products}\n\n`;
            });
        }

        const buttons = categories.map(cat => [
            Markup.button.callback(`${iconOf("ADMIN_EDIT")} ${cat.icon} ${cat.name}`, `ADMIN:EDIT_CAT:${cat.id}`)
        ]);

        buttons.push(
            [Markup.button.callback(`${iconOf("ADMIN_ADD")} Thêm danh mục`, "ADMIN:ADD_CATEGORY")],
            [Markup.button.callback(`${iconOf("NAV_BACK")} Admin Panel`, "SHOW_ADMIN_PANEL")]
        );

        await ctx.editMessageText(msg, {
            parse_mode: "Markdown",
            ...Markup.inlineKeyboard(buttons)
        });
    });

    // Add category - Step 1: Enter name
    bot.action("ADMIN:ADD_CATEGORY", adminOnly, async (ctx) => {
        await ctx.answerCbQuery();
        adminSessions.set(ctx.from.id, { action: "ADD_CATEGORY_NAME" });

        await ctx.editMessageText(
            `${iconOf("ADMIN_ADD")} *THÊM DANH MỤC MỚI*\n\n` +
            `${iconOf("ADMIN_NOTE")} Nhập tên danh mục:\n\n` +
            `_Ví dụ: Chat GPT, CapCut Pro..._`,
            {
                parse_mode: "Markdown",
                ...Markup.inlineKeyboard([[Markup.button.callback(`${iconOf("ADMIN_CANCEL")} Huỷ`, "ADMIN:CATEGORIES")]])
            }
        );
    });

    // Edit category
    bot.action(/^ADMIN:EDIT_CAT:(.+)$/i, adminOnly, async (ctx) => {
        await ctx.answerCbQuery();
        const catId = ctx.match[1];

        const category = await prisma.category.findUnique({ where: { id: catId } });
        if (!category) {
            return ctx.reply(`${iconOf("STATUS_ERROR")} Danh mục không tồn tại`);
        }

        const msg = `${iconOf("ADMIN_EDIT")} *CHỈNH SỬA DANH MỤC*\n\n` +
            `${category.icon} *${category.name}*\n` +
            `Thứ tự: ${category.order}\n` +
            `Trạng thái: ${iconOf(category.isActive ? "ADMIN_TOGGLE_ON" : "ADMIN_TOGGLE_OFF")} ${category.isActive ? "Hoạt động" : "Tắt"}\n` +
            (category.description ? `${iconOf("ADMIN_ORDERS")} Mô tả: ${category.description.slice(0, 50)}${category.description.length > 50 ? '...' : ''}` : '📋 Mô tả: _(chưa có)_');

        await ctx.editMessageText(msg, {
            parse_mode: "Markdown",
            ...Markup.inlineKeyboard([
                [Markup.button.callback(`${iconOf("ADMIN_NOTE")} Đổi tên`, `ADMIN:CAT_NAME:${catId}`)],
                [Markup.button.callback(`${iconOf("ADMIN_ICON_EDIT")} Đổi icon`, `ADMIN:CAT_ICON:${catId}`)],
                [Markup.button.callback(`${iconOf("ADMIN_QTY")} Đổi thứ tự`, `ADMIN:CAT_ORDER:${catId}`)],
                [Markup.button.callback(`${iconOf("ADMIN_ORDERS")} Sửa mô tả`, `ADMIN:CAT_DESC:${catId}`)],
                [Markup.button.callback(category.imageFileId ? `${iconOf("ADMIN_IMAGE")} Đổi ảnh banner` : `${iconOf("ADMIN_IMAGE")} Thêm ảnh banner`, `ADMIN:CAT_IMAGE:${catId}`)],
                [Markup.button.callback(
                    category.isActive ? `${iconOf("STATUS_ERROR")} Tắt` : `${iconOf("STATUS_SUCCESS")} Bật`,
                    `ADMIN:CAT_TOGGLE:${catId}`
                )],
                [Markup.button.callback(`${iconOf("ADMIN_DELETE")} Xoá danh mục`, `ADMIN:CAT_DELETE:${catId}`)],
                [Markup.button.callback(`${iconOf("NAV_BACK")} Danh sách`, "ADMIN:CATEGORIES")]
            ])
        });
    });

    // Change category name
    bot.action(/^ADMIN:CAT_NAME:(.+)$/i, adminOnly, async (ctx) => {
        await ctx.answerCbQuery();
        const catId = ctx.match[1];
        adminSessions.set(ctx.from.id, { action: "EDIT_CATEGORY_NAME", categoryId: catId });

        await ctx.editMessageText(
            `${iconOf("ADMIN_NOTE")} *ĐỔI TÊN DANH MỤC*\n\nNhập tên mới:`,
            {
                parse_mode: "Markdown",
                ...Markup.inlineKeyboard([[Markup.button.callback(`${iconOf("ADMIN_CANCEL")} Huỷ`, `ADMIN:EDIT_CAT:${catId}`)]])
            }
        );
    });

    // Change category icon
    bot.action(/^ADMIN:CAT_ICON:(.+)$/i, adminOnly, async (ctx) => {
        await ctx.answerCbQuery();
        const catId = ctx.match[1];
        const category = await prisma.category.findUnique({ where: { id: catId } });
        if (!category) return ctx.reply(`${iconOf("STATUS_ERROR")} Không tìm thấy danh mục`);
        adminSessions.set(ctx.from.id, {
            action: "EDIT_CATEGORY_ICON",
            categoryId: catId,
            currentIcon: category.icon || iconOf("ADMIN_CATEGORIES"),
        });

        await ctx.editMessageText(
            `${iconOf("ADMIN_ICON_EDIT")} *ĐỔI ICON DANH MỤC*\n\n` +
            `Nhập emoji hoặc dán Custom Emoji ID:\n\n` +
            `_Ví dụ: 📧 hoặc 5368324170671202286_`,
            {
                parse_mode: "Markdown",
                ...Markup.inlineKeyboard([[Markup.button.callback(`${iconOf("ADMIN_CANCEL")} Huỷ`, `ADMIN:EDIT_CAT:${catId}`)]])
            }
        );
    });

    // Change category order
    bot.action(/^ADMIN:CAT_ORDER:(.+)$/i, adminOnly, async (ctx) => {
        await ctx.answerCbQuery();
        const catId = ctx.match[1];
        adminSessions.set(ctx.from.id, { action: "EDIT_CATEGORY_ORDER", categoryId: catId });

        await ctx.editMessageText(
            `${iconOf("ADMIN_QTY")} *ĐỔI THỨ TỰ DANH MỤC*\n\n` +
            `Nhập số thứ tự (1, 2, 3...):`,
            {
                parse_mode: "Markdown",
                ...Markup.inlineKeyboard([[Markup.button.callback(`${iconOf("ADMIN_CANCEL")} Huỷ`, `ADMIN:EDIT_CAT:${catId}`)]])
            }
        );
    });

    // Edit category description
    bot.action(/^ADMIN:CAT_DESC:(.+)$/i, adminOnly, async (ctx) => {
        await ctx.answerCbQuery();
        const catId = ctx.match[1];
        adminSessions.set(ctx.from.id, { action: "EDIT_CATEGORY_DESC", categoryId: catId });
        await ctx.editMessageText(
            `${iconOf("ADMIN_ORDERS")} *SỬA MÔ TẢ DANH MỤC*\n\nNhập mô tả (hoặc gửi "-" để xoá):`,
            { parse_mode: "Markdown", ...Markup.inlineKeyboard([[Markup.button.callback(`${iconOf("ADMIN_CANCEL")} Huỷ`, `ADMIN:EDIT_CAT:${catId}`)]]) }
        );
    });

    // Edit category banner image
    bot.action(/^ADMIN:CAT_IMAGE:(.+)$/i, adminOnly, async (ctx) => {
        await ctx.answerCbQuery();
        const catId = ctx.match[1];
        adminSessions.set(ctx.from.id, { action: "EDIT_CATEGORY_IMAGE", categoryId: catId });
        await ctx.editMessageText(
            `${iconOf("ADMIN_IMAGE")} *THÊM ẢNH BANNER DANH MỤC*\n\nGửi 1 hình ảnh bất kỳ để đặt làm banner.\nGửi "-" để xoá ảnh hiện tại.`,
            { parse_mode: "Markdown", ...Markup.inlineKeyboard([[Markup.button.callback(`${iconOf("ADMIN_CANCEL")} Huỷ`, `ADMIN:EDIT_CAT:${catId}`)]]) }
        );
    });

    // Toggle category active status
    bot.action(/^ADMIN:CAT_TOGGLE:(.+)$/i, adminOnly, async (ctx) => {
        await ctx.answerCbQuery();
        const catId = ctx.match[1];

        const category = await prisma.category.findUnique({ where: { id: catId } });
        await prisma.category.update({
            where: { id: catId },
            data: { isActive: !category.isActive }
        });
        invalidateCategoryCache();

        await ctx.answerCbQuery(`${iconOf("STATUS_SUCCESS")} Đã ${category.isActive ? 'tắt' : 'bật'} danh mục`);

        // Refresh edit page
        const updatedCat = await prisma.category.findUnique({ where: { id: catId } });
        const msg = `${iconOf("ADMIN_EDIT")} *CHỈNH SỬA DANH MỤC*\n\n` +
            `${updatedCat.icon} *${updatedCat.name}*\n` +
            `Thứ tự: ${updatedCat.order}\n` +
            `Trạng thái: ${iconOf(updatedCat.isActive ? "ADMIN_TOGGLE_ON" : "ADMIN_TOGGLE_OFF")} ${updatedCat.isActive ? "Hoạt động" : "Tắt"}\n` +
            (updatedCat.description ? `${iconOf("ADMIN_ORDERS")} Mô tả: ${updatedCat.description.slice(0, 50)}${updatedCat.description.length > 50 ? '...' : ''}` : '📋 Mô tả: _(chưa có)_');

        await ctx.editMessageText(msg, {
            parse_mode: "Markdown",
            ...Markup.inlineKeyboard([
                [Markup.button.callback(`${iconOf("ADMIN_NOTE")} Đổi tên`, `ADMIN:CAT_NAME:${catId}`)],
                [Markup.button.callback(`${iconOf("ADMIN_ICON_EDIT")} Đổi icon`, `ADMIN:CAT_ICON:${catId}`)],
                [Markup.button.callback(`${iconOf("ADMIN_QTY")} Đổi thứ tự`, `ADMIN:CAT_ORDER:${catId}`)],
                [Markup.button.callback(`${iconOf("ADMIN_ORDERS")} Sửa mô tả`, `ADMIN:CAT_DESC:${catId}`)],
                [Markup.button.callback(updatedCat.imageFileId ? `${iconOf("ADMIN_IMAGE")} Đổi ảnh banner` : `${iconOf("ADMIN_IMAGE")} Thêm ảnh banner`, `ADMIN:CAT_IMAGE:${catId}`)],
                [Markup.button.callback(
                    updatedCat.isActive ? `${iconOf("STATUS_ERROR")} Tắt` : `${iconOf("STATUS_SUCCESS")} Bật`,
                    `ADMIN:CAT_TOGGLE:${catId}`
                )],
                [Markup.button.callback(`${iconOf("ADMIN_DELETE")} Xoá danh mục`, `ADMIN:CAT_DELETE:${catId}`)],
                [Markup.button.callback(`${iconOf("NAV_BACK")} Danh sách`, "ADMIN:CATEGORIES")]
            ])
        });
    });

    // Delete category confirmation
    bot.action(/^ADMIN:CAT_DELETE:(.+)$/i, adminOnly, async (ctx) => {
        await ctx.answerCbQuery();
        const catId = ctx.match[1];

        const category = await prisma.category.findUnique({
            where: { id: catId },
            include: { _count: { select: { products: true } } }
        });

        const msg = `${iconOf("ADMIN_DELETE")} *XOÁ DANH MỤC*\n\n` +
            `${category.icon} *${category.name}*\n\n` +
            `${iconOf("STATUS_WARNING")} Danh mục có ${category._count.products} sản phẩm.\n` +
            `Các sản phẩm sẽ KHÔNG bị xoá, chỉ mất liên kết danh mục.\n\n` +
            `Xác nhận xoá?`;

        await ctx.editMessageText(msg, {
            parse_mode: "Markdown",
            ...Markup.inlineKeyboard([
                [Markup.button.callback(`${iconOf("ADMIN_CONFIRM")} Xác nhận xoá`, `ADMIN:CAT_DELETE_CONFIRM:${catId}`)],
                [Markup.button.callback(`${iconOf("ADMIN_CANCEL")} Huỷ`, `ADMIN:EDIT_CAT:${catId}`)]
            ])
        });
    });

    // Confirm delete category
    bot.action(/^ADMIN:CAT_DELETE_CONFIRM:(.+)$/i, adminOnly, async (ctx) => {
        await ctx.answerCbQuery();
        const catId = ctx.match[1];

        await prisma.category.delete({ where: { id: catId } });
        invalidateCategoryCache();

        await ctx.answerCbQuery(`${iconOf("STATUS_SUCCESS")} Đã xoá danh mục`);

        // Redirect to category list
        const categories = await prisma.category.findMany({
            orderBy: [{ order: 'asc' }, { name: 'asc' }],
            include: { _count: { select: { products: true } } }
        });

        let msg = `${iconOf("ADMIN_CATEGORIES")} *QUẢN LÝ DANH MỤC*\n\n`;

        if (categories.length === 0) {
            msg += `${iconOf("ADMIN_EMPTY")} Chưa có danh mục nào`;
        } else {
            categories.forEach((cat, i) => {
                const status = iconOf(cat.isActive ? "ADMIN_TOGGLE_ON" : "ADMIN_TOGGLE_OFF");
                msg += `${i + 1}. ${cat.icon} *${cat.name}*\n`;
                msg += `   Trạng thái: ${status} | Sản phẩm: ${cat._count.products}\n\n`;
            });
        }

        const buttons = categories.map(cat => [
            Markup.button.callback(`${iconOf("ADMIN_EDIT")} ${cat.icon} ${cat.name}`, `ADMIN:EDIT_CAT:${cat.id}`)
        ]);

        buttons.push(
            [Markup.button.callback(`${iconOf("ADMIN_ADD")} Thêm danh mục`, "ADMIN:ADD_CATEGORY")],
            [Markup.button.callback(`${iconOf("NAV_BACK")} Admin Panel`, "SHOW_ADMIN_PANEL")]
        );

        await ctx.editMessageText(msg, {
            parse_mode: "Markdown",
            ...Markup.inlineKeyboard(buttons)
        });
    });

    // Confirm bank payment
    bot.action(/^ADMIN:CONFIRM_PAY:(.+)$/, adminOnly, async (ctx) => {
        await ctx.answerCbQuery("Đang xử lý...");
        const orderId = ctx.match[1];

        const order = await prisma.order.findUnique({ where: { id: orderId } });
        if (!order) {
            return ctx.reply(`${iconOf("STATUS_ERROR")} Đơn không hợp lệ`);
        }
        if (order.status !== "PENDING") {
            return ctx.reply(`${iconOf("STATUS_ERROR")} Đơn đang ở trạng thái ${order.status}, không thể confirm`);
        }

        // Atomic claim — tránh race với bank-poller/IPN webhook đang xử lý song song
        const claimed = await prisma.order.updateMany({
            where: { id: orderId, status: "PENDING" },
            data: { status: "PAID", paymentRef: order.paymentRef || `MANUAL:${ctx.from.id}` },
        });
        if (claimed.count === 0) {
            return ctx.reply(`${iconOf("STATUS_ERROR")} Đơn đã được xử lý bởi nguồn khác`);
        }

        // Import and call delivery — phải truyền `telegram: bot.telegram`,
        // truyền `bot` trực tiếp khiến delivery.js coi như null → không gửi tin cho user.
        const { deliverOrder } = await import("./delivery.js");
        const updatedOrder = await prisma.order.findUnique({ where: { id: orderId } });
        await deliverOrder({ prisma, telegram: bot.telegram, order: updatedOrder });

        await ctx.editMessageText(
            `${iconOf("STATUS_SUCCESS")} Đã xác nhận và giao hàng: ${orderId.slice(-8)}`,
            Markup.inlineKeyboard([[Markup.button.callback(`${iconOf("NAV_BACK")} Quay lại`, "ADMIN:ORDERS:PENDING")]])
        );
    });

    // === STATS ===
    bot.action("ADMIN:STATS", adminOnly, async (ctx) => {
        await ctx.answerCbQuery();

        await ctx.editMessageText(
            `${iconOf("ADMIN_STATS")} *Chọn khoảng thời gian:*`,
            {
                parse_mode: "Markdown",
                ...Markup.inlineKeyboard([
                    [Markup.button.callback(`${iconOf("ADMIN_DATE")} Hôm nay`, "ADMIN:STATS:today")],
                    [Markup.button.callback(`${iconOf("ADMIN_DATE")} 7 ngày`, "ADMIN:STATS:week")],
                    [Markup.button.callback(`${iconOf("ADMIN_DATE")} 30 ngày`, "ADMIN:STATS:month")],
                    [Markup.button.callback(`${iconOf("ADMIN_TREND")} Tất cả`, "ADMIN:STATS:all")],
                    [Markup.button.callback(`${iconOf("ADMIN_STATS")} Biểu đồ`, "ADMIN:STATS:chart")],
                    [Markup.button.callback(`${iconOf("NAV_BACK")} Quay lại`, "ADMIN:PANEL")],
                ]),
            }
        );
    });

    bot.action(/^ADMIN:STATS:(.+)$/, adminOnly, async (ctx) => {
        await ctx.answerCbQuery();
        const period = ctx.match[1];

        if (period === "chart") {
            const data = await getRevenueByDay(7);
            const chart = generateTextChart(data);

            await ctx.editMessageText(
                `${iconOf("ADMIN_STATS")} *Doanh thu 7 ngày qua*\n\n${chart}`,
                {
                    parse_mode: "Markdown",
                    ...Markup.inlineKeyboard([[Markup.button.callback(`${iconOf("NAV_BACK")} Quay lại`, "ADMIN:STATS")]]),
                }
            );
            return;
        }

        const msg = await getStatsMessage(period);

        await ctx.editMessageText(msg, {
            parse_mode: "Markdown",
            ...Markup.inlineKeyboard([[Markup.button.callback(`${iconOf("NAV_BACK")} Quay lại`, "ADMIN:STATS")]]),
        });
    });

    // === COUPONS ===
    bot.action("ADMIN:COUPONS", adminOnly, async (ctx) => {
        await ctx.answerCbQuery();

        const coupons = await listCoupons();

        let msg = `${iconOf("ADMIN_COUPONS")} *Mã giảm giá*\n\n`;
        for (const c of coupons) {
            const status = iconOf(c.isActive ? "ADMIN_TOGGLE_ON" : "ADMIN_TOGGLE_OFF");
            const type = c.discountType === "PERCENT" ? `${c.discount}%` : `${c.discount.toLocaleString()}đ`;
            msg += `${status} \`${c.code}\` - ${type} (${c.usedCount}/${c.maxUses || "∞"})\n`;
        }

        await ctx.editMessageText(msg, {
            parse_mode: "Markdown",
            ...Markup.inlineKeyboard([
                [Markup.button.callback(`${iconOf("ADMIN_ADD")} Thêm mã`, "ADMIN:ADD_COUPON")],
                [Markup.button.callback(`${iconOf("NAV_BACK")} Quay lại`, "ADMIN:PANEL")],
            ]),
        });
    });

    bot.action("ADMIN:ADD_COUPON", adminOnly, async (ctx) => {
        await ctx.answerCbQuery();
        adminSessions.set(ctx.from.id, { action: "ADD_COUPON" });

        await ctx.editMessageText(
            `${iconOf("ADMIN_ADD")} *Thêm mã giảm giá*\n\nNhập theo format:\n\`CODE|DISCOUNT|TYPE|MAX_USES\`\n\nVí dụ:\n\`SALE50|50|PERCENT|100\`\n\`GIAM10K|10000|FIXED|50\``,
            { parse_mode: "Markdown", ...Markup.inlineKeyboard([[Markup.button.callback(`${iconOf("ADMIN_CANCEL")} Huỷ`, "ADMIN:COUPONS")]]) }
        );
    });

    // === USERS ===
    bot.action("ADMIN:USERS", adminOnly, async (ctx) => {
        await ctx.answerCbQuery();

        const totalUsers = await prisma.user.count();
        const activeToday = await prisma.order.findMany({
            where: { createdAt: { gte: new Date(new Date().setHours(0, 0, 0, 0)) } },
            distinct: ["odelegramId"],
        });

        const topBuyers = await prisma.order.groupBy({
            by: ["odelegramId"],
            where: { status: "DELIVERED" },
            _sum: { finalAmount: true },
            _count: true,
            orderBy: { _sum: { finalAmount: "desc" } },
            take: 5,
        });

        let msg = `${iconOf("ADMIN_USERS")} *Người dùng*\n\n`;
        msg += `${iconOf("ADMIN_STATS")} Tổng: ${totalUsers}\n`;
        msg += `${iconOf("ADMIN_DATE")} Hoạt động hôm nay: ${activeToday.length}\n\n`;
        msg += `${iconOf("ADMIN_TOP")} *Top mua hàng:*\n`;

        for (let i = 0; i < topBuyers.length; i++) {
            const b = topBuyers[i];
            msg += `${i + 1}. ${b.odelegramId} - ${b._sum.finalAmount.toLocaleString()}đ (${b._count} đơn)\n`;
        }

        await ctx.editMessageText(msg, {
            parse_mode: "Markdown",
            ...Markup.inlineKeyboard([[Markup.button.callback(`${iconOf("NAV_BACK")} Quay lại`, "ADMIN:PANEL")]]),
        });
    });

    // === BACKUP ===
    bot.action("ADMIN:BACKUP", adminOnly, async (ctx) => {
        await ctx.answerCbQuery();

        const backups = await listBackups();

        let msg = `${iconOf("ADMIN_SAVE")} *Backup*\n\n`;
        if (backups.length) {
            msg += `${iconOf("ADMIN_CATEGORIES")} Backups gần đây:\n`;
            for (const b of backups.slice(0, 5)) {
                msg += `• ${b.filename} (${(b.size / 1024).toFixed(1)}KB)\n`;
            }
        } else {
            msg += `Chưa có backup nào.`;
        }

        await ctx.editMessageText(msg, {
            parse_mode: "Markdown",
            ...Markup.inlineKeyboard([
                [Markup.button.callback(`${iconOf("ADMIN_SAVE")} Tạo backup ngay`, "ADMIN:CREATE_BACKUP")],
                [Markup.button.callback(`${iconOf("NAV_BACK")} Quay lại`, "ADMIN:PANEL")],
            ]),
        });
    });

    bot.action("ADMIN:CREATE_BACKUP", adminOnly, async (ctx) => {
        await ctx.answerCbQuery("Đang tạo backup...");

        const result = await createBackup(bot);
        await logAction(ctx.from.id, Actions.BACKUP, null, { success: result.success });

        if (result.success) {
            await ctx.editMessageText(
                `${iconOf("STATUS_SUCCESS")} Backup thành công!\n${iconOf("ADMIN_CATEGORIES")} ${result.filename}\n${iconOf("ADMIN_STATS")} ${(result.size / 1024).toFixed(1)}KB`,
                Markup.inlineKeyboard([[Markup.button.callback(`${iconOf("NAV_BACK")} Quay lại`, "ADMIN:BACKUP")]])
            );
        } else {
            await ctx.editMessageText(
                `${iconOf("STATUS_ERROR")} Backup thất bại: ${result.error}`,
                Markup.inlineKeyboard([[Markup.button.callback(`${iconOf("NAV_BACK")} Quay lại`, "ADMIN:BACKUP")]])
            );
        }
    });

    // === VIP MANAGEMENT ===
    bot.action("ADMIN:VIP", adminOnly, async (ctx) => {
        await ctx.answerCbQuery();

        const levels = await getVipLevels();
        let msg = `${iconOf("ADMIN_VIP")} *Quản lý VIP*\n\n`;

        for (const l of levels) {
            msg += `${getVipEmoji(l.level)} *${l.name}* (Level ${l.level})\n`;
            msg += `├─ Chi tiêu: ${l.minSpent.toLocaleString()}đ\n`;
            msg += `├─ Giảm giá: ${l.discountPercent}%\n`;
            msg += `└─ Hoa hồng: ${l.referralBonus}%\n\n`;
        }

        const vipUsers = await prisma.user.count({ where: { vipLevel: { gt: 0 } } });
        msg += `\n${iconOf("ADMIN_STATS")} Tổng VIP: ${vipUsers} users`;

        await ctx.editMessageText(msg, {
            parse_mode: "Markdown",
            ...Markup.inlineKeyboard([
                [Markup.button.callback(`${iconOf("ACCOUNT")} Set VIP User`, "ADMIN:SET_VIP")],
                [Markup.button.callback(`${iconOf("NAV_BACK")} Quay lại`, "ADMIN:PANEL")],
            ]),
        });
    });

    bot.action("ADMIN:SET_VIP", adminOnly, async (ctx) => {
        await ctx.answerCbQuery();
        adminSessions.set(ctx.from.id, { action: "SET_VIP" });

        await ctx.editMessageText(
            `${iconOf("ADMIN_VIP")} *Set VIP cho User*\n\nNhập theo format:\n\`TELEGRAM_ID|LEVEL\`\n\nVí dụ: \`123456789|2\`\n\nLevels: 0=Thường, 1=Bạc, 2=Vàng, 3=Kim Cương`,
            { parse_mode: "Markdown", ...Markup.inlineKeyboard([[Markup.button.callback(`${iconOf("ADMIN_CANCEL")} Huỷ`, "ADMIN:VIP")]]) }
        );
    });

    // === WALLET MANAGEMENT ===
    bot.action("ADMIN:WALLET", adminOnly, async (ctx) => {
        await ctx.answerCbQuery();

        // Get total wallet stats
        const wallets = await prisma.wallet.findMany();
        const totalBalance = wallets.reduce((sum, w) => sum + w.balance, 0);
        const walletCount = wallets.length;

        const msg = `${iconOf("ADMIN_MONEY")} *Quản lý Ví Khách hàng*\n\n` +
            `${iconOf("ADMIN_STATS")} Tổng ví: ${walletCount}\n` +
            `${iconOf("ADMIN_MONEY")} Tổng số dư: ${totalBalance.toLocaleString()}đ\n\n` +
            `Chọn thao tác:`;

        await ctx.editMessageText(msg, {
            parse_mode: "Markdown",
            ...Markup.inlineKeyboard([
                [Markup.button.callback(`${iconOf("ADMIN_SEARCH")} Tra cứu số dư`, "ADMIN:WALLET_CHECK")],
                [Markup.button.callback(`${iconOf("ADMIN_ADD")} Cộng tiền`, "ADMIN:WALLET_ADD")],
                [Markup.button.callback(`${iconOf("WALLET_TX_ADMIN_DEDUCT")} Trừ tiền`, "ADMIN:WALLET_DEDUCT")],
                [Markup.button.callback(`${iconOf("NAV_BACK")} Quay lại`, "ADMIN:PANEL")],
            ]),
        });
    });

    bot.action("ADMIN:WALLET_CHECK", adminOnly, async (ctx) => {
        await ctx.answerCbQuery();
        adminSessions.set(ctx.from.id, { action: "WALLET_CHECK" });

        await ctx.editMessageText(
            `${iconOf("ADMIN_SEARCH")} *Tra cứu số dư*\n\nNhập Telegram ID của khách hàng:`,
            { parse_mode: "Markdown", ...Markup.inlineKeyboard([[Markup.button.callback(`${iconOf("ADMIN_CANCEL")} Huỷ`, "ADMIN:WALLET")]]) }
        );
    });

    bot.action("ADMIN:WALLET_ADD", adminOnly, async (ctx) => {
        await ctx.answerCbQuery();
        adminSessions.set(ctx.from.id, { action: "WALLET_ADD" });

        await ctx.editMessageText(
            `${iconOf("ADMIN_ADD")} *Cộng tiền vào ví*\n\nNhập theo format:\n\`TELEGRAM_ID|SỐ_TIỀN|LÝ_DO\`\n\nVí dụ: \`123456789|50000|Bonus chương trình\``,
            { parse_mode: "Markdown", ...Markup.inlineKeyboard([[Markup.button.callback(`${iconOf("ADMIN_CANCEL")} Huỷ`, "ADMIN:WALLET")]]) }
        );
    });

    bot.action("ADMIN:WALLET_DEDUCT", adminOnly, async (ctx) => {
        await ctx.answerCbQuery();
        adminSessions.set(ctx.from.id, { action: "WALLET_DEDUCT" });

        await ctx.editMessageText(
            `${iconOf("WALLET_TX_ADMIN_DEDUCT")} *Trừ tiền khỏi ví*\n\nNhập theo format:\n\`TELEGRAM_ID|SỐ_TIỀN|LÝ_DO\`\n\nVí dụ: \`123456789|20000|Hoàn hàng\``,
            { parse_mode: "Markdown", ...Markup.inlineKeyboard([[Markup.button.callback(`${iconOf("ADMIN_CANCEL")} Huỷ`, "ADMIN:WALLET")]]) }
        );
    });

    // === BROADCAST ===
    bot.action("ADMIN:BROADCAST", adminOnly, async (ctx) => {
        await ctx.answerCbQuery();

        const history = await getBroadcastHistory(5);
        let msg = `${iconOf("ADMIN_BROADCAST")} *Broadcast*\n\nGửi thông báo đến tất cả users.\n\n`;

        if (history.length) {
            msg += `${iconOf("ADMIN_ORDERS")} *Lịch sử:*\n`;
            for (const b of history) {
                const date = b.createdAt.toLocaleDateString("vi-VN");
                msg += `• ${date}: ${b.sentCount}${iconOf("STATUS_SUCCESS")} ${b.failCount}${iconOf("STATUS_ERROR")}\n`;
            }
        }

        await ctx.editMessageText(msg, {
            parse_mode: "Markdown",
            ...Markup.inlineKeyboard([
                [Markup.button.callback(`${iconOf("ADMIN_BROADCAST")} Gửi Broadcast`, "ADMIN:SEND_BROADCAST")],
                [Markup.button.callback(`${iconOf("ADMIN_VIP")} Gửi VIP Only`, "ADMIN:SEND_VIP_BROADCAST")],
                [Markup.button.callback(`${iconOf("NAV_BACK")} Quay lại`, "ADMIN:PANEL")],
            ]),
        });
    });

    bot.action("ADMIN:SEND_BROADCAST", adminOnly, async (ctx) => {
        await ctx.answerCbQuery();
        adminSessions.set(ctx.from.id, { action: "BROADCAST" });

        await ctx.editMessageText(
            `${iconOf("ADMIN_BROADCAST")} *Gửi Broadcast*\n\nNhập nội dung tin nhắn hoặc gửi ảnh kèm caption:\n\n_Hỗ trợ HTML: <b>bold</b>, <i>italic</i>, <code>code</code>_`,
            { parse_mode: "Markdown", ...Markup.inlineKeyboard([[Markup.button.callback(`${iconOf("ADMIN_CANCEL")} Huỷ`, "ADMIN:BROADCAST")]]) }
        );
    });

    bot.action("ADMIN:SEND_VIP_BROADCAST", adminOnly, async (ctx) => {
        await ctx.answerCbQuery();
        adminSessions.set(ctx.from.id, { action: "VIP_BROADCAST" });

        await ctx.editMessageText(
            `${iconOf("ADMIN_VIP")} *Gửi VIP Broadcast*\n\nNhập nội dung tin nhắn (chỉ gửi cho VIP users):`,
            { parse_mode: "Markdown", ...Markup.inlineKeyboard([[Markup.button.callback(`${iconOf("ADMIN_CANCEL")} Huỷ`, "ADMIN:BROADCAST")]]) }
        );
    });

    // === SELLER API ===
    async function getSellerKeys() {
        const s = await prisma.setting.findUnique({ where: { key: "seller_api_keys" } });
        return s ? JSON.parse(s.value) : [];
    }
    async function saveSellerKeys(keys) {
        await prisma.setting.upsert({ where: { key: "seller_api_keys" }, update: { value: JSON.stringify(keys) }, create: { key: "seller_api_keys", value: JSON.stringify(keys) } });
    }

    bot.action("ADMIN:SELLER_API", adminOnly, async (ctx) => {
        await ctx.answerCbQuery();
        const keys = await getSellerKeys();
        let msg = `${iconOf("ADMIN_SELLER_API")} *API Seller*\n\nCho phép supplier kết nối nạp hàng qua API.\n\n`;
        if (keys.length === 0) {
            msg += `_Chưa có API key nào._`;
        } else {
            msg += `*Danh sách key:*\n`;
            keys.forEach((k, i) => {
                msg += `${i + 1}. ${k.name} — ${k.active !== false ? `${iconOf("STATUS_SUCCESS")} Hoạt động` : `${iconOf("STATUS_ERROR")} Tắt`}\n`;
                msg += `   \`sk_...${k.key.slice(-8)}\`\n`;
            });
        }
        msg += `\n*Base URL:* \`${process.env.WEBHOOK_URL?.replace(/\/$/, "") || "http://SERVER_IP:PORT"}/api/seller\``;
        const btns = [
            [Markup.button.callback(`${iconOf("ADMIN_ADD")} Tạo API key mới`, "ADMIN:API_CREATE_KEY")],
            ...keys.map((k, i) => [
                Markup.button.callback(`${iconOf(k.active !== false ? "ADMIN_TOGGLE_ON" : "ADMIN_TOGGLE_OFF")} ${k.name}`, `ADMIN:API_TOGGLE:${k.id}`),
                Markup.button.callback(iconOf("ADMIN_DELETE"), `ADMIN:API_DEL:${k.id}`),
            ]),
            [Markup.button.callback(`${iconOf("NAV_BACK")} Quay lại`, "ADMIN:PANEL")],
        ];
        await ctx.editMessageText(msg, { parse_mode: "Markdown", ...Markup.inlineKeyboard(btns) });
    });

    bot.action("ADMIN:API_CREATE_KEY", adminOnly, async (ctx) => {
        await ctx.answerCbQuery();
        adminSessions.set(ctx.from.id, { action: "CREATE_API_KEY" });
        await ctx.reply(
            `${iconOf("ADMIN_SELLER_API")} *Tạo API Key mới*\n\nNhập tên cho key này (vd: Supplier A, Nhà cung cấp 1):`,
            { parse_mode: "Markdown", ...Markup.inlineKeyboard([[Markup.button.callback(`${iconOf("ADMIN_CANCEL")} Huỷ`, "ADMIN:SELLER_API")]]) }
        );
    });

    bot.action(/^ADMIN:API_TOGGLE:(.+)$/, adminOnly, async (ctx) => {
        await ctx.answerCbQuery();
        const id = ctx.match[1];
        const keys = await getSellerKeys();
        const k = keys.find(k => k.id === id);
        if (k) { k.active = !k.active; await saveSellerKeys(keys); }
        await showSellerApiScreen(ctx);
    });

    bot.action(/^ADMIN:API_DEL:(.+)$/, adminOnly, async (ctx) => {
        await ctx.answerCbQuery();
        const id = ctx.match[1];
        let keys = await getSellerKeys();
        keys = keys.filter(k => k.id !== id);
        await saveSellerKeys(keys);
        await showSellerApiScreen(ctx);
    });

    async function showSellerApiScreen(ctx) {
        const keys = await getSellerKeys();
        let msg = `${iconOf("ADMIN_SELLER_API")} *API Seller*\n\n`;
        if (keys.length === 0) {
            msg += `_Chưa có API key nào._`;
        } else {
            keys.forEach((k, i) => {
                msg += `${i + 1}. ${k.name} — ${iconOf(k.active !== false ? "ADMIN_TOGGLE_ON" : "ADMIN_TOGGLE_OFF")}\n   \`sk_...${k.key.slice(-8)}\`\n`;
            });
        }
        const btns = [
            [Markup.button.callback(`${iconOf("ADMIN_ADD")} Tạo API key mới`, "ADMIN:API_CREATE_KEY")],
            ...keys.map((k) => [
                Markup.button.callback(`${iconOf(k.active !== false ? "ADMIN_TOGGLE_ON" : "ADMIN_TOGGLE_OFF")} ${k.name}`, `ADMIN:API_TOGGLE:${k.id}`),
                Markup.button.callback(iconOf("ADMIN_DELETE"), `ADMIN:API_DEL:${k.id}`),
            ]),
            [Markup.button.callback(`${iconOf("NAV_BACK")} Quay lại`, "ADMIN:PANEL")],
        ];
        await ctx.editMessageText(msg, { parse_mode: "Markdown", ...Markup.inlineKeyboard(btns) });
    }

    // === EXPORT ===
    bot.action("ADMIN:EXPORT", adminOnly, async (ctx) => {
        await ctx.answerCbQuery();

        await ctx.editMessageText(
            `${iconOf("ADMIN_IMPORT")} *Export Báo Cáo*\n\nChọn loại báo cáo:`,
            {
                parse_mode: "Markdown",
                ...Markup.inlineKeyboard([
                    [Markup.button.callback(`${iconOf("ADMIN_ORDERS")} Đơn hàng`, "ADMIN:EXPORT:ORDERS")],
                    [Markup.button.callback(`${iconOf("ADMIN_MONEY")} Doanh thu`, "ADMIN:EXPORT:REVENUE")],
                    [Markup.button.callback(`${iconOf("ADMIN_USERS")} Users`, "ADMIN:EXPORT:USERS")],
                    [Markup.button.callback(`${iconOf("ADMIN_PRODUCTS")} Sản phẩm`, "ADMIN:EXPORT:PRODUCTS")],
                    [Markup.button.callback(`${iconOf("NAV_BACK")} Quay lại`, "ADMIN:PANEL")],
                ]),
            }
        );
    });

    bot.action("ADMIN:EXPORT:ORDERS", adminOnly, async (ctx) => {
        await ctx.answerCbQuery("Đang xuất...");

        try {
            const result = await exportOrdersCSV();
            await ctx.replyWithDocument({ source: result.filepath, filename: result.filename }, {
                caption: `${iconOf("ADMIN_ORDERS")} Xuất đơn hàng thành công!\n${iconOf("ADMIN_STATS")} ${result.count} đơn`,
            });
        } catch (e) {
            await ctx.reply(`${iconOf("STATUS_ERROR")} Lỗi: ${e.message}`);
        }
    });

    bot.action("ADMIN:EXPORT:REVENUE", adminOnly, async (ctx) => {
        await ctx.answerCbQuery("Đang xuất...");

        try {
            const result = await exportRevenueCSV(30);
            await ctx.replyWithDocument({ source: result.filepath, filename: result.filename }, {
                caption: `${iconOf("ADMIN_MONEY")} Doanh thu ${result.days} ngày\n${iconOf("ADMIN_STATS")} ${result.totalOrders} đơn | ${result.totalRevenue.toLocaleString()}đ`,
            });
        } catch (e) {
            await ctx.reply(`${iconOf("STATUS_ERROR")} Lỗi: ${e.message}`);
        }
    });

    bot.action("ADMIN:EXPORT:USERS", adminOnly, async (ctx) => {
        await ctx.answerCbQuery("Đang xuất...");

        try {
            const result = await exportUsersCSV();
            await ctx.replyWithDocument({ source: result.filepath, filename: result.filename }, {
                caption: `${iconOf("ADMIN_USERS")} Xuất users thành công!\n${iconOf("ADMIN_STATS")} ${result.count} users`,
            });
        } catch (e) {
            await ctx.reply(`${iconOf("STATUS_ERROR")} Lỗi: ${e.message}`);
        }
    });

    bot.action("ADMIN:EXPORT:PRODUCTS", adminOnly, async (ctx) => {
        await ctx.answerCbQuery("Đang xuất...");

        try {
            const result = await exportProductsCSV();
            await ctx.replyWithDocument({ source: result.filepath, filename: result.filename }, {
                caption: `${iconOf("ADMIN_PRODUCTS")} Xuất sản phẩm thành công!\n${iconOf("ADMIN_STATS")} ${result.count} sản phẩm`,
            });
        } catch (e) {
            await ctx.reply(`${iconOf("STATUS_ERROR")} Lỗi: ${e.message}`);
        }
    });

    // === AUDIT LOGS ===
    bot.action("ADMIN:LOGS", adminOnly, async (ctx) => {
        await ctx.answerCbQuery();

        const logs = await getRecentLogs(15);
        let msg = `${iconOf("ADMIN_NOTE")} *Nhật ký Admin*\n\n`;

        if (logs.length) {
            for (const log of logs) {
                msg += `${formatLog(log)}\n`;
            }
        } else {
            msg += `Chưa có logs.`;
        }

        await ctx.editMessageText(msg, {
            parse_mode: "Markdown",
            ...Markup.inlineKeyboard([[Markup.button.callback(`${iconOf("NAV_BACK")} Quay lại`, "ADMIN:PANEL")]]),
        });
    });

    // === TEXT HANDLERS FOR MULTI-STEP are consolidated below ===

    // === DOCUMENT HANDLER FOR FILE UPLOAD (TXT STOCK) ===
    bot.on("document", async (ctx, next) => {
        const session = adminSessions.get(ctx.from.id);
        if (!session) return next();
        if (!isAdmin(ctx.from.id)) return next();

        // Mode 1: Add stock — mỗi dòng trong file = 1 stock item
        if (session.action === "ADD_STOCK") {
            const doc = ctx.message.document;

            // Basic validation
            if (doc.mime_type !== "text/plain" && !doc.file_name.endsWith(".txt")) {
                return ctx.reply(`${iconOf("STATUS_ERROR")} Vui lòng gửi file .txt`);
            }

            try {
                // Get file link
                const fileLink = await ctx.telegram.getFileLink(doc.file_id);
                const response = await fetch(fileLink.href);
                const text = await response.text();

                const lines = text.split("\n").map((l) => l.trim()).filter((l) => l.length > 0);

                if (lines.length === 0) {
                    return ctx.reply(`${iconOf("STATUS_ERROR")} File trống hoặc không có dòng nào hợp lệ.`);
                }

                // Add to DB
                await prisma.stockItem.createMany({
                    data: lines.map((content) => ({ productId: session.productId, content, isSold: false })),
                });

                const total = await prisma.stockItem.count({ where: { productId: session.productId, isSold: false } });
                adminSessions.delete(ctx.from.id);

                await ctx.reply(`${iconOf("STATUS_SUCCESS")} Đã đọc file và thêm ${lines.length} stock Items!\nTổng còn: ${total}`);
            } catch (e) {
                console.error("File upload error:", e);
                await ctx.reply(`${iconOf("STATUS_ERROR")} Lỗi đọc file: ${e.message}`);
            }
            return;
        }

        // Mode 2: Add stock — mỗi file = 1 stock item (giữ nguyên content)
        if (session.action === "ADD_STOCK_FILE_PER_ITEM") {
            const doc = ctx.message.document;

            if (doc.mime_type !== "text/plain" && !doc.file_name.endsWith(".txt")) {
                return ctx.reply(`${iconOf("STATUS_ERROR")} Vui lòng gửi file .txt`);
            }

            try {
                const fileLink = await ctx.telegram.getFileLink(doc.file_id);
                const response = await fetch(fileLink.href);
                const text = await response.text();
                const content = text.replace(/\r\n/g, "\n").replace(/\s+$/g, "").trim();

                if (!content) {
                    return ctx.reply(`${iconOf("STATUS_ERROR")} File trống. Bỏ qua.`);
                }

                await prisma.stockItem.create({
                    data: { productId: session.productId, content, isSold: false },
                });

                session.uploadedCount = (session.uploadedCount || 0) + 1;
                adminSessions.set(ctx.from.id, session);

                const total = await prisma.stockItem.count({ where: { productId: session.productId, isSold: false } });
                await ctx.reply(
                    `${iconOf("STATUS_SUCCESS")} Đã thêm: ${doc.file_name}\n${iconOf("ADMIN_PRODUCTS")} Session: ${session.uploadedCount} | Tổng còn: ${total}\n\nGửi tiếp file khác hoặc bấm *Xong*.`,
                    {
                        parse_mode: "Markdown",
                        ...Markup.inlineKeyboard([
                            [Markup.button.callback(`${iconOf("ADMIN_CONFIRM")} Xong`, `ADMIN:STOCK_FILE_DONE:${session.productId}`)],
                        ]),
                    }
                );
            } catch (e) {
                console.error("File-per-item upload error:", e);
                await ctx.reply(`${iconOf("STATUS_ERROR")} Lỗi đọc file: ${e.message}`);
            }
            return;
        }

        return next();
    });

    bot.on("photo", async (ctx, next) => {
        const session = adminSessions.get(ctx.from.id);
        if (!session) return next();
        if (!isAdmin(ctx.from.id)) return next();

        if (session.action === "BROADCAST" || session.action === "VIP_BROADCAST") {
            adminSessions.delete(ctx.from.id);
            const photos = ctx.message.photo;
            const fileId = photos[photos.length - 1].file_id; // highest resolution
            const caption = ctx.message.caption || "";
            await ctx.reply(`${iconOf("ADMIN_BROADCAST")} Đang gửi broadcast ảnh...`);
            try {
                const result = await sendBroadcastPhoto(bot, fileId, caption, ctx.from.id);
                await ctx.reply(
                    `${iconOf("STATUS_SUCCESS")} *Broadcast ảnh hoàn tất!*\n\n${iconOf("ADMIN_EXPORT")} Đã gửi: ${result.sentCount}\n${iconOf("STATUS_ERROR")} Thất bại: ${result.failCount}\n${iconOf("ADMIN_STATS")} Tổng: ${result.total}`,
                    { parse_mode: "Markdown" }
                );
            } catch (e) {
                await ctx.reply(`${iconOf("STATUS_ERROR")} Lỗi broadcast ảnh: ${e.message}`);
            }
            return;
        }

        return next();
    });

    bot.on("sticker", async (ctx, next) => {
        if (!isAdmin(ctx.from?.id)) return next();

        const session = adminSessions.get(ctx.from.id);
        const sticker = ctx.message?.sticker;
        if (!sticker) return next();

        // Regular sticker (no custom_emoji_id) — only show error when inside icon edit session
        if (!sticker.custom_emoji_id) {
            const iconSessions = ["CHANGE_PRODUCT_ICON", "EDIT_MENU_ICON", "ADD_CATEGORY_ICON", "EDIT_CATEGORY_ICON"];
            if (session && iconSessions.includes(session.action)) {
                await ctx.reply(
                    `${iconOf("STATUS_ERROR")} Sticker thường không dùng được làm icon.\n\n` +
                    "Hãy dùng Custom Emoji:\n" +
                    "1️⃣ Nhấn 😊 trong ô nhập tin nhắn\n" +
                    "2️⃣ Chọn tab Custom Emoji (icon ✨)\n" +
                    "3️⃣ Gửi custom emoji trực tiếp\n\n" +
                    "_Hoặc gõ emoji thường như 🎨 nếu không cần icon động._",
                    { parse_mode: "Markdown" }
                );
            }
            return;
        }

        if (session.action === "CHANGE_PRODUCT_ICON") {
            const iconPayload = extractIconPayloadFromStickerMessage(ctx.message);
            if (!iconPayload?.icon) return ctx.reply(`${iconOf("STATUS_ERROR")} Không đọc được custom emoji từ sticker.`);
            await prisma.product.update({
                where: { id: session.productId },
                data: { icon: iconPayload.icon, iconEmojiId: iconPayload.iconEmojiId },
            });
            invalidateCategoryCache();
            invalidateEmojiCache();
            adminSessions.delete(ctx.from.id);
            await ctx.reply(`${iconOf("STATUS_SUCCESS")} Đã đổi icon ${session.productName} thành: ${iconPayload.icon}`);
            return;
        }

        if (session.action === "EDIT_MENU_ICON") {
            const iconPayload = extractIconPayloadFromStickerMessage(ctx.message);
            if (!iconPayload?.icon) return ctx.reply(`${iconOf("STATUS_ERROR")} Không đọc được custom emoji từ sticker.`);
            adminSessions.delete(ctx.from.id);
            const { menuAction } = session;
            await setMenuIcon(menuAction, iconPayload.icon, iconPayload.iconEmojiId);
            invalidateMenuCache();
            const label = BUTTON_LABELS[menuAction] ?? menuAction;
            const newIcons = await getMenuIcons();
            await ctx.reply(
                `${iconOf("STATUS_SUCCESS")} Đã đổi icon <b>${label}</b>: ${iconPayload.icon}`,
                { parse_mode: "HTML", ...buildReplyKeyboard({ isAdmin: true, icons: newIcons }) }
            );
            await sendMenuConfigScreen(ctx, false);
            return;
        }

        if (!session || !["ADD_CATEGORY_ICON", "EDIT_CATEGORY_ICON"].includes(session.action)) {
            // No matching session → admin is just checking the ID
            await ctx.reply(
                `🆔 <b>Custom Emoji ID</b>\n\n<code>${sticker.custom_emoji_id}</code>\n\nEmoji: ${sticker.emoji || "?"}\n\n<i>Dán ID này vào web admin → Settings → Icons để đặt icon động.</i>`,
                { parse_mode: "HTML" }
            );
            return;
        }

        await saveCategoryIconSession(ctx, session, extractIconPayloadFromStickerMessage(ctx.message));
        return;
    });

    // Handle photo upload for product image and category banner
    bot.on("photo", async (ctx, next) => {
        const session = adminSessions.get(ctx.from.id);
        if (!session) return next();
        if (!isAdmin(ctx.from.id)) return next();

        // Handle category banner image
        if (session.action === "EDIT_CATEGORY_IMAGE") {
            const photos = ctx.message.photo;
            const fileId = photos[photos.length - 1].file_id;
            await prisma.category.update({
                where: { id: session.categoryId },
                data: { imageFileId: fileId }
            });
            invalidateCategoryCache();
            adminSessions.delete(ctx.from.id);
            await ctx.reply(`${iconOf("STATUS_SUCCESS")} Đã cập nhật ảnh banner danh mục.`);
            return;
        }

        if (session.action !== "SET_PRODUCT_IMAGE") return next();

        // Get largest photo (last in array)
        const photos = ctx.message.photo;
        const best = photos[photos.length - 1];
        const fileId = best.file_id;

        await prisma.product.update({
            where: { id: session.productId },
            data: { imageFileId: fileId, imageUrl: null },
        });
        invalidateCategoryCache();
        adminSessions.delete(ctx.from.id);
        await ctx.reply(
            `${iconOf("STATUS_SUCCESS")} Đã cập nhật ảnh cho <b>${escapeHtml(session.productName)}</b>`,
            { parse_mode: "HTML", ...Markup.inlineKeyboard([[Markup.button.callback(`${iconOf("NAV_BACK")} Về sản phẩm`, `ADMIN:EDIT:${session.productId}`)]])}
        );
    });

    // === WELCOME MESSAGE CONFIG ===
    bot.action("ADMIN:WELCOME_CONFIG", adminOnly, async (ctx) => {
        await ctx.answerCbQuery();
        const current = (await getWelcomeGreeting()) ?? DEFAULT_WELCOME_GREETING;
        adminSessions.set(ctx.from.id, { action: "EDIT_WELCOME_MSG" });
        await ctx.reply(
            `${iconOf("ADMIN_EDIT")} <b>Sửa lời chào mừng</b>\n\nHiện tại:\n${current}\n\n`
            + `Dùng <code>{name}</code> để chèn tên. Emoji động được hỗ trợ.\n\nGửi nội dung mới hoặc /cancel để huỷ:`,
            { parse_mode: "HTML" }
        );
    });

    // === PRODUCT DISPLAY SETTINGS ===
    async function sendProductDisplayScreen(ctx, edit = false) {
        const d = await getProductDisplaySettings();
        const on = iconOf("ADMIN_TOGGLE_ON");
        const off = iconOf("ADMIN_TOGGLE_OFF");
        const fields = [
            { key: "price", label: "Giá bán" },
            { key: "stock", label: "Tồn kho" },
            { key: "sold", label: "Đã bán" },
            { key: "description", label: "Mô tả" },
        ];
        const rows = fields.map(({ key, label }) => [
            Markup.button.callback(`${d[key] ? on : off} ${label}`, `ADMIN:TOGGLE_DISPLAY:${key}`),
        ]);
        rows.push([Markup.button.callback(`${iconOf("NAV_BACK")} Quay lại`, "ADMIN:PANEL")]);
        const msg = `${iconOf("ADMIN_PRODUCT_DISPLAY")} <b>Hiển thị thông tin sản phẩm</b>\n\nBấm để bật/tắt từng trường trong chi tiết sản phẩm:`;
        const kb = Markup.inlineKeyboard(rows);
        if (edit) {
            await ctx.editMessageText(msg, { parse_mode: "HTML", ...kb }).catch(() => {});
        } else {
            await ctx.reply(msg, { parse_mode: "HTML", ...kb });
        }
    }

    bot.action("ADMIN:PRODUCT_DISPLAY", adminOnly, async (ctx) => {
        await ctx.answerCbQuery();
        await sendProductDisplayScreen(ctx, true);
    });

    bot.action(/^ADMIN:TOGGLE_DISPLAY:(.+)$/, adminOnly, async (ctx) => {
        await ctx.answerCbQuery();
        const field = ctx.match[1];
        const valid = ["price", "stock", "sold", "description"];
        if (!valid.includes(field)) return;
        const d = await getProductDisplaySettings();
        d[field] = !d[field];
        await setProductDisplaySettings(d);
        await sendProductDisplayScreen(ctx, true);
    });

    // === MENU ICON CONFIG ===
    async function sendMenuConfigScreen(ctx, edit = false) {
        const [icons, iconIds] = await Promise.all([getMenuIcons(), getMenuIconIds()]);
        const msg = `${iconOf("ADMIN_MENU_CONFIG")} <b>Giao diện menu</b>\n\nBấm tên nút để đổi icon · ↩ để reset mặc định:`;
        const buttons = Object.entries(BUTTON_LABELS).map(([action, label]) => {
            const icon = icons[action] ?? DEFAULT_ICONS[action] ?? "";
            const customId = iconIds[action];
            const isDefault = !customId && icon === (DEFAULT_ICONS[action] ?? "");
            const editBtn = { text: customId ? label : `${icon} ${label}`, callback_data: `ADMIN:EDIT_BTN:${action}` };
            if (customId) editBtn.icon_custom_emoji_id = customId;
            return [
                editBtn,
                ...(isDefault ? [] : [Markup.button.callback("↩", `ADMIN:RESET_BTN:${action}`)]),
            ];
        });
        buttons.push([Markup.button.callback(`${iconOf("ADMIN_RESET")} Reset TẤT CẢ về mặc định`, "ADMIN:RESET_ALL_ICONS")]);
        const backIcon = iconIds["NAV_BACK"]
            ? { text: "Quay lại", callback_data: "ADMIN:PANEL", icon_custom_emoji_id: iconIds["NAV_BACK"] }
            : { text: `${iconOf("NAV_BACK")} Quay lại`, callback_data: "ADMIN:PANEL" };
        buttons.push([backIcon]);
        const kb = Markup.inlineKeyboard(buttons);
        if (edit) {
            await ctx.editMessageText(msg, { parse_mode: "HTML", ...kb });
        } else {
            await ctx.reply(msg, { parse_mode: "HTML", ...kb });
        }
    }

    bot.action("ADMIN:MENU_CONFIG", adminOnly, async (ctx) => {
        await ctx.answerCbQuery();
        await sendMenuConfigScreen(ctx, true);
    });

    bot.action(/^ADMIN:EDIT_BTN:(.+)$/, adminOnly, async (ctx) => {
        await ctx.answerCbQuery();
        const action = ctx.match[1];
        const label = BUTTON_LABELS[action];
        if (!label) return ctx.reply("Nút không hợp lệ.");
        const [icons, iconIds] = await Promise.all([getMenuIcons(), getMenuIconIds()]);
        const current = icons[action] ?? DEFAULT_ICONS[action] ?? "";
        adminSessions.set(ctx.from.id, { action: "EDIT_MENU_ICON", menuAction: action, currentIcon: current });
        await ctx.reply(
            `Đang sửa: <b>${label}</b>\nIcon hiện tại: ${current}${iconIds[action] ? `\nID hiện tại: <code>${iconIds[action]}</code>` : ""}\n\n` +
            `Gửi icon mới theo 1 trong 2 cách:\n` +
            `• Gõ emoji thường: <code>🎯</code>\n` +
            `• Gửi sticker custom emoji động hoặc dán trực tiếp Custom Emoji ID`,
            { parse_mode: "HTML" }
        );
    });

    bot.action(/^ADMIN:RESET_BTN:(.+)$/, adminOnly, async (ctx) => {
        await ctx.answerCbQuery();
        const action = ctx.match[1];
        const label = BUTTON_LABELS[action];
        if (!label) return;
        await setMenuIcon(action, DEFAULT_ICONS[action] ?? "", null);
        invalidateMenuCache();
        const newIcons = await getMenuIcons();
        await ctx.answerCbQuery(`↩ Đã reset icon ${label}`);
        await sendMenuConfigScreen(ctx, true);
        await ctx.reply(
            `↩ Đã reset icon nút <b>${label}</b> về mặc định.`,
            { parse_mode: "HTML", ...buildReplyKeyboard({ isAdmin: true, icons: newIcons }) }
        );
    });

    bot.action("ADMIN:RESET_ALL_ICONS", adminOnly, async (ctx) => {
        await ctx.answerCbQuery();
        await resetAllMenuIcons();
        invalidateMenuCache();
        const newIcons = await getMenuIcons();
        await sendMenuConfigScreen(ctx, true);
        await ctx.reply(
            `${iconOf("ADMIN_RESET")} Đã reset <b>tất cả icon</b> về mặc định.`,
            { parse_mode: "HTML", ...buildReplyKeyboard({ isAdmin: true, icons: newIcons }) }
        );
    });

    // Admin: gửi text chứa custom emoji khi không trong session → hiện tất cả ID tìm được
    bot.on("text", async (ctx, next) => {
        if (!isAdmin(ctx.from?.id)) return next();
        const session = adminSessions.get(ctx.from.id);
        if (session) return next(); // đang trong session → để handler khác xử lý
        const entities = ctx.message.entities || [];
        const customEmojis = entities.filter(e => e.type === "custom_emoji");
        if (!customEmojis.length) return next();
        // Admin paste custom emoji vào chat → trả về danh sách ID
        const lines = customEmojis.map((e, i) => {
            const char = ctx.message.text.slice(e.offset, e.offset + e.length);
            return `${i + 1}. ${char}  →  <code>${e.custom_emoji_id}</code>`;
        });
        await ctx.reply(
            `🆔 <b>Custom Emoji ID${customEmojis.length > 1 ? "s" : ""}</b>\n\n${lines.join("\n")}\n\n<i>Dán ID vào web admin → Settings → Icons.</i>`,
            { parse_mode: "HTML" }
        );
        return;
    });

    // === TEXT HANDLERS FOR MULTI-STEP ===
    bot.on("text", async (ctx, next) => {
        const session = adminSessions.get(ctx.from.id);
        if (!session) return next();
        if (!isAdmin(ctx.from.id)) return next();

        const text = ctx.message.text.trim();
        if (text.startsWith("/")) {
            adminSessions.delete(ctx.from.id);
            return next();
        }

        // Welcome message edit flow
        if (session.action === "EDIT_WELCOME_MSG") {
            adminSessions.delete(ctx.from.id);
            const entities = ctx.message.entities || [];
            const htmlGreeting = buildHtmlFromMessage(text, entities);
            await setWelcomeGreeting(htmlGreeting);
            invalidateMenuCache();
            await ctx.reply(
                `${iconOf("STATUS_SUCCESS")} Đã cập nhật lời chào mừng:\n${htmlGreeting}`,
                { parse_mode: "HTML" }
            );
            return;
        }

        // Menu icon edit flow
        if (session.action === "EDIT_MENU_ICON") {
            adminSessions.delete(ctx.from.id);
            const { menuAction } = session;
            const iconPayload = extractIconPayloadFromTextMessage(ctx.message, session.currentIcon);
            await setMenuIcon(menuAction, iconPayload.icon, iconPayload.iconEmojiId);
            invalidateMenuCache();
            const label = BUTTON_LABELS[menuAction] ?? menuAction;
            const newIcons = await getMenuIcons();
            await ctx.reply(
                `${iconOf("STATUS_SUCCESS")} Đã đổi icon nút <b>${label}</b> thành: ${iconPayload.icon}`,
                { parse_mode: "HTML", ...buildReplyKeyboard({ isAdmin: true, icons: newIcons }) }
            );
            await sendMenuConfigScreen(ctx, false);
            return;
        }

        // Add product flow (code is auto-generated, starts at step 2)
        if (session.action === "ADD_PRODUCT") {
            if (session.step === 2) {
                session.name = text;
                session.step = 3;
                await ctx.reply("Bước 3/5: Nhập giá (VND):");
            } else if (session.step === 3) {
                session.price = parseInt(text.replace(/[,.]/g, ""), 10);
                if (isNaN(session.price)) {
                    return ctx.reply(`${iconOf("STATUS_ERROR")} Giá không hợp lệ. Nhập lại:`);
                }
                session.step = 4;
                await ctx.reply("Bước 4/5: Nhập lưu ý/mô tả sản phẩm (hoặc gõ 'skip' để bỏ qua):");
            } else if (session.step === 4) {
                session.notes = text.toLowerCase() === 'skip' ? '' : text;
                session.step = 5;
                await ctx.reply(
                    "Bước 5/5: Chọn mode giao hàng:",
                    Markup.inlineKeyboard([
                        [Markup.button.callback(`${iconOf("ADMIN_NOTE")} TEXT`, "ADMIN:MODE:TEXT")],
                        [Markup.button.callback(`${iconOf("ADMIN_CATEGORIES")} FILE`, "ADMIN:MODE:FILE")],
                        [Markup.button.callback(`${iconOf("ADMIN_STATS")} STOCK_LINES`, "ADMIN:MODE:STOCK_LINES")],
                        [Markup.button.callback(`${iconOf("ACCOUNT")} CONTACT (Liên hệ admin)`, "ADMIN:MODE:CONTACT")],
                    ])
                );
            }
            return;
        }

        // Add stock flow (TEXT)
        if (session.action === "ADD_STOCK") {
            try {
                const lines = text.split("\n").map((l) => l.trim()).filter((l) => l.length > 0);
                if (lines.length === 0) {
                    return ctx.reply(`${iconOf("STATUS_ERROR")} Không có dữ liệu hợp lệ. Thử lại:`);
                }

                console.log(`[ADMIN] Adding ${lines.length} stock items for product ${session.productId}`);

                await prisma.stockItem.createMany({
                    data: lines.map((content) => ({ productId: session.productId, content, isSold: false })),
                });

                const total = await prisma.stockItem.count({ where: { productId: session.productId, isSold: false } });
                adminSessions.delete(ctx.from.id);

                console.log(`[ADMIN] Stock added successfully. Total: ${total}`);
                await ctx.reply(`${iconOf("STATUS_SUCCESS")} Đã nạp ${lines.length} tài khoản!\nTổng còn: ${total}`);
            } catch (e) {
                console.error(`[ADMIN] Stock add error:`, e);
                await ctx.reply(`${iconOf("STATUS_ERROR")} Lỗi khi nạp stock: ${e.message}`);
            }
            return;
        }

        // Add coupon flow
        if (session.action === "ADD_COUPON") {
            const parts = text.split("|").map((s) => s.trim());
            if (parts.length < 3) {
                return ctx.reply(`${iconOf("STATUS_ERROR")} Sai format. Nhập lại: CODE|DISCOUNT|TYPE|MAX_USES`);
            }

            const [code, discountStr, type, maxUsesStr] = parts;
            const discount = parseInt(discountStr, 10);
            const maxUses = maxUsesStr ? parseInt(maxUsesStr, 10) : null;

            if (isNaN(discount)) {
                return ctx.reply(`${iconOf("STATUS_ERROR")} Discount không hợp lệ`);
            }

            try {
                await createCoupon({
                    code,
                    discount,
                    discountType: type.toUpperCase() === "PERCENT" ? "PERCENT" : "FIXED",
                    maxUses,
                });

                adminSessions.delete(ctx.from.id);
                await ctx.reply(`${iconOf("STATUS_SUCCESS")} Đã tạo mã: ${code.toUpperCase()}`);
            } catch (e) {
                await ctx.reply(`${iconOf("STATUS_ERROR")} Lỗi: ${e.message}`);
            }
            return;
        }

        // Change price flow
        if (session.action === "CHANGE_PRICE") {
            const newPrice = parseInt(text.replace(/[,.]/g, ""), 10);
            if (isNaN(newPrice) || newPrice <= 0) {
                return ctx.reply(`${iconOf("STATUS_ERROR")} Giá không hợp lệ. Nhập lại:`);
            }

            await prisma.product.update({
                where: { id: session.productId },
                data: { price: newPrice },
            });
            invalidateCategoryCache();

            adminSessions.delete(ctx.from.id);
            const priceLabel = session.currency === "USD" ? `$${newPrice.toLocaleString("en-US")}` : `${newPrice.toLocaleString("vi-VN")}đ`;
            await ctx.reply(`${iconOf("STATUS_SUCCESS")} Đã đổi giá ${session.productName} thành ${priceLabel}`);
            return;
        }

        // Change product icon flow
        if (session.action === "CHANGE_PRODUCT_ICON") {
            const iconPayload = extractIconPayloadFromTextMessage(ctx.message, session.currentIcon);
            if (text.toLowerCase() === "reset") {
                await prisma.product.update({
                    where: { id: session.productId },
                    data: { icon: null, iconEmojiId: null },
                });
                invalidateCategoryCache();
                invalidateEmojiCache();
                adminSessions.delete(ctx.from.id);
                await ctx.reply(`${iconOf("STATUS_SUCCESS")} Đã xóa icon tùy chỉnh. ${session.productName} sẽ dùng icon tự động.`);
                return;
            }
            if (!iconPayload?.icon) return ctx.reply(`${iconOf("STATUS_ERROR")} Không đọc được icon. Gửi lại emoji hoặc sticker.`);
            await prisma.product.update({
                where: { id: session.productId },
                data: { icon: iconPayload.icon, iconEmojiId: iconPayload.iconEmojiId },
            });
            invalidateCategoryCache();
            invalidateEmojiCache();
            adminSessions.delete(ctx.from.id);
            await ctx.reply(`${iconOf("STATUS_SUCCESS")} Đã đổi icon ${session.productName} thành: ${iconPayload.icon}`);
            return;
        }

        // Change payload flow
        if (session.action === "CHANGE_PAYLOAD") {
            await prisma.product.update({
                where: { id: session.productId },
                data: { payload: text },
            });
            invalidateCategoryCache();

            await logAction(ctx.from.id, Actions.CHANGE_PAYLOAD, session.productName);
            adminSessions.delete(ctx.from.id);
            await ctx.reply(`${iconOf("STATUS_SUCCESS")} Đã cập nhật payload cho ${session.productName}`);
            return;
        }

        // Change description flow
        if (session.action === "CHANGE_DESC") {
            const newDesc = text.toLowerCase().trim() === "xoa" ? null : text.trim();

            await prisma.product.update({
                where: { id: session.productId },
                data: { description: newDesc },
            });
            invalidateCategoryCache();

            await logAction(ctx.from.id, Actions.CHANGE_DESC, session.productName);
            adminSessions.delete(ctx.from.id);

            await ctx.reply(
                newDesc
                    ? `${iconOf("STATUS_SUCCESS")} Đã cập nhật mô tả cho <b>${escapeHtml(session.productName)}</b>:\n\n<blockquote>${escapeHtml(newDesc)}</blockquote>`
                    : `${iconOf("STATUS_SUCCESS")} Đã xóa mô tả của <b>${escapeHtml(session.productName)}</b>`,
                {
                    parse_mode: "HTML",
                    ...Markup.inlineKeyboard([[Markup.button.callback(`${iconOf("NAV_BACK")} Về sản phẩm`, `ADMIN:EDIT:${session.productId}`)]]),
                }
            );
            return;
        }

        // Rename product
        if (session.action === "RENAME_PRODUCT") {
            if (!text.trim()) return ctx.reply(`${iconOf("STATUS_ERROR")} Tên không được trống`);
            await prisma.product.update({ where: { id: session.productId }, data: { name: text.trim() } });
            invalidateCategoryCache();
            adminSessions.delete(ctx.from.id);
            await ctx.reply(
                `${iconOf("STATUS_SUCCESS")} Đã đổi tên thành <b>${escapeHtml(text.trim())}</b>`,
                { parse_mode: "HTML", ...Markup.inlineKeyboard([[Markup.button.callback(`${iconOf("NAV_BACK")} Về sản phẩm`, `ADMIN:EDIT:${session.productId}`)]])}
            );
            return;
        }

        // Recode product
        if (session.action === "RECODE_PRODUCT") {
            const newCode = text.trim().toUpperCase();
            if (!newCode) return ctx.reply(`${iconOf("STATUS_ERROR")} Mã không được trống`);
            try {
                await prisma.product.update({ where: { id: session.productId }, data: { code: newCode } });
                invalidateCategoryCache();
                adminSessions.delete(ctx.from.id);
                await ctx.reply(
                    `${iconOf("STATUS_SUCCESS")} Đã đổi mã thành <code>${escapeHtml(newCode)}</code>`,
                    { parse_mode: "HTML", ...Markup.inlineKeyboard([[Markup.button.callback(`${iconOf("NAV_BACK")} Về sản phẩm`, `ADMIN:EDIT:${session.productId}`)]])}
                );
            } catch (e) {
                await ctx.reply(`${iconOf("STATUS_ERROR")} Mã đã tồn tại hoặc không hợp lệ: ${e.message}`);
            }
            return;
        }

        // Change VIP price
        if (session.action === "CHANGE_VIP_PRICE") {
            const newVip = text.toLowerCase().trim() === "xoa" ? null : parseInt(text.replace(/[,.]/g, ""), 10);
            if (newVip !== null && (isNaN(newVip) || newVip < 0)) {
                return ctx.reply(`${iconOf("STATUS_ERROR")} Giá không hợp lệ. Nhập số hoặc gửi 'xoa' để xóa:`);
            }
            await prisma.product.update({ where: { id: session.productId }, data: { vipPrice: newVip } });
            invalidateCategoryCache();
            adminSessions.delete(ctx.from.id);
            await ctx.reply(
                newVip !== null
                    ? `${iconOf("STATUS_SUCCESS")} Giá VIP <b>${escapeHtml(session.productName)}</b>: <b>${session.currency === "USD" ? `$${newVip.toLocaleString("en-US")}` : `${newVip.toLocaleString("vi-VN")}đ`}</b>`
                    : `${iconOf("STATUS_SUCCESS")} Đã xóa giá VIP của <b>${escapeHtml(session.productName)}</b>`,
                { parse_mode: "HTML", ...Markup.inlineKeyboard([[Markup.button.callback(`${iconOf("NAV_BACK")} Về sản phẩm`, `ADMIN:EDIT:${session.productId}`)]])}
            );
            return;
        }

        // Change fake sold count
        if (session.action === "CHANGE_FAKE_SOLD") {
            const num = parseInt(text.replace(/[,.]/g, ""), 10);
            if (isNaN(num) || num < 0) {
                return ctx.reply(`${iconOf("STATUS_ERROR")} Số không hợp lệ. Nhập số nguyên >= 0:`);
            }

            await prisma.product.update({
                where: { id: session.productId },
                data: { soldFake: num },
            });
            invalidateCategoryCache();

            adminSessions.delete(ctx.from.id);
            await ctx.reply(
                `${iconOf("STATUS_SUCCESS")} Đã cập nhật lượt bán ảo cho <b>${escapeHtml(session.productName)}</b>: <b>+${num.toLocaleString("vi-VN")}</b>`,
                {
                    parse_mode: "HTML",
                    ...Markup.inlineKeyboard([[Markup.button.callback(`${iconOf("NAV_BACK")} Về sản phẩm`, `ADMIN:EDIT:${session.productId}`)]]),
                }
            );
            return;
        }

        // Add category - enter name
        if (session.action === "ADD_CATEGORY_NAME") {
            adminSessions.set(ctx.from.id, { action: "ADD_CATEGORY_ICON", name: text });
            await ctx.reply(
                `${iconOf("ADMIN_ICON_EDIT")} *ICON DANH MỤC*\n\nNhập emoji hoặc dán Custom Emoji ID:\n\n_Ví dụ: 📧 hoặc 5368324170671202286_`,
                { parse_mode: "Markdown" }
            );
            return;
        }

        // Add category - enter icon
        if (session.action === "ADD_CATEGORY_ICON") {
            await saveCategoryIconSession(ctx, session, extractIconPayloadFromTextMessage(ctx.message, session.currentIcon || iconOf("ADMIN_CATEGORIES")));
            return;
        }

        // Legacy add category icon block kept below for compatibility
        if (session.action === "ADD_CATEGORY_ICON") {
            const maxOrder = await prisma.category.findFirst({
                orderBy: { order: 'desc' },
                select: { order: true }
            });
            const nextOrder = (maxOrder?.order || 0) + 1;

            await prisma.category.create({
                data: {
                    name: session.name,
                    icon: text,
                    order: nextOrder
                }
            });
            invalidateCategoryCache();

            adminSessions.delete(ctx.from.id);
            await ctx.reply(`${iconOf("STATUS_SUCCESS")} Đã tạo danh mục: ${text} ${session.name}`);
            return;
        }

        // Edit category name
        if (session.action === "EDIT_CATEGORY_NAME") {
            await prisma.category.update({
                where: { id: session.categoryId },
                data: { name: text }
            });
            invalidateCategoryCache();

            adminSessions.delete(ctx.from.id);
            await ctx.reply(`${iconOf("STATUS_SUCCESS")} Đã đổi tên danh mục thành: ${text}`);
            return;
        }

        // Edit category icon
        if (session.action === "EDIT_CATEGORY_ICON") {
            await saveCategoryIconSession(ctx, session, extractIconPayloadFromTextMessage(ctx.message, session.currentIcon || iconOf("ADMIN_CATEGORIES")));
            return;
        }

        // Legacy edit category icon block kept below for compatibility
        if (session.action === "EDIT_CATEGORY_ICON") {
            await prisma.category.update({
                where: { id: session.categoryId },
                data: { icon: text }
            });
            invalidateCategoryCache();

            adminSessions.delete(ctx.from.id);
            await ctx.reply(`${iconOf("STATUS_SUCCESS")} Đã đổi icon danh mục thành: ${text}`);
            return;
        }

        // Edit category order
        if (session.action === "EDIT_CATEGORY_ORDER") {
            const order = parseInt(text, 10);
            if (isNaN(order) || order < 1) {
                return ctx.reply(`${iconOf("STATUS_ERROR")} Thứ tự không hợp lệ. Nhập số > 0:`);
            }

            await prisma.category.update({
                where: { id: session.categoryId },
                data: { order }
            });
            invalidateCategoryCache();

            adminSessions.delete(ctx.from.id);
            await ctx.reply(`${iconOf("STATUS_SUCCESS")} Đã đổi thứ tự danh mục thành: ${order}`);
            return;
        }

        // Edit category description
        if (session.action === "EDIT_CATEGORY_DESC") {
            const desc = text.trim() === "-" ? null : text.trim();
            await prisma.category.update({
                where: { id: session.categoryId },
                data: { description: desc }
            });
            invalidateCategoryCache();
            adminSessions.delete(ctx.from.id);
            await ctx.reply(desc ? `${iconOf("STATUS_SUCCESS")} Đã cập nhật mô tả danh mục.` : `${iconOf("STATUS_SUCCESS")} Đã xoá mô tả danh mục.`);
            return;
        }

        // Edit category image (text "-" to remove)
        if (session.action === "EDIT_CATEGORY_IMAGE") {
            if (text.trim() === "-") {
                await prisma.category.update({
                    where: { id: session.categoryId },
                    data: { imageFileId: null }
                });
                invalidateCategoryCache();
                adminSessions.delete(ctx.from.id);
                await ctx.reply(`${iconOf("STATUS_SUCCESS")} Đã xoá ảnh banner danh mục.`);
                return;
            }
            await ctx.reply(`${iconOf("STATUS_ERROR")} Vui lòng gửi một hình ảnh hoặc gửi "-" để xoá ảnh.`);
            return;
        }

        // Set VIP flow
        if (session.action === "SET_VIP") {
            const parts = text.split("|").map(s => s.trim());
            if (parts.length !== 2) {
                return ctx.reply(`${iconOf("STATUS_ERROR")} Sai format. Nhập lại: TELEGRAM_ID|LEVEL`);
            }

            const [telegramId, levelStr] = parts;
            const level = parseInt(levelStr, 10);

            if (isNaN(level) || level < 0 || level > 3) {
                return ctx.reply(`${iconOf("STATUS_ERROR")} Level không hợp lệ (0-3)`);
            }

            try {
                const user = await prisma.user.findUnique({ where: { telegramId } });
                if (!user) {
                    return ctx.reply(`${iconOf("STATUS_ERROR")} Không tìm thấy user`);
                }

                await setVipLevel(user.id, level);
                await logAction(ctx.from.id, Actions.SET_VIP, telegramId, { level });
                adminSessions.delete(ctx.from.id);
                await ctx.reply(`${iconOf("STATUS_SUCCESS")} Đã set VIP Level ${level} cho ${user.firstName || telegramId}`);
            } catch (e) {
                await ctx.reply(`${iconOf("STATUS_ERROR")} Lỗi: ${e.message}`);
            }
            return;
        }

        // Wallet check balance
        if (session.action === "WALLET_CHECK") {
            const telegramId = text.trim();

            try {
                const balance = await getBalance(telegramId);
                const transactions = await getTransactionHistory(telegramId, 5);

                let msg = `${iconOf("ADMIN_MONEY")} *Số dư ví*\n\n` +
                    `${iconOf("ACCOUNT")} User: \`${telegramId}\`\n` +
                    `${iconOf("ADMIN_MONEY")} Số dư: *${balance.toLocaleString()}đ*\n\n`;

                if (transactions.length > 0) {
                    msg += `${iconOf("ADMIN_STATS")} *Giao dịch gần đây:*\n`;
                    for (const tx of transactions) {
                        const sign = tx.amount >= 0 ? "+" : "";
                        const date = new Date(tx.createdAt).toLocaleDateString("vi-VN");
                        msg += `• ${date}: ${sign}${tx.amount.toLocaleString()}đ (${tx.type})\n`;
                    }
                }

                adminSessions.delete(ctx.from.id);
                await ctx.reply(msg, { parse_mode: "Markdown" });
            } catch (e) {
                await ctx.reply(`${iconOf("STATUS_ERROR")} Lỗi: ${e.message}`);
            }
            return;
        }

        // Wallet add balance
        if (session.action === "WALLET_ADD") {
            const parts = text.split("|").map(s => s.trim());
            if (parts.length < 2) {
                return ctx.reply(`${iconOf("STATUS_ERROR")} Sai format. Nhập lại: TELEGRAM_ID|SỐ_TIỀN|LÝ_DO`);
            }

            const [telegramId, amountStr, reason] = parts;
            const amount = parseInt(amountStr.replace(/[,.]/g, ""), 10);

            if (isNaN(amount) || amount <= 0) {
                return ctx.reply(`${iconOf("STATUS_ERROR")} Số tiền không hợp lệ`);
            }

            try {
                const result = await adminAddBalance(telegramId, amount, ctx.from.id, reason);

                if (result.success) {
                    await logAction(ctx.from.id, "WALLET_ADD", telegramId, { amount, reason });
                    adminSessions.delete(ctx.from.id);
                    await ctx.reply(
                        `${iconOf("STATUS_SUCCESS")} *Đã cộng tiền!*\n\n` +
                        `${iconOf("ACCOUNT")} User: \`${telegramId}\`\n` +
                        `${iconOf("ADMIN_MONEY")} Số tiền: +${amount.toLocaleString()}đ\n` +
                        `${iconOf("ADMIN_MONEY")} Số dư mới: ${result.newBalance.toLocaleString()}đ`,
                        { parse_mode: "Markdown" }
                    );

                    // Notify user
                    try {
                        await bot.telegram.sendMessage(
                            telegramId,
                            `${iconOf("STATUS_SUCCESS")} *SỐ DƯ CẬP NHẬT*\n\n` +
                            `${iconOf("ADMIN_MONEY")} Số tiền: +${amount.toLocaleString()}đ\n` +
                            `${iconOf("ADMIN_MONEY")} Số dư mới: ${result.newBalance.toLocaleString()}đ\n` +
                            `${iconOf("ADMIN_NOTE")} Lý do: ${reason || "Admin cộng tiền"}`,
                            { parse_mode: "Markdown" }
                        );
                    } catch (e) { }
                } else {
                    await ctx.reply(`${iconOf("STATUS_ERROR")} Lỗi: ${result.error}`);
                }
            } catch (e) {
                await ctx.reply(`${iconOf("STATUS_ERROR")} Lỗi: ${e.message}`);
            }
            return;
        }

        // Wallet deduct balance
        if (session.action === "WALLET_DEDUCT") {
            const parts = text.split("|").map(s => s.trim());
            if (parts.length < 2) {
                return ctx.reply(`${iconOf("STATUS_ERROR")} Sai format. Nhập lại: TELEGRAM_ID|SỐ_TIỀN|LÝ_DO`);
            }

            const [telegramId, amountStr, reason] = parts;
            const amount = parseInt(amountStr.replace(/[,.]/g, ""), 10);

            if (isNaN(amount) || amount <= 0) {
                return ctx.reply(`${iconOf("STATUS_ERROR")} Số tiền không hợp lệ`);
            }

            try {
                const result = await adminDeductBalance(telegramId, amount, ctx.from.id, reason);

                if (result.success) {
                    await logAction(ctx.from.id, "WALLET_DEDUCT", telegramId, { amount, reason });
                    adminSessions.delete(ctx.from.id);
                    await ctx.reply(
                        `${iconOf("STATUS_SUCCESS")} *Đã trừ tiền!*\n\n` +
                        `${iconOf("ACCOUNT")} User: \`${telegramId}\`\n` +
                        `${iconOf("ADMIN_MONEY")} Số tiền: -${amount.toLocaleString()}đ\n` +
                        `${iconOf("ADMIN_MONEY")} Số dư mới: ${result.newBalance.toLocaleString()}đ`,
                        { parse_mode: "Markdown" }
                    );

                    // Notify user
                    try {
                        await bot.telegram.sendMessage(
                            telegramId,
                            `${iconOf("STATUS_WARNING")} *SỐ DƯ CẬP NHẬT*\n\n` +
                            `${iconOf("ADMIN_MONEY")} Số tiền: -${amount.toLocaleString()}đ\n` +
                            `${iconOf("ADMIN_MONEY")} Số dư mới: ${result.newBalance.toLocaleString()}đ\n` +
                            `${iconOf("ADMIN_NOTE")} Lý do: ${reason || "Admin trừ tiền"}`,
                            { parse_mode: "Markdown" }
                        );
                    } catch (e) { }
                } else {
                    await ctx.reply(`${iconOf("STATUS_ERROR")} Lỗi: ${result.error}`);
                }
            } catch (e) {
                await ctx.reply(`${iconOf("STATUS_ERROR")} Lỗi: ${e.message}`);
            }
            return;
        }

        // Create API key flow
        if (session.action === "CREATE_API_KEY") {
            adminSessions.delete(ctx.from.id);
            if (!text.trim()) return ctx.reply(`${iconOf("STATUS_ERROR")} Tên không được trống.`);
            const { randomBytes } = await import("node:crypto");
            const newKey = {
                id: randomBytes(8).toString("hex"),
                name: text.trim(),
                key: generateApiKey(),
                createdAt: new Date().toISOString(),
                active: true,
            };
            const s = await prisma.setting.findUnique({ where: { key: "seller_api_keys" } });
            const keys = s ? JSON.parse(s.value) : [];
            keys.push(newKey);
            await prisma.setting.upsert({ where: { key: "seller_api_keys" }, update: { value: JSON.stringify(keys) }, create: { key: "seller_api_keys", value: JSON.stringify(keys) } });
            logAction(ctx.from.id, "CREATE_API_KEY", newKey.id, { name: newKey.name });
            await ctx.reply(
                `${iconOf("STATUS_SUCCESS")} *Đã tạo API Key!*\n\n*Tên:* ${escapeHtml(newKey.name)}\n*Key (lưu ngay):*\n\`${newKey.key}\`\n\n${iconOf("STATUS_WARNING")} Key chỉ hiển thị 1 lần duy nhất.`,
                { parse_mode: "Markdown", ...Markup.inlineKeyboard([[Markup.button.callback(`${iconOf("ADMIN_SELLER_API")} Xem API`, "ADMIN:SELLER_API")]]) }
            );
            return;
        }

        // Broadcast flow
        if (session.action === "BROADCAST") {
            adminSessions.delete(ctx.from.id);
            await ctx.reply(`${iconOf("ADMIN_BROADCAST")} Đang gửi broadcast...`);
            try {
                const result = await sendBroadcast(bot, text, ctx.from.id);
                await ctx.reply(
                    `${iconOf("STATUS_SUCCESS")} *Broadcast hoàn tất!*\n\n` +
                    `${iconOf("ADMIN_EXPORT")} Đã gửi: ${result.sentCount}\n` +
                    `${iconOf("STATUS_ERROR")} Thất bại: ${result.failCount}\n` +
                    `${iconOf("ADMIN_STATS")} Tổng: ${result.total}`,
                    { parse_mode: "Markdown" }
                );
            } catch (e) {
                await ctx.reply(`${iconOf("STATUS_ERROR")} Lỗi broadcast: ${e.message}`);
            }
            return;
        }

        // VIP Broadcast flow
        if (session.action === "VIP_BROADCAST") {
            adminSessions.delete(ctx.from.id);
            await ctx.reply(`${iconOf("ADMIN_VIP")} Đang gửi VIP broadcast...`);
            try {
                const { sendVipBroadcast } = await import("./broadcast.js");
                const result = await sendVipBroadcast(bot, text, 1, ctx.from.id);
                await ctx.reply(
                    `${iconOf("STATUS_SUCCESS")} *VIP Broadcast hoàn tất!*\n\n` +
                    `${iconOf("ADMIN_EXPORT")} Đã gửi: ${result.sentCount}\n` +
                    `${iconOf("STATUS_ERROR")} Thất bại: ${result.failCount}\n` +
                    `${iconOf("ADMIN_STATS")} Tổng VIP: ${result.total}`,
                    { parse_mode: "Markdown" }
                );
            } catch (e) {
                await ctx.reply(`${iconOf("STATUS_ERROR")} Lỗi VIP broadcast: ${e.message}`);
            }
            return;
        }

        return next();
    });

    // Mode selection for add product
    bot.action(/^ADMIN:MODE:(.+)$/, adminOnly, async (ctx) => {
        await ctx.answerCbQuery();
        const mode = ctx.match[1];
        const session = adminSessions.get(ctx.from.id);

        if (!session || session.action !== "ADD_PRODUCT") {
            return ctx.reply(`${iconOf("STATUS_ERROR")} Session expired`);
        }

        try {
            const product = await prisma.product.create({
                data: {
                    code: session.code,
                    name: session.name,
                    description: session.notes || null,
                    price: session.price,
                    deliveryMode: mode,
                    payload: mode === "TEXT" ? "Default payload" : "",
                    currency: "VND",
                    categoryId: session.categoryId,
                    isActive: true,
                },
            });

            invalidateCategoryCache();

            await logAction(ctx.from.id, Actions.ADD_PRODUCT, session.name);
            adminSessions.delete(ctx.from.id);

            const notesInfo = session.notes ? `\n${iconOf("ADMIN_NOTE")} Lưu ý: ${session.notes}` : '';
            await ctx.reply(
                `${iconOf("STATUS_SUCCESS")} Đã tạo sản phẩm!\n\n` +
                `${iconOf("ADMIN_CATEGORIES")} Danh mục: ${session.categoryName}\n` +
                `${iconOf("ADMIN_NOTE")} Tên: ${session.name}\n` +
                `${iconOf("ADMIN_MONEY")} Giá: ${session.price.toLocaleString()}đ\n` +
                `${iconOf("ADMIN_STATS")} Mode: ${mode}` +
                notesInfo
            );
        } catch (e) {
            await ctx.reply(`${iconOf("STATUS_ERROR")} Lỗi: ${e.message}`);
        }
    });

    console.log(`${iconOf("STATUS_SUCCESS")} Admin v2 commands registered`);
}
