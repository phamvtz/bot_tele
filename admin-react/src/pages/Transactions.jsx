import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api/endpoints";
import { RefreshCw, ArrowLeftRight, DownloadCloud, ChevronUp, ChevronDown } from "lucide-react";
import TabFilter from "../components/TabFilter";
import SearchBar from "../components/SearchBar";
import Pagination from "../components/Pagination";
import Badge from "../components/Badge";
import EmptyState from "../components/EmptyState";
import { formatCurrency, formatDate } from "../utils/format";

const TABS = [
  { value: "", label: "Tất cả" },
  { value: "DEPOSIT", label: "Nạp tiền" },
  { value: "PURCHASE", label: "Thanh toán" },
  { value: "ADMIN_ADD,ADMIN_DEDUCT", label: "Thủ công" },
];

export default function Transactions() {
  const [tab, setTab] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [search, setSearch] = useState("");
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

  function toggleSort(col) {
    if (sortCol === col) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortCol(col); setSortDir("desc"); }
    setPage(1);
  }

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["transactions", tab, page, pageSize, search, sortCol, sortDir, startDate, endDate],
    queryFn: () => api.transactions({ type: tab, page, limit: pageSize, search, sort: sortCol, order: sortDir, ...(startDate ? { startDate } : {}), ...(endDate ? { endDate } : {}) }),
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
    <div>
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-xl font-bold text-white">Giao dịch</h1>
        <div className="flex items-center gap-2">
          <button onClick={handleExport} disabled={exporting}
            className="flex items-center gap-1.5 text-sm px-3 py-1.5 glass rounded-lg text-gray-400 hover:text-white disabled:opacity-50 transition-colors">
            <DownloadCloud size={13} />
            {exporting ? "Đang xuất..." : "Xuất CSV"}
          </button>
          <button onClick={() => refetch()} className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-300 transition-colors glass rounded-lg px-3 py-1.5">
            <RefreshCw size={13} />
            Làm mới
          </button>
        </div>
      </div>
      <p className="text-sm text-gray-500 mb-5">Quản lý tất cả giao dịch nạp tiền, thanh toán đơn hàng</p>

      <div className="glass rounded-xl p-4">
        <TabFilter tabs={TABS} active={tab} onChange={(v) => { setTab(v); setPage(1); }} />
        <SearchBar
          placeholder="Tìm theo mã đơn, tên, chatId..."
          value={search}
          onChange={setSearch}
          onSearch={() => setPage(1)}
        />

        {/* Date range filter */}
        <div className="flex items-center gap-2 mt-1 mb-3 flex-wrap">
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
        ) : items.length === 0 ? (
          <EmptyState icon={ArrowLeftRight} message="Chưa có giao dịch nào" />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-white/[0.06] text-left text-xs text-gray-500">
                    <th className="px-3 py-2.5 font-medium rounded-l-lg">Mã giao dịch</th>
                    <th className="px-3 py-2.5 font-medium">Người dùng</th>
                    <th className="px-3 py-2.5 font-medium">Loại</th>
                    <th className="px-3 py-2.5 font-medium cursor-pointer select-none hover:text-gray-300 transition-colors" onClick={() => toggleSort("amount")}>
                      <span className="flex items-center gap-0.5">Số tiền{sortCol === "amount" ? (sortDir === "asc" ? <ChevronUp size={11} className="text-primary-400" /> : <ChevronDown size={11} className="text-primary-400" />) : <ChevronDown size={11} className="opacity-30" />}</span>
                    </th>
                    <th className="px-3 py-2.5 font-medium">Mô tả</th>
                    <th className="px-3 py-2.5 font-medium cursor-pointer select-none hover:text-gray-300 transition-colors rounded-r-lg" onClick={() => toggleSort("createdAt")}>
                      <span className="flex items-center gap-0.5">Thời gian{sortCol === "createdAt" ? (sortDir === "asc" ? <ChevronUp size={11} className="text-primary-400" /> : <ChevronDown size={11} className="text-primary-400" />) : <ChevronDown size={11} className="opacity-30" />}</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((tx) => (
                    <tr key={tx.id} className="border-b border-white/[0.04] hover:bg-white/[0.03] transition-colors">
                      <td className="px-3 py-3 font-mono text-xs text-gray-400">{tx.id?.slice(-8).toUpperCase()}</td>
                      <td className="px-3 py-3 text-gray-300">{tx.user?.firstName || tx.user?.telegramId || "—"}</td>
                      <td className="px-3 py-3"><Badge status={tx.type} /></td>
                      <td className={`px-3 py-3 font-semibold ${tx.amount >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                        {tx.amount >= 0 ? "+" : ""}{formatCurrency(tx.amount)}
                      </td>
                      <td className="px-3 py-3 text-gray-500 text-xs max-w-[200px] truncate">{tx.description || "—"}</td>
                      <td className="px-3 py-3 text-xs text-gray-400">{formatDate(tx.createdAt)}</td>
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
