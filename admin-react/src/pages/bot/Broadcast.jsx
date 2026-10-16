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
    <div className="space-y-4 pb-10">
      {/* Header */}
      <div>
        <div className="flex items-center gap-2 mb-1">
          <span className="eyebrow text-slate-400">MARKETING // MASS BROADCAST</span>
          <span className="w-1 h-1 rounded-full bg-slate-600" />
          <span className="text-[10px] font-mono text-indigo-400">PUSH NOTIFICATIONS</span>
        </div>
        <h1 className="text-xl font-bold text-slate-100 tracking-tight flex items-center gap-2">
          Gửi tin hàng loạt
          <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-indigo-500/10 text-indigo-300 border border-indigo-500/25">
            {totalUsers} RECIPIENTS
          </span>
        </h1>
        <p className="text-xs text-slate-400 mt-0.5 tracking-tight">
          Soạn và gửi thông báo tức thì đến toàn bộ khách hàng hoặc phân khúc VIP trên Telegram
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
        {/* Compose panel - 3 cols */}
        <div className="lg:col-span-3 space-y-4">
          <div className="bento-card p-5 space-y-4">
            <h2 className="text-xs font-mono uppercase tracking-wider text-slate-400 font-semibold">
              SOẠN THẢO THÔNG BÁO // MESSAGE COMPOSER
            </h2>

            <div>
              <label className="text-xs font-mono text-slate-400 block mb-1">
                NỘI DUNG TIN NHẮN (HỖ TRỢ HTML TELEGRAM: &lt;b&gt;, &lt;i&gt;, &lt;code&gt;)
              </label>
              <textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                rows={6}
                placeholder={"🔔 <b>Thông báo từ Cửa hàng</b>\n\nNội dung chương trình khuyến mãi hoặc bảo trì tại đây..."}
                className="dev-input w-full px-3 py-2 text-xs font-mono resize-none leading-relaxed"
              />
              <div className="flex justify-between items-center text-[11px] font-mono text-slate-500 mt-1">
                <span>{message.length} KÝ TỰ</span>
                <span>PARSE MODE: HTML</span>
              </div>
            </div>

            {/* Target options */}
            <div className="space-y-2">
              <label className="text-[11px] font-mono uppercase tracking-wider text-slate-400 block">
                ĐỐI TƯỢNG NHẬN // TARGET AUDIENCE
              </label>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setVipOnly(false)}
                  className={`text-xs font-mono px-3 py-1.5 rounded-md border transition-all cursor-pointer flex items-center gap-2 ${
                    !vipOnly
                      ? "bg-indigo-600/20 text-indigo-300 border-indigo-500/40"
                      : "bg-slate-900/60 text-slate-400 border-slate-800 hover:text-slate-200"
                  }`}
                >
                  <Users size={12} /> TẤT CẢ ({totalUsers})
                </button>
                <button
                  type="button"
                  onClick={() => setVipOnly(true)}
                  className={`text-xs font-mono px-3 py-1.5 rounded-md border transition-all cursor-pointer flex items-center gap-2 ${
                    vipOnly
                      ? "bg-indigo-600/20 text-indigo-300 border-indigo-500/40"
                      : "bg-slate-900/60 text-slate-400 border-slate-800 hover:text-slate-200"
                  }`}
                >
                  CHỈ HẠNG VIP
                </button>
              </div>
            </div>

            {vipOnly && (
              <div className="p-3 bg-slate-900/60 rounded-md border border-slate-800/60 space-y-1.5">
                <label className="text-xs font-mono text-slate-400 block">CẤP VIP TỐI THIỂU</label>
                <select
                  value={minVip}
                  onChange={(e) => setMinVip(Number(e.target.value))}
                  className="dev-input text-xs font-mono px-3 py-1.5 rounded w-48"
                >
                  {[1, 2, 3].map((v) => (
                    <option key={v} value={v} className="bg-slate-900 text-slate-200">
                      {VIP_NAMES[v]}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* Result banner */}
            {result && (
              <div className="bg-emerald-950/40 border border-emerald-800/50 rounded-md p-3 text-xs font-mono text-emerald-300 space-y-0.5">
                <p className="font-semibold">✓ ĐÃ GỬI XONG BROADCAST</p>
                <p className="text-emerald-400/90">
                  Thành công: <b>{result.sentCount}</b> / {result.total} · Thất bại: <b>{result.failCount}</b>
                </p>
              </div>
            )}
            {sendMut.isError && (
              <div className="bg-rose-950/40 border border-rose-800/50 rounded-md p-3 text-xs font-mono text-rose-300">
                ❌ LỖI GỬI: {sendMut.error?.response?.data?.error || sendMut.error?.message}
              </div>
            )}

            <button
              onClick={() => {
                if (!message.trim()) return;
                if (!confirm(`Xác nhận gửi broadcast tới ${vipOnly ? `VIP ${minVip}+` : "tất cả khách hàng"}?`)) return;
                setResult(null);
                sendMut.mutate();
              }}
              disabled={!message.trim() || sendMut.isPending}
              className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-md text-xs font-mono font-medium transition-colors disabled:opacity-50 cursor-pointer"
            >
              <Send size={13} className={sendMut.isPending ? "animate-pulse" : ""} />
              {sendMut.isPending ? "ĐANG GỬI TIN NHẮN..." : "PHÁT BROADCAST NGAY"}
            </button>
            {sendMut.isPending && (
              <p className="text-[11px] font-mono text-amber-400 animate-pulse">
                Đang đẩy tin nhắn qua Telegram Bot API, vui lòng không tải lại trang...
              </p>
            )}
          </div>

          {/* Preview */}
          {message && (
            <div className="bento-card p-4 space-y-2.5">
              <h3 className="text-[10px] font-mono font-semibold text-slate-400 uppercase tracking-wider">
                XEM TRƯỚC BONG BÓNG TIN NHẮN // TELEGRAM PREVIEW
              </h3>
              <div
                className="bg-[#182533] border border-slate-700/50 rounded-xl rounded-tl-sm p-3.5 text-xs text-slate-100 max-w-sm leading-relaxed select-text"
                dangerouslySetInnerHTML={{ __html: message.replace(/\n/g, "<br>") }}
              />
            </div>
          )}
        </div>

        {/* History panel - 2 cols */}
        <div className="lg:col-span-2">
          <div className="bento-card p-4 space-y-3">
            <h2 className="text-xs font-mono font-semibold text-slate-300 flex items-center gap-2 uppercase tracking-wide">
              <Clock size={13} className="text-slate-400" />
              LỊCH SỬ PHÁT SÓNG
            </h2>
            {history.length === 0 ? (
              <EmptyState icon={Radio} message="Chưa có bản ghi broadcast nào" />
            ) : (
              <div className="space-y-2 max-h-[580px] overflow-y-auto pr-1">
                {history.map((h) => (
                  <div key={h.id} className="p-3 bg-slate-900/60 rounded-md border border-slate-800/60 space-y-2">
                    <p className="text-xs text-slate-300 line-clamp-2 leading-relaxed">{h.message}</p>
                    <div className="flex items-center justify-between text-[11px] font-mono pt-1 border-t border-slate-800/40">
                      <div className="flex items-center gap-1.5">
                        {h.status === "COMPLETED" ? (
                          <CheckCircle2 size={12} className="text-emerald-400" />
                        ) : (
                          <div className="w-2.5 h-2.5 rounded-full border-2 border-amber-400 border-t-transparent animate-spin" />
                        )}
                        <span className="text-emerald-400 font-semibold">{h.sentCount ?? 0} gửi</span>
                        {(h.failCount ?? 0) > 0 && (
                          <span className="text-rose-400 flex items-center gap-0.5 ml-1">
                            <XCircle size={10} />{h.failCount} lỗi
                          </span>
                        )}
                      </div>
                      <span className="text-slate-500">{formatDate(h.createdAt)}</span>
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
