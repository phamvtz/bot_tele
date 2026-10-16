import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/endpoints";
import { RefreshCw, ArrowLeftRight, DownloadCloud, ChevronUp, ChevronDown, Undo2, LoaderCircle, AlertTriangle } from "lucide-react";
import TabFilter from "../components/TabFilter";
import SearchBar from "../components/SearchBar";
import Pagination from "../components/Pagination";
import Badge from "../components/Badge";
import EmptyState from "../components/EmptyState";
import Modal from "../components/Modal";
import { ToastContainer, useToast } from "../components/Toast";
import { formatCurrency, formatDate, formatOrderCode } from "../utils/format";

const TABS = [
  { value: "", label: "Tất cả" },
  { value: "DEPOSIT", label: "Nạp tiền" },
  { value: "PURCHASE", label: "Thanh toán" },
  { value: "REFUND,REFUND_REVERSAL", label: "Hoàn / thu hồi" },
  { value: "ADMIN_ADD,ADMIN_DEDUCT", label: "Thủ công" },
];

export default function Transactions() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [tab, setTab] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [search, setSearch] = useState("");
  const [sortCol, setSortCol] = useState("createdAt");
  const [sortDir, setSortDir] = useState("desc");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [selectedRefund, setSelectedRefund] = useState(null);

  const reverseMut = useMutation({
    mutationFn: (id) => api.reverseRefund(id),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["transactions"] });
      queryClient.invalidateQueries({ queryKey: ["users"] });
      setSelectedRefund(null);
      toast.success(result.alreadyProcessed ? "Khoản hoàn này đã được thu hồi trước đó." : "Đã thu hồi tiền hoàn về khỏi ví khách.");
    },
    onError: (error) => {
      toast.error(error.response?.data?.error || error.message || "Thu hồi tiền thất bại");
    },
  });

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

  function toggleSort(col) {
    if (sortCol === col) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortCol(col); setSortDir("desc"); }
    setPage(1);
  }

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["transactions", tab, page, pageSize, search, sortCol, sortDir, startDate, endDate],
    queryFn: () => api.transactions({
      type: tab,
      page,
      limit: pageSize,
      search,
      sort: sortCol,
      order: sortDir,
      ...(startDate ? { startDate } : {}),
      ...(endDate ? { endDate } : {}),
    }),
  });

  const items = data?.transactions || [];
  const total = data?.total || 0;
  const totalPages = Math.ceil(total / pageSize) || 1;

  const [exporting, setExporting] = useState(false);
  async function handleExport() {
    setExporting(true);
    try {
      const days = (startDate && endDate)
        ? Math.max(1, Math.ceil((new Date(endDate) - new Date(startDate)) / 86400000) + 1)
        : 30;
      const blob = await api.exportRevenue({ days });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a"); a.href = url; a.download = "revenue.csv"; a.click();
      URL.revokeObjectURL(url);
    } catch (e) { alert("Xuất CSV thất bại: " + e.message); }
    finally { setExporting(false); }
  }

  return (
    <div className="space-y-4 pb-10">
      {/* Header with eyebrow, tight tracking */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-1">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="eyebrow text-slate-400">LEDGER // TRANSACTIONS</span>
            <span className="w-1 h-1 rounded-full bg-slate-600" />
            <span className="text-[10px] font-mono text-indigo-400">AUDIT LOG</span>
          </div>
          <h1 className="text-xl font-bold text-slate-100 tracking-tight flex items-center gap-2">
            Giao dịch ví
            <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-indigo-500/10 text-indigo-300 border border-indigo-500/25">
              {total} BẢN GHI
            </span>
          </h1>
          <p className="text-xs text-slate-400 mt-0.5 tracking-tight">
            Quản lý và đối soát toàn bộ biến động số dư, nạp tiền, chi tiêu & hoàn tiền
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => refetch()}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-900/60 border border-slate-800 hover:border-slate-700 text-slate-300 text-xs font-mono transition-all cursor-pointer"
          >
            <RefreshCw size={12} className={isLoading ? "animate-spin text-indigo-400" : ""} />
            <span>LÀM MỚI</span>
          </button>
          <button
            onClick={handleExport}
            disabled={exporting}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800/80 hover:bg-slate-700 text-slate-200 border border-slate-700/80 rounded-lg text-xs font-mono transition-all cursor-pointer disabled:opacity-50"
          >
            <DownloadCloud size={12} />
            <span>{exporting ? "ĐANG XUẤT..." : "XUẤT CSV"}</span>
          </button>
        </div>
      </div>

      {/* Main Bento Card Container */}
      <div className="bento-card p-4 space-y-3.5">
        <TabFilter tabs={TABS} active={tab} onChange={(v) => { setTab(v); setPage(1); }} />

        <div className="pt-1 border-t border-slate-800/60">
          <SearchBar
            placeholder="Tìm theo mã đơn, tên, chatId..."
            value={search}
            onChange={setSearch}
            onSearch={() => setPage(1)}
          />
        </div>

        {/* Date range filter */}
        <div className="flex items-center gap-1.5 pt-1 border-t border-slate-800/60 flex-wrap">
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

        {isLoading ? (
          <div className="py-16 text-center text-xs font-mono text-slate-500 animate-pulse">
            ĐANG TẢI GIAO DỊCH...
          </div>
        ) : items.length === 0 ? (
          <EmptyState icon={ArrowLeftRight} message="Chưa có giao dịch nào khớp với điều kiện lọc" />
        ) : (
          <>
            <div className="overflow-x-auto rounded-lg border border-slate-800/80">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="bg-slate-900/60 border-b border-slate-800/80 text-[10px] font-mono text-slate-400 uppercase tracking-wider">
                    <th className="px-3.5 py-2.5 font-medium">MÃ GD</th>
                    <th className="px-3 py-2.5 font-medium">MÃ ĐƠN</th>
                    <th className="px-3 py-2.5 font-medium">NGƯỜI DÙNG</th>
                    <th className="px-3 py-2.5 font-medium">LOẠI</th>
                    <th
                      className="px-3 py-2.5 font-medium cursor-pointer select-none hover:text-slate-200 transition-colors"
                      onClick={() => toggleSort("amount")}
                    >
                      <span className="flex items-center gap-1">
                        SỐ TIỀN {sortCol === "amount" ? (sortDir === "asc" ? <ChevronUp size={11} className="text-indigo-400" /> : <ChevronDown size={11} className="text-indigo-400" />) : <ChevronDown size={11} className="opacity-30" />}
                      </span>
                    </th>
                    <th className="px-3 py-2.5 font-medium">MÔ TẢ</th>
                    <th
                      className="px-3 py-2.5 font-medium cursor-pointer select-none hover:text-slate-200 transition-colors"
                      onClick={() => toggleSort("createdAt")}
                    >
                      <span className="flex items-center gap-1">
                        THỜI GIAN {sortCol === "createdAt" ? (sortDir === "asc" ? <ChevronUp size={11} className="text-indigo-400" /> : <ChevronDown size={11} className="text-indigo-400" />) : <ChevronDown size={11} className="opacity-30" />}
                      </span>
                    </th>
                    <th className="px-3.5 py-2.5 font-medium text-right">XỬ LÝ</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60 font-sans">
                  {items.map((tx) => (
                    <tr key={tx.id} className="hover:bg-slate-800/30 transition-colors">
                      <td className="px-3.5 py-3 font-mono text-xs text-slate-400">
                        {tx.id?.slice(-8).toUpperCase()}
                      </td>
                      <td className="px-3 py-3 font-mono text-xs font-semibold text-indigo-400">
                        {tx.orderId ? `#${formatOrderCode(tx.orderId)}` : "—"}
                      </td>
                      <td className="px-3 py-3 text-slate-300">
                        <div className="font-medium">{tx.user?.firstName || "—"}</div>
                        {tx.user?.telegramId && (
                          <div className="text-[11px] font-mono text-slate-500 mt-0.5">{tx.user.telegramId}</div>
                        )}
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex items-center gap-1.5">
                          <Badge status={tx.type} />
                          {tx.isDuplicateRefund && (
                            <span className="text-[9px] font-mono uppercase px-1.5 py-0.2 rounded bg-rose-950/60 text-rose-400 border border-rose-800/40">
                              TRÙNG
                            </span>
                          )}
                        </div>
                      </td>
                      <td className={`px-3 py-3 font-mono font-semibold text-xs ${tx.amount >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                        {tx.amount >= 0 ? "+" : ""}{formatCurrency(tx.amount)}
                      </td>
                      <td className="px-3 py-3 text-slate-400 text-xs max-w-[220px] truncate">
                        {tx.description || "—"}
                      </td>
                      <td className="px-3 py-3 font-mono text-[11px] text-slate-400">
                        {formatDate(tx.createdAt)}
                      </td>
                      <td className="px-3.5 py-3 text-right">
                        {tx.type === "REFUND" && tx.status === "SUCCESS" && !tx.reversalTransactionId ? (
                          <button
                            onClick={() => setSelectedRefund(tx)}
                            title="Thu hồi khoản tiền đã hoàn"
                            aria-label="Thu hồi khoản tiền đã hoàn"
                            className="inline-flex items-center justify-center p-1.5 rounded-lg border border-rose-800/50 bg-rose-950/40 text-rose-400 hover:bg-rose-900/50 hover:text-rose-300 transition-colors cursor-pointer"
                          >
                            <Undo2 size={13} />
                          </button>
                        ) : tx.type === "REFUND" && tx.reversalTransactionId ? (
                          <span className="text-[11px] font-mono text-emerald-400 whitespace-nowrap">ĐÃ THU HỒI</span>
                        ) : (
                          <span className="text-slate-700">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
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

      {/* Confirmation Modal */}
      <Modal
        open={!!selectedRefund}
        onClose={() => !reverseMut.isPending && setSelectedRefund(null)}
        title="Xác nhận thu hồi tiền hoàn"
      >
        {selectedRefund && (
          <div className="space-y-4">
            <div className="flex gap-3 rounded-lg border border-amber-800/40 bg-amber-950/30 p-3">
              <AlertTriangle size={18} className="text-amber-400 flex-shrink-0 mt-0.5" />
              <p className="text-xs font-mono text-amber-200/90 leading-relaxed">
                {selectedRefund.isDuplicateRefund
                  ? `Khoản hoàn trùng trong ${selectedRefund.refundCountForOrder} lần hoàn của cùng một đơn. Hệ thống sẽ thu hồi đúng khoản này.`
                  : "Hệ thống sẽ trừ đúng khoản tiền này khỏi ví khách và lưu một giao dịch đối ứng. Thao tác không xóa lịch sử cũ."}
              </p>
            </div>
            <div className="p-3 rounded-lg bg-slate-900/60 border border-slate-800 grid grid-cols-2 gap-2 text-xs font-mono">
              <div>
                <span className="text-slate-500 block text-[10px] uppercase">Mã giao dịch</span>
                <span className="text-slate-300">{selectedRefund.id?.slice(-8).toUpperCase()}</span>
              </div>
              <div>
                <span className="text-slate-500 block text-[10px] uppercase">Mã đơn</span>
                <span className="text-indigo-400">#{formatOrderCode(selectedRefund.orderId)}</span>
              </div>
              <div>
                <span className="text-slate-500 block text-[10px] uppercase">Khách hàng</span>
                <span className="text-slate-300">{selectedRefund.user?.firstName || selectedRefund.user?.telegramId || "—"}</span>
              </div>
              <div>
                <span className="text-slate-500 block text-[10px] uppercase">Thu hồi</span>
                <span className="font-semibold text-rose-400">{formatCurrency(selectedRefund.amount)}</span>
              </div>
            </div>
            {(selectedRefund.wallet?.balance || 0) < selectedRefund.amount && (
              <p className="text-xs font-mono text-rose-400">
                Số dư ví hiện không đủ. Bạn cần điều chỉnh ví khách trước khi thu hồi.
              </p>
            )}
            <div className="flex justify-end gap-2 pt-2 border-t border-slate-800">
              <button
                onClick={() => setSelectedRefund(null)}
                disabled={reverseMut.isPending}
                className="px-3 py-1.5 text-xs font-mono rounded-lg border border-slate-800 text-slate-400 hover:text-white disabled:opacity-50 cursor-pointer"
              >
                HỦY
              </button>
              <button
                onClick={() => reverseMut.mutate(selectedRefund.id)}
                disabled={reverseMut.isPending || (selectedRefund.wallet?.balance || 0) < selectedRefund.amount}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-mono rounded-lg bg-rose-600 hover:bg-rose-500 text-white disabled:opacity-50 cursor-pointer"
              >
                {reverseMut.isPending ? <LoaderCircle size={13} className="animate-spin" /> : <Undo2 size={13} />}
                <span>THU HỒI TIỀN</span>
              </button>
            </div>
          </div>
        )}
      </Modal>
      <ToastContainer toasts={toast.toasts} onRemove={toast.removeToast} />
    </div>
  );
}
