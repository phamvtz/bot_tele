import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Save, CheckCircle2 } from "lucide-react";
import { api } from "../../api/endpoints";

const TABS = [
  { key: "shop",     label: "Cửa hàng" },
  { key: "general",  label: "Cài đặt chung" },
  { key: "security", label: "Bảo mật" },
  { key: "theme",    label: "Giao diện" },
];

// Keys per tab — Lưu chỉ gửi keys của tab đang mở
const TAB_KEYS = {
  shop:     ["SHOP_NAME", "SHOP_DESC", "SHOP_LOGO", "SHOP_SUPPORT_USERNAME"],
  general:  ["CURRENCY", "TIMEZONE", "MIN_DEPOSIT"],
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
  useEffect(() => {
    if (data) setForm(data.settings || {});
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
              </div>
            </div>
          )}

          {/* ── Security Tab ── */}
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

          {/* Save button — không hiện ở theme (auto-save) */}
          {activeTab !== "theme" && (
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
