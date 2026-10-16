import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ShoppingCart, DollarSign, Wallet, CheckCircle2, Search, RefreshCw,
  Eye, Copy, Check, AlertTriangle, KeyRound, DownloadCloud, RotateCcw,
  Sparkles, ExternalLink, Calendar, Filter, X
} from "lucide-react";
import { api } from "../api/endpoints";
import TabFilter from "../components/TabFilter";
import Pagination from "../components/Pagination";
import Badge from "../components/Badge";
import EmptyState from "../components/EmptyState";
import StatsCard from "../components/StatsCard";
import Modal from "../components/Modal";
import { formatCurrency, formatDate, formatOrderCode } from "../utils/format";

const STATUS_TABS = [
  { value: "", label: "Tất cả" },
  { value: "DELIVERED", label: "Đã giao" },
  { value: "PAID", label: "Đã TT (chờ giao)" },
  { value: "PENDING", label: "Chờ thanh toán" },
  { value: "CANCELED", label: "Đã hủy" },
];

const KIND_OPTIONS = [
  { value: "", label: "Tất cả loại đơn" },
  { value: "new", label: "🛍️ Mua mới" },
  { value: "renew", label: "🔄 Gia hạn" },
];

function fmtTokens(n) {
  const m = Number(n || 0) / 1e6;
  if (m >= 1000) return `${Number((m / 1000).toFixed(1))}B`;
  if (Number.isInteger(m)) return `${m}M`;
  return `${Number(m.toFixed(2))}M`;
}

export default function KeyOrders() {
  const [tab, setTab] = useState("");
  const [kind, setKind] = useState("");
  const [profileId, setProfileId] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [detailOrder, setDetailOrder] = useState(null);
  const [copiedKeyId, setCopiedKeyId] = useState(null);

  const qc = useQueryClient();

  // Fetch servers for filter dropdown
  const { data: cfgData } = useQuery({
    queryKey: ["gpt2api-config"],
    queryFn: api.gpt2apiConfig,
    staleTime: 60_000,
  });
  const servers = cfgData?.effectiveProfiles || [];

  // Query key orders
  const { data, isLoading, isFetching } = useQuery({
    queryKey: ["key-orders", { page, pageSize, status: tab, kind, profileId, q: search, startDate, endDate }],
    queryFn: () => api.keyOrders({
      page,
      limit: pageSize,
      status: tab || undefined,
      kind: kind || undefined,
      profileId: profileId || undefined,
      q: search || undefined,
      startDate: startDate || undefined,
      endDate: endDate || undefined,
    }),
  });

  const retryMut = useMutation({
    mutationFn: (id) => api.retryKeyOrder(id),
    onSuccess: () => {
      qc.invalidateQueries(["key-orders"]);
    },
  });

  const orders = data?.orders || [];
  const total = data?.total || 0;
  const stats = data?.stats || {};
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  function applySearch(e) {
    e?.preventDefault();
    setSearch(searchInput.trim());
    setPage(1);
  }

  function setPreset(days) {
    const end = new Date().toISOString().split("T")[0];
    if (days === 0) {
      setStartDate(end);
      setEndDate(end);
    } else {
      const start = new Date();
      start.setDate(start.getDate() - days);
      setStartDate(start.toISOString().split("T")[0]);
      setEndDate(end);
    }
    setPage(1);
  }

  function copyKey(key, id) {
    if (!key) return;
    navigator.clipboard.writeText(key);
    setCopiedKeyId(id);
    setTimeout(() => setCopiedKeyId(null), 2000);
  }

  function exportCSV() {
    if (!orders.length) return;
    const headers = ["Mã đơn", "Khách hàng", "Telegram ID", "Loại", "Token (M)", "RPM", "Hạn (ngày)", "Server", "Số tiền (VND)", "Số tiền (USD)", "PT Thanh toán", "Trạng thái", "Key API", "Thời gian"];
    const rows = orders.map((o) => [
      o.code,
      `"${o.userName || ""}"`,
      `"${o.telegramId}"`,
      `"${o.kindLabel}"`,
      Number(o.tokenAmount / 1e6).toFixed(1),
      o.rpm,
      o.validDays,
      `"${o.profileName}"`,
      o.amountVnd,
      o.amountUsd || 0,
      `"${o.paymentMethod || ""}"`,
      `"${o.status}"`,
      `"${o.keyFull || ""}"`,
      `"${formatDate(o.createdAt)}"`,
    ]);
    const csvContent = "\uFEFF" + [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `key-orders-${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <div className="eyebrow text-electric-cyan mb-1 flex items-center gap-2">
            <span>COMMERCE // KEY ORDERS & AUDIT</span>
          </div>
          <h1 className="text-xl font-bold tracking-tight text-slate-100 font-display flex items-center gap-2">
            <ShoppingCart className="text-electric-indigo" size={22} />
            Đơn hàng key
          </h1>
          <p className="text-xs text-slate-400 mt-0.5">
            Theo dõi, xử lý và đối soát đơn mua mới & gia hạn API key từ bot Telegram và web shop
          </p>
        </div>

        <div className="flex items-center gap-2">
          <span className="mono-badge text-[10px] bg-indigo-950/60 text-indigo-300 border border-indigo-800/60">
            TOTAL: {stats.totalOrders || total || 0} ĐƠN
          </span>
          <button
            onClick={() => qc.invalidateQueries(["key-orders"])}
            disabled={isFetching}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-900 border border-slate-800 hover:border-slate-700 rounded-lg text-xs font-mono text-slate-300 hover:text-white transition-colors disabled:opacity-50"
          >
            <RefreshCw size={12} className={isFetching ? "animate-spin text-electric-cyan" : ""} />
            Làm mới
          </button>
          <button
            onClick={exportCSV}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-900 border border-slate-800 hover:border-slate-700 rounded-lg text-xs font-mono text-slate-300 hover:text-white transition-colors"
          >
            <DownloadCloud size={12} />
            Xuất CSV
          </button>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <StatsCard
          icon={ShoppingCart}
          label="Tổng đơn key"
          eyebrow="TOTAL ORDERS"
          value={(stats.totalOrders || total || 0).toLocaleString()}
          iconBg="bg-indigo-500/10"
          iconColor="text-electric-indigo"
        />
        <StatsCard
          icon={DollarSign}
          label="Doanh thu (USD)"
          eyebrow="REVENUE (USD)"
          value={`$${Number(stats.totalRevenueUsd || 0).toFixed(2)}`}
          iconBg="bg-emerald-500/10"
          iconColor="text-emerald-400"
        />
        <StatsCard
          icon={Wallet}
          label="Doanh thu (VNĐ)"
          eyebrow="REVENUE (VND)"
          value={formatCurrency(stats.totalRevenueVnd || 0)}
          iconBg="bg-cyan-500/10"
          iconColor="text-electric-cyan"
        />
        <StatsCard
          icon={CheckCircle2}
          label="Giao thành công"
          eyebrow="DELIVERED"
          value={`${stats.deliveredCount || 0} đơn`}
          iconBg="bg-amber-500/10"
          iconColor="text-amber-400"
        />
      </div>

      {/* Filter and Search Bar */}
      <div className="bento-card p-4 space-y-3.5">
        {/* Status Tabs */}
        <TabFilter
          tabs={STATUS_TABS}
          active={tab}
          onChange={(v) => { setTab(v); setPage(1); }}
        />

        {/* Filter controls row */}
        <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-center">
          {/* Search box */}
          <form onSubmit={applySearch} className="md:col-span-5 flex gap-2">
            <div className="relative flex-1">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
              <input
                type="text"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                placeholder="Tìm mã đơn, Telegram ID, @user, key sk-..."
                className="w-full glass-input rounded-lg pl-9 pr-3 py-2 text-xs"
              />
            </div>
            <button
              type="submit"
              className="px-3 py-2 bg-primary-600 text-white rounded-lg text-xs font-medium hover:bg-primary-500 transition-colors"
            >
              Tìm
            </button>
            {search && (
              <button
                type="button"
                onClick={() => { setSearchInput(""); setSearch(""); setPage(1); }}
                className="p-2 text-gray-400 hover:text-white glass rounded-lg"
                title="Xoá tìm kiếm"
              >
                <X size={14} />
              </button>
            )}
          </form>

          {/* Kind Filter */}
          <div className="md:col-span-2">
            <select
              value={kind}
              onChange={(e) => { setKind(e.target.value); setPage(1); }}
              className="w-full glass-input rounded-lg px-2.5 py-2 text-xs"
            >
              {KIND_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>

          {/* Server Filter */}
          <div className="md:col-span-2">
            <select
              value={profileId}
              onChange={(e) => { setProfileId(e.target.value); setPage(1); }}
              className="w-full glass-input rounded-lg px-2.5 py-2 text-xs"
            >
              <option value="">Tất cả Server</option>
              {servers.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>

          {/* Date presets */}
          <div className="md:col-span-3 flex items-center justify-end gap-1 text-xs">
            <button
              type="button"
              onClick={() => setPreset(0)}
              className="px-2 py-1.5 rounded bg-white/[0.04] hover:bg-white/[0.08] text-gray-400 hover:text-gray-200"
            >
              Hôm nay
            </button>
            <button
              type="button"
              onClick={() => setPreset(7)}
              className="px-2 py-1.5 rounded bg-white/[0.04] hover:bg-white/[0.08] text-gray-400 hover:text-gray-200"
            >
              7 ngày
            </button>
            <button
              type="button"
              onClick={() => setPreset(30)}
              className="px-2 py-1.5 rounded bg-white/[0.04] hover:bg-white/[0.08] text-gray-400 hover:text-gray-200"
            >
              30 ngày
            </button>
            {(startDate || endDate) && (
              <button
                type="button"
                onClick={() => { setStartDate(""); setEndDate(""); setPage(1); }}
                className="px-2 py-1.5 rounded text-amber-400 hover:text-amber-300"
              >
                Xóa ngày
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Main Table */}
      <div className="bento-card overflow-hidden">
        {isLoading ? (
          <div className="p-12 text-center text-gray-500 text-sm">
            <RefreshCw size={20} className="animate-spin mx-auto mb-2 opacity-50" />
            Đang tải danh sách đơn hàng key...
          </div>
        ) : orders.length === 0 ? (
          <EmptyState
            title="Không tìm thấy đơn hàng key nào"
            description={search || tab || kind ? "Thử thay đổi bộ lọc hoặc từ khoá tìm kiếm." : "Chưa có đơn hàng key nào trong hệ thống."}
            icon={ShoppingCart}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-white/[0.08] bg-white/[0.02] text-gray-400 uppercase tracking-wider font-semibold">
                  <th className="px-3.5 py-3">Mã đơn</th>
                  <th className="px-3.5 py-3">Khách hàng</th>
                  <th className="px-3.5 py-3">Gói Token</th>
                  <th className="px-3.5 py-3">Server</th>
                  <th className="px-3.5 py-3">Số tiền</th>
                  <th className="px-3.5 py-3">Trạng thái</th>
                  <th className="px-3.5 py-3">Key đã giao</th>
                  <th className="px-3.5 py-3">Thời gian</th>
                  <th className="px-3.5 py-3 text-right">Thao tác</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.05]">
                {orders.map((o) => (
                  <tr key={o.id} className="hover:bg-white/[0.02] transition-colors">
                    {/* Mã đơn */}
                    <td className="px-3.5 py-3 whitespace-nowrap">
                      <div className="flex items-center gap-1.5">
                        <span className="font-mono font-bold text-gray-200">#{o.code}</span>
                        <span className={`inline-flex px-1.5 py-0.5 rounded text-[10px] font-medium border ${
                          o.isRenew
                            ? "bg-amber-950/50 text-amber-300 border-amber-800/40"
                            : "bg-primary-950/50 text-primary-300 border-primary-800/40"
                        }`}>
                          {o.kindLabel}
                        </span>
                      </div>
                    </td>

                    {/* Khách hàng */}
                    <td className="px-3.5 py-3">
                      <div className="min-w-0">
                        <p className="font-medium text-gray-200 truncate">
                          {o.userName || "—"}
                          {o.userVip > 0 && (
                            <span className="ml-1 text-[10px] text-amber-400 font-bold">VIP{o.userVip}</span>
                          )}
                        </p>
                        <p className="text-[11px] text-gray-500 font-mono">
                          {o.userUsername ? `@${o.userUsername} · ` : ""}{o.telegramId}
                        </p>
                      </div>
                    </td>

                    {/* Gói Token */}
                    <td className="px-3.5 py-3 whitespace-nowrap">
                      <span className="font-bold text-emerald-300 text-xs">
                        {fmtTokens(o.tokenAmount)} token
                      </span>
                      <p className="text-[10px] text-gray-500">
                        {o.rpm > 0 ? `${o.rpm} RPM` : "RPM chuẩn"} · {o.validDays > 0 ? `${o.validDays} ngày` : "vô hạn"}
                      </p>
                    </td>

                    {/* Server */}
                    <td className="px-3.5 py-3 whitespace-nowrap">
                      <span className="inline-flex px-2 py-0.5 rounded-md bg-white/[0.05] border border-white/[0.08] text-[11px] text-gray-300">
                        {o.profileName}
                      </span>
                    </td>

                    {/* Số tiền */}
                    <td className="px-3.5 py-3 whitespace-nowrap">
                      <div className="font-medium text-gray-200">
                        {o.amountUsd != null ? (
                          <>
                            <span className="text-emerald-400 font-bold">${Number(o.amountUsd).toFixed(2)}</span>
                            <span className="text-gray-500 text-[11px]"> ({formatCurrency(o.amountVnd)})</span>
                          </>
                        ) : (
                          formatCurrency(o.amountVnd)
                        )}
                      </div>
                      <p className="text-[10px] text-gray-500 capitalize">
                        {o.paymentMethod || "Chưa TT"}
                      </p>
                    </td>

                    {/* Trạng thái */}
                    <td className="px-3.5 py-3 whitespace-nowrap">
                      <Badge status={o.status} />
                      {o.deliveryError && (
                        <p className="text-[10px] text-red-400 mt-0.5 truncate max-w-[120px]" title={o.deliveryError}>
                          Lỗi: {o.deliveryError}
                        </p>
                      )}
                    </td>

                    {/* Key đã giao */}
                    <td className="px-3.5 py-3 whitespace-nowrap">
                      {o.keyFull ? (
                        <div className="flex items-center gap-1.5">
                          <code className="text-[11px] font-mono text-gray-400 bg-black/30 px-1.5 py-0.5 rounded border border-white/[0.05]">
                            {o.keyMasked}
                          </code>
                          <button
                            onClick={() => copyKey(o.keyFull, o.id)}
                            className="p-1 text-gray-400 hover:text-white rounded hover:bg-white/[0.06] transition-colors"
                            title="Sao chép key sk-..."
                          >
                            {copiedKeyId === o.id ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} />}
                          </button>
                        </div>
                      ) : (
                        <span className="text-gray-600">—</span>
                      )}
                    </td>

                    {/* Thời gian */}
                    <td className="px-3.5 py-3 whitespace-nowrap text-gray-400 text-[11px]">
                      {formatDate(o.createdAt)}
                    </td>

                    {/* Thao tác */}
                    <td className="px-3.5 py-3 whitespace-nowrap text-right">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => setDetailOrder(o)}
                          className="px-2.5 py-1.5 rounded-lg bg-white/[0.06] hover:bg-white/[0.1] text-gray-300 hover:text-white transition-colors flex items-center gap-1 text-[11px]"
                          title="Xem chi tiết đơn"
                        >
                          <Eye size={12} /> Chi tiết
                        </button>
                        {o.status === "PAID" && (
                          <button
                            onClick={() => retryMut.mutate(o.id)}
                            disabled={retryMut.isPending}
                            className="px-2.5 py-1.5 rounded-lg bg-emerald-600/20 border border-emerald-700/40 text-emerald-300 hover:bg-emerald-600/30 transition-colors flex items-center gap-1 text-[11px] disabled:opacity-50"
                            title="Thử giao lại đơn này"
                          >
                            <RotateCcw size={12} className={retryMut.isPending ? "animate-spin" : ""} /> Giao lại
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {total > 0 && (
          <div className="p-4 border-t border-white/[0.06]">
            <Pagination
              page={page}
              totalPages={totalPages}
              total={total}
              pageSize={pageSize}
              onPage={setPage}
              onPageSize={(s) => { setPageSize(s); setPage(1); }}
            />
          </div>
        )}
      </div>

      {/* Modal Chi tiết đơn hàng key */}
      {detailOrder && (
        <Modal
          open={!!detailOrder}
          onClose={() => setDetailOrder(null)}
          title={`Chi tiết đơn hàng key #${detailOrder.code}`}
          width="max-w-xl"
        >
          <div className="space-y-4 text-xs">
            <div className="flex items-center justify-between pb-3 border-b border-white/[0.08]">
              <div>
                <p className="text-gray-400">Mã đơn hệ thống</p>
                <code className="text-sm font-mono text-gray-200">{detailOrder.id}</code>
              </div>
              <div className="text-right">
                <Badge status={detailOrder.status} />
                <p className="text-[11px] text-gray-500 mt-0.5">{formatDate(detailOrder.createdAt)}</p>
              </div>
            </div>

            {/* Thông tin khách */}
            <div className="grid grid-cols-2 gap-3 glass p-3 rounded-lg">
              <div>
                <p className="text-gray-500">Khách hàng</p>
                <p className="text-gray-200 font-medium">{detailOrder.userName || "—"}</p>
              </div>
              <div>
                <p className="text-gray-500">Telegram ID</p>
                <p className="font-mono text-gray-300">{detailOrder.telegramId}</p>
              </div>
              <div>
                <p className="text-gray-500">Số tiền (VND)</p>
                <p className="text-gray-200 font-medium">{formatCurrency(detailOrder.amountVnd)}</p>
              </div>
              <div>
                <p className="text-gray-500">Số tiền (USD)</p>
                <p className="text-emerald-400 font-medium">
                  {detailOrder.amountUsd != null ? `$${detailOrder.amountUsd.toFixed(2)}` : "—"}
                </p>
              </div>
            </div>

            {/* Thông số kỹ thuật key */}
            <div className="glass p-3 rounded-lg space-y-2">
              <p className="font-semibold text-gray-300 flex items-center gap-1.5">
                <KeyRound size={14} className="text-primary-400" />
                Thông số gói key API
              </p>
              <div className="grid grid-cols-2 gap-2 text-gray-400">
                <div>Loại đơn: <b className="text-gray-200">{detailOrder.kindLabel}</b></div>
                <div>Server: <b className="text-gray-200">{detailOrder.profileName}</b></div>
                <div>Lượng token: <b className="text-emerald-300">{fmtTokens(detailOrder.tokenAmount)} token</b></div>
                <div>RPM: <b className="text-gray-200">{detailOrder.rpm > 0 ? detailOrder.rpm : "Mặc định"}</b></div>
                <div>Thời hạn: <b className="text-gray-200">{detailOrder.validDays > 0 ? `${detailOrder.validDays} ngày` : "Vô hạn"}</b></div>
                <div>Phương thức TT: <b className="text-gray-200 uppercase">{detailOrder.paymentMethod || "—"}</b></div>
              </div>
            </div>

            {/* Chuỗi key */}
            {detailOrder.keyFull && (
              <div className="space-y-1.5">
                <p className="text-gray-400 font-medium">Chuỗi API Key (sk-...)</p>
                <div className="flex items-center gap-2">
                  <code className="flex-1 bg-black/40 text-emerald-300 font-mono px-3 py-2 rounded-lg text-xs break-all border border-white/[0.08]">
                    {detailOrder.keyFull}
                  </code>
                  <button
                    onClick={() => copyKey(detailOrder.keyFull, "modal")}
                    className="p-2 glass rounded-lg text-gray-400 hover:text-white transition-colors"
                  >
                    {copiedKeyId === "modal" ? <Check size={14} className="text-emerald-400" /> : <Copy size={14} />}
                  </button>
                </div>
              </div>
            )}

            {detailOrder.deliveryError && (
              <div className="p-3 rounded-lg bg-red-950/40 border border-red-800/40 text-red-300">
                <p className="font-semibold flex items-center gap-1">
                  <AlertTriangle size={13} /> Lỗi giao hàng:
                </p>
                <p className="text-[11px] mt-1 break-words">{detailOrder.deliveryError}</p>
              </div>
            )}

            <div className="flex justify-end gap-2 pt-2 border-t border-white/[0.08]">
              {detailOrder.status === "PAID" && (
                <button
                  onClick={() => {
                    retryMut.mutate(detailOrder.id);
                    setDetailOrder(null);
                  }}
                  disabled={retryMut.isPending}
                  className="px-3 py-2 bg-emerald-600 text-white rounded-lg font-medium hover:bg-emerald-500 transition-colors flex items-center gap-1.5"
                >
                  <RotateCcw size={13} /> Giao lại đơn này
                </button>
              )}
              <button
                onClick={() => setDetailOrder(null)}
                className="px-4 py-2 glass rounded-lg text-gray-300 hover:text-white transition-colors"
              >
                Đóng
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
