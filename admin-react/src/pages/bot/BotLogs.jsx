import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ScrollText, RefreshCw, Package, ShoppingCart, Users, Archive,
  Settings, ChevronDown, ChevronRight, Plus, Pencil, Trash2,
  ToggleLeft, Wallet, Ban, UserCheck, Box, Send, Zap, Search,
} from "lucide-react";
import { api } from "../../api/endpoints";
import Pagination from "../../components/Pagination";
import EmptyState from "../../components/EmptyState";
import { formatDate } from "../../utils/format";

// ── Action config ──────────────────────────────────────────────────────────────
const ACTION_CFG = {
  // Products
  CREATE_PRODUCT:      { icon: Plus,       color: "emerald", label: "Tạo sản phẩm",       group: "product" },
  UPDATE_PRODUCT:      { icon: Pencil,     color: "blue",    label: "Sửa sản phẩm",        group: "product" },
  DELETE_PRODUCT:      { icon: Trash2,     color: "red",     label: "Xóa sản phẩm",        group: "product" },
  TOGGLE_PRODUCT:      { icon: ToggleLeft, color: "yellow",  label: "Bật/tắt sản phẩm",   group: "product" },
  IMPORT_PRODUCTS:     { icon: Package,    color: "purple",  label: "Import sản phẩm",     group: "product" },
  // Orders
  UPDATE_ORDER_STATUS: { icon: ShoppingCart, color: "blue",  label: "Cập nhật đơn hàng",  group: "order" },
  // Customers
  ADJUST_WALLET:       { icon: Wallet,     color: "emerald", label: "Điều chỉnh ví",       group: "customer" },
  BLOCK_USER:          { icon: Ban,        color: "red",     label: "Khóa người dùng",     group: "customer" },
  UNBLOCK_USER:        { icon: UserCheck,  color: "emerald", label: "Mở khóa người dùng", group: "customer" },
  // Stock
  BULK_ADD_STOCK:      { icon: Box,        color: "cyan",    label: "Nhập kho",            group: "stock" },
  DELETE_STOCK_ITEM:   { icon: Trash2,     color: "red",     label: "Xóa stock item",      group: "stock" },
  CLEAR_UNSOLD_STOCK:  { icon: Archive,    color: "orange",  label: "Xóa stock chưa bán", group: "stock" },
  // System / other
  SEND_BROADCAST:      { icon: Send,       color: "purple",  label: "Gửi broadcast",       group: "system" },
  UPDATE_SETTINGS:     { icon: Settings,   color: "gray",    label: "Cập nhật cài đặt",   group: "system" },
  UPDATE_VIP_LEVEL:    { icon: Zap,        color: "yellow",  label: "Sửa VIP level",       group: "system" },
};

const COLOR = {
  emerald: { bg: "bg-emerald-950/60", text: "text-emerald-400", border: "border-emerald-800/50", dot: "bg-emerald-400" },
  blue:    { bg: "bg-blue-950/60",    text: "text-blue-400",    border: "border-blue-800/50",    dot: "bg-blue-400" },
  red:     { bg: "bg-red-950/60",     text: "text-red-400",     border: "border-red-800/50",     dot: "bg-red-400" },
  yellow:  { bg: "bg-yellow-950/60",  text: "text-yellow-400",  border: "border-yellow-800/50",  dot: "bg-yellow-400" },
  purple:  { bg: "bg-purple-950/60",  text: "text-purple-400",  border: "border-purple-800/50",  dot: "bg-purple-400" },
  cyan:    { bg: "bg-cyan-950/60",    text: "text-cyan-400",    border: "border-cyan-800/50",    dot: "bg-cyan-400" },
  orange:  { bg: "bg-orange-950/60",  text: "text-orange-400",  border: "border-orange-800/50",  dot: "bg-orange-400" },
  gray:    { bg: "bg-gray-800/60",    text: "text-gray-400",    border: "border-gray-700/50",    dot: "bg-gray-400" },
};

const TABS = [
  { id: "all",      label: "Tất cả",    icon: ScrollText,  actions: null },
  { id: "product",  label: "Sản phẩm",  icon: Package,     actions: ["CREATE_PRODUCT","UPDATE_PRODUCT","DELETE_PRODUCT","TOGGLE_PRODUCT","IMPORT_PRODUCTS"] },
  { id: "order",    label: "Đơn hàng",  icon: ShoppingCart,actions: ["UPDATE_ORDER_STATUS"] },
  { id: "customer", label: "Khách hàng",icon: Users,       actions: ["ADJUST_WALLET","BLOCK_USER","UNBLOCK_USER"] },
  { id: "stock",    label: "Kho",       icon: Box,         actions: ["BULK_ADD_STOCK","DELETE_STOCK_ITEM","CLEAR_UNSOLD_STOCK"] },
  { id: "system",   label: "Hệ thống",  icon: Settings,    actions: ["SEND_BROADCAST","UPDATE_SETTINGS","UPDATE_VIP_LEVEL"] },
];

function ActionBadge({ action }) {
  const cfg = ACTION_CFG[action];
  if (!cfg) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs px-2 py-1 rounded-md bg-gray-800/60 text-gray-400 border border-gray-700/50 font-mono">
        {action}
      </span>
    );
  }
  const c = COLOR[cfg.color];
  const Icon = cfg.icon;
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs px-2 py-1 rounded-md ${c.bg} ${c.text} border ${c.border} font-medium whitespace-nowrap`}>
      <Icon size={11} />
      {cfg.label}
    </span>
  );
}

function SourceBadge({ adminId }) {
  const isWeb = !adminId || adminId === "web-admin" || adminId === "admin";
  return isWeb ? (
    <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded bg-indigo-950/60 text-indigo-400 border border-indigo-800/50">
      🖥 Web
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded bg-sky-950/60 text-sky-400 border border-sky-800/50">
      🤖 {adminId}
    </span>
  );
}

function parseDetails(raw) {
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return raw; }
}

function DetailsPreview({ raw }) {
  const d = parseDetails(raw);
  if (!d) return <span className="text-gray-600">—</span>;
  if (typeof d === "string") return <span className="text-gray-400">{d}</span>;

  // Show meaningful fields based on action type
  const bits = [];
  if (d.name)           bits.push(<span key="name" className="text-white/80">"{d.name}"</span>);
  if (d.productName)    bits.push(<span key="pname" className="text-white/80">"{d.productName}"</span>);
  if (d.username)       bits.push(<span key="un" className="text-gray-400">@{d.username}</span>);
  if (d.firstName)      bits.push(<span key="fn" className="text-gray-400">{d.firstName}</span>);
  if (d.amount != null) bits.push(<span key="amt" className="text-emerald-400">{Number(d.amount).toLocaleString()}đ</span>);
  if (d.status)         bits.push(<span key="st" className="text-blue-400">{d.status}</span>);
  if (d.lines != null)  bits.push(<span key="ln" className="text-cyan-400">{d.lines} dòng</span>);
  if (d.count != null)  bits.push(<span key="cnt" className="text-cyan-400">{d.count} items</span>);
  if (d.sent != null)   bits.push(<span key="sent" className="text-emerald-400">{d.sent} gửi</span>);
  if (d.price != null)  bits.push(<span key="pr" className="text-yellow-400">{Number(d.price).toLocaleString()}đ</span>);
  if (d.message)        bits.push(<span key="msg" className="text-gray-400 italic">"{String(d.message).slice(0,40)}{d.message.length > 40 ? "…" : ""}"</span>);

  if (bits.length === 0) {
    const preview = JSON.stringify(d).slice(0, 60);
    return <span className="text-gray-500 font-mono text-xs">{preview}{JSON.stringify(d).length > 60 ? "…" : ""}</span>;
  }

  return (
    <span className="flex flex-wrap gap-1.5 items-center">
      {bits.map((b, i) => [b, i < bits.length - 1 ? <span key={`sep-${i}`} className="text-gray-600">·</span> : null])}
    </span>
  );
}

function DetailExpanded({ raw }) {
  const d = parseDetails(raw);
  if (!d) return null;
  const text = typeof d === "string" ? d : JSON.stringify(d, null, 2);
  return (
    <pre className="text-xs text-gray-300 bg-black/40 rounded-lg p-3 overflow-x-auto whitespace-pre-wrap break-all font-mono leading-relaxed">
      {text}
    </pre>
  );
}

export default function BotLogs() {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [tab, setTab] = useState("all");
  const [expanded, setExpanded] = useState(null);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [targetSearch, setTargetSearch] = useState("");

  function setPreset(days) {
    const end = new Date().toISOString().split("T")[0];
    if (days === 0) { setStartDate(end); setEndDate(end); }
    else { setStartDate(new Date(Date.now() - days * 86400000).toISOString().split("T")[0]); setEndDate(end); }
    setPage(1);
  }

  const activeTab = TABS.find(t => t.id === tab);
  const actionsParam = activeTab?.actions ? activeTab.actions.join(",") : undefined;

  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ["audit-logs", page, pageSize, tab, startDate, endDate, targetSearch],
    queryFn: () => api.auditLogs({ page, limit: pageSize, ...(actionsParam ? { actions: actionsParam } : {}), ...(startDate ? { startDate } : {}), ...(endDate ? { endDate } : {}), ...(targetSearch ? { target: targetSearch } : {}) }),
    staleTime: 30_000,
  });

  const logs = data?.logs || [];
  const total = data?.total || 0;
  const totalPages = Math.ceil(total / pageSize) || 1;

  const handleTab = (id) => { setTab(id); setPage(1); setExpanded(null); };
  const toggleExpand = (id) => setExpanded(p => p === id ? null : id);

  return (
    <div className="space-y-4 pb-10">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="eyebrow text-slate-400">AUDIT // SYSTEM & OPERATOR LOGS</span>
            <span className="w-1 h-1 rounded-full bg-slate-600" />
            <span className="text-[10px] font-mono text-indigo-400">AUDIT TRAIL</span>
          </div>
          <h1 className="text-xl font-bold text-slate-100 tracking-tight flex items-center gap-2">
            Nhật ký hành động
            <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-indigo-500/10 text-indigo-300 border border-indigo-500/25">
              {total} EVENTS
            </span>
          </h1>
          <p className="text-xs text-slate-400 mt-0.5 tracking-tight">
            Lịch sử thao tác cấu hình, kho, sản phẩm và điều chỉnh ví của quản trị viên qua Web và Bot
          </p>
        </div>
        <button
          onClick={() => refetch()}
          disabled={isFetching}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-slate-900 border border-slate-800 text-xs font-mono text-slate-300 hover:text-white hover:bg-slate-800 transition-colors disabled:opacity-50 cursor-pointer"
        >
          <RefreshCw size={12} className={isFetching ? "animate-spin text-indigo-400" : "text-slate-400"} />
          LÀM MỚI
        </button>
      </div>

      {/* Main Bento Card */}
      <div className="bento-card p-4 space-y-4">
        {/* Module tabs */}
        <div className="flex items-center gap-1.5 flex-wrap">
          {TABS.map((t) => {
            const Icon = t.icon;
            const active = tab === t.id;
            return (
              <button
                key={t.id}
                onClick={() => handleTab(t.id)}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-mono border transition-all cursor-pointer ${
                  active
                    ? "bg-indigo-600/20 text-indigo-300 border-indigo-500/40 font-semibold"
                    : "bg-slate-900/60 text-slate-400 border-slate-800 hover:text-slate-200 hover:bg-slate-800"
                }`}
              >
                <Icon size={12} />
                {t.label}
              </button>
            );
          })}
        </div>

        {/* Search + date filter toolbar */}
        <div className="flex items-center gap-2 flex-wrap pt-1 border-t border-slate-800/60">
          <div className="relative">
            <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500" />
            <input
              value={targetSearch}
              onChange={(e) => { setTargetSearch(e.target.value); setPage(1); }}
              placeholder="Target ID..."
              className="dev-input pl-7 pr-3 py-1 text-xs font-mono w-40"
            />
          </div>
          {[["Hôm nay", 0], ["7 ngày", 7], ["30 ngày", 30]].map(([label, days]) => (
            <button
              key={label}
              onClick={() => setPreset(days)}
              className="text-[11px] font-mono px-2.5 py-1 rounded-md bg-slate-900/80 text-slate-400 hover:text-slate-200 hover:bg-slate-800 border border-slate-800 transition-colors cursor-pointer"
            >
              {label}
            </button>
          ))}
          <input
            type="date"
            value={startDate}
            onChange={(e) => { setStartDate(e.target.value); setPage(1); }}
            className="dev-input px-2 py-1 text-xs font-mono text-slate-300 w-36"
          />
          <span className="text-slate-600 text-xs">→</span>
          <input
            type="date"
            value={endDate}
            onChange={(e) => { setEndDate(e.target.value); setPage(1); }}
            className="dev-input px-2 py-1 text-xs font-mono text-slate-300 w-36"
          />
          {(startDate || endDate || targetSearch) && (
            <button
              onClick={() => { setStartDate(""); setEndDate(""); setTargetSearch(""); setPage(1); }}
              className="text-[11px] font-mono text-slate-400 hover:text-rose-400 transition-colors cursor-pointer"
            >
              ✕ XÓA LỌC
            </button>
          )}
        </div>

        {/* Table */}
        {isLoading ? (
          <div className="py-16 text-center text-xs font-mono text-slate-500 animate-pulse">
            ĐANG TẢI DỮ LIỆU AUDIT LOGS...
          </div>
        ) : logs.length === 0 ? (
          <EmptyState icon={ScrollText} message="Không tìm thấy nhật ký thao tác nào" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-800/80 text-[10px] font-mono uppercase tracking-wider text-slate-400 bg-slate-900/40">
                  <th className="px-3 py-2.5 w-6"></th>
                  <th className="px-3 py-2.5">HÀNH ĐỘNG</th>
                  <th className="px-3 py-2.5">NGUỒN THAO TÁC</th>
                  <th className="px-3 py-2.5">TARGET</th>
                  <th className="px-3 py-2.5">CHI TIẾT</th>
                  <th className="px-3 py-2.5 text-right">THỜI GIAN</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/50">
                {logs.map((log) => {
                  const isOpen = expanded === log.id;
                  const cfg = ACTION_CFG[log.action];
                  const c = cfg ? COLOR[cfg.color] : COLOR.gray;
                  return (
                    <>
                      <tr
                        key={log.id}
                        onClick={() => log.details && toggleExpand(log.id)}
                        className={`transition-colors ${
                          log.details ? "cursor-pointer hover:bg-slate-800/30" : ""
                        } ${isOpen ? "bg-slate-800/40" : ""}`}
                      >
                        <td className="px-3 py-3 w-6 text-slate-500">
                          {log.details ? (
                            isOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />
                          ) : null}
                        </td>
                        <td className="px-3 py-3">
                          <ActionBadge action={log.action} />
                        </td>
                        <td className="px-3 py-3">
                          <SourceBadge adminId={log.adminId} />
                        </td>
                        <td className="px-3 py-3 text-xs text-slate-400 font-mono max-w-[120px] truncate">
                          {log.target ? (
                            <span className={`${c.text} opacity-90`}>{log.target}</span>
                          ) : "—"}
                        </td>
                        <td className="px-3 py-3 text-xs max-w-[280px]">
                          <DetailsPreview raw={log.details} />
                        </td>
                        <td className="px-3 py-3 text-[11px] font-mono text-slate-500 text-right whitespace-nowrap">
                          {formatDate(log.createdAt)}
                        </td>
                      </tr>
                      {isOpen && (
                        <tr key={`${log.id}-exp`} className="bg-[#050811] border-b border-slate-800/60">
                          <td colSpan={6} className="px-4 py-3">
                            <DetailExpanded raw={log.details} />
                          </td>
                        </tr>
                      )}
                    </>
                  );
                })}
              </tbody>
            </table>
            <div className="pt-2">
              <Pagination
                page={page}
                totalPages={totalPages}
                total={total}
                pageSize={pageSize}
                onPage={setPage}
                onPageSize={(s) => { setPageSize(s); setPage(1); }}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
