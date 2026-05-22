import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ShoppingCart } from "lucide-react";
import { api } from "../api/endpoints";
import TabFilter from "../components/TabFilter";
import Pagination from "../components/Pagination";
import Badge from "../components/Badge";
import EmptyState from "../components/EmptyState";
import { formatCurrency, formatDate } from "../utils/format";

const TABS = [
  { value: "", label: "Tất cả" },
  { value: "PENDING", label: "Chờ xử lý" },
  { value: "PAID", label: "Đã thanh toán" },
  { value: "DELIVERED", label: "Đã giao" },
  { value: "CANCELED", label: "Đã hủy" },
];

export default function Orders() {
  const [tab, setTab] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  const { data, isLoading } = useQuery({
    queryKey: ["orders", tab, page, pageSize],
    queryFn: () => api.orders({ status: tab, page, limit: pageSize }),
  });

  const orders = data?.orders || [];
  const total = data?.total || 0;
  const totalPages = Math.ceil(total / pageSize) || 1;

  return (
    <div>
      <h1 className="text-xl font-bold text-gray-900 mb-1">Đơn hàng</h1>
      <p className="text-sm text-gray-500 mb-5">{total} đơn hàng</p>

      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <TabFilter tabs={TABS} active={tab} onChange={(v) => { setTab(v); setPage(1); }} />

        {isLoading ? (
          <p className="text-center py-8 text-sm text-gray-400">Đang tải...</p>
        ) : orders.length === 0 ? (
          <EmptyState icon={ShoppingCart} message="Chưa có đơn hàng nào" />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 text-left text-xs text-gray-500">
                    <th className="px-3 py-2.5 font-medium rounded-l-lg">Mã đơn</th>
                    <th className="px-3 py-2.5 font-medium">Khách hàng</th>
                    <th className="px-3 py-2.5 font-medium">Sản phẩm</th>
                    <th className="px-3 py-2.5 font-medium">SL</th>
                    <th className="px-3 py-2.5 font-medium">Số tiền</th>
                    <th className="px-3 py-2.5 font-medium">Thanh toán</th>
                    <th className="px-3 py-2.5 font-medium">Trạng thái</th>
                    <th className="px-3 py-2.5 font-medium rounded-r-lg">Thời gian</th>
                  </tr>
                </thead>
                <tbody>
                  {orders.map((o) => (
                    <tr key={o.id} className="border-b border-gray-50 hover:bg-gray-50 transition-colors">
                      <td className="px-3 py-3 font-mono text-xs text-primary-600">{o.id?.slice(-8).toUpperCase()}</td>
                      <td className="px-3 py-3 text-gray-800">{o.user?.firstName || o.userId || "—"}</td>
                      <td className="px-3 py-3 text-gray-800 max-w-[150px] truncate">{o.product?.name || "—"}</td>
                      <td className="px-3 py-3 text-gray-600">{o.quantity}</td>
                      <td className="px-3 py-3 font-semibold text-gray-900">{formatCurrency(o.finalAmount)}</td>
                      <td className="px-3 py-3 text-xs text-gray-500 capitalize">{o.paymentMethod || "—"}</td>
                      <td className="px-3 py-3"><Badge status={o.status} /></td>
                      <td className="px-3 py-3 text-xs text-gray-400">{formatDate(o.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination page={page} totalPages={totalPages} total={total} pageSize={pageSize} onPage={setPage} onPageSize={(s) => { setPageSize(s); setPage(1); }} />
          </>
        )}
      </div>
    </div>
  );
}
