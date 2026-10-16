import { useState } from "react";
import { createPortal } from "react-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ShoppingCart, X, Eye, DownloadCloud, Search, ChevronUp, ChevronDown } from "lucide-react";
import { api } from "../api/endpoints";
import TabFilter from "../components/TabFilter";
import Pagination from "../components/Pagination";
import Badge from "../components/Badge";
import EmptyState from "../components/EmptyState";
import { formatCurrency, formatDate, formatOrderCode } from "../utils/format";

const TABS = [
  { value: "", label: "Tất cả" },
  { value: "PENDING", label: "Chờ TT" },
  { value: "PAID", label: "Đã TT" },
  { value: "DELIVERING", label: "Đang giao" },
  { value: "DELIVERED", label: "Đã giao" },
  { value: "CANCELED", label: "Đã hủy" },
];

const STATUS_ACTIONS = {
  PENDING:    [
    { label: "Xác nhận đã TT", next: "PAID", color: "text-emerald-400 border-emerald-800/50 hover:bg-emerald-950/40" },
    { label: "Hủy đơn", next: "CANCELED", color: "text-rose-400 border-rose-800/50 hover:bg-rose-950/40" },
  ],
  PAID:       [
    { label: "Giao thủ công", next: "DELIVERED", color: "text-indigo-400 border-indigo-800/50 hover:bg-indigo-950/40" },
    { label: "Hủy + hoàn tiền", next: "CANCELED", refund: true, color: "text-rose-400 border-rose-800/50 hover:bg-rose-950/40" },
  ],
  DELIVERING: [
    { label: "Đánh dấu đã giao", next: "DELIVERED", color: "text-indigo-400 border-indigo-800/50 hover:bg-indigo-950/40" },
  ],
  DELIVERED:  [],
  CANCELED:   [],
};

export default function Orders() {
  const [tab, setTab] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [detail, setDetail] = useState(null);
  const [detailId, setDetailId] = useState(null);
  const { data: fullDetail } = useQuery({
    queryKey: ["order-detail", detailId],
    queryFn: () => api.order(detailId),
    enabled: !!detailId,
  });
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [sortCol, setSortCol] = useState("createdAt");
  const [sortDir, setSortDir] = useState("desc");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");

  function setPreset(days) {
    const end = new Date().toISOString().split("T")[0];
    if (days === 0) { setStartDate(end); setEndDate(end); }
    else {
      const startDateValue = new Date();
      startDateValue.setDate(startDateValue.getDate() - days);
      setStartDate(startDateValue.toISOString().split("T")[0]);
      setEndDate(end);
    }
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
    queryFn: () => api.orders({
      status: tab,
      page,
      limit: pageSize,
      sort: sortCol,
      order: sortDir,
      ...(search ? { search } : {}),
      ...(startDate ? { startDate } : {}),
      ...(endDate ? { endDate } : {}),
    }),
  });

  const [actionLoading, setActionLoading] = useState("");

  const statusMut = useMutation({
    mutationFn: ({ id, status }) => api.updateOrderStatus(id, status),
    onSuccess: () => { qc.invalidateQueries(["orders"]); qc.invalidateQueries(["order-detail"]); },
  });

  const refundMut = useMutation({
    mutationFn: ({ id, note }) => api.refundOrder(id, note),
    onSuccess: (r) => {
      qc.invalidateQueries(["orders"]); qc.invalidateQueries(["order-detail"]);
      if (r?.refunded != null) alert(`✅ Đã hoàn ${r.refunded.toLocaleString()}đ vào ví khách.`);
    },
    onError: (e) => alert("❌ Hoàn tiền lỗi: " + (e.response?.data?.error || e.message)),
  });

  const orders = data?.orders || [];
  const total = data?.total || 0;
  const totalPages = Math.ceil(total / pageSize) || 1;

  const [exporting, setExporting] = useState(false);
  async function handleExport() {
    setExporting(true);
    try {
      const blob = await api.exportOrders({
        ...(tab ? { status: tab } : {}),
        ...(startDate ? { start: startDate } : {}),
        ...(endDate ? { end: endDate } : {}),
        ...(search ? { search } : {}),
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "orders.csv";
      a.click();
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
    <div className="space-y-4 pb-10">
      {/* Header with eyebrow, tight tracking, dev toolbar */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-1">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="eyebrow text-slate-400">SALES // FULFILLMENT</span>
            <span className="w-1 h-1 rounded-full bg-slate-600" />
            <span className="text-[10px] font-mono text-indigo-400">LIVE ENGINE</span>
          </div>
          <h1 className="text-xl font-bold text-slate-100 tracking-tight flex items-center gap-2">
            Đơn hàng
            <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-indigo-500/10 text-indigo-300 border border-indigo-500/25">
              {total} ĐƠN TỔNG
            </span>
            {search && (
              <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-slate-800 text-slate-400 border border-slate-700">
                Tìm: "{search}"
              </span>
            )}
          </h1>
          <p className="text-xs text-slate-400 mt-0.5 tracking-tight">
            Theo dõi, can thiệp trạng thái, giao lại và đối soát toàn bộ đơn bán lẻ từ bot
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={handleExport}
            disabled={exporting}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800/80 hover:bg-slate-700 text-slate-200 border border-slate-700/80 rounded-lg text-xs font-mono transition-all cursor-pointer disabled:opacity-50"
          >
            <DownloadCloud size={13} />
            <span>{exporting ? "ĐANG XUẤT..." : "XUẤT CSV"}</span>
          </button>
        </div>
      </div>

      {/* Main Bento Card Container */}
      <div className="bento-card p-4 space-y-3.5">
        <TabFilter tabs={TABS} active={tab} onChange={(v) => { setTab(v); setPage(1); }} />

        {/* Dev toolbar row: Preset dates & Search */}
        <div className="flex flex-wrap items-center justify-between gap-2.5 pt-1 border-t border-slate-800/60">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-[10px] font-mono uppercase text-slate-400 tracking-wider mr-1">Lọc nhanh:</span>
            {[["HÔM NAY", 0], ["7 NGÀY", 7], ["30 NGÀY", 30]].map(([label, days]) => (
              <button
                key={label}
                onClick={() => setPreset(days)}
                className="text-[11px] font-mono px-2.5 py-1 rounded-md bg-slate-900/60 text-slate-400 hover:text-slate-200 hover:bg-slate-800 border border-slate-800 hover:border-slate-700 transition-all cursor-pointer"
              >
                {label}
              </button>
            ))}
            <input
              type="date"
              value={startDate}
              onChange={(e) => { setStartDate(e.target.value); setPage(1); }}
              className="dev-input px-2 py-1 text-xs font-mono text-slate-300 w-32"
            />
            <span className="text-slate-600 text-xs">→</span>
            <input
              type="date"
              value={endDate}
              onChange={(e) => { setEndDate(e.target.value); setPage(1); }}
              className="dev-input px-2 py-1 text-xs font-mono text-slate-300 w-32"
            />
            {(startDate || endDate) && (
              <button
                onClick={() => { setStartDate(""); setEndDate(""); setPage(1); }}
                className="text-[11px] font-mono text-slate-500 hover:text-slate-300 transition-colors ml-1"
              >
                ✕ Xóa lọc
              </button>
            )}
          </div>

          <form onSubmit={doSearch} className="flex items-center gap-1.5 ml-auto">
            <div className="relative">
              <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500" />
              <input
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                placeholder="Tìm mã đơn, tên, user..."
                className="dev-input pl-7 pr-3 py-1 text-xs w-52 font-mono"
              />
            </div>
            <button
              type="submit"
              className="px-2.5 py-1 rounded-md bg-slate-900 border border-slate-800 hover:border-slate-700 text-slate-300 text-xs font-mono transition-all cursor-pointer"
            >
              TÌM
            </button>
            {search && (
              <button
                type="button"
                onClick={() => { setSearch(""); setSearchInput(""); setPage(1); }}
                className="text-xs text-slate-500 hover:text-slate-300 font-mono ml-1"
              >
                ✕
              </button>
            )}
          </form>
        </div>

        {isLoading ? (
          <div className="py-16 text-center text-xs font-mono text-slate-500 animate-pulse">
            ĐANG TẢI DỮ LIỆU ĐƠN HÀNG...
          </div>
        ) : orders.length === 0 ? (
          <EmptyState icon={ShoppingCart} message="Chưa có đơn hàng nào khớp với điều kiện lọc" />
        ) : (
          <>
            <div className="overflow-x-auto rounded-lg border border-slate-800/80">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="bg-slate-900/60 border-b border-slate-800/80 text-[10px] font-mono text-slate-400 uppercase tracking-wider">
                    <th className="px-3.5 py-2.5 font-medium">MÃ ĐƠN</th>
                    <th className="px-3 py-2.5 font-medium">KHÁCH HÀNG</th>
                    <th className="px-3 py-2.5 font-medium">SẢN PHẨM</th>
                    <th
                      className="px-3 py-2.5 font-medium cursor-pointer select-none hover:text-slate-200 transition-colors"
                      onClick={() => toggleSort("quantity")}
                    >
                      <span className="flex items-center gap-1">
                        SL {sortCol === "quantity" ? (sortDir === "asc" ? <ChevronUp size={11} className="text-indigo-400" /> : <ChevronDown size={11} className="text-indigo-400" />) : <ChevronDown size={11} className="opacity-30" />}
                      </span>
                    </th>
                    <th
                      className="px-3 py-2.5 font-medium cursor-pointer select-none hover:text-slate-200 transition-colors"
                      onClick={() => toggleSort("finalAmount")}
                    >
                      <span className="flex items-center gap-1">
                        SỐ TIỀN {sortCol === "finalAmount" ? (sortDir === "asc" ? <ChevronUp size={11} className="text-indigo-400" /> : <ChevronDown size={11} className="text-indigo-400" />) : <ChevronDown size={11} className="opacity-30" />}
                      </span>
                    </th>
                    <th className="px-3 py-2.5 font-medium">PT THANH TOÁN</th>
                    <th className="px-3 py-2.5 font-medium">TRẠNG THÁI</th>
                    <th
                      className="px-3 py-2.5 font-medium cursor-pointer select-none hover:text-slate-200 transition-colors"
                      onClick={() => toggleSort("createdAt")}
                    >
                      <span className="flex items-center gap-1">
                        THỜI GIAN {sortCol === "createdAt" ? (sortDir === "asc" ? <ChevronUp size={11} className="text-indigo-400" /> : <ChevronDown size={11} className="text-indigo-400" />) : <ChevronDown size={11} className="opacity-30" />}
                      </span>
                    </th>
                    <th className="px-3.5 py-2.5 font-medium text-right">THAO TÁC</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60 font-sans">
                  {orders.map((o) => {
                    const actions = STATUS_ACTIONS[o.status] || [];
                    return (
                      <tr key={o.id} className="hover:bg-slate-800/30 transition-colors">
                        <td className="px-3.5 py-3 font-mono text-xs font-semibold text-indigo-400">
                          #{formatOrderCode(o.id)}
                        </td>
                        <td className="px-3 py-3 text-slate-300">
                          <div className="font-medium text-slate-200">{o.user?.firstName || "—"}</div>
                          {o.user?.telegramId && (
                            <div className="text-[11px] font-mono text-slate-500 mt-0.5">{o.user.telegramId}</div>
                          )}
                        </td>
                        <td className="px-3 py-3 text-slate-300 max-w-[180px]">
                          <span className="truncate block font-medium" title={o.product?.name}>
                            {o.product?.name || "—"}
                          </span>
                        </td>
                        <td className="px-3 py-3 font-mono text-slate-400">{o.quantity}</td>
                        <td className="px-3 py-3 font-mono font-semibold text-slate-100">
                          {formatCurrency(o.finalAmount)}
                        </td>
                        <td className="px-3 py-3">
                          <span className="font-mono text-[11px] px-2 py-0.5 rounded bg-slate-900 border border-slate-800 text-slate-400 uppercase">
                            {o.paymentMethod || "—"}
                          </span>
                        </td>
                        <td className="px-3 py-3">
                          <Badge status={o.status} />
                        </td>
                        <td className="px-3 py-3 font-mono text-[11px] text-slate-400">
                          {formatDate(o.createdAt)}
                        </td>
                        <td className="px-3.5 py-3 text-right">
                          <div className="flex items-center justify-end gap-1.5 flex-wrap">
                            <button
                              onClick={() => { setDetail(o); setDetailId(o.id); }}
                              title="Xem chi tiết"
                              className="p-1 text-slate-400 hover:text-indigo-400 hover:bg-slate-800/60 rounded border border-transparent hover:border-slate-700 transition-all cursor-pointer"
                            >
                              <Eye size={13} />
                            </button>
                            {actions.map(({ label, next, color, refund }) => (
                              <button
                                key={next}
                                onClick={() => {
                                  if (!confirm(`${label} đơn #${formatOrderCode(o.id)}?`)) return;
                                  if (refund) refundMut.mutate({ id: o.id, note: "Admin hủy + hoàn tiền" });
                                  else statusMut.mutate({ id: o.id, status: next });
                                }}
                                disabled={statusMut.isPending || refundMut.isPending}
                                className={`text-[10px] font-mono px-2 py-0.5 border rounded transition-colors disabled:opacity-50 cursor-pointer ${color}`}
                              >
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
            <Pagination
              page={page}
              totalPages={totalPages}
              total={total}
              pageSize={pageSize}
              onPage={setPage}
              onPageSize={(s) => { setPageSize(s); setPage(1); }}
            />
          </>
        )}
      </div>

      {/* Order detail Linear modal */}
      {detail && createPortal(
        <div
          className="fixed inset-0 bg-black/80 z-[9999] flex items-end sm:items-center justify-center p-4 backdrop-blur-sm animate-fade-in"
          onClick={(e) => { if (e.target === e.currentTarget) { setDetail(null); setDetailId(null); } }}
        >
          <div className="bento-card border-slate-800 w-full max-w-lg max-h-[85vh] flex flex-col shadow-2xl animate-modal-in">
            {(() => {
              const d = fullDetail || detail;
              return (
                <>
                  <div className="px-5 py-3.5 border-b border-slate-800/80 flex items-center justify-between">
                    <div>
                      <span className="eyebrow text-slate-400 block mb-0.5">ORDER SPECIFICATION</span>
                      <h2 className="font-bold text-slate-100 tracking-tight text-sm flex items-center gap-2">
                        Chi tiết đơn #{formatOrderCode(d.id)}
                        <Badge status={d.status} />
                      </h2>
                    </div>
                    <button
                      onClick={() => { setDetail(null); setDetailId(null); }}
                      className="text-slate-400 hover:text-slate-200 p-1 rounded hover:bg-slate-800/60 transition-colors cursor-pointer"
                    >
                      <X size={16} />
                    </button>
                  </div>

                  <div className="overflow-y-auto flex-1 p-5 space-y-4">
                    {/* Bento Info Grid */}
                    <div className="grid grid-cols-2 gap-2.5 text-xs">
                      {[
                        ["Khách hàng", d.user?.firstName || d.userId || "—"],
                        ["Telegram ID", d.user?.telegramId || d.chatId || "—"],
                        ["Sản phẩm", d.product?.name || "—"],
                        ["Số lượng", d.quantity],
                        ["Tổng thanh toán", formatCurrency(d.finalAmount)],
                        ["Phương thức", d.paymentMethod || "—"],
                        ["Thời gian tạo", formatDate(d.createdAt)],
                        ["Mã coupon", d.couponCode || "—"],
                      ].map(([k, v]) => (
                        <div key={k} className="p-2.5 rounded-lg bg-slate-900/60 border border-slate-800/80">
                          <p className="eyebrow text-slate-400 mb-0.5">{k}</p>
                          <p className="font-mono text-xs font-semibold text-slate-200 break-all">{String(v)}</p>
                        </div>
                      ))}
                    </div>

                    {/* Delivery content */}
                    {!fullDetail && detailId && (
                      <p className="text-xs font-mono text-slate-500 text-center py-2">Đang tải nội dung giao hàng...</p>
                    )}
                    {d.deliveryContent && (
                      <div className="space-y-1.5">
                        <span className="eyebrow text-slate-400">NỘI DUNG ĐÃ GIAO</span>
                        <pre className="bg-slate-950/90 text-emerald-400 rounded-lg p-3 text-xs overflow-x-auto whitespace-pre-wrap break-all font-mono border border-slate-800">
                          {d.deliveryContent}
                        </pre>
                      </div>
                    )}

                    {d.deliveryRef && (
                      <div className="text-xs font-mono text-slate-400">
                        Delivery ref: <code className="bg-slate-900 border border-slate-800 px-1 py-0.5 rounded text-indigo-300">{d.deliveryRef}</code>
                      </div>
                    )}

                    {/* Action buttons */}
                    {(STATUS_ACTIONS[d.status] || []).length > 0 && (
                      <div className="flex gap-2 pt-2 border-t border-slate-800/80">
                        {(STATUS_ACTIONS[d.status] || []).map(({ label, next, color, refund }) => (
                          <button
                            key={next}
                            onClick={() => {
                              if (!confirm(`${label} đơn #${formatOrderCode(d.id)}?`)) return;
                              if (refund) {
                                refundMut.mutate({ id: d.id, note: "Admin hủy + hoàn tiền" });
                                setDetail(null); setDetailId(null);
                              } else {
                                statusMut.mutate({ id: d.id, status: next });
                                setDetail((prev) => prev ? { ...prev, status: next } : null);
                              }
                            }}
                            className={`flex-1 py-2 border rounded-lg text-xs font-mono font-medium transition-colors ${color} cursor-pointer`}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                    )}

                    {/* Admin recovery actions */}
                    {["PAID", "DELIVERING"].includes(d.status) && (
                      <div className="flex gap-2 pt-2 border-t border-slate-800/80">
                        <button
                          disabled={actionLoading === "redeliver"}
                          onClick={async () => {
                            if (!confirm(`Giao lại đơn #${formatOrderCode(d.id)}?`)) return;
                            setActionLoading("redeliver");
                            try {
                              const r = await api.redeliverOrder(d.id);
                              alert(`✅ Giao lại xong — trạng thái: ${r.status}`);
                              qc.invalidateQueries(["orders"]); qc.invalidateQueries(["order-detail", d.id]);
                              setDetail(prev => prev ? { ...prev, status: r.status } : null);
                            } catch (e) { alert("❌ Lỗi: " + (e.response?.data?.error || e.message)); }
                            finally { setActionLoading(""); }
                          }}
                          className="flex-1 py-2 border rounded-lg text-xs font-mono font-medium border-indigo-800/50 text-indigo-400 hover:bg-indigo-950/40 transition-colors disabled:opacity-50 cursor-pointer"
                        >
                          {actionLoading === "redeliver" ? "ĐANG GIAO..." : "🔁 GIAO LẠI"}
                        </button>
                        <button
                          disabled={actionLoading === "refund"}
                          onClick={async () => {
                            const note = prompt(`Lý do hoàn tiền đơn #${formatOrderCode(d.id)}:`);
                            if (!note) return;
                            setActionLoading("refund");
                            try {
                              const r = await api.refundOrder(d.id, note);
                              alert(`✅ Hoàn tiền ${r.refunded?.toLocaleString()}đ — số dư mới: ${r.newBalance?.toLocaleString()}đ`);
                              qc.invalidateQueries(["orders"]); qc.invalidateQueries(["order-detail", d.id]);
                              setDetail(null); setDetailId(null);
                            } catch (e) { alert("❌ Lỗi: " + (e.response?.data?.error || e.message)); }
                            finally { setActionLoading(""); }
                          }}
                          className="flex-1 py-2 border rounded-lg text-xs font-mono font-medium border-rose-800/50 text-rose-400 hover:bg-rose-950/40 transition-colors disabled:opacity-50 cursor-pointer"
                        >
                          {actionLoading === "refund" ? "ĐANG HOÀN..." : "💰 HOÀN TIỀN"}
                        </button>
                      </div>
                    )}
                  </div>
                </>
              );
            })()}
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
