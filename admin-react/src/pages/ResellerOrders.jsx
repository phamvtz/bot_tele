import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Building2, RefreshCw } from "lucide-react";
import { api } from "../api/endpoints";
import EmptyState from "../components/EmptyState";
import Pagination from "../components/Pagination";
import Badge from "../components/Badge";
import { formatCurrency, formatDate } from "../utils/format";

const FILTERS = [
  ["TẤT CẢ", ""],
  ["CHỜ XỬ LÝ", "PENDING"],
  ["ĐÃ THANH TOÁN", "PAID"],
  ["ĐÃ GIAO", "DELIVERED"],
  ["ĐÃ HỦY", "CANCELED"],
];

export default function ResellerOrders() {
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ["reseller-orders", status, page, pageSize],
    queryFn: () => api.resellerOrders({ status, page, limit: pageSize }),
  });

  const orders = data?.orders || [];
  const total = data?.total || 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="space-y-4 pb-10">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="eyebrow text-slate-400">RESELLERS // API ORDERS</span>
            <span className="w-1 h-1 rounded-full bg-slate-600" />
            <span className="text-[10px] font-mono text-indigo-400">PARTNER FLOW</span>
          </div>
          <h1 className="text-xl font-bold text-slate-100 tracking-tight flex items-center gap-2">
            Đơn đại lý
            <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-indigo-500/10 text-indigo-300 border border-indigo-500/25">
              {total} ĐƠN
            </span>
          </h1>
          <p className="text-xs text-slate-400 mt-0.5 tracking-tight">
            Đơn hàng được khởi tạo tự động từ xa thông qua Reseller API
          </p>
        </div>
        <button
          onClick={() => refetch()}
          disabled={isFetching}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-slate-900 border border-slate-800 text-xs font-mono text-slate-300 hover:text-white hover:bg-slate-800 transition-colors disabled:opacity-50 cursor-pointer"
        >
          <RefreshCw size={12} className={isFetching ? "animate-spin text-indigo-400" : "text-slate-400"} />
          LÀM MỚI
        </button>
      </div>

      {/* Main Bento Card */}
      <div className="bento-card p-4 space-y-4">
        {/* Filters */}
        <div className="flex items-center gap-1.5 flex-wrap">
          {FILTERS.map(([label, val]) => (
            <button
              key={val}
              onClick={() => { setStatus(val); setPage(1); }}
              className={`text-[11px] font-mono px-2.5 py-1 rounded-md border transition-all cursor-pointer ${
                status === val
                  ? "bg-indigo-500/15 text-indigo-300 border-indigo-500/30"
                  : "bg-slate-900/60 text-slate-400 border-slate-800 hover:text-slate-200 hover:bg-slate-800"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Content Table */}
        {isLoading ? (
          <div className="py-16 text-center text-xs font-mono text-slate-500 animate-pulse">
            ĐANG TẢI ĐƠN ĐẠI LÝ...
          </div>
        ) : orders.length === 0 ? (
          <EmptyState icon={Building2} message="Chưa có đơn hàng nào từ đại lý" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-800/80 text-[10px] font-mono uppercase tracking-wider text-slate-400 bg-slate-900/40">
                  <th className="px-3 py-2.5">MÃ ĐƠN</th>
                  <th className="px-3 py-2.5">SẢN PHẨM</th>
                  <th className="px-3 py-2.5 text-center">SL</th>
                  <th className="px-3 py-2.5 text-right">SỐ TIỀN</th>
                  <th className="px-3 py-2.5">TELEGRAM ID</th>
                  <th className="px-3 py-2.5">TRẠNG THÁI</th>
                  <th className="px-3 py-2.5 text-right">THỜI GIAN</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/50">
                {orders.map((o) => (
                  <tr key={o.id} className="hover:bg-slate-800/30 transition-colors">
                    <td className="px-3 py-2.5 font-mono text-indigo-400 font-semibold">{o.shortId}</td>
                    <td className="px-3 py-2.5 text-slate-200 font-medium max-w-[220px] truncate">{o.product}</td>
                    <td className="px-3 py-2.5 text-center font-mono text-slate-300">{o.quantity}</td>
                    <td className="px-3 py-2.5 text-right font-mono font-semibold text-slate-200">{formatCurrency(o.amount)}</td>
                    <td className="px-3 py-2.5 font-mono text-slate-400">{o.telegramId || "—"}</td>
                    <td className="px-3 py-2.5"><Badge status={o.status} /></td>
                    <td className="px-3 py-2.5 text-right font-mono text-[11px] text-slate-500">{formatDate(o.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="pt-2">
              <Pagination
                page={page}
                totalPages={totalPages}
                total={total}
                pageSize={pageSize}
                onPage={setPage}
                onPageSize={(s) => { setPageSize(s); setPage(1); }}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
