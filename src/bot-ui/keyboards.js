import { Markup } from "telegraf";
import { formatCurrency, truncateText } from "./format.js";

function buildCategoryButton(category) {
    const count = category._count?.products ?? category.productCount ?? 0;
    const text = category.iconEmojiId
        ? `${truncateText(category.name, 28)} (${count})`
        : `${category.icon || "📁"} ${truncateText(category.name, 28)} (${count})`;

    return {
        text,
        callback_data: `category:${category.id}`,
        ...(category.iconEmojiId ? { icon_custom_emoji_id: category.iconEmojiId } : {}),
    };
}

export function buildMainMenuKeyboard({ hasWallet = true, isAdmin = false } = {}) {
    const rows = [
        [
            Markup.button.callback("🛍️ Sản Phẩm", "ALL_PRODUCTS"),
            Markup.button.callback("💰 Nạp tiền", "WALLET"),
        ],
        [
            Markup.button.callback("📦 Đơn hàng", "MY_ORDERS"),
            Markup.button.callback("👤 Tài khoản", "ACCOUNT"),
        ],
        [
            Markup.button.callback("💬 Hỗ trợ", "HELP"),
            Markup.button.callback("🎁 Giới thiệu", "REFERRAL"),
        ],
        [
            Markup.button.callback("🔥 Sản phẩm hot", "HOT_PRODUCTS"),
            Markup.button.callback("📂 Danh mục", "LIST_PRODUCTS"),
        ],
    ];

    if (isAdmin) {
        rows.push([Markup.button.callback("🛠️ Admin Panel", "ADMIN:PANEL")]);
    }

    return Markup.inlineKeyboard(rows);
}

export function buildReplyKeyboard({ isAdmin = false } = {}) {
    const rows = [
        ["🛍️ Sản Phẩm", "💰 Nạp tiền"],
        ["📦 Đơn hàng", "👤 Tài khoản"],
        ["💬 Hỗ trợ", "❌ Đóng"],
    ];

    if (isAdmin) {
        rows.push(["🛠️ Admin"]);
    }

    return Markup.keyboard(rows).resize();
}

export function buildCategoriesKeyboard(categories, { page = 1, totalPages = 1 } = {}) {
    const rows = categories.map((category) => {
        return [
            buildCategoryButton(category),
        ];
    });

    if (totalPages > 1) {
        const nav = [];
        if (page > 1) nav.push(Markup.button.callback("⬅️ Trang trước", `category_page:${page - 1}`));
        if (page < totalPages) nav.push(Markup.button.callback("Trang sau ➡️", `category_page:${page + 1}`));
        if (nav.length) rows.push(nav);
    }

    rows.push([
        Markup.button.callback("⬅️ Quay lại", "BACK_HOME"),
        Markup.button.callback("🏠 Menu chính", "BACK_HOME"),
    ]);

    return Markup.inlineKeyboard(rows);
}

export function buildProductsKeyboard(products, { categoryId, page = 1, totalPages = 1, stockById = new Map(), category = null, emojiById = new Map() } = {}) {
    const rows = products.map((product) => {
        const price = product.price > 0 ? formatCurrency(product.price, product.currency) : "Miễn phí";
        const emoji = emojiById.get(product.id);
        let label;
        if (product.deliveryMode === "STOCK_LINES") {
            const count = stockById.get(product.id) ?? 0;
            if (count <= 0) {
                label = `🔴 ${truncateText(product.name, 22)} - ${price} [❌ Hết]`;
            } else {
                label = `🟢 ${truncateText(product.name, 22)} - ${price} [${count}]`;
            }
        } else {
            const icon = emoji?.char || "🟢";
            label = `${icon} ${truncateText(product.name, 26)} - ${price}`;
        }
        const btn = { text: label, callback_data: `product:${product.id}` };
        if (emoji?.id) btn.icon_custom_emoji_id = emoji.id;
        return [btn];
    });

    if (totalPages > 1) {
        const nav = [];
        if (page > 1) nav.push(Markup.button.callback("⬅️ Trang trước", `products:${categoryId}:${page - 1}`));
        if (page < totalPages) nav.push(Markup.button.callback("Trang sau ➡️", `products:${categoryId}:${page + 1}`));
        if (nav.length) rows.push(nav);
    }

    rows.push([
        Markup.button.callback("📂 Danh mục", "LIST_PRODUCTS"),
        Markup.button.callback("🏠 Menu chính", "BACK_HOME"),
    ]);

    return Markup.inlineKeyboard(rows);
}

export function buildProductDetailKeyboard({ productId, quantity = 1, inStock = true, categoryId = null } = {}) {
    if (!inStock) {
        return Markup.inlineKeyboard([
            [Markup.button.callback("❌ Hết hàng", "NO_PRODUCTS")],
            [
                Markup.button.callback("📂 Sản phẩm khác", categoryId ? `products:${categoryId}:1` : "LIST_PRODUCTS"),
                Markup.button.callback("🏠 Menu chính", "BACK_HOME"),
            ],
        ]);
    }

    return Markup.inlineKeyboard([
        [
            Markup.button.callback("➖", `qty_dec:${productId}:${quantity}`),
            Markup.button.callback(`SL: ${quantity}`, `noop:${productId}`),
            Markup.button.callback("➕", `qty_inc:${productId}:${quantity}`),
        ],
        [Markup.button.callback("⚡ Mua ngay", `buy_now:${productId}:${quantity}`)],
        [
            Markup.button.callback("📂 Sản phẩm khác", categoryId ? `products:${categoryId}:1` : "LIST_PRODUCTS"),
            Markup.button.callback("🏠 Menu chính", "BACK_HOME"),
        ],
    ]);
}

export function buildContactProductKeyboard(adminUsername, categoryId = null) {
    const rows = [];
    if (adminUsername) {
        rows.push([Markup.button.url("👨‍💻 Chat admin", `https://t.me/${adminUsername.replace(/^@/, "")}`)]);
    }
    rows.push([
        Markup.button.callback("📂 Sản phẩm khác", categoryId ? `products:${categoryId}:1` : "LIST_PRODUCTS"),
        Markup.button.callback("🏠 Menu chính", "BACK_HOME"),
    ]);
    return Markup.inlineKeyboard(rows);
}

export function buildCheckoutKeyboard({ canPayWallet = false, canDeposit = true } = {}) {
    const rows = [];
    if (canPayWallet) {
        rows.push([Markup.button.callback("✅ Thanh toán bằng ví", "PAY_WALLET")]);
    } else if (canDeposit) {
        rows.push([Markup.button.callback("💳 Nạp tiền vào ví", "WALLET")]);
    }
    rows.push([Markup.button.callback("🏦 Chuyển khoản QR", "PAY_QR")]);
    rows.push([
        Markup.button.callback("✏️ Sửa lựa chọn", "LIST_PRODUCTS"),
        Markup.button.callback("❌ Hủy", "CANCEL_CHECKOUT"),
    ]);
    return Markup.inlineKeyboard(rows);
}

export function buildOrderListKeyboard(orders = []) {
    const rows = orders.slice(0, 10).map((order) => [
        Markup.button.callback(`📦 ${order.id.slice(-8).toUpperCase()}`, `ORDER:${order.id}`),
    ]);
    rows.push([
        Markup.button.callback("🛒 Mua tiếp", "LIST_PRODUCTS"),
        Markup.button.callback("🏠 Menu chính", "BACK_HOME"),
    ]);
    return Markup.inlineKeyboard(rows);
}

export function buildOrderDetailKeyboard(order) {
    const rows = [];
    if (order?.status === "PENDING" || order?.status === "PAID") {
        rows.push([Markup.button.callback("❌ Hủy đơn hàng", `CANCEL_ORDER:${order.id}`)]);
    }
    rows.push([
        Markup.button.callback("🔄 Làm mới", `ORDER:${order.id}`),
        Markup.button.callback("🛒 Mua lại", `product:${order.productId}`),
    ]);
    rows.push([
        Markup.button.callback("📦 Đơn hàng", "MY_ORDERS"),
        Markup.button.callback("🏠 Menu chính", "BACK_HOME"),
    ]);
    return Markup.inlineKeyboard(rows);
}

export function buildWalletKeyboard() {
    return Markup.inlineKeyboard([
        [
            Markup.button.callback("50.000đ", "DEPOSIT:50000"),
            Markup.button.callback("100.000đ", "DEPOSIT:100000"),
        ],
        [
            Markup.button.callback("200.000đ", "DEPOSIT:200000"),
            Markup.button.callback("500.000đ", "DEPOSIT:500000"),
        ],
        [Markup.button.callback("💵 Số tiền khác", "DEPOSIT:CUSTOM")],
        [Markup.button.callback("🏠 Menu chính", "BACK_HOME")],
    ]);
}

export function buildSupportKeyboard(adminUsername) {
    const rows = [];
    if (adminUsername) {
        rows.push([Markup.button.url("👨‍💻 Liên hệ admin", `https://t.me/${adminUsername.replace(/^@/, "")}`)]);
    }
    rows.push(
        [Markup.button.callback("📘 Hướng dẫn mua hàng", "HELP:BUYING")],
        [Markup.button.callback("❓ Câu hỏi thường gặp", "HELP:PAYMENT")],
        [Markup.button.callback("🏠 Menu chính", "BACK_HOME")],
    );
    return Markup.inlineKeyboard(rows);
}

export function buildAdminMenuKeyboard() {
    return Markup.inlineKeyboard([
        [
            Markup.button.callback("📦 Quản lý đơn", "ADMIN:ORDERS"),
            Markup.button.callback("🛒 Sản phẩm", "ADMIN:PRODUCTS"),
        ],
        [
            Markup.button.callback("📂 Danh mục", "ADMIN:CATEGORIES"),
            Markup.button.callback("👥 Người dùng", "ADMIN:USERS"),
        ],
        [
            Markup.button.callback("📊 Thống kê", "ADMIN:STATS"),
            Markup.button.callback("💰 Ví khách", "ADMIN:WALLET"),
        ],
        [
            Markup.button.callback("🎫 Coupon", "ADMIN:COUPONS"),
            Markup.button.callback("📢 Broadcast", "ADMIN:BROADCAST"),
        ],
        [
            Markup.button.callback("📥 Export", "ADMIN:EXPORT"),
            Markup.button.callback("💾 Backup", "ADMIN:BACKUP"),
        ],
        [Markup.button.callback("🏠 Về shop", "BACK_HOME")],
    ]);
}
