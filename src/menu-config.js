import prisma from "./lib/prisma.js";

export const BUTTON_LABELS = {
    LIST_PRODUCTS: "Mua hàng",
    WALLET: "Ví",
    MY_ORDERS: "Đơn hàng",
    ACCOUNT: "Tài khoản",
    ALL_PRODUCTS: "Sản phẩm",
    HELP: "Hỗ trợ",
    REFERRAL: "Giới thiệu",
    ADMIN_PANEL: "Admin Panel",
    BACK_HOME: "Menu",
    NAV_CATS: "Danh mục",
    NAV_BACK: "Quay lại",
    PAY_QR: "Thanh toán QR",
    PAY_WALLET: "Trừ ví",
    WALLET_DEPOSIT: "Nạp ví",
    SHOW_QR: "Hiện lại QR",
    CHECK_PAID: "Đã chuyển tiền",
    CANCEL_ORDER: "Hủy đơn",
    ORDER_REFRESH: "Làm mới",
    BUY_AGAIN: "Mua lại",
    CONTINUE_SHOP: "Mua tiếp",
    DEPOSIT_CUSTOM: "Nhập số khác",
    HELP_BUYING: "Cách mua hàng",
    HELP_PAYMENT: "Thanh toán & giao hàng",
    CONTACT_ADMIN: "Liên hệ admin",
    FIELD_PRICE: "Icon · Giá bán",
    FIELD_STOCK: "Icon · Tồn kho",
    FIELD_SOLD: "Icon · Đã bán",
    FIELD_DESC: "Icon · Mô tả",
    FIELD_NOTE: "Icon · Lưu ý",
    ORDER_ID: "Icon · Mã đơn",
    ORDER_PRODUCT: "Icon · Sản phẩm (đơn)",
    ORDER_QTY: "Icon · Số lượng (đơn)",
    ORDER_TOTAL: "Icon · Tổng tiền (đơn)",
    ORDER_PAYMENT: "Icon · Thanh toán (đơn)",
    ORDER_TIME: "Icon · Thời gian (đơn)",
    ORDER_DELIVERY: "Icon · Giao hàng",
    ORDER_WALLET: "Icon · Số dư ví",
    ORDER_DISCOUNT: "Icon · Giảm giá",
};

export const DEFAULT_ICONS = {
    LIST_PRODUCTS: "🛒",
    WALLET: "💳",
    MY_ORDERS: "📋",
    ACCOUNT: "👤",
    ALL_PRODUCTS: "🏪",
    HELP: "🆘",
    REFERRAL: "🎁",
    ADMIN_PANEL: "🛠",
    BACK_HOME: "🏠",
    NAV_CATS: "📁",
    NAV_BACK: "🔙",
    PAY_QR: "🏦",
    PAY_WALLET: "💳",
    WALLET_DEPOSIT: "💰",
    SHOW_QR: "🏦",
    CHECK_PAID: "✅",
    CANCEL_ORDER: "❌",
    ORDER_REFRESH: "🔄",
    BUY_AGAIN: "🛒",
    CONTINUE_SHOP: "🛍",
    DEPOSIT_CUSTOM: "✏️",
    HELP_BUYING: "📖",
    HELP_PAYMENT: "💳",
    CONTACT_ADMIN: "💬",
    FIELD_PRICE: "💰",
    FIELD_STOCK: "📦",
    FIELD_SOLD: "📊",
    FIELD_DESC: "💬",
    FIELD_NOTE: "⚠️",
    ORDER_ID: "🆔",
    ORDER_PRODUCT: "📦",
    ORDER_QTY: "🔢",
    ORDER_TOTAL: "💰",
    ORDER_PAYMENT: "💳",
    ORDER_TIME: "🕐",
    ORDER_DELIVERY: "📬",
    ORDER_WALLET: "👛",
    ORDER_DISCOUNT: "💸",
};

export const DEFAULT_WELCOME_GREETING = "Chào {name}. Đây là bảng điều khiển mua hàng của bạn.";
export const DEFAULT_WELCOME_SUBTITLE = "Chọn một thao tác bên dưới để tiếp tục.";
export const DEFAULT_SHOP_NAME = "Shop Bot Tele";

let _cache = null;
let _cacheIds = null;
let _cacheWelcome = null;
let _cacheShopName = null;

export async function getShopNameFromDB() {
    if (_cacheShopName !== null) return _cacheShopName;
    try {
        const row = await prisma.setting.findUnique({ where: { key: "SHOP_NAME" } });
        _cacheShopName = row?.value || process.env.SHOP_NAME || process.env.BOT_SHOP_NAME || DEFAULT_SHOP_NAME;
    } catch {
        _cacheShopName = process.env.SHOP_NAME || process.env.BOT_SHOP_NAME || DEFAULT_SHOP_NAME;
    }
    return _cacheShopName;
}

export function getShopNameSync() {
    return _cacheShopName || process.env.SHOP_NAME || process.env.BOT_SHOP_NAME || DEFAULT_SHOP_NAME;
}

export async function getMenuIcons() {
    if (_cache) return _cache;
    try {
        const setting = await prisma.setting.findUnique({ where: { key: "menu_buttons" } });
        _cache = setting ? { ...DEFAULT_ICONS, ...JSON.parse(setting.value) } : { ...DEFAULT_ICONS };
    } catch {
        _cache = { ...DEFAULT_ICONS };
    }
    return _cache;
}

export async function getMenuIconIds() {
    if (_cacheIds) return _cacheIds;
    try {
        const setting = await prisma.setting.findUnique({ where: { key: "menu_button_ids" } });
        _cacheIds = setting ? JSON.parse(setting.value) : {};
    } catch {
        _cacheIds = {};
    }
    return _cacheIds;
}

export async function getWelcomeGreeting() {
    if (_cacheWelcome !== null) return _cacheWelcome;
    try {
        const row = await prisma.setting.findUnique({ where: { key: "WELCOME_GREETING" } });
        _cacheWelcome = row?.value ?? null;
    } catch {
        _cacheWelcome = null;
    }
    return _cacheWelcome;
}

export function getWelcomeGreetingSync() {
    return _cacheWelcome;
}

export async function setWelcomeGreeting(text) {
    _cacheWelcome = text;
    await prisma.setting.upsert({
        where: { key: "WELCOME_GREETING" },
        update: { value: text },
        create: { key: "WELCOME_GREETING", value: text },
    });
}

export function invalidateMenuCache() {
    _cache = null;
    _cacheIds = null;
    _cacheWelcome = null;
    _cacheShopName = null;
    _displayCache = null;
}

// === Product display field toggles ===
export const DEFAULT_PRODUCT_DISPLAY = {
    price: true,
    stock: true,
    sold: true,
    description: true,
};

let _displayCache = null;

export async function getProductDisplaySettings() {
    if (_displayCache) return _displayCache;
    try {
        const row = await prisma.setting.findUnique({ where: { key: "product_display" } });
        _displayCache = row ? { ...DEFAULT_PRODUCT_DISPLAY, ...JSON.parse(row.value) } : { ...DEFAULT_PRODUCT_DISPLAY };
    } catch {
        _displayCache = { ...DEFAULT_PRODUCT_DISPLAY };
    }
    return _displayCache;
}

export function getProductDisplaySettingsSync() {
    return _displayCache || { ...DEFAULT_PRODUCT_DISPLAY };
}

export async function setProductDisplaySettings(settings) {
    _displayCache = { ...DEFAULT_PRODUCT_DISPLAY, ...settings };
    await prisma.setting.upsert({
        where: { key: "product_display" },
        update: { value: JSON.stringify(_displayCache) },
        create: { key: "product_display", value: JSON.stringify(_displayCache) },
    });
    return _displayCache;
}

export async function setMenuIcon(action, icon, customEmojiId = null) {
    const current = await getMenuIcons();
    current[action] = icon;
    _cache = current;
    await prisma.setting.upsert({
        where: { key: "menu_buttons" },
        update: { value: JSON.stringify(current) },
        create: { key: "menu_buttons", value: JSON.stringify(current) },
    });

    const currentIds = await getMenuIconIds();
    if (customEmojiId) {
        currentIds[action] = customEmojiId;
    } else {
        delete currentIds[action];
    }
    _cacheIds = currentIds;
    await prisma.setting.upsert({
        where: { key: "menu_button_ids" },
        update: { value: JSON.stringify(currentIds) },
        create: { key: "menu_button_ids", value: JSON.stringify(currentIds) },
    });
}

export function getMenuIconsSync() {
    return _cache || { ...DEFAULT_ICONS };
}

export function getMenuIconIdsSync() {
    return _cacheIds || {};
}

export function btnText(action, icons) {
    return `${icons[action] ?? DEFAULT_ICONS[action] ?? ""} ${BUTTON_LABELS[action] ?? action}`;
}
