import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Building2 } from "lucide-react";
import { api } from "../api/endpoints";
import EmptyState from "../components/EmptyState";
import Pagination from "../components/Pagination";
import Badge from "../components/Badge";
import { formatCurrency, formatDate } from "../utils/format";

const FILTERS = [["Tất cả", ""], ["Chờ xử lý", "PENDING"], ["Đã thanh toán", "PAID"], ["Đã giao", "DELIVERED"], ["Đã hủy", "CANCELED"]];

export default function ResellerOrders() {
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  const { data, isLoading } = useQuery({
    queryKey: ["reseller-orders", status, page, pageSize],
    queryFn: () => api.resellerOrders({ status, page, limit: pageSize }),
  });

  const orders = data?.orders || [];
  const total = data?.total || 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div>
      <h1 className="text-xl font-bold text-white mb-1">Đơn đại lý</h1>
      <p className="text-sm text-gray-500 mb-5">Đơn hàng được tạo qua API bởi đại lý / reseller</p>

      <div className="flex items-center gap-2 mb-4 flex-wrap">
        {FILTERS.map(([label, val]) => (
          <button key={val} onClick={() => { setStatus(val); setPage(1); }}
            className={`text-xs px-2.5 py-1.5 rounded-lg border transition-colors ${status === val ? "bg-primary-600/30 border-primary-500/50 text-primary-300" : "bg-white/[0.04] border-white/[0.06] text-gray-400 hover:text-white hover:bg-white/[0.08]"}`}>
            {label}
          </button>
        ))}
      </div>

      <div className="glass rounded-xl p-4">
        {isLoading ? (
          <div className="py-14 text-center text-sm text-gray-500">Đang tải...</div>
        ) : orders.length === 0 ? (
          <EmptyState icon={Building2} message="Chưa có đơn đại lý nào" />
        ) : (
          <>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/[0.06] text-left text-xs text-gray-500">
                  <th className="px-3 py-2.5 font-medium">Mã đơn</th>
                  <th className="px-3 py-2.5 font-medium">Sản phẩm</th>
                  <th className="px-3 py-2.5 font-medium">SL</th>
                  <th className="px-3 py-2.5 font-medium">Số tiền</th>
                  <th className="px-3 py-2.5 font-medium">Telegram ID</th>
                  <th className="px-3 py-2.5 font-medium">Trạng thái</th>
                  <th className="px-3 py-2.5 font-medium">Ngày</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((o) => (
                  <tr key={o.id} className="border-b border-white/[0.04] hover:bg-white/[0.03]">
                    <td className="px-3 py-3 font-mono text-xs text-primary-400">{o.shortId}</td>
                    <td className="px-3 py-3 text-gray-200 max-w-[200px] truncate">{o.product}</td>
                    <td className="px-3 py-3 text-gray-400">{o.quantity}</td>
                    <td className="px-3 py-3 text-gray-300">{formatCurrency(o.amount)}</td>
                    <td className="px-3 py-3 font-mono text-xs text-gray-400">{o.telegramId || "—"}</td>
                    <td className="px-3 py-3"><Badge status={o.status} /></td>
                    <td className="px-3 py-3 text-xs text-gray-500">{formatDate(o.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <Pagination page={page} totalPages={totalPages} total={total} pageSize={pageSize}
              onPage={setPage} onPageSize={(s) => { setPageSize(s); setPage(1); }} />
          </>
        )}
      </div>
    </div>
  );
}
