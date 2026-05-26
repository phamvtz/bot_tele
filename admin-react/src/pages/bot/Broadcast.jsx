import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Radio, Send, Users, Clock, CheckCircle2, XCircle } from "lucide-react";
import { api } from "../../api/endpoints";
import EmptyState from "../../components/EmptyState";
import { formatDate } from "../../utils/format";

const VIP_NAMES = ["Tất cả VIP", "VIP Bạc+", "VIP Vàng+", "VIP Kim Cương"];

export default function Broadcast() {
  const [message, setMessage] = useState("");
  const [vipOnly, setVipOnly] = useState(false);
  const [minVip, setMinVip] = useState(1);
  const [result, setResult] = useState(null);

  const { data: usersData } = useQuery({
    queryKey: ["users-count"],
    queryFn: () => api.users({ limit: 1 }),
  });
  const { data: historyData, refetch: refetchHistory } = useQuery({
    queryKey: ["broadcast-history"],
    queryFn: api.broadcastHistory,
  });

  const sendMut = useMutation({
    mutationFn: () => api.sendBroadcast({ message, vipOnly, minVip }),
    onSuccess: (data) => {
      setResult(data);
      setMessage("");
      refetchHistory();
    },
  });

  const totalUsers = usersData?.total ?? "—";
  const history = historyData?.history || [];

  return (
    <div>
      <h1 className="text-xl font-bold text-white mb-1">Broadcast</h1>
      <p className="text-sm text-gray-500 mb-5">Gửi thông báo hàng loạt đến người dùng Telegram</p>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-5">
        {/* Compose panel */}
        <div className="lg:col-span-3 space-y-4">
          <div className="glass rounded-xl p-5">
            <h2 className="text-sm font-semibold text-white mb-4">Soạn tin nhắn</h2>

            <div className="mb-3">
              <label className="text-xs font-medium text-gray-400 block mb-1">Nội dung (hỗ trợ HTML Telegram)</label>
              <textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                rows={6}
                placeholder={"🔔 <b>Thông báo</b>\n\nNội dung tin nhắn tại đây..."}
                className="w-full glass-input rounded-lg px-3 py-2 text-sm font-mono resize-none"
              />
              <p className="text-xs text-gray-600 mt-1">{message.length} ký tự</p>
            </div>

            {/* Target options */}
            <div className="flex items-center gap-4 mb-4">
              <label className="flex items-center gap-2 cursor-pointer">
                <div
                  onClick={() => setVipOnly(false)}
                  className={`w-4 h-4 rounded-full border-2 flex items-center justify-center cursor-pointer ${!vipOnly ? "border-primary-500 bg-primary-500" : "border-gray-600"}`}>
                  {!vipOnly && <div className="w-1.5 h-1.5 rounded-full bg-white" />}
                </div>
                <span className="text-sm text-gray-300 flex items-center gap-1.5">
                  <Users size={13} />
                  Tất cả users
                  <span className="text-xs text-gray-500">({totalUsers})</span>
                </span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <div
                  onClick={() => setVipOnly(true)}
                  className={`w-4 h-4 rounded-full border-2 flex items-center justify-center cursor-pointer ${vipOnly ? "border-primary-500 bg-primary-500" : "border-gray-600"}`}>
                  {vipOnly && <div className="w-1.5 h-1.5 rounded-full bg-white" />}
                </div>
                <span className="text-sm text-gray-300">Chỉ VIP</span>
              </label>
            </div>

            {vipOnly && (
              <div className="mb-4">
                <label className="text-xs font-medium text-gray-400 block mb-1">Cấp VIP tối thiểu</label>
                <select value={minVip} onChange={(e) => setMinVip(Number(e.target.value))}
                  className="glass-input rounded-lg px-3 py-2 text-sm">
                  {[1, 2, 3].map((v) => (
                    <option key={v} value={v}>{VIP_NAMES[v]}</option>
                  ))}
                </select>
              </div>
            )}

            {/* Result banner */}
            {result && (
              <div className="mb-4 bg-emerald-950/60 border border-emerald-800/50 rounded-lg px-4 py-3 text-sm text-emerald-300">
                ✓ Đã gửi <b>{result.sentCount}</b> / {result.total} — thất bại: {result.failCount}
              </div>
            )}
            {sendMut.isError && (
              <div className="mb-4 bg-red-950/60 border border-red-800/50 rounded-lg px-4 py-3 text-sm text-red-400">
                ❌ {sendMut.error?.response?.data?.error || sendMut.error?.message}
              </div>
            )}

            <button
              onClick={() => {
                if (!message.trim()) return;
                if (!confirm(`Gửi broadcast đến ${vipOnly ? `VIP ${minVip}+` : "tất cả users"}?`)) return;
                setResult(null);
                sendMut.mutate();
              }}
              disabled={!message.trim() || sendMut.isPending}
              className="flex items-center gap-2 px-5 py-2.5 bg-primary-500 text-white rounded-lg text-sm font-medium hover:bg-primary-600 disabled:opacity-50 transition-colors shadow-glow-sm hover:shadow-glow">
              <Send size={14} className={sendMut.isPending ? "animate-pulse" : ""} />
              {sendMut.isPending ? "Đang gửi..." : "Gửi ngay"}
            </button>
            {sendMut.isPending && (
              <p className="text-xs text-gray-500 mt-2">Đang gửi, vui lòng không đóng trang này...</p>
            )}
          </div>

          {/* Preview */}
          {message && (
            <div className="glass rounded-xl p-5">
              <h3 className="text-xs font-semibold text-gray-400 mb-3 uppercase tracking-wide">Xem trước</h3>
              <div className="bg-[#212121] rounded-2xl rounded-tl-sm px-4 py-3 text-sm text-white max-w-sm"
                dangerouslySetInnerHTML={{ __html: message.replace(/\n/g, "<br>") }} />
            </div>
          )}
        </div>

        {/* History panel */}
        <div className="lg:col-span-2">
          <div className="glass rounded-xl p-5">
            <h2 className="text-sm font-semibold text-white mb-4 flex items-center gap-2">
              <Clock size={14} className="text-gray-400" />
              Lịch sử broadcast
            </h2>
            {history.length === 0 ? (
              <EmptyState icon={Radio} message="Chưa có broadcast nào" />
            ) : (
              <div className="space-y-3">
                {history.map((h) => (
                  <div key={h.id} className="glass rounded-lg p-3">
                    <p className="text-xs text-gray-300 line-clamp-2 mb-2">{h.message}</p>
                    <div className="flex items-center justify-between text-xs">
                      <div className="flex items-center gap-2">
                        {h.status === "COMPLETED" ? (
                          <CheckCircle2 size={12} className="text-emerald-400" />
                        ) : (
                          <div className="w-3 h-3 rounded-full border-2 border-yellow-400 border-t-transparent animate-spin" />
                        )}
                        <span className="text-emerald-400">{h.sentCount ?? 0} gửi</span>
                        {(h.failCount ?? 0) > 0 && (
                          <span className="text-red-400 flex items-center gap-1">
                            <XCircle size={11} />{h.failCount} lỗi
                          </span>
                        )}
                      </div>
                      <span className="text-gray-500">{formatDate(h.createdAt)}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
