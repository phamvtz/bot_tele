import { useState } from "react";
import { createPortal } from "react-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Eye, PlusCircle, MinusCircle, Ban, Users, X, DownloadCloud, ShieldOff, ShoppingCart, CheckSquare, Square, Bell, BellOff, Clock3 } from "lucide-react";
import { api } from "../api/endpoints";
import SearchBar from "../components/SearchBar";
import Pagination from "../components/Pagination";
import Badge from "../components/Badge";
import EmptyState from "../components/EmptyState";
import { formatCurrency, formatDate } from "../utils/format";

const VIP_CONFIG = [
  { name: "Thường",    badge: null },
  { name: "Bạc",       badge: "🥈", cls: "bg-slate-800 text-slate-300 border-slate-700/60" },
  { name: "Vàng",      badge: "⭐", cls: "bg-amber-950/40 text-amber-300 border-amber-800/40" },
  { name: "Kim Cương", badge: "💎", cls: "bg-cyan-950/40 text-cyan-300 border-cyan-800/40" },
];

const SORT_OPTIONS = [
  { value: "newest",  label: "Mới nhất" },
  { value: "balance", label: "Số dư cao nhất" },
  { value: "spent",   label: "Chi nhiều nhất" },
];

const QUICK_AMOUNTS = [10000, 50000, 100000, 500000];

const NOTIFICATION_MODES = {
  enabled:   { label: "Đang bật",   cls: "bg-emerald-950/40 text-emerald-400 border-emerald-800/30" },
  muted_24h: { label: "Ẩn 24 giờ", cls: "bg-amber-950/40 text-amber-400 border-amber-800/30" },
  disabled:  { label: "Đã tắt",     cls: "bg-rose-950/40 text-rose-400 border-rose-800/30" },
};

function notificationMode(user) {
  if (user?.orderNotificationMode) return user.orderNotificationMode;
  const mutedUntil = Number(user?.notifyMutedUntil || 0);
  if (!mutedUntil || mutedUntil <= Date.now()) return "enabled";
  if (mutedUntil >= 8640000000000000) return "disabled";
  return "muted_24h";
}

function Avatar({ firstName, lastName, username }) {
  const initials = [firstName?.[0], lastName?.[0]].filter(Boolean).join("").toUpperCase()
    || username?.[0]?.toUpperCase() || "?";
  return (
    <div className="w-7 h-7 rounded-lg bg-indigo-500/10 border border-indigo-500/30 flex items-center justify-center flex-shrink-0 font-mono">
      <span className="text-[11px] font-bold text-indigo-400">{initials}</span>
    </div>
  );
}

function VipBadge({ level }) {
  const v = VIP_CONFIG[level];
  if (!v?.badge) return null;
  return (
    <span className={`text-[10px] font-mono font-semibold px-1.5 py-0.5 rounded border ${v.cls}`}>
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
  const [selected, setSelected] = useState(new Set());
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["users", page, pageSize, search, sort, vipFilter, blockedFilter],
    queryFn: () => api.users({
      page, limit: pageSize, search, sort,
      ...(vipFilter !== "" ? { vipLevel: vipFilter } : {}),
      ...(blockedFilter !== "" ? { blocked: blockedFilter } : {})
    }),
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

  const notificationMut = useMutation({
    mutationFn: ({ id, mode }) => api.setUserOrderNotifications(id, mode),
    onSuccess: (updated, vars) => {
      qc.invalidateQueries(["users"]);
      setDetailUser((u) => u ? { ...u, orderNotificationMode: vars.mode } : null);
    },
  });

  const { data: userOrdersData, isLoading: userOrdersLoading } = useQuery({
    queryKey: ["user-orders", detailUser?.id],
    queryFn: () => api.orders({ userId: detailUser.id, limit: 10 }),
    enabled: !!detailUser && detailTab === "orders",
  });

  const users = data?.users || [];
  const total = data?.total || 0;
  const totalPages = Math.ceil(total / pageSize) || 1;

  const allIds = users.map((u) => u.id);
  const allSelected = allIds.length > 0 && allIds.every((id) => selected.has(id));
  const someSelected = selected.size > 0;

  function toggleSelectAll() {
    if (allSelected) {
      setSelected((prev) => { const n = new Set(prev); allIds.forEach(id => n.delete(id)); return n; });
    } else {
      setSelected((prev) => { const n = new Set(prev); allIds.forEach(id => n.add(id)); return n; });
    }
  }
  function toggleSelect(id) {
    setSelected((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }
  function clearSelection() { setSelected(new Set()); }

  async function bulkBlock(block) {
    const ids = [...selected];
    if (!confirm(`${block ? "Khóa" : "Mở khóa"} ${ids.length} tài khoản?`)) return;
    await Promise.allSettled(ids.map(id => api[block ? "blockUser" : "unblockUser"](id)));
    qc.invalidateQueries(["users"]);
    clearSelection();
  }

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

  function setNotifications(user, mode) {
    notificationMut.mutate({ id: user.id, mode });
  }

  return (
    <div className="space-y-4 pb-10">
      {/* Header with eyebrow, tight tracking */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-1">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="eyebrow text-slate-400">USERS // DIRECTORY</span>
            <span className="w-1 h-1 rounded-full bg-slate-600" />
            <span className="text-[10px] font-mono text-indigo-400">AUDIT PROFILES</span>
          </div>
          <h1 className="text-xl font-bold text-slate-100 tracking-tight flex items-center gap-2">
            Khách hàng
            <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-indigo-500/10 text-indigo-300 border border-indigo-500/25">
              {total} TÀI KHOẢN
            </span>
          </h1>
          <p className="text-xs text-slate-400 mt-0.5 tracking-tight">
            Quản lý người dùng bot Telegram, điều chỉnh ví, nâng VIP và chặn spam
          </p>
        </div>

        <div>
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
        <SearchBar
          placeholder="Tìm theo Chat ID, Username, tên..."
          value={search}
          onChange={setSearch}
          onSearch={() => setPage(1)}
          sortOptions={SORT_OPTIONS}
          sortValue={sort}
          onSort={(v) => { setSort(v); setPage(1); }}
        />

        {/* Filter Pills */}
        <div className="flex items-center gap-2 pt-1 border-t border-slate-800/60 flex-wrap">
          <span className="text-[10px] font-mono uppercase text-slate-400 tracking-wider">VIP:</span>
          {[["Tất cả", ""], ["Thường", "0"], ["🥈 Bạc", "1"], ["⭐ Vàng", "2"], ["💎 Kim Cương", "3"]].map(([label, val]) => (
            <button
              key={val}
              onClick={() => { setVipFilter(val); setPage(1); }}
              className={`text-[11px] font-mono px-2.5 py-1 rounded-md border transition-all cursor-pointer ${
                vipFilter === val
                  ? "bg-indigo-500/15 text-indigo-300 border-indigo-500/30"
                  : "bg-slate-900/60 text-slate-400 border-slate-800 hover:text-slate-200 hover:bg-slate-800"
              }`}
            >
              {label}
            </button>
          ))}

          <div className="w-px h-3.5 bg-slate-800 mx-1" />

          <span className="text-[10px] font-mono uppercase text-slate-400 tracking-wider">Trạng thái:</span>
          {[["Tất cả", ""], ["Hoạt động", "false"], ["Đã khóa", "true"]].map(([label, val]) => (
            <button
              key={val}
              onClick={() => { setBlockedFilter(val); setPage(1); }}
              className={`text-[11px] font-mono px-2.5 py-1 rounded-md border transition-all cursor-pointer ${
                blockedFilter === val
                  ? "bg-indigo-500/15 text-indigo-300 border-indigo-500/30"
                  : "bg-slate-900/60 text-slate-400 border-slate-800 hover:text-slate-200 hover:bg-slate-800"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Bulk Action Bar */}
        {someSelected && (
          <div className="flex items-center gap-3 px-3.5 py-2 bg-indigo-500/10 border border-indigo-500/25 rounded-lg">
            <span className="text-xs font-mono font-semibold text-indigo-300">
              ĐÃ CHỌN {selected.size} MỤC
            </span>
            <div className="flex items-center gap-2 ml-auto font-mono text-xs">
              <button
                onClick={() => bulkBlock(false)}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-slate-900 border border-slate-800 text-emerald-400 hover:bg-slate-800 transition-colors cursor-pointer"
              >
                <ShieldOff size={11} /> Mở khóa
              </button>
              <button
                onClick={() => bulkBlock(true)}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-slate-900 border border-slate-800 text-rose-400 hover:bg-slate-800 transition-colors cursor-pointer"
              >
                <Ban size={11} /> Khóa
              </button>
              <button
                onClick={clearSelection}
                className="px-2.5 py-1 rounded bg-slate-900 border border-slate-800 text-slate-400 hover:text-white transition-colors cursor-pointer"
              >
                Bỏ chọn
              </button>
            </div>
          </div>
        )}

        {isLoading ? (
          <div className="py-16 text-center text-xs font-mono text-slate-500 animate-pulse">
            ĐANG TẢI DỮ LIỆU KHÁCH HÀNG...
          </div>
        ) : users.length === 0 ? (
          <EmptyState icon={Users} message="Chưa có khách hàng nào khớp với điều kiện lọc" />
        ) : (
          <>
            <div className="overflow-x-auto rounded-lg border border-slate-800/80">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="bg-slate-900/60 border-b border-slate-800/80 text-[10px] font-mono text-slate-400 uppercase tracking-wider">
                    <th className="px-3.5 py-2.5 w-8">
                      <button onClick={toggleSelectAll} className="text-slate-400 hover:text-white transition-colors cursor-pointer">
                        {allSelected ? <CheckSquare size={14} className="text-indigo-400" /> : <Square size={14} />}
                      </button>
                    </th>
                    <th className="px-3.5 py-2.5 font-medium">KHÁCH HÀNG</th>
                    <th className="px-3 py-2.5 font-medium">CHAT ID</th>
                    <th className="px-3 py-2.5 font-medium">SỐ DƯ</th>
                    <th className="px-3 py-2.5 font-medium">ĐÃ CHI</th>
                    <th className="px-3 py-2.5 font-medium text-center">ĐƠN</th>
                    <th className="px-3 py-2.5 font-medium">TRẠNG THÁI</th>
                    <th className="px-3 py-2.5 font-medium">THÔNG BÁO</th>
                    <th className="px-3.5 py-2.5 font-medium text-right">THAO TÁC</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60 font-sans">
                  {users.map((u) => {
                    const name = [u.firstName, u.lastName].filter(Boolean).join(" ") || u.username || "Ẩn danh";
                    const notifyMode = notificationMode(u);
                    const notifyConfig = NOTIFICATION_MODES[notifyMode];
                    return (
                      <tr
                        key={u.id}
                        className={`hover:bg-slate-800/30 transition-colors ${u.isBlocked ? "opacity-50" : ""} ${
                          selected.has(u.id) ? "bg-indigo-500/5" : ""
                        }`}
                      >
                        <td className="px-3.5 py-3 w-8">
                          <button onClick={() => toggleSelect(u.id)} className="text-slate-400 hover:text-white transition-colors cursor-pointer">
                            {selected.has(u.id) ? <CheckSquare size={14} className="text-indigo-400" /> : <Square size={14} />}
                          </button>
                        </td>
                        <td className="px-3.5 py-3">
                          <div className="flex items-center gap-2.5">
                            <Avatar firstName={u.firstName} lastName={u.lastName} username={u.username} />
                            <div className="min-w-0">
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <span className="font-medium text-slate-100 truncate text-xs">{name}</span>
                                <VipBadge level={u.vipLevel ?? 0} />
                              </div>
                              {u.username && <p className="text-[10px] font-mono text-slate-500 mt-0.5">@{u.username}</p>}
                            </div>
                          </div>
                        </td>
                        <td className="px-3 py-3 font-mono text-xs text-indigo-400">{u.telegramId}</td>
                        <td className="px-3 py-3 font-mono font-semibold text-emerald-400 text-xs">
                          {formatCurrency(u.wallet?.balance ?? 0)}
                        </td>
                        <td className="px-3 py-3 font-mono text-slate-300 text-xs">
                          {formatCurrency(u.totalSpent ?? 0)}
                        </td>
                        <td className="px-3 py-3 text-center font-mono text-slate-400">
                          {u._count?.orders ?? 0}
                        </td>
                        <td className="px-3 py-3">
                          {u.isBlocked ? (
                            <span className="inline-flex items-center gap-1 text-[10px] font-mono px-2 py-0.5 rounded-full bg-rose-950/40 text-rose-400 border border-rose-800/30">
                              <span className="w-1 h-1 rounded-full bg-rose-400" /> ĐÃ KHÓA
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-[10px] font-mono px-2 py-0.5 rounded-full bg-emerald-950/40 text-emerald-400 border border-emerald-800/30">
                              <span className="w-1 h-1 rounded-full bg-emerald-400" /> HOẠT ĐỘNG
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-3">
                          <span className={`inline-flex items-center gap-1 text-[10px] font-mono px-2 py-0.5 rounded-full border ${notifyConfig.cls}`}>
                            {notifyMode === "enabled" ? <Bell size={10} /> : notifyMode === "muted_24h" ? <Clock3 size={10} /> : <BellOff size={10} />}
                            {notifyConfig.label}
                          </span>
                        </td>
                        <td className="px-3.5 py-3 text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            <button
                              onClick={() => { setDetailUser(u); setDetailTab("info"); }}
                              title="Chi tiết hồ sơ"
                              className="p-1 text-slate-400 hover:text-indigo-400 hover:bg-slate-800/60 rounded border border-transparent hover:border-slate-700 transition-all cursor-pointer"
                            >
                              <Eye size={13} />
                            </button>
                            <button
                              onClick={() => openWallet(u, "add")}
                              title="Cộng tiền ví"
                              className="p-1 text-slate-400 hover:text-emerald-400 hover:bg-slate-800/60 rounded border border-transparent hover:border-slate-700 transition-all cursor-pointer"
                            >
                              <PlusCircle size={13} />
                            </button>
                            <button
                              onClick={() => openWallet(u, "deduct")}
                              title="Trừ tiền ví"
                              className="p-1 text-slate-400 hover:text-rose-400 hover:bg-slate-800/60 rounded border border-transparent hover:border-slate-700 transition-all cursor-pointer"
                            >
                              <MinusCircle size={13} />
                            </button>
                            <button
                              onClick={() => toggleBlock(u)}
                              title={u.isBlocked ? "Mở khóa" : "Khóa"}
                              className={`p-1 rounded border border-transparent hover:border-slate-700 transition-all cursor-pointer ${
                                u.isBlocked ? "text-slate-400 hover:text-emerald-400 hover:bg-slate-800/60" : "text-slate-400 hover:text-amber-400 hover:bg-slate-800/60"
                              }`}
                            >
                              {u.isBlocked ? <ShieldOff size={13} /> : <Ban size={13} />}
                            </button>
                            <button
                              onClick={() => setNotifications(u, notifyMode === "enabled" ? "disabled" : "enabled")}
                              disabled={notificationMut.isPending}
                              title={notifyMode === "enabled" ? "Tắt thông báo đơn" : "Bật thông báo đơn"}
                              className={`p-1 rounded border border-transparent hover:border-slate-700 transition-all cursor-pointer disabled:opacity-40 ${
                                notifyMode === "enabled" ? "text-slate-400 hover:text-rose-400 hover:bg-slate-800/60" : "text-amber-400 hover:text-emerald-400 hover:bg-slate-800/60"
                              }`}
                            >
                              {notifyMode === "enabled" ? <BellOff size={13} /> : <Bell size={13} />}
                            </button>
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

      {/* ── Detail modal ───────────────────────────────────── */}
      {detailUser && createPortal(
        <div className="fixed inset-0 bg-black/80 z-[9999] flex items-end sm:items-center justify-center p-4 backdrop-blur-sm animate-fade-in">
          <div className="bento-card border-slate-800 w-full max-w-md max-h-[85vh] flex flex-col shadow-2xl animate-modal-in">
            {/* Header */}
            <div className="px-5 py-3.5 border-b border-slate-800/80 flex-shrink-0">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-3">
                  <Avatar firstName={detailUser.firstName} lastName={detailUser.lastName} username={detailUser.username} />
                  <div>
                    <div className="flex items-center gap-2">
                      <h2 className="font-bold text-slate-100 text-sm tracking-tight">
                        {[detailUser.firstName, detailUser.lastName].filter(Boolean).join(" ") || detailUser.username || "Ẩn danh"}
                      </h2>
                      <VipBadge level={detailUser.vipLevel ?? 0} />
                    </div>
                    <p className="text-xs font-mono text-slate-500 mt-0.5">ID: {detailUser.telegramId}</p>
                  </div>
                </div>
                <button
                  onClick={() => setDetailUser(null)}
                  className="text-slate-400 hover:text-slate-200 p-1 rounded hover:bg-slate-800/60 transition-colors cursor-pointer"
                >
                  <X size={16} />
                </button>
              </div>

              {/* Tabs */}
              <div className="flex gap-1 bg-slate-900/80 border border-slate-800 p-1 rounded-lg">
                {[["info", "THÔNG TIN"], ["orders", `ĐƠN HÀNG (${detailUser._count?.orders ?? 0})`]].map(([key, label]) => (
                  <button
                    key={key}
                    onClick={() => setDetailTab(key)}
                    className={`flex-1 text-[11px] font-mono py-1 rounded transition-all cursor-pointer ${
                      detailTab === key
                        ? "bg-slate-800 text-slate-100 border border-slate-700 shadow-sm"
                        : "text-slate-400 hover:text-slate-200"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <div className="overflow-y-auto flex-1 p-5">
              {detailTab === "info" && (
                <div className="space-y-4 text-xs font-mono">
                  {/* Balance highlight */}
                  <div className="grid grid-cols-2 gap-2.5">
                    <div className="rounded-lg p-3 border border-emerald-800/30 bg-emerald-950/20">
                      <span className="eyebrow text-emerald-400/80 block mb-1">SỐ DƯ VÍ</span>
                      <p className="text-lg font-bold text-emerald-400">
                        {formatCurrency(detailUser.wallet?.balance ?? 0)}
                      </p>
                    </div>
                    <div className="p-3 rounded-lg bg-slate-900/60 border border-slate-800">
                      <span className="eyebrow text-slate-400 block mb-1">ĐÃ CHI TIÊU</span>
                      <p className="text-lg font-bold text-slate-100">
                        {formatCurrency(detailUser.totalSpent ?? 0)}
                      </p>
                    </div>
                  </div>

                  {/* Info grid */}
                  <div className="grid grid-cols-2 gap-2">
                    {[
                      ["Chat ID", <span className="font-mono text-indigo-400">{detailUser.telegramId}</span>],
                      ["Username", detailUser.username ? `@${detailUser.username}` : "—"],
                      ["Tổng đơn hàng", `${detailUser._count?.orders ?? 0} đơn`],
                      ["Cấp VIP", `${VIP_CONFIG[detailUser.vipLevel || 0]?.name} (Lv${detailUser.vipLevel ?? 0})`],
                      ["Ngôn ngữ", detailUser.language || "vi"],
                      ["Tham gia", formatDate(detailUser.createdAt)],
                      ["Hoạt động cuối", formatDate(detailUser.updatedAt)],
                      ["Trạng thái", detailUser.isBlocked ? <span className="text-rose-400">Đã khóa</span> : <span className="text-emerald-400">Hoạt động</span>],
                    ].map(([k, v]) => (
                      <div key={k} className="p-2.5 rounded-lg bg-slate-900/60 border border-slate-800">
                        <span className="eyebrow text-slate-400 block mb-0.5">{k}</span>
                        <div className="text-slate-200 break-all">{v}</div>
                      </div>
                    ))}
                  </div>

                  {/* Actions */}
                  <div className="grid grid-cols-3 gap-2 pt-2 border-t border-slate-800">
                    <button
                      onClick={() => openWallet(detailUser, "add")}
                      className="py-1.5 border border-emerald-800/50 text-emerald-400 rounded-lg text-xs font-mono font-medium hover:bg-emerald-950/40 transition-colors cursor-pointer"
                    >
                      + CỘNG VÍ
                    </button>
                    <button
                      onClick={() => openWallet(detailUser, "deduct")}
                      className="py-1.5 border border-rose-800/50 text-rose-400 rounded-lg text-xs font-mono font-medium hover:bg-rose-950/40 transition-colors cursor-pointer"
                    >
                      − TRỪ VÍ
                    </button>
                    <button
                      onClick={() => toggleBlock(detailUser)}
                      className={`py-1.5 border rounded-lg text-xs font-mono font-medium transition-colors cursor-pointer ${
                        detailUser.isBlocked
                          ? "border-emerald-800/50 text-emerald-400 hover:bg-emerald-950/40"
                          : "border-amber-800/50 text-amber-400 hover:bg-amber-950/40"
                      }`}
                    >
                      {detailUser.isBlocked ? "MỞ KHÓA" : "KHÓA"}
                    </button>
                  </div>
                </div>
              )}

              {detailTab === "orders" && (
                <div>
                  {userOrdersLoading ? (
                    <p className="text-xs font-mono text-slate-500 text-center py-8 animate-pulse">ĐANG TẢI ĐƠN HÀNG...</p>
                  ) : (userOrdersData?.orders || []).length === 0 ? (
                    <div className="text-center py-8">
                      <ShoppingCart size={24} className="text-slate-700 mx-auto mb-2" />
                      <p className="text-xs font-mono text-slate-500">Chưa có đơn hàng nào</p>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {(userOrdersData?.orders || []).map((o) => (
                        <div key={o.id} className="p-2.5 rounded-lg bg-slate-900/60 border border-slate-800 flex items-center gap-3">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-0.5">
                              <span className="font-mono text-[10px] text-slate-500">#{o.id?.slice(-8).toUpperCase()}</span>
                              <Badge status={o.status} />
                            </div>
                            <p className="text-xs text-slate-200 truncate">{o.product?.name || "—"}</p>
                            <p className="text-[10px] font-mono text-slate-500 mt-0.5">{formatDate(o.createdAt)}</p>
                          </div>
                          <div className="text-right flex-shrink-0">
                            <p className="text-xs font-mono font-semibold text-slate-100">{formatCurrency(o.finalAmount)}</p>
                            <p className="text-[10px] font-mono text-slate-500">x{o.quantity}</p>
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
        <div className="fixed inset-0 bg-black/80 z-[9999] flex items-end sm:items-center justify-center p-4 backdrop-blur-sm animate-fade-in">
          <div className="bento-card border-slate-800 w-full max-w-sm shadow-2xl animate-modal-in">
            <div className="px-5 py-3.5 border-b border-slate-800/80 flex items-center justify-between">
              <div>
                <span className="eyebrow text-slate-400 block mb-0.5">WALLET ADJUSTMENT</span>
                <h2 className="font-bold text-slate-100 text-sm tracking-tight">
                  {walletModal.type === "add" ? "Cộng tiền vào ví" : "Trừ tiền khỏi ví"}
                </h2>
                <p className="text-[11px] font-mono text-slate-500 mt-0.5">
                  Số dư hiện tại: <span className="text-emerald-400 font-semibold">{formatCurrency(walletModal.user?.wallet?.balance ?? 0)}</span>
                </p>
              </div>
              <button
                onClick={() => setWalletModal(null)}
                className="text-slate-400 hover:text-slate-200 p-1 rounded hover:bg-slate-800/60 transition-colors cursor-pointer"
              >
                <X size={16} />
              </button>
            </div>

            <div className="p-5 space-y-3.5 text-xs font-mono">
              {/* Quick amounts */}
              <div>
                <span className="eyebrow text-slate-400 block mb-1.5">CHỌN NHANH</span>
                <div className="grid grid-cols-4 gap-1.5">
                  {QUICK_AMOUNTS.map((a) => (
                    <button
                      key={a}
                      onClick={() => setWalletAmount(String(a))}
                      className={`py-1.5 rounded-md text-xs font-mono transition-all border cursor-pointer ${
                        String(walletAmount) === String(a)
                          ? "bg-indigo-500/15 border-indigo-500/40 text-indigo-300 font-bold"
                          : "border-slate-800 text-slate-400 hover:bg-slate-800 hover:text-slate-200"
                      }`}
                    >
                      {a >= 1000 ? `${a / 1000}k` : a}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="text-[10px] text-slate-400 block mb-1 uppercase tracking-wider">Số tiền (VND)</label>
                <input
                  type="number"
                  value={walletAmount}
                  onChange={(e) => setWalletAmount(e.target.value)}
                  className="w-full dev-input px-3 py-2 text-xs font-mono"
                  placeholder="50000"
                />
              </div>
              <div>
                <label className="text-[10px] text-slate-400 block mb-1 uppercase tracking-wider">Ghi chú</label>
                <input
                  type="text"
                  value={walletNote}
                  onChange={(e) => setWalletNote(e.target.value)}
                  className="w-full dev-input px-3 py-2 text-xs font-sans"
                  placeholder="Lý do điều chỉnh..."
                />
              </div>

              <button
                onClick={() => adjustMut.mutate({
                  id: walletModal.user.id,
                  amount: walletModal.type === "deduct" ? -Math.abs(Number(walletAmount)) : Number(walletAmount),
                  note: walletNote,
                })}
                disabled={!walletAmount || Number(walletAmount) <= 0 || adjustMut.isPending}
                className={`w-full py-2 rounded-lg text-xs font-mono font-medium disabled:opacity-50 transition-all cursor-pointer shadow-sm ${
                  walletModal.type === "add"
                    ? "bg-emerald-600 hover:bg-emerald-500 text-white"
                    : "bg-rose-600 hover:bg-rose-500 text-white"
                }`}
              >
                {adjustMut.isPending
                  ? "ĐANG XỬ LÝ..."
                  : walletModal.type === "add"
                  ? `XÁC NHẬN CỘNG ${walletAmount ? formatCurrency(Number(walletAmount)) : "..."}`
                  : `XÁC NHẬN TRỪ ${walletAmount ? formatCurrency(Number(walletAmount)) : "..."}`}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
