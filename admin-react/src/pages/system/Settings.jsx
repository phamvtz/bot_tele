import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Save } from "lucide-react";
import { api } from "../../api/endpoints";

const TABS = [
  { key: "shop", label: "Thông tin Cửa hàng" },
  { key: "general", label: "Cài đặt Chung" },
  { key: "security", label: "Bảo mật & Telegram" },
  { key: "theme", label: "Giao diện & Chủ đề" },
];

export default function Settings() {
  const [activeTab, setActiveTab] = useState("shop");
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ["settings"], queryFn: api.settings });
  const settings = data?.settings || data || {};
  const saveMut = useMutation({ mutationFn: api.updateSettings, onSuccess: () => qc.invalidateQueries(["settings"]) });

  const [form, setForm] = useState({});
  const f = (key) => form[key] ?? settings[key] ?? "";
  const set = (key, val) => setForm((p) => ({ ...p, [key]: val }));

  const shopInitials = (f("SHOP_NAME") || "MS").slice(0, 2).toUpperCase();

  return (
    <div>
      <h1 className="text-xl font-bold text-white mb-1">Cấu hình Hệ thống</h1>
      <p className="text-sm text-gray-500 mb-5">Quản lý hoạt động mạng lưới, giao diện, và toàn quyền kiểm soát bảo mật của hàng.</p>

      <div className="flex gap-5">
        {/* Tab list */}
        <div className="w-48 flex-shrink-0">
          <div className="glass rounded-xl border-r border-white/[0.06] overflow-hidden">
            {TABS.map((t) => (
              <button key={t.key} onClick={() => setActiveTab(t.key)}
                className={`w-full text-left px-4 py-3 text-sm border-b border-white/[0.04] last:border-0 transition-colors ${activeTab === t.key ? "bg-white/[0.08] text-white font-medium" : "text-gray-400 hover:bg-white/[0.05] hover:text-white"}`}>
                {t.label}
              </button>
            ))}
          </div>
        </div>

        {/* Panel */}
        <div className="flex-1 glass rounded-xl p-5">
          {activeTab === "shop" && (
            <div>
              <h2 className="text-sm font-semibold text-white mb-4">Cập nhật Thương hiệu</h2>
              <div className="flex items-start gap-5">
                <div className="w-16 h-16 rounded-xl bg-primary-500 flex items-center justify-center flex-shrink-0">
                  <span className="text-white text-xl font-bold">{shopInitials}</span>
                </div>
                <div className="flex-1 space-y-3">
                  <div>
                    <label className="text-xs font-medium text-gray-400 block mb-1">TÊN HIỂN THỊ</label>
                    <input value={f("SHOP_NAME")} onChange={(e) => set("SHOP_NAME", e.target.value)}
                      className="w-full glass-input rounded-lg px-3 py-2 text-sm" placeholder="mortal Shop" />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-gray-400 block mb-1">MÔ TẢ NGẮN</label>
                    <textarea value={f("SHOP_DESC")} onChange={(e) => set("SHOP_DESC", e.target.value)} rows={2} resize-none
                      className="w-full glass-input rounded-lg px-3 py-2 text-sm resize-none" placeholder="Mô tả ngắn về shop của bạn..." />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-gray-400 block mb-1">ĐƯỜNG DẪN LOGO (URL)</label>
                    <input value={f("SHOP_LOGO")} onChange={(e) => set("SHOP_LOGO", e.target.value)}
                      className="w-full glass-input rounded-lg px-3 py-2 text-sm" placeholder="https://example.com/logo.png" />
                    <p className="text-xs text-gray-400 mt-1">Khuyến dùng ảnh PNG vuông không nền, tối giản.</p>
                  </div>
                  <div>
                    <label className="text-xs font-medium text-gray-400 block mb-1">USERNAME TELEGRAM HỖ TRỢ</label>
                    <input value={f("SHOP_SUPPORT_USERNAME")} onChange={(e) => set("SHOP_SUPPORT_USERNAME", e.target.value)}
                      className="w-full glass-input rounded-lg px-3 py-2 text-sm" placeholder="@langvuongalone" />
                    <p className="text-xs text-gray-400 mt-1">Hiển thị khi giao hàng thất bại, khách cần liên hệ.</p>
                  </div>
                  <button onClick={() => saveMut.mutate(form)} disabled={saveMut.isPending}
                    className="flex items-center gap-1.5 px-4 py-2 bg-primary-500 text-white rounded-lg text-sm font-medium hover:bg-primary-600 disabled:opacity-50 transition-colors shadow-glow-sm hover:shadow-glow">
                    <Save size={14} />
                    {saveMut.isPending ? "Đang lưu..." : "Lưu"}
                  </button>
                </div>
              </div>
            </div>
          )}

          {activeTab === "general" && (
            <div>
              <h2 className="text-sm font-semibold text-white mb-4">Cài đặt Chung</h2>
              <div className="space-y-3">
                {[["CURRENCY","Đơn vị tiền tệ","VND"],["TIMEZONE","Múi giờ","Asia/Ho_Chi_Minh"],["MIN_DEPOSIT","Nạp tối thiểu","10000"]].map(([k,l,p]) => (
                  <div key={k}>
                    <label className="text-xs font-medium text-gray-400 block mb-1">{l}</label>
                    <input value={f(k)} onChange={(e) => set(k, e.target.value)}
                      className="w-full glass-input rounded-lg px-3 py-2 text-sm" placeholder={p} />
                  </div>
                ))}
                <button onClick={() => saveMut.mutate(form)} disabled={saveMut.isPending}
                  className="flex items-center gap-1.5 px-4 py-2 bg-primary-500 text-white rounded-lg text-sm font-medium hover:bg-primary-600 disabled:opacity-50 transition-colors shadow-glow-sm hover:shadow-glow">
                  <Save size={14} />
                  {saveMut.isPending ? "Đang lưu..." : "Lưu"}
                </button>
              </div>
            </div>
          )}

          {activeTab === "security" && (
            <div>
              <h2 className="text-sm font-semibold text-white mb-4">Bảo mật & Telegram</h2>
              <div className="space-y-3">
                <div>
                  <label className="text-xs font-medium text-gray-400 block mb-1">Admin Telegram IDs</label>
                  <input value={f("ADMIN_IDS")} onChange={(e) => set("ADMIN_IDS", e.target.value)}
                    className="w-full glass-input rounded-lg px-3 py-2 text-sm font-mono" placeholder="123456789,987654321" />
                  <p className="text-xs text-gray-400 mt-1">Phân cách bằng dấu phẩy. Thay đổi cần restart bot.</p>
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-400 block mb-1">Admin Secret (API token)</label>
                  <input type="password" value={f("ADMIN_SECRET")} onChange={(e) => set("ADMIN_SECRET", e.target.value)}
                    className="w-full glass-input rounded-lg px-3 py-2 text-sm font-mono" placeholder="••••••••••••••••" />
                </div>
                <button onClick={() => saveMut.mutate(form)} disabled={saveMut.isPending}
                  className="flex items-center gap-1.5 px-4 py-2 bg-primary-500 text-white rounded-lg text-sm font-medium hover:bg-primary-600 disabled:opacity-50 transition-colors shadow-glow-sm hover:shadow-glow">
                  <Save size={14} />
                  {saveMut.isPending ? "Đang lưu..." : "Lưu"}
                </button>
              </div>
            </div>
          )}

          {activeTab === "theme" && (
            <div>
              <h2 className="text-sm font-semibold text-white mb-4">Giao diện & Chủ đề</h2>
              <div className="space-y-4">
                <div className="flex items-center justify-between py-3 border-b border-white/[0.07]">
                  <div>
                    <p className="text-sm font-medium text-gray-300">Chế độ tối</p>
                    <p className="text-xs text-gray-400">Lưu tùy chọn giao diện</p>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input type="checkbox" className="sr-only peer"
                      checked={f("DARK_MODE") === "true"}
                      onChange={(e) => { set("DARK_MODE", String(e.target.checked)); saveMut.mutate({ DARK_MODE: String(e.target.checked) }); }} />
                    <div className="w-9 h-5 bg-white/[0.15] peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white/[0.2] after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-white/[0.1] after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-primary-500"></div>
                  </label>
                </div>
                <div>
                  <p className="text-sm font-medium text-gray-300 mb-2">Màu chủ đạo</p>
                  <div className="flex gap-2">
                    {["#10b981","#3b82f6","#8b5cf6","#f59e0b","#ef4444"].map((c) => (
                      <button key={c}
                        onClick={() => { set("ACCENT_COLOR", c); saveMut.mutate({ ACCENT_COLOR: c }); }}
                        className={`w-8 h-8 rounded-lg shadow-sm hover:scale-110 transition-transform ${f("ACCENT_COLOR") === c ? "ring-2 ring-offset-2 ring-white" : "border-2 border-white/20"}`}
                        style={{ backgroundColor: c }} />
                    ))}
                  </div>
                  {f("ACCENT_COLOR") && <p className="text-xs text-gray-400 mt-1">Màu đang chọn: {f("ACCENT_COLOR")}</p>}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
