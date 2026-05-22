import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Save, RefreshCw } from "lucide-react";
import { api } from "../../api/endpoints";

export default function BotConfig() {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ["settings"], queryFn: api.settings });
  const { data: botStatus, refetch: refetchStatus, isFetching: statusLoading } = useQuery({
    queryKey: ["bot-status"],
    queryFn: api.botStatus,
    staleTime: 30000,
  });
  const [shopName, setShopName] = useState("");
  const [greeting, setGreeting] = useState("");

  const settings = data?.settings || data || {};

  useEffect(() => {
    if (data) {
      setShopName(settings.SHOP_NAME || "");
      setGreeting(settings.WELCOME_GREETING || "");
    }
  }, [data]);

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
                value={shopName}
                onChange={(e) => setShopName(e.target.value)}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/30"
                placeholder="Shop Bot Tele"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-700 block mb-1">Lời chào ({"{name}"} = tên khách)</label>
              <textarea
                value={greeting}
                onChange={(e) => setGreeting(e.target.value)}
                rows={2}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/30 resize-none"
                placeholder="Chào {name}. Đây là bảng điều khiển mua hàng của bạn."
              />
            </div>
            <button
              onClick={() => saveMut.mutate({ SHOP_NAME: shopName, WELCOME_GREETING: greeting })}
              disabled={saveMut.isPending}
              className="flex items-center gap-1.5 px-4 py-2 bg-primary-500 text-white rounded-lg text-sm font-medium hover:bg-primary-600 disabled:opacity-50 transition-colors"
            >
              <Save size={14} />
              {saveMut.isPending ? "Đang lưu..." : "Lưu"}
            </button>
            {saveMut.isSuccess && <p className="text-xs text-green-600">✓ Đã lưu</p>}
          </div>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h2 className="text-sm font-semibold text-gray-900 mb-4">Thông tin Bot</h2>
          <div className="space-y-2 text-sm">
            <div className="flex items-center justify-between py-2 border-b border-gray-50">
              <span className="text-gray-500">Admin IDs</span>
              <code className="text-xs bg-gray-100 px-2 py-0.5 rounded text-gray-700">{settings.ADMIN_IDS || "—"}</code>
            </div>
            <div className="flex items-center justify-between py-2 border-b border-gray-50">
              <span className="text-gray-500">Webhook URL</span>
              <code className="text-xs bg-gray-100 px-2 py-0.5 rounded text-gray-700 max-w-[240px] truncate">{settings.WEBHOOK_URL || "polling mode"}</code>
            </div>
            <div className="flex items-center justify-between py-2">
              <span className="text-gray-500">Trạng thái</span>
              <div className="flex items-center gap-2">
                {botStatus?.online
                  ? <span className="text-xs px-2 py-0.5 rounded bg-green-100 text-green-700 font-medium">🟢 Online{botStatus.username ? ` @${botStatus.username}` : ""}</span>
                  : botStatus
                    ? <span className="text-xs px-2 py-0.5 rounded bg-red-100 text-red-600 font-medium">🔴 Offline</span>
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
    </div>
  );
}
