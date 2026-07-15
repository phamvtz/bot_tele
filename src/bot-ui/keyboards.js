import { Markup } from "telegraf";
import { formatCurrency, truncateText } from "./format.js";
import { DEFAULT_ICONS, getMenuIconsSync, getMenuIconIdsSync } from "../menu-config.js";

const UI_LABELS = {
    vi: {
        buy: "Mua hàng",
        wallet: "Ví",
        orders: "Đơn hàng",
        account: "Tài khoản",
        products: "Sản phẩm",
        help: "Hỗ trợ",
        referral: "Giới thiệu",
        language: "Ngôn ngữ",
        hideMenu: "Ẩn menu",
        menu: "Menu",
        back: "Quay lại",
        categories: "Danh mục",
        otherPackages: "Gói khác",
        chooseAgain: "Chọn lại",
        payWallet: "Trừ ví",
        payBankQr: "QR ngân hàng",
        payQr: "Thanh toán QR",
        depositWallet: "Nạp ví",
        continueShop: "Mua tiếp",
        showQr: "Hiện lại QR thanh toán",
        checkBank: "Tôi đã chuyển, kiểm tra lại",
        showUsdt: "Hiện lại thanh toán USDT",
        checkUsdt: "Tôi đã chuyển USDT, kiểm tra",
        cancelOrder: "Hủy đơn",
        refresh: "Làm mới",
        buyAgain: "Mua lại",
        customAmount: "Nhập số khác",
        txHistory: "Lịch sử giao dịch",
        contactAdmin: "Liên hệ admin",
        helpBuying: "Cách mua hàng",
        helpPayment: "Thanh toán & giao hàng",
        helpWallet: "Hướng dẫn nạp ví",
        helpReferral: "Chương trình giới thiệu",
        openWallet: "Mở ví",
        previous: "Trước",
        next: "Sau",
        outOfStock: "Hết hàng",
        customQuantity: "Số lượng khác...",
    },
    en: {
        buy: "Buy",
        wallet: "Wallet",
        orders: "Orders",
        account: "Account",
        products: "Products",
        help: "Help",
        referral: "Referral",
        language: "Language",
        hideMenu: "Hide menu",
        menu: "Menu",
        back: "Back",
        categories: "Categories",
        otherPackages: "Other products",
        chooseAgain: "Choose again",
        payWallet: "Pay wallet",
        payBankQr: "Bank QR",
        payQr: "Pay by QR",
        depositWallet: "Deposit wallet",
        continueShop: "Continue shopping",
        showQr: "Show payment QR",
        checkBank: "I have paid, check again",
        showUsdt: "Show USDT payment",
        checkUsdt: "I sent USDT, check",
        cancelOrder: "Cancel order",
        refresh: "Refresh",
        buyAgain: "Buy again",
        customAmount: "Custom amount",
        txHistory: "Transaction history",
        contactAdmin: "Contact admin",
        helpBuying: "How to buy",
        helpPayment: "Payment & delivery",
        helpWallet: "Wallet deposit guide",
        helpReferral: "Referral program",
        openWallet: "Open wallet",
        previous: "Previous",
        next: "Next",
        outOfStock: "Out of stock",
        customQuantity: "Other quantity...",
    },
    zh: {
        buy: "购买",
        wallet: "钱包",
        orders: "订单",
        account: "账户",
        products: "商品",
        help: "帮助",
        referral: "推荐",
        language: "语言",
        hideMenu: "隐藏菜单",
        menu: "菜单",
        back: "返回",
        categories: "分类",
        otherPackages: "其他商品",
        chooseAgain: "重新选择",
        payWallet: "钱包付款",
        payBankQr: "银行二维码",
        payQr: "二维码支付",
        depositWallet: "充值钱包",
        continueShop: "继续购买",
        showQr: "显示支付二维码",
        checkBank: "我已付款，重新检查",
        showUsdt: "显示 USDT 支付",
        checkUsdt: "我已转 USDT，检查",
        cancelOrder: "取消订单",
        refresh: "刷新",
        buyAgain: "再次购买",
        customAmount: "自定义金额",
        txHistory: "交易记录",
        contactAdmin: "联系管理员",
        helpBuying: "如何购买",
        helpPayment: "支付和发货",
        helpWallet: "钱包充值指南",
        helpReferral: "推荐计划",
        openWallet: "打开钱包",
        previous: "上一页",
        next: "下一页",
        outOfStock: "缺货",
        customQuantity: "其他数量...",
    },
};

function uiLabel(lang = "vi", key, fallback) {
    return UI_LABELS[lang]?.[key] || UI_LABELS.vi[key] || fallback;
}

function productPrice(product) {
    return product.price > 0 ? formatCurrency(product.price, product.currency) : "Liên hệ";
}

function compactProductLabel(product, { stockById = new Map(), soldById = new Map(), emojiById = new Map(), lang = "vi" } = {}) {
    if (product.deliveryMode === "STOCK_LINES") {
        const count = stockById.get(product.id) ?? 0;
        const name = truncateText(product.name, 28).toUpperCase();
        const stockTag = count > 0 ? `[${count}]` : `[${uiLabel(lang, "outOfStock")}]`;
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

export function iconUrlBtn(action, label, url) {
    const icons = getMenuIconsSync();
    const iconIds = getMenuIconIdsSync();
    const id = iconIds[action];
    const btn = {
        text: id ? label : `${icons[action] ?? DEFAULT_ICONS[action] ?? ""} ${label}`.trim(),
        url,
    };
    if (id) btn.icon_custom_emoji_id = id;
    return btn;
}

export function buildMainMenuKeyboard({ isAdmin = false, icons = {}, iconIds = {}, lang = "vi" } = {}) {
    const b = (action, label) => {
        const id = iconIds[action];
        const btn = { text: id ? label : `${ic(action, icons)} ${label}`.trim(), callback_data: action };
        if (id) btn.icon_custom_emoji_id = id;
        return btn;
    };
    if (lang) {
        const rows = [
            [b("LIST_PRODUCTS", uiLabel(lang, "buy")), b("WALLET", uiLabel(lang, "wallet"))],
            [b("MY_ORDERS", uiLabel(lang, "orders")), b("ACCOUNT", uiLabel(lang, "account"))],
            [b("ALL_PRODUCTS", uiLabel(lang, "products")), b("HELP", uiLabel(lang, "help"))],
            [b("REFERRAL", uiLabel(lang, "referral")), b("LANGUAGE", uiLabel(lang, "language"))],
        ];
        if (isAdmin) rows.push([b("ADMIN_PANEL", "Admin Panel")]);
        return Markup.inlineKeyboard(rows);
    }
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

export function buildReplyKeyboard({ isAdmin = false, icons = {}, lang = "vi" } = {}) {
    const t = (action, label) => `${ic(action, icons)} ${label}`.trim();
    if (lang) {
        const rows = [
            [t("LIST_PRODUCTS", uiLabel(lang, "buy")), t("MY_ORDERS", uiLabel(lang, "orders"))],
            [t("WALLET", uiLabel(lang, "wallet")), t("ACCOUNT", uiLabel(lang, "account"))],
            [t("ALL_PRODUCTS", uiLabel(lang, "products")), t("HELP", uiLabel(lang, "help"))],
            [t("REFERRAL", uiLabel(lang, "referral")), t("LANGUAGE", uiLabel(lang, "language"))],
            [`${ic("API_LINK", icons)} API`, `${ic("HIDE_MENU", icons)} ${uiLabel(lang, "hideMenu")}`],
        ];
        if (isAdmin) rows.push([`${ic("ADMIN_PANEL", icons)} Admin Panel`]);
        return Markup.keyboard(rows).resize();
    }
    const rows = [
        [t("LIST_PRODUCTS", "Mua hàng"), t("MY_ORDERS", "Đơn hàng")],
        [t("WALLET", "Ví"), t("ACCOUNT", "Tài khoản")],
        [t("ALL_PRODUCTS", "Sản phẩm"), t("HELP", "Hỗ trợ")],
        [t("REFERRAL", "Giới thiệu"), `${ic("API_LINK", icons)} API`, `${ic("HIDE_MENU", icons)} Ẩn menu`],
    ];
    if (isAdmin) {
        rows.push([`${ic("ADMIN_PANEL", icons)} Admin Panel`]);
    }
    return Markup.keyboard(rows).resize();
}

export function buildCategoriesKeyboard(categories, { page = 1, totalPages = 1, lang = "vi" } = {}) {
    const rows = [];
    for (let index = 0; index < categories.length; index += 2) {
        rows.push(categories.slice(index, index + 2).map(buildCategoryButton));
    }

    if (totalPages > 1) {
        const nav = [];
        if (page > 1) nav.push(navBtn("NAV_PREV", uiLabel(lang, "previous"), `category_page:${page - 1}`));
        if (page < totalPages) nav.push(navBtn("NAV_NEXT", uiLabel(lang, "next"), `category_page:${page + 1}`));
        if (nav.length) rows.push(nav);
    }

    rows.push([navBtn("BACK_HOME", uiLabel(lang, "menu"), "BACK_HOME")]);

    return Markup.inlineKeyboard(rows);
}

export function buildProductsKeyboard(products, { categoryId, page = 1, totalPages = 1, stockById = new Map(), soldById = new Map(), emojiById = new Map(), lang = "vi" } = {}) {
    const rows = products.map((product) => {
        const btn = {
            text: compactProductLabel(product, { stockById, soldById, emojiById, lang }),
            callback_data: `product:${product.id}`,
        };
        const emoji = emojiById.get(product.id);
        if (emoji?.id) btn.icon_custom_emoji_id = emoji.id;
        return [btn];
    });

    if (totalPages > 1) {
        const nav = [];
        if (page > 1) nav.push(navBtn("NAV_PREV", uiLabel(lang, "previous"), `products:${categoryId}:${page - 1}`));
        if (page < totalPages) nav.push(navBtn("NAV_NEXT", uiLabel(lang, "next"), `products:${categoryId}:${page + 1}`));
        if (nav.length) rows.push(nav);
    }

    rows.push([
        navBtn("NAV_CATS", uiLabel(lang, "categories"), "LIST_PRODUCTS"),
        navBtn("BACK_HOME", uiLabel(lang, "menu"), "BACK_HOME"),
    ]);

    return Markup.inlineKeyboard(rows);
}

export function buildProductDetailKeyboard({ productId, inStock = true, categoryId = null, stockCount = null, deliveryMode = "TEXT", promptMode = false, lang = "vi" } = {}) {
    if (!inStock) {
        return Markup.inlineKeyboard([
            [navBtn("OUT_OF_STOCK", uiLabel(lang, "outOfStock"), "NO_PRODUCTS")],
            [
                navBtn("NAV_CATS", uiLabel(lang, "otherPackages"), categoryId ? `products:${categoryId}:1` : "LIST_PRODUCTS"),
                navBtn("BACK_HOME", uiLabel(lang, "menu"), "BACK_HOME"),
            ],
        ]);
    }

    // promptMode: user will type quantity — no qty buttons needed
    if (promptMode) {
        return Markup.inlineKeyboard([
            [
                navBtn("NAV_CATS", uiLabel(lang, "otherPackages"), categoryId ? `products:${categoryId}:1` : "LIST_PRODUCTS"),
                navBtn("BACK_HOME", uiLabel(lang, "menu"), "BACK_HOME"),
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
            quickQtys.slice(i, i + 5).map((n) => navBtn("BUY_QUANTITY", String(n), `buy_now:${productId}:${n}`))
        );
    }
    if (hasMore) {
        rows.push([navBtn("CUSTOM_QUANTITY", uiLabel(lang, "customQuantity"), `CUSTOM_QTY:${productId}`)]);
    }
    rows.push([
        navBtn("NAV_CATS", uiLabel(lang, "otherPackages"), categoryId ? `products:${categoryId}:1` : "LIST_PRODUCTS"),
        navBtn("BACK_HOME", uiLabel(lang, "menu"), "BACK_HOME"),
    ]);

    return Markup.inlineKeyboard(rows);
}

export function buildContactProductKeyboard(adminUsername, categoryId = null, lang = "vi") {
    const rows = [];
    if (adminUsername) {
        rows.push([iconUrlBtn("CONTACT_ADMIN", uiLabel(lang, "contactAdmin"), `https://t.me/${adminUsername.replace(/^@/, "")}`)]);
    }
    rows.push([
        navBtn("NAV_CATS", uiLabel(lang, "otherPackages"), categoryId ? `products:${categoryId}:1` : "LIST_PRODUCTS"),
        navBtn("BACK_HOME", uiLabel(lang, "menu"), "BACK_HOME"),
    ]);
    return Markup.inlineKeyboard(rows);
}

export function buildCheckoutKeyboard({ canPayWallet = false, canDeposit = true, requireWalletTopup = false, lang = "vi" } = {}) {
    if (lang) {
        const rows = [];
        if (requireWalletTopup) {
            if (canPayWallet) rows.push([navBtn("PAY_WALLET", uiLabel(lang, "payWallet"), "PAY_WALLET")]);
            if (canDeposit) rows.push([navBtn("WALLET_DEPOSIT", uiLabel(lang, "depositWallet"), "WALLET")]);
        } else if (canPayWallet) {
            rows.push([
                navBtn("PAY_WALLET", uiLabel(lang, "payWallet"), "PAY_WALLET"),
                navBtn("PAY_QR", uiLabel(lang, "payBankQr"), "PAY_QR"),
            ]);
        } else {
            rows.push([navBtn("PAY_QR", uiLabel(lang, "payQr"), "PAY_QR")]);
            if (canDeposit) rows.push([navBtn("WALLET_DEPOSIT", uiLabel(lang, "depositWallet"), "WALLET")]);
        }
        if (!requireWalletTopup) {
            rows.push([
                navBtn("PAY_TRC20", "USDT TRC20", "PAY_CRYPTO:trc20"),
                navBtn("PAY_BEP20", "USDT BEP20", "PAY_CRYPTO:bep20"),
            ]);
        }
        rows.push([
            navBtn("NAV_CATS", uiLabel(lang, "chooseAgain"), "LIST_PRODUCTS"),
            navBtn("BACK_HOME", uiLabel(lang, "menu"), "BACK_HOME"),
        ]);
        return Markup.inlineKeyboard(rows);
    }
    const rows = [];
    if (requireWalletTopup) {
        if (canPayWallet) rows.push([navBtn("PAY_WALLET", "Trừ ví", "PAY_WALLET")]);
        if (canDeposit) rows.push([navBtn("WALLET_DEPOSIT", "Nạp ví", "WALLET")]);
    } else if (canPayWallet) {
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
    if (!requireWalletTopup) {
        rows.splice(rows.length - 1, 0, [
            navBtn("PAY_TRC20", "USDT TRC20", "PAY_CRYPTO:trc20"),
            navBtn("PAY_BEP20", "USDT BEP20", "PAY_CRYPTO:bep20"),
        ]);
    }
    return Markup.inlineKeyboard(rows);
}

export function buildOrderListKeyboard(orders = [], { lang = "vi" } = {}) {
    if (lang) {
        const orderWord = lang === "en" ? "Order" : lang === "zh" ? "订单" : "Đơn";
        const rows = orders.slice(0, 10).map((order) => [
            Markup.button.callback(`${orderWord} ${order.id.slice(-8).toUpperCase()}`, `ORDER:${order.id}`),
        ]);
        rows.push([
            navBtn("CONTINUE_SHOP", uiLabel(lang, "continueShop"), "LIST_PRODUCTS"),
            navBtn("BACK_HOME", uiLabel(lang, "menu"), "BACK_HOME"),
        ]);
        return Markup.inlineKeyboard(rows);
    }
    const rows = orders.slice(0, 10).map((order) => [
        Markup.button.callback(`Đơn ${order.id.slice(-8).toUpperCase()}`, `ORDER:${order.id}`),
    ]);
    rows.push([
        navBtn("CONTINUE_SHOP", "Mua tiếp", "LIST_PRODUCTS"),
        navBtn("BACK_HOME", "Menu", "BACK_HOME"),
    ]);
    return Markup.inlineKeyboard(rows);
}

export function buildOrderDetailKeyboard(order, { lang = "vi" } = {}) {
    if (lang) {
        const rows = [];
        if (order?.status === "PENDING" && order?.paymentMethod === "vietqr") {
            rows.push([navBtn("SHOW_QR", uiLabel(lang, "showQr"), `SHOW_ORDER_QR:${order.id}`)]);
            rows.push([navBtn("CHECK_PAID", uiLabel(lang, "checkBank"), `ORDER_BANK_CHECK:${order.id}`)]);
        }
        if (order?.status === "PENDING" && String(order?.paymentMethod || "").startsWith("crypto_")) {
            rows.push([navBtn("SHOW_USDT", uiLabel(lang, "showUsdt"), `SHOW_CRYPTO_PAY:${order.id}`)]);
            rows.push([navBtn("CHECK_USDT", uiLabel(lang, "checkUsdt"), `ORDER_CRYPTO_CHECK:${order.id}`)]);
        }
        if (order?.status === "PENDING" || order?.status === "PAID") {
            rows.push([navBtn("CANCEL_ORDER", uiLabel(lang, "cancelOrder"), `CANCEL_ORDER:${order.id}`)]);
        }
        rows.push([
            navBtn("ORDER_REFRESH", uiLabel(lang, "refresh"), `ORDER:${order.id}`),
            navBtn("BUY_AGAIN", uiLabel(lang, "buyAgain"), `product:${order.productId}`),
        ]);
        rows.push([
            navBtn("MY_ORDERS", uiLabel(lang, "orders"), "MY_ORDERS"),
            navBtn("BACK_HOME", uiLabel(lang, "menu"), "BACK_HOME"),
        ]);
        return Markup.inlineKeyboard(rows);
    }
    const rows = [];
    if (order?.status === "PENDING" && order?.paymentMethod === "vietqr") {
        rows.push([navBtn("SHOW_QR", "Hiện lại QR thanh toán", `SHOW_ORDER_QR:${order.id}`)]);
        rows.push([navBtn("CHECK_PAID", "Tôi đã chuyển, kiểm tra lại", `ORDER_BANK_CHECK:${order.id}`)]);
    }
    if (order?.status === "PENDING" && String(order?.paymentMethod || "").startsWith("crypto_")) {
        rows.push([navBtn("SHOW_USDT", "Hiện lại thanh toán USDT", `SHOW_CRYPTO_PAY:${order.id}`)]);
        rows.push([navBtn("CHECK_USDT", "Tôi đã chuyển USDT, kiểm tra", `ORDER_CRYPTO_CHECK:${order.id}`)]);
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

export function buildWalletKeyboard(presets = null, { lang = "vi" } = {}) {
    const bankLabel = lang === "en" ? "Bank QR top-up" : lang === "zh" ? "银行二维码充值" : "Nạp qua QR ngân hàng";
    const usdtLabel = lang === "en" ? "USDT top-up" : lang === "zh" ? "USDT 充值" : "Nạp USDT";
    if (lang) {
        return Markup.inlineKeyboard([
            [navBtn("DEPOSIT_BANK", bankLabel, "DEPOSIT_BANK")],
            [navBtn("DEPOSIT_BEP20", `${usdtLabel} BEP20`, "DEPOSIT_CRYPTO:bep20")],
            [navBtn("DEPOSIT_TRC20", `${usdtLabel} TRC20`, "DEPOSIT_CRYPTO:trc20")],
            [navBtn("TX_HISTORY", uiLabel(lang, "txHistory"), "TX_HISTORY")],
            [navBtn("BACK_HOME", uiLabel(lang, "menu"), "BACK_HOME")],
        ]);
    }

    return Markup.inlineKeyboard([
        [navBtn("DEPOSIT_BANK", "Nạp qua QR ngân hàng", "DEPOSIT_BANK")],
        [navBtn("DEPOSIT_BEP20", "Nạp USDT BEP20", "DEPOSIT_CRYPTO:bep20")],
        [navBtn("DEPOSIT_TRC20", "Nạp USDT TRC20", "DEPOSIT_CRYPTO:trc20")],
        [navBtn("TX_HISTORY", "Lịch sử giao dịch", "TX_HISTORY")],
        [navBtn("BACK_HOME", "Menu", "BACK_HOME")],
    ]);
}

export function buildBankDepositKeyboard(presets = null, { lang = "vi" } = {}) {
    const fmt = (n) => n.toLocaleString("vi-VN") + "đ";
    const list = Array.isArray(presets) && presets.length ? presets : [50000, 100000, 200000, 500000];
    const rows = [];
    for (let i = 0; i < list.length; i += 2) {
        rows.push(list.slice(i, i + 2).map((amt) => Markup.button.callback(fmt(amt), `DEPOSIT:${amt}`)));
    }
    rows.push([navBtn("DEPOSIT_CUSTOM", uiLabel(lang, "customAmount"), "DEPOSIT:CUSTOM")]);
    rows.push([navBtn("BACK_WALLET", uiLabel(lang, "wallet"), "WALLET")]);
    return Markup.inlineKeyboard(rows);
}
export function buildSupportKeyboard(adminUsername, { lang = "vi" } = {}) {
    if (lang) {
        const rows = [];
        if (adminUsername) {
            const icons = getMenuIconsSync();
            const iconIds = getMenuIconIdsSync();
            const id = iconIds["CONTACT_ADMIN"];
            const icon = id ? "" : (icons["CONTACT_ADMIN"] ?? DEFAULT_ICONS["CONTACT_ADMIN"] ?? "");
            const btn = {
                text: icon ? `${icon} ${uiLabel(lang, "contactAdmin")}` : uiLabel(lang, "contactAdmin"),
                url: `https://t.me/${adminUsername.replace(/^@/, "")}`,
            };
            if (id) btn.icon_custom_emoji_id = id;
            rows.push([btn]);
        }
        rows.push(
            [navBtn("HELP_BUYING", uiLabel(lang, "helpBuying"), "HELP:BUYING")],
            [navBtn("HELP_PAYMENT", uiLabel(lang, "helpPayment"), "HELP:PAYMENT")],
            [navBtn("HELP_WALLET", uiLabel(lang, "helpWallet"), "HELP:WALLET")],
            [navBtn("HELP_REFERRAL", uiLabel(lang, "helpReferral"), "HELP:REFERRAL")],
            [navBtn("BACK_HOME", uiLabel(lang, "menu"), "BACK_HOME")],
        );
        return Markup.inlineKeyboard(rows);
    }
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

export function buildAccountKeyboard({ lang = "vi" } = {}) {
    const icons = getMenuIconsSync();
    const iconIds = getMenuIconIdsSync();
    const b = (action, label) => {
        const id = iconIds[action];
        const btn = { text: id ? label : `${icons[action] ?? DEFAULT_ICONS[action] ?? ""} ${label}`, callback_data: action };
        if (id) btn.icon_custom_emoji_id = id;
        return btn;
    };
    if (lang) {
        return Markup.inlineKeyboard([
            [b("WALLET", uiLabel(lang, "openWallet"))],
            [b("MY_ORDERS", uiLabel(lang, "orders"))],
            [navBtn("BACK_HOME", uiLabel(lang, "menu"), "BACK_HOME")],
        ]);
    }
    return Markup.inlineKeyboard([
        [b("WALLET", "Mở ví")],
        [b("MY_ORDERS", "Đơn hàng")],
        [navBtn("BACK_HOME", "Menu", "BACK_HOME")],
    ]);
}

export function buildAdminMenuKeyboard() {
    return Markup.inlineKeyboard([
        [
            navBtn("ADMIN_ORDERS", "Đơn hàng", "ADMIN:ORDERS"),
            navBtn("ADMIN_PRODUCTS", "Sản phẩm", "ADMIN:PRODUCTS"),
        ],
        [
            navBtn("ADMIN_CATEGORIES", "Danh mục", "ADMIN:CATEGORIES"),
            navBtn("ADMIN_USERS", "Người dùng", "ADMIN:USERS"),
        ],
        [
            navBtn("ADMIN_STATS", "Thống kê", "ADMIN:STATS"),
            navBtn("ADMIN_WALLET", "Ví khách", "ADMIN:WALLET"),
        ],
        [
            navBtn("ADMIN_COUPONS", "Coupon", "ADMIN:COUPONS"),
            navBtn("ADMIN_BROADCAST", "Broadcast", "ADMIN:BROADCAST"),
        ],
        [
            navBtn("ADMIN_EXPORT", "Export", "ADMIN:EXPORT"),
            navBtn("ADMIN_BACKUP", "Backup", "ADMIN:BACKUP"),
        ],
        [navBtn("ADMIN_MENU_CONFIG", "Giao diện menu", "ADMIN:MENU_CONFIG"), navBtn("ADMIN_WELCOME_CONFIG", "Lời chào", "ADMIN:WELCOME_CONFIG")],
        [navBtn("ADMIN_PRODUCT_DISPLAY", "Hiển thị sản phẩm", "ADMIN:PRODUCT_DISPLAY"), navBtn("ADMIN_SELLER_API", "API Seller", "ADMIN:SELLER_API")],
        [navBtn("BACK_HOME", "Về shop", "BACK_HOME")],
    ]);
}
