import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { Save, RefreshCw, CheckCircle2 } from "lucide-react";
import { api } from "../../api/endpoints";

const TABS = [
  { key: "config", label: "Cấu hình Bot" },
  { key: "features", label: "Tính năng" },
  { key: "menu", label: "Menu Buttons" },
  { key: "ctv", label: "Hoa hồng CTV" },
];

const FEATURE_FLAGS = [
  { key: "FEATURE_REFERRAL", label: "Hệ thống giới thiệu (CTV)", desc: "Cho phép người dùng giới thiệu bạn bè và nhận hoa hồng" },
  { key: "FEATURE_WALLET_TOPUP", label: "Nạp ví nội bộ", desc: "Cho phép khách nạp tiền vào ví để thanh toán" },
  { key: "FEATURE_AUTO_CANCEL", label: "Tự hủy đơn quá hạn", desc: "Tự động hủy đơn PENDING sau 10 phút không thanh toán" },
  { key: "FEATURE_LOW_STOCK_ALERT", label: "Cảnh báo sắp hết hàng", desc: "Thông báo admin khi tồn kho xuống dưới ngưỡng" },
  { key: "FEATURE_API_DOCS", label: "Lệnh /api trong bot", desc: "Hiển thị lệnh /api để khách xem tài liệu tích hợp" },
  { key: "FEATURE_ORDER_NOTIFY", label: "Thông báo đơn hàng tới khách", desc: "Gửi tin nhắn xác nhận khi đơn được giao thành công" },
];

// Khớp 1-1 với MENU_BUTTON_TOGGLES trong src/menu-config.js — thêm nút ở đây mà
// quên bên kia thì công tắc lại thành vô tác dụng như bản trước.
// Thứ tự liệt kê theo đúng thứ tự nút hiện trong bot cho dễ đối chiếu.
const MENU_BUTTONS = [
  { key: "BTN_CATALOG", label: "🛒 Mua hàng", desc: "Nút to trên cùng, vào thẳng danh mục" },
  { key: "BTN_GIFTCODE", label: "🎁 Nhập GIFTCODE", desc: "Chỉ hiện khi cửa hàng API key đang bật" },
  { key: "BTN_APIKEY", label: "🔑 Tạo API key", desc: "Chỉ hiện khi cửa hàng API key đang bật" },
  { key: "BTN_MYKEYS", label: "🔑 API key của tôi", desc: "Xem key đã cấp (/mykey) — nằm ở bàn phím dưới" },
  { key: "BTN_ALL_PRODUCTS", label: "🏪 Sản phẩm", desc: "Danh sách toàn bộ sản phẩm — cũng nằm ở bàn phím dưới" },
  { key: "BTN_WALLET", label: "💳 Ví", desc: "Số dư, nạp tiền, lịch sử giao dịch" },
  { key: "BTN_MY_ORDERS", label: "📋 Đơn hàng", desc: "Đơn đã mua của khách" },
  { key: "BTN_ACCOUNT", label: "👤 Tài khoản", desc: "Thông tin cá nhân, hạng VIP" },
  { key: "BTN_REFERRAL", label: "🎁 Giới thiệu", desc: "Link mời bạn + quà giới thiệu" },
  { key: "BTN_SUPPORT", label: "🆘 Hỗ trợ", desc: "Bài hỗ trợ — cũng nằm ở bàn phím dưới" },
  { key: "BTN_CHANNEL", label: "📢 Channel", desc: "Link ngoài, chỉ hiện khi đã đặt SUPPORT_CHANNEL_URL" },
  { key: "BTN_CONTACT_ADMIN", label: "💬 Liên hệ Admin", desc: "Link ngoài, chỉ hiện khi đã đặt ADMIN_TELEGRAM" },
  { key: "BTN_LANGUAGE", label: "🌐 Ngôn ngữ", desc: "Đổi vi / en / zh — cũng nằm ở bàn phím dưới" },
];

export default function BotConfig() {
  const [activeTab, setActiveTab] = useState("config");
  const [saved, setSaved] = useState(false);
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ["settings"], queryFn: api.settings });
  const { data: botStatus, refetch: refetchStatus, isFetching: statusLoading } = useQuery({
    queryKey: ["bot-status"],
    queryFn: api.botStatus,
    staleTime: 30000,
  });

  const settings = data?.settings || data || {};

  const [form, setForm] = useState({});
  const f = (key, def = "") => form[key] ?? settings[key] ?? def;
  const set = (key, val) => setForm((p) => ({ ...p, [key]: val }));

  useEffect(() => {
    if (data) setForm(data.settings || {});
  }, [data]);

  const saveMut = useMutation({
    mutationFn: (d) => api.updateSettings(d),
    onSuccess: () => {
      qc.invalidateQueries(["settings"]);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    },
  });

  function toggleFlag(key) {
    const cur = f(key, "true");
    const next = cur === "false" ? "true" : "false";
    set(key, next);
    saveMut.mutate({ [key]: next });
  }

  function saveForm(fields) {
    const patch = {};
    fields.forEach((k) => { const v = f(k); if (v !== undefined && v !== null && v !== "") patch[k] = v; });
    if (Object.keys(patch).length) saveMut.mutate(patch);
  }

  return (
    <div className="space-y-4 pb-10">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="eyebrow text-slate-400">TELEGRAM // BOT CONFIGURATION</span>
            <span className="w-1 h-1 rounded-full bg-slate-600" />
            <span className="text-[10px] font-mono text-indigo-400">ENGINE CONTROLS</span>
          </div>
          <h1 className="text-xl font-bold text-slate-100 tracking-tight flex items-center gap-2">
            Cấu hình Bot
            {botStatus?.online ? (
              <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-300 border border-emerald-500/25 flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" /> ONLINE
              </span>
            ) : (
              <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-rose-500/10 text-rose-300 border border-rose-500/25">
                OFFLINE
              </span>
            )}
          </h1>
          <p className="text-xs text-slate-400 mt-0.5 tracking-tight">
            Quản lý hành vi, lời chào, công tắc tính năng và bàn phím tương tác của Telegram Bot
          </p>
        </div>
        {saved && (
          <span className="flex items-center gap-1.5 text-xs font-mono text-emerald-400 bg-emerald-950/40 border border-emerald-800/40 px-3 py-1.5 rounded-md">
            <CheckCircle2 size={13} /> ĐÃ LƯU THÀNH CÔNG
          </span>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        {/* Tab list sidebar - 3 cols */}
        <div className="lg:col-span-3">
          <div className="bento-card p-1.5 space-y-1">
            {TABS.map((t) => (
              <button
                key={t.key}
                onClick={() => setActiveTab(t.key)}
                className={`w-full text-left px-3 py-2 text-xs font-mono rounded-md transition-all cursor-pointer flex items-center justify-between ${
                  activeTab === t.key
                    ? "bg-indigo-600 text-white font-medium shadow-sm"
                    : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/50"
                }`}
              >
                <span>{t.label}</span>
                {activeTab === t.key && <span className="w-1.5 h-1.5 rounded-full bg-white" />}
              </button>
            ))}
          </div>
        </div>

        {/* Content panel - 9 cols */}
        <div className="lg:col-span-9">
          <div className="bento-card p-5">
            {/* ── Tab: Cấu hình Bot ── */}
            {activeTab === "config" && (
              <div className="space-y-6">
                <div>
                  <h2 className="text-xs font-mono uppercase tracking-wider text-slate-400 font-semibold mb-3">
                    THÔNG TIN HIỂN THỊ CƠ BẢN
                  </h2>
                  <div className="space-y-3.5">
                    <div>
                      <label className="text-xs font-mono text-slate-400 block mb-1">TÊN CỬA HÀNG</label>
                      <input
                        value={f("SHOP_NAME")}
                        onChange={(e) => set("SHOP_NAME", e.target.value)}
                        className="dev-input w-full px-3 py-2 text-xs font-mono"
                        placeholder="Shop Bot Tele"
                      />
                    </div>
                    <div>
                      <label className="text-xs font-mono text-slate-400 block mb-1">
                        LỜI CHÀO GREETING ({"{name}"} = tên khách)
                      </label>
                      <textarea
                        value={f("WELCOME_GREETING")}
                        onChange={(e) => set("WELCOME_GREETING", e.target.value)}
                        rows={2}
                        className="dev-input w-full px-3 py-2 text-xs font-mono resize-none"
                        placeholder="Chào {name}. Đây là bảng điều khiển mua hàng của bạn."
                      />
                    </div>
                    <button
                      onClick={() => saveForm(["SHOP_NAME", "WELCOME_GREETING"])}
                      disabled={saveMut.isPending}
                      className="flex items-center gap-1.5 px-3.5 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-md text-xs font-mono font-medium transition-colors disabled:opacity-50 cursor-pointer"
                    >
                      <Save size={13} />
                      {saveMut.isPending ? "ĐANG LƯU..." : "LƯU THAY ĐỔI"}
                    </button>
                  </div>
                </div>

                <div className="thin-divider pt-5">
                  <h2 className="text-xs font-mono uppercase tracking-wider text-slate-400 font-semibold mb-3">
                    THÔNG SỐ KỸ THUẬT BOT TELEGRAM
                  </h2>
                  <div className="space-y-2 text-xs font-mono">
                    <div className="flex items-center justify-between py-2 border-b border-slate-800/60">
                      <span className="text-slate-400">ADMIN IDS</span>
                      <code className="text-xs bg-slate-900 border border-slate-800 px-2 py-0.5 rounded text-indigo-300">
                        {settings.ADMIN_IDS || "—"}
                      </code>
                    </div>
                    <div className="flex items-center justify-between py-2 border-b border-slate-800/60">
                      <span className="text-slate-400">WEBHOOK / INGESTION</span>
                      <code className="text-xs bg-slate-900 border border-slate-800 px-2 py-0.5 rounded text-slate-300 max-w-[280px] truncate">
                        {settings.WEBHOOK_URL || "POLLING MODE (GETUPDATES)"}
                      </code>
                    </div>
                    <div className="flex items-center justify-between py-2">
                      <span className="text-slate-400">TRẠNG THÁI HIỆN TẠI</span>
                      <div className="flex items-center gap-2">
                        {botStatus?.online ? (
                          <span className="text-[11px] px-2 py-0.5 rounded bg-emerald-950/60 border border-emerald-800/50 text-emerald-300 font-medium">
                            🟢 ONLINE{botStatus.username ? ` @${botStatus.username}` : ""}
                          </span>
                        ) : botStatus ? (
                          <span className="text-[11px] px-2 py-0.5 rounded bg-rose-950/60 border border-rose-800/50 text-rose-300 font-medium">
                            🔴 OFFLINE
                          </span>
                        ) : (
                          <span className="text-xs text-slate-500">ĐANG KIỂM TRA...</span>
                        )}
                        <button
                          onClick={() => refetchStatus()}
                          disabled={statusLoading}
                          className="text-slate-400 hover:text-indigo-400 transition-colors disabled:opacity-40 cursor-pointer p-1"
                        >
                          <RefreshCw size={12} className={statusLoading ? "animate-spin" : ""} />
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* ── Tab: Tính năng ── */}
            {activeTab === "features" && (
              <div className="space-y-4">
                <div>
                  <h2 className="text-xs font-mono uppercase tracking-wider text-slate-400 font-semibold mb-1">
                    CÔNG TẮC TÍNH NĂNG // FEATURE FLAGS
                  </h2>
                  <p className="text-xs text-slate-400 tracking-tight">
                    Thay đổi có hiệu lực ngay trong runtime, không cần khởi động lại tiến trình Node.js.
                  </p>
                </div>
                <div className="divide-y divide-slate-800/60">
                  {FEATURE_FLAGS.map((feat) => {
                    const enabled = f(feat.key, "true") !== "false";
                    return (
                      <div key={feat.key} className="flex items-center justify-between py-3">
                        <div className="flex-1 pr-4">
                          <p className="text-xs font-mono font-semibold text-slate-200">{feat.label}</p>
                          <p className="text-xs text-slate-400 mt-0.5 tracking-tight">{feat.desc}</p>
                        </div>
                        <button
                          onClick={() => toggleFlag(feat.key)}
                          disabled={saveMut.isPending}
                          className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors flex-shrink-0 cursor-pointer ${
                            enabled ? "bg-indigo-600" : "bg-slate-800 border border-slate-700/60"
                          }`}
                        >
                          <span
                            className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${
                              enabled ? "translate-x-4" : "translate-x-0.5"
                            }`}
                          />
                        </button>
                      </div>
                    );
                  })}
                </div>

                {/* Low stock threshold */}
                {f("FEATURE_LOW_STOCK_ALERT", "true") !== "false" && (
                  <div className="thin-divider pt-4">
                    <label className="text-xs font-mono text-slate-400 block mb-1">NGƯỠNG CẢNH BÁO TỒN KHO THẤP</label>
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        min="1"
                        value={f("LOW_STOCK_THRESHOLD", "5")}
                        onChange={(e) => set("LOW_STOCK_THRESHOLD", e.target.value)}
                        className="dev-input w-28 px-3 py-1.5 text-xs font-mono"
                      />
                      <span className="text-xs font-mono text-slate-400">SẢN PHẨM CÒN LẠI</span>
                      <button
                        onClick={() => saveMut.mutate({ LOW_STOCK_THRESHOLD: f("LOW_STOCK_THRESHOLD", "5") })}
                        disabled={saveMut.isPending}
                        className="ml-auto flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-md text-xs font-mono font-medium transition-colors disabled:opacity-50 cursor-pointer"
                      >
                        <Save size={12} /> LƯU NGƯỠNG
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* ── Tab: Menu Buttons ── */}
            {activeTab === "menu" && (
              <div className="space-y-4">
                <div>
                  <h2 className="text-xs font-mono uppercase tracking-wider text-slate-400 font-semibold mb-1">
                    BÀN PHÍM TƯƠNG TÁC BOT // KEYBOARD BUTTONS
                  </h2>
                  <p className="text-xs text-slate-400 tracking-tight">
                    Tắt nút nào thì nút đó tự động biến mất khỏi menu chính và reply keyboard.
                  </p>
                  <p className="text-[11px] font-mono text-indigo-400 mt-1">
                    ĐANG BẬT: {MENU_BUTTONS.filter((b) => f(b.key, "true") !== "false").length}/{MENU_BUTTONS.length} NÚT
                  </p>
                </div>
                <div className="divide-y divide-slate-800/60 max-h-[520px] overflow-y-auto pr-1">
                  {MENU_BUTTONS.map((btn) => {
                    const enabled = f(btn.key, "true") !== "false";
                    return (
                      <div key={btn.key} className="flex items-center justify-between gap-4 py-2.5">
                        <div className="min-w-0">
                          <p className={`text-xs font-mono font-semibold ${enabled ? "text-slate-200" : "text-slate-500 line-through"}`}>
                            {btn.label}
                          </p>
                          {btn.desc && <p className="text-[11px] text-slate-500 tracking-tight mt-0.5">{btn.desc}</p>}
                        </div>
                        <button
                          onClick={() => toggleFlag(btn.key)}
                          disabled={saveMut.isPending}
                          className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors flex-shrink-0 cursor-pointer ${
                            enabled ? "bg-indigo-600" : "bg-slate-800 border border-slate-700/60"
                          }`}
                        >
                          <span
                            className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${
                              enabled ? "translate-x-4" : "translate-x-0.5"
                            }`}
                          />
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* ── Tab: Hoa hồng CTV ── */}
            {activeTab === "ctv" && (
              <div className="py-12 text-center space-y-3">
                <div className="w-10 h-10 rounded-md bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center mx-auto text-indigo-400 text-lg">
                  👥
                </div>
                <div>
                  <p className="text-sm font-bold text-slate-200 tracking-tight">Cấu hình Hoa hồng CTV & Giới thiệu</p>
                  <p className="text-xs text-slate-400 mt-0.5 max-w-sm mx-auto tracking-tight">
                    Tỉ lệ hoa hồng, điều kiện phát quà token API và bảng xếp hạng được quản lý tập trung tại module Affiliate.
                  </p>
                </div>
                <button
                  onClick={() => navigate("/system/referral")}
                  className="inline-flex items-center gap-1.5 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-md text-xs font-mono font-medium transition-colors cursor-pointer"
                >
                  ĐẾN TRANG QUẢN LÝ AFFILIATE →
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
