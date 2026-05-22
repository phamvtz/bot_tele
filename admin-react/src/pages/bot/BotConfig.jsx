import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Save } from "lucide-react";
import { api } from "../../api/endpoints";

export default function BotConfig() {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ["settings"], queryFn: api.settings });
  const [greeting, setGreeting] = useState("");
  const [shopName, setShopName] = useState("");
  const loaded = !!data;

  const settings = data?.settings || data || {};

  const saveMut = useMutation({
    mutationFn: (d) => api.updateSettings(d),
    onSuccess: () => qc.invalidateQueries(["settings"]),
  });

  return (
    <div>
      <h1 className="text-xl font-bold text-gray-900 mb-1">Cấu hình Bot</h1>
      <p className="text-sm text-gray-500 mb-5">Cài đặt hoạt động của Telegram Bot</p>

      <div className="grid gap-4 max-w-2xl">
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h2 className="text-sm font-semibold text-gray-900 mb-4">Thông tin cửa hàng</h2>
          <div className="space-y-3">
            <div>
              <label className="text-xs font-medium text-gray-700 block mb-1">Tên cửa hàng</label>
              <input
                defaultValue={settings.SHOP_NAME || ""}
                onBlur={(e) => setShopName(e.target.value)}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/30"
                placeholder="Shop Bot Tele"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-700 block mb-1">Lời chào ({"{name}"} = tên khách)</label>
              <textarea
                defaultValue={settings.WELCOME_GREETING || ""}
                onBlur={(e) => setGreeting(e.target.value)}
                rows={2}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/30 resize-none"
                placeholder="Chào {name}. Đây là bảng điều khiển mua hàng của bạn."
              />
            </div>
            <button
              onClick={() => saveMut.mutate({ SHOP_NAME: shopName || settings.SHOP_NAME, WELCOME_GREETING: greeting || settings.WELCOME_GREETING })}
              disabled={saveMut.isPending}
              className="flex items-center gap-1.5 px-4 py-2 bg-primary-500 text-white rounded-lg text-sm font-medium hover:bg-primary-600 disabled:opacity-50 transition-colors"
            >
              <Save size={14} />
              {saveMut.isPending ? "Đang lưu..." : "Lưu"}
            </button>
          </div>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h2 className="text-sm font-semibold text-gray-900 mb-4">Thông tin Bot</h2>
          <div className="space-y-2 text-sm">
            <div className="flex items-center justify-between py-2 border-b border-gray-50">
              <span className="text-gray-500">Admin IDs</span>
              <code className="text-xs bg-gray-100 px-2 py-0.5 rounded text-gray-700">{settings.ADMIN_IDS || process.env.ADMIN_IDS || "—"}</code>
            </div>
            <div className="flex items-center justify-between py-2 border-b border-gray-50">
              <span className="text-gray-500">Webhook URL</span>
              <code className="text-xs bg-gray-100 px-2 py-0.5 rounded text-gray-700 max-w-[240px] truncate">{settings.WEBHOOK_URL || "polling mode"}</code>
            </div>
            <div className="flex items-center justify-between py-2">
              <span className="text-gray-500">Trạng thái</span>
              <span className="text-xs px-2 py-0.5 rounded bg-green-100 text-green-700 font-medium">Online</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
