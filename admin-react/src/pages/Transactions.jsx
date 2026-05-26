import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { RefreshCw, ArrowLeftRight } from "lucide-react";
import { api } from "../api/endpoints";
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

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["transactions", tab, page, pageSize, search],
    queryFn: () => api.transactions({ type: tab, page, limit: pageSize, search }),
  });

  const items = data?.transactions || [];
  const total = data?.total || 0;
  const totalPages = Math.ceil(total / pageSize) || 1;

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-xl font-bold text-white">Giao dịch</h1>
        <button onClick={() => refetch()} className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-300 transition-colors glass rounded-lg px-3 py-1.5">
          <RefreshCw size={13} />
          Làm mới
        </button>
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
                    <th className="px-3 py-2.5 font-medium">Số tiền</th>
                    <th className="px-3 py-2.5 font-medium">Mô tả</th>
                    <th className="px-3 py-2.5 font-medium rounded-r-lg">Thời gian</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((tx) => (
                    <tr key={tx.id} className="border-b border-white/[0.04] hover:bg-white/[0.03] transition-colors">
                      <td className="px-3 py-3 font-mono text-xs text-gray-600">{tx.id?.slice(-8).toUpperCase()}</td>
                      <td className="px-3 py-3 text-gray-800">{tx.user?.firstName || tx.user?.telegramId || "—"}</td>
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
