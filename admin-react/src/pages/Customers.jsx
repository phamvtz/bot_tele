import { useState } from "react";
import { createPortal } from "react-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Eye, PlusCircle, MinusCircle, Ban, Users, X, DownloadCloud, ShieldOff, ShoppingCart } from "lucide-react";
import { api } from "../api/endpoints";
import SearchBar from "../components/SearchBar";
import Pagination from "../components/Pagination";
import Badge from "../components/Badge";
import EmptyState from "../components/EmptyState";
import { formatCurrency, formatDate } from "../utils/format";

const VIP_CONFIG = [
  { name: "Thường",    badge: null },
  { name: "Bạc",       badge: "🥈", cls: "bg-gray-700/60 text-gray-300 border-gray-600/30" },
  { name: "Vàng",      badge: "⭐", cls: "bg-yellow-900/40 text-yellow-400 border-yellow-700/30" },
  { name: "Kim Cương", badge: "💎", cls: "bg-cyan-900/40 text-cyan-400 border-cyan-700/30" },
];

const SORT_OPTIONS = [
  { value: "newest",  label: "Mới nhất" },
  { value: "balance", label: "Số dư cao nhất" },
  { value: "spent",   label: "Chi nhiều nhất" },
];

const QUICK_AMOUNTS = [10000, 50000, 100000, 500000];

function Avatar({ firstName, lastName, username }) {
  const initials = [firstName?.[0], lastName?.[0]].filter(Boolean).join("").toUpperCase()
    || username?.[0]?.toUpperCase() || "?";
  return (
    <div className="w-8 h-8 rounded-full bg-primary-900/60 border border-primary-700/30 flex items-center justify-center flex-shrink-0">
      <span className="text-xs font-bold text-primary-400">{initials}</span>
    </div>
  );
}

function VipBadge({ level }) {
  const v = VIP_CONFIG[level];
  if (!v?.badge) return null;
  return (
    <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded-full border ${v.cls}`}>
      {v.badge} {v.name}
    </span>
  );
}

export default function Customers() {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState("newest");
  const [vipFilter, setVipFilter] = useState("");
  const [blockedFilter, setBlockedFilter] = useState("");
  const [detailUser, setDetailUser] = useState(null);
  const [detailTab, setDetailTab] = useState("info");
  const [walletModal, setWalletModal] = useState(null);
  const [walletAmount, setWalletAmount] = useState("");
  const [walletNote, setWalletNote] = useState("");
  const [exporting, setExporting] = useState(false);
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["users", page, pageSize, search, sort, vipFilter, blockedFilter],
    queryFn: () => api.users({ page, limit: pageSize, search, sort, ...(vipFilter !== "" ? { vipLevel: vipFilter } : {}), ...(blockedFilter !== "" ? { blocked: blockedFilter } : {}) }),
  });

  const adjustMut = useMutation({
    mutationFn: ({ id, amount, note }) => api.adjustWallet(id, { amount, note }),
    onSuccess: () => {
      qc.invalidateQueries(["users"]);
      setWalletModal(null);
      setWalletAmount("");
      setWalletNote("");
    },
  });

  const blockMut = useMutation({
    mutationFn: ({ id, block }) => block ? api.blockUser(id) : api.unblockUser(id),
    onSuccess: (updated, vars) => {
      qc.invalidateQueries(["users"]);
      setDetailUser((u) => u ? { ...u, isBlocked: vars.block } : null);
    },
  });

  const { data: userOrdersData, isLoading: userOrdersLoading } = useQuery({
    queryKey: ["user-orders", detailUser?.id],
    queryFn: () => api.userOrders(detailUser.id, { limit: 30 }),
    enabled: !!detailUser && detailTab === "orders",
  });

  const users = data?.users || [];
  const total = data?.total || 0;
  const totalPages = Math.ceil(total / pageSize) || 1;

  async function handleExport() {
    setExporting(true);
    try {
      const blob = await api.exportUsers();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a"); a.href = url; a.download = "customers.csv"; a.click();
      URL.revokeObjectURL(url);
    } catch (e) { alert("Xuất CSV thất bại: " + e.message); }
    finally { setExporting(false); }
  }

  function openWallet(user, type) {
    setDetailUser(null);
    setWalletAmount("");
    setWalletNote("");
    setWalletModal({ user, type });
  }

  function toggleBlock(u) {
    const msg = u.isBlocked
      ? `Mở khóa tài khoản ${u.firstName || u.telegramId}?`
      : `Khóa tài khoản ${u.firstName || u.telegramId}?`;
    if (confirm(msg)) blockMut.mutate({ id: u.id, block: !u.isBlocked });
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-xl font-bold text-white">Khách Hàng</h1>
        <button onClick={handleExport} disabled={exporting}
          className="flex items-center gap-1.5 text-sm px-3 py-1.5 glass rounded-lg text-gray-400 hover:text-white disabled:opacity-50 transition-colors">
          <DownloadCloud size={13} />
          {exporting ? "Đang xuất..." : "Xuất CSV"}
        </button>
      </div>
      <p className="text-sm text-gray-500 mb-5">{total} khách hàng</p>

      <div className="glass rounded-xl p-4">
        <SearchBar
          placeholder="Tìm theo Chat ID, Username, tên..."
          value={search}
          onChange={setSearch}
          onSearch={() => setPage(1)}
          sortOptions={SORT_OPTIONS}
          sortValue={sort}
          onSort={(v) => { setSort(v); setPage(1); }}
        />

        {/* VIP + status filters */}
        <div className="flex items-center gap-2 mt-2 mb-3 flex-wrap">
          <span className="text-xs text-gray-600">VIP:</span>
          {[["Tất cả", ""], ["Thường", "0"], ["🥈 Bạc", "1"], ["⭐ Vàng", "2"], ["💎 KimCương", "3"]].map(([label, val]) => (
            <button key={val} onClick={() => { setVipFilter(val); setPage(1); }}
              className={`text-xs px-2.5 py-1 rounded-lg border transition-colors ${vipFilter === val ? "bg-primary-600/30 border-primary-500/50 text-primary-300" : "bg-white/[0.04] border-white/[0.06] text-gray-400 hover:text-white hover:bg-white/[0.08]"}`}>
              {label}
            </button>
          ))}
          <div className="w-px h-4 bg-white/[0.10] mx-1" />
          <span className="text-xs text-gray-600">Trạng thái:</span>
          {[["Tất cả", ""], ["Hoạt động", "false"], ["Đã khóa", "true"]].map(([label, val]) => (
            <button key={val} onClick={() => { setBlockedFilter(val); setPage(1); }}
              className={`text-xs px-2.5 py-1 rounded-lg border transition-colors ${blockedFilter === val ? "bg-primary-600/30 border-primary-500/50 text-primary-300" : "bg-white/[0.04] border-white/[0.06] text-gray-400 hover:text-white hover:bg-white/[0.08]"}`}>
              {label}
            </button>
          ))}
        </div>

        {isLoading ? (
          <p className="text-center py-10 text-sm text-gray-500">Đang tải...</p>
        ) : users.length === 0 ? (
          <EmptyState icon={Users} message="Chưa có khách hàng nào" />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-white/[0.06] text-left text-[11px] text-gray-500 uppercase tracking-wide">
                    <th className="px-3 py-2.5 font-medium">Khách hàng</th>
                    <th className="px-3 py-2.5 font-medium">Chat ID</th>
                    <th className="px-3 py-2.5 font-medium">Số dư</th>
                    <th className="px-3 py-2.5 font-medium">Đã chi</th>
                    <th className="px-3 py-2.5 font-medium text-center">Đơn</th>
                    <th className="px-3 py-2.5 font-medium">Trạng thái</th>
                    <th className="px-3 py-2.5 font-medium">Hành động</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((u) => {
                    const name = [u.firstName, u.lastName].filter(Boolean).join(" ") || u.username || "Ẩn danh";
                    return (
                      <tr key={u.id} className={`border-b border-white/[0.04] hover:bg-white/[0.025] transition-colors ${u.isBlocked ? "opacity-50" : ""}`}>
                        <td className="px-3 py-3">
                          <div className="flex items-center gap-2.5">
                            <Avatar firstName={u.firstName} lastName={u.lastName} username={u.username} />
                            <div className="min-w-0">
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <span className="text-sm font-medium text-white truncate">{name}</span>
                                <VipBadge level={u.vipLevel ?? 0} />
                              </div>
                              {u.username && <p className="text-[11px] text-gray-600 mt-0.5">@{u.username}</p>}
                            </div>
                          </div>
                        </td>
                        <td className="px-3 py-3 font-mono text-xs text-primary-500">{u.telegramId}</td>
                        <td className="px-3 py-3 font-semibold text-white">{formatCurrency(u.wallet?.balance ?? 0)}</td>
                        <td className="px-3 py-3 text-gray-400">{formatCurrency(u.totalSpent ?? 0)}</td>
                        <td className="px-3 py-3 text-center">
                          <span className="text-sm font-semibold text-gray-400">{u._count?.orders ?? 0}</span>
                        </td>
                        <td className="px-3 py-3">
                          {u.isBlocked ? (
                            <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-red-950/50 text-red-400 border border-red-800/30">
                              <span className="w-1 h-1 rounded-full bg-red-400" /> Đã khóa
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-emerald-950/40 text-emerald-500 border border-emerald-800/20">
                              <span className="w-1 h-1 rounded-full bg-emerald-500" /> Hoạt động
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-3">
                          <div className="flex items-center gap-2.5">
                            <button onClick={() => { setDetailUser(u); setDetailTab("info"); }} title="Chi tiết" className="text-gray-500 hover:text-primary-400 transition-colors">
                              <Eye size={14} />
                            </button>
                            <button onClick={() => openWallet(u, "add")} title="Cộng ví" className="text-gray-500 hover:text-emerald-400 transition-colors">
                              <PlusCircle size={14} />
                            </button>
                            <button onClick={() => openWallet(u, "deduct")} title="Trừ ví" className="text-gray-500 hover:text-red-400 transition-colors">
                              <MinusCircle size={14} />
                            </button>
                            <button onClick={() => toggleBlock(u)} title={u.isBlocked ? "Mở khóa" : "Khóa"}
                              className={`transition-colors ${u.isBlocked ? "text-gray-500 hover:text-emerald-400" : "text-gray-500 hover:text-orange-400"}`}>
                              {u.isBlocked ? <ShieldOff size={14} /> : <Ban size={14} />}
                            </button>
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

      {/* ── Detail modal ───────────────────────────────────── */}
      {detailUser && createPortal(
        <div className="fixed inset-0 bg-black/70 z-[9999] flex items-end sm:items-center justify-center p-4">
          <div className="glass-md rounded-2xl shadow-modal w-full max-w-md max-h-[85vh] flex flex-col">
            {/* Header */}
            <div className="px-5 py-4 border-b border-white/[0.07] flex-shrink-0">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-3">
                  <Avatar firstName={detailUser.firstName} lastName={detailUser.lastName} username={detailUser.username} />
                  <div>
                    <div className="flex items-center gap-2">
                      <h2 className="font-semibold text-white">
                        {[detailUser.firstName, detailUser.lastName].filter(Boolean).join(" ") || detailUser.username || "Ẩn danh"}
                      </h2>
                      <VipBadge level={detailUser.vipLevel ?? 0} />
                    </div>
                    <p className="text-xs text-gray-500 mt-0.5">ID: {detailUser.telegramId}</p>
                  </div>
                </div>
                <button onClick={() => setDetailUser(null)} className="text-gray-500 hover:text-gray-300 transition-colors"><X size={16} /></button>
              </div>
              {/* Tabs */}
              <div className="flex gap-1">
                {[["info", "Thông tin"], ["orders", `Đơn hàng (${detailUser._count?.orders ?? 0})`]].map(([key, label]) => (
                  <button key={key} onClick={() => setDetailTab(key)}
                    className={`text-xs px-3 py-1.5 rounded-lg transition-colors ${detailTab === key ? "bg-white/[0.10] text-white font-medium" : "text-gray-500 hover:text-gray-300"}`}>
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <div className="overflow-y-auto flex-1 p-5">
              {detailTab === "info" && (
                <div className="space-y-4">
                  {/* Balance highlight */}
                  <div className="grid grid-cols-2 gap-3">
                    <div className="rounded-xl p-3.5 border border-emerald-800/25 bg-emerald-950/15">
                      <p className="text-[10px] text-gray-500 mb-1">Số dư ví</p>
                      <p className="text-xl font-bold text-emerald-400">{formatCurrency(detailUser.wallet?.balance ?? 0)}</p>
                    </div>
                    <div className="glass rounded-xl p-3.5">
                      <p className="text-[10px] text-gray-500 mb-1">Đã chi tiêu</p>
                      <p className="text-xl font-bold text-white">{formatCurrency(detailUser.totalSpent ?? 0)}</p>
                    </div>
                  </div>

                  {/* Info grid */}
                  <div className="grid grid-cols-2 gap-2">
                    {[
                      ["Chat ID",        <span className="font-mono text-primary-400 text-xs">{detailUser.telegramId}</span>],
                      ["Username",       detailUser.username ? `@${detailUser.username}` : "—"],
                      ["Tổng đơn hàng",  `${detailUser._count?.orders ?? 0} đơn`],
                      ["Cấp VIP",        `${VIP_CONFIG[detailUser.vipLevel || 0]?.name} (Lv${detailUser.vipLevel ?? 0})`],
                      ["Ngôn ngữ",       detailUser.language || "vi"],
                      ["Tham gia",       formatDate(detailUser.createdAt)],
                      ["Hoạt động cuối", formatDate(detailUser.updatedAt)],
                      ["Trạng thái",     detailUser.isBlocked
                        ? <span className="text-red-400">🔴 Đã khóa</span>
                        : <span className="text-emerald-400">🟢 Hoạt động</span>],
                    ].map(([k, v]) => (
                      <div key={k} className="glass rounded-lg p-2.5">
                        <p className="text-[10px] text-gray-600 mb-0.5">{k}</p>
                        <p className="text-xs font-medium text-gray-300 break-all">{v}</p>
                      </div>
                    ))}
                  </div>

                  {/* Actions */}
                  <div className="grid grid-cols-3 gap-2 pt-1 border-t border-white/[0.07]">
                    <button onClick={() => openWallet(detailUser, "add")}
                      className="py-2 border border-emerald-800/50 text-emerald-400 rounded-lg text-xs font-medium hover:bg-emerald-950/40 transition-colors">
                      + Cộng ví
                    </button>
                    <button onClick={() => openWallet(detailUser, "deduct")}
                      className="py-2 border border-red-800/50 text-red-400 rounded-lg text-xs font-medium hover:bg-red-950/40 transition-colors">
                      − Trừ ví
                    </button>
                    <button onClick={() => toggleBlock(detailUser)}
                      className={`py-2 border rounded-lg text-xs font-medium transition-colors ${detailUser.isBlocked
                        ? "border-emerald-800/50 text-emerald-400 hover:bg-emerald-950/40"
                        : "border-orange-800/50 text-orange-400 hover:bg-orange-950/40"}`}>
                      {detailUser.isBlocked ? "Mở khóa" : "Khóa"}
                    </button>
                  </div>
                </div>
              )}

              {detailTab === "orders" && (
                <div>
                  {userOrdersLoading ? (
                    <p className="text-sm text-gray-400 text-center py-8">Đang tải...</p>
                  ) : (userOrdersData?.orders || []).length === 0 ? (
                    <div className="text-center py-8">
                      <ShoppingCart size={28} className="text-gray-700 mx-auto mb-2" />
                      <p className="text-sm text-gray-500">Chưa có đơn hàng nào</p>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {(userOrdersData?.orders || []).map((o) => (
                        <div key={o.id} className="glass rounded-lg p-3 flex items-center gap-3">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-0.5">
                              <span className="font-mono text-[10px] text-gray-500">{o.id?.slice(-8).toUpperCase()}</span>
                              <Badge status={o.status} />
                            </div>
                            <p className="text-xs text-gray-300 truncate">{o.product?.name || "—"}</p>
                            <p className="text-[10px] text-gray-600 mt-0.5">{formatDate(o.createdAt)}</p>
                          </div>
                          <div className="text-right flex-shrink-0">
                            <p className="text-sm font-semibold text-white">{formatCurrency(o.finalAmount)}</p>
                            <p className="text-[10px] text-gray-600">x{o.quantity}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* ── Wallet modal ───────────────────────────────────── */}
      {walletModal && createPortal(
        <div className="fixed inset-0 bg-black/70 z-[9999] flex items-end sm:items-center justify-center p-4">
          <div className="glass-md rounded-2xl shadow-modal w-full max-w-sm">
            <div className="px-5 py-4 border-b border-white/[0.07] flex items-center justify-between">
              <div>
                <h2 className="font-semibold text-white">
                  {walletModal.type === "add" ? "Cộng tiền vào ví" : "Trừ tiền khỏi ví"}
                </h2>
                <p className="text-xs text-gray-500 mt-0.5">
                  {walletModal.user?.firstName || walletModal.user?.telegramId} ·{" "}
                  <span className="text-emerald-400 font-medium">{formatCurrency(walletModal.user?.wallet?.balance ?? 0)}</span>
                </p>
              </div>
              <button onClick={() => setWalletModal(null)} className="text-gray-500 hover:text-gray-300 transition-colors"><X size={16} /></button>
            </div>

            <div className="p-5 space-y-3.5">
              {/* Quick amounts */}
              <div>
                <p className="text-xs text-gray-600 mb-1.5">Chọn nhanh</p>
                <div className="grid grid-cols-4 gap-1.5">
                  {QUICK_AMOUNTS.map((a) => (
                    <button key={a} onClick={() => setWalletAmount(String(a))}
                      className={`py-1.5 rounded-lg text-xs font-semibold border transition-colors ${String(walletAmount) === String(a)
                        ? "bg-primary-600/30 border-primary-600/50 text-primary-300"
                        : "border-white/[0.08] text-gray-500 hover:border-white/[0.2] hover:text-gray-300"}`}>
                      {a >= 1000 ? `${a / 1000}k` : a}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="text-xs text-gray-400 block mb-1">Số tiền (VND)</label>
                <input type="number" value={walletAmount} onChange={(e) => setWalletAmount(e.target.value)}
                  className="w-full glass-input rounded-lg px-3 py-2 text-sm" placeholder="50000" />
              </div>
              <div>
                <label className="text-xs text-gray-400 block mb-1">Ghi chú</label>
                <input type="text" value={walletNote} onChange={(e) => setWalletNote(e.target.value)}
                  className="w-full glass-input rounded-lg px-3 py-2 text-sm" placeholder="Lý do điều chỉnh..." />
              </div>

              <button
                onClick={() => adjustMut.mutate({
                  id: walletModal.user.id,
                  amount: walletModal.type === "deduct" ? -Math.abs(Number(walletAmount)) : Number(walletAmount),
                  note: walletNote,
                })}
                disabled={!walletAmount || Number(walletAmount) <= 0 || adjustMut.isPending}
                className={`w-full py-2.5 rounded-lg text-sm font-semibold disabled:opacity-50 transition-colors ${walletModal.type === "add"
                  ? "bg-emerald-600 hover:bg-emerald-500 text-white"
                  : "bg-red-600 hover:bg-red-500 text-white"}`}>
                {adjustMut.isPending
                  ? "Đang xử lý..."
                  : walletModal.type === "add"
                  ? `Cộng ${walletAmount ? formatCurrency(Number(walletAmount)) : "..."}`
                  : `Trừ ${walletAmount ? formatCurrency(Number(walletAmount)) : "..."}`}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
