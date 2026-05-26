import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { Save, RefreshCw } from "lucide-react";
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

const MENU_BUTTONS = [
  { key: "BTN_CATALOG", label: "🛍 Mua hàng / Danh mục" },
  { key: "BTN_MY_ORDERS", label: "📦 Đơn hàng của tôi" },
  { key: "BTN_WALLET", label: "💰 Ví của tôi" },
  { key: "BTN_REFERRAL", label: "👥 Giới thiệu bạn bè" },
  { key: "BTN_SUPPORT", label: "💬 Hỗ trợ / Liên hệ" },
  { key: "BTN_LANGUAGE", label: "🌐 Chọn ngôn ngữ" },
];

export default function BotConfig() {
  const [activeTab, setActiveTab] = useState("config");
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
    if (data) setForm({});
  }, [data]);

  const saveMut = useMutation({
    mutationFn: (d) => api.updateSettings(d),
    onSuccess: () => qc.invalidateQueries(["settings"]),
  });

  function toggleFlag(key) {
    const cur = f(key, "true");
    const next = cur === "false" ? "true" : "false";
    set(key, next);
    saveMut.mutate({ [key]: next });
  }

  function saveForm(fields) {
    const patch = {};
    fields.forEach((k) => { patch[k] = f(k); });
    saveMut.mutate(patch);
  }

  return (
    <div>
      <h1 className="text-xl font-bold text-white mb-1">Cấu hình Bot</h1>
      <p className="text-sm text-gray-500 mb-5">Quản lý hành vi và tính năng của Telegram Bot</p>

      <div className="flex gap-5">
        {/* Tab list */}
        <div className="w-48 flex-shrink-0">
          <div className="glass rounded-xl border-r border-white/[0.06] overflow-hidden">
            {TABS.map((t) => (
              <button key={t.key} onClick={() => setActiveTab(t.key)}
                className={`w-full text-left px-4 py-3 text-sm border-b border-white/[0.04] last:border-0 transition-colors ${activeTab === t.key ? "bg-white/[0.08] text-white font-medium" : "text-gray-400 hover:bg-white/[0.05]"}`}>
                {t.label}
              </button>
            ))}
          </div>
        </div>

        {/* Panel */}
        <div className="flex-1 glass rounded-xl p-5">

          {/* ── Tab: Cấu hình Bot ── */}
          {activeTab === "config" && (
            <div className="space-y-5">
              <div>
                <h2 className="text-sm font-semibold text-white mb-3">Thông tin hiển thị</h2>
                <div className="space-y-3">
                  <div>
                    <label className="text-xs font-medium text-gray-400 block mb-1">Tên cửa hàng</label>
                    <input value={f("SHOP_NAME")} onChange={(e) => set("SHOP_NAME", e.target.value)}
                      className="w-full glass-input rounded-lg px-3 py-2 text-sm"
                      placeholder="Shop Bot Tele" />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-gray-400 block mb-1">Lời chào ({"{name}"} = tên khách)</label>
                    <textarea value={f("WELCOME_GREETING")} onChange={(e) => set("WELCOME_GREETING", e.target.value)} rows={2}
                      className="w-full glass-input rounded-lg px-3 py-2 text-sm resize-none"
                      placeholder="Chào {name}. Đây là bảng điều khiển mua hàng của bạn." />
                  </div>
                  <button onClick={() => saveForm(["SHOP_NAME", "WELCOME_GREETING"])} disabled={saveMut.isPending}
                    className="flex items-center gap-1.5 px-4 py-2 bg-primary-500 text-white rounded-lg text-sm font-medium hover:bg-primary-600 disabled:opacity-50 transition-colors shadow-glow-sm hover:shadow-glow">
                    <Save size={14} />
                    {saveMut.isPending ? "Đang lưu..." : "Lưu"}
                  </button>
                </div>
              </div>

              <div className="border-t border-white/[0.07] pt-5">
                <h2 className="text-sm font-semibold text-white mb-3">Trạng thái Bot</h2>
                <div className="space-y-2 text-sm">
                  <div className="flex items-center justify-between py-2 border-b border-white/[0.04]">
                    <span className="text-gray-500">Admin IDs</span>
                    <code className="text-xs bg-black/40 border border-white/[0.08] px-2 py-0.5 rounded text-gray-400">{settings.ADMIN_IDS || "—"}</code>
                  </div>
                  <div className="flex items-center justify-between py-2 border-b border-white/[0.04]">
                    <span className="text-gray-500">Webhook URL</span>
                    <code className="text-xs bg-black/40 border border-white/[0.08] px-2 py-0.5 rounded text-gray-400 max-w-[240px] truncate">{settings.WEBHOOK_URL || "polling mode"}</code>
                  </div>
                  <div className="flex items-center justify-between py-2">
                    <span className="text-gray-500">Trạng thái</span>
                    <div className="flex items-center gap-2">
                      {botStatus?.online
                        ? <span className="text-xs px-2 py-0.5 rounded bg-emerald-950/60 text-emerald-300 font-medium">🟢 Online{botStatus.username ? ` @${botStatus.username}` : ""}</span>
                        : botStatus
                          ? <span className="text-xs px-2 py-0.5 rounded bg-red-950/60 text-red-400 font-medium">🔴 Offline</span>
                          : <span className="text-xs text-gray-400">Đang kiểm tra...</span>
                      }
                      <button onClick={() => refetchStatus()} disabled={statusLoading}
                        className="text-gray-400 hover:text-primary-600 transition-colors disabled:opacity-40">
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
            <div>
              <h2 className="text-sm font-semibold text-white mb-1">Bật / Tắt tính năng</h2>
              <p className="text-xs text-gray-400 mb-4">Thay đổi có hiệu lực ngay, không cần restart bot.</p>
              <div className="space-y-0">
                {FEATURE_FLAGS.map((feat, i) => {
                  const enabled = f(feat.key, "true") !== "false";
                  return (
                    <div key={feat.key} className={`flex items-center justify-between py-3.5 ${i < FEATURE_FLAGS.length - 1 ? "border-b border-white/[0.07]" : ""}`}>
                      <div className="flex-1 pr-4">
                        <p className="text-sm font-medium text-gray-800">{feat.label}</p>
                        <p className="text-xs text-gray-400 mt-0.5">{feat.desc}</p>
                      </div>
                      <button onClick={() => toggleFlag(feat.key)} disabled={saveMut.isPending}
                        className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors flex-shrink-0 ${enabled ? "bg-primary-600" : "bg-gray-200"}`}>
                        <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${enabled ? "translate-x-4" : "translate-x-0.5"}`} />
                      </button>
                    </div>
                  );
                })}
              </div>
              {/* Low stock threshold - only shown when feature enabled */}
              {f("FEATURE_LOW_STOCK_ALERT", "true") !== "false" && (
                <div className="mt-4 pt-4 border-t border-white/[0.07]">
                  <label className="text-xs font-medium text-gray-400 block mb-1">Ngưỡng cảnh báo tồn kho</label>
                  <div className="flex items-center gap-2">
                    <input type="number" min="1" value={f("LOW_STOCK_THRESHOLD", "5")}
                      onChange={(e) => set("LOW_STOCK_THRESHOLD", e.target.value)}
                      className="w-24 glass-input rounded-lg px-3 py-2 text-sm" />
                    <span className="text-xs text-gray-500">sản phẩm còn lại</span>
                    <button onClick={() => saveMut.mutate({ LOW_STOCK_THRESHOLD: f("LOW_STOCK_THRESHOLD", "5") })}
                      disabled={saveMut.isPending}
                      className="ml-auto flex items-center gap-1.5 px-3 py-2 bg-primary-500 text-white rounded-lg text-xs font-medium hover:bg-primary-600 disabled:opacity-50 transition-colors shadow-glow-sm hover:shadow-glow">
                      <Save size={12} /> Lưu
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── Tab: Menu Buttons ── */}
          {activeTab === "menu" && (
            <div>
              <h2 className="text-sm font-semibold text-white mb-1">Nút Menu Bot</h2>
              <p className="text-xs text-gray-400 mb-4">Ẩn/hiện các nút trong menu chính của bot. Thay đổi hiệu lực sau lần bấm menu tiếp theo.</p>
              <div className="space-y-0">
                {MENU_BUTTONS.map((btn, i) => {
                  const enabled = f(btn.key, "true") !== "false";
                  return (
                    <div key={btn.key} className={`flex items-center justify-between py-3.5 ${i < MENU_BUTTONS.length - 1 ? "border-b border-white/[0.07]" : ""}`}>
                      <span className="text-sm text-gray-300">{btn.label}</span>
                      <button onClick={() => toggleFlag(btn.key)} disabled={saveMut.isPending}
                        className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${enabled ? "bg-primary-600" : "bg-gray-200"}`}>
                        <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${enabled ? "translate-x-4" : "translate-x-0.5"}`} />
                      </button>
                    </div>
                  );
                })}
              </div>
              <p className="text-xs text-gray-400 mt-4">Lưu ý: bot cần đọc setting này khi user bấm /start hoặc menu. Đảm bảo bot đang online.</p>
            </div>
          )}

          {/* ── Tab: Hoa hồng CTV ── */}
          {activeTab === "ctv" && (
            <div className="py-8 text-center">
              <div className="w-12 h-12 rounded-xl bg-white/[0.05] flex items-center justify-center mx-auto mb-3">
                <span className="text-2xl">👥</span>
              </div>
              <p className="text-sm font-medium text-gray-300 mb-1">Cài đặt Hoa hồng CTV</p>
              <p className="text-xs text-gray-400 mb-4">Tỉ lệ hoa hồng, rút tối thiểu và thời hạn link được quản lý tại trang Affiliate Program.</p>
              <button onClick={() => navigate("/system/referral")}
                className="inline-flex items-center gap-1.5 px-4 py-2 bg-primary-500 text-white rounded-lg text-sm font-medium hover:bg-primary-600 transition-colors shadow-glow-sm hover:shadow-glow">
                → Đến trang Affiliate Program
              </button>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}
