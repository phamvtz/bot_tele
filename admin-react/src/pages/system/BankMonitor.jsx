import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Landmark, RefreshCw, Clock, AlertCircle } from "lucide-react";
import { api } from "../../api/endpoints";
import StatsCard from "../../components/StatsCard";
import EmptyState from "../../components/EmptyState";
import { formatCurrency } from "../../utils/format";

function formatTxTime(when) {
  if (!when) return "—";
  const d = new Date(when);
  if (isNaN(d)) return String(when);
  return d.toLocaleString("vi-VN", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function txHighlight(content = "") {
  const up = content.toUpperCase();
  if (up.includes("NAP")) return "bg-yellow-950/40 border-yellow-800/30";
  if (up.includes("SHOP")) return "bg-purple-950/40 border-purple-800/30";
  return "border-white/[0.04]";
}

export default function BankMonitor() {
  const [recentEnabled, setRecentEnabled] = useState(false);

  const { data: statusData, isLoading: statusLoading } = useQuery({
    queryKey: ["bank-status"],
    queryFn: api.bankStatus,
    refetchInterval: 30000,
  });

  const { data: recentData, isLoading: recentLoading, refetch: refetchRecent, error: recentError } = useQuery({
    queryKey: ["bank-recent"],
    queryFn: api.bankRecent,
    enabled: recentEnabled,
    staleTime: 10000,
  });

  const status = statusData || {};
  const transactions = recentData?.transactions || [];

  return (
    <div className="space-y-4 pb-10">
      {/* Header */}
      <div>
        <div className="flex items-center gap-2 mb-1">
          <span className="eyebrow text-slate-400">BANKING // LIVE POLLER MONITOR</span>
          <span className="w-1 h-1 rounded-full bg-slate-600" />
          <span className="text-[10px] font-mono text-emerald-400">MB BANK POLLER</span>
        </div>
        <h1 className="text-xl font-bold text-slate-100 tracking-tight flex items-center gap-2">
          Theo dõi Poller Ngân hàng
          <span className={`text-[10px] font-mono px-2 py-0.5 rounded-full border flex items-center gap-1.5 ${
            status.enabled
              ? "bg-emerald-500/10 text-emerald-300 border-emerald-500/25"
              : "bg-slate-900 text-slate-500 border-slate-800"
          }`}>
            <span className={`w-1.5 h-1.5 rounded-full ${status.enabled ? "bg-emerald-400 animate-pulse" : "bg-slate-600"}`} />
            {status.enabled ? "RUNNING (15S)" : "STOPPED"}
          </span>
        </h1>
        <p className="text-xs text-slate-400 mt-0.5 tracking-tight">
          Theo dõi luồng quét lịch sử giao dịch MB Bank theo thời gian thực và tiến độ đối soát đơn hàng
        </p>
      </div>

      {/* Status card */}
      <div className="bento-card p-4">
        {statusLoading ? (
          <p className="text-xs font-mono text-slate-500 animate-pulse">ĐANG KẾT NỐI SERVER POLLER...</p>
        ) : (
          <div className="flex items-center justify-between gap-4 flex-wrap text-xs font-mono">
            <div className="flex items-center gap-3">
              <span className="text-slate-400 uppercase">TIẾN TRÌNH:</span>
              <span className={`font-bold ${status.enabled ? "text-emerald-400" : "text-slate-500"}`}>
                {status.enabled ? "POLLING HOẠT ĐỘNG LIÊN TỤC" : "ĐÃ TẮT POLLING"}
              </span>
            </div>
            {status.accountNo && (
              <div className="flex items-center gap-2 text-slate-300">
                <span className="text-slate-500">STK:</span>
                <code className="text-indigo-300 font-bold">{status.accountNo}</code>
                {status.accountName && <span className="text-slate-500">({status.accountName})</span>}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <StatsCard
          icon={AlertCircle}
          label="ĐƠN ĐANG CHỜ THANH TOÁN"
          value={statusLoading ? "…" : (status.pendingOrders ?? 0)}
          iconBg="bg-amber-950/60"
          iconColor="text-amber-400"
        />
        <StatsCard
          icon={Landmark}
          label="ĐÃ TỰ ĐỘNG XÁC NHẬN HÔM NAY"
          value={statusLoading ? "…" : (status.todayProcessed ?? 0)}
          iconBg="bg-emerald-950/60"
          iconColor="text-emerald-400"
        />
      </div>

      {/* Recent transactions */}
      <div className="bento-card p-4 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-xs font-mono font-semibold text-slate-200 flex items-center gap-2 uppercase tracking-wide">
            <Clock size={13} className="text-slate-400" />
            LỊCH SỬ GIAO DỊCH MB BANK GẦN NHẤT
          </h2>
          <button
            onClick={() => { setRecentEnabled(true); refetchRecent(); }}
            disabled={recentLoading}
            className="flex items-center gap-1.5 text-xs font-mono px-3 py-1 bg-slate-900 border border-slate-800 rounded-md text-slate-300 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
          >
            <RefreshCw size={12} className={recentLoading ? "animate-spin text-indigo-400" : "text-slate-400"} />
            {recentEnabled ? "LÀM MỚI" : "TẢI GIAO DỊCH NGÂN HÀNG"}
          </button>
        </div>

        {!recentEnabled ? (
          <p className="text-xs font-mono text-slate-500 text-center py-10">
            Nhấn "TẢI GIAO DỊCH NGÂN HÀNG" để yêu cầu gateway kéo lịch sử giao dịch mới nhất
          </p>
        ) : recentLoading ? (
          <p className="text-xs font-mono text-slate-500 text-center py-10 animate-pulse">
            ĐANG TRUY VẤN MB BANK GATEWAY...
          </p>
        ) : recentError ? (
          <div className="bg-rose-950/40 border border-rose-800/50 rounded-md p-3 text-xs font-mono text-rose-300">
            ❌ {recentError.response?.data?.error || recentError.message}
          </div>
        ) : transactions.length === 0 ? (
          <EmptyState icon={Landmark} message="Không có giao dịch ngân hàng nào gần đây" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-800/80 text-[10px] font-mono uppercase tracking-wider text-slate-400 bg-slate-900/40">
                  <th className="px-3 py-2.5">MÃ GIAO DỊCH</th>
                  <th className="px-3 py-2.5 text-right">SỐ TIỀN</th>
                  <th className="px-3 py-2.5">NỘI DUNG CHUYỂN KHOẢN</th>
                  <th className="px-3 py-2.5 text-right">THỜI GIAN</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/50 font-mono">
                {transactions.map((tx, i) => (
                  <tr key={tx.transactionId || tx.refNo || i} className="hover:bg-slate-800/25 transition-colors">
                    <td className="px-3 py-2.5 text-slate-400 text-xs">{tx.transactionId || tx.refNo || "—"}</td>
                    <td className={`px-3 py-2.5 text-right font-bold text-xs ${(tx.amount ?? 0) >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                      {tx.amount != null ? `${tx.amount >= 0 ? "+" : ""}${formatCurrency(tx.amount)}` : "—"}
                    </td>
                    <td className="px-3 py-2.5 text-slate-200 text-xs max-w-[320px]">
                      <span className="truncate block font-sans">{tx.content || "—"}</span>
                      {(tx.content || "").toUpperCase().includes("NAP") && (
                        <span className="text-amber-400 text-[10px] font-mono mt-0.5 inline-block">▶ NẠP VÍ</span>
                      )}
                      {(tx.content || "").toUpperCase().includes("SHOP") && (
                        <span className="text-indigo-400 text-[10px] font-mono mt-0.5 inline-block">▶ ĐƠN HÀNG</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-slate-500 text-right text-[11px] whitespace-nowrap">{formatTxTime(tx.when)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
