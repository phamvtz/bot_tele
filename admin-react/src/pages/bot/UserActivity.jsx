import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Activity, RefreshCw, ShoppingCart, Wallet, ArrowDownLeft, ArrowUpRight,
  UserMinus, RotateCcw, Search, Clock,
} from "lucide-react";
import { api } from "../../api/endpoints";
import Pagination from "../../components/Pagination";
import EmptyState from "../../components/EmptyState";
import { formatCurrency, formatDate } from "../../utils/format";

// ── Config ─────────────────────────────────────────────────────────────────────
const ORDER_STATUS = {
  PENDING:   { label: "Chờ TT",   cls: "bg-gray-800/60 text-gray-400 border-gray-700/50" },
  PAID:      { label: "Đã TT",    cls: "bg-emerald-950/60 text-emerald-400 border-emerald-800/50" },
  DELIVERED: { label: "Hoàn thành", cls: "bg-blue-950/60 text-blue-400 border-blue-800/50" },
  CANCELED:  { label: "Đã hủy",   cls: "bg-red-950/60 text-red-400 border-red-800/50" },
};

const TX_CFG = {
  DEPOSIT:      { icon: ArrowDownLeft, color: "emerald", label: "Nạp ví",    bg: "bg-emerald-950/60", text: "text-emerald-400", border: "border-emerald-800/50" },
  PURCHASE:     { icon: ShoppingCart,  color: "purple",  label: "Mua hàng",  bg: "bg-purple-950/60",  text: "text-purple-400",  border: "border-purple-800/50" },
  REFUND:       { icon: RotateCcw,     color: "cyan",    label: "Hoàn tiền", bg: "bg-cyan-950/60",    text: "text-cyan-400",    border: "border-cyan-800/50" },
  ADMIN_ADD:    { icon: ArrowDownLeft, color: "blue",    label: "Admin cộng",bg: "bg-blue-950/60",    text: "text-blue-400",    border: "border-blue-800/50" },
  ADMIN_DEDUCT: { icon: ArrowUpRight,  color: "red",     label: "Admin trừ", bg: "bg-red-950/60",     text: "text-red-400",     border: "border-red-800/50" },
};

const PAYMENT_LABELS = { vietqr: "VietQR", wallet: "Ví", free: "Miễn phí" };

const VIP_BADGE = [null, "🥈", "⭐", "💎"];

// ── Components ────────────────────────────────────────────────────────────────
function Avatar({ user, telegramId }) {
  const name = user?.firstName || user?.username || telegramId || "?";
  const initials = name.slice(0, 2).toUpperCase();
  const colors = ["from-indigo-500 to-purple-600", "from-emerald-500 to-teal-600",
    "from-orange-500 to-amber-600", "from-pink-500 to-rose-600", "from-cyan-500 to-blue-600"];
  const colorClass = colors[(name.charCodeAt(0) || 0) % colors.length];
  return (
    <div className={`w-8 h-8 rounded-full bg-gradient-to-br ${colorClass} flex items-center justify-center flex-shrink-0 text-white font-bold text-xs`}>
      {initials}
    </div>
  );
}

function UserInfo({ user, telegramId }) {
  const display = user?.firstName || user?.username || `ID:${telegramId}`;
  const sub = user?.username ? `@${user.username}` : telegramId;
  const vip = user?.vipLevel;
  return (
    <div className="min-w-0">
      <div className="flex items-center gap-1.5">
        <span className="text-sm text-white font-medium truncate max-w-[120px]">{display}</span>
        {vip > 0 && VIP_BADGE[vip] && <span className="text-xs">{VIP_BADGE[vip]}</span>}
      </div>
      <div className="text-xs text-gray-500 truncate max-w-[120px]">{sub}</div>
    </div>
  );
}

function OrderStatusBadge({ status }) {
  const cfg = ORDER_STATUS[status] || { label: status, cls: "bg-gray-800/60 text-gray-400 border-gray-700/50" };
  return (
    <span className={`text-xs px-2 py-0.5 rounded border ${cfg.cls} whitespace-nowrap`}>{cfg.label}</span>
  );
}

function TxBadge({ txType }) {
  const cfg = TX_CFG[txType] || { label: txType, bg: "bg-gray-800/60", text: "text-gray-400", border: "border-gray-700/50", icon: Wallet };
  const Icon = cfg.icon;
  return (
    <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded border ${cfg.bg} ${cfg.text} ${cfg.border} whitespace-nowrap`}>
      <Icon size={10} />
      {cfg.label}
    </span>
  );
}

// ── Tabs config ───────────────────────────────────────────────────────────────
const ORDER_STATUS_TABS = [
  { value: "", label: "Tất cả" },
  { value: "PAID", label: "Đã thanh toán" },
  { value: "PENDING", label: "Chờ TT" },
  { value: "DELIVERED", label: "Hoàn thành" },
  { value: "CANCELED", label: "Đã hủy" },
];

const WALLET_TYPE_TABS = [
  { value: "", label: "Tất cả" },
  { value: "DEPOSIT", label: "Nạp ví" },
  { value: "PURCHASE", label: "Mua hàng" },
  { value: "ADMIN_ADD,ADMIN_DEDUCT", label: "Thủ công" },
  { value: "REFUND", label: "Hoàn tiền" },
];

// ── Main ───────────────────────────────────────────────────────────────────────
export default function UserActivity() {
  const [mainTab, setMainTab] = useState("order"); // "order" | "wallet"
  const [subFilter, setSubFilter] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(30);
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");

  const queryParams = {
    type: mainTab,
    page, limit: pageSize,
    ...(search ? { search } : {}),
    ...(mainTab === "order" && subFilter ? { status: subFilter } : {}),
    ...(mainTab === "wallet" && subFilter ? { txType: subFilter } : {}),
  };

  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ["user-activity", queryParams],
    queryFn: () => api.userActivity(queryParams),
    staleTime: 30_000,
  });

  const activities = data?.activities || [];
  const total = data?.total || 0;
  const totalPages = Math.ceil(total / pageSize) || 1;

  function switchMain(tab) {
    setMainTab(tab);
    setSubFilter("");
    setPage(1);
  }
  function switchSub(v) { setSubFilter(v); setPage(1); }

  function doSearch(e) {
    e.preventDefault();
    setSearch(searchInput.trim());
    setPage(1);
  }

  const subTabs = mainTab === "order" ? ORDER_STATUS_TABS : WALLET_TYPE_TABS;

  return (
    <div>
      {/* Header */}
      <div className="flex items-start justify-between mb-5">
        <div>
          <h1 className="text-xl font-bold text-white mb-0.5">Hoạt động người dùng</h1>
          <p className="text-sm text-gray-500">Theo dõi đơn hàng và giao dịch ví theo thời gian thực</p>
        </div>
        <button
          onClick={() => refetch()}
          disabled={isFetching}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/[0.06] hover:bg-white/[0.10] text-sm text-gray-300 transition-colors disabled:opacity-50"
        >
          <RefreshCw size={13} className={isFetching ? "animate-spin" : ""} />
          Tải lại
        </button>
      </div>

      {/* Main tabs */}
      <div className="flex gap-2 mb-3">
        <button
          onClick={() => switchMain("order")}
          className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${mainTab === "order"
            ? "bg-indigo-600/40 text-indigo-300 border border-indigo-500/40"
            : "bg-white/[0.04] text-gray-400 hover:bg-white/[0.08] border border-transparent"}`}
        >
          <ShoppingCart size={13} />
          Đơn hàng
        </button>
        <button
          onClick={() => switchMain("wallet")}
          className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${mainTab === "wallet"
            ? "bg-indigo-600/40 text-indigo-300 border border-indigo-500/40"
            : "bg-white/[0.04] text-gray-400 hover:bg-white/[0.08] border border-transparent"}`}
        >
          <Wallet size={13} />
          Giao dịch ví
        </button>

        {/* Search */}
        <form onSubmit={doSearch} className="ml-auto flex items-center gap-2">
          <div className="relative">
            <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-500" />
            <input
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Tìm Telegram ID..."
              className="glass-input pl-7 pr-3 py-1.5 text-sm rounded-lg w-44"
            />
          </div>
          <button type="submit" className="px-3 py-1.5 text-sm bg-white/[0.06] hover:bg-white/[0.10] text-gray-300 rounded-lg transition-colors">
            Tìm
          </button>
          {search && (
            <button type="button" onClick={() => { setSearch(""); setSearchInput(""); setPage(1); }}
              className="text-xs text-gray-500 hover:text-gray-300 transition-colors">✕</button>
          )}
        </form>
      </div>

      {/* Sub-filter tabs */}
      <div className="flex gap-1 mb-4 flex-wrap">
        {subTabs.map((t) => (
          <button
            key={t.value}
            onClick={() => switchSub(t.value)}
            className={`px-3 py-1 rounded-md text-xs transition-colors ${
              subFilter === t.value
                ? "bg-white/[0.10] text-white border border-white/[0.15]"
                : "text-gray-500 hover:text-gray-300 hover:bg-white/[0.05]"
            }`}
          >
            {t.label}
          </button>
        ))}
        <span className="ml-auto text-xs text-gray-600 self-center">{total} bản ghi</span>
      </div>

      {/* Feed */}
      <div className="glass rounded-xl overflow-hidden">
        {isLoading ? (
          <div className="flex items-center justify-center py-16 text-sm text-gray-400 gap-2">
            <RefreshCw size={14} className="animate-spin" /> Đang tải...
          </div>
        ) : activities.length === 0 ? (
          <EmptyState icon={Activity} message="Không có hoạt động nào" />
        ) : (
          <>
            <div className="divide-y divide-white/[0.04]">
              {activities.map((a) => (
                <div key={a.id} className="flex items-center gap-3 px-4 py-3 hover:bg-white/[0.03] transition-colors">
                  {/* Avatar */}
                  <Avatar user={a.user} telegramId={a.telegramId} />

                  {/* User info */}
                  <UserInfo user={a.user} telegramId={a.telegramId} />

                  {/* Action details */}
                  <div className="flex-1 min-w-0 ml-1">
                    {a.type === "order" ? (
                      <div className="flex items-center gap-2 flex-wrap">
                        <ShoppingCart size={12} className="text-gray-500 flex-shrink-0" />
                        <span className="text-sm text-gray-300 truncate max-w-[160px]">{a.productName}</span>
                        {a.quantity > 1 && <span className="text-xs text-gray-600">×{a.quantity}</span>}
                        {a.paymentMethod && (
                          <span className="text-xs text-gray-600">
                            · {PAYMENT_LABELS[a.paymentMethod] || a.paymentMethod}
                          </span>
                        )}
                      </div>
                    ) : (
                      <div className="flex items-center gap-2 flex-wrap">
                        <TxBadge txType={a.txType} />
                        {a.description && (
                          <span className="text-xs text-gray-500 truncate max-w-[160px]">
                            {String(a.description).slice(0, 50)}
                          </span>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Amount + status */}
                  <div className="flex flex-col items-end gap-1 flex-shrink-0">
                    <span className={`text-sm font-semibold ${a.type === "order" ? "text-white" : (a.amount >= 0 ? "text-emerald-400" : "text-red-400")}`}>
                      {a.type === "wallet" && a.amount >= 0 ? "+" : ""}
                      {formatCurrency(Math.abs(a.amount || 0))}
                    </span>
                    {a.type === "order" ? (
                      <OrderStatusBadge status={a.status} />
                    ) : (
                      <span className="text-xs text-gray-600">{a.txType === "DEPOSIT" ? "PENDING→" : ""}{a.status}</span>
                    )}
                  </div>

                  {/* Time */}
                  <div className="flex-shrink-0 text-xs text-gray-500 whitespace-nowrap flex items-center gap-1 ml-2">
                    <Clock size={10} />
                    {formatDate(a.createdAt)}
                  </div>
                </div>
              ))}
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
    </div>
  );
}
