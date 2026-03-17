import { Markup } from "telegraf";
import { prisma } from "./db.js";
import { getStatsMessage, getRevenueByDay, generateTextChart } from "./stats.js";
import { createCoupon, listCoupons, toggleCoupon, deleteCoupon } from "./coupon.js";
import { createBackup, listBackups } from "./backup.js";
import { logAction, Actions, getRecentLogs, formatLog } from "./audit.js";
import { sendBroadcast, getBroadcastHistory } from "./broadcast.js";
import { exportOrdersCSV, exportRevenueCSV, exportUsersCSV, exportProductsCSV } from "./export.js";
import { getVipLevels, getUserVipInfo, setVipLevel, getVipEmoji } from "./vip.js";
import { adminAddBalance, adminDeductBalance, getBalance, getTransactionHistory } from "./wallet.js";

/**
 * Admin Module v3 - Full Featured
 */

const ADMIN_IDS = (process.env.ADMIN_IDS || "").split(",").map((id) => id.trim()).filter(Boolean);

function isAdmin(userId) {
    return ADMIN_IDS.includes(String(userId));
}

function adminOnly(ctx, next) {
    if (!isAdmin(ctx.from.id)) {
        return ctx.reply("❌ Không có quyền truy cập.");
    }
    return next();
}

// Sessions for multi-step operations
const adminSessions = new Map();

export function registerAdminCommands(bot) {
    // /admin - Admin Panel
    bot.command("admin", adminOnly, async (ctx) => {
        await showAdminPanel(ctx);
    });

    // Admin Panel
    async function showAdminPanel(ctx, edit = false) {
        const msg = `🔧 *Admin Panel v3*\n\nChọn chức năng:`;
        const keyboard = Markup.inlineKeyboard([
            [Markup.button.callback("� Danh mục", "ADMIN:CATEGORIES"), Markup.button.callback("�📦 Sản phẩm", "ADMIN:PRODUCTS")],
            [Markup.button.callback("📋 Đơn hàng", "ADMIN:ORDERS"), Markup.button.callback("📊 Thống kê", "ADMIN:STATS")],
            [Markup.button.callback("🎫 Coupon", "ADMIN:COUPONS"), Markup.button.callback("👥 Người dùng", "ADMIN:USERS")],
            [Markup.button.callback("👑 VIP", "ADMIN:VIP"), Markup.button.callback("💰 Ví khách", "ADMIN:WALLET")],
            [Markup.button.callback("📢 Broadcast", "ADMIN:BROADCAST"), Markup.button.callback("📥 Export", "ADMIN:EXPORT")],
            [Markup.button.callback("📝 Logs", "ADMIN:LOGS"), Markup.button.callback("💾 Backup", "ADMIN:BACKUP")],
        ]);

        if (edit) {
            await ctx.editMessageText(msg, { parse_mode: "Markdown", ...keyboard });
        } else {
            await ctx.reply(msg, { parse_mode: "Markdown", ...keyboard });
        }
    }

    bot.action("ADMIN:PANEL", adminOnly, async (ctx) => {
        await ctx.answerCbQuery();
        await showAdminPanel(ctx, true);
    });

    // === PRODUCTS MANAGEMENT ===
    bot.action("ADMIN:PRODUCTS", adminOnly, async (ctx) => {
        await ctx.answerCbQuery();

        const products = await prisma.product.findMany({ orderBy: { createdAt: "desc" } });

        let msg = `📦 *Quản lý sản phẩm*\n\n`;
        for (const p of products) {
            const status = p.isActive ? "✅" : "❌";
            let stock = "";
            if (p.deliveryMode === "STOCK_LINES") {
                const count = await prisma.stockItem.count({ where: { productId: p.id, isSold: false } });
                stock = ` [${count}]`;
            }
            msg += `${status} \`${p.code}\` - ${p.name} - ${p.price.toLocaleString()}đ${stock}\n`;
        }

        await ctx.editMessageText(msg, {
            parse_mode: "Markdown",
            ...Markup.inlineKeyboard([
                [Markup.button.callback("➕ Thêm sản phẩm", "ADMIN:ADD_PRODUCT")],
                [Markup.button.callback("📝 Sửa sản phẩm", "ADMIN:EDIT_PRODUCT")],
                [Markup.button.callback("📊 Nạp stock", "ADMIN:ADD_STOCK")],
                [Markup.button.callback("🔙 Quay lại", "ADMIN:PANEL")],
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
                "❌ Chưa có danh mục nào!\n\nVui lòng tạo danh mục trước.",
                {
                    parse_mode: "Markdown",
                    ...Markup.inlineKeyboard([[Markup.button.callback("📚 Quản lý danh mục", "ADMIN:CATEGORIES")]])
                }
            );
        }

        const categoryButtons = categories.map(cat => [
            Markup.button.callback(`${cat.icon} ${cat.name}`, `ADMIN:ADD_PROD_CAT:${cat.id}`)
        ]);
        categoryButtons.push([Markup.button.callback("❌ Huỷ", "ADMIN:PRODUCTS")]);

        await ctx.editMessageText(
            `➕ *Thêm sản phẩm mới*\n\n📁 Bước 1/4: Chọn danh mục:`,
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
            return ctx.reply("❌ Danh mục không tồn tại");
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
            `➕ *Thêm sản phẩm mới*\n\n` +
            `📁 Danh mục: ${category.icon} ${category.name}\n` +
            `📝 Mã SP: \`${randomCode}\`\n\n` +
            `Bước 2/5: Nhập tên sản phẩm:`,
            { parse_mode: "Markdown", ...Markup.inlineKeyboard([[Markup.button.callback("❌ Huỷ", "ADMIN:PRODUCTS")]]) }
        );
    });

    // Edit product - Select product
    bot.action("ADMIN:EDIT_PRODUCT", adminOnly, async (ctx) => {
        await ctx.answerCbQuery();

        const products = await prisma.product.findMany({ orderBy: { createdAt: "desc" } });

        await ctx.editMessageText(
            `📝 *Chọn sản phẩm để sửa:*`,
            {
                parse_mode: "Markdown",
                ...Markup.inlineKeyboard([
                    ...products.map((p) => [Markup.button.callback(`${p.isActive ? "✅" : "❌"} ${p.code} - ${p.name}`, `ADMIN:EDIT:${p.id}`)]),
                    [Markup.button.callback("🔙 Quay lại", "ADMIN:PRODUCTS")],
                ]),
            }
        );
    });

    // Edit specific product
    bot.action(/^ADMIN:EDIT:(.+)$/, adminOnly, async (ctx) => {
        await ctx.answerCbQuery();
        const productId = ctx.match[1];

        const product = await prisma.product.findUnique({ where: { id: productId } });
        if (!product) return ctx.reply("❌ Không tìm thấy");

        let stockInfo = "";
        if (product.deliveryMode === "STOCK_LINES") {
            const total = await prisma.stockItem.count({ where: { productId: product.id } });
            const sold = await prisma.stockItem.count({ where: { productId: product.id, isSold: true } });
            console.log(`[ADMIN] Stock for product ${product.id}: total=${total}, sold=${sold}, available=${total - sold}`);
            stockInfo = `\n📊 Stock: ${total - sold}/${total}`;
        }

        await ctx.editMessageText(
            `📦 *${product.name}*\n\n` +
            `Code: \`${product.code}\`\n` +
            `Giá: ${product.price.toLocaleString()}đ\n` +
            `Mode: ${product.deliveryMode}\n` +
            `Trạng thái: ${product.isActive ? "✅ Đang bán" : "❌ Tắt"}` +
            stockInfo,
            {
                parse_mode: "Markdown",
                ...Markup.inlineKeyboard([
                    [Markup.button.callback(product.isActive ? "❌ Tắt" : "✅ Bật", `ADMIN:TOGGLE:${product.id}`)],
                    [Markup.button.callback("💰 Đổi giá", `ADMIN:PRICE:${product.id}`)],
                    [Markup.button.callback("📝 Đổi payload", `ADMIN:PAYLOAD:${product.id}`)],
                    [Markup.button.callback("🗑️ Xoá", `ADMIN:DELETE:${product.id}`)],
                    [Markup.button.callback("🔙 Quay lại", "ADMIN:PRODUCTS")],
                ]),
            }
        );
    });

    // Toggle product
    bot.action(/^ADMIN:TOGGLE:(.+)$/, adminOnly, async (ctx) => {
        await ctx.answerCbQuery("Đã cập nhật!");
        const productId = ctx.match[1];

        const product = await prisma.product.findUnique({ where: { id: productId } });
        await prisma.product.update({
            where: { id: productId },
            data: { isActive: !product.isActive },
        });

        // Refresh
        ctx.match[1] = productId;
        await ctx.answerCbQuery();

        const updated = await prisma.product.findUnique({ where: { id: productId } });
        await ctx.editMessageText(
            `✅ Đã ${updated.isActive ? "BẬT" : "TẮT"}: ${updated.name}`,
            Markup.inlineKeyboard([[Markup.button.callback("🔙 Quay lại", "ADMIN:PRODUCTS")]])
        );
    });

    // Delete product
    bot.action(/^ADMIN:DELETE:(.+)$/, adminOnly, async (ctx) => {
        await ctx.answerCbQuery();
        const productId = ctx.match[1];

        const product = await prisma.product.findUnique({ where: { id: productId } });

        await ctx.editMessageText(
            `⚠️ Xác nhận xoá: *${product.name}*?`,
            {
                parse_mode: "Markdown",
                ...Markup.inlineKeyboard([
                    [Markup.button.callback("✅ Xác nhận xoá", `ADMIN:CONFIRM_DELETE:${productId}`)],
                    [Markup.button.callback("❌ Huỷ", `ADMIN:EDIT:${productId}`)],
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

        await ctx.editMessageText(
            `✅ Đã xoá sản phẩm.`,
            Markup.inlineKeyboard([[Markup.button.callback("🔙 Quay lại", "ADMIN:PRODUCTS")]])
        );
    });

    // Change price - Ask for new price
    bot.action(/^ADMIN:PRICE:(.+)$/, adminOnly, async (ctx) => {
        await ctx.answerCbQuery();
        const productId = ctx.match[1];

        const product = await prisma.product.findUnique({ where: { id: productId } });
        adminSessions.set(ctx.from.id, { action: "CHANGE_PRICE", productId, productName: product.name });

        await ctx.editMessageText(
            `💰 *Đổi giá: ${product.name}*\n\nGiá hiện tại: ${product.price.toLocaleString()}đ\n\nNhập giá mới (VND):`,
            { parse_mode: "Markdown", ...Markup.inlineKeyboard([[Markup.button.callback("❌ Huỷ", `ADMIN:EDIT:${productId}`)]]) }
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
            `📝 *Đổi payload: ${product.name}*\n\nPayload hiện tại: ${product.payload || "(trống)"}\n\n${hint}`,
            { parse_mode: "Markdown", ...Markup.inlineKeyboard([[Markup.button.callback("❌ Huỷ", `ADMIN:EDIT:${productId}`)]]) }
        );
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
                "❌ Không có sản phẩm nào dùng STOCK_LINES",
                Markup.inlineKeyboard([[Markup.button.callback("🔙 Quay lại", "ADMIN:PRODUCTS")]])
            );
        }

        await ctx.editMessageText(
            `📊 *Chọn sản phẩm để nạp stock:*`,
            {
                parse_mode: "Markdown",
                ...Markup.inlineKeyboard([
                    ...products.map((p) => [Markup.button.callback(p.name, `ADMIN:STOCK:${p.id}`)]),
                    [Markup.button.callback("🔙 Quay lại", "ADMIN:PRODUCTS")],
                ]),
            }
        );
    });

    bot.action(/^ADMIN:STOCK:(.+)$/, adminOnly, async (ctx) => {
        await ctx.answerCbQuery();
        const productId = ctx.match[1];

        const product = await prisma.product.findUnique({ where: { id: productId } });
        adminSessions.set(ctx.from.id, { action: "ADD_STOCK", productId, productName: product.name });

        await ctx.editMessageText(
            `📊 *Nạp stock: ${product.name}*\n\nGửi danh sách (mỗi dòng 1 tài khoản):`,
            { parse_mode: "Markdown", ...Markup.inlineKeyboard([[Markup.button.callback("❌ Huỷ", "ADMIN:PRODUCTS")]]) }
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

        const emoji = { PENDING: "⏳", PAID: "💰", DELIVERED: "✅", CANCELED: "❌" };
        let msg = `📋 *Đơn hàng gần đây*\n\n`;

        for (const o of orders) {
            msg += `${emoji[o.status]} \`${o.id.slice(-8)}\` | ${o.product.code} x${o.quantity} | ${o.finalAmount.toLocaleString()}đ\n`;
        }

        await ctx.editMessageText(msg, {
            parse_mode: "Markdown",
            ...Markup.inlineKeyboard([
                [Markup.button.callback("⏳ Chờ thanh toán", "ADMIN:ORDERS:PENDING")],
                [Markup.button.callback("🔙 Quay lại", "ADMIN:PANEL")],
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
                "✅ Không có đơn chờ xác nhận",
                Markup.inlineKeyboard([[Markup.button.callback("🔙 Quay lại", "ADMIN:ORDERS")]])
            );
        }

        await ctx.editMessageText(
            `⏳ *Đơn chờ xác nhận (Bank Transfer)*\n\n` +
            orders.map((o) => `\`${o.id.slice(-8)}\` | ${o.product.name} | ${o.finalAmount.toLocaleString()}đ`).join("\n"),
            {
                parse_mode: "Markdown",
                ...Markup.inlineKeyboard([
                    ...orders.slice(0, 5).map((o) => [Markup.button.callback(`✅ Xác nhận ${o.id.slice(-8)}`, `ADMIN:CONFIRM_PAY:${o.id}`)]),
                    [Markup.button.callback("🔙 Quay lại", "ADMIN:ORDERS")],
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

        let msg = `📚 *QUẢN LÝ DANH MỤC*\n\n`;

        if (categories.length === 0) {
            msg += `📭 Chưa có danh mục nào`;
        } else {
            categories.forEach((cat, i) => {
                const status = cat.isActive ? '✅' : '❌';
                msg += `${i + 1}. ${cat.icon} *${cat.name}*\n`;
                msg += `   Trạng thái: ${status} | Sản phẩm: ${cat._count.products}\n\n`;
            });
        }

        const buttons = categories.map(cat => [
            Markup.button.callback(`✏️ ${cat.icon} ${cat.name}`, `ADMIN:EDIT_CAT:${cat.id}`)
        ]);

        buttons.push(
            [Markup.button.callback("➕ Thêm danh mục", "ADMIN:ADD_CATEGORY")],
            [Markup.button.callback("🔙 Admin Panel", "SHOW_ADMIN_PANEL")]
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
            `➕ *THÊM DANH MỤC MỚI*\n\n` +
            `📝 Nhập tên danh mục:\n\n` +
            `_Ví dụ: Chat GPT, CapCut Pro..._`,
            {
                parse_mode: "Markdown",
                ...Markup.inlineKeyboard([[Markup.button.callback("❌ Huỷ", "ADMIN:CATEGORIES")]])
            }
        );
    });

    // Edit category
    bot.action(/^ADMIN:EDIT_CAT:(.+)$/i, adminOnly, async (ctx) => {
        await ctx.answerCbQuery();
        const catId = ctx.match[1];

        const category = await prisma.category.findUnique({ where: { id: catId } });
        if (!category) {
            return ctx.reply("❌ Danh mục không tồn tại");
        }

        const msg = `✏️ *CHỈNH SỬA DANH MỤC*\n\n` +
            `${category.icon} *${category.name}*\n` +
            `Thứ tự: ${category.order}\n` +
            `Trạng thái: ${category.isActive ? '✅ Hoạt động' : '❌ Tắt'}`;

        await ctx.editMessageText(msg, {
            parse_mode: "Markdown",
            ...Markup.inlineKeyboard([
                [Markup.button.callback("📝 Đổi tên", `ADMIN:CAT_NAME:${catId}`)],
                [Markup.button.callback("🎨 Đổi icon", `ADMIN:CAT_ICON:${catId}`)],
                [Markup.button.callback("🔢 Đổi thứ tự", `ADMIN:CAT_ORDER:${catId}`)],
                [Markup.button.callback(
                    category.isActive ? "❌ Tắt" : "✅ Bật",
                    `ADMIN:CAT_TOGGLE:${catId}`
                )],
                [Markup.button.callback("🗑️ Xoá danh mục", `ADMIN:CAT_DELETE:${catId}`)],
                [Markup.button.callback("🔙 Danh sách", "ADMIN:CATEGORIES")]
            ])
        });
    });

    // Change category name
    bot.action(/^ADMIN:CAT_NAME:(.+)$/i, adminOnly, async (ctx) => {
        await ctx.answerCbQuery();
        const catId = ctx.match[1];
        adminSessions.set(ctx.from.id, { action: "EDIT_CATEGORY_NAME", categoryId: catId });

        await ctx.editMessageText(
            `📝 *ĐỔI TÊN DANH MỤC*\n\nNhập tên mới:`,
            {
                parse_mode: "Markdown",
                ...Markup.inlineKeyboard([[Markup.button.callback("❌ Huỷ", `ADMIN:EDIT_CAT:${catId}`)]])
            }
        );
    });

    // Change category icon
    bot.action(/^ADMIN:CAT_ICON:(.+)$/i, adminOnly, async (ctx) => {
        await ctx.answerCbQuery();
        const catId = ctx.match[1];
        adminSessions.set(ctx.from.id, { action: "EDIT_CATEGORY_ICON", categoryId: catId });

        await ctx.editMessageText(
            `🎨 *ĐỔI ICON DANH MỤC*\n\n` +
            `Nhập emoji icon:\n\n` +
            `_Ví dụ: 📧, 🤖, ✂️..._`,
            {
                parse_mode: "Markdown",
                ...Markup.inlineKeyboard([[Markup.button.callback("❌ Huỷ", `ADMIN:EDIT_CAT:${catId}`)]])
            }
        );
    });

    // Change category order
    bot.action(/^ADMIN:CAT_ORDER:(.+)$/i, adminOnly, async (ctx) => {
        await ctx.answerCbQuery();
        const catId = ctx.match[1];
        adminSessions.set(ctx.from.id, { action: "EDIT_CATEGORY_ORDER", categoryId: catId });

        await ctx.editMessageText(
            `🔢 *ĐỔI THỨ TỰ DANH MỤC*\n\n` +
            `Nhập số thứ tự (1, 2, 3...):`,
            {
                parse_mode: "Markdown",
                ...Markup.inlineKeyboard([[Markup.button.callback("❌ Huỷ", `ADMIN:EDIT_CAT:${catId}`)]])
            }
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

        await ctx.answerCbQuery(`✅ Đã ${category.isActive ? 'tắt' : 'bật'} danh mục`);

        // Refresh edit page
        const updatedCat = await prisma.category.findUnique({ where: { id: catId } });
        const msg = `✏️ *CHỈNH SỬA DANH MỤC*\n\n` +
            `${updatedCat.icon} *${updatedCat.name}*\n` +
            `Thứ tự: ${updatedCat.order}\n` +
            `Trạng thái: ${updatedCat.isActive ? '✅ Hoạt động' : '❌ Tắt'}`;

        await ctx.editMessageText(msg, {
            parse_mode: "Markdown",
            ...Markup.inlineKeyboard([
                [Markup.button.callback("📝 Đổi tên", `ADMIN:CAT_NAME:${catId}`)],
                [Markup.button.callback("🎨 Đổi icon", `ADMIN:CAT_ICON:${catId}`)],
                [Markup.button.callback("🔢 Đổi thứ tự", `ADMIN:CAT_ORDER:${catId}`)],
                [Markup.button.callback(
                    updatedCat.isActive ? "❌ Tắt" : "✅ Bật",
                    `ADMIN:CAT_TOGGLE:${catId}`
                )],
                [Markup.button.callback("🗑️ Xoá danh mục", `ADMIN:CAT_DELETE:${catId}`)],
                [Markup.button.callback("🔙 Danh sách", "ADMIN:CATEGORIES")]
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

        const msg = `🗑️ *XOÁ DANH MỤC*\n\n` +
            `${category.icon} *${category.name}*\n\n` +
            `⚠️ Danh mục có ${category._count.products} sản phẩm.\n` +
            `Các sản phẩm sẽ KHÔNG bị xoá, chỉ mất liên kết danh mục.\n\n` +
            `Xác nhận xoá?`;

        await ctx.editMessageText(msg, {
            parse_mode: "Markdown",
            ...Markup.inlineKeyboard([
                [Markup.button.callback("✅ Xác nhận xoá", `ADMIN:CAT_DELETE_CONFIRM:${catId}`)],
                [Markup.button.callback("❌ Huỷ", `ADMIN:EDIT_CAT:${catId}`)]
            ])
        });
    });

    // Confirm delete category
    bot.action(/^ADMIN:CAT_DELETE_CONFIRM:(.+)$/i, adminOnly, async (ctx) => {
        await ctx.answerCbQuery();
        const catId = ctx.match[1];

        await prisma.category.delete({ where: { id: catId } });

        await ctx.answerCbQuery("✅ Đã xoá danh mục");

        // Redirect to category list
        const categories = await prisma.category.findMany({
            orderBy: [{ order: 'asc' }, { name: 'asc' }],
            include: { _count: { select: { products: true } } }
        });

        let msg = `📚 *QUẢN LÝ DANH MỤC*\n\n`;

        if (categories.length === 0) {
            msg += `📭 Chưa có danh mục nào`;
        } else {
            categories.forEach((cat, i) => {
                const status = cat.isActive ? '✅' : '❌';
                msg += `${i + 1}. ${cat.icon} *${cat.name}*\n`;
                msg += `   Trạng thái: ${status} | Sản phẩm: ${cat._count.products}\n\n`;
            });
        }

        const buttons = categories.map(cat => [
            Markup.button.callback(`✏️ ${cat.icon} ${cat.name}`, `ADMIN:EDIT_CAT:${cat.id}`)
        ]);

        buttons.push(
            [Markup.button.callback("➕ Thêm danh mục", "ADMIN:ADD_CATEGORY")],
            [Markup.button.callback("🔙 Admin Panel", "SHOW_ADMIN_PANEL")]
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
        if (!order || order.status !== "PENDING") {
            return ctx.reply("❌ Đơn không hợp lệ");
        }

        // Update status to PAID - delivery will be handled by webhook handler
        await prisma.order.update({
            where: { id: orderId },
            data: { status: "PAID" },
        });

        // Import and call delivery
        const { deliverOrder } = await import("./delivery.js");
        const updatedOrder = await prisma.order.findUnique({ where: { id: orderId } });
        await deliverOrder({ prisma, bot, order: updatedOrder });

        await ctx.editMessageText(
            `✅ Đã xác nhận và giao hàng: ${orderId.slice(-8)}`,
            Markup.inlineKeyboard([[Markup.button.callback("🔙 Quay lại", "ADMIN:ORDERS:PENDING")]])
        );
    });

    // === STATS ===
    bot.action("ADMIN:STATS", adminOnly, async (ctx) => {
        await ctx.answerCbQuery();

        await ctx.editMessageText(
            `📊 *Chọn khoảng thời gian:*`,
            {
                parse_mode: "Markdown",
                ...Markup.inlineKeyboard([
                    [Markup.button.callback("📅 Hôm nay", "ADMIN:STATS:today")],
                    [Markup.button.callback("📆 7 ngày", "ADMIN:STATS:week")],
                    [Markup.button.callback("🗓️ 30 ngày", "ADMIN:STATS:month")],
                    [Markup.button.callback("📈 Tất cả", "ADMIN:STATS:all")],
                    [Markup.button.callback("📊 Biểu đồ", "ADMIN:STATS:chart")],
                    [Markup.button.callback("🔙 Quay lại", "ADMIN:PANEL")],
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
                `📊 *Doanh thu 7 ngày qua*\n\n${chart}`,
                {
                    parse_mode: "Markdown",
                    ...Markup.inlineKeyboard([[Markup.button.callback("🔙 Quay lại", "ADMIN:STATS")]]),
                }
            );
            return;
        }

        const msg = await getStatsMessage(period);

        await ctx.editMessageText(msg, {
            parse_mode: "Markdown",
            ...Markup.inlineKeyboard([[Markup.button.callback("🔙 Quay lại", "ADMIN:STATS")]]),
        });
    });

    // === COUPONS ===
    bot.action("ADMIN:COUPONS", adminOnly, async (ctx) => {
        await ctx.answerCbQuery();

        const coupons = await listCoupons();

        let msg = `🎫 *Mã giảm giá*\n\n`;
        for (const c of coupons) {
            const status = c.isActive ? "✅" : "❌";
            const type = c.discountType === "PERCENT" ? `${c.discount}%` : `${c.discount.toLocaleString()}đ`;
            msg += `${status} \`${c.code}\` - ${type} (${c.usedCount}/${c.maxUses || "∞"})\n`;
        }

        await ctx.editMessageText(msg, {
            parse_mode: "Markdown",
            ...Markup.inlineKeyboard([
                [Markup.button.callback("➕ Thêm mã", "ADMIN:ADD_COUPON")],
                [Markup.button.callback("🔙 Quay lại", "ADMIN:PANEL")],
            ]),
        });
    });

    bot.action("ADMIN:ADD_COUPON", adminOnly, async (ctx) => {
        await ctx.answerCbQuery();
        adminSessions.set(ctx.from.id, { action: "ADD_COUPON" });

        await ctx.editMessageText(
            `➕ *Thêm mã giảm giá*\n\nNhập theo format:\n\`CODE|DISCOUNT|TYPE|MAX_USES\`\n\nVí dụ:\n\`SALE50|50|PERCENT|100\`\n\`GIAM10K|10000|FIXED|50\``,
            { parse_mode: "Markdown", ...Markup.inlineKeyboard([[Markup.button.callback("❌ Huỷ", "ADMIN:COUPONS")]]) }
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

        let msg = `👥 *Người dùng*\n\n`;
        msg += `📊 Tổng: ${totalUsers}\n`;
        msg += `📅 Hoạt động hôm nay: ${activeToday.length}\n\n`;
        msg += `🏆 *Top mua hàng:*\n`;

        for (let i = 0; i < topBuyers.length; i++) {
            const b = topBuyers[i];
            msg += `${i + 1}. ${b.odelegramId} - ${b._sum.finalAmount.toLocaleString()}đ (${b._count} đơn)\n`;
        }

        await ctx.editMessageText(msg, {
            parse_mode: "Markdown",
            ...Markup.inlineKeyboard([[Markup.button.callback("🔙 Quay lại", "ADMIN:PANEL")]]),
        });
    });

    // === BACKUP ===
    bot.action("ADMIN:BACKUP", adminOnly, async (ctx) => {
        await ctx.answerCbQuery();

        const backups = await listBackups();

        let msg = `💾 *Backup*\n\n`;
        if (backups.length) {
            msg += `📁 Backups gần đây:\n`;
            for (const b of backups.slice(0, 5)) {
                msg += `• ${b.filename} (${(b.size / 1024).toFixed(1)}KB)\n`;
            }
        } else {
            msg += `Chưa có backup nào.`;
        }

        await ctx.editMessageText(msg, {
            parse_mode: "Markdown",
            ...Markup.inlineKeyboard([
                [Markup.button.callback("💾 Tạo backup ngay", "ADMIN:CREATE_BACKUP")],
                [Markup.button.callback("🔙 Quay lại", "ADMIN:PANEL")],
            ]),
        });
    });

    bot.action("ADMIN:CREATE_BACKUP", adminOnly, async (ctx) => {
        await ctx.answerCbQuery("Đang tạo backup...");

        const result = await createBackup(bot);
        await logAction(ctx.from.id, Actions.BACKUP, null, { success: result.success });

        if (result.success) {
            await ctx.editMessageText(
                `✅ Backup thành công!\n📁 ${result.filename}\n📊 ${(result.size / 1024).toFixed(1)}KB`,
                Markup.inlineKeyboard([[Markup.button.callback("🔙 Quay lại", "ADMIN:BACKUP")]])
            );
        } else {
            await ctx.editMessageText(
                `❌ Backup thất bại: ${result.error}`,
                Markup.inlineKeyboard([[Markup.button.callback("🔙 Quay lại", "ADMIN:BACKUP")]])
            );
        }
    });

    // === VIP MANAGEMENT ===
    bot.action("ADMIN:VIP", adminOnly, async (ctx) => {
        await ctx.answerCbQuery();

        const levels = await getVipLevels();
        let msg = `👑 *Quản lý VIP*\n\n`;

        for (const l of levels) {
            msg += `${getVipEmoji(l.level)} *${l.name}* (Level ${l.level})\n`;
            msg += `├─ Chi tiêu: ${l.minSpent.toLocaleString()}đ\n`;
            msg += `├─ Giảm giá: ${l.discountPercent}%\n`;
            msg += `└─ Hoa hồng: ${l.referralBonus}%\n\n`;
        }

        const vipUsers = await prisma.user.count({ where: { vipLevel: { gt: 0 } } });
        msg += `\n📊 Tổng VIP: ${vipUsers} users`;

        await ctx.editMessageText(msg, {
            parse_mode: "Markdown",
            ...Markup.inlineKeyboard([
                [Markup.button.callback("👤 Set VIP User", "ADMIN:SET_VIP")],
                [Markup.button.callback("🔙 Quay lại", "ADMIN:PANEL")],
            ]),
        });
    });

    bot.action("ADMIN:SET_VIP", adminOnly, async (ctx) => {
        await ctx.answerCbQuery();
        adminSessions.set(ctx.from.id, { action: "SET_VIP" });

        await ctx.editMessageText(
            `👑 *Set VIP cho User*\n\nNhập theo format:\n\`TELEGRAM_ID|LEVEL\`\n\nVí dụ: \`123456789|2\`\n\nLevels: 0=Thường, 1=Bạc, 2=Vàng, 3=Kim Cương`,
            { parse_mode: "Markdown", ...Markup.inlineKeyboard([[Markup.button.callback("❌ Huỷ", "ADMIN:VIP")]]) }
        );
    });

    // === WALLET MANAGEMENT ===
    bot.action("ADMIN:WALLET", adminOnly, async (ctx) => {
        await ctx.answerCbQuery();

        // Get total wallet stats
        const wallets = await prisma.wallet.findMany();
        const totalBalance = wallets.reduce((sum, w) => sum + w.balance, 0);
        const walletCount = wallets.length;

        const msg = `💰 *Quản lý Ví Khách hàng*\n\n` +
            `📊 Tổng ví: ${walletCount}\n` +
            `💵 Tổng số dư: ${totalBalance.toLocaleString()}đ\n\n` +
            `Chọn thao tác:`;

        await ctx.editMessageText(msg, {
            parse_mode: "Markdown",
            ...Markup.inlineKeyboard([
                [Markup.button.callback("🔍 Tra cứu số dư", "ADMIN:WALLET_CHECK")],
                [Markup.button.callback("➕ Cộng tiền", "ADMIN:WALLET_ADD")],
                [Markup.button.callback("➖ Trừ tiền", "ADMIN:WALLET_DEDUCT")],
                [Markup.button.callback("🔙 Quay lại", "ADMIN:PANEL")],
            ]),
        });
    });

    bot.action("ADMIN:WALLET_CHECK", adminOnly, async (ctx) => {
        await ctx.answerCbQuery();
        adminSessions.set(ctx.from.id, { action: "WALLET_CHECK" });

        await ctx.editMessageText(
            `🔍 *Tra cứu số dư*\n\nNhập Telegram ID của khách hàng:`,
            { parse_mode: "Markdown", ...Markup.inlineKeyboard([[Markup.button.callback("❌ Huỷ", "ADMIN:WALLET")]]) }
        );
    });

    bot.action("ADMIN:WALLET_ADD", adminOnly, async (ctx) => {
        await ctx.answerCbQuery();
        adminSessions.set(ctx.from.id, { action: "WALLET_ADD" });

        await ctx.editMessageText(
            `➕ *Cộng tiền vào ví*\n\nNhập theo format:\n\`TELEGRAM_ID|SỐ_TIỀN|LÝ_DO\`\n\nVí dụ: \`123456789|50000|Bonus chương trình\``,
            { parse_mode: "Markdown", ...Markup.inlineKeyboard([[Markup.button.callback("❌ Huỷ", "ADMIN:WALLET")]]) }
        );
    });

    bot.action("ADMIN:WALLET_DEDUCT", adminOnly, async (ctx) => {
        await ctx.answerCbQuery();
        adminSessions.set(ctx.from.id, { action: "WALLET_DEDUCT" });

        await ctx.editMessageText(
            `➖ *Trừ tiền khỏi ví*\n\nNhập theo format:\n\`TELEGRAM_ID|SỐ_TIỀN|LÝ_DO\`\n\nVí dụ: \`123456789|20000|Hoàn hàng\``,
            { parse_mode: "Markdown", ...Markup.inlineKeyboard([[Markup.button.callback("❌ Huỷ", "ADMIN:WALLET")]]) }
        );
    });

    // === BROADCAST ===
    bot.action("ADMIN:BROADCAST", adminOnly, async (ctx) => {
        await ctx.answerCbQuery();

        const history = await getBroadcastHistory(5);
        let msg = `📢 *Broadcast*\n\nGửi thông báo đến tất cả users.\n\n`;

        if (history.length) {
            msg += `📋 *Lịch sử:*\n`;
            for (const b of history) {
                const date = b.createdAt.toLocaleDateString("vi-VN");
                msg += `• ${date}: ${b.sentCount}✅ ${b.failCount}❌\n`;
            }
        }

        await ctx.editMessageText(msg, {
            parse_mode: "Markdown",
            ...Markup.inlineKeyboard([
                [Markup.button.callback("📢 Gửi Broadcast", "ADMIN:SEND_BROADCAST")],
                [Markup.button.callback("👑 Gửi VIP Only", "ADMIN:SEND_VIP_BROADCAST")],
                [Markup.button.callback("🔙 Quay lại", "ADMIN:PANEL")],
            ]),
        });
    });

    bot.action("ADMIN:SEND_BROADCAST", adminOnly, async (ctx) => {
        await ctx.answerCbQuery();
        adminSessions.set(ctx.from.id, { action: "BROADCAST" });

        await ctx.editMessageText(
            `📢 *Gửi Broadcast*\n\nNhập nội dung tin nhắn:\n\n_Hỗ trợ HTML: <b>bold</b>, <i>italic</i>, <code>code</code>_`,
            { parse_mode: "Markdown", ...Markup.inlineKeyboard([[Markup.button.callback("❌ Huỷ", "ADMIN:BROADCAST")]]) }
        );
    });

    bot.action("ADMIN:SEND_VIP_BROADCAST", adminOnly, async (ctx) => {
        await ctx.answerCbQuery();
        adminSessions.set(ctx.from.id, { action: "VIP_BROADCAST" });

        await ctx.editMessageText(
            `👑 *Gửi VIP Broadcast*\n\nNhập nội dung tin nhắn (chỉ gửi cho VIP users):`,
            { parse_mode: "Markdown", ...Markup.inlineKeyboard([[Markup.button.callback("❌ Huỷ", "ADMIN:BROADCAST")]]) }
        );
    });

    // === EXPORT ===
    bot.action("ADMIN:EXPORT", adminOnly, async (ctx) => {
        await ctx.answerCbQuery();

        await ctx.editMessageText(
            `📥 *Export Báo Cáo*\n\nChọn loại báo cáo:`,
            {
                parse_mode: "Markdown",
                ...Markup.inlineKeyboard([
                    [Markup.button.callback("📋 Đơn hàng", "ADMIN:EXPORT:ORDERS")],
                    [Markup.button.callback("💰 Doanh thu", "ADMIN:EXPORT:REVENUE")],
                    [Markup.button.callback("👥 Users", "ADMIN:EXPORT:USERS")],
                    [Markup.button.callback("📦 Sản phẩm", "ADMIN:EXPORT:PRODUCTS")],
                    [Markup.button.callback("🔙 Quay lại", "ADMIN:PANEL")],
                ]),
            }
        );
    });

    bot.action("ADMIN:EXPORT:ORDERS", adminOnly, async (ctx) => {
        await ctx.answerCbQuery("Đang xuất...");

        try {
            const result = await exportOrdersCSV();
            await ctx.replyWithDocument({ source: result.filepath, filename: result.filename }, {
                caption: `📋 Xuất đơn hàng thành công!\n📊 ${result.count} đơn`,
            });
        } catch (e) {
            await ctx.reply(`❌ Lỗi: ${e.message}`);
        }
    });

    bot.action("ADMIN:EXPORT:REVENUE", adminOnly, async (ctx) => {
        await ctx.answerCbQuery("Đang xuất...");

        try {
            const result = await exportRevenueCSV(30);
            await ctx.replyWithDocument({ source: result.filepath, filename: result.filename }, {
                caption: `💰 Doanh thu ${result.days} ngày\n📊 ${result.totalOrders} đơn | ${result.totalRevenue.toLocaleString()}đ`,
            });
        } catch (e) {
            await ctx.reply(`❌ Lỗi: ${e.message}`);
        }
    });

    bot.action("ADMIN:EXPORT:USERS", adminOnly, async (ctx) => {
        await ctx.answerCbQuery("Đang xuất...");

        try {
            const result = await exportUsersCSV();
            await ctx.replyWithDocument({ source: result.filepath, filename: result.filename }, {
                caption: `👥 Xuất users thành công!\n📊 ${result.count} users`,
            });
        } catch (e) {
            await ctx.reply(`❌ Lỗi: ${e.message}`);
        }
    });

    bot.action("ADMIN:EXPORT:PRODUCTS", adminOnly, async (ctx) => {
        await ctx.answerCbQuery("Đang xuất...");

        try {
            const result = await exportProductsCSV();
            await ctx.replyWithDocument({ source: result.filepath, filename: result.filename }, {
                caption: `📦 Xuất sản phẩm thành công!\n📊 ${result.count} sản phẩm`,
            });
        } catch (e) {
            await ctx.reply(`❌ Lỗi: ${e.message}`);
        }
    });

    // === AUDIT LOGS ===
    bot.action("ADMIN:LOGS", adminOnly, async (ctx) => {
        await ctx.answerCbQuery();

        const logs = await getRecentLogs(15);
        let msg = `📝 *Nhật ký Admin*\n\n`;

        if (logs.length) {
            for (const log of logs) {
                msg += `${formatLog(log)}\n`;
            }
        } else {
            msg += `Chưa có logs.`;
        }

        await ctx.editMessageText(msg, {
            parse_mode: "Markdown",
            ...Markup.inlineKeyboard([[Markup.button.callback("🔙 Quay lại", "ADMIN:PANEL")]]),
        });
    });

    // === TEXT HANDLERS FOR MULTI-STEP are consolidated below ===

    // === DOCUMENT HANDLER FOR FILE UPLOAD (TXT STOCK) ===
    bot.on("document", async (ctx, next) => {
        const session = adminSessions.get(ctx.from.id);
        if (!session) return next();
        if (!isAdmin(ctx.from.id)) return next();

        // Add stock via file
        if (session.action === "ADD_STOCK") {
            const doc = ctx.message.document;

            // Basic validation
            if (doc.mime_type !== "text/plain" && !doc.file_name.endsWith(".txt")) {
                return ctx.reply("❌ Vui lòng gửi file .txt");
            }

            try {
                // Get file link
                const fileLink = await ctx.telegram.getFileLink(doc.file_id);
                const response = await fetch(fileLink.href);
                const text = await response.text();

                const lines = text.split("\n").map((l) => l.trim()).filter((l) => l.length > 0);

                if (lines.length === 0) {
                    return ctx.reply("❌ File trống hoặc không có dòng nào hợp lệ.");
                }

                // Add to DB
                await prisma.stockItem.createMany({
                    data: lines.map((content) => ({ productId: session.productId, content, isSold: false })),
                });

                const total = await prisma.stockItem.count({ where: { productId: session.productId, isSold: false } });
                adminSessions.delete(ctx.from.id);

                await ctx.reply(`✅ Đã đọc file và thêm ${lines.length} stock Items!\nTổng còn: ${total}`);
            } catch (e) {
                console.error("File upload error:", e);
                await ctx.reply(`❌ Lỗi đọc file: ${e.message}`);
            }
            return;
        }

        return next();
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

        // Add product flow (code is auto-generated, starts at step 2)
        if (session.action === "ADD_PRODUCT") {
            if (session.step === 2) {
                session.name = text;
                session.step = 3;
                await ctx.reply("Bước 3/5: Nhập giá (VND):");
            } else if (session.step === 3) {
                session.price = parseInt(text.replace(/[,.]/g, ""), 10);
                if (isNaN(session.price)) {
                    return ctx.reply("❌ Giá không hợp lệ. Nhập lại:");
                }
                session.step = 4;
                await ctx.reply("Bước 4/5: Nhập lưu ý/mô tả sản phẩm (hoặc gõ 'skip' để bỏ qua):");
            } else if (session.step === 4) {
                session.notes = text.toLowerCase() === 'skip' ? '' : text;
                session.step = 5;
                await ctx.reply(
                    "Bước 5/5: Chọn mode:",
                    Markup.inlineKeyboard([
                        [Markup.button.callback("📝 TEXT", "ADMIN:MODE:TEXT")],
                        [Markup.button.callback("📁 FILE", "ADMIN:MODE:FILE")],
                        [Markup.button.callback("📊 STOCK_LINES", "ADMIN:MODE:STOCK_LINES")],
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
                    return ctx.reply("❌ Không có dữ liệu hợp lệ. Thử lại:");
                }

                console.log(`[ADMIN] Adding ${lines.length} stock items for product ${session.productId}`);

                await prisma.stockItem.createMany({
                    data: lines.map((content) => ({ productId: session.productId, content, isSold: false })),
                });

                const total = await prisma.stockItem.count({ where: { productId: session.productId, isSold: false } });
                adminSessions.delete(ctx.from.id);

                console.log(`[ADMIN] Stock added successfully. Total: ${total}`);
                await ctx.reply(`✅ Đã nạp ${lines.length} tài khoản!\nTổng còn: ${total}`);
            } catch (e) {
                console.error(`[ADMIN] Stock add error:`, e);
                await ctx.reply(`❌ Lỗi khi nạp stock: ${e.message}`);
            }
            return;
        }

        // Add coupon flow
        if (session.action === "ADD_COUPON") {
            const parts = text.split("|").map((s) => s.trim());
            if (parts.length < 3) {
                return ctx.reply("❌ Sai format. Nhập lại: CODE|DISCOUNT|TYPE|MAX_USES");
            }

            const [code, discountStr, type, maxUsesStr] = parts;
            const discount = parseInt(discountStr, 10);
            const maxUses = maxUsesStr ? parseInt(maxUsesStr, 10) : null;

            if (isNaN(discount)) {
                return ctx.reply("❌ Discount không hợp lệ");
            }

            try {
                await createCoupon({
                    code,
                    discount,
                    discountType: type.toUpperCase() === "PERCENT" ? "PERCENT" : "FIXED",
                    maxUses,
                });

                adminSessions.delete(ctx.from.id);
                await ctx.reply(`✅ Đã tạo mã: ${code.toUpperCase()}`);
            } catch (e) {
                await ctx.reply(`❌ Lỗi: ${e.message}`);
            }
            return;
        }

        // Change price flow
        if (session.action === "CHANGE_PRICE") {
            const newPrice = parseInt(text.replace(/[,.]/g, ""), 10);
            if (isNaN(newPrice) || newPrice <= 0) {
                return ctx.reply("❌ Giá không hợp lệ. Nhập lại:");
            }

            await prisma.product.update({
                where: { id: session.productId },
                data: { price: newPrice },
            });

            adminSessions.delete(ctx.from.id);
            await ctx.reply(`✅ Đã đổi giá ${session.productName} thành ${newPrice.toLocaleString()}đ`);
            return;
        }

        // Change payload flow
        if (session.action === "CHANGE_PAYLOAD") {
            await prisma.product.update({
                where: { id: session.productId },
                data: { payload: text },
            });

            await logAction(ctx.from.id, Actions.CHANGE_PAYLOAD, session.productName);
            adminSessions.delete(ctx.from.id);
            await ctx.reply(`✅ Đã cập nhật payload cho ${session.productName}`);
            return;
        }

        // Add category - enter name
        if (session.action === "ADD_CATEGORY_NAME") {
            adminSessions.set(ctx.from.id, { action: "ADD_CATEGORY_ICON", name: text });
            await ctx.reply(
                `🎨 *ICON DANH MỤC*\n\nNhập emoji icon:\n\n_Ví dụ: 📧, 🤖, ✂️..._`,
                { parse_mode: "Markdown" }
            );
            return;
        }

        // Add category - enter icon
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

            adminSessions.delete(ctx.from.id);
            await ctx.reply(`✅ Đã tạo danh mục: ${text} ${session.name}`);
            return;
        }

        // Edit category name
        if (session.action === "EDIT_CATEGORY_NAME") {
            await prisma.category.update({
                where: { id: session.categoryId },
                data: { name: text }
            });

            adminSessions.delete(ctx.from.id);
            await ctx.reply(`✅ Đã đổi tên danh mục thành: ${text}`);
            return;
        }

        // Edit category icon
        if (session.action === "EDIT_CATEGORY_ICON") {
            await prisma.category.update({
                where: { id: session.categoryId },
                data: { icon: text }
            });

            adminSessions.delete(ctx.from.id);
            await ctx.reply(`✅ Đã đổi icon danh mục thành: ${text}`);
            return;
        }

        // Edit category order
        if (session.action === "EDIT_CATEGORY_ORDER") {
            const order = parseInt(text, 10);
            if (isNaN(order) || order < 1) {
                return ctx.reply("❌ Thứ tự không hợp lệ. Nhập số > 0:");
            }

            await prisma.category.update({
                where: { id: session.categoryId },
                data: { order }
            });

            adminSessions.delete(ctx.from.id);
            await ctx.reply(`✅ Đã đổi thứ tự danh mục thành: ${order}`);
            return;
        }

        // Set VIP flow
        if (session.action === "SET_VIP") {
            const parts = text.split("|").map(s => s.trim());
            if (parts.length !== 2) {
                return ctx.reply("❌ Sai format. Nhập lại: TELEGRAM_ID|LEVEL");
            }

            const [telegramId, levelStr] = parts;
            const level = parseInt(levelStr, 10);

            if (isNaN(level) || level < 0 || level > 3) {
                return ctx.reply("❌ Level không hợp lệ (0-3)");
            }

            try {
                const user = await prisma.user.findUnique({ where: { telegramId } });
                if (!user) {
                    return ctx.reply("❌ Không tìm thấy user");
                }

                await setVipLevel(user.id, level);
                await logAction(ctx.from.id, Actions.SET_VIP, telegramId, { level });
                adminSessions.delete(ctx.from.id);
                await ctx.reply(`✅ Đã set VIP Level ${level} cho ${user.firstName || telegramId}`);
            } catch (e) {
                await ctx.reply(`❌ Lỗi: ${e.message}`);
            }
            return;
        }

        // Wallet check balance
        if (session.action === "WALLET_CHECK") {
            const telegramId = text.trim();

            try {
                const balance = await getBalance(telegramId);
                const transactions = await getTransactionHistory(telegramId, 5);

                let msg = `💰 *Số dư ví*\n\n` +
                    `👤 User: \`${telegramId}\`\n` +
                    `💵 Số dư: *${balance.toLocaleString()}đ*\n\n`;

                if (transactions.length > 0) {
                    msg += `📊 *Giao dịch gần đây:*\n`;
                    for (const tx of transactions) {
                        const sign = tx.amount >= 0 ? "+" : "";
                        const date = new Date(tx.createdAt).toLocaleDateString("vi-VN");
                        msg += `• ${date}: ${sign}${tx.amount.toLocaleString()}đ (${tx.type})\n`;
                    }
                }

                adminSessions.delete(ctx.from.id);
                await ctx.reply(msg, { parse_mode: "Markdown" });
            } catch (e) {
                await ctx.reply(`❌ Lỗi: ${e.message}`);
            }
            return;
        }

        // Wallet add balance
        if (session.action === "WALLET_ADD") {
            const parts = text.split("|").map(s => s.trim());
            if (parts.length < 2) {
                return ctx.reply("❌ Sai format. Nhập lại: TELEGRAM_ID|SỐ_TIỀN|LÝ_DO");
            }

            const [telegramId, amountStr, reason] = parts;
            const amount = parseInt(amountStr.replace(/[,.]/g, ""), 10);

            if (isNaN(amount) || amount <= 0) {
                return ctx.reply("❌ Số tiền không hợp lệ");
            }

            try {
                const result = await adminAddBalance(telegramId, amount, ctx.from.id, reason);

                if (result.success) {
                    await logAction(ctx.from.id, "WALLET_ADD", telegramId, { amount, reason });
                    adminSessions.delete(ctx.from.id);
                    await ctx.reply(
                        `✅ *Đã cộng tiền!*\n\n` +
                        `👤 User: \`${telegramId}\`\n` +
                        `💰 Số tiền: +${amount.toLocaleString()}đ\n` +
                        `💵 Số dư mới: ${result.newBalance.toLocaleString()}đ`,
                        { parse_mode: "Markdown" }
                    );

                    // Notify user
                    try {
                        await bot.telegram.sendMessage(
                            telegramId,
                            `✅ *SỐ DƯ CẬP NHẬT*\n\n` +
                            `💰 Số tiền: +${amount.toLocaleString()}đ\n` +
                            `💵 Số dư mới: ${result.newBalance.toLocaleString()}đ\n` +
                            `📝 Lý do: ${reason || "Admin cộng tiền"}`,
                            { parse_mode: "Markdown" }
                        );
                    } catch (e) { }
                } else {
                    await ctx.reply(`❌ Lỗi: ${result.error}`);
                }
            } catch (e) {
                await ctx.reply(`❌ Lỗi: ${e.message}`);
            }
            return;
        }

        // Wallet deduct balance
        if (session.action === "WALLET_DEDUCT") {
            const parts = text.split("|").map(s => s.trim());
            if (parts.length < 2) {
                return ctx.reply("❌ Sai format. Nhập lại: TELEGRAM_ID|SỐ_TIỀN|LÝ_DO");
            }

            const [telegramId, amountStr, reason] = parts;
            const amount = parseInt(amountStr.replace(/[,.]/g, ""), 10);

            if (isNaN(amount) || amount <= 0) {
                return ctx.reply("❌ Số tiền không hợp lệ");
            }

            try {
                const result = await adminDeductBalance(telegramId, amount, ctx.from.id, reason);

                if (result.success) {
                    await logAction(ctx.from.id, "WALLET_DEDUCT", telegramId, { amount, reason });
                    adminSessions.delete(ctx.from.id);
                    await ctx.reply(
                        `✅ *Đã trừ tiền!*\n\n` +
                        `👤 User: \`${telegramId}\`\n` +
                        `💰 Số tiền: -${amount.toLocaleString()}đ\n` +
                        `💵 Số dư mới: ${result.newBalance.toLocaleString()}đ`,
                        { parse_mode: "Markdown" }
                    );

                    // Notify user
                    try {
                        await bot.telegram.sendMessage(
                            telegramId,
                            `⚠️ *SỐ DƯ CẬP NHẬT*\n\n` +
                            `💰 Số tiền: -${amount.toLocaleString()}đ\n` +
                            `💵 Số dư mới: ${result.newBalance.toLocaleString()}đ\n` +
                            `📝 Lý do: ${reason || "Admin trừ tiền"}`,
                            { parse_mode: "Markdown" }
                        );
                    } catch (e) { }
                } else {
                    await ctx.reply(`❌ Lỗi: ${result.error}`);
                }
            } catch (e) {
                await ctx.reply(`❌ Lỗi: ${e.message}`);
            }
            return;
        }

        // Broadcast flow
        if (session.action === "BROADCAST") {
            adminSessions.delete(ctx.from.id);
            await ctx.reply("📢 Đang gửi broadcast...");

            const result = await sendBroadcast(bot, text, ctx.from.id);
            await ctx.reply(
                `✅ *Broadcast hoàn tất!*\n\n` +
                `📤 Đã gửi: ${result.sentCount}\n` +
                `❌ Thất bại: ${result.failCount}\n` +
                `📊 Tổng: ${result.total}`,
                { parse_mode: "Markdown" }
            );
            return;
        }

        // VIP Broadcast flow
        if (session.action === "VIP_BROADCAST") {
            adminSessions.delete(ctx.from.id);
            await ctx.reply("👑 Đang gửi VIP broadcast...");

            const { sendVipBroadcast } = await import("./broadcast.js");
            const result = await sendVipBroadcast(bot, text, 1, ctx.from.id);
            await ctx.reply(
                `✅ *VIP Broadcast hoàn tất!*\n\n` +
                `📤 Đã gửi: ${result.sentCount}\n` +
                `❌ Thất bại: ${result.failCount}\n` +
                `📊 Tổng VIP: ${result.total}`,
                { parse_mode: "Markdown" }
            );
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
            return ctx.reply("❌ Session expired");
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

            await logAction(ctx.from.id, Actions.ADD_PRODUCT, session.name);
            adminSessions.delete(ctx.from.id);

            const notesInfo = session.notes ? `\n📝 Lưu ý: ${session.notes}` : '';
            await ctx.reply(
                `✅ Đã tạo sản phẩm!\n\n` +
                `📁 Danh mục: ${session.categoryName}\n` +
                `📝 Tên: ${session.name}\n` +
                `💰 Giá: ${session.price.toLocaleString()}đ\n` +
                `📊 Mode: ${mode}` +
                notesInfo
            );
        } catch (e) {
            await ctx.reply(`❌ Lỗi: ${e.message}`);
        }
    });

    console.log("✅ Admin v2 commands registered");
}
