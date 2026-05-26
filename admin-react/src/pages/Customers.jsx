import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Eye, PlusCircle, MinusCircle, Ban, Users, X } from "lucide-react";
import { api } from "../api/endpoints";
import SearchBar from "../components/SearchBar";
import Pagination from "../components/Pagination";
import EmptyState from "../components/EmptyState";
import Modal from "../components/Modal";
import Badge from "../components/Badge";
import { formatCurrency, formatDate } from "../utils/format";

const VIP_NAMES = ["Thường", "Bạc", "Vàng", "Kim Cương"];

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
  const [detailUser, setDetailUser] = useState(null);
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["users", page, pageSize, search, sort],
    queryFn: () => api.users({ page, limit: pageSize, search, sort }),
  });

  const adjustMut = useMutation({
    mutationFn: ({ id, amount, note }) => api.adjustWallet(id, { amount, note }),
    onSuccess: () => { qc.invalidateQueries(["users"]); setWalletModal(null); setWalletAmount(""); setWalletNote(""); },
  });
  const blockMut = useMutation({
    mutationFn: (id) => api.blockUser(id),
    onSuccess: () => qc.invalidateQueries(["users"]),
  });

  const users = data?.users || [];
  const total = data?.total || 0;
  const totalPages = Math.ceil(total / pageSize) || 1;

  return (
    <div>
      <h1 className="text-xl font-bold text-white mb-1">Khách Hàng</h1>
      <p className="text-sm text-gray-500 mb-5">{total} khách hàng</p>

      <div className="glass rounded-xl p-4">
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
                  <tr className="border-b border-white/[0.06] text-left text-gray-500 text-xs">
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
                    <tr key={u.id} className="border-b border-white/[0.04] hover:bg-white/[0.03] transition-colors">
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
                          <button onClick={() => setDetailUser(u)} className="text-gray-400 hover:text-primary-600 transition-colors" title="Chi tiết">
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
                          <button
                            className="text-orange-400 hover:text-orange-600 transition-colors"
                            title="Khóa tài khoản"
                            onClick={() => { if (confirm(`Khóa tài khoản ${u.firstName || u.telegramId}?`)) blockMut.mutate(u.id); }}
                          >
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

      {/* Customer detail modal */}
      {detailUser && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-end sm:items-center justify-center p-4">
          <div className="glass-md rounded-2xl shadow-modal w-full max-w-md max-h-[85vh] flex flex-col">
            <div className="px-5 py-4 border-b border-white/[0.07] flex items-center justify-between flex-shrink-0">
              <div>
                <h2 className="font-semibold text-white">
                  {[detailUser.firstName, detailUser.lastName].filter(Boolean).join(" ") || "Khách hàng"}
                </h2>
                <p className="text-xs text-gray-400 mt-0.5">ID: {detailUser.telegramId}</p>
              </div>
              <button onClick={() => setDetailUser(null)} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
            </div>

            <div className="overflow-y-auto flex-1 p-5 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                {[
                  ["Chat ID", detailUser.telegramId],
                  ["Username", detailUser.username ? `@${detailUser.username}` : "—"],
                  ["Số dư ví", formatCurrency(detailUser.wallet?.balance ?? 0)],
                  ["Đã chi tiêu", formatCurrency(detailUser.totalSpent ?? 0)],
                  ["Tổng đơn", detailUser._count?.orders ?? 0],
                  ["VIP", `${VIP_NAMES[detailUser.vipLevel] || "Thường"} (Lv${detailUser.vipLevel ?? 0})`],
                  ["Ngôn ngữ", detailUser.language || "vi"],
                  ["Tham gia", formatDate(detailUser.createdAt)],
                  ["Hoạt động cuối", formatDate(detailUser.updatedAt)],
                  ["Trạng thái", detailUser.isBlocked ? "🔴 Đã khóa" : "🟢 Hoạt động"],
                ].map(([k, v]) => (
                  <div key={k} className="glass rounded-lg p-3">
                    <p className="text-xs text-gray-400 mb-0.5">{k}</p>
                    <p className="text-sm font-medium text-white break-all">{String(v)}</p>
                  </div>
                ))}
              </div>

              <div className="flex gap-2 pt-2 border-t border-white/[0.07]">
                <button onClick={() => { setDetailUser(null); setWalletModal({ user: detailUser, type: "add" }); }}
                  className="flex-1 py-2 border border-green-200 text-green-600 rounded-lg text-xs font-medium hover:bg-green-50 transition-colors">
                  + Cộng ví
                </button>
                <button onClick={() => { setDetailUser(null); setWalletModal({ user: detailUser, type: "deduct" }); }}
                  className="flex-1 py-2 border border-red-200 text-red-500 rounded-lg text-xs font-medium hover:bg-red-50 transition-colors">
                  − Trừ ví
                </button>
                <button onClick={() => { if (confirm(`Khóa tài khoản ${detailUser.firstName || detailUser.telegramId}?`)) { blockMut.mutate(detailUser.id); setDetailUser(null); } }}
                  className="flex-1 py-2 border border-orange-200 text-orange-500 rounded-lg text-xs font-medium hover:bg-orange-50 transition-colors">
                  Khóa
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

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
            <label className="text-xs font-medium text-gray-400 block mb-1">Số tiền (VND)</label>
            <input
              type="number"
              value={walletAmount}
              onChange={(e) => setWalletAmount(e.target.value)}
              className="w-full glass-input rounded-lg px-3 py-2 text-sm"
              placeholder="50000"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-gray-400 block mb-1">Ghi chú</label>
            <input
              type="text"
              value={walletNote}
              onChange={(e) => setWalletNote(e.target.value)}
              className="w-full glass-input rounded-lg px-3 py-2 text-sm"
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
            className="w-full py-2 bg-primary-500 text-white rounded-lg text-sm font-medium hover:bg-primary-600 disabled:opacity-50 transition-colors shadow-glow-sm hover:shadow-glow"
          >
            {adjustMut.isPending ? "Đang xử lý..." : "Xác nhận"}
          </button>
        </div>
      </Modal>
    </div>
  );
}
