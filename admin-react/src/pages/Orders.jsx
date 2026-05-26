import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ShoppingCart, X, Eye } from "lucide-react";
import { api } from "../api/endpoints";
import TabFilter from "../components/TabFilter";
import Pagination from "../components/Pagination";
import Badge from "../components/Badge";
import EmptyState from "../components/EmptyState";
import { formatCurrency, formatDate } from "../utils/format";

const TABS = [
  { value: "", label: "Tất cả" },
  { value: "PENDING", label: "Chờ TT" },
  { value: "PAID", label: "Đã TT" },
  { value: "DELIVERING", label: "Đang giao" },
  { value: "DELIVERED", label: "Đã giao" },
  { value: "CANCELED", label: "Đã hủy" },
];

const STATUS_ACTIONS = {
  PENDING:    [{ label: "Xác nhận đã TT", next: "PAID", color: "text-green-600 border-green-200 hover:bg-green-50" }, { label: "Hủy đơn", next: "CANCELED", color: "text-red-500 border-red-200 hover:bg-red-50" }],
  PAID:       [{ label: "Giao thủ công", next: "DELIVERED", color: "text-blue-600 border-blue-200 hover:bg-blue-50" }, { label: "Hủy + hoàn tiền", next: "CANCELED", color: "text-red-500 border-red-200 hover:bg-red-50" }],
  DELIVERING: [{ label: "Đánh dấu đã giao", next: "DELIVERED", color: "text-blue-600 border-blue-200 hover:bg-blue-50" }],
  DELIVERED:  [],
  CANCELED:   [],
};

export default function Orders() {
  const [tab, setTab] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [detail, setDetail] = useState(null);
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["orders", tab, page, pageSize],
    queryFn: () => api.orders({ status: tab, page, limit: pageSize }),
  });

  const statusMut = useMutation({
    mutationFn: ({ id, status }) => api.updateOrderStatus(id, status),
    onSuccess: () => qc.invalidateQueries(["orders"]),
  });

  const orders = data?.orders || [];
  const total = data?.total || 0;
  const totalPages = Math.ceil(total / pageSize) || 1;

  return (
    <div>
      <h1 className="text-xl font-bold text-white mb-1">Đơn hàng</h1>
      <p className="text-sm text-gray-500 mb-5">{total} đơn hàng</p>

      <div className="glass rounded-xl p-4">
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
                  <tr className="border-b border-white/[0.06] text-left text-xs text-gray-500">
                    <th className="px-3 py-2.5 font-medium rounded-l-lg">Mã đơn</th>
                    <th className="px-3 py-2.5 font-medium">Khách hàng</th>
                    <th className="px-3 py-2.5 font-medium">Sản phẩm</th>
                    <th className="px-3 py-2.5 font-medium">SL</th>
                    <th className="px-3 py-2.5 font-medium">Số tiền</th>
                    <th className="px-3 py-2.5 font-medium">Thanh toán</th>
                    <th className="px-3 py-2.5 font-medium">Trạng thái</th>
                    <th className="px-3 py-2.5 font-medium">Thời gian</th>
                    <th className="px-3 py-2.5 font-medium rounded-r-lg">Hành động</th>
                  </tr>
                </thead>
                <tbody>
                  {orders.map((o) => {
                    const actions = STATUS_ACTIONS[o.status] || [];
                    return (
                      <tr key={o.id} className="border-b border-white/[0.04] hover:bg-white/[0.03] transition-colors">
                        <td className="px-3 py-3 font-mono text-xs text-primary-600">{o.id?.slice(-8).toUpperCase()}</td>
                        <td className="px-3 py-3 text-gray-800 text-xs">
                          <div>{o.user?.firstName || "—"}</div>
                          {o.user?.telegramId && <div className="text-gray-400">{o.user.telegramId}</div>}
                        </td>
                        <td className="px-3 py-3 text-gray-800 max-w-[140px] truncate text-xs">{o.product?.name || "—"}</td>
                        <td className="px-3 py-3 text-gray-600 text-xs">{o.quantity}</td>
                        <td className="px-3 py-3 font-semibold text-gray-900 text-xs">{formatCurrency(o.finalAmount)}</td>
                        <td className="px-3 py-3 text-xs text-gray-500 capitalize">{o.paymentMethod || "—"}</td>
                        <td className="px-3 py-3"><Badge status={o.status} /></td>
                        <td className="px-3 py-3 text-xs text-gray-400">{formatDate(o.createdAt)}</td>
                        <td className="px-3 py-3">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <button onClick={() => setDetail(o)} title="Xem chi tiết"
                              className="text-gray-400 hover:text-primary-600 transition-colors">
                              <Eye size={14} />
                            </button>
                            {actions.map(({ label, next, color }) => (
                              <button key={next}
                                onClick={() => { if (confirm(`${label} đơn ${o.id.slice(-8).toUpperCase()}?`)) statusMut.mutate({ id: o.id, status: next }); }}
                                disabled={statusMut.isPending}
                                className={`text-xs px-2 py-0.5 border rounded transition-colors disabled:opacity-50 ${color}`}>
                                {label}
                              </button>
                            ))}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <Pagination page={page} totalPages={totalPages} total={total} pageSize={pageSize} onPage={setPage} onPageSize={(s) => { setPageSize(s); setPage(1); }} />
          </>
        )}
      </div>

      {/* Order detail panel */}
      {detail && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-end sm:items-center justify-center p-4">
          <div className="glass-md rounded-2xl shadow-modal w-full max-w-lg max-h-[80vh] flex flex-col">
            <div className="px-5 py-4 border-b border-white/[0.07] flex items-center justify-between">
              <div>
                <h2 className="font-semibold text-white">Chi tiết đơn #{detail.id?.slice(-8).toUpperCase()}</h2>
                <p className="text-xs text-gray-400 mt-0.5">{formatDate(detail.createdAt)}</p>
              </div>
              <button onClick={() => setDetail(null)} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
            </div>

            <div className="overflow-y-auto flex-1 p-5 space-y-4">
              {/* Info grid */}
              <div className="grid grid-cols-2 gap-3 text-sm">
                {[
                  ["Khách hàng", detail.user?.firstName || detail.userId || "—"],
                  ["Telegram ID", detail.user?.telegramId || detail.chatId || "—"],
                  ["Sản phẩm", detail.product?.name || "—"],
                  ["Số lượng", detail.quantity],
                  ["Tổng tiền", formatCurrency(detail.finalAmount)],
                  ["Thanh toán", detail.paymentMethod || "—"],
                  ["Trạng thái", detail.status],
                  ["Mã coupon", detail.couponCode || "—"],
                ].map(([k, v]) => (
                  <div key={k} className="glass rounded-lg p-3">
                    <p className="text-xs text-gray-400 mb-0.5">{k}</p>
                    <p className="text-sm font-medium text-white break-all">{String(v)}</p>
                  </div>
                ))}
              </div>

              {/* Delivery content */}
              {detail.deliveryContent && (
                <div>
                  <p className="text-xs font-semibold text-gray-400 mb-1.5">Nội dung đã giao</p>
                  <pre className="bg-gray-900 text-green-400 rounded-xl p-4 text-xs overflow-x-auto whitespace-pre-wrap break-all font-mono">
                    {detail.deliveryContent}
                  </pre>
                </div>
              )}

              {/* Delivery ref */}
              {detail.deliveryRef && (
                <div>
                  <p className="text-xs text-gray-400">Delivery ref: <code className="bg-white/[0.08] px-1 rounded text-gray-300">{detail.deliveryRef}</code></p>
                </div>
              )}

              {/* Actions */}
              {(STATUS_ACTIONS[detail.status] || []).length > 0 && (
                <div className="flex gap-2 pt-2 border-t border-white/[0.07]">
                  {(STATUS_ACTIONS[detail.status] || []).map(({ label, next, color }) => (
                    <button key={next}
                      onClick={() => {
                        if (confirm(`${label} đơn ${detail.id.slice(-8).toUpperCase()}?`)) {
                          statusMut.mutate({ id: detail.id, status: next });
                          setDetail((d) => d ? { ...d, status: next } : null);
                        }
                      }}
                      className={`flex-1 py-2 border rounded-lg text-sm font-medium transition-colors ${color} transition-colors`}>
                      {label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
