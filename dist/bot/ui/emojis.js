// ─── Emoji Constants ──────────────────────────────────────────────────────────
// Tập trung để dễ thay đổi theme và nhất quán UI
/**
 * Hàm hỗ trợ bọc Premium Custom Emoji.
 * Bắt buộc parse_mode: 'HTML' thì icon mới hiển thị!
 */
export function p(fallback, id) {
    return id ? `<tg-emoji emoji-id="${id}">${fallback}</tg-emoji>` : fallback;
}
export const E = {
    // Navigation
    BACK: p('⬅️'),
    HOME: p('🏠'),
    NEXT: p('➡️'),
    PREV: p('◀️'),
    PAGE_NEXT: p('▶️'),
    CLOSE: p('✖️'),
    // Ví dụ cấu hình Premium:
    // BUY:        p('🛒', '5368324170671202286'), 
    // Nhập ID lấy được từ bot vào tham số thứ 2!
    // Actions
    BUY: p('🛒'),
    PAY: p('💳'),
    CONFIRM: p('✅'),
    CANCEL: p('❌'),
    REFRESH: p('🔄'),
    COPY: p('📋'),
    SHARE: p('📤'),
    SEARCH: p('🔍'),
    // Status
    SUCCESS: p('✅'),
    ERROR: p('❌'),
    WARNING: p('⚠️'),
    INFO: p('ℹ️'),
    LOADING: p('⏳'),
    PENDING: p('🕐'),
    PROCESSING: p('⚙️'),
    DELIVERED: p('🚚'),
    COMPLETED: p('✅'),
    REFUNDED: p('🔙'),
    // Finance
    WALLET: p('💰'),
    DEPOSIT: p('💳'),
    MONEY: p('💵'),
    FROZEN: p('❄️'),
    LOCK: p('🔒'),
    BANK: p('🏦'),
    QR: p('📱'),
    // Product
    PACKAGE: p('📦'),
    STOCK: p('🗄️'),
    HOT: p('🔥'),
    NEW: p('🆕'),
    SALE: p('🏷️'),
    KEY: p('🔑'),
    STAR: p('⭐'),
    DIAMOND: p('💎'),
    // User
    USER: p('👤'),
    ADMIN: p('⚙️'),
    VIP: p('💎'),
    REFERRAL: p('🎁'),
    SUPPORT: p('🎧'),
    // Misc
    ORDERS: p('📦'),
    HISTORY: p('📜'),
    SHOP: p('🛍️'),
    DIVIDER: p('━'),
    DOT: p('•'),
    ARROW: p('›'),
    BOT: p('🤖'),
    BELL: p('🔔'),
    CHART: p('📊'),
    EDIT: p('✏️'),
    TRASH: p('🗑️'),
    BROADCAST: p('📢'),
};
