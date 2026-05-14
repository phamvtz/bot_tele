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
};

let _cache = null;

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

export function invalidateMenuCache() {
    _cache = null;
}

export async function setMenuIcon(action, icon) {
    const current = await getMenuIcons();
    current[action] = icon;
    _cache = current;
    const value = JSON.stringify(current);
    await prisma.setting.upsert({
        where: { key: "menu_buttons" },
        update: { value },
        create: { key: "menu_buttons", value },
    });
}

export function btnText(action, icons) {
    return `${icons[action] ?? DEFAULT_ICONS[action] ?? ""} ${BUTTON_LABELS[action] ?? action}`;
}
