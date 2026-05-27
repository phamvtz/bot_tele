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
    <div>
      <h1 className="text-xl font-bold text-white mb-1">Bank Monitor</h1>
      <p className="text-sm text-gray-500 mb-5">Theo dõi giao dịch ngân hàng và đơn hàng đang chờ xác nhận</p>

      {/* Status card */}
      <div className="glass rounded-xl p-5 mb-5">
        {statusLoading ? (
          <p className="text-sm text-gray-400">Đang tải...</p>
        ) : (
          <div className="flex items-center gap-4 flex-wrap">
            <div className="flex items-center gap-2">
              <div className={`w-2.5 h-2.5 rounded-full ${status.enabled ? "bg-emerald-400 shadow-[0_0_8px_#34d399]" : "bg-gray-600"}`} />
              <span className="text-sm font-medium text-white">
                Polling {status.enabled ? "đang chạy" : "đã tắt"}
              </span>
            </div>
            {status.accountNo && (
              <div className="text-sm text-gray-400">
                Tài khoản: <span className="font-mono text-white">{status.accountNo}</span>
                {status.accountName && <span className="ml-2 text-gray-500">({status.accountName})</span>}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-4 mb-5">
        <StatsCard
          icon={AlertCircle}
          label="Đơn đang chờ TT"
          value={statusLoading ? "…" : (status.pendingOrders ?? 0)}
          iconBg="bg-orange-950/60"
          iconColor="text-orange-400"
        />
        <StatsCard
          icon={Landmark}
          label="Đã xác nhận hôm nay"
          value={statusLoading ? "…" : (status.todayProcessed ?? 0)}
          iconBg="bg-emerald-950/60"
          iconColor="text-emerald-400"
        />
      </div>

      {/* Recent transactions */}
      <div className="glass rounded-xl p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-white flex items-center gap-2">
            <Clock size={14} className="text-gray-400" />
            Giao dịch gần nhất
          </h2>
          <button
            onClick={() => { setRecentEnabled(true); refetchRecent(); }}
            disabled={recentLoading}
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 glass rounded-lg text-gray-400 hover:text-white transition-colors">
            <RefreshCw size={12} className={recentLoading ? "animate-spin" : ""} />
            {recentEnabled ? "Tải lại" : "Tải giao dịch"}
          </button>
        </div>

        {!recentEnabled ? (
          <p className="text-sm text-gray-500 text-center py-8">Nhấn "Tải giao dịch" để xem giao dịch gần nhất từ ngân hàng</p>
        ) : recentLoading ? (
          <p className="text-sm text-gray-400 text-center py-8">Đang tải từ ngân hàng...</p>
        ) : recentError ? (
          <div className="bg-red-950/60 border border-red-800/50 rounded-lg px-4 py-3 text-sm text-red-400">
            ❌ {recentError.response?.data?.error || recentError.message}
          </div>
        ) : transactions.length === 0 ? (
          <EmptyState icon={Landmark} message="Không có giao dịch nào" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/[0.06] text-left text-xs text-gray-500">
                  <th className="px-3 py-2 font-medium">Mã GD</th>
                  <th className="px-3 py-2 font-medium">Số tiền</th>
                  <th className="px-3 py-2 font-medium">Nội dung</th>
                  <th className="px-3 py-2 font-medium">Thời gian</th>
                </tr>
              </thead>
              <tbody>
                {transactions.map((tx, i) => (
                  <tr key={tx.transactionId || tx.refNo || i}
                    className={`border-b ${txHighlight(tx.content)} transition-colors`}>
                    <td className="px-3 py-2.5 font-mono text-xs text-gray-400">{tx.transactionId || tx.refNo || "—"}</td>
                    <td className={`px-3 py-2.5 font-semibold text-sm ${(tx.amount ?? 0) >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                      {tx.amount != null ? `${tx.amount >= 0 ? "+" : ""}${formatCurrency(tx.amount)}` : "—"}
                    </td>
                    <td className="px-3 py-2.5 text-xs text-gray-300 max-w-[280px]">
                      <span className="truncate block">{tx.content || "—"}</span>
                      {(tx.content || "").toUpperCase().includes("NAP") && (
                        <span className="text-yellow-400 text-[10px]">▶ Nạp ví</span>
                      )}
                      {(tx.content || "").toUpperCase().includes("SHOP") && (
                        <span className="text-purple-400 text-[10px]">▶ Đơn hàng</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-xs text-gray-400 whitespace-nowrap">{formatTxTime(tx.when)}</td>
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
