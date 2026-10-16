import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  KeyRound, Search, RefreshCw, Eye, EyeOff, Copy, Check, Plus,
  RotateCcw, Power, AlertTriangle, CheckCircle2, ShieldCheck,
  Zap, Calendar, Clock, Sparkles, ExternalLink, X, Info as InfoIcon
} from "lucide-react";
import { api } from "../api/endpoints";
import Pagination from "../components/Pagination";
import Modal from "../components/Modal";
import EmptyState from "../components/EmptyState";
import StatsCard from "../components/StatsCard";
import { formatDate } from "../utils/format";

function fmtTokens(n) {
  const m = Number(n || 0) / 1e6;
  if (m >= 1000) return `${Number((m / 1000).toFixed(1))}B`;
  if (Number.isInteger(m)) return `${m}M`;
  return `${Number(m.toFixed(2))}M`;
}

const SOURCE_META = {
  GIFTCODE: { label: "Quà tặng", cls: "bg-pink-950/60 text-pink-300 border-pink-800/50" },
  PURCHASE: { label: "Đã mua", cls: "bg-emerald-950/60 text-emerald-300 border-emerald-800/50" },
  ADMIN:    { label: "Admin cấp", cls: "bg-violet-950/60 text-violet-300 border-violet-800/50" },
  REFERRAL: { label: "Mời bạn", cls: "bg-sky-950/60 text-sky-300 border-sky-800/50" },
  SELLER:   { label: "Đại lý", cls: "bg-amber-950/60 text-amber-300 border-amber-800/50" },
};

function SourceBadge({ source }) {
  const m = SOURCE_META[source] || { label: source || "?", cls: "bg-white/[0.06] text-gray-400 border-white/[0.1]" };
  return <span className={`inline-flex px-2 py-0.5 rounded-full text-[11px] font-medium border ${m.cls}`}>{m.label}</span>;
}

const STATUS_META = {
  active:    { label: "Hoạt động", cls: "bg-emerald-950/60 text-emerald-300 border-emerald-800/50" },
  low:       { label: "Sắp hết",   cls: "bg-amber-950/60 text-amber-300 border-amber-800/50" },
  exhausted: { label: "Cạn quota", cls: "bg-rose-950/60 text-rose-300 border-rose-800/50" },
  expired:   { label: "Hết hạn",   cls: "bg-gray-800/60 text-gray-400 border-gray-700/50" },
  locked:    { label: "Bị khoá",   cls: "bg-red-950/60 text-red-300 border-red-800/50" },
  missing:   { label: "Không tìm thấy", cls: "bg-gray-800/40 text-gray-500 border-gray-700/40" },
};

function StatusBadge({ status, live }) {
  const m = STATUS_META[status] || { label: status || "—", cls: "bg-white/[0.04] text-gray-400 border-white/[0.08]" };
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium border ${m.cls}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${live ? "bg-emerald-400" : "bg-gray-500"}`} />
      {m.label}
    </span>
  );
}

function UsageBar({ pct, unlimited }) {
  if (unlimited) return <span className="text-[11px] text-gray-500">vô hạn</span>;
  const p = Math.max(0, Math.min(100, Number(pct) || 0));
  const color = p >= 90 ? "bg-red-500" : p >= 75 ? "bg-amber-500" : "bg-emerald-500";
  return (
    <div className="w-24 bg-white/[0.06] rounded-full h-1.5 overflow-hidden mt-1">
      <div className={`h-full ${color} rounded-full transition-all`} style={{ width: `${p}%` }} />
    </div>
  );
}

export default function ApiKeyManagement() {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [source, setSource] = useState("");
  const [status, setStatus] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [detailId, setDetailId] = useState(null);
  const [renewKey, setRenewKey] = useState(null);
  const [issueOpen, setIssueOpen] = useState(false);
  const [copiedId, setCopiedId] = useState(null);

  const qc = useQueryClient();

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ["issued-keys", { page, pageSize, source, q: search, status }],
    queryFn: () => api.issuedKeys({
      page,
      limit: pageSize,
      source: source || undefined,
      q: search || undefined,
      status: status || undefined,
    }),
  });

  const { data: stats } = useQuery({
    queryKey: ["issued-key-stats"],
    queryFn: api.issuedKeyStats,
  });

  const toggleMut = useMutation({
    mutationFn: ({ id, enabled }) => api.toggleIssuedKey(id, enabled),
    onSuccess: () => {
      qc.invalidateQueries(["issued-keys"]);
      qc.invalidateQueries(["issued-key-stats"]);
      if (detailId) qc.invalidateQueries(["issued-key", detailId]);
    },
  });

  const hideMut = useMutation({
    mutationFn: ({ id, hidden }) => api.hideIssuedKey(id, hidden),
    onSuccess: () => {
      qc.invalidateQueries(["issued-keys"]);
      if (detailId) qc.invalidateQueries(["issued-key", detailId]);
    },
  });

  const keys = data?.keys || [];
  const total = data?.total || 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  function applySearch(e) {
    e?.preventDefault();
    setSearch(searchInput.trim());
    setPage(1);
  }

  function copyKey(keyStr, id) {
    if (!keyStr) return;
    navigator.clipboard.writeText(keyStr);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <div className="eyebrow text-electric-cyan mb-1 flex items-center gap-2">
            <span>PROVISIONING // ISSUED API KEYS</span>
          </div>
          <h1 className="text-xl font-bold tracking-tight text-slate-100 font-display flex items-center gap-2">
            <KeyRound className="text-electric-indigo" size={22} />
            Quản lý API key
          </h1>
          <p className="text-xs text-slate-400 mt-0.5">
            Tra cứu trạng thái live từ nhà cung cấp, gia hạn thêm quota/ngày, thu hồi/vô hiệu hoá hoặc cấp key thủ công
          </p>
        </div>

        <div className="flex items-center gap-2">
          <span className="mono-badge text-[10px] bg-indigo-950/60 text-indigo-300 border border-indigo-800/60">
            TOTAL: {stats?.total || total || 0} KEYS
          </span>
          <button
            onClick={() => qc.invalidateQueries(["issued-keys"])}
            disabled={isFetching}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-900 border border-slate-800 hover:border-slate-700 rounded-lg text-xs font-mono text-slate-300 hover:text-white transition-colors disabled:opacity-50"
          >
            <RefreshCw size={12} className={isFetching ? "animate-spin text-electric-cyan" : ""} />
            Làm mới
          </button>
          <button
            onClick={() => setIssueOpen(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-electric-indigo hover:bg-indigo-500 text-white rounded-lg text-xs font-mono font-medium transition-all shadow-sm"
          >
            <Plus size={13} />
            Cấp key thủ công
          </button>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <StatsCard
          icon={KeyRound}
          label="Tổng key đã cấp"
          eyebrow="TOTAL ISSUED"
          value={(stats?.total || total).toLocaleString()}
          iconBg="bg-indigo-500/10"
          iconColor="text-electric-indigo"
        />
        <StatsCard
          icon={Sparkles}
          label="Tổng Quota bán"
          eyebrow="TOTAL QUOTA"
          value={fmtTokens(stats?.totalQuota || 0)}
          iconBg="bg-emerald-500/10"
          iconColor="text-emerald-400"
        />
        <StatsCard
          icon={CheckCircle2}
          label="Đang hoạt động (live)"
          eyebrow="ACTIVE KEYS"
          value={(stats?.byStatus?.active || 0).toLocaleString()}
          iconBg="bg-cyan-500/10"
          iconColor="text-electric-cyan"
        />
        <StatsCard
          icon={AlertTriangle}
          label="Cạn quota / Hết hạn"
          eyebrow="EXHAUSTED / EXPIRED"
          value={`${stats?.byStatus?.exhausted || 0} / ${stats?.byStatus?.expired || 0}`}
          iconBg="bg-amber-500/10"
          iconColor="text-amber-400"
        />
      </div>

      {/* Filters and Search Bar */}
      <div className="bento-card p-4 space-y-3">
        {/* Status quick filters */}
        <div className="flex flex-wrap gap-1.5 items-center">
          <span className="text-xs text-gray-400 font-medium mr-1">Trạng thái:</span>
          {[
            { id: "", label: "Tất cả" },
            { id: "active", label: "🟢 Hoạt động" },
            { id: "low", label: "🟡 Sắp hết" },
            { id: "exhausted", label: "🔴 Cạn quota" },
            { id: "expired", label: "⚪ Hết hạn" },
            { id: "locked", label: "⛔ Bị khoá" },
          ].map((st) => (
            <button
              key={st.id}
              onClick={() => { setStatus(st.id); setPage(1); }}
              className={`text-xs px-2.5 py-1 rounded-lg border transition-colors ${
                status === st.id
                  ? "bg-primary-600/30 text-primary-300 border-primary-500/50 font-medium"
                  : "bg-white/[0.03] text-gray-400 border-white/[0.06] hover:bg-white/[0.06] hover:text-gray-200"
              }`}
            >
              {st.label}
            </button>
          ))}
        </div>

        {/* Search & Source dropdown */}
        <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-center pt-1 border-t border-white/[0.06]">
          <form onSubmit={applySearch} className="md:col-span-8 flex gap-2">
            <div className="relative flex-1">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
              <input
                type="text"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                placeholder="Tìm theo key sk-..., Telegram ID, @username, mã đơn..."
                className="w-full glass-input rounded-lg pl-9 pr-3 py-2 text-xs font-mono"
              />
            </div>
            <button
              type="submit"
              className="px-3.5 py-2 bg-primary-600 text-white rounded-lg text-xs font-medium hover:bg-primary-500 transition-colors"
            >
              Tìm kiếm
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

          <div className="md:col-span-4 flex justify-end">
            <select
              value={source}
              onChange={(e) => { setSource(e.target.value); setPage(1); }}
              className="glass-input rounded-lg px-3 py-2 text-xs w-full sm:w-auto"
            >
              <option value="">Tất cả nguồn cấp</option>
              <option value="PURCHASE">🛒 Đã mua</option>
              <option value="GIFTCODE">🎁 Quà tặng (Giftcode)</option>
              <option value="ADMIN">🛡️ Admin cấp</option>
              <option value="REFERRAL">👥 Mời bạn (Referral)</option>
              <option value="SELLER">🏢 Đại lý (Seller)</option>
            </select>
          </div>
        </div>
      </div>

      {/* Main Table */}
      <div className="glass rounded-xl overflow-hidden border border-white/[0.08]">
        {isLoading ? (
          <div className="p-12 text-center text-gray-500 text-sm">
            <RefreshCw size={20} className="animate-spin mx-auto mb-2 opacity-50" />
            Đang tải danh sách key API...
          </div>
        ) : keys.length === 0 ? (
          <EmptyState
            title="Không có key nào khớp bộ lọc"
            description={search || status || source ? "Thử đổi từ khoá tìm kiếm hoặc đặt lại bộ lọc." : "Chưa có key nào được cấp trong hệ thống."}
            icon={KeyRound}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-white/[0.08] bg-white/[0.02] text-gray-400 uppercase tracking-wider font-semibold">
                  <th className="px-3.5 py-3">Khách hàng</th>
                  <th className="px-3.5 py-3">Key API</th>
                  <th className="px-3.5 py-3">Trạng thái Live</th>
                  <th className="px-3.5 py-3">Quota & Đã dùng</th>
                  <th className="px-3.5 py-3">RPM / TPM</th>
                  <th className="px-3.5 py-3">Gia hạn</th>
                  <th className="px-3.5 py-3">Server</th>
                  <th className="px-3.5 py-3">Nguồn</th>
                  <th className="px-3.5 py-3">Hạn dùng</th>
                  <th className="px-3.5 py-3 text-right">Thao tác</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.05]">
                {keys.map((k) => (
                  <tr key={k.id} className="hover:bg-white/[0.02] transition-colors">
                    {/* Khách hàng */}
                    <td className="px-3.5 py-3">
                      <div className="min-w-0">
                        <p className="font-medium text-gray-200 truncate">
                          {k.userName || "—"}
                          {k.userVip > 0 && (
                            <span className="ml-1 text-[10px] text-amber-400 font-bold">VIP{k.userVip}</span>
                          )}
                          {k.userBlocked && <span className="text-red-400 text-[10px] ml-1">· chặn</span>}
                        </p>
                        <p className="text-[11px] text-gray-500 font-mono">
                          {k.userUsername ? `@${k.userUsername} · ` : ""}{k.telegramId}
                        </p>
                      </div>
                    </td>

                    {/* Key sk-... */}
                    <td className="px-3.5 py-3 whitespace-nowrap">
                      <div className="flex items-center gap-1.5">
                        <code className="text-[11px] font-mono text-gray-300 bg-black/30 px-1.5 py-0.5 rounded border border-white/[0.06]">
                          {k.keyMasked}
                        </code>
                        <button
                          onClick={() => copyKey(k.key, k.id)}
                          className="p-1 text-gray-400 hover:text-white rounded hover:bg-white/[0.06] transition-colors"
                          title="Sao chép key"
                        >
                          {copiedId === k.id ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} />}
                        </button>
                      </div>
                    </td>

                    {/* Trạng thái Live */}
                    <td className="px-3.5 py-3 whitespace-nowrap">
                      <StatusBadge status={k.status} live={k.live} />
                      {k.hiddenAt && (
                        <p className="text-[10px] text-amber-400 mt-0.5">· Ẩn khỏi /mykey</p>
                      )}
                    </td>

                    {/* Quota & Đã dùng */}
                    <td className="px-3.5 py-3 whitespace-nowrap">
                      <p className="text-gray-200 font-semibold">
                        {k.live && !k.unlimitedQuota ? fmtTokens(k.quotaTokensLive) : k.unlimitedQuota ? "∞" : fmtTokens(k.quotaTokens)}
                        {k.live && !k.unlimitedQuota && k.quotaTokensLive !== k.quotaTokens && (
                          <span className="text-[10px] text-gray-500 font-normal"> (bán {fmtTokens(k.quotaTokens)})</span>
                        )}
                      </p>
                      {k.live && <UsageBar pct={k.usedPct} unlimited={k.unlimitedQuota} />}
                    </td>

                    {/* RPM / TPM */}
                    <td className="px-3.5 py-3 whitespace-nowrap text-gray-400">
                      {k.live ? `${k.rpmLive || 0} / ${k.tpmLive || 0}` : (k.rpm > 0 ? `${k.rpm} / —` : "—")}
                    </td>

                    {/* Gia hạn */}
                    <td className="px-3.5 py-3 whitespace-nowrap">
                      {k.renewCount > 0 ? (
                        <span className="text-emerald-400 font-bold">×{k.renewCount}</span>
                      ) : (
                        <span className="text-gray-600">—</span>
                      )}
                    </td>

                    {/* Server */}
                    <td className="px-3.5 py-3 whitespace-nowrap text-gray-300">
                      {k.profileName || "Mặc định"}
                    </td>

                    {/* Nguồn */}
                    <td className="px-3.5 py-3 whitespace-nowrap">
                      <SourceBadge source={k.source} />
                    </td>

                    {/* Hạn dùng */}
                    <td className="px-3.5 py-3 whitespace-nowrap text-gray-400">
                      {(k.expiresAtLive || k.expiresAt) ? formatDate(k.expiresAtLive || k.expiresAt).slice(0, 10) : "∞"}
                      {k.live && k.daysLeft != null && k.daysLeft >= 0 && (
                        <p className={`text-[10px] ${k.daysLeft <= 3 ? "text-amber-400 font-bold" : "text-gray-500"}`}>
                          còn {k.daysLeft} ngày
                        </p>
                      )}
                    </td>

                    {/* Thao tác */}
                    <td className="px-3.5 py-3 whitespace-nowrap text-right">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => setDetailId(k.id)}
                          className="px-2 py-1 bg-white/[0.05] hover:bg-white/[0.1] text-gray-300 hover:text-white rounded text-[11px] transition-colors flex items-center gap-1"
                          title="Xem chi tiết"
                        >
                          <Eye size={12} /> Chi tiết
                        </button>
                        <button
                          onClick={() => setRenewKey(k)}
                          className="px-2 py-1 bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-300 border border-emerald-700/40 rounded text-[11px] transition-colors flex items-center gap-1"
                          title="Gia hạn thêm quota/ngày"
                        >
                          <RotateCcw size={12} /> Gia hạn
                        </button>
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

      {/* Modal Chi tiết Key */}
      {detailId && (
        <KeyDetailModal
          id={detailId}
          onClose={() => setDetailId(null)}
          onOpenRenew={(k) => {
            setDetailId(null);
            setRenewKey(k);
          }}
        />
      )}

      {/* Modal Gia hạn Key */}
      {renewKey && (
        <RenewKeyModal
          keyItem={renewKey}
          onClose={() => setRenewKey(null)}
        />
      )}

      {/* Modal Cấp key thủ công */}
      {issueOpen && (
        <IssueKeyModal onClose={() => setIssueOpen(false)} />
      )}
    </div>
  );
}

// ────────────────────────── Modal Chi tiết Key ──────────────────────────
function KeyDetailModal({ id, onClose, onOpenRenew }) {
  const [copied, setCopied] = useState(false);
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["issued-key", id],
    queryFn: () => api.issuedKey(id),
    enabled: !!id,
  });

  const hideMut = useMutation({
    mutationFn: ({ hidden }) => api.hideIssuedKey(id, hidden),
    onSuccess: () => {
      qc.invalidateQueries(["issued-key", id]);
      qc.invalidateQueries(["issued-keys"]);
    },
  });

  const toggleMut = useMutation({
    mutationFn: ({ enabled }) => api.toggleIssuedKey(id, enabled),
    onSuccess: () => {
      qc.invalidateQueries(["issued-key", id]);
      qc.invalidateQueries(["issued-keys"]);
      qc.invalidateQueries(["issued-key-stats"]);
    },
  });

  const k = data?.key;
  const live = data?.live || { live: false, status: "missing" };
  const renewals = data?.renewals || [];

  function copyKey() {
    if (!k?.key) return;
    navigator.clipboard.writeText(k.key);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <Modal open={!!id} onClose={onClose} title="Chi tiết API key" width="max-w-xl">
      {isLoading || !k ? (
        <p className="text-sm text-gray-400 py-6 text-center">Đang tải thông tin key...</p>
      ) : (
        <div className="space-y-4 text-xs">
          {/* Chuỗi key */}
          <div>
            <p className="text-gray-400 font-medium mb-1">Chuỗi API Key (sk-...)</p>
            <div className="flex items-center gap-2">
              <code className="flex-1 bg-black/40 text-emerald-300 font-mono px-3 py-2 rounded-lg text-xs break-all border border-white/[0.08]">
                {k.key}
              </code>
              <button
                onClick={copyKey}
                className="p-2 glass rounded-lg text-gray-400 hover:text-white transition-colors"
                title="Sao chép"
              >
                {copied ? <Check size={14} className="text-emerald-400" /> : <Copy size={14} />}
              </button>
            </div>
          </div>

          {/* Tình trạng Live */}
          <div className="glass p-3 rounded-lg space-y-2 border border-white/[0.08]">
            <div className="flex items-center justify-between">
              <p className="font-semibold text-gray-300">Tình trạng thực tế (Provider)</p>
              <StatusBadge status={live.status} live={live.live} />
            </div>
            {live.live ? (
              <>
                <UsageBar pct={live.usedPct} unlimited={live.unlimitedQuota} />
                <div className="grid grid-cols-2 gap-2 text-gray-400 pt-1">
                  <div>Quota live: <b className="text-emerald-300">{live.unlimitedQuota ? "Vô hạn" : `${fmtTokens(live.quotaTokensLive)} token`}</b></div>
                  <div>Đã dùng: <b className="text-gray-200">{live.unlimitedQuota ? "—" : `${fmtTokens(live.usedTokensLive)} token (${live.usedPct}%)`}</b></div>
                  <div>RPM / TPM đặt: <b className="text-gray-200">{live.rpmLive || 0} / {live.tpmLive || 0}</b></div>
                  <div>RPM / TPM áp: <b className="text-gray-200">{live.effectiveRpm || 0} / {live.effectiveTpm || 0}</b></div>
                  <div>Hạn dùng: <b className="text-gray-200">{live.expiresAtLive ? `${formatDate(live.expiresAtLive)} (còn ${live.daysLeft}n)` : "Vô hạn"}</b></div>
                  <div>Đang bật: <b className={live.enabled ? "text-emerald-400" : "text-red-400"}>{live.enabled ? "Bật" : "Tắt (Vô hiệu)"}</b></div>
                </div>
                {live.lockReason && (
                  <p className="text-red-400 text-[11px]">Lý do khoá: {live.lockReason}</p>
                )}
              </>
            ) : (
              <p className="text-gray-500">Không đọc được thông tin live bên nhà cung cấp.</p>
            )}
          </div>

          {/* Thông tin bot lưu */}
          <div className="grid grid-cols-2 gap-2 glass p-3 rounded-lg text-gray-400">
            <div>Khách: <b className="text-gray-200">{data.user?.firstName || data.user?.username || k.telegramId}</b></div>
            <div>Telegram ID: <code className="text-gray-300 font-mono">{k.telegramId}</code></div>
            <div>Nguồn cấp: <SourceBadge source={k.source} /></div>
            <div>Server: <b className="text-gray-200">{k.profileName || "Mặc định"}</b></div>
            <div>Quota đã bán: <b className="text-gray-200">{fmtTokens(k.quotaTokens)} token</b></div>
            <div>Số lần gia hạn: <b className="text-emerald-400">{k.renewCount || 0} lần</b></div>
            <div>Ngày tạo: <b className="text-gray-200">{formatDate(k.createdAt)}</b></div>
            <div>Ẩn khỏi /mykey: <b className={k.hiddenAt ? "text-amber-400" : "text-gray-200"}>{k.hiddenAt ? "Có (đang ẩn)" : "Không"}</b></div>
          </div>

          {/* Actions Bar */}
          <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-white/[0.08]">
            <div className="flex items-center gap-2">
              {/* Toggle Enable/Disable on provider */}
              <button
                onClick={() => toggleMut.mutate({ enabled: !live.enabled })}
                disabled={toggleMut.isPending}
                className={`px-3 py-1.5 rounded-lg font-medium transition-colors flex items-center gap-1.5 ${
                  live.enabled
                    ? "bg-red-600/20 text-red-300 border border-red-700/40 hover:bg-red-600/30"
                    : "bg-emerald-600/20 text-emerald-300 border border-emerald-700/40 hover:bg-emerald-600/30"
                }`}
              >
                <Power size={13} />
                {live.enabled ? "Thu hồi / Vô hiệu hoá" : "Mở lại key này"}
              </button>

              {/* Hide/Unhide */}
              <button
                onClick={() => hideMut.mutate({ hidden: !k.hiddenAt })}
                disabled={hideMut.isPending}
                className="px-3 py-1.5 glass rounded-lg text-gray-300 hover:text-white transition-colors flex items-center gap-1.5"
              >
                {k.hiddenAt ? <Eye size={13} /> : <EyeOff size={13} />}
                {k.hiddenAt ? "Hiện ở /mykey" : "Ẩn ở /mykey"}
              </button>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={() => onOpenRenew(k)}
                className="px-3 py-1.5 bg-emerald-600 text-white rounded-lg font-medium hover:bg-emerald-500 transition-colors flex items-center gap-1.5"
              >
                <RotateCcw size={13} />
                Gia hạn key
              </button>
              <button
                onClick={onClose}
                className="px-3 py-1.5 glass rounded-lg text-gray-400 hover:text-white transition-colors"
              >
                Đóng
              </button>
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}

// ────────────────────────── Modal Gia hạn Key ──────────────────────────
function RenewKeyModal({ keyItem, onClose }) {
  const [tokensM, setTokensM] = useState("10");
  const [addDays, setAddDays] = useState("0");
  const [notify, setNotify] = useState(true);
  const qc = useQueryClient();

  const renewMut = useMutation({
    mutationFn: (data) => api.renewIssuedKey(keyItem.id, data),
    onSuccess: () => {
      qc.invalidateQueries(["issued-keys"]);
      qc.invalidateQueries(["issued-key-stats"]);
      onClose();
    },
  });

  function handleSubmit(e) {
    e.preventDefault();
    const addTokens = Math.max(0, (Number(tokensM) || 0) * 1e6);
    const days = Math.max(0, Number(addDays) || 0);
    if (addTokens === 0 && days === 0) return;
    renewMut.mutate({ addTokens, addDays: days, notify });
  }

  return (
    <Modal open onClose={onClose} title="Gia hạn thủ công API key" width="max-w-md">
      <form onSubmit={handleSubmit} className="space-y-4 text-xs">
        <div className="glass p-3 rounded-lg space-y-1">
          <p className="text-gray-400">Khách hàng: <b className="text-gray-200">{keyItem.userName || keyItem.telegramId}</b></p>
          <p className="text-gray-400">Key: <code className="text-emerald-300 font-mono">{keyItem.keyMasked}</code></p>
          <p className="text-gray-400">Server: <b className="text-gray-200">{keyItem.profileName}</b></p>
        </div>

        <div>
          <label className="block text-gray-400 font-medium mb-1">Cộng thêm Quota (triệu token)</label>
          <input
            type="number"
            step="1"
            min="0"
            value={tokensM}
            onChange={(e) => setTokensM(e.target.value)}
            className="w-full glass-input rounded-lg px-3 py-2 text-xs"
            placeholder="Ví dụ: 10 (= 10M token)"
          />
        </div>

        <div>
          <label className="block text-gray-400 font-medium mb-1">Cộng thêm số ngày hết hạn (0 = không đổi)</label>
          <input
            type="number"
            step="1"
            min="0"
            value={addDays}
            onChange={(e) => setAddDays(e.target.value)}
            className="w-full glass-input rounded-lg px-3 py-2 text-xs"
            placeholder="Ví dụ: 30"
          />
        </div>

        <label className="flex items-center gap-2 text-gray-300 cursor-pointer">
          <input
            type="checkbox"
            checked={notify}
            onChange={(e) => setNotify(e.target.checked)}
            className="rounded"
          />
          Gửi tin nhắn thông báo tự động cho khách qua bot
        </label>

        {renewMut.isError && (
          <div className="p-2.5 rounded-lg bg-red-950/40 border border-red-800/40 text-red-300">
            {renewMut.error?.response?.data?.error || renewMut.error?.message}
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2 border-t border-white/[0.08]">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-2 glass rounded-lg text-gray-400 hover:text-white transition-colors"
          >
            Hủy
          </button>
          <button
            type="submit"
            disabled={renewMut.isPending}
            className="px-4 py-2 bg-emerald-600 text-white rounded-lg font-medium hover:bg-emerald-500 transition-colors flex items-center gap-1.5 disabled:opacity-50"
          >
            <RotateCcw size={13} className={renewMut.isPending ? "animate-spin" : ""} />
            {renewMut.isPending ? "Đang xử lý..." : "Xác nhận gia hạn"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

// ────────────────────────── Modal Cấp key thủ công ──────────────────────────
function IssueKeyModal({ onClose }) {
  const [form, setForm] = useState({
    telegramId: "",
    tokensM: "10",
    rpm: "100",
    days: "0",
    notify: true,
    profileId: "",
  });
  const [copied, setCopied] = useState(false);
  const qc = useQueryClient();

  const { data: cfgData } = useQuery({ queryKey: ["gpt2api-config"], queryFn: api.gpt2apiConfig });
  const servers = cfgData?.effectiveProfiles || [];

  const previewMut = useMutation({ mutationFn: api.gpt2apiPricePreview });
  const issueMut = useMutation({
    mutationFn: api.issueApiKey,
    onSuccess: () => {
      qc.invalidateQueries(["issued-keys"]);
      qc.invalidateQueries(["issued-key-stats"]);
    },
  });

  const tokens = (Number(form.tokensM) || 0) * 1e6;
  const rpm = Number(form.rpm) || 0;
  const validDays = Number(form.days) || 0;
  const validId = /^\d{3,}$/.test(form.telegramId.trim());
  const canPreview = validId && tokens >= 1e6;

  function set(k, v) {
    setForm((p) => ({ ...p, [k]: v }));
  }

  function submit() {
    issueMut.mutate({
      telegramId: form.telegramId.trim(),
      tokens,
      rpm,
      validDays,
      notify: form.notify,
      profileId: form.profileId === "" ? undefined : Number(form.profileId),
    });
  }

  function copyKey() {
    navigator.clipboard.writeText(issueMut.data.key);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const done = issueMut.data?.ok;

  return (
    <Modal open onClose={onClose} title="Cấp API key thủ công cho khách" width="max-w-lg">
      {done ? (
        <div className="space-y-4 text-xs">
          <p className="text-emerald-400 flex items-center gap-1.5 font-medium">
            <CheckCircle2 size={16} /> Đã cấp key thành công
            {issueMut.data.notified ? " và gửi tin nhắn qua bot Telegram cho khách." : " (chưa gửi tin nhắn)."}
          </p>
          <div className="flex items-center gap-2">
            <code className="flex-1 bg-black/40 text-emerald-300 font-mono px-3 py-2 rounded-lg break-all border border-white/[0.08]">
              {issueMut.data.key}
            </code>
            <button
              onClick={copyKey}
              className="p-2 glass rounded-lg text-gray-400 hover:text-white transition-colors"
            >
              {copied ? <Check size={14} className="text-emerald-400" /> : <Copy size={14} />}
            </button>
          </div>
          <div className="flex justify-end pt-2">
            <button
              onClick={onClose}
              className="px-4 py-2 bg-primary-600 text-white rounded-lg font-medium hover:bg-primary-500 transition-colors"
            >
              Hoàn tất
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-4 text-xs">
          <div>
            <label className="block text-gray-400 font-medium mb-1">Telegram ID của khách</label>
            <input
              value={form.telegramId}
              onChange={(e) => set("telegramId", e.target.value)}
              className="w-full glass-input rounded-lg px-3 py-2 text-xs font-mono"
              placeholder="Ví dụ: 1657377107 (chỉ nhập số)"
            />
          </div>

          {servers.length > 1 && (
            <div>
              <label className="block text-gray-400 font-medium mb-1">Server (Nhóm model fallback)</label>
              <select
                value={form.profileId}
                onChange={(e) => set("profileId", e.target.value)}
                className="w-full glass-input rounded-lg px-3 py-2 text-xs"
              >
                <option value="">(Server mặc định)</option>
                {servers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}{s.enabled === false ? " — đang tắt" : ""}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="grid grid-cols-3 gap-2">
            <div>
              <label className="block text-gray-400 font-medium mb-1">Token (triệu)</label>
              <input
                type="number"
                value={form.tokensM}
                onChange={(e) => set("tokensM", e.target.value)}
                className="w-full glass-input rounded-lg px-3 py-2 text-xs"
              />
            </div>
            <div>
              <label className="block text-gray-400 font-medium mb-1">RPM (0 = chuẩn)</label>
              <input
                type="number"
                value={form.rpm}
                onChange={(e) => set("rpm", e.target.value)}
                className="w-full glass-input rounded-lg px-3 py-2 text-xs"
              />
            </div>
            <div>
              <label className="block text-gray-400 font-medium mb-1">Số ngày (0 = ∞)</label>
              <input
                type="number"
                value={form.days}
                onChange={(e) => set("days", e.target.value)}
                className="w-full glass-input rounded-lg px-3 py-2 text-xs"
              />
            </div>
          </div>

          <label className="flex items-center gap-2 text-gray-300 cursor-pointer">
            <input
              type="checkbox"
              checked={form.notify}
              onChange={(e) => set("notify", e.target.checked)}
              className="rounded"
            />
            Gửi tin nhắn kèm hướng dẫn sử dụng cho khách qua bot ngay
          </label>

          <div className="p-3 rounded-lg bg-amber-950/30 border border-amber-800/40 text-amber-300 text-[11px]">
            Hệ thống sẽ gọi API tạo <b>key thật</b> trên GPT2API (trừ credit tài khoản shop). Hãy kiểm tra kỹ thông tin.
          </div>

          {issueMut.isError && (
            <div className="p-3 rounded-lg bg-red-950/40 border border-red-800/40 text-red-300">
              {issueMut.error?.response?.data?.error || issueMut.error?.message}
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2 border-t border-white/[0.08]">
            <button
              onClick={onClose}
              className="px-3 py-2 glass rounded-lg text-gray-400 hover:text-white transition-colors"
            >
              Hủy
            </button>
            <button
              onClick={submit}
              disabled={!canPreview || issueMut.isPending}
              className="px-4 py-2 bg-primary-600 text-white rounded-lg font-medium hover:bg-primary-500 transition-colors flex items-center gap-1.5 disabled:opacity-50"
            >
              <KeyRound size={13} className={issueMut.isPending ? "animate-spin" : ""} />
              {issueMut.isPending ? "Đang tạo key..." : "Xác nhận tạo key"}
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}
