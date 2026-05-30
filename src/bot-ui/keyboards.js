import { Markup } from "telegraf";
import { formatCurrency, truncateText } from "./format.js";
import { DEFAULT_ICONS, getMenuIconsSync, getMenuIconIdsSync } from "../menu-config.js";

function productPrice(product) {
    return product.price > 0 ? formatCurrency(product.price, product.currency) : "Liên hệ";
}

function compactProductLabel(product, { stockById = new Map(), soldById = new Map(), emojiById = new Map() } = {}) {
    if (product.deliveryMode === "STOCK_LINES") {
        const count = stockById.get(product.id) ?? 0;
        const name = truncateText(product.name, 28).toUpperCase();
        const stockTag = count > 0 ? `[${count}]` : "[Hết]";
        return `${stockTag} ${name}`;
    }

    return truncateText(product.name, 32).toUpperCase();
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

function ic(action, icons) {
    return icons[action] ?? DEFAULT_ICONS[action] ?? "";
}

// Builds a nav button using current cached icon config (supports custom animated emoji)
export function navBtn(action, label, callbackData) {
    const icons = getMenuIconsSync();
    const iconIds = getMenuIconIdsSync();
    const id = iconIds[action];
    const btn = {
        text: id ? label : `${icons[action] ?? DEFAULT_ICONS[action] ?? ""} ${label}`,
        callback_data: callbackData ?? action,
    };
    if (id) btn.icon_custom_emoji_id = id;
    return btn;
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
        [t("LIST_PRODUCTS", "Mua hàng"), t("MY_ORDERS", "Đơn hàng")],
        [t("WALLET", "Ví"), t("ACCOUNT", "Tài khoản")],
        [t("ALL_PRODUCTS", "Sản phẩm"), t("HELP", "Hỗ trợ")],
        [t("REFERRAL", "Giới thiệu"), "🙈 Ẩn menu"],
    ];
    if (isAdmin) {
        rows.push([`${ic("ADMIN_PANEL", icons)} Admin Panel`]);
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

    rows.push([navBtn("BACK_HOME", "Menu", "BACK_HOME")]);

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
        navBtn("NAV_CATS", "Danh mục", "LIST_PRODUCTS"),
        navBtn("BACK_HOME", "Menu", "BACK_HOME"),
    ]);

    return Markup.inlineKeyboard(rows);
}

export function buildProductDetailKeyboard({ productId, inStock = true, categoryId = null, stockCount = null, deliveryMode = "TEXT", promptMode = false } = {}) {
    if (!inStock) {
        return Markup.inlineKeyboard([
            [Markup.button.callback("🔴 Hết hàng", "NO_PRODUCTS")],
            [
                navBtn("NAV_CATS", "Gói khác", categoryId ? `products:${categoryId}:1` : "LIST_PRODUCTS"),
                navBtn("BACK_HOME", "Menu", "BACK_HOME"),
            ],
        ]);
    }

    // promptMode: user will type quantity — no qty buttons needed
    if (promptMode) {
        return Markup.inlineKeyboard([
            [
                navBtn("NAV_CATS", "Gói khác", categoryId ? `products:${categoryId}:1` : "LIST_PRODUCTS"),
                navBtn("BACK_HOME", "Menu", "BACK_HOME"),
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
        navBtn("NAV_CATS", "Gói khác", categoryId ? `products:${categoryId}:1` : "LIST_PRODUCTS"),
        navBtn("BACK_HOME", "Menu", "BACK_HOME"),
    ]);

    return Markup.inlineKeyboard(rows);
}

export function buildContactProductKeyboard(adminUsername, categoryId = null) {
    const rows = [];
    if (adminUsername) {
        rows.push([Markup.button.url("Nhắn admin", `https://t.me/${adminUsername.replace(/^@/, "")}`)]);
    }
    rows.push([
        navBtn("NAV_CATS", "Gói khác", categoryId ? `products:${categoryId}:1` : "LIST_PRODUCTS"),
        navBtn("BACK_HOME", "Menu", "BACK_HOME"),
    ]);
    return Markup.inlineKeyboard(rows);
}

export function buildCheckoutKeyboard({ canPayWallet = false, canDeposit = true } = {}) {
    const rows = [];
    if (canPayWallet) {
        rows.push([
            navBtn("PAY_WALLET", "Trừ ví", "PAY_WALLET"),
            navBtn("PAY_QR", "QR ngân hàng", "PAY_QR"),
        ]);
    } else {
        rows.push([navBtn("PAY_QR", "Thanh toán QR", "PAY_QR")]);
        if (canDeposit) {
            rows.push([navBtn("WALLET_DEPOSIT", "Nạp ví", "WALLET")]);
        }
    }
    rows.push([
        navBtn("NAV_CATS", "Chọn lại", "LIST_PRODUCTS"),
        navBtn("BACK_HOME", "Menu", "BACK_HOME"),
    ]);
    return Markup.inlineKeyboard(rows);
}

export function buildOrderListKeyboard(orders = []) {
    const rows = orders.slice(0, 10).map((order) => [
        Markup.button.callback(`Đơn ${order.id.slice(-8).toUpperCase()}`, `ORDER:${order.id}`),
    ]);
    rows.push([
        navBtn("CONTINUE_SHOP", "Mua tiếp", "LIST_PRODUCTS"),
        navBtn("BACK_HOME", "Menu", "BACK_HOME"),
    ]);
    return Markup.inlineKeyboard(rows);
}

export function buildOrderDetailKeyboard(order) {
    const rows = [];
    if (order?.status === "PENDING" && order?.paymentMethod === "vietqr") {
        rows.push([navBtn("SHOW_QR", "Hiện lại QR thanh toán", `SHOW_ORDER_QR:${order.id}`)]);
        rows.push([navBtn("CHECK_PAID", "Tôi đã chuyển, kiểm tra lại", `ORDER_BANK_CHECK:${order.id}`)]);
    }
    if (order?.status === "PENDING" || order?.status === "PAID") {
        rows.push([navBtn("CANCEL_ORDER", "Hủy đơn", `CANCEL_ORDER:${order.id}`)]);
    }
    rows.push([
        navBtn("ORDER_REFRESH", "Làm mới", `ORDER:${order.id}`),
        navBtn("BUY_AGAIN", "Mua lại", `product:${order.productId}`),
    ]);
    rows.push([
        navBtn("MY_ORDERS", "Đơn hàng", "MY_ORDERS"),
        navBtn("BACK_HOME", "Menu", "BACK_HOME"),
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
        [navBtn("DEPOSIT_CUSTOM", "Nhập số khác", "DEPOSIT:CUSTOM")],
        [Markup.button.callback("📋 Lịch sử giao dịch", "TX_HISTORY")],
        [navBtn("BACK_HOME", "Menu", "BACK_HOME")],
    ]);
}

export function buildSupportKeyboard(adminUsername) {
    const rows = [];
    if (adminUsername) {
        const icons = getMenuIconsSync();
        const iconIds = getMenuIconIdsSync();
        const id = iconIds["CONTACT_ADMIN"];
        const icon = id ? "" : (icons["CONTACT_ADMIN"] ?? DEFAULT_ICONS["CONTACT_ADMIN"] ?? "");
        const btn = {
            text: icon ? `${icon} Liên hệ admin` : "Liên hệ admin",
            url: `https://t.me/${adminUsername.replace(/^@/, "")}`,
        };
        if (id) btn.icon_custom_emoji_id = id;
        rows.push([btn]);
    }
    rows.push(
        [navBtn("HELP_BUYING", "Cách mua hàng", "HELP:BUYING")],
        [navBtn("HELP_PAYMENT", "Thanh toán & giao hàng", "HELP:PAYMENT")],
        [navBtn("HELP_WALLET", "Hướng dẫn nạp ví", "HELP:WALLET")],
        [navBtn("HELP_REFERRAL", "Chương trình giới thiệu", "HELP:REFERRAL")],
        [navBtn("BACK_HOME", "Menu", "BACK_HOME")],
    );
    return Markup.inlineKeyboard(rows);
}

export function buildAccountKeyboard() {
    const icons = getMenuIconsSync();
    const iconIds = getMenuIconIdsSync();
    const b = (action, label) => {
        const id = iconIds[action];
        const btn = { text: id ? label : `${icons[action] ?? DEFAULT_ICONS[action] ?? ""} ${label}`, callback_data: action };
        if (id) btn.icon_custom_emoji_id = id;
        return btn;
    };
    return Markup.inlineKeyboard([
        [b("WALLET", "Mở ví")],
        [b("MY_ORDERS", "Đơn hàng")],
        [navBtn("BACK_HOME", "Menu", "BACK_HOME")],
    ]);
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
        [Markup.button.callback("⚙️ Giao diện menu", "ADMIN:MENU_CONFIG"), Markup.button.callback("✏️ Lời chào", "ADMIN:WELCOME_CONFIG")],
        [Markup.button.callback("📋 Hiển thị sản phẩm", "ADMIN:PRODUCT_DISPLAY"), Markup.button.callback("🔑 API Seller", "ADMIN:SELLER_API")],
        [navBtn("BACK_HOME", "Về shop", "BACK_HOME")],
    ]);
}
