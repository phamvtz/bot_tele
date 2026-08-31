import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Save, CheckCircle2, Plug, RefreshCw, AlertTriangle,
  KeyRound, Coins, DollarSign, Gift, Search, Copy, Check, EyeOff, Eye,
} from "lucide-react";
import { api } from "../api/endpoints";
import Pagination from "../components/Pagination";
import Modal from "../components/Modal";
import EmptyState from "../components/EmptyState";
import StatsCard from "../components/StatsCard";
import { formatDate } from "../utils/format";

const TABS = [
  { key: "connection", label: "Kết nối" },
  { key: "keys", label: "Key đã cấp" },
  // Phase B: { key: "pricing", label: "Giá & giới hạn" }
];

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
};
function SourceBadge({ source }) {
  const m = SOURCE_META[source] || { label: source || "?", cls: "bg-white/[0.06] text-gray-400 border-white/[0.1]" };
  return <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium border ${m.cls}`}>{m.label}</span>;
}

// ── Các key gửi kèm khi Lưu tab "Kết nối" (token xử lý riêng) ──
const CONNECTION_KEYS = [
  "GPT2API_BASE", "GPT2API_USER_ID", "GPT2API_ENDPOINT", "GPT2API_MODELS",
  "GPT2API_FALLBACK_GROUPS", "GPT2API_DOC_URL", "GPT2API_USAGE_URL", "GPT2API_ENABLED",
];

function Field({ label, hint, children }) {
  return (
    <div>
      <label className="text-xs font-medium text-gray-400 block mb-1.5 uppercase tracking-wide">{label}</label>
      {children}
      {hint && <p className="text-xs text-gray-600 mt-1">{hint}</p>}
    </div>
  );
}

// ─────────────────────────── Tab: Kết nối ───────────────────────────
function ConnectionTab() {
  const [form, setForm] = useState({});
  const [tokenInput, setTokenInput] = useState("");
  const [saved, setSaved] = useState(false);
  const [groups, setGroups] = useState(null);
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({ queryKey: ["gpt2api-config"], queryFn: api.gpt2apiConfig });
  const config = data?.config || {};

  useEffect(() => {
    if (data) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setForm({});
      setTokenInput("");
    }
  }, [data]);

  const f = (key) => form[key] ?? config[key] ?? "";
  const set = (key, val) => setForm((p) => ({ ...p, [key]: val }));

  const enabledRaw = form.GPT2API_ENABLED ?? config.GPT2API_ENABLED;
  const enabled = enabledRaw == null || enabledRaw === ""
    ? (data?.enabled ?? true)
    : String(enabledRaw).toLowerCase() !== "false";

  const saveMut = useMutation({
    mutationFn: api.updateGpt2apiConfig,
    onSuccess: () => {
      qc.invalidateQueries(["gpt2api-config"]);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    },
  });

  const testMut = useMutation({
    mutationFn: api.testGpt2api,
    onSuccess: (res) => { if (res?.ok && Array.isArray(res.groups)) setGroups(res.groups); },
  });

  function saveConnection() {
    const payload = {};
    for (const k of CONNECTION_KEYS) {
      const v = form[k] ?? config[k];
      if (v != null) payload[k] = String(v);
    }
    payload.GPT2API_ENABLED = enabled ? "true" : "false";
    const tok = tokenInput.trim();
    if (tok) payload.GPT2API_ADMIN_TOKEN = tok;
    saveMut.mutate(payload);
  }

  const selectedGroups = f("GPT2API_FALLBACK_GROUPS").split(/[,\s]+/).map((s) => s.trim()).filter(Boolean);
  function toggleGroup(id) {
    const s = new Set(selectedGroups);
    if (s.has(id)) s.delete(id); else s.add(id);
    set("GPT2API_FALLBACK_GROUPS", [...s].join(","));
  }

  if (isLoading) return <div className="py-16 text-center text-sm text-gray-400">Đang tải cấu hình...</div>;

  return (
    <div className="max-w-2xl space-y-5">
      {saved && (
        <div className="flex items-center gap-1.5 text-sm text-emerald-400"><CheckCircle2 size={14} /> Đã lưu</div>
      )}

      <div className="glass rounded-xl p-4 flex items-center justify-between">
        <div>
          <p className="text-sm font-medium text-gray-200">Bật cửa hàng API key</p>
          <p className="text-xs text-gray-500 mt-0.5">Tắt = ẩn nút "Tạo API key" + chặn giftcode APIKEY</p>
        </div>
        <label className="relative inline-flex items-center cursor-pointer">
          <input type="checkbox" className="sr-only peer" checked={enabled}
            onChange={(e) => set("GPT2API_ENABLED", e.target.checked ? "true" : "false")} />
          <div className="w-9 h-5 bg-white/[0.15] rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-primary-500" />
        </label>
      </div>

      <div className="glass rounded-xl p-5 space-y-4">
        <h2 className="text-sm font-semibold text-white">Thông tin kết nối</h2>

        <Field label="Base URL" hint="Admin Public API của GPT2API, kết thúc bằng /api/admin-pub">
          <input value={f("GPT2API_BASE")} onChange={(e) => set("GPT2API_BASE", e.target.value)}
            className="w-full glass-input rounded-lg px-3 py-2 text-sm font-mono" placeholder="https://api.xpiki.com/api/admin-pub" />
        </Field>

        <Field label="Admin token (adm_*)"
          hint={data?.tokenConfigured
            ? `Đang lưu: ${config.GPT2API_ADMIN_TOKEN || "•••"} — để trống nếu không đổi`
            : "Token có scope key:write + key:read. Coi như mật khẩu."}>
          <input type="password" value={tokenInput} onChange={(e) => setTokenInput(e.target.value)}
            className="w-full glass-input rounded-lg px-3 py-2 text-sm font-mono"
            placeholder={data?.tokenConfigured ? "••••••••••••  (để trống = giữ nguyên)" : "adm_..."} />
        </Field>

        <Field label="User ID" hint="user_id sở hữu key sinh ra (tài khoản shop)">
          <input value={f("GPT2API_USER_ID")} onChange={(e) => set("GPT2API_USER_ID", e.target.value)}
            className="w-full glass-input rounded-lg px-3 py-2 text-sm font-mono" placeholder="386572b4-4ea5-4d07-..." />
        </Field>

        <Field label="Model endpoint"
          hint={`Endpoint khách gọi model. Để trống = suy ra: ${data?.derivedEndpoint || "<origin>/v1"}`}>
          <input value={f("GPT2API_ENDPOINT")} onChange={(e) => set("GPT2API_ENDPOINT", e.target.value)}
            className="w-full glass-input rounded-lg px-3 py-2 text-sm font-mono"
            placeholder={data?.derivedEndpoint || "https://api.xpiki.com/v1"} />
        </Field>

        <Field label="Models" hint="Phân cách bằng dấu phẩy/xuống dòng. Gửi kèm key làm allowed_models + hiện trong hướng dẫn.">
          <textarea value={f("GPT2API_MODELS")} onChange={(e) => set("GPT2API_MODELS", e.target.value)} rows={3}
            className="w-full glass-input rounded-lg px-3 py-2 text-sm font-mono resize-none"
            placeholder="claude-opus-5, claude-sonnet-5, claude-haiku-4-5" />
        </Field>

        <Field label="Fallback model groups"
          hint="Để trống = tự lấy TẤT CẢ group của tài khoản. Bấm Kiểm tra kết nối để hiện danh sách chọn.">
          <input value={f("GPT2API_FALLBACK_GROUPS")} onChange={(e) => set("GPT2API_FALLBACK_GROUPS", e.target.value)}
            className="w-full glass-input rounded-lg px-3 py-2 text-sm font-mono" placeholder="(trống = tất cả)" />
          {groups && groups.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-2">
              {groups.map((g) => {
                const on = selectedGroups.includes(g.id);
                return (
                  <button key={g.id} type="button" onClick={() => toggleGroup(g.id)} title={g.id}
                    className={`text-xs px-2 py-1 rounded-md border transition-colors ${
                      on ? "bg-primary-500/25 text-primary-100 border-primary-500/50"
                         : "bg-white/[0.04] text-gray-400 border-white/[0.08] hover:bg-white/[0.08] hover:text-white"
                    }`}>
                    {g.name || g.id}
                  </button>
                );
              })}
            </div>
          )}
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Link tài liệu" hint="Nút 'Tài liệu' sau khi giao key. Trống = ẩn.">
            <input value={f("GPT2API_DOC_URL")} onChange={(e) => set("GPT2API_DOC_URL", e.target.value)}
              className="w-full glass-input rounded-lg px-3 py-2 text-sm" placeholder="https://..." />
          </Field>
          <Field label="Link xem usage" hint="Trang khách tự xem mức dùng. Trống = ẩn.">
            <input value={f("GPT2API_USAGE_URL")} onChange={(e) => set("GPT2API_USAGE_URL", e.target.value)}
              className="w-full glass-input rounded-lg px-3 py-2 text-sm" placeholder="https://..." />
          </Field>
        </div>
      </div>

      {testMut.data && (
        <div className={`rounded-xl px-4 py-3 text-xs border ${
          testMut.data.ok ? "text-emerald-300 bg-emerald-950/30 border-emerald-800/40" : "text-red-300 bg-red-950/40 border-red-800/40"
        }`}>
          {testMut.data.ok
            ? <span className="flex items-center gap-1.5"><CheckCircle2 size={13} /> Kết nối OK — lấy được {testMut.data.groupCount} model group.</span>
            : <span className="flex items-center gap-1.5"><AlertTriangle size={13} /> {testMut.data.error}</span>}
        </div>
      )}
      {testMut.isError && (
        <div className="rounded-xl px-4 py-3 text-xs text-red-300 bg-red-950/40 border border-red-800/40">
          {testMut.error?.response?.data?.error || testMut.error?.message}
        </div>
      )}
      {saveMut.isError && (
        <div className="rounded-xl px-4 py-3 text-xs text-red-300 bg-red-950/40 border border-red-800/40">
          Lỗi lưu: {saveMut.error?.response?.data?.error || saveMut.error?.message}
        </div>
      )}

      <div className="flex items-center gap-3">
        <button onClick={saveConnection} disabled={saveMut.isPending}
          className="flex items-center gap-1.5 px-4 py-2 bg-primary-500 text-white rounded-lg text-sm font-medium hover:bg-primary-600 disabled:opacity-50 transition-colors shadow-glow-sm">
          <Save size={13} /> {saveMut.isPending ? "Đang lưu..." : "Lưu thay đổi"}
        </button>
        <button onClick={() => testMut.mutate()} disabled={testMut.isPending}
          className="flex items-center gap-1.5 px-4 py-2 bg-white/[0.06] text-gray-200 border border-white/[0.08] rounded-lg text-sm font-medium hover:bg-white/[0.1] disabled:opacity-50 transition-colors">
          {testMut.isPending ? <RefreshCw size={13} className="animate-spin" /> : <Plug size={13} />}
          {testMut.isPending ? "Đang kiểm tra..." : "Kiểm tra kết nối"}
        </button>
      </div>
    </div>
  );
}

// ─────────────────────────── Tab: Key đã cấp ───────────────────────────
function KeyDetailModal({ id, onClose }) {
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
  const k = data?.key;

  function copyKey() {
    if (!k?.key) return;
    navigator.clipboard.writeText(k.key);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <Modal open={!!id} onClose={onClose} title="Chi tiết API key" width="max-w-xl">
      {isLoading || !k ? (
        <p className="text-sm text-gray-400 py-6 text-center">Đang tải...</p>
      ) : (
        <div className="space-y-4 text-sm">
          <div>
            <p className="text-xs text-gray-500 mb-1">Key (sk-*)</p>
            <div className="flex items-center gap-2">
              <code className="flex-1 bg-black/40 text-emerald-300 text-xs font-mono px-3 py-2 rounded-lg break-all">{k.key}</code>
              <button onClick={copyKey} className="flex-shrink-0 p-2 glass rounded-lg text-gray-400 hover:text-white transition-colors">
                {copied ? <Check size={14} className="text-emerald-400" /> : <Copy size={14} />}
              </button>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Info label="Khách (telegramId)" value={data.user
              ? `${data.user.firstName || data.user.username || "—"} · ${k.telegramId}`
              : k.telegramId} />
            <Info label="Nguồn" value={<SourceBadge source={k.source} />} />
            <Info label="Quota" value={`${fmtTokens(k.quotaTokens)} token (${Number(k.quotaTokens).toLocaleString("en-US")})`} />
            <Info label="RPM" value={k.rpm > 0 ? `${k.rpm} lệnh/phút` : "—"} />
            <Info label="Giá (USD)" value={k.priceUsd != null ? `$${Number(k.priceUsd).toFixed(2)}` : "—"} />
            <Info label="Hết hạn" value={k.expiresAt ? formatDate(k.expiresAt) : "Không hết hạn"} />
            <Info label="Tạo lúc" value={formatDate(k.createdAt)} />
            <Info label="Ẩn khỏi /mykey" value={k.hiddenAt ? formatDate(k.hiddenAt) : "Không"} />
            <Info label="ID key phía GPT2API" value={k.externalId || "—"} />
            <Info label="Models" value={(k.models || []).join(", ") || "—"} />
          </div>

          {data.order && (
            <div className="rounded-lg border border-white/[0.07] px-3 py-2">
              <p className="text-xs text-gray-500 mb-1">Đơn mua liên kết</p>
              <p className="text-gray-300 text-xs font-mono">{data.order.code} · {data.order.status}
                {data.order.displayFinalUsd != null && ` · $${Number(data.order.displayFinalUsd).toFixed(2)}`}
                {` · ${formatDate(data.order.createdAt)}`}</p>
            </div>
          )}
          {data.giftCode && (
            <div className="rounded-lg border border-white/[0.07] px-3 py-2">
              <p className="text-xs text-gray-500 mb-1">Giftcode liên kết</p>
              <p className="text-gray-300 text-xs font-mono">{data.giftCode.code} · {data.giftCode.rewardType}</p>
            </div>
          )}

          <div className="rounded-lg border border-amber-800/30 bg-amber-950/30 px-3 py-2 text-xs text-amber-300">
            "Ẩn" chỉ giấu key khỏi <code className="bg-white/10 px-1 rounded">/mykey</code> của khách — GPT2API không
            cho vô hiệu/xoá key, khách vẫn dùng được tới khi cạn quota.
          </div>

          <div className="flex justify-end gap-2 pt-1">
            {k.hiddenAt ? (
              <button onClick={() => hideMut.mutate({ hidden: false })} disabled={hideMut.isPending}
                className="flex items-center gap-1.5 px-3 py-2 bg-white/[0.06] text-gray-200 border border-white/[0.08] rounded-lg text-sm hover:bg-white/[0.1] disabled:opacity-50 transition-colors">
                <Eye size={13} /> Hiện lại
              </button>
            ) : (
              <button onClick={() => hideMut.mutate({ hidden: true })} disabled={hideMut.isPending}
                className="flex items-center gap-1.5 px-3 py-2 bg-amber-600/20 text-amber-200 border border-amber-700/40 rounded-lg text-sm hover:bg-amber-600/30 disabled:opacity-50 transition-colors">
                <EyeOff size={13} /> Ẩn khỏi /mykey
              </button>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}

function Info({ label, value }) {
  return (
    <div>
      <p className="text-xs text-gray-500 mb-0.5">{label}</p>
      <div className="text-gray-300 break-words">{value}</div>
    </div>
  );
}

function IssuedKeysTab() {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [source, setSource] = useState("");
  const [qInput, setQInput] = useState("");
  const [q, setQ] = useState("");
  const [detailId, setDetailId] = useState(null);

  const { data, isLoading } = useQuery({
    queryKey: ["issued-keys", { page, pageSize, source, q }],
    queryFn: () => api.issuedKeys({ page, limit: pageSize, source: source || undefined, q: q || undefined }),
  });
  const { data: stats } = useQuery({ queryKey: ["issued-key-stats"], queryFn: api.issuedKeyStats });

  const keys = data?.keys || [];
  const total = data?.total || 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  function applySearch() { setQ(qInput.trim()); setPage(1); }
  function pickSource(s) { setSource(s); setPage(1); }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatsCard icon={KeyRound} label="Tổng key" value={stats ? stats.total : "—"} />
        <StatsCard icon={Coins} label="Tổng quota" value={stats ? `${fmtTokens(stats.totalQuota)} token` : "—"}
          iconBg="bg-amber-500/20" iconColor="text-amber-400" />
        <StatsCard icon={DollarSign} label="Doanh thu key" value={stats ? `$${stats.revenueUsd.toFixed(2)}` : "—"}
          iconBg="bg-emerald-500/20" iconColor="text-emerald-400" />
        <StatsCard icon={Gift} label="Từ giftcode" value={stats ? stats.bySource.GIFTCODE : "—"}
          iconBg="bg-pink-500/20" iconColor="text-pink-400" />
      </div>

      <div className="glass rounded-xl p-3 flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-2 flex-1 min-w-[220px]">
          <Search size={15} className="text-gray-500 flex-shrink-0" />
          <input value={qInput} onChange={(e) => setQInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && applySearch()}
            placeholder="telegramId, mã đơn, giftcode id, hoặc tiền tố key..."
            className="flex-1 glass-input rounded-lg px-3 py-1.5 text-sm" />
          <button onClick={applySearch}
            className="px-3 py-1.5 bg-primary-500 text-white rounded-lg text-sm font-medium hover:bg-primary-600 transition-colors flex-shrink-0">
            Tìm
          </button>
        </div>
        <div className="flex gap-1">
          {[["", "Tất cả"], ["GIFTCODE", "Quà tặng"], ["PURCHASE", "Đã mua"], ["ADMIN", "Admin"]].map(([v, l]) => (
            <button key={v} onClick={() => pickSource(v)}
              className={`text-xs px-3 py-1.5 rounded-lg transition-colors ${
                source === v ? "bg-primary-600/20 text-primary-400 border border-primary-700/50"
                             : "text-gray-400 hover:text-white glass border border-white/[0.06]"
              }`}>
              {l}
            </button>
          ))}
        </div>
      </div>

      <div className="glass rounded-xl overflow-hidden">
        {isLoading ? (
          <p className="text-sm text-gray-400 text-center py-10">Đang tải...</p>
        ) : keys.length === 0 ? (
          <EmptyState icon={KeyRound} message="Chưa có key nào khớp" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/[0.06] text-xs text-gray-500 text-left">
                  <th className="px-4 py-3 font-medium">Khách</th>
                  <th className="px-4 py-3 font-medium">Quota</th>
                  <th className="px-4 py-3 font-medium">RPM</th>
                  <th className="px-4 py-3 font-medium">Nguồn</th>
                  <th className="px-4 py-3 font-medium">Giá</th>
                  <th className="px-4 py-3 font-medium">Hết hạn</th>
                  <th className="px-4 py-3 font-medium">Tạo</th>
                  <th className="px-4 py-3 font-medium">Key</th>
                </tr>
              </thead>
              <tbody>
                {keys.map((k) => (
                  <tr key={k.id} onClick={() => setDetailId(k.id)}
                    className={`border-b border-white/[0.04] hover:bg-white/[0.03] transition-colors cursor-pointer ${k.hiddenAt ? "opacity-50" : ""}`}>
                    <td className="px-4 py-3">
                      <p className="text-gray-200">{k.userName || "—"}</p>
                      <p className="text-[11px] text-gray-500 font-mono">{k.telegramId}</p>
                    </td>
                    <td className="px-4 py-3 text-gray-300">{fmtTokens(k.quotaTokens)}</td>
                    <td className="px-4 py-3 text-gray-400">{k.rpm > 0 ? k.rpm : "—"}</td>
                    <td className="px-4 py-3"><SourceBadge source={k.source} /></td>
                    <td className="px-4 py-3 text-gray-400">{k.priceUsd != null ? `$${Number(k.priceUsd).toFixed(2)}` : "—"}</td>
                    <td className="px-4 py-3 text-xs text-gray-400">{k.expiresAt ? formatDate(k.expiresAt).slice(0, 10) : "∞"}</td>
                    <td className="px-4 py-3 text-xs text-gray-400">{formatDate(k.createdAt).slice(0, 10)}</td>
                    <td className="px-4 py-3 font-mono text-[11px] text-gray-500">{k.keyMasked}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {total > 0 && (
          <div className="px-4 pb-3">
            <Pagination page={page} totalPages={totalPages} total={total} pageSize={pageSize}
              onPage={setPage} onPageSize={(s) => { setPageSize(s); setPage(1); }} />
          </div>
        )}
      </div>

      {detailId && <KeyDetailModal id={detailId} onClose={() => setDetailId(null)} />}
    </div>
  );
}

// ─────────────────────────── Shell ───────────────────────────
export default function ApiKeyShop() {
  const [activeTab, setActiveTab] = useState("connection");
  const { data } = useQuery({ queryKey: ["gpt2api-config"], queryFn: api.gpt2apiConfig });

  const cfgEnabled = data?.enabled ?? true;

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-xl font-bold text-white">Cửa hàng API key</h1>
        <div className="flex items-center gap-2">
          <span className={`text-[11px] px-2 py-1 rounded-full border ${
            data?.configured ? "text-emerald-400 border-emerald-700/40 bg-emerald-950/30"
                             : "text-amber-400 border-amber-700/40 bg-amber-950/30"
          }`}>
            {data?.configured ? "Đã cấu hình" : "Chưa đủ cấu hình"}
          </span>
          <span className={`text-[11px] px-2 py-1 rounded-full border ${
            cfgEnabled ? "text-emerald-400 border-emerald-700/40 bg-emerald-950/30"
                       : "text-gray-400 border-white/10 bg-white/[0.03]"
          }`}>
            {cfgEnabled ? "Đang bật" : "Đang tắt"}
          </span>
        </div>
      </div>
      <p className="text-sm text-gray-500 mb-5">Kết nối GPT2API (xpiki) — nguồn tạo key sk-* bán cho khách</p>

      <div className="flex gap-1 mb-5">
        {TABS.map((t) => (
          <button key={t.key} onClick={() => setActiveTab(t.key)}
            className={`text-sm px-4 py-2 rounded-lg transition-colors ${
              activeTab === t.key ? "bg-primary-600/20 text-primary-400 border border-primary-700/50"
                                  : "text-gray-400 hover:text-white glass border border-white/[0.06]"
            }`}>
            {t.label}
          </button>
        ))}
      </div>

      {activeTab === "connection" && <ConnectionTab />}
      {activeTab === "keys" && <IssuedKeysTab />}
    </div>
  );
}
