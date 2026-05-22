import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Eye, PlusCircle, MinusCircle, Ban, Users } from "lucide-react";
import { api } from "../api/endpoints";
import SearchBar from "../components/SearchBar";
import Pagination from "../components/Pagination";
import EmptyState from "../components/EmptyState";
import Modal from "../components/Modal";
import { formatCurrency, formatDate } from "../utils/format";

const SORT_OPTIONS = [
  { value: "newest", label: "Mới nhất" },
  { value: "balance", label: "Số dư cao nhất" },
  { value: "spent", label: "Chi nhiều nhất" },
];

export default function Customers() {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState("newest");
  const [walletModal, setWalletModal] = useState(null);
  const [walletAmount, setWalletAmount] = useState("");
  const [walletNote, setWalletNote] = useState("");
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["users", page, pageSize, search, sort],
    queryFn: () => api.users({ page, limit: pageSize, search, sort }),
  });

  const adjustMut = useMutation({
    mutationFn: ({ id, amount, note }) => api.adjustWallet(id, { amount, note }),
    onSuccess: () => { qc.invalidateQueries(["users"]); setWalletModal(null); setWalletAmount(""); setWalletNote(""); },
  });

  const users = data?.users || [];
  const total = data?.total || 0;
  const totalPages = Math.ceil(total / pageSize) || 1;

  return (
    <div>
      <h1 className="text-xl font-bold text-gray-900 mb-1">Khách Hàng</h1>
      <p className="text-sm text-gray-500 mb-5">{total} khách hàng</p>

      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <SearchBar
          placeholder="Tìm theo Chat ID, Username..."
          value={search}
          onChange={setSearch}
          onSearch={() => setPage(1)}
          sortOptions={SORT_OPTIONS}
          sortValue={sort}
          onSort={(v) => { setSort(v); setPage(1); }}
        />

        {isLoading ? (
          <p className="text-center py-8 text-sm text-gray-400">Đang tải...</p>
        ) : users.length === 0 ? (
          <EmptyState icon={Users} message="Chưa có khách hàng nào" />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 text-left text-gray-500 text-xs">
                    <th className="px-3 py-2.5 font-medium rounded-l-lg">Chat ID</th>
                    <th className="px-3 py-2.5 font-medium">Tên</th>
                    <th className="px-3 py-2.5 font-medium">Số dư</th>
                    <th className="px-3 py-2.5 font-medium">Đã chi</th>
                    <th className="px-3 py-2.5 font-medium">Đơn hàng</th>
                    <th className="px-3 py-2.5 font-medium">Hoạt động cuối</th>
                    <th className="px-3 py-2.5 font-medium rounded-r-lg">Hành động</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((u) => (
                    <tr key={u.id} className="border-b border-gray-50 hover:bg-gray-50 transition-colors">
                      <td className="px-3 py-3 font-mono text-xs text-primary-600">{u.telegramId}</td>
                      <td className="px-3 py-3">
                        <div className="font-medium text-gray-900">{u.firstName || u.lastName ? [u.firstName, u.lastName].filter(Boolean).join(" ") : "—"}</div>
                        {u.username && <div className="text-xs text-gray-400">@{u.username}</div>}
                      </td>
                      <td className="px-3 py-3 text-gray-800">{formatCurrency(u.wallet?.balance ?? 0)}</td>
                      <td className="px-3 py-3 text-gray-800">{formatCurrency(u.totalSpent ?? 0)}</td>
                      <td className="px-3 py-3 text-gray-800">{u._count?.orders ?? 0}</td>
                      <td className="px-3 py-3 text-xs text-gray-400">{formatDate(u.updatedAt)}</td>
                      <td className="px-3 py-3">
                        <div className="flex items-center gap-2">
                          <button className="text-gray-400 hover:text-gray-700 transition-colors" title="Chi tiết">
                            <Eye size={15} />
                          </button>
                          <button
                            className="text-green-500 hover:text-green-700 transition-colors"
                            title="Cộng ví"
                            onClick={() => setWalletModal({ user: u, type: "add" })}
                          >
                            <PlusCircle size={15} />
                          </button>
                          <button
                            className="text-red-400 hover:text-red-600 transition-colors"
                            title="Trừ ví"
                            onClick={() => setWalletModal({ user: u, type: "deduct" })}
                          >
                            <MinusCircle size={15} />
                          </button>
                          <button className="text-orange-400 hover:text-orange-600 transition-colors" title="Khóa">
                            <Ban size={15} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination page={page} totalPages={totalPages} total={total} pageSize={pageSize} onPage={setPage} onPageSize={(s) => { setPageSize(s); setPage(1); }} />
          </>
        )}
      </div>

      {/* Wallet modal */}
      <Modal
        open={!!walletModal}
        onClose={() => setWalletModal(null)}
        title={walletModal?.type === "add" ? "Cộng tiền vào ví" : "Trừ tiền khỏi ví"}
      >
        <p className="text-sm text-gray-600 mb-3">
          Khách: <b>{walletModal?.user?.firstName || walletModal?.user?.telegramId}</b>
        </p>
        <div className="space-y-3">
          <div>
            <label className="text-xs font-medium text-gray-700 block mb-1">Số tiền (VND)</label>
            <input
              type="number"
              value={walletAmount}
              onChange={(e) => setWalletAmount(e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/30"
              placeholder="50000"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-gray-700 block mb-1">Ghi chú</label>
            <input
              type="text"
              value={walletNote}
              onChange={(e) => setWalletNote(e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/30"
              placeholder="Lý do điều chỉnh..."
            />
          </div>
          <button
            onClick={() => adjustMut.mutate({
              id: walletModal.user.id,
              amount: walletModal.type === "deduct" ? -Number(walletAmount) : Number(walletAmount),
              note: walletNote,
            })}
            disabled={!walletAmount || adjustMut.isPending}
            className="w-full py-2 bg-primary-500 text-white rounded-lg text-sm font-medium hover:bg-primary-600 disabled:opacity-50 transition-colors"
          >
            {adjustMut.isPending ? "Đang xử lý..." : "Xác nhận"}
          </button>
        </div>
      </Modal>
    </div>
  );
}
