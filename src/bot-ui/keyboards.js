import { Markup } from "telegraf";
import { formatCurrency, truncateText } from "./format.js";

function productPrice(product) {
    return product.price > 0 ? formatCurrency(product.price, product.currency) : "Liên hệ";
}

function compactProductLabel(product, { stockById = new Map(), soldById = new Map(), emojiById = new Map() } = {}) {
    const emoji = emojiById.get(product.id);
    const sold = soldById.get(product.id) ?? 0;
    const soldSuffix = sold > 0 ? ` · Đã bán ${sold}` : "";

    if (product.deliveryMode === "STOCK_LINES") {
        const count = stockById.get(product.id) ?? 0;
        const name = truncateText(product.name, 22);
        const price = productPrice(product);
        const state = count > 0 ? `Còn ${count}` : "Hết hàng";
        return `${count > 0 ? "🟢" : "🔴"} ${name} · ${price} · ${state}${soldSuffix}`;
    }

    const name = truncateText(product.name, 26);
    const price = productPrice(product);
    return `${emoji?.char || "🟢"} ${name} · ${price}${soldSuffix}`;
}

function buildCategoryButton(category) {
    const count = category._count?.products ?? category.productCount ?? 0;
    const text = category.iconEmojiId
        ? `${truncateText(category.name, 24)} · ${count}`
        : `${category.icon || "📁"} ${truncateText(category.name, 24)} · ${count}`;

    return {
        text,
        callback_data: `category:${category.id}`,
        ...(category.iconEmojiId ? { icon_custom_emoji_id: category.iconEmojiId } : {}),
    };
}

const DEFAULT_ICONS = {
    LIST_PRODUCTS: "🛒", WALLET: "💳", MY_ORDERS: "📦", ACCOUNT: "👤",
    ALL_PRODUCTS: "🛍", HELP: "🆘", REFERRAL: "🎁", ADMIN_PANEL: "🛠",
};

function ic(action, icons) {
    return icons[action] ?? DEFAULT_ICONS[action] ?? "";
}

export function buildMainMenuKeyboard({ isAdmin = false, icons = {}, iconIds = {} } = {}) {
    const b = (action, label) => {
        const id = iconIds[action];
        const btn = { text: id ? label : `${ic(action, icons)} ${label}`, callback_data: action };
        if (id) btn.icon_custom_emoji_id = id;
        return btn;
    };
    const rows = [
        [b("LIST_PRODUCTS", "Mua hàng"), b("WALLET", "Ví")],
        [b("MY_ORDERS", "Đơn hàng"), b("ACCOUNT", "Tài khoản")],
        [b("ALL_PRODUCTS", "Sản phẩm"), b("HELP", "Hỗ trợ")],
        [b("REFERRAL", "Giới thiệu")],
    ];
    if (isAdmin) {
        rows.push([b("ADMIN_PANEL", "Admin Panel")]);
    }
    return Markup.inlineKeyboard(rows);
}

export function buildReplyKeyboard({ isAdmin = false, icons = {} } = {}) {
    const t = (action, label) => `${ic(action, icons)} ${label}`;
    const rows = [
        [t("LIST_PRODUCTS", "Mua hàng"), t("WALLET", "Ví")],
        [t("MY_ORDERS", "Đơn hàng"), t("ACCOUNT", "Tài khoản")],
        [t("HELP", "Hỗ trợ"), "Ẩn menu"],
    ];
    if (isAdmin) {
        rows.push([`${ic("ADMIN_PANEL", icons)} Admin`]);
    }
    return Markup.keyboard(rows).resize();
}

export function buildCategoriesKeyboard(categories, { page = 1, totalPages = 1 } = {}) {
    const rows = [];
    for (let index = 0; index < categories.length; index += 2) {
        rows.push(categories.slice(index, index + 2).map(buildCategoryButton));
    }

    if (totalPages > 1) {
        const nav = [];
        if (page > 1) nav.push(Markup.button.callback("‹ Trước", `category_page:${page - 1}`));
        if (page < totalPages) nav.push(Markup.button.callback("Sau ›", `category_page:${page + 1}`));
        if (nav.length) rows.push(nav);
    }

    rows.push([Markup.button.callback("🏠 Menu", "BACK_HOME")]);

    return Markup.inlineKeyboard(rows);
}

export function buildProductsKeyboard(products, { categoryId, page = 1, totalPages = 1, stockById = new Map(), soldById = new Map(), emojiById = new Map() } = {}) {
    const rows = products.map((product) => {
        const btn = {
            text: compactProductLabel(product, { stockById, soldById, emojiById }),
            callback_data: `product:${product.id}`,
        };
        const emoji = emojiById.get(product.id);
        if (emoji?.id) btn.icon_custom_emoji_id = emoji.id;
        return [btn];
    });

    if (totalPages > 1) {
        const nav = [];
        if (page > 1) nav.push(Markup.button.callback("‹ Trước", `products:${categoryId}:${page - 1}`));
        if (page < totalPages) nav.push(Markup.button.callback("Sau ›", `products:${categoryId}:${page + 1}`));
        if (nav.length) rows.push(nav);
    }

    rows.push([
        Markup.button.callback("📁 Danh mục", "LIST_PRODUCTS"),
        Markup.button.callback("🏠 Menu", "BACK_HOME"),
    ]);

    return Markup.inlineKeyboard(rows);
}

export function buildProductDetailKeyboard({ productId, inStock = true, categoryId = null, stockCount = null, deliveryMode = "TEXT" } = {}) {
    if (!inStock) {
        return Markup.inlineKeyboard([
            [Markup.button.callback("🔴 Hết hàng", "NO_PRODUCTS")],
            [
                Markup.button.callback("📁 Gói khác", categoryId ? `products:${categoryId}:1` : "LIST_PRODUCTS"),
                Markup.button.callback("🏠 Menu", "BACK_HOME"),
            ],
        ]);
    }

    let quickQtys;
    let hasMore = false;
    if (deliveryMode === "STOCK_LINES" && stockCount !== null && stockCount > 0) {
        const max = Math.min(stockCount, 5);
        quickQtys = Array.from({ length: max }, (_, i) => i + 1);
        hasMore = stockCount > 5;
    } else {
        quickQtys = [1, 2, 3, 5, 10];
        hasMore = true;
    }

    const rows = [];
    for (let i = 0; i < quickQtys.length; i += 5) {
        rows.push(
            quickQtys.slice(i, i + 5).map((n) =>
                Markup.button.callback(`🛒 ${n}`, `buy_now:${productId}:${n}`)
            )
        );
    }
    if (hasMore) {
        rows.push([Markup.button.callback("✏️ Số lượng khác...", `CUSTOM_QTY:${productId}`)]);
    }
    rows.push([
        Markup.button.callback("📁 Gói khác", categoryId ? `products:${categoryId}:1` : "LIST_PRODUCTS"),
        Markup.button.callback("🏠 Menu", "BACK_HOME"),
    ]);

    return Markup.inlineKeyboard(rows);
}

export function buildContactProductKeyboard(adminUsername, categoryId = null) {
    const rows = [];
    if (adminUsername) {
        rows.push([Markup.button.url("Nhắn admin", `https://t.me/${adminUsername.replace(/^@/, "")}`)]);
    }
    rows.push([
        Markup.button.callback("📁 Gói khác", categoryId ? `products:${categoryId}:1` : "LIST_PRODUCTS"),
        Markup.button.callback("🏠 Menu", "BACK_HOME"),
    ]);
    return Markup.inlineKeyboard(rows);
}

export function buildCheckoutKeyboard({ canPayWallet = false, canDeposit = true } = {}) {
    const rows = [];
    if (canPayWallet) {
        rows.push([
            Markup.button.callback("💳 Trừ ví", "PAY_WALLET"),
            Markup.button.callback("🏦 QR ngân hàng", "PAY_QR"),
        ]);
    } else {
        rows.push([Markup.button.callback("🏦 Thanh toán QR", "PAY_QR")]);
        if (canDeposit) {
            rows.push([Markup.button.callback("💳 Nạp ví", "WALLET")]);
        }
    }
    rows.push([
        Markup.button.callback("📁 Chọn lại", "LIST_PRODUCTS"),
        Markup.button.callback("🏠 Menu", "BACK_HOME"),
    ]);
    return Markup.inlineKeyboard(rows);
}

export function buildOrderListKeyboard(orders = []) {
    const rows = orders.slice(0, 10).map((order) => [
        Markup.button.callback(`Đơn ${order.id.slice(-8).toUpperCase()}`, `ORDER:${order.id}`),
    ]);
    rows.push([
        Markup.button.callback("🛒 Mua tiếp", "LIST_PRODUCTS"),
        Markup.button.callback("🏠 Menu", "BACK_HOME"),
    ]);
    return Markup.inlineKeyboard(rows);
}

export function buildOrderDetailKeyboard(order) {
    const rows = [];
    if (order?.status === "PENDING" && order?.paymentMethod === "vietqr") {
        rows.push([Markup.button.callback("✅ Tôi đã chuyển, kiểm tra lại", `ORDER_BANK_CHECK:${order.id}`)]);
    }
    if (order?.status === "PENDING" || order?.status === "PAID") {
        rows.push([Markup.button.callback("Hủy đơn", `CANCEL_ORDER:${order.id}`)]);
    }
    rows.push([
        Markup.button.callback("Làm mới", `ORDER:${order.id}`),
        Markup.button.callback("Mua lại", `product:${order.productId}`),
    ]);
    rows.push([
        Markup.button.callback("📦 Đơn hàng", "MY_ORDERS"),
        Markup.button.callback("🏠 Menu", "BACK_HOME"),
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
        [Markup.button.callback("Nhập số khác", "DEPOSIT:CUSTOM")],
        [Markup.button.callback("🏠 Menu", "BACK_HOME")],
    ]);
}

export function buildSupportKeyboard(adminUsername) {
    const rows = [];
    if (adminUsername) {
        rows.push([Markup.button.url("Liên hệ admin", `https://t.me/${adminUsername.replace(/^@/, "")}`)]);
    }
    rows.push(
        [Markup.button.callback("Cách mua hàng", "HELP:BUYING")],
        [Markup.button.callback("Thanh toán & giao hàng", "HELP:PAYMENT")],
        [Markup.button.callback("🏠 Menu", "BACK_HOME")],
    );
    return Markup.inlineKeyboard(rows);
}

export function buildAdminMenuKeyboard() {
    return Markup.inlineKeyboard([
        [
            Markup.button.callback("Đơn hàng", "ADMIN:ORDERS"),
            Markup.button.callback("Sản phẩm", "ADMIN:PRODUCTS"),
        ],
        [
            Markup.button.callback("Danh mục", "ADMIN:CATEGORIES"),
            Markup.button.callback("Người dùng", "ADMIN:USERS"),
        ],
        [
            Markup.button.callback("Thống kê", "ADMIN:STATS"),
            Markup.button.callback("Ví khách", "ADMIN:WALLET"),
        ],
        [
            Markup.button.callback("Coupon", "ADMIN:COUPONS"),
            Markup.button.callback("Broadcast", "ADMIN:BROADCAST"),
        ],
        [
            Markup.button.callback("Export", "ADMIN:EXPORT"),
            Markup.button.callback("Backup", "ADMIN:BACKUP"),
        ],
        [Markup.button.callback("⚙️ Giao diện menu", "ADMIN:MENU_CONFIG")],
        [Markup.button.callback("Về shop", "BACK_HOME")],
    ]);
}
