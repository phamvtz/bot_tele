import { useMemo, useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Zap, Ban, Trash2, CheckCircle2, ShoppingBag, Coins, AlertTriangle, X, Plus, Server, Bell, Sparkles, Search, RefreshCw, Eye, ShieldAlert, Flame } from "lucide-react";
import { api } from "../api/endpoints";
import Modal from "../components/Modal";
import EmptyState from "../components/EmptyState";
import { formatDate, relativeTime } from "../utils/format";

/**
 * Nhãn + màu trạng thái chuẩn của Flash Sale
 */
const STATUS = {
  SENDING: {
    label: "Đang gửi tin",
    badge: "📤 Đang gửi",
    cls: "bg-sky-500/10 text-sky-400 border-sky-500/30",
    dot: "bg-sky-400",
    ping: true,
  },
  OPENING: {
    label: "Đang cấp suất",
    badge: "🟡 Cấp suất",
    cls: "bg-amber-500/10 text-amber-400 border-amber-500/30",
    dot: "bg-amber-400",
    ping: true,
  },
  OPEN: {
    label: "Đang mở nhận",
    badge: "🟢 Đang mở",
    cls: "bg-emerald-500/10 text-emerald-400 border-emerald-500/30",
    dot: "bg-emerald-400",
    ping: true,
  },
  FULL: {
    label: "Hết suất",
    badge: "🟠 Hết suất",
    cls: "bg-orange-500/10 text-orange-400 border-orange-500/30",
    dot: "bg-orange-400",
    ping: false,
  },
  CLOSED: {
    label: "Đã đóng",
    badge: "⚪ Đã đóng",
    cls: "bg-white/[0.05] text-gray-400 border-white/[0.1]",
    dot: "bg-gray-500",
    ping: false,
  },
};

function StatusPill({ status }) {
  const c = STATUS[status] || {
    label: status,
    badge: status,
    cls: "bg-white/[0.05] text-gray-400 border-white/[0.1]",
    dot: "bg-gray-500",
    ping: false,
  };
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-medium border whitespace-nowrap shadow-sm ${c.cls}`}>
      <span className="relative flex h-2 w-2 flex-shrink-0">
        {c.ping && (
          <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${c.dot}`} />
        )}
        <span className={`relative inline-flex rounded-full h-2 w-2 ${c.dot}`} />
      </span>
      {c.badge}
    </span>
  );
}

function fmtMoney(amount, currency) {
  const n = Number(amount) || 0;
  if (currency === "USD") {
    return `$${n < 1 ? n.toFixed(3).replace(/0+$/, "").replace(/\.$/, "") : n.toFixed(2)}`;
  }
  return new Intl.NumberFormat("vi-VN").format(Math.round(n)) + "đ";
}

function fmtClock(d) {
  if (!d) return "—";
  const t = new Date(d);
  if (isNaN(t.getTime())) return String(d);
  return new Intl.DateTimeFormat("vi-VN", { hour: "2-digit", minute: "2-digit" }).format(t);
}

const fmtEta = (secs) => {
  const s = Math.max(0, Number(secs) || 0);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return m < 60 ? `${m}p ${s % 60}s` : `${Math.floor(m / 60)}h ${m % 60}p`;
};

const TABS = [
  { value: "all", label: "Tất cả" },
  { value: "OPEN", label: "🟢 Đang mở" },
  { value: "SENDING", label: "📤 Đang gửi" },
  { value: "OPENING", label: "🟡 Đang cấp suất" },
  { value: "FULL", label: "🟠 Hết suất" },
  { value: "CLOSED", label: "⚪ Đã đóng" },
];

export default function FlashSales() {
  const [tab, setTab] = useState("all");
  const [search, setSearch] = useState("");
  const [selectedServer, setSelectedServer] = useState("");
  const [detail, setDetail] = useState(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [confirmModal, setConfirmModal] = useState(null); // { type: 'close' | 'delete', sale: object }

  const qc = useQueryClient();

  const { data, isLoading, isFetching, error, refetch } = useQuery({
    queryKey: ["flash-sales", tab],
    queryFn: () => api.flashSales({ status: tab === "all" ? "" : tab, take: 100 }),
    refetchInterval: (query) => {
      const rows = query.state.data?.flashSales || [];
      if (rows.some((s) => s.status === "SENDING" || s.status === "OPENING")) return 5000;
      if (rows.some((s) => s.status === "OPEN")) return 15000;
      return false;
    },
  });

  const { data: cfgData } = useQuery({
    queryKey: ["gpt2api-config"],
    queryFn: api.gpt2apiConfig,
    staleTime: 60_000,
  });

  const serverMap = useMemo(() => {
    const list = cfgData?.effectiveProfiles || cfgData?.profiles || [];
    return new Map(list.map((p) => [Number(p.id), p.name || `Server ${p.id}`]));
  }, [cfgData]);

  const closeMut = useMutation({
    mutationFn: api.closeFlashSale,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["flash-sales"] });
      setDetail((d) => (d ? { ...d, status: "CLOSED" } : d));
      setConfirmModal(null);
    },
    onError: (e) => alert(`Không đóng được: ${e?.response?.data?.error || e.message}`),
  });

  const delMut = useMutation({
    mutationFn: api.deleteFlashSale,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["flash-sales"] });
      setDetail(null);
      setConfirmModal(null);
    },
    onError: (e) => alert(`Không xoá được: ${e?.response?.data?.error || e.message}`),
  });

  const allSales = useMemo(() => data?.flashSales || [], [data]);

  // Thống kê tổng hợp realtime trên toàn bộ danh sách
  const stats = useMemo(() => {
    let activeCampaigns = 0;
    let sendingCount = 0;
    let openCount = 0;
    let totalAccepted = 0;
    let totalPurchased = 0;
    let totalVndDiscount = 0;
    let totalUsdDiscount = 0;

    for (const s of allSales) {
      if (s.status === "OPEN") {
        activeCampaigns++;
        openCount++;
      } else if (s.status === "SENDING" || s.status === "OPENING") {
        activeCampaigns++;
        sendingCount++;
      }
      totalAccepted += Number(s.acceptedCount) || 0;
      totalPurchased += Number(s.purchasedCount) || 0;

      const disc = Number(s.discountGivenTotal) || 0;
      if (disc > 0) {
        if (s.moneyCurrency === "USD") totalUsdDiscount += disc;
        else totalVndDiscount += disc;
      }
    }

    const conversionRate = totalAccepted > 0 ? ((totalPurchased / totalAccepted) * 100).toFixed(1) : 0;

    return {
      activeCampaigns,
      openCount,
      sendingCount,
      totalAccepted,
      totalPurchased,
      conversionRate,
      totalVndDiscount,
      totalUsdDiscount,
    };
  }, [allSales]);

  // Bộ đếm cho từng tab filter
  const tabCounts = useMemo(() => {
    const counts = { all: allSales.length, OPEN: 0, SENDING: 0, OPENING: 0, FULL: 0, CLOSED: 0 };
    for (const s of allSales) {
      if (counts[s.status] != null) counts[s.status]++;
    }
    return counts;
  }, [allSales]);

  // Tìm đợt đang gửi để gắn banner nổi bật
  const activeSendingSale = useMemo(() => {
    return allSales.find((s) => s.status === "SENDING" || s.status === "OPENING");
  }, [allSales]);

  // Lọc theo tìm kiếm và server
  const filteredSales = useMemo(() => {
    let list = allSales;
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter((s) =>
        (s.productName || "").toLowerCase().includes(q) ||
        String(s.targetProfileId || "").includes(q) ||
        (serverMap.get(Number(s.targetProfileId)) || "").toLowerCase().includes(q)
      );
    }
    if (selectedServer) {
      list = list.filter((s) => String(s.targetProfileId) === String(selectedServer));
    }
    return list;
  }, [allSales, search, selectedServer, serverMap]);

  return (
    <div className="space-y-5 pb-12">
      {/* ── HEADER ── */}
      <div className="flex items-center justify-between gap-4 flex-wrap pb-1">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="eyebrow text-slate-400">PROMOTIONS // FLASH SALE</span>
            <span className="w-1 h-1 rounded-full bg-slate-600" />
            <span className="text-[10px] font-mono text-amber-400 flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
              CAMP ENGINE
            </span>
          </div>
          <h1 className="text-xl font-bold text-slate-100 tracking-tight flex items-center gap-2">
            Flash Sale & Chiến Dịch Ưu Đãi
          </h1>
          <p className="text-xs text-slate-400 mt-0.5 tracking-tight">
            Quản lý chiến dịch flash sale, giới hạn suất mua, phát sóng ưu đãi tới khách hàng Telegram
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => refetch()}
            disabled={isFetching}
            title="Làm mới dữ liệu"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-900/60 border border-slate-800 hover:border-slate-700 text-slate-300 text-xs font-mono transition-all cursor-pointer disabled:opacity-50">
            <RefreshCw size={12} className={isFetching ? "animate-spin text-indigo-400" : ""} />
            <span className="hidden sm:inline">LÀM MỚI</span>
          </button>

          <button
            onClick={() => setCreateOpen(true)}
            className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium border border-indigo-500/40 shadow-sm transition-all cursor-pointer">
            <Plus size={14} />
            <span>Tạo đợt Flash Sale mới</span>
          </button>
        </div>
      </div>

      {/* ── 4 THẺ THỐNG KÊ TỔNG QUAN (BENTO CARDS) ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5">
        {/* Card 1: Đang hoạt động */}
        <div className="bento-card-interactive p-4 relative overflow-hidden flex flex-col justify-between">
          <div className="flex items-center justify-between mb-2">
            <span className="eyebrow text-slate-400">CAMPAIGNS // ACTIVE</span>
            <div className="w-7 h-7 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 flex items-center justify-center">
              <Flame size={14} />
            </div>
          </div>
          <div>
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-bold text-slate-100 tracking-tight">{stats.activeCampaigns}</span>
              <span className="text-xs font-mono text-slate-500">đang chạy</span>
            </div>
          </div>
          <div className="mt-2.5 pt-2 border-t border-slate-800/70 flex items-center gap-2 text-[11px] font-mono text-slate-400">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
            <span>{stats.openCount} mở</span>
            {stats.sendingCount > 0 && (
              <>
                <span>•</span>
                <span className="text-sky-400">{stats.sendingCount} gửi tin</span>
              </>
            )}
          </div>
        </div>

        {/* Card 2: Lượt nhận */}
        <div className="bento-card-interactive p-4 relative overflow-hidden flex flex-col justify-between">
          <div className="flex items-center justify-between mb-2">
            <span className="eyebrow text-slate-400">CLAIMS // ACCEPTED</span>
            <div className="w-7 h-7 rounded-lg bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 flex items-center justify-center">
              <CheckCircle2 size={14} />
            </div>
          </div>
          <div>
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-bold text-slate-100 tracking-tight">{stats.totalAccepted.toLocaleString()}</span>
              <span className="text-xs font-mono text-slate-500">lượt nhận</span>
            </div>
          </div>
          <p className="mt-2.5 pt-2 border-t border-slate-800/70 text-[11px] text-slate-400 truncate">
            Khách kích hoạt ưu đãi vào giỏ hàng
          </p>
        </div>

        {/* Card 3: Đã chốt mua */}
        <div className="bento-card-interactive p-4 relative overflow-hidden flex flex-col justify-between">
          <div className="flex items-center justify-between mb-2">
            <span className="eyebrow text-slate-400">SALES // CONVERTED</span>
            <div className="w-7 h-7 rounded-lg bg-cyan-500/10 border border-cyan-500/20 text-cyan-400 flex items-center justify-center">
              <ShoppingBag size={14} />
            </div>
          </div>
          <div>
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-bold text-slate-100 tracking-tight">{stats.totalPurchased.toLocaleString()}</span>
              <span className="text-xs font-mono font-semibold text-cyan-400">({stats.conversionRate}%)</span>
            </div>
          </div>
          <p className="mt-2.5 pt-2 border-t border-slate-800/70 text-[11px] text-slate-400 truncate">
            Đơn mua thành công bằng giá flash
          </p>
        </div>

        {/* Card 4: Tổng trợ giá */}
        <div className="bento-card-interactive p-4 relative overflow-hidden flex flex-col justify-between">
          <div className="flex items-center justify-between mb-2">
            <span className="eyebrow text-slate-400">DISCOUNT // SUBSIDY</span>
            <div className="w-7 h-7 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-400 flex items-center justify-center">
              <Coins size={14} />
            </div>
          </div>
          <div>
            <span className="text-2xl font-bold text-amber-400 tracking-tight">
              {stats.totalVndDiscount > 0 ? fmtMoney(stats.totalVndDiscount, "VND") : stats.totalUsdDiscount > 0 ? fmtMoney(stats.totalUsdDiscount, "USD") : "0đ"}
            </span>
          </div>
          <p className="mt-2.5 pt-2 border-t border-slate-800/70 text-[11px] text-slate-400 truncate font-mono">
            {stats.totalUsdDiscount > 0 && stats.totalVndDiscount > 0
              ? `+ ${fmtMoney(stats.totalUsdDiscount, "USD")}`
              : "Tổng ngân sách shop đã giảm"}
          </p>
        </div>
      </div>

      {/* ── BANNER TIẾN ĐỘ GỬI REALTIME (Tự động hiện khi có đợt SENDING) ── */}
      {activeSendingSale && activeSendingSale.progress && (
        <div className="p-4 rounded-xl bg-slate-900/80 border border-sky-500/40 relative overflow-hidden">
          <div className="flex items-center justify-between gap-4 flex-wrap mb-2.5">
            <div className="flex items-center gap-2.5">
              <span className="w-2 h-2 rounded-full bg-sky-400" />
              <p className="text-xs font-bold text-slate-100 flex items-center gap-2 tracking-tight">
                <span className="eyebrow text-sky-400">BROADCAST //</span>
                <span>Đang phát sóng tin nhắn Flash Sale:</span>
                <span className="text-sky-300 underline underline-offset-2">
                  {activeSendingSale.productName}
                </span>
                <span className="font-mono text-[10px] px-2 py-0.5 rounded bg-sky-500/20 text-sky-300 border border-sky-500/30">
                  −{activeSendingSale.discountPct}%
                </span>
              </p>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={() => setDetail(activeSendingSale)}
                className="px-2.5 py-1 rounded-md text-xs font-mono text-sky-200 bg-sky-500/20 hover:bg-sky-500/30 border border-sky-500/30 transition-all cursor-pointer">
                CHI TIẾT
              </button>
              <button
                onClick={() => setConfirmModal({ type: "close", sale: activeSendingSale })}
                className="px-2.5 py-1 rounded-md text-xs font-mono text-amber-300 bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/30 transition-all cursor-pointer">
                DỪNG GỬI
              </button>
            </div>
          </div>

          <div className="space-y-1.5 font-mono text-xs">
            <div className="flex items-center justify-between text-sky-300/90 text-[11px]">
              <span>Đã gửi {activeSendingSale.sentCount} / {activeSendingSale.recipientTotal} khách</span>
              <span>{activeSendingSale.progress.pct}%</span>
            </div>
            <div className="h-1.5 w-full bg-slate-800 rounded-full overflow-hidden">
              <div
                className="h-full bg-sky-400 rounded-full transition-all duration-300"
                style={{ width: `${activeSendingSale.progress.pct}%` }}
              />
            </div>
            <div className="flex items-center justify-between text-[10px] text-slate-400 pt-0.5">
              <span>Mở nhận: {fmtClock(activeSendingSale.opensAt)}</span>
              <span>
                Còn ~{fmtEta(activeSendingSale.progress.etaSeconds)}
                {activeSendingSale.progress.secsPerUser != null && ` • ${(1 / activeSendingSale.progress.secsPerUser).toFixed(0)} khách/s`}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* ── BỘ LỌC & TÌM KIẾM (DEV-TOOLS TOOLBAR) ── */}
      <div className="bento-card p-2.5 flex items-center justify-between gap-3 flex-wrap">
        {/* Tab Pills có Badge đếm số lượng */}
        <div className="flex items-center gap-1 overflow-x-auto pb-1 sm:pb-0 scrollbar-none">
          {TABS.map((t) => {
            const count = tabCounts[t.value] ?? 0;
            const active = tab === t.value;
            return (
              <button
                key={t.value}
                onClick={() => setTab(t.value)}
                className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-all cursor-pointer select-none ${
                  active
                    ? "bg-slate-800 text-slate-100 border border-slate-700/80 font-semibold shadow-sm"
                    : "text-slate-400 hover:text-slate-200 hover:bg-slate-900/60 border border-transparent"
                }`}>
                <span className="tracking-tight">{t.label}</span>
                <span className={`text-[10px] font-mono px-1.5 py-0.2 rounded font-semibold ${
                  active ? "bg-indigo-500/20 text-indigo-300 border border-indigo-500/30" : "bg-slate-800 text-slate-500 border border-slate-700/50"
                }`}>
                  {count}
                </span>
              </button>
            );
          })}
        </div>

        {/* Search & Server Filter */}
        <div className="flex items-center gap-2 flex-1 sm:flex-initial justify-end">
          <div className="relative min-w-[200px] flex-1 sm:flex-initial">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500" />
            <input
              type="text"
              placeholder="Tìm theo tên sản phẩm..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full bg-slate-950/80 border border-slate-800 rounded-lg pl-8 pr-2.5 py-1.5 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-indigo-500/80 transition-colors"
            />
            {search && (
              <button
                onClick={() => setSearch("")}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-200">
                <X size={12} />
              </button>
            )}
          </div>

          <select
            value={selectedServer}
            onChange={(e) => setSelectedServer(e.target.value)}
            className="bg-slate-950/80 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-slate-300 focus:outline-none focus:border-indigo-500/80 transition-colors font-mono">
            <option value="" className="bg-[#0b101d]">Tất cả Server</option>
            {Array.from(serverMap.entries()).map(([id, name]) => (
              <option key={id} value={id} className="bg-[#0b101d]">{name}</option>
            ))}
          </select>
        </div>
      </div>

      {/* ── BẢNG DANH SÁCH CHIẾN DỊCH (BENTO MODULAR TABLE) ── */}
      <div className="bento-card overflow-hidden">
        {isLoading ? (
          <div className="py-20 text-center space-y-3 font-mono">
            <RefreshCw size={20} className="animate-spin text-indigo-400 mx-auto" />
            <p className="text-xs text-slate-400">ĐANG TẢI DỮ LIỆU CHIẾN DỊCH...</p>
          </div>
        ) : error ? (
          <div className="py-12 px-6 text-center space-y-3 font-mono">
            <p className="text-xs text-rose-300">
              ❌ Không tải được danh sách flash sale: {error.response?.data?.error || error.message}
            </p>
            <button onClick={() => refetch()} className="text-xs px-3 py-1 bg-slate-900 border border-slate-800 rounded-md text-slate-300 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer">
              Thử lại
            </button>
          </div>
        ) : filteredSales.length === 0 ? (
          <div className="py-12">
            <EmptyState
              icon={Zap}
              message={
                search || selectedServer
                  ? "Không tìm thấy chiến dịch nào khớp với bộ lọc."
                  : tab === "all"
                  ? "Chưa có chiến dịch flash sale nào. Hãy bấm 'Tạo đợt Flash Sale mới' để bắt đầu!"
                  : "Không có chiến dịch nào ở trạng thái này."
              }
            />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse min-w-[960px]">
              <thead>
                <tr className="border-b border-slate-800/80 bg-slate-950/40 text-[10px] font-mono font-semibold text-slate-400 uppercase tracking-wider">
                  <th className="px-4 py-3">Chiến dịch / Sản phẩm</th>
                  <th className="px-3 py-3 text-center">Mức giảm</th>
                  <th className="px-3 py-3">Tiến độ nhận</th>
                  <th className="px-3 py-3">Phát sóng (Gửi)</th>
                  <th className="px-3 py-3">Đã mua</th>
                  <th className="px-3 py-3">Trợ giá</th>
                  <th className="px-3 py-3">Trạng thái</th>
                  <th className="px-4 py-3 text-right">Thao tác</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/50 text-xs">
                {filteredSales.map((s) => {
                  const unlimited = !(Number(s.maxSlots) > 0);
                  const slotsTotal = Number(s.maxSlots) || 0;
                  const accepted = Number(s.acceptedCount) || 0;
                  const slotPct = unlimited ? 0 : Math.min(100, Math.round((accepted / slotsTotal) * 100));

                  return (
                    <tr
                      key={s.id}
                      className="hover:bg-white/[0.025] transition-colors group align-middle">
                      {/* Sản phẩm */}
                      <td className="px-4 py-3.5">
                        <div className="flex items-start gap-2.5">
                          <button
                            onClick={() => setDetail(s)}
                            className="text-left group/title flex-1">
                            <p className="font-semibold text-gray-100 group-hover/title:text-primary-300 transition-colors flex items-center gap-1.5 flex-wrap">
                              <span>{s.productName || "(Sản phẩm đã gỡ)"}</span>
                              {s.targetProfileId ? (
                                <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-purple-500/15 text-purple-300 border border-purple-500/30">
                                  ⚡ {serverMap.get(Number(s.targetProfileId)) || `Server #${s.targetProfileId}`}
                                </span>
                              ) : null}
                              {s.guideText && (
                                <span title="Có lưu ý riêng từ shop" className="text-amber-400">
                                  📝
                                </span>
                              )}
                            </p>
                            <p className="text-[11px] text-gray-500 mt-0.5 flex items-center gap-1.5">
                              <span>{formatDate(s.createdAt)}</span>
                              <span>•</span>
                              <span>Hiệu lực {s.validityMinutes}p</span>
                              {s.closedAt && (
                                <>
                                  <span>•</span>
                                  <span className="text-gray-600">Đóng {relativeTime(s.closedAt)}</span>
                                </>
                              )}
                            </p>
                          </button>
                        </div>

                        {/* Thanh mini tiến độ nếu đang gửi */}
                        {s.status === "SENDING" && s.progress && (
                          <div className="mt-2 p-1.5 rounded-lg bg-sky-950/30 border border-sky-800/30 max-w-xs">
                            <div className="h-1 bg-white/[0.06] rounded-full overflow-hidden">
                              <div
                                className="h-full bg-sky-400 rounded-full"
                                style={{ width: `${s.progress.pct}%` }}
                              />
                            </div>
                            <p className="text-[10px] text-sky-400/90 mt-1 flex justify-between">
                              <span>{s.progress.pct}% ({s.sentCount}/{s.recipientTotal})</span>
                              <span>Còn ~{fmtEta(s.progress.etaSeconds)}</span>
                            </p>
                          </div>
                        )}
                      </td>

                      {/* Mức giảm */}
                      <td className="px-3 py-3.5 text-center">
                        <span className={`inline-flex items-center px-2.5 py-1 rounded-lg font-bold text-xs shadow-sm ${
                          s.discountPct >= 50
                            ? "bg-purple-500/20 text-purple-300 border border-purple-500/40"
                            : s.discountPct >= 30
                            ? "bg-amber-500/20 text-amber-300 border border-amber-500/40"
                            : "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40"
                        }`}>
                          −{s.discountPct}%
                        </span>
                      </td>

                      {/* Tiến độ nhận suất */}
                      <td className="px-3 py-3.5">
                        <div className="space-y-1">
                          <div className="flex items-center justify-between text-xs">
                            <span className="font-semibold text-gray-200">{accepted}</span>
                            <span className="text-gray-500">/ {unlimited ? "∞" : slotsTotal}</span>
                          </div>
                          {!unlimited && (
                            <div className="w-24 h-1.5 bg-white/[0.06] rounded-full overflow-hidden">
                              <div
                                className={`h-full rounded-full transition-all ${
                                  slotPct >= 100 ? "bg-orange-400" : slotPct >= 80 ? "bg-amber-400" : "bg-emerald-400"
                                }`}
                                style={{ width: `${slotPct}%` }}
                              />
                            </div>
                          )}
                          {s.stats?.live > 0 && (
                            <p className="text-[10px] text-emerald-400 font-medium">
                              🟢 {s.stats.live} còn hạn
                            </p>
                          )}
                        </div>
                      </td>

                      {/* Phát sóng */}
                      <td className="px-3 py-3.5 text-gray-300">
                        <div className="space-y-0.5">
                          <p className="font-medium">{s.sentCount} khách</p>
                          {s.blockedCount > 0 && (
                            <p className="text-[10px] text-gray-500">🚫 {s.blockedCount} chặn</p>
                          )}
                          {s.errorCount > 0 && (
                            <p className="text-[10px] text-red-400">⚠️ {s.errorCount} lỗi</p>
                          )}
                        </div>
                      </td>

                      {/* Đã mua */}
                      <td className="px-3 py-3.5 text-gray-300">
                        <span className="font-semibold text-gray-100">{s.purchasedCount}</span>
                        <span className="text-gray-500 text-[11px] ml-1">đơn</span>
                      </td>

                      {/* Trợ giá */}
                      <td className="px-3 py-3.5">
                        <span className="font-semibold text-amber-400">
                          {s.discountGivenTotal > 0 ? fmtMoney(s.discountGivenTotal, s.moneyCurrency) : "—"}
                        </span>
                      </td>

                      {/* Trạng thái */}
                      <td className="px-3 py-3.5">
                        <StatusPill status={s.status} />
                      </td>

                      {/* Thao tác */}
                      <td className="px-4 py-3.5 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            onClick={() => setDetail(s)}
                            title="Xem chi tiết chiến dịch"
                            className="p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-white/[0.08] transition-colors cursor-pointer">
                            <Eye size={15} />
                          </button>

                          {(s.status === "SENDING" || s.status === "OPEN") && (
                            <button
                              onClick={() => setConfirmModal({ type: "close", sale: s })}
                              title={s.status === "SENDING" ? "Dừng gửi tin & đóng đợt" : "Ngừng nhận thêm suất"}
                              className="px-2 py-1 rounded-lg text-[11px] font-medium bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 border border-amber-500/30 transition-all cursor-pointer">
                              <Ban size={12} className="inline mr-1" />
                              {s.status === "SENDING" ? "Dừng" : "Đóng"}
                            </button>
                          )}

                          <button
                            onClick={() => setConfirmModal({ type: "delete", sale: s })}
                            title="Xoá vĩnh viễn đợt"
                            className="p-1.5 rounded-lg text-gray-500 hover:text-red-400 hover:bg-red-500/10 transition-colors cursor-pointer">
                            <Trash2 size={15} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── MODAL CHI TIẾT CHIẾN DỊCH ── */}
      {detail && (
        <DetailModal
          sale={allSales.find((s) => s.id === detail.id) || detail}
          onClose={() => setDetail(null)}
          onAskClose={(s) => setConfirmModal({ type: "close", sale: s })}
          onAskDelete={(s) => setConfirmModal({ type: "delete", sale: s })}
          busy={closeMut.isPending || delMut.isPending}
          serverMap={serverMap}
        />
      )}

      {/* ── MODAL TẠO FLASH SALE MỚI (CÓ TELEGRAM PREVIEW) ── */}
      {createOpen && (
        <CreateSaleModal
          open={createOpen}
          onClose={() => setCreateOpen(false)}
          serverMap={serverMap}
          profiles={cfgData?.effectiveProfiles || cfgData?.profiles || []}
        />
      )}

      {/* ── MODAL XÁC NHẬN ĐÓNG / XOÁ (CUSTOM GLASS DIALOG) ── */}
      {confirmModal && (
        <ConfirmDialog
          modal={confirmModal}
          onClose={() => setConfirmModal(null)}
          onConfirm={() => {
            if (confirmModal.type === "close") closeMut.mutate(confirmModal.sale.id);
            else if (confirmModal.type === "delete") delMut.mutate(confirmModal.sale.id);
          }}
          isPending={closeMut.isPending || delMut.isPending}
        />
      )}
    </div>
  );
}

/**
 * ── DIALOG XÁC NHẬN AN TOÀN (Thay thế window.confirm xấu xí) ──
 */
function ConfirmDialog({ modal, onClose, onConfirm, isPending }) {
  const isClose = modal.type === "close";
  const s = modal.sale;
  const liveCount = Number(s?.stats?.live) || 0;

  return (
    <Modal open onClose={onClose} title={isClose ? "Xác nhận đóng đợt Flash Sale" : "Xác nhận xoá vĩnh viễn đợt Flash Sale"} width="max-w-md">
      <div className="space-y-4">
        <div className={`p-4 rounded-xl border flex items-start gap-3 ${
          isClose ? "bg-amber-500/10 border-amber-500/30 text-amber-200" : "bg-red-500/10 border-red-500/30 text-red-200"
        }`}>
          {isClose ? (
            <Ban size={22} className="text-amber-400 flex-shrink-0 mt-0.5" />
          ) : (
            <ShieldAlert size={22} className="text-red-400 flex-shrink-0 mt-0.5" />
          )}
          <div className="text-xs space-y-1.5 leading-relaxed">
            <p className="font-semibold text-white text-sm">
              {isClose ? `Đóng đợt "${s.productName}"?` : `Xoá hẳn đợt "${s.productName}"?`}
            </p>
            {isClose ? (
              <p>
                Khách hàng mới sẽ <b>không thể bấm nhận thêm</b> ưu đãi. Tuy nhiên, <b>{liveCount} khách hàng</b> đã nhận mã trước đó vẫn được giữ ưu đãi cho đến khi hết hạn của họ.
              </p>
            ) : (
              <div className="space-y-1">
                <p>
                  ⚠️ <b>Hành động không thể hoàn tác!</b> Mọi lượt nhận, số liệu báo cáo của đợt này sẽ bị gỡ bỏ hoàn toàn.
                </p>
                {liveCount > 0 && (
                  <p className="font-bold text-red-300">
                    {liveCount} khách hàng đang giữ ưu đãi còn hạn sẽ bị mất quyền mua ngay lập tức!
                  </p>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center justify-end gap-2.5 pt-2">
          <button
            type="button"
            onClick={onClose}
            disabled={isPending}
            className="px-4 py-2 rounded-xl text-xs font-medium text-gray-400 hover:text-white bg-white/[0.05] border border-white/[0.08] transition-colors">
            Huỷ bỏ
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={isPending}
            className={`px-4 py-2 rounded-xl text-xs font-semibold text-white shadow-lg transition-all cursor-pointer ${
              isClose
                ? "bg-amber-600 hover:bg-amber-500 shadow-amber-950/40"
                : "bg-red-600 hover:bg-red-500 shadow-red-950/40"
            }`}>
            {isPending ? "Đang xử lý..." : isClose ? "Đồng ý đóng đợt" : "Xoá vĩnh viễn"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

/**
 * ── MODAL CHI TIẾT CHIẾN DỊCH (VỚI PHỄU CHUYỂN ĐỔI FUNNEL) ──
 */
function DetailModal({ sale: s, onClose, onAskClose, onAskDelete, busy, serverMap }) {
  const st = s.stats || {};
  const unlimited = !(Number(s.maxSlots) > 0);
  const money = (v) => fmtMoney(v, s.moneyCurrency);

  const sent = Number(s.sentCount) || 0;
  const accepted = Number(s.acceptedCount) || 0;
  const purchased = Number(s.purchasedCount) || 0;

  const claimRate = sent > 0 ? ((accepted / sent) * 100).toFixed(1) : 0;
  const purchaseRate = accepted > 0 ? ((purchased / accepted) * 100).toFixed(1) : 0;

  return (
    <Modal open onClose={onClose} title={`Chi tiết Flash Sale: ${s.productName || "(Sản phẩm đã gỡ)"}`} width="max-w-2xl">
      <div className="space-y-4">
        {/* Header tags */}
        <div className="flex items-center justify-between gap-2 flex-wrap pb-2 border-b border-white/[0.06]">
          <div className="flex items-center gap-2 flex-wrap">
            <StatusPill status={s.status} />
            {s.targetProfileId ? (
              <span className="inline-flex items-center px-2 py-0.5 rounded text-xs bg-purple-500/15 text-purple-300 border border-purple-500/30 font-medium">
                ⚡ {serverMap?.get(Number(s.targetProfileId)) || `Server #${s.targetProfileId}`}
              </span>
            ) : (
              <span className="text-xs text-gray-500">Áp dụng chung mọi server</span>
            )}
            <span className="text-xs text-gray-500">• Tạo {relativeTime(s.createdAt)}</span>
          </div>

          <div className="flex items-center gap-1.5">
            {(s.status === "SENDING" || s.status === "OPEN") && (
              <button
                onClick={() => onAskClose(s)}
                disabled={busy}
                className="px-2.5 py-1 rounded-lg text-xs font-medium bg-amber-500/15 text-amber-300 border border-amber-500/30 hover:bg-amber-500/25 transition-all">
                <Ban size={12} className="inline mr-1" />
                {s.status === "SENDING" ? "Dừng gửi" : "Đóng đợt"}
              </button>
            )}
            <button
              onClick={() => onAskDelete(s)}
              disabled={busy}
              className="p-1 rounded-lg text-gray-500 hover:text-red-400 hover:bg-red-500/10 transition-colors">
              <Trash2 size={14} />
            </button>
          </div>
        </div>

        {/* PHỄU CHUYỂN ĐỔI (FUNNEL VISUALIZATION) */}
        <div className="p-3.5 rounded-2xl bg-gradient-to-br from-white/[0.03] to-white/[0.01] border border-white/[0.07]">
          <p className="text-[11px] font-bold text-gray-400 uppercase tracking-wider mb-2.5 flex items-center gap-1.5">
            <Sparkles size={13} className="text-primary-400" />
            Hiệu quả phễu chuyển đổi (Conversion Funnel)
          </p>
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="p-2.5 rounded-xl bg-white/[0.03] border border-white/[0.05]">
              <p className="text-[10px] text-gray-500 uppercase">1. Phát sóng</p>
              <p className="text-base font-bold text-sky-400 mt-0.5">{sent.toLocaleString()}</p>
              <p className="text-[10px] text-gray-500 mt-0.5">tin nhắn gửi đi</p>
            </div>
            <div className="p-2.5 rounded-xl bg-white/[0.03] border border-white/[0.05] relative">
              <div className="absolute -left-2 top-1/2 -translate-y-1/2 w-4 h-4 rounded-full bg-primary-600/30 border border-primary-500/40 text-[9px] text-primary-300 flex items-center justify-center font-bold">
                →
              </div>
              <p className="text-[10px] text-gray-500 uppercase">2. Đã nhận mã</p>
              <p className="text-base font-bold text-emerald-400 mt-0.5">{accepted.toLocaleString()}</p>
              <p className="text-[10px] text-emerald-400/80 mt-0.5">{claimRate}% tỉ lệ nhận</p>
            </div>
            <div className="p-2.5 rounded-xl bg-white/[0.03] border border-white/[0.05] relative">
              <div className="absolute -left-2 top-1/2 -translate-y-1/2 w-4 h-4 rounded-full bg-primary-600/30 border border-primary-500/40 text-[9px] text-primary-300 flex items-center justify-center font-bold">
                →
              </div>
              <p className="text-[10px] text-gray-500 uppercase">3. Chốt mua</p>
              <p className="text-base font-bold text-primary-300 mt-0.5">{purchased.toLocaleString()}</p>
              <p className="text-[10px] text-primary-400/80 mt-0.5">{purchaseRate}% chuyển đổi</p>
            </div>
          </div>
        </div>

        {/* Thẻ thông số cấu hình đợt */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
          <div className="p-3 rounded-xl bg-white/[0.03] border border-white/[0.06]">
            <p className="text-[11px] text-gray-500">Mức giảm</p>
            <p className="text-base font-bold text-primary-400 mt-0.5">−{s.discountPct}%</p>
          </div>
          <div className="p-3 rounded-xl bg-white/[0.03] border border-white/[0.06]">
            <p className="text-[11px] text-gray-500">Thời hạn giữ</p>
            <p className="text-sm font-semibold text-gray-200 mt-0.5">{s.validityMinutes} phút</p>
          </div>
          <div className="p-3 rounded-xl bg-white/[0.03] border border-white/[0.06]">
            <p className="text-[11px] text-gray-500">Trần suất</p>
            <p className="text-sm font-semibold text-gray-200 mt-0.5">{unlimited ? "Không hạn" : s.maxSlots}</p>
          </div>
          <div className="p-3 rounded-xl bg-white/[0.03] border border-white/[0.06]">
            <p className="text-[11px] text-gray-500">Giờ mở</p>
            <p className="text-sm font-semibold text-gray-200 mt-0.5">{fmtClock(s.opensAt)}</p>
          </div>
        </div>

        {/* 3 NHÓM THỐNG KÊ CHI TIẾT */}
        <div className="space-y-3">
          {/* Nhóm 1: Phát sóng */}
          <div>
            <p className="text-[11px] font-bold text-gray-500 uppercase tracking-wider mb-2">1. Thống kê phát sóng</p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
              <div className="p-2.5 rounded-xl bg-white/[0.025] border border-white/[0.05]">
                <span className="text-[11px] text-gray-500 block">📤 Đã gửi</span>
                <span className="font-semibold text-sky-400">{s.sentCount} / {s.recipientTotal}</span>
              </div>
              <div className="p-2.5 rounded-xl bg-white/[0.025] border border-white/[0.05]">
                <span className="text-[11px] text-gray-500 block">🚫 Chặn bot</span>
                <span className="font-semibold text-gray-300">{s.blockedCount}</span>
              </div>
              <div className="p-2.5 rounded-xl bg-white/[0.025] border border-white/[0.05]">
                <span className="text-[11px] text-gray-500 block">⚠️ Lỗi gửi</span>
                <span className={`font-semibold ${s.errorCount > 0 ? "text-red-400" : "text-gray-300"}`}>{s.errorCount}</span>
              </div>
              <div className="p-2.5 rounded-xl bg-white/[0.025] border border-white/[0.05]">
                <span className="text-[11px] text-gray-500 block">👥 Chưa bấm</span>
                <span className="font-semibold text-gray-400">{s.noResponse}</span>
              </div>
            </div>
          </div>

          {/* Nhóm 2: Phản hồi khách */}
          <div>
            <p className="text-[11px] font-bold text-gray-500 uppercase tracking-wider mb-2">2. Phản hồi khách hàng</p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
              <div className="p-2.5 rounded-xl bg-white/[0.025] border border-white/[0.05]">
                <span className="text-[11px] text-gray-500 block">✅ Đã nhận</span>
                <span className="font-semibold text-emerald-400">{accepted}</span>
              </div>
              <div className="p-2.5 rounded-xl bg-white/[0.025] border border-white/[0.05]">
                <span className="text-[11px] text-gray-500 block">🟢 Đang còn hạn</span>
                <span className="font-semibold text-emerald-300">{st.live ?? 0}</span>
              </div>
              <div className="p-2.5 rounded-xl bg-white/[0.025] border border-white/[0.05]">
                <span className="text-[11px] text-gray-500 block">⏰ Đã hết hạn</span>
                <span className="font-semibold text-gray-400">{st.expired ?? 0}</span>
              </div>
              <div className="p-2.5 rounded-xl bg-white/[0.025] border border-white/[0.05]">
                <span className="text-[11px] text-gray-500 block">⏭ Đã bỏ qua</span>
                <span className="font-semibold text-gray-400">{s.skippedCount}</span>
              </div>
            </div>
          </div>

          {/* Nhóm 3: Kết quả bán hàng */}
          <div>
            <p className="text-[11px] font-bold text-gray-500 uppercase tracking-wider mb-2">3. Doanh số & Trợ giá</p>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="p-3 rounded-xl bg-white/[0.025] border border-white/[0.05]">
                <span className="text-[11px] text-gray-500 block">🛒 Đơn hàng hoàn tất</span>
                <span className="text-base font-bold text-primary-300">{s.purchasedCount} đơn hàng</span>
              </div>
              <div className="p-3 rounded-xl bg-white/[0.025] border border-white/[0.05]">
                <span className="text-[11px] text-gray-500 block">💸 Tổng tiền đã giảm giá</span>
                <span className="text-base font-bold text-amber-400">
                  {s.discountGivenTotal > 0 ? money(s.discountGivenTotal) : "0đ"}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Hướng dẫn riêng */}
        {s.guideText && (
          <div className="p-3 rounded-xl bg-white/[0.025] border border-white/[0.06] text-xs">
            <p className="text-[11px] font-bold text-gray-400 uppercase tracking-wider mb-1">📝 Hướng dẫn / Lưu ý đính kèm của Shop</p>
            <p className="text-gray-300 whitespace-pre-wrap">{s.guideText}</p>
          </div>
        )}

        <div className="pt-2 text-right">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-xl text-xs font-medium text-gray-300 bg-white/[0.05] border border-white/[0.08] hover:bg-white/[0.08] transition-colors">
            Đóng
          </button>
        </div>
      </div>
    </Modal>
  );
}

/**
 * ── MODAL TẠO FLASH SALE (2 CỘT: CẤU HÌNH + TELEGRAM PREVIEW REALTIME) ──
 */
function CreateSaleModal({ open, onClose, serverMap, profiles = [] }) {
  const qc = useQueryClient();
  const { data: prodData, isLoading: prodLoading } = useQuery({
    queryKey: ["flash-sales-pickable"],
    queryFn: api.pickableProducts,
    enabled: open,
  });

  const products = prodData?.products || [];

  const [productId, setProductId] = useState("");
  const [targetProfileId, setTargetProfileId] = useState("");
  const [discountPct, setDiscountPct] = useState(20);
  const [validityMinutes, setValidityMinutes] = useState(60);
  const [maxSlots, setMaxSlots] = useState(0);
  const [sendBroadcast, setSendBroadcast] = useState(true);
  const [guideText, setGuideText] = useState("");
  const [errorMsg, setErrorMsg] = useState("");

  useEffect(() => {
    if (products.length > 0 && !productId) {
      setProductId(products[0].id);
    }
  }, [products, productId]);

  const selectedProduct = useMemo(
    () => products.find((p) => p.id === productId),
    [products, productId]
  );

  const isApiKeyProduct = Boolean(
    selectedProduct?.isTotalDiscount || selectedProduct?.code === "__API_KEY__"
  );

  const createMut = useMutation({
    mutationFn: api.createFlashSale,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["flash-sales"] });
      onClose();
    },
    onError: (e) => {
      setErrorMsg(e?.response?.data?.error || e.message);
    },
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    setErrorMsg("");
    if (!productId) {
      setErrorMsg("Vui lòng chọn sản phẩm áp dụng");
      return;
    }
    const pct = Number(discountPct);
    if (!pct || pct < 1 || pct > 90) {
      setErrorMsg("Mức giảm giá phải từ 1% đến 90%");
      return;
    }
    createMut.mutate({
      productId,
      targetProfileId: isApiKeyProduct && targetProfileId !== "" ? Number(targetProfileId) : null,
      discountPct: pct,
      validityMinutes: Math.max(1, Number(validityMinutes) || 60),
      maxSlots: Math.max(0, Number(maxSlots) || 0),
      sendBroadcast,
      guideText: guideText.trim() || undefined,
    });
  };

  const previewPrice = useMemo(() => {
    if (!selectedProduct || selectedProduct.isTotalDiscount) return null;
    const orig = Number(selectedProduct.price) || 0;
    const pct = Math.min(90, Math.max(1, Number(discountPct) || 0));
    const sale = Math.round(orig * (1 - pct / 100));
    return {
      orig: fmtMoney(orig, selectedProduct.currency),
      sale: fmtMoney(sale, selectedProduct.currency),
      saved: fmtMoney(orig - sale, selectedProduct.currency),
    };
  }, [selectedProduct, discountPct]);

  return (
    <Modal open={open} onClose={onClose} title="⚡ Tạo chiến dịch Flash Sale mới" width="max-w-4xl">
      <form onSubmit={handleSubmit} className="space-y-4">
        {errorMsg && (
          <div className="flex items-center gap-2 p-3 rounded-xl bg-red-950/50 border border-red-800/50 text-xs text-red-300">
            <AlertTriangle size={15} className="flex-shrink-0" />
            <span>{errorMsg}</span>
          </div>
        )}

        {/* 2 CỘT: CỘT TRÁI FORM, CỘT PHẢI TELEGRAM PREVIEW */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
          {/* CỘT TRÁI: FORM CẤU HÌNH (7 CỘT) */}
          <div className="lg:col-span-7 space-y-4">
            {/* 1. Chọn sản phẩm */}
            <div>
              <label className="text-xs font-semibold text-gray-300 block mb-1.5 uppercase tracking-wide">
                1. Sản phẩm áp dụng
              </label>
              {prodLoading ? (
                <div className="text-xs text-gray-500 py-2">Đang tải danh sách sản phẩm...</div>
              ) : (
                <select
                  value={productId}
                  onChange={(e) => {
                    setProductId(e.target.value);
                    setTargetProfileId("");
                  }}
                  className="w-full bg-[#121622] border border-white/[0.1] rounded-xl px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-primary-500 transition-colors">
                  {products.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.isTotalDiscount
                        ? `⚡ [API Key] Toàn bộ gói API Key / Nạp credit`
                        : `📦 ${p.name} (${fmtMoney(p.price, p.currency)})`}
                    </option>
                  ))}
                </select>
              )}
            </div>

            {/* Cụm Server nếu là API Key */}
            {isApiKeyProduct && (
              <div className="p-3 rounded-xl bg-purple-950/20 border border-purple-800/30 space-y-1.5 animate-fade-in">
                <label className="text-xs font-semibold text-purple-300 flex items-center gap-1.5 uppercase tracking-wide">
                  <Server size={13} />
                  Cụm Server API áp dụng
                </label>
                <select
                  value={targetProfileId}
                  onChange={(e) => setTargetProfileId(e.target.value)}
                  className="w-full bg-[#121622] border border-purple-500/30 rounded-xl px-3 py-2 text-sm text-purple-200 focus:outline-none focus:border-purple-500 transition-colors">
                  <option value="">🌐 Áp dụng cho TẤT CẢ các Server</option>
                  {profiles.map((pr) => (
                    <option key={pr.id} value={pr.id}>
                      ⚡ {pr.name || `Server #${pr.id}`} (Server ID: {pr.id})
                    </option>
                  ))}
                </select>
                <p className="text-[11px] text-gray-400">
                  {targetProfileId
                    ? `Chỉ áp dụng flash sale cho các gói thuộc cụm "${serverMap?.get(Number(targetProfileId)) || 'Server #' + targetProfileId}".`
                    : "Ưu đãi có hiệu lực trên toàn bộ các server API đang mở bán."}
                </p>
              </div>
            )}

            {/* 2. Mức giảm giá (%) */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-xs font-semibold text-gray-300 uppercase tracking-wide">
                  2. Mức giảm giá (%)
                </label>
                <span className="text-sm font-bold text-amber-400">−{discountPct}%</span>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={1}
                  max={90}
                  value={discountPct}
                  onChange={(e) => setDiscountPct(e.target.value)}
                  className="w-24 bg-white/[0.05] border border-white/[0.1] rounded-xl px-3 py-1.5 text-sm text-gray-200 focus:outline-none focus:border-primary-500"
                />
                <div className="flex items-center gap-1.5 flex-wrap">
                  {[10, 15, 20, 30, 50].map((pct) => (
                    <button
                      type="button"
                      key={pct}
                      onClick={() => setDiscountPct(pct)}
                      className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                        Number(discountPct) === pct
                          ? "bg-amber-500 text-black shadow-md shadow-amber-950/40"
                          : "bg-white/[0.05] border border-white/[0.08] text-gray-400 hover:text-white"
                      }`}>
                      {pct}%
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* 3. Thời gian giữ ưu đãi & Trần suất */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-semibold text-gray-300 block mb-1.5 uppercase tracking-wide">
                  3. Thời hạn giữ ưu đãi
                </label>
                <select
                  value={validityMinutes}
                  onChange={(e) => setValidityMinutes(Number(e.target.value))}
                  className="w-full bg-[#121622] border border-white/[0.1] rounded-xl px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-primary-500">
                  <option value={15}>15 phút</option>
                  <option value={30}>30 phút</option>
                  <option value={60}>1 giờ (Mặc định)</option>
                  <option value={120}>2 giờ</option>
                  <option value={240}>4 giờ</option>
                  <option value={1440}>1 ngày (24 giờ)</option>
                </select>
              </div>

              <div>
                <label className="text-xs font-semibold text-gray-300 block mb-1.5 uppercase tracking-wide">
                  4. Số suất tối đa
                </label>
                <select
                  value={maxSlots}
                  onChange={(e) => setMaxSlots(Number(e.target.value))}
                  className="w-full bg-[#121622] border border-white/[0.1] rounded-xl px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-primary-500">
                  <option value={0}>∞ Không giới hạn</option>
                  <option value={10}>10 suất</option>
                  <option value={20}>20 suất</option>
                  <option value={50}>50 suất</option>
                  <option value={100}>100 suất</option>
                  <option value={200}>200 suất</option>
                </select>
              </div>
            </div>

            {/* 5. Gửi Broadcast */}
            <div className="p-3 rounded-xl bg-white/[0.03] border border-white/[0.06]">
              <label className="flex items-start gap-2.5 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={sendBroadcast}
                  onChange={(e) => setSendBroadcast(e.target.checked)}
                  className="mt-0.5 rounded border-white/[0.2] bg-white/[0.05] text-primary-600 focus:ring-0 cursor-pointer"
                />
                <div>
                  <p className="text-xs font-medium text-gray-200 flex items-center gap-1.5">
                    <Bell size={13} className="text-sky-400" />
                    Phát sóng tin nhắn Telegram (Broadcast) cho toàn bộ khách hàng
                  </p>
                  <p className="text-[11px] text-gray-500 mt-0.5 leading-relaxed">
                    {sendBroadcast
                      ? "Bot sẽ tự động gửi thông báo kèm nút [⚡ Nhận ngay] cho toàn bộ khách trong danh bạ."
                      : "Chỉ mở ưu đãi trên hệ thống, KHÔNG gửi tin nhắn hàng loạt (phù hợp khi test)."}
                  </p>
                </div>
              </label>
            </div>

            {/* 6. Hướng dẫn riêng từ Shop */}
            <div>
              <label className="text-xs font-semibold text-gray-300 block mb-1.5 uppercase tracking-wide">
                5. Hướng dẫn / Lưu ý đính kèm (Tùy chọn)
              </label>
              <textarea
                rows={2}
                value={guideText}
                onChange={(e) => setGuideText(e.target.value)}
                placeholder="Ví dụ: Hỗ trợ Claude 3.5, Cursor, NextChat. (Để trống nếu chỉ dùng hướng dẫn mặc định)"
                className="w-full bg-[#121622] border border-white/[0.1] rounded-xl px-3 py-2 text-xs text-gray-200 placeholder-gray-600 focus:outline-none focus:border-primary-500 transition-colors"
              />
            </div>
          </div>

          {/* CỘT PHẢI: MÔ PHỎNG TIN NHẮN TELEGRAM REALTIME (5 CỘT) */}
          <div className="lg:col-span-5 space-y-3">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide flex items-center gap-1.5">
              <span>📱</span> Mô phỏng tin nhắn gửi cho khách
            </p>

            <div className="rounded-2xl bg-[#17212b] border border-[#232e3c] p-4 text-xs text-gray-200 font-sans shadow-xl relative overflow-hidden">
              {/* Telegram chat message header */}
              <div className="flex items-center gap-2 mb-3 pb-2 border-b border-white/[0.05]">
                <div className="w-6 h-6 rounded-full bg-primary-600 flex items-center justify-center text-white text-[10px] font-bold">
                  🤖
                </div>
                <div>
                  <p className="text-[11px] font-bold text-white">Bot Shop Thông Báo</p>
                  <p className="text-[9px] text-gray-400">Tin nhắn ưu đãi tự động</p>
                </div>
              </div>

              {/* Message Body */}
              <div className="space-y-2 text-xs leading-relaxed">
                <p className="font-bold text-amber-400 text-sm flex items-center gap-1">
                  ⚡ FLASH SALE: {selectedProduct?.name || "Tên sản phẩm"}
                </p>

                <p className="font-semibold text-white">
                  🔥 <span className="bg-amber-500/20 text-amber-300 px-1.5 py-0.5 rounded">GIẢM NGAY {discountPct}%</span>
                </p>

                {previewPrice && (
                  <p className="text-gray-300">
                    💰 Giá gốc: <span className="line-through text-gray-500">{previewPrice.orig}</span> ➔ Giảm còn: <b className="text-emerald-400">{previewPrice.sale}</b>
                  </p>
                )}

                <p className="text-gray-300">
                  ⏳ <b>Hiệu lực:</b> {validityMinutes >= 60 ? `${(validityMinutes / 60).toFixed(1)} giờ` : `${validityMinutes} phút`} kể từ khi bấm nhận
                </p>

                {Number(maxSlots) > 0 && (
                  <p className="text-gray-300">
                    🎯 <b>Số lượng:</b> Giới hạn {maxSlots} suất đầu tiên!
                  </p>
                )}

                <div className="p-2 rounded-lg bg-black/20 border border-white/[0.05] space-y-1 text-[11px]">
                  <p className="font-semibold text-gray-400 uppercase text-[10px]">📌 Hướng dẫn nhận ưu đãi:</p>
                  <p>1️⃣ Bấm <b>[⚡ Nhận ưu đãi]</b> bên dưới</p>
                  <p>2️⃣ Chọn sản phẩm & thanh toán với giá đã giảm</p>
                  {guideText.trim() && (
                    <p className="text-sky-300 pt-1 border-t border-white/[0.05] whitespace-pre-wrap">
                      💡 {guideText.trim()}
                    </p>
                  )}
                </div>
              </div>

              {/* Mock Telegram Inline Buttons */}
              <div className="mt-4 space-y-1.5">
                <button
                  type="button"
                  className="w-full py-2 rounded-lg bg-[#2b5278] hover:bg-[#346290] text-white text-xs font-semibold text-center transition-colors">
                  ⚡ Nhận ưu đãi (−{discountPct}%)
                </button>
                <button
                  type="button"
                  className="w-full py-1.5 rounded-lg bg-white/[0.05] text-gray-400 text-[11px] text-center">
                  Bỏ qua đợt này
                </button>
              </div>
            </div>

            {/* Price Saved Card */}
            {previewPrice && (
              <div className="p-3 rounded-xl bg-emerald-950/20 border border-emerald-500/30 flex items-center justify-between text-xs">
                <span className="text-gray-300">Mỗi khách mua tiết kiệm:</span>
                <span className="font-bold text-emerald-400">{previewPrice.saved}</span>
              </div>
            )}
          </div>
        </div>

        {/* Buttons */}
        <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-white/[0.07]">
          <button
            type="button"
            onClick={onClose}
            disabled={createMut.isPending}
            className="px-4 py-2 rounded-xl text-xs font-medium text-gray-400 hover:text-white bg-white/[0.05] border border-white/[0.08] transition-colors">
            Huỷ bỏ
          </button>
          <button
            type="submit"
            disabled={createMut.isPending || !productId}
            className="flex items-center gap-1.5 px-5 py-2.5 rounded-xl text-xs font-semibold text-white bg-gradient-to-r from-primary-600 to-indigo-600 hover:from-primary-500 hover:to-indigo-500 shadow-lg shadow-primary-950/40 border border-primary-400/30 transition-all cursor-pointer disabled:opacity-50">
            <Zap size={14} />
            <span>{createMut.isPending ? "Đang khởi tạo..." : "Xác nhận & Khởi chạy Flash Sale"}</span>
          </button>
        </div>
      </form>
    </Modal>
  );
}
