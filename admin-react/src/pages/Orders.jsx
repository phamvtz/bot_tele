import { useState } from "react";
import { createPortal } from "react-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ShoppingCart, X, Eye, DownloadCloud, Search, ChevronUp, ChevronDown } from "lucide-react";
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
  PENDING:    [{ label: "Xác nhận đã TT", next: "PAID", color: "text-emerald-400 border-emerald-800/50 hover:bg-emerald-950/40" }, { label: "Hủy đơn", next: "CANCELED", color: "text-red-400 border-red-800/50 hover:bg-red-950/40" }],
  PAID:       [{ label: "Giao thủ công", next: "DELIVERED", color: "text-blue-400 border-blue-800/50 hover:bg-blue-950/40" }, { label: "Hủy + hoàn tiền", next: "CANCELED", color: "text-red-400 border-red-800/50 hover:bg-red-950/40" }],
  DELIVERING: [{ label: "Đánh dấu đã giao", next: "DELIVERED", color: "text-blue-400 border-blue-800/50 hover:bg-blue-950/40" }],
  DELIVERED:  [],
  CANCELED:   [],
};

export default function Orders() {
  const [tab, setTab] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [detail, setDetail] = useState(null);
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [sortCol, setSortCol] = useState("createdAt");
  const [sortDir, setSortDir] = useState("desc");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");

  function setPreset(days) {
    const end = new Date().toISOString().split("T")[0];
    if (days === 0) { setStartDate(end); setEndDate(end); }
    else { const start = new Date(Date.now() - days * 86400000).toISOString().split("T")[0]; setStartDate(start); setEndDate(end); }
    setPage(1);
  }
  const qc = useQueryClient();

  function toggleSort(col) {
    if (sortCol === col) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortCol(col); setSortDir("desc"); }
    setPage(1);
  }

  const { data, isLoading } = useQuery({
    queryKey: ["orders", tab, page, pageSize, search, sortCol, sortDir, startDate, endDate],
    queryFn: () => api.orders({ status: tab, page, limit: pageSize, sort: sortCol, order: sortDir, ...(search ? { search } : {}), ...(startDate ? { startDate } : {}), ...(endDate ? { endDate } : {}) }),
  });

  const statusMut = useMutation({
    mutationFn: ({ id, status }) => api.updateOrderStatus(id, status),
    onSuccess: () => qc.invalidateQueries(["orders"]),
  });

  const orders = data?.orders || [];
  const total = data?.total || 0;
  const totalPages = Math.ceil(total / pageSize) || 1;

  const [exporting, setExporting] = useState(false);
  async function handleExport() {
    setExporting(true);
    try {
      const blob = await api.exportOrders({});
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a"); a.href = url; a.download = "orders.csv"; a.click();
      URL.revokeObjectURL(url);
    } catch (e) { alert("Xuất CSV thất bại: " + e.message); }
    finally { setExporting(false); }
  }

  function doSearch(e) {
    e.preventDefault();
    setSearch(searchInput.trim());
    setPage(1);
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-xl font-bold text-white">Đơn hàng</h1>
        <div className="flex items-center gap-2">
          <form onSubmit={doSearch} className="flex items-center gap-1.5">
            <div className="relative">
              <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-500" />
              <input
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                placeholder="Tìm ID, tên, sản phẩm..."
                className="glass-input pl-7 pr-3 py-1.5 text-sm rounded-lg w-44"
              />
            </div>
            <button type="submit" className="text-sm px-2.5 py-1.5 glass rounded-lg text-gray-400 hover:text-white transition-colors">
              Tìm
            </button>
            {search && (
              <button type="button" onClick={() => { setSearch(""); setSearchInput(""); setPage(1); }}
                className="text-xs text-gray-500 hover:text-gray-300">✕</button>
            )}
          </form>
          <button onClick={handleExport} disabled={exporting}
            className="flex items-center gap-1.5 text-sm px-3 py-1.5 glass rounded-lg text-gray-400 hover:text-white disabled:opacity-50 transition-colors">
            <DownloadCloud size={14} />
            {exporting ? "Đang xuất..." : "Xuất CSV"}
          </button>
        </div>
      </div>
      <p className="text-sm text-gray-500 mb-5">{total} đơn hàng{search ? ` · tìm "${search}"` : ""}</p>

      <div className="glass rounded-xl p-4">
        <TabFilter tabs={TABS} active={tab} onChange={(v) => { setTab(v); setPage(1); }} />

        {/* Date range filter */}
        <div className="flex items-center gap-2 mt-3 mb-2 flex-wrap">
          {[["Hôm nay", 0], ["7 ngày", 7], ["30 ngày", 30]].map(([label, days]) => (
            <button key={label} onClick={() => setPreset(days)}
              className="text-xs px-2.5 py-1 rounded-lg bg-white/[0.05] text-gray-400 hover:bg-white/[0.10] hover:text-white transition-colors border border-white/[0.06]">
              {label}
            </button>
          ))}
          <input type="date" value={startDate} onChange={(e) => { setStartDate(e.target.value); setPage(1); }}
            className="glass-input rounded-lg px-2 py-1 text-xs text-gray-300 w-36" />
          <span className="text-gray-600 text-xs">→</span>
          <input type="date" value={endDate} onChange={(e) => { setEndDate(e.target.value); setPage(1); }}
            className="glass-input rounded-lg px-2 py-1 text-xs text-gray-300 w-36" />
          {(startDate || endDate) && (
            <button onClick={() => { setStartDate(""); setEndDate(""); setPage(1); }}
              className="text-xs text-gray-500 hover:text-gray-300 transition-colors">✕ Xóa</button>
          )}
        </div>

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
                    <th className="px-3 py-2.5 font-medium cursor-pointer select-none hover:text-gray-300 transition-colors" onClick={() => toggleSort("quantity")}>
                      <span className="flex items-center gap-0.5">SL{sortCol === "quantity" ? (sortDir === "asc" ? <ChevronUp size={11} className="text-primary-400" /> : <ChevronDown size={11} className="text-primary-400" />) : <ChevronDown size={11} className="opacity-30" />}</span>
                    </th>
                    <th className="px-3 py-2.5 font-medium cursor-pointer select-none hover:text-gray-300 transition-colors" onClick={() => toggleSort("finalAmount")}>
                      <span className="flex items-center gap-0.5">Số tiền{sortCol === "finalAmount" ? (sortDir === "asc" ? <ChevronUp size={11} className="text-primary-400" /> : <ChevronDown size={11} className="text-primary-400" />) : <ChevronDown size={11} className="opacity-30" />}</span>
                    </th>
                    <th className="px-3 py-2.5 font-medium">Thanh toán</th>
                    <th className="px-3 py-2.5 font-medium">Trạng thái</th>
                    <th className="px-3 py-2.5 font-medium cursor-pointer select-none hover:text-gray-300 transition-colors" onClick={() => toggleSort("createdAt")}>
                      <span className="flex items-center gap-0.5">Thời gian{sortCol === "createdAt" ? (sortDir === "asc" ? <ChevronUp size={11} className="text-primary-400" /> : <ChevronDown size={11} className="text-primary-400" />) : <ChevronDown size={11} className="opacity-30" />}</span>
                    </th>
                    <th className="px-3 py-2.5 font-medium rounded-r-lg">Hành động</th>
                  </tr>
                </thead>
                <tbody>
                  {orders.map((o) => {
                    const actions = STATUS_ACTIONS[o.status] || [];
                    return (
                      <tr key={o.id} className="border-b border-white/[0.04] hover:bg-white/[0.03] transition-colors">
                        <td className="px-3 py-3 font-mono text-xs text-primary-600">{o.id?.slice(-8).toUpperCase()}</td>
                        <td className="px-3 py-3 text-gray-300 text-xs">
                          <div>{o.user?.firstName || "—"}</div>
                          {o.user?.telegramId && <div className="text-gray-400">{o.user.telegramId}</div>}
                        </td>
                        <td className="px-3 py-3 text-gray-300 max-w-[140px] truncate text-xs">{o.product?.name || "—"}</td>
                        <td className="px-3 py-3 text-gray-600 text-xs">{o.quantity}</td>
                        <td className="px-3 py-3 font-semibold text-white text-xs">{formatCurrency(o.finalAmount)}</td>
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
      {detail && createPortal(
        <div className="fixed inset-0 bg-black/70 z-[9999] flex items-end sm:items-center justify-center p-4">
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
        </div>,
        document.body
      )}
    </div>
  );
}
