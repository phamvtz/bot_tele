import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Save, CheckCircle2, RefreshCw } from "lucide-react";
import { api } from "../../api/endpoints";

const TABS = [
  { key: "shop",     label: "Cửa hàng" },
  { key: "general",  label: "Cài đặt chung" },
  { key: "payment",  label: "Thanh toán & Kênh" },
  { key: "security", label: "Bảo mật" },
  { key: "theme",    label: "Giao diện" },
  { key: "icons",    label: "Icons" },
];

const ICON_GROUPS = [
  {
    label: "Menu chính",
    items: [
      { key: "LIST_PRODUCTS",  label: "Mua hàng",    def: "🛒" },
      { key: "WALLET",         label: "Ví",           def: "💳" },
      { key: "MY_ORDERS",      label: "Đơn hàng",    def: "📋" },
      { key: "ACCOUNT",        label: "Tài khoản",   def: "👤" },
      { key: "ALL_PRODUCTS",   label: "Sản phẩm",   def: "🏪" },
      { key: "HELP",           label: "Hỗ trợ",      def: "🆘" },
      { key: "REFERRAL",       label: "Giới thiệu",  def: "🎁" },
      { key: "LANGUAGE",       label: "Ngôn ngữ",    def: "🌐" },
      { key: "API_LINK",       label: "API",         def: "🔗" },
      { key: "HIDE_MENU",      label: "Ẩn menu",     def: "🙈" },
      { key: "ADMIN_PANEL",    label: "Admin Panel", def: "🛠" },
      { key: "BACK_HOME",      label: "Menu",        def: "🏠" },
      { key: "NAV_CATS",       label: "Danh mục",    def: "📁" },
      { key: "NAV_BACK",       label: "Quay lại",    def: "🔙" },
      { key: "NAV_PREV",       label: "Trang trước", def: "◀️" },
      { key: "NAV_NEXT",       label: "Trang sau",   def: "▶️" },
      { key: "OUT_OF_STOCK",   label: "Hết hàng",    def: "🔴" },
      { key: "BUY_QUANTITY",   label: "Chọn số lượng", def: "🛒" },
      { key: "CUSTOM_QUANTITY", label: "Số lượng khác", def: "✏️" },
      { key: "JOIN_GROUP",      label: "Tham gia nhóm", def: "📢" },
      { key: "VERIFY_JOIN",     label: "Kiểm tra tham gia nhóm", def: "✅" },
      { key: "SKIP_COUPON",     label: "Bỏ qua mã giảm giá", def: "⏭️" },
    ],
  },
  {
    label: "Thanh toán & Ví",
    items: [
      { key: "PAY_QR",         label: "Thanh toán QR",        def: "🏦" },
      { key: "PAY_WALLET",     label: "Trừ ví",               def: "💳" },
      { key: "WALLET_DEPOSIT", label: "Nạp ví",               def: "💰" },
      { key: "DEPOSIT_CUSTOM", label: "Nhập số khác",         def: "✏️" },
      { key: "PAY_TRC20",      label: "Thanh toán USDT TRC20", def: "🔴" },
      { key: "PAY_BEP20",      label: "Thanh toán USDT BEP20", def: "🟡" },
      { key: "SHOW_USDT",      label: "Hiện thanh toán USDT",  def: "📷" },
      { key: "CHECK_USDT",     label: "Kiểm tra USDT",         def: "✅" },
      { key: "DEPOSIT_BANK",   label: "Nạp qua ngân hàng",     def: "🏦" },
      { key: "DEPOSIT_BEP20",  label: "Nạp USDT BEP20",        def: "🟡" },
      { key: "DEPOSIT_TRC20",  label: "Nạp USDT TRC20",        def: "🔴" },
      { key: "TX_HISTORY",     label: "Lịch sử giao dịch",     def: "📋" },
      { key: "BACK_WALLET",    label: "Quay lại ví",           def: "👛" },
      { key: "OPEN_QR",        label: "Mở QR",                  def: "📷" },
      { key: "VIEW_ORDER",     label: "Xem đơn hàng",           def: "📦" },
      { key: "VIEW_WALLET",    label: "Xem ví",                 def: "👛" },
      { key: "BROADCAST_BUY",  label: "Thông báo · Mua sản phẩm", def: "🛒" },
      { key: "MUTE_NOTIFY",    label: "Thông báo · Ẩn 1 ngày",  def: "🔕" },
      { key: "SHOW_QR",        label: "Hiện lại QR",          def: "🏦" },
      { key: "CHECK_PAID",     label: "Đã chuyển tiền",       def: "✅" },
      { key: "CANCEL_ORDER",   label: "Hủy đơn",              def: "❌" },
      { key: "ORDER_REFRESH",  label: "Làm mới",              def: "🔄" },
      { key: "BUY_AGAIN",      label: "Mua lại",              def: "🛒" },
      { key: "CONTINUE_SHOP",  label: "Mua tiếp",             def: "🛍" },
    ],
  },
  {
    label: "Hỗ trợ",
    items: [
      { key: "HELP_BUYING",    label: "Cách mua hàng",        def: "📖" },
      { key: "HELP_PAYMENT",   label: "Thanh toán & giao hàng", def: "💳" },
      { key: "HELP_WALLET",    label: "Hướng dẫn nạp ví",     def: "👛" },
      { key: "HELP_REFERRAL",  label: "Chương trình giới thiệu", def: "🎁" },
      { key: "CONTACT_ADMIN",  label: "Liên hệ admin",        def: "💬" },
    ],
  },
  {
    label: "Chi tiết sản phẩm",
    items: [
      { key: "FIELD_PRICE",    label: "Giá bán",     def: "💰" },
      { key: "FIELD_STOCK",    label: "Tồn kho",     def: "📦" },
      { key: "FIELD_SOLD",     label: "Đã bán",      def: "📊" },
      { key: "FIELD_DESC",     label: "Mô tả",       def: "💬" },
      { key: "FIELD_NOTE",     label: "Lưu ý",       def: "⚠️" },
    ],
  },
  {
    label: "Chi tiết đơn hàng",
    items: [
      { key: "ORDER_ID",       label: "Mã đơn",      def: "🆔" },
      { key: "ORDER_PRODUCT",  label: "Sản phẩm",   def: "📦" },
      { key: "ORDER_QTY",      label: "Số lượng",    def: "🔢" },
      { key: "ORDER_TOTAL",    label: "Tổng tiền",   def: "💰" },
      { key: "ORDER_PAYMENT",  label: "Thanh toán",  def: "💳" },
      { key: "ORDER_TIME",     label: "Thời gian",   def: "🕐" },
      { key: "ORDER_DELIVERY", label: "Giao hàng",   def: "📬" },
      { key: "ORDER_WALLET",   label: "Số dư ví",    def: "👛" },
      { key: "ORDER_DISCOUNT", label: "Giảm giá",    def: "💸" },
    ],
  },
  {
    label: "Menu quản trị trong bot",
    items: [
      { key: "ADMIN_ORDERS",          label: "Đơn hàng",          def: "📋" },
      { key: "ADMIN_PRODUCTS",        label: "Sản phẩm",          def: "📦" },
      { key: "ADMIN_CATEGORIES",      label: "Danh mục",          def: "📁" },
      { key: "ADMIN_USERS",           label: "Người dùng",        def: "👥" },
      { key: "ADMIN_STATS",           label: "Thống kê",          def: "📊" },
      { key: "ADMIN_WALLET",          label: "Ví khách",           def: "👛" },
      { key: "ADMIN_COUPONS",         label: "Coupon",            def: "🎟️" },
      { key: "ADMIN_BROADCAST",       label: "Broadcast",         def: "📣" },
      { key: "ADMIN_EXPORT",          label: "Export",            def: "📤" },
      { key: "ADMIN_BACKUP",          label: "Backup",            def: "💾" },
      { key: "ADMIN_MENU_CONFIG",     label: "Giao diện menu",    def: "⚙️" },
      { key: "ADMIN_WELCOME_CONFIG",  label: "Lời chào",          def: "✏️" },
      { key: "ADMIN_PRODUCT_DISPLAY", label: "Hiển thị sản phẩm", def: "🖥️" },
      { key: "ADMIN_SELLER_API",      label: "API Seller",        def: "🔑" },
    ],
  },
];
const ICON_DEFS = ICON_GROUPS.flatMap(g => g.items);
const ICON_LABELS = Object.fromEntries(ICON_DEFS.map(({ key, label }) => [key, label]));

function parseSettingMap(value) {
  try {
    return JSON.parse(value || "{}");
  } catch {
    return {};
  }
}

// Keys per tab — Lưu chỉ gửi keys của tab đang mở
const TAB_KEYS = {
  shop:     ["SHOP_NAME", "SHOP_DESC", "SHOP_LOGO", "SHOP_SUPPORT_USERNAME", "WELCOME_GREETING"],
  general:  ["CURRENCY", "TIMEZONE", "MIN_DEPOSIT", "MAX_DEPOSIT", "ORDER_EXPIRE_MINUTES", "USER_COUNT_OFFSET"],
  payment:  [
    "BANK_CODE", "SHOP_BANK_NAME", "SHOP_BANK_ACCOUNT", "SHOP_BANK_ACCOUNT_NAME",
    "SUPPORT_CHANNEL_URL", "ORDER_NOTIFY_CHANNEL", "ORDER_CHANNEL_NOTIFY_ENABLED", "ORDER_BOT_BROADCAST_ENABLED", "DEPOSIT_PRESETS",
    "CRYPTO_PAY_ENABLED", "CRYPTO_POLL_ENABLED", "CRYPTO_POLL_INTERVAL_MS", "CRYPTO_EXPIRE_MINUTES",
    "CRYPTO_USD_VND_RATE", "TRC20_USDT_ADDRESS", "TRONGRID_API_KEY", "BEP20_USDT_ADDRESS",
    "BSCSCAN_API_KEY", "BSCSCAN_CHAIN_ID",
  ],
  security: ["ADMIN_IDS", "ADMIN_SECRET"],
  theme:    ["DARK_MODE", "ACCENT_COLOR"],
};

export default function Settings() {
  const [activeTab, setActiveTab] = useState("shop");
  const [saved, setSaved] = useState(false);
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({ queryKey: ["settings"], queryFn: api.settings });
  const settings = data?.settings || {};

  // Pre-populate form với dữ liệu thật khi load xong
  const [form, setForm] = useState({});
  const [iconEmojis, setIconEmojis] = useState({});
  const [iconIds, setIconIds] = useState({});
  const [iconCheckResult, setIconCheckResult] = useState(null);
  useEffect(() => {
    if (data) {
      // The query result is the source used to reset the editable form snapshot.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setForm(data.settings || {});
      setIconEmojis(parseSettingMap(data.settings?.menu_buttons));
      setIconIds(parseSettingMap(data.settings?.menu_button_ids));
    }
  }, [data]);

  const f = (key) => form[key] ?? settings[key] ?? "";
  const set = (key, val) => setForm((p) => ({ ...p, [key]: val }));

  const saveMut = useMutation({
    mutationFn: api.updateSettings,
    onSuccess: () => {
      qc.invalidateQueries(["settings"]);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    },
  });

  const iconCheckMut = useMutation({
    mutationFn: api.checkMenuIcons,
    onSuccess: setIconCheckResult,
  });

  function saveIcons() {
    const cleanIds = Object.fromEntries(Object.entries(iconIds).filter(([, v]) => v?.trim()));
    saveMut.mutate({
      menu_buttons: JSON.stringify(iconEmojis),
      menu_button_ids: JSON.stringify(cleanIds),
    });
  }

  function checkIcons() {
    const cleanIds = Object.fromEntries(Object.entries(iconIds).filter(([, value]) => value?.trim()));
    setIconCheckResult(null);
    iconCheckMut.mutate(cleanIds);
  }

  function resetIcon(key) {
    setIconEmojis(p => { const n = { ...p }; delete n[key]; return n; });
    setIconIds(p => { const n = { ...p }; delete n[key]; return n; });
    setIconCheckResult(null);
  }

  function saveTab() {
    const keys = TAB_KEYS[activeTab] || [];
    const payload = Object.fromEntries(keys.map((k) => [k, f(k)]).filter(([, v]) => v !== undefined && v !== null));
    if (!Object.keys(payload).length) return;
    saveMut.mutate(payload);
  }

  const shopInitials = (f("SHOP_NAME") || "S").slice(0, 2).toUpperCase();

  if (isLoading) return (
    <div className="flex items-center justify-center py-20 text-sm text-gray-400">Đang tải cấu hình...</div>
  );

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-xl font-bold text-white">Cấu hình Hệ thống</h1>
        {saved && (
          <span className="flex items-center gap-1.5 text-sm text-emerald-400 animate-in fade-in">
            <CheckCircle2 size={14} /> Đã lưu
          </span>
        )}
      </div>
      <p className="text-sm text-gray-500 mb-5">Cài đặt bot, cửa hàng và bảo mật</p>

      <div className="flex gap-5">
        {/* Tab list */}
        <div className="w-44 flex-shrink-0">
          <div className="glass rounded-xl overflow-hidden">
            {TABS.map((t) => (
              <button key={t.key} onClick={() => setActiveTab(t.key)}
                className={`w-full text-left px-4 py-3 text-sm border-b border-white/[0.04] last:border-0 transition-colors ${
                  activeTab === t.key
                    ? "bg-white/[0.08] text-white font-medium"
                    : "text-gray-400 hover:bg-white/[0.05] hover:text-white"
                }`}>
                {t.label}
              </button>
            ))}
          </div>
        </div>

        {/* Panel */}
        <div className="flex-1 glass rounded-xl p-5">

          {/* ── Shop Tab ── */}
          {activeTab === "shop" && (
            <div>
              <h2 className="text-sm font-semibold text-white mb-4">Thông tin cửa hàng</h2>
              <div className="flex items-start gap-5">
                <div className="w-14 h-14 rounded-xl bg-primary-500 flex items-center justify-center flex-shrink-0 text-white text-lg font-bold">
                  {shopInitials}
                </div>
                <div className="flex-1 space-y-3">
                  <div>
                    <label className="text-xs font-medium text-gray-400 block mb-1.5">TÊN CỬA HÀNG</label>
                    <input value={f("SHOP_NAME")} onChange={(e) => set("SHOP_NAME", e.target.value)}
                      className="w-full glass-input rounded-lg px-3 py-2 text-sm" placeholder="Tên shop hiển thị trong bot" />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-gray-400 block mb-1.5">MÔ TẢ</label>
                    <textarea value={f("SHOP_DESC")} onChange={(e) => set("SHOP_DESC", e.target.value)} rows={2}
                      className="w-full glass-input rounded-lg px-3 py-2 text-sm resize-none" placeholder="Mô tả ngắn..." />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-gray-400 block mb-1.5">LOGO URL</label>
                    <input value={f("SHOP_LOGO")} onChange={(e) => set("SHOP_LOGO", e.target.value)}
                      className="w-full glass-input rounded-lg px-3 py-2 text-sm" placeholder="https://..." />
                    <p className="text-xs text-gray-600 mt-1">PNG vuông không nền, tối giản</p>
                  </div>
                  <div>
                    <label className="text-xs font-medium text-gray-400 block mb-1.5">USERNAME HỖ TRỢ</label>
                    <input value={f("SHOP_SUPPORT_USERNAME")} onChange={(e) => set("SHOP_SUPPORT_USERNAME", e.target.value)}
                      className="w-full glass-input rounded-lg px-3 py-2 text-sm" placeholder="@username" />
                    <p className="text-xs text-gray-600 mt-1">Hiện khi giao hàng thất bại</p>
                  </div>
                  <div>
                    <label className="text-xs font-medium text-gray-400 block mb-1.5">LỜI CHÀO /start</label>
                    <textarea value={f("WELCOME_GREETING")} onChange={(e) => set("WELCOME_GREETING", e.target.value)} rows={2}
                      className="w-full glass-input rounded-lg px-3 py-2 text-sm resize-none" placeholder="Chào {name}. Đây là bảng điều khiển mua hàng của bạn." />
                    <p className="text-xs text-gray-600 mt-1">Hiện khi user gõ /start. Dùng <code className="bg-white/10 px-1 rounded">{"{name}"}</code> để chèn tên user.</p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ── General Tab ── */}
          {activeTab === "general" && (
            <div>
              <h2 className="text-sm font-semibold text-white mb-4">Cài đặt chung</h2>
              <div className="space-y-4">
                <div>
                  <label className="text-xs font-medium text-gray-400 block mb-1.5">ĐƠN VỊ TIỀN TỆ</label>
                  <select value={f("CURRENCY")} onChange={(e) => set("CURRENCY", e.target.value)}
                    className="w-full glass-input rounded-lg px-3 py-2 text-sm">
                    <option value="VND">VND — Việt Nam Đồng</option>
                    <option value="USD">USD — US Dollar</option>
                    <option value="USDT">USDT — Tether</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-400 block mb-1.5">MÚI GIỜ</label>
                  <select value={f("TIMEZONE")} onChange={(e) => set("TIMEZONE", e.target.value)}
                    className="w-full glass-input rounded-lg px-3 py-2 text-sm">
                    <option value="Asia/Ho_Chi_Minh">Asia/Ho_Chi_Minh (UTC+7)</option>
                    <option value="Asia/Bangkok">Asia/Bangkok (UTC+7)</option>
                    <option value="Asia/Singapore">Asia/Singapore (UTC+8)</option>
                    <option value="UTC">UTC</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-400 block mb-1.5">NẠP TỐI THIỂU (VND)</label>
                  <input type="number" value={f("MIN_DEPOSIT")} onChange={(e) => set("MIN_DEPOSIT", e.target.value)}
                    className="w-full glass-input rounded-lg px-3 py-2 text-sm" placeholder="10000" min="0" step="1000" />
                  <p className="text-xs text-gray-600 mt-1">Số tiền tối thiểu mỗi lần nạp ví</p>
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-400 block mb-1.5">NẠP TỐI ĐA (VND)</label>
                  <input type="number" value={f("MAX_DEPOSIT")} onChange={(e) => set("MAX_DEPOSIT", e.target.value)}
                    className="w-full glass-input rounded-lg px-3 py-2 text-sm" placeholder="0 = không giới hạn" min="0" step="1000" />
                  <p className="text-xs text-gray-600 mt-1">Số tiền tối đa mỗi lần nạp ví (0 = không giới hạn)</p>
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-400 block mb-1.5">THỜI GIAN HẾT HẠN ĐƠN (PHÚT)</label>
                  <input type="number" value={f("ORDER_EXPIRE_MINUTES")} onChange={(e) => set("ORDER_EXPIRE_MINUTES", e.target.value)}
                    className="w-full glass-input rounded-lg px-3 py-2 text-sm" placeholder="10" min="1" max="1440" />
                  <p className="text-xs text-gray-600 mt-1">Đơn QR chưa thanh toán sẽ tự hủy sau số phút này (1–1440)</p>
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-400 block mb-1.5">SỐ THÀNH VIÊN ẢO</label>
                  <input type="number" value={f("USER_COUNT_OFFSET")} onChange={(e) => set("USER_COUNT_OFFSET", e.target.value)}
                    className="w-full glass-input rounded-lg px-3 py-2 text-sm" placeholder="0" min="0" step="100" />
                  <p className="text-xs text-gray-600 mt-1">Cộng thêm vào số thành viên hiển thị trong menu bot (0 = tắt)</p>
                </div>
              </div>
            </div>
          )}

          {/* ── Payment & Channel Tab ── */}
          {activeTab === "payment" && (
            <div>
              <h2 className="text-sm font-semibold text-white mb-4">Thông tin ngân hàng & Kênh thông báo</h2>
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-medium text-gray-400 block mb-1.5">MÃ NGÂN HÀNG (VietQR)</label>
                    <input value={f("BANK_CODE")} onChange={(e) => set("BANK_CODE", e.target.value)}
                      className="w-full glass-input rounded-lg px-3 py-2 text-sm uppercase" placeholder="MB" />
                    <p className="text-xs text-gray-600 mt-1">VD: MB, VCB, TCB, ACB...</p>
                  </div>
                  <div>
                    <label className="text-xs font-medium text-gray-400 block mb-1.5">TÊN NGÂN HÀNG</label>
                    <input value={f("SHOP_BANK_NAME")} onChange={(e) => set("SHOP_BANK_NAME", e.target.value)}
                      className="w-full glass-input rounded-lg px-3 py-2 text-sm" placeholder="MBBank" />
                  </div>
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-400 block mb-1.5">SỐ TÀI KHOẢN</label>
                  <input value={f("SHOP_BANK_ACCOUNT")} onChange={(e) => set("SHOP_BANK_ACCOUNT", e.target.value)}
                    className="w-full glass-input rounded-lg px-3 py-2 text-sm font-mono" placeholder="0123456789" />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-400 block mb-1.5">CHỦ TÀI KHOẢN</label>
                  <input value={f("SHOP_BANK_ACCOUNT_NAME")} onChange={(e) => set("SHOP_BANK_ACCOUNT_NAME", e.target.value)}
                    className="w-full glass-input rounded-lg px-3 py-2 text-sm uppercase" placeholder="NGUYEN VAN A" />
                  <p className="text-xs text-gray-600 mt-1">Thông tin này dùng để tạo mã QR chuyển khoản</p>
                </div>

                <div className="border-t border-white/[0.07] pt-4 mt-2">
                  <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">Kênh thông báo</h3>
                  <div className="space-y-4">
                    <div className="grid grid-cols-2 gap-3">
                      <label className="flex items-center justify-between gap-3 rounded-lg border border-white/[0.07] px-3 py-2">
                        <span className="text-sm text-gray-300">Báo đơn vào channel</span>
                        <input type="checkbox" checked={f("ORDER_CHANNEL_NOTIFY_ENABLED") !== "false"}
                          onChange={(e) => set("ORDER_CHANNEL_NOTIFY_ENABLED", String(e.target.checked))} />
                      </label>
                      <label className="flex items-center justify-between gap-3 rounded-lg border border-white/[0.07] px-3 py-2">
                        <span className="text-sm text-gray-300">Báo đơn trong bot</span>
                        <input type="checkbox" checked={f("ORDER_BOT_BROADCAST_ENABLED") !== "false"}
                          onChange={(e) => set("ORDER_BOT_BROADCAST_ENABLED", String(e.target.checked))} />
                      </label>
                    </div>
                    <div>
                      <label className="text-xs font-medium text-gray-400 block mb-1.5">LINK CHANNEL KHÁCH HÀNG</label>
                      <input value={f("SUPPORT_CHANNEL_URL")} onChange={(e) => set("SUPPORT_CHANNEL_URL", e.target.value)}
                        className="w-full glass-input rounded-lg px-3 py-2 text-sm" placeholder="https://t.me/your_channel" />
                      <p className="text-xs text-gray-600 mt-1">Nút "Vào Channel Khách Hàng" hiện sau khi giao hàng</p>
                    </div>
                    <div>
                      <label className="text-xs font-medium text-gray-400 block mb-1.5">CHANNEL BÁO ĐƠN MỚI</label>
                      <input value={f("ORDER_NOTIFY_CHANNEL")} onChange={(e) => set("ORDER_NOTIFY_CHANNEL", e.target.value)}
                        className="w-full glass-input rounded-lg px-3 py-2 text-sm font-mono" placeholder="-1001234567890 hoặc @channel" />
                      <p className="text-xs text-gray-600 mt-1">Bot gửi thông báo mỗi khi có đơn tự giao. Bot phải là admin của channel.</p>
                    </div>
                  </div>
                </div>

                <div className="border-t border-white/[0.07] pt-4 mt-2">
                  <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">Mức nạp nhanh</h3>
                  <div>
                    <label className="text-xs font-medium text-gray-400 block mb-1.5">CÁC MỨC GỢI Ý (VND)</label>
                    <input value={f("DEPOSIT_PRESETS")} onChange={(e) => set("DEPOSIT_PRESETS", e.target.value)}
                      className="w-full glass-input rounded-lg px-3 py-2 text-sm font-mono" placeholder="50000, 100000, 200000, 500000" />
                    <p className="text-xs text-gray-600 mt-1">Các nút gợi ý số tiền khi nạp ví, phân cách bằng dấu phẩy. Để trống = mặc định.</p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ── Security Tab ── */}
          {activeTab === "payment" && (
            <div className="mt-5 pt-4 border-t border-white/[0.07]">
              <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">USDT BEP20 / TRC20</h3>
              <div className="grid grid-cols-2 gap-3">
                <label className="flex items-center justify-between gap-3 rounded-lg border border-white/[0.07] px-3 py-2">
                  <span className="text-sm text-gray-300">Bật thanh toán USDT</span>
                  <input type="checkbox" checked={f("CRYPTO_PAY_ENABLED") !== "false"} onChange={(e) => set("CRYPTO_PAY_ENABLED", String(e.target.checked))} />
                </label>
                <label className="flex items-center justify-between gap-3 rounded-lg border border-white/[0.07] px-3 py-2">
                  <span className="text-sm text-gray-300">Bật auto scan</span>
                  <input type="checkbox" checked={f("CRYPTO_POLL_ENABLED") !== "false"} onChange={(e) => set("CRYPTO_POLL_ENABLED", String(e.target.checked))} />
                </label>
              </div>
              <div className="grid grid-cols-3 gap-3 mt-3">
                <div>
                  <label className="text-xs font-medium text-gray-400 block mb-1.5">TY GIA DU PHONG USD/VND</label>
                  <input type="number" value={f("CRYPTO_USD_VND_RATE")} onChange={(e) => set("CRYPTO_USD_VND_RATE", e.target.value)}
                    className="w-full glass-input rounded-lg px-3 py-2 text-sm" placeholder="26500" min="1" />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-400 block mb-1.5">HET HAN USDT (PHUT)</label>
                  <input type="number" value={f("CRYPTO_EXPIRE_MINUTES")} onChange={(e) => set("CRYPTO_EXPIRE_MINUTES", e.target.value)}
                    className="w-full glass-input rounded-lg px-3 py-2 text-sm" placeholder="20" min="1" />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-400 block mb-1.5">SCAN INTERVAL (MS)</label>
                  <input type="number" value={f("CRYPTO_POLL_INTERVAL_MS")} onChange={(e) => set("CRYPTO_POLL_INTERVAL_MS", e.target.value)}
                    className="w-full glass-input rounded-lg px-3 py-2 text-sm" placeholder="15000" min="5000" />
                </div>
              </div>
              <div className="space-y-3 mt-3">
                <div>
                  <label className="text-xs font-medium text-gray-400 block mb-1.5">VI USDT BEP20</label>
                  <input value={f("BEP20_USDT_ADDRESS")} onChange={(e) => set("BEP20_USDT_ADDRESS", e.target.value)}
                    className="w-full glass-input rounded-lg px-3 py-2 text-sm font-mono" placeholder="0x..." />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-400 block mb-1.5">ETHERSCAN / BSCSCAN API KEY</label>
                  <input type="password" value={f("BSCSCAN_API_KEY")} onChange={(e) => set("BSCSCAN_API_KEY", e.target.value)}
                    className="w-full glass-input rounded-lg px-3 py-2 text-sm font-mono" placeholder="API key" />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-400 block mb-1.5">VI USDT TRC20</label>
                  <input value={f("TRC20_USDT_ADDRESS")} onChange={(e) => set("TRC20_USDT_ADDRESS", e.target.value)}
                    className="w-full glass-input rounded-lg px-3 py-2 text-sm font-mono" placeholder="T..." />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-400 block mb-1.5">TRONGRID API KEY</label>
                  <input type="password" value={f("TRONGRID_API_KEY")} onChange={(e) => set("TRONGRID_API_KEY", e.target.value)}
                    className="w-full glass-input rounded-lg px-3 py-2 text-sm font-mono" placeholder="API key" />
                </div>
              </div>
              <p className="text-xs text-gray-600 mt-3">QR USDT được bot tự tạo trong Telegram. Khách cần chuyển đúng số USDT lẻ để hệ thống tự khớp.</p>
            </div>
          )}

          {activeTab === "security" && (
            <div>
              <h2 className="text-sm font-semibold text-white mb-4">Bảo mật & Telegram</h2>
              <div className="space-y-4">
                <div>
                  <label className="text-xs font-medium text-gray-400 block mb-1.5">ADMIN TELEGRAM IDs</label>
                  <input value={f("ADMIN_IDS")} onChange={(e) => set("ADMIN_IDS", e.target.value)}
                    className="w-full glass-input rounded-lg px-3 py-2 text-sm font-mono" placeholder="123456789,987654321" />
                  <p className="text-xs text-gray-600 mt-1">Phân cách bằng dấu phẩy. Cần restart bot để có hiệu lực.</p>
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-400 block mb-1.5">ADMIN SECRET (API token)</label>
                  <input type="password" value={f("ADMIN_SECRET")} onChange={(e) => set("ADMIN_SECRET", e.target.value)}
                    className="w-full glass-input rounded-lg px-3 py-2 text-sm font-mono" placeholder="••••••••••••••••" />
                  <p className="text-xs text-gray-600 mt-1">Token dùng xác thực request đến API admin</p>
                </div>
                <div className="bg-amber-950/30 border border-amber-800/30 rounded-lg px-3 py-2.5 text-xs text-amber-300 space-y-1">
                  <p>⚠ Các giá trị này đọc từ <code className="bg-white/10 px-1 rounded">.env</code>, không phải DB. Thay đổi ở đây chỉ lưu vào DB để tham khảo.</p>
                  <p>Để có hiệu lực thật sự: cập nhật <code className="bg-white/10 px-1 rounded">.env</code> rồi chạy <code className="bg-white/10 px-1 rounded">pm2 restart all</code>.</p>
                </div>
              </div>
            </div>
          )}

          {/* ── Theme Tab ── */}
          {activeTab === "theme" && (
            <div>
              <h2 className="text-sm font-semibold text-white mb-4">Giao diện</h2>
              <div className="space-y-5">
                <div className="flex items-center justify-between py-3 border-b border-white/[0.07]">
                  <div>
                    <p className="text-sm font-medium text-gray-300">Chế độ tối</p>
                    <p className="text-xs text-gray-500">Lưu tùy chọn giao diện</p>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input type="checkbox" className="sr-only peer"
                      checked={f("DARK_MODE") === "true"}
                      onChange={(e) => {
                        set("DARK_MODE", String(e.target.checked));
                        saveMut.mutate({ DARK_MODE: String(e.target.checked) });
                      }} />
                    <div className="w-9 h-5 bg-white/[0.15] rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-primary-500" />
                  </label>
                </div>
                <div>
                  <p className="text-sm font-medium text-gray-300 mb-3">Màu chủ đạo</p>
                  <div className="flex gap-2 flex-wrap">
                    {[
                      { hex: "#10b981", name: "Emerald" },
                      { hex: "#3b82f6", name: "Blue" },
                      { hex: "#8b5cf6", name: "Purple" },
                      { hex: "#f59e0b", name: "Amber" },
                      { hex: "#ef4444", name: "Red" },
                      { hex: "#ec4899", name: "Pink" },
                    ].map(({ hex, name }) => (
                      <button key={hex} title={name}
                        onClick={() => { set("ACCENT_COLOR", hex); saveMut.mutate({ ACCENT_COLOR: hex }); }}
                        className={`w-8 h-8 rounded-lg transition-transform hover:scale-110 ${
                          f("ACCENT_COLOR") === hex ? "ring-2 ring-white ring-offset-2 ring-offset-black scale-110" : "border-2 border-white/20"
                        }`}
                        style={{ backgroundColor: hex }} />
                    ))}
                  </div>
                  {f("ACCENT_COLOR") && (
                    <p className="text-xs text-gray-500 mt-2">Màu hiện tại: <span className="font-mono">{f("ACCENT_COLOR")}</span></p>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* ── Icons Tab ── */}
          {activeTab === "icons" && (
            <div className="space-y-6">
              {/* Header */}
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="text-sm font-semibold text-white mb-1">Icons menu bot ({ICON_DEFS.length})</h2>
                  <p className="text-xs text-gray-500 leading-relaxed">
                    Đổi emoji và thêm ID để dùng icon động Telegram.<br />
                    Lấy ID: gửi custom emoji vào bot → bot trả về ID ngay.<br />
                    <span className="text-gray-600">Preview chỉ hiện emoji tĩnh — icon ✨ sẽ hiển thị động đúng trong Telegram.</span>
                  </p>
                </div>
                <div className="flex flex-wrap justify-end gap-2">
                  <button onClick={checkIcons} disabled={iconCheckMut.isPending}
                    className="flex-shrink-0 flex items-center gap-1.5 px-4 py-2 bg-white/[0.06] text-gray-200 border border-white/[0.08] rounded-lg text-sm font-medium hover:bg-white/[0.1] disabled:opacity-50 transition-colors">
                    <RefreshCw size={13} className={iconCheckMut.isPending ? "animate-spin" : ""} />
                    {iconCheckMut.isPending ? "Đang kiểm tra..." : "Kiểm tra icon"}
                  </button>
                  <button onClick={saveIcons} disabled={saveMut.isPending}
                    className="flex-shrink-0 flex items-center gap-1.5 px-4 py-2 bg-primary-500 text-white rounded-lg text-sm font-medium hover:bg-primary-600 disabled:opacity-50 transition-colors shadow-glow-sm">
                    <Save size={13} />{saveMut.isPending ? "Đang lưu..." : "Lưu tất cả"}
                  </button>
                </div>
              </div>

              {saveMut.isError && (
                <div className="text-xs text-red-400 bg-red-950/40 border border-red-800/30 rounded-lg px-3 py-2">
                  Lỗi lưu: {saveMut.error?.response?.data?.error || saveMut.error?.message}
                </div>
              )}
              {saved && (
                <div className="text-xs text-emerald-400 bg-emerald-950/40 border border-emerald-800/30 rounded-lg px-3 py-2 flex items-center gap-1.5">
                  <CheckCircle2 size={12} /> Đã lưu thành công
                </div>
              )}
              {iconCheckMut.isError && (
                <div className="text-xs text-red-400 bg-red-950/40 border border-red-800/30 rounded-lg px-3 py-2">
                  Lỗi kiểm tra: {iconCheckMut.error?.response?.data?.error || iconCheckMut.error?.message}
                </div>
              )}
              {iconCheckResult && iconCheckResult.total === 0 && (
                <div className="text-xs text-amber-300 bg-amber-950/30 border border-amber-700/30 rounded-lg px-3 py-2">
                  Chưa có Custom Emoji ID nào để kiểm tra. Hãy nhập ID vào ít nhất một icon.
                </div>
              )}
              {iconCheckResult && iconCheckResult.total > 0 && iconCheckResult.invalid === 0 && (
                <div className="text-xs text-emerald-400 bg-emerald-950/40 border border-emerald-800/30 rounded-lg px-3 py-2 flex items-center gap-1.5">
                  <CheckCircle2 size={12} /> Telegram đã tải được toàn bộ {iconCheckResult.valid}/{iconCheckResult.total} icon.
                </div>
              )}
              {iconCheckResult?.invalid > 0 && (
                <div className="text-xs text-red-300 bg-red-950/40 border border-red-800/30 rounded-lg px-3 py-2 leading-relaxed">
                  Telegram tải được {iconCheckResult.valid}/{iconCheckResult.total} icon. Không tải được: {iconCheckResult.items
                    .filter((item) => !item.valid)
                    .map((item) => ICON_LABELS[item.key] || item.key)
                    .join(", ")}.
                </div>
              )}

              {/* Groups */}
              {ICON_GROUPS.map((group) => (
                <div key={group.label}>
                  <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2 px-1">{group.label}</h3>
                  <div className="rounded-xl border border-white/[0.06] overflow-hidden">
                    {group.items.map(({ key, label, def }, idx) => {
                      const hasCustom = !!(iconIds[key]?.trim() || (iconEmojis[key] && iconEmojis[key] !== def));
                      const checkedIcon = iconCheckResult?.items?.find((item) => item.key === key);
                      return (
                        <div key={key}
                          className={`flex items-center gap-3 px-4 py-3 ${idx < group.items.length - 1 ? "border-b border-white/[0.04]" : ""} hover:bg-white/[0.025] transition-colors`}>
                          {/* Preview */}
                          <div className={`relative w-9 h-9 rounded-lg flex items-center justify-center text-lg flex-shrink-0 transition-all ${
                            iconIds[key]?.trim()
                              ? "bg-primary-500/10 ring-1 ring-primary-500/40 shadow-[0_0_8px_rgba(139,92,246,0.3)]"
                              : "bg-white/[0.06]"
                          }`}>
                            {iconEmojis[key] ?? def}
                            {iconIds[key]?.trim() && (
                              <span className="absolute -top-1 -right-1 text-[9px] leading-none">✨</span>
                            )}
                          </div>
                          {/* Label */}
                          <div className="w-32 flex-shrink-0">
                            <p className="text-sm text-gray-300">{label}</p>
                            {iconIds[key]?.trim()
                              ? checkedIcon
                                ? <span className={`text-[10px] ${checkedIcon.valid ? "text-emerald-400" : "text-red-400"}`}>
                                    {checkedIcon.valid ? "✓ Đã tải được" : "Không tải được"}
                                  </span>
                                : <span className="text-[10px] text-primary-400">✨ Icon động</span>
                              : (iconEmojis[key] && iconEmojis[key] !== def)
                                ? <span className="text-[10px] text-yellow-500">● Đã đổi emoji</span>
                                : null
                            }
                          </div>
                          {/* Emoji input */}
                          <input
                            value={iconEmojis[key] ?? def}
                            onChange={e => setIconEmojis(p => ({ ...p, [key]: e.target.value }))}
                            className="glass-input rounded-lg px-2 py-1.5 text-base text-center w-14 flex-shrink-0"
                            maxLength={8}
                            title="Emoji"
                          />
                          {/* ID input */}
                          <input
                            value={iconIds[key] ?? ""}
                            onChange={e => {
                              setIconIds(p => ({ ...p, [key]: e.target.value }));
                              setIconCheckResult(null);
                            }}
                            placeholder="ID icon động (để trống nếu không dùng)"
                            className="glass-input rounded-lg px-3 py-1.5 text-xs text-gray-300 font-mono flex-1 min-w-0"
                          />
                          {/* Reset */}
                          {hasCustom ? (
                            <button onClick={() => resetIcon(key)}
                              className="flex-shrink-0 text-xs px-2 py-1 rounded-md text-gray-500 hover:text-white hover:bg-white/[0.08] transition-colors"
                              title="Reset về mặc định">↩</button>
                          ) : (
                            <div className="w-10 flex-shrink-0" />
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}

              <div className="pt-2 flex items-center gap-3">
                <button onClick={saveIcons} disabled={saveMut.isPending}
                  className="flex items-center gap-1.5 px-4 py-2 bg-primary-500 text-white rounded-lg text-sm font-medium hover:bg-primary-600 disabled:opacity-50 transition-colors shadow-glow-sm hover:shadow-glow">
                  <Save size={13} />{saveMut.isPending ? "Đang lưu..." : "Lưu tất cả"}
                </button>
              </div>
            </div>
          )}

          {/* Save button — không hiện ở theme (auto-save) và icons (has own button) */}
          {activeTab !== "theme" && activeTab !== "icons" && (
            <div className="mt-5 pt-4 border-t border-white/[0.07] flex items-center gap-3">
              <button onClick={saveTab} disabled={saveMut.isPending}
                className="flex items-center gap-1.5 px-4 py-2 bg-primary-500 text-white rounded-lg text-sm font-medium hover:bg-primary-600 disabled:opacity-50 transition-colors shadow-glow-sm hover:shadow-glow">
                <Save size={13} />
                {saveMut.isPending ? "Đang lưu..." : "Lưu thay đổi"}
              </button>
              {saveMut.isError && (
                <span className="text-xs text-red-400">{saveMut.error?.response?.data?.error || "Lỗi lưu"}</span>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
