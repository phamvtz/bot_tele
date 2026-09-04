import prisma from "./lib/prisma.js";

/**
 * NGUỒN DUY NHẤT khai báo icon của bot.
 * Mỗi item: { key, label, icon }. Nhóm dùng để render UI admin (web + trong bot).
 * BUTTON_LABELS và DEFAULT_ICONS được derive từ đây — đừng sửa 2 map đó trực tiếp.
 * Thêm icon mới: chỉ cần thêm item vào đúng nhóm ở dưới.
 */
export const ICON_GROUPS = [
    {
        id: "main",
        label: "Menu chính",
        items: [
            { key: "LIST_PRODUCTS", label: "Mua hàng", icon: "🛒" },
            { key: "WALLET", label: "Ví", icon: "💳" },
            { key: "MY_ORDERS", label: "Đơn hàng", icon: "📋" },
            { key: "ACCOUNT", label: "Tài khoản", icon: "👤" },
            { key: "ALL_PRODUCTS", label: "Sản phẩm", icon: "🏪" },
            { key: "HELP", label: "Hỗ trợ", icon: "🆘" },
            { key: "REFERRAL", label: "Giới thiệu", icon: "🎁" },
            { key: "LANGUAGE", label: "Ngôn ngữ", icon: "🌐" },
            { key: "ADMIN_PANEL", label: "Admin Panel", icon: "🛠" },
            { key: "API_LINK", label: "API", icon: "🔗" },
            { key: "APIKEY_BUY", label: "Tạo API key", icon: "🔑" },
            { key: "HIDE_MENU", label: "Ẩn menu", icon: "🙈" },
        ],
    },
    {
        id: "nav",
        label: "Điều hướng",
        items: [
            { key: "BACK_HOME", label: "Menu", icon: "🏠" },
            { key: "NAV_CATS", label: "Danh mục", icon: "📁" },
            { key: "NAV_BACK", label: "Quay lại", icon: "🔙" },
            { key: "NAV_PREV", label: "Trang trước", icon: "◀️" },
            { key: "NAV_NEXT", label: "Trang sau", icon: "▶️" },
            { key: "PROMPT_CHOOSE", label: "Icon · Nhắc chọn bên dưới", icon: "👇" },
            { key: "TITLE_CATEGORIES", label: "Icon · Tiêu đề danh mục", icon: "🗂" },
            { key: "TITLE_PRODUCTS", label: "Icon · Tiêu đề sản phẩm", icon: "🛍" },
            { key: "CATEGORY_FALLBACK", label: "Icon · Danh mục mặc định", icon: "📁" },
        ],
    },
    {
        id: "buy",
        label: "Mua hàng",
        items: [
            { key: "OUT_OF_STOCK", label: "Hết hàng", icon: "🔴" },
            { key: "BUY_QUANTITY", label: "Chọn số lượng", icon: "🛒" },
            { key: "CUSTOM_QUANTITY", label: "Số lượng khác", icon: "✏️" },
            { key: "SKIP_COUPON", label: "Bỏ qua mã giảm giá", icon: "⏭️" },
            { key: "BUY_AGAIN", label: "Mua lại", icon: "🛒" },
            { key: "CONTINUE_SHOP", label: "Mua tiếp", icon: "🛍" },
            { key: "JOIN_GROUP", label: "Tham gia nhóm", icon: "📢" },
            { key: "VERIFY_JOIN", label: "Kiểm tra tham gia nhóm", icon: "✅" },
        ],
    },
    {
        id: "payment",
        label: "Thanh toán & Ví",
        items: [
            { key: "PAY_QR", label: "Thanh toán QR", icon: "🏦" },
            { key: "PAY_WALLET", label: "Trừ ví", icon: "💳" },
            { key: "SHOW_QR", label: "Hiện lại QR", icon: "🏦" },
            { key: "OPEN_QR", label: "Mở QR", icon: "📷" },
            { key: "CHECK_PAID", label: "Đã chuyển tiền", icon: "✅" },
            { key: "CANCEL_ORDER", label: "Hủy đơn", icon: "❌" },
            { key: "ORDER_REFRESH", label: "Làm mới", icon: "🔄" },
            { key: "PAY_TRC20", label: "Thanh toán USDT TRC20", icon: "🔴" },
            { key: "PAY_BEP20", label: "Thanh toán USDT BEP20", icon: "🟡" },
            { key: "PAY_BINANCE_PAY", label: "Thanh toán Binance Pay", icon: "🟨" },
            { key: "SHOW_USDT", label: "Hiện thanh toán USDT", icon: "📷" },
            { key: "CHECK_USDT", label: "Kiểm tra USDT", icon: "✅" },
            { key: "WALLET_DEPOSIT", label: "Nạp ví", icon: "💰" },
            { key: "DEPOSIT_CUSTOM", label: "Nhập số khác", icon: "✏️" },
            { key: "DEPOSIT_BANK", label: "Nạp qua ngân hàng", icon: "🏦" },
            { key: "DEPOSIT_BEP20", label: "Nạp USDT BEP20", icon: "🟡" },
            { key: "DEPOSIT_TRC20", label: "Nạp USDT TRC20", icon: "🔴" },
            { key: "DEPOSIT_BINANCE_PAY", label: "Nạp Binance Pay", icon: "🟨" },
            { key: "TX_HISTORY", label: "Lịch sử giao dịch", icon: "📋" },
            { key: "REDEEM_GIFTCODE", label: "Nhập giftcode", icon: "🎁" },
            { key: "BACK_WALLET", label: "Quay lại ví", icon: "👛" },
            { key: "VIEW_WALLET", label: "Xem ví", icon: "👛" },
            { key: "EXCHANGE_RATE", label: "Icon · Tỷ giá", icon: "💱" },
        ],
    },
    {
        id: "status",
        label: "Trạng thái & thông báo",
        items: [
            { key: "STATUS_SUCCESS", label: "Icon · Thành công", icon: "✅" },
            { key: "STATUS_ERROR", label: "Icon · Lỗi / Thất bại", icon: "❌" },
            { key: "STATUS_WARNING", label: "Icon · Cảnh báo", icon: "⚠️" },
            { key: "STATUS_PENDING", label: "Icon · Đang chờ", icon: "⏳" },
            { key: "STATUS_CHECKING", label: "Icon · Đang kiểm tra", icon: "🔍" },
            { key: "AUTO_DELIVERY", label: "Icon · Đang xử lý tự động", icon: "⚙️" },
            { key: "MUTE_NOTIFY", label: "Thông báo · Ẩn 1 ngày", icon: "🔕" },
            { key: "BROADCAST_BUY", label: "Thông báo · Mua sản phẩm", icon: "🛒" },
            { key: "BROADCAST_VIP", label: "Thông báo · VIP", icon: "👑" },
            // RESTOCK cũ đã tách sang nhóm "stock_import" (RESTOCK_TITLE/PRODUCT/ADDED/TOTAL)
            // — bỏ khỏi đây để panel không hiện dòng không còn tác dụng.
            { key: "SOCIAL_PROOF", label: "Thông báo · Có người vừa mua", icon: "🎉" },
            { key: "SOCIAL_PROOF_GIFT", label: "Thông báo · Có người nhận quà", icon: "🎁" },
        ],
    },
    {
        id: "product",
        label: "Chi tiết sản phẩm",
        items: [
            { key: "FIELD_PRICE", label: "Icon · Giá bán", icon: "💰" },
            { key: "FIELD_STOCK", label: "Icon · Tồn kho", icon: "📦" },
            { key: "FIELD_SOLD", label: "Icon · Đã bán", icon: "📊" },
            { key: "FIELD_DESC", label: "Icon · Mô tả", icon: "💬" },
            { key: "FIELD_NOTE", label: "Icon · Lưu ý", icon: "⚠️" },
        ],
    },
    {
        id: "order",
        label: "Chi tiết đơn hàng",
        items: [
            { key: "ORDER_ID", label: "Icon · Mã đơn", icon: "🆔" },
            { key: "ORDER_PRODUCT", label: "Icon · Sản phẩm (đơn)", icon: "📦" },
            { key: "ORDER_QTY", label: "Icon · Số lượng (đơn)", icon: "🔢" },
            { key: "ORDER_TOTAL", label: "Icon · Tổng tiền (đơn)", icon: "💰" },
            { key: "ORDER_PAYMENT", label: "Icon · Thanh toán (đơn)", icon: "💳" },
            { key: "ORDER_TIME", label: "Icon · Thời gian (đơn)", icon: "🕐" },
            { key: "ORDER_DELIVERY", label: "Icon · Giao hàng", icon: "📬" },
            { key: "ORDER_WALLET", label: "Icon · Số dư ví", icon: "👛" },
            { key: "ORDER_DISCOUNT", label: "Icon · Giảm giá", icon: "💸" },
            { key: "VIEW_ORDER", label: "Xem đơn hàng", icon: "📦" },
        ],
    },
    {
        id: "delivery",
        label: "Giao hàng",
        items: [
            { key: "DELIVERY_FILE", label: "Icon · File giao hàng", icon: "📦" },
            { key: "DELIVERY_DESC", label: "Icon · Mô tả giao hàng", icon: "📋" },
            { key: "DELIVERY_FAIL", label: "Icon · Giao hàng lỗi", icon: "🔴" },
            { key: "OUT_OF_STOCK_SAD", label: "Icon · Hết hàng (xin lỗi)", icon: "😔" },
            { key: "ORDER_NEW_ADMIN", label: "Icon · Đơn mới (báo admin)", icon: "🛒" },
        ],
    },
    {
        // Tin nhắn "Nhập kho thành công" gửi cho admin sau khi import kho (api-routes.js)
        // và tin "Kho hàng vừa được bổ sung" gửi cho khách (broadcast.js).
        id: "stock_import",
        label: "Nhập kho (báo admin & khách)",
        items: [
            { key: "STOCK_IMPORT_OK", label: "Nhập kho · Tiêu đề thành công", icon: "📦" },
            { key: "STOCK_IMPORT_PRODUCT", label: "Nhập kho · Sản phẩm", icon: "🏷️" },
            { key: "STOCK_IMPORT_ADDED", label: "Nhập kho · Đã thêm", icon: "✅" },
            { key: "STOCK_IMPORT_TOTAL", label: "Nhập kho · Tồn kho", icon: "📊" },
            { key: "RESTOCK_TITLE", label: "Bổ sung kho · Tiêu đề (khách)", icon: "🔄" },
            { key: "RESTOCK_PRODUCT", label: "Bổ sung kho · Sản phẩm (khách)", icon: "📦" },
            { key: "RESTOCK_ADDED", label: "Bổ sung kho · Thêm dòng (khách)", icon: "➕" },
            { key: "RESTOCK_TOTAL", label: "Bổ sung kho · Tồn kho (khách)", icon: "↗️" },
        ],
    },
    {
        id: "wallet_tx",
        label: "Lịch sử giao dịch ví",
        items: [
            { key: "WALLET_TX_DEPOSIT", label: "Icon · Nạp tiền", icon: "💰" },
            { key: "WALLET_TX_PURCHASE", label: "Icon · Mua hàng", icon: "🛒" },
            { key: "WALLET_TX_REFUND", label: "Icon · Hoàn tiền", icon: "↩️" },
            { key: "WALLET_TX_REFUND_REVERSAL", label: "Icon · Thu hồi hoàn tiền", icon: "↪️" },
            { key: "WALLET_TX_ADMIN_ADD", label: "Icon · Admin cộng tiền", icon: "➕" },
            { key: "WALLET_TX_ADMIN_DEDUCT", label: "Icon · Admin trừ tiền", icon: "➖" },
            { key: "WALLET_TX_GIFTCODE", label: "Icon · Giftcode", icon: "🎟" },
            { key: "WALLET_TX_OTHER", label: "Icon · Giao dịch khác", icon: "📝" },
        ],
    },
    {
        id: "vip",
        label: "VIP",
        items: [
            { key: "VIP_TIER_0", label: "Icon · VIP bậc 0", icon: "👤" },
            { key: "VIP_TIER_1", label: "Icon · VIP bậc 1", icon: "🥈" },
            { key: "VIP_TIER_2", label: "Icon · VIP bậc 2", icon: "🥇" },
            { key: "VIP_TIER_3", label: "Icon · VIP bậc 3", icon: "💎" },
            { key: "VIP_MAX", label: "Icon · VIP cấp cao nhất", icon: "🏆" },
            { key: "VIP_SPEND", label: "Icon · Tổng chi tiêu", icon: "💰" },
            { key: "VIP_DISCOUNT", label: "Icon · Giảm giá VIP", icon: "🎁" },
            { key: "VIP_REFERRAL", label: "Icon · Hoa hồng giới thiệu", icon: "👥" },
            { key: "VIP_NEXT", label: "Icon · Lên cấp tiếp theo", icon: "📊" },
        ],
    },
    {
        id: "help",
        label: "Hỗ trợ",
        items: [
            { key: "HELP_BUYING", label: "Cách mua hàng", icon: "📖" },
            { key: "HELP_PAYMENT", label: "Thanh toán & giao hàng", icon: "💳" },
            { key: "HELP_WALLET", label: "Hướng dẫn nạp ví", icon: "👛" },
            { key: "HELP_REFERRAL", label: "Chương trình giới thiệu", icon: "🎁" },
            { key: "CONTACT_ADMIN", label: "Liên hệ admin", icon: "💬" },
        ],
    },
    {
        id: "apikey",
        label: "API key (giftcode + mua)",
        items: [
            { key: "GIFT_WIN", label: "Icon · Trúng quà", icon: "🎉" },
            { key: "APIKEY_QUOTA", label: "Icon · Quota token", icon: "🎁" },
            { key: "APIKEY_RPM", label: "Icon · RPM", icon: "⚡" },
            { key: "APIKEY_EXPIRES", label: "Icon · Hết hạn key", icon: "📅" },
            { key: "APIKEY_DOCS", label: "Tài liệu dùng key", icon: "📘" },
            { key: "APIKEY_USAGE", label: "Icon · Xem mức dùng", icon: "🔎" },
            { key: "APIKEY_MY_KEYS", label: "API key của tôi", icon: "🔑" },
            { key: "APIKEY_CUSTOM", label: "Tự chọn số token", icon: "✏️" },
            { key: "APIKEY_DAYS", label: "Icon · Số ngày hiệu lực", icon: "📆" },
            { key: "APIKEY_CONFIRM", label: "Xác nhận mua key", icon: "🧾" },
        ],
    },
    {
        id: "admin_menu",
        label: "Menu quản trị trong bot",
        items: [
            { key: "ADMIN_ORDERS", label: "Admin · Đơn hàng", icon: "📋" },
            { key: "ADMIN_PRODUCTS", label: "Admin · Sản phẩm", icon: "📦" },
            { key: "ADMIN_CATEGORIES", label: "Admin · Danh mục", icon: "📁" },
            { key: "ADMIN_USERS", label: "Admin · Người dùng", icon: "👥" },
            { key: "ADMIN_STATS", label: "Admin · Thống kê", icon: "📊" },
            { key: "ADMIN_WALLET", label: "Admin · Ví khách", icon: "👛" },
            { key: "ADMIN_COUPONS", label: "Admin · Coupon", icon: "🎟️" },
            { key: "ADMIN_GIFTCODES", label: "Admin · Giftcode", icon: "🎁" },
            { key: "ADMIN_BROADCAST", label: "Admin · Broadcast", icon: "📣" },
            { key: "ADMIN_EXPORT", label: "Admin · Export", icon: "📤" },
            { key: "ADMIN_BACKUP", label: "Admin · Backup", icon: "💾" },
            { key: "ADMIN_MENU_CONFIG", label: "Admin · Giao diện menu", icon: "⚙️" },
            { key: "ADMIN_WELCOME_CONFIG", label: "Admin · Lời chào", icon: "✏️" },
            { key: "ADMIN_PRODUCT_DISPLAY", label: "Admin · Hiển thị sản phẩm", icon: "🖥️" },
            { key: "ADMIN_SELLER_API", label: "Admin · API Seller", icon: "🔑" },
        ],
    },
    {
        id: "admin_crud",
        label: "Nút quản trị (thêm/sửa/xoá)",
        items: [
            { key: "ADMIN_ADD", label: "Admin · Thêm mới", icon: "➕" },
            { key: "ADMIN_EDIT", label: "Admin · Sửa", icon: "✏️" },
            { key: "ADMIN_DELETE", label: "Admin · Xoá", icon: "🗑️" },
            { key: "ADMIN_SAVE", label: "Admin · Lưu", icon: "💾" },
            { key: "ADMIN_CANCEL", label: "Admin · Huỷ", icon: "❌" },
            { key: "ADMIN_CONFIRM", label: "Admin · Xác nhận", icon: "✅" },
            { key: "ADMIN_RESET", label: "Admin · Reset / Làm mới", icon: "🔄" },
            { key: "ADMIN_TOGGLE_ON", label: "Admin · Đang bật", icon: "🟢" },
            { key: "ADMIN_TOGGLE_OFF", label: "Admin · Đang tắt", icon: "🔴" },
            { key: "ADMIN_ICON_EDIT", label: "Admin · Đổi icon", icon: "🎨" },
            { key: "ADMIN_IMAGE", label: "Admin · Đổi ảnh", icon: "🖼" },
            { key: "ADMIN_EMPTY", label: "Admin · Danh sách trống", icon: "📭" },
            { key: "ADMIN_SEARCH", label: "Admin · Tìm kiếm", icon: "🔍" },
            { key: "ADMIN_IMPORT", label: "Admin · Nhập kho", icon: "📥" },
            { key: "ADMIN_VIP", label: "Admin · VIP", icon: "👑" },
            { key: "ADMIN_MONEY", label: "Admin · Tiền", icon: "💰" },
            { key: "ADMIN_DATE", label: "Admin · Ngày", icon: "📅" },
            { key: "ADMIN_TREND", label: "Admin · Biểu đồ", icon: "📈" },
            { key: "ADMIN_TOP", label: "Admin · Xếp hạng", icon: "🏆" },
            { key: "ADMIN_NOTE", label: "Admin · Ghi chú", icon: "📝" },
            { key: "ADMIN_QTY", label: "Admin · Số lượng", icon: "🔢" },
            { key: "ADMIN_DOC", label: "Admin · Tài liệu", icon: "📄" },
        ],
    },
];

/** Derive từ ICON_GROUPS — giữ nguyên API cũ cho mọi call site hiện có. */
export const BUTTON_LABELS = Object.fromEntries(
    ICON_GROUPS.flatMap((g) => g.items.map((i) => [i.key, i.label])),
);

export const DEFAULT_ICONS = Object.fromEntries(
    ICON_GROUPS.flatMap((g) => g.items.map((i) => [i.key, i.icon])),
);

export const DEFAULT_WELCOME_GREETING = "Chào {name}. Đây là bảng điều khiển mua hàng của bạn.";
export const DEFAULT_WELCOME_SUBTITLE = "Chọn một thao tác bên dưới để tiếp tục.";
export const DEFAULT_SHOP_NAME = "Shop Bot Tele";

let _cache = null;
let _cacheIds = null;
let _cacheWelcome = null;
let _cacheShopName = null;

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

/**
 * Icon động (custom emoji) CHỈ render được khi chủ bot có Telegram Premium, hoặc bot
 * đã mua username trên Fragment. Không thoả thì Telegram bỏ field icon_custom_emoji_id
 * đi im lặng — mà mọi chỗ dựng nút lại xoá emoji tĩnh khỏi text khi có ID, nên nút
 * mất icon hoàn toàn. Công tắc này trả {} để toàn bộ code quay về emoji tĩnh.
 * Bật lại: đặt CUSTOM_EMOJI_ICONS=true trong .env (chỉ khi đã chắc có Premium/Fragment).
 */
export const CUSTOM_EMOJI_ENABLED = String(process.env.CUSTOM_EMOJI_ICONS || "").toLowerCase() === "true";

export async function getMenuIconIds() {
    if (!CUSTOM_EMOJI_ENABLED) return {};
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

// === Ẩn/hiện nút menu chính ===================================================
/**
 * Nút menu chính admin bật/tắt được. Tên khoá Setting giữ nguyên `BTN_*` vì tab
 * "Menu Buttons" trong web admin đã ghi chúng từ trước — UI có sẵn nhưng KHÔNG
 * chỗ nào trong bot đọc, nên gạt công tắc xong bot vẫn hiện đủ nút. Giờ nối dây.
 *
 * Giá trị "false" = ẩn. Thiếu khoá = hiện (mặc định phải là hiện, không ai muốn
 * nâng cấp xong menu trống trơn).
 *
 * `action` là callback_data thật của nút, dùng để lọc lúc dựng bàn phím.
 */
export const MENU_BUTTON_TOGGLES = [
    { key: "BTN_CATALOG", action: "LIST_PRODUCTS", label: "Mua hàng" },
    { key: "BTN_GIFTCODE", action: "REDEEM_GIFTCODE", label: "Nhập GIFTCODE" },
    { key: "BTN_APIKEY", action: "APIKEY_BUY", label: "Tạo API key" },
    { key: "BTN_ALL_PRODUCTS", action: "ALL_PRODUCTS", label: "Sản phẩm" },
    { key: "BTN_WALLET", action: "WALLET", label: "Ví" },
    { key: "BTN_MY_ORDERS", action: "MY_ORDERS", label: "Đơn hàng" },
    { key: "BTN_ACCOUNT", action: "ACCOUNT", label: "Tài khoản" },
    { key: "BTN_REFERRAL", action: "REFERRAL", label: "Giới thiệu" },
    { key: "BTN_SUPPORT", action: "HELP", label: "Hỗ trợ" },
    { key: "BTN_CHANNEL", action: "JOIN_GROUP", label: "Channel" },
    { key: "BTN_CONTACT_ADMIN", action: "CONTACT_ADMIN", label: "Liên hệ Admin" },
    { key: "BTN_LANGUAGE", action: "LANGUAGE", label: "Ngôn ngữ" },
];

const TOGGLE_KEYS = MENU_BUTTON_TOGGLES.map((t) => t.key);
const ACTION_OF_KEY = Object.fromEntries(MENU_BUTTON_TOGGLES.map((t) => [t.key, t.action]));

// Set các action ĐANG BỊ ẨN. null = cache nguội (CHƯA từng nạp được).
let _cacheHidden = null;
// Promise của lần nạp đang chạy — chống nhiều menu dựng cùng lúc cùng bắn query.
let _hiddenLoading = null;
// Có invalidate tới TRONG LÚC đang nạp → bản vừa đọc đã cũ, phải nạp lại.
let _hiddenStale = false;
// Mốc lần nạp lỗi gần nhất: DB chết thì đừng thử lại mỗi lần dựng menu.
let _hiddenFailedAt = 0;
const HIDDEN_RETRY_MS = 5_000;

/**
 * Nạp lại cờ ẩn/hiện từ DB và TRÁO vào cache.
 *
 * KHÔNG xoá `_cacheHidden` trước khi đọc xong: `isMenuActionVisibleSync` đọc đồng
 * bộ và coi cache nguội là "hiện tất", nên xoá trước = có một cửa sổ (dài bằng
 * round-trip DB) mà mọi nút đã ẩn lại hiện ra. Giữ bản cũ, thay bằng bản mới.
 */
function refreshHiddenMenuActions() {
    // Đang nạp dở mà lại có thay đổi → đánh dấu để nạp thêm một lượt nữa, chứ
    // không chạy song song (hai query đua nhau, cái cũ về sau sẽ ghi đè cái mới).
    if (_hiddenLoading) {
        _hiddenStale = true;
        return _hiddenLoading;
    }
    _hiddenStale = false;
    _hiddenLoading = (async () => {
        try {
            const rows = await prisma.setting.findMany({ where: { key: { in: TOGGLE_KEYS } } });
            const hidden = new Set();
            for (const r of rows) {
                if (String(r.value).toLowerCase() === "false") hidden.add(ACTION_OF_KEY[r.key]);
            }
            _cacheHidden = hidden;
            _hiddenFailedAt = 0;
        } catch {
            // Lỗi DB thoáng qua KHÔNG được biến thành "ẩn hết", cũng không được
            // xoá bản đang có (menu đang đúng thì cứ để nguyên).
            _hiddenFailedAt = Date.now();
        }
        _hiddenLoading = null;
        if (_hiddenStale) return refreshHiddenMenuActions();
        return _cacheHidden || new Set();
    })();
    return _hiddenLoading;
}

export async function getHiddenMenuActions() {
    if (_cacheHidden) return _cacheHidden;
    return refreshHiddenMenuActions();
}

/**
 * Bản đồng bộ cho lúc dựng bàn phím (buildMainMenuKeyboard không async được).
 * Cache nguội → trả true (hiện) VÀ nạp nền cho lần dựng sau. Thà hiện thừa một
 * nút trong vài giây đầu sau khởi động còn hơn đưa khách một menu trống.
 */
export function isMenuActionVisibleSync(action) {
    if (!_cacheHidden) {
        // Chưa từng nạp được (warm lúc boot lỗi) → thử lại ở nền, có nhịp nghỉ để
        // DB chết không biến mỗi lần dựng menu thành một query hỏng.
        if (Date.now() - _hiddenFailedAt >= HIDDEN_RETRY_MS) refreshHiddenMenuActions().catch(() => {});
        return true;
    }
    return !_cacheHidden.has(action);
}

/**
 * Làm nóng cache lúc boot để menu đầu tiên đã đúng.
 * Có lượt nạp đang chạy (vừa invalidate) thì CHỜ nó, không trả bản cũ ra.
 */
export async function warmMenuButtonFlags() {
    if (_hiddenLoading) return _hiddenLoading;
    return getHiddenMenuActions();
}

export function invalidateMenuCache() {
    _cache = null;
    _cacheIds = null;
    _cacheWelcome = null;
    _cacheShopName = null;
    _displayCache = null;
    // KHÔNG gán `_cacheHidden = null` rồi bỏ đó: không có ai nạp lại (getHidden
    // MenuActions chỉ được gọi lúc boot), mà cache nguội thì isMenuActionVisible
    // Sync trả "hiện tất" → mọi nút đã ẩn bung ra vĩnh viễn tới lần restart.
    // Nạp lại ngay ở nền, giữ bản cũ cho tới khi bản mới về.
    refreshHiddenMenuActions().catch(() => {});
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

/**
 * Reset toàn bộ icon về mặc định bằng 1 lần ghi DB cho mỗi Setting key.
 * Thay cho vòng lặp gọi setMenuIcon() từng key (trước đây tốn 2×N upsert).
 */
export async function resetAllMenuIcons() {
    _cache = { ...DEFAULT_ICONS };
    _cacheIds = {};
    await prisma.setting.upsert({
        where: { key: "menu_buttons" },
        update: { value: JSON.stringify(_cache) },
        create: { key: "menu_buttons", value: JSON.stringify(_cache) },
    });
    await prisma.setting.upsert({
        where: { key: "menu_button_ids" },
        update: { value: "{}" },
        create: { key: "menu_button_ids", value: "{}" },
    });
}

export function getMenuIconsSync() {
    return _cache || { ...DEFAULT_ICONS };
}

export function getMenuIconIdsSync() {
    if (!CUSTOM_EMOJI_ENABLED) return {};
    return _cacheIds || {};
}

/**
 * Lấy emoji tĩnh của 1 key (không kèm custom emoji id) — dùng cho text button,
 * caption, hoặc chỗ gửi bằng parse_mode Markdown (nơi <tg-emoji> không render).
 */
export function iconOf(action) {
    const icons = _cache || DEFAULT_ICONS;
    return icons[action] ?? DEFAULT_ICONS[action] ?? "";
}

/**
 * Lấy cặp { icon, id } của 1 key — dùng cho message text HTML:
 *   renderTelegramEmoji(...Object.values(iconPair(key)))
 * hoặc cho button: { text, icon_custom_emoji_id: id }.
 */
export function iconPair(action) {
    return { icon: iconOf(action), id: CUSTOM_EMOJI_ENABLED ? (_cacheIds || {})[action] ?? null : null };
}
