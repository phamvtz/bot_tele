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
};

export const DEFAULT_ICONS = {
    LIST_PRODUCTS: "🛒",
    WALLET: "💳",
    MY_ORDERS: "📦",
    ACCOUNT: "👤",
    ALL_PRODUCTS: "🛍",
    HELP: "🆘",
    REFERRAL: "🎁",
    ADMIN_PANEL: "🛠",
    BACK_HOME: "🏠",
    NAV_CATS: "📁",
};

export const DEFAULT_WELCOME_GREETING = "Chào {name}. Đây là bảng điều khiển mua hàng của bạn.";
export const DEFAULT_WELCOME_SUBTITLE = "Chọn một thao tác bên dưới để tiếp tục.";

let _cache = null;
let _cacheIds = null;
let _cacheWelcome = null;

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
