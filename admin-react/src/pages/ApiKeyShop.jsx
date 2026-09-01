import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Save, CheckCircle2, Plug, RefreshCw, AlertTriangle,
  KeyRound, Coins, DollarSign, Gift, Search, Copy, Check, EyeOff, Eye, Calculator,
  ArrowUp, ArrowDown, X, Plus, ChevronRight,
} from "lucide-react";
import { api } from "../api/endpoints";
import Pagination from "../components/Pagination";
import Modal from "../components/Modal";
import EmptyState from "../components/EmptyState";
import StatsCard from "../components/StatsCard";
import { formatDate } from "../utils/format";

const TABS = [
  { key: "connection", label: "Kết nối" },
  { key: "pricing", label: "Giá & giới hạn" },
  { key: "keys", label: "Key đã cấp" },
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

// ── Chọn nhóm fallback (model groups) khi tạo key ──
// Rỗng = "tự động": bot tự lấy TẤT CẢ nhóm của tài khoản (kể cả nhóm thêm sau).
// Chọn tay = đúng danh sách đó + theo thứ tự ưu tiên (fallback_order).
function FallbackGroupsPicker({ value, onChange, testGroups }) {
  const selected = String(value || "").split(/[,\s]+/).map((s) => s.trim()).filter(Boolean);

  const { data, isLoading, isError, error, refetch, isFetching } = useQuery({
    queryKey: ["gpt2api-model-groups"],
    queryFn: () => api.gpt2apiModelGroups(),
    staleTime: 60_000,
  });
  // Ưu tiên danh sách từ API; nếu chưa lấy được thì dùng kết quả "Kiểm tra kết nối".
  const groups = (data?.ok && data.groups?.length ? data.groups : testGroups) || [];
  const byId = Object.fromEntries(groups.map((g) => [g.id, g]));
  const nameOf = (id) => byId[id]?.name || id;
  const unselected = groups.filter((g) => !selected.includes(g.id));
  const failed = isError || (data && !data.ok);

  const setList = (ids) => onChange(ids.join(","));
  const add = (id) => setList([...selected, id]);
  const remove = (id) => setList(selected.filter((x) => x !== id));
  function move(i, dir) {
    const j = i + dir;
    if (j < 0 || j >= selected.length) return;
    const next = [...selected];
    [next[i], next[j]] = [next[j], next[i]];
    setList(next);
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <label className="text-xs font-medium text-gray-400 uppercase tracking-wide">Nhóm fallback (model groups)</label>
        <button type="button" onClick={() => refetch()} disabled={isFetching}
          className="text-[11px] text-gray-500 hover:text-gray-300 flex items-center gap-1 disabled:opacity-50">
          <RefreshCw size={11} className={isFetching ? "animate-spin" : ""} /> Tải lại
        </button>
      </div>

      {isLoading ? (
        <p className="text-xs text-gray-500 py-2">Đang lấy danh sách nhóm từ GPT2API…</p>
      ) : failed ? (
        <div className="space-y-2">
          <div className="rounded-lg border border-amber-800/40 bg-amber-950/30 px-3 py-2 text-xs text-amber-300">
            Chưa lấy được danh sách nhóm{data?.error || error?.message ? ` (${data?.error || error?.message})` : ""}.
            Lưu kết nối rồi bấm "Tải lại", hoặc nhập tay ID cách nhau bằng dấu phẩy:
          </div>
          <input value={value} onChange={(e) => onChange(e.target.value)}
            className="w-full glass-input rounded-lg px-3 py-2 text-sm font-mono" placeholder="(trống = tất cả)" />
        </div>
      ) : (
        <div className="space-y-2.5">
          {selected.length === 0 ? (
            <div className="rounded-lg border border-white/[0.08] bg-white/[0.02] px-3 py-2 text-xs text-gray-400">
              <b className="text-gray-200">Tự động</b> — bot dùng cả {groups.length} nhóm của tài khoản (thứ tự A→Z).
              Nhóm mới thêm trên GPT2API cũng tự vào.
            </div>
          ) : (
            <div className="rounded-lg border border-white/[0.08] overflow-hidden">
              {selected.map((id, i) => (
                <div key={id}
                  className={`flex items-center gap-2 px-3 py-2 text-sm ${i > 0 ? "border-t border-white/[0.05]" : ""} ${byId[id] ? "" : "bg-amber-950/20"}`}>
                  <span className="text-xs text-gray-500 w-4 tabular-nums">{i + 1}</span>
                  <span className="flex-1 text-gray-200 truncate" title={id}>
                    {nameOf(id)}
                    {!byId[id] && <span className="text-amber-400 text-[11px] ml-1">(không còn trong tài khoản?)</span>}
                  </span>
                  <button type="button" onClick={() => move(i, -1)} disabled={i === 0}
                    className="p-1 text-gray-500 hover:text-white disabled:opacity-20"><ArrowUp size={13} /></button>
                  <button type="button" onClick={() => move(i, 1)} disabled={i === selected.length - 1}
                    className="p-1 text-gray-500 hover:text-white disabled:opacity-20"><ArrowDown size={13} /></button>
                  <button type="button" onClick={() => remove(id)}
                    className="p-1 text-gray-500 hover:text-red-400"><X size={13} /></button>
                </div>
              ))}
            </div>
          )}

          {unselected.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {unselected.map((g) => (
                <button key={g.id} type="button" onClick={() => add(g.id)} title={g.id}
                  className="text-xs px-2 py-1 rounded-md border bg-white/[0.04] text-gray-400 border-white/[0.08] hover:bg-white/[0.08] hover:text-white transition-colors flex items-center gap-1">
                  <Plus size={11} /> {g.name || g.id}
                </button>
              ))}
            </div>
          )}

          <div className="flex items-center gap-3 text-[11px]">
            {selected.length > 0 && (
              <button type="button" onClick={() => onChange("")} className="text-gray-500 hover:text-gray-300">↺ Về tự động</button>
            )}
            {selected.length < groups.length && groups.length > 0 && (
              <button type="button" onClick={() => setList(groups.map((g) => g.id))} className="text-gray-500 hover:text-gray-300">
                Chọn hết {groups.length} nhóm
              </button>
            )}
            <span className="text-gray-600 ml-auto">
              {selected.length > 0 ? `Đã chọn ${selected.length}/${groups.length} — theo thứ tự ưu tiên` : `${groups.length} nhóm khả dụng`}
            </span>
          </div>
        </div>
      )}
      <p className="text-xs text-gray-600 mt-1.5">
        Gửi kèm mỗi key làm <code>fallback_allowed_groups</code> + <code>fallback_order</code>. Lưu xong áp dụng ngay cho key mới.
      </p>
    </div>
  );
}

// ─────────────────────────── Tab: Kết nối ───────────────────────────
function ConnectionTab() {
  const [form, setForm] = useState({});
  const [tokenInput, setTokenInput] = useState("");
  const [saved, setSaved] = useState(false);
  const [noChange, setNoChange] = useState(false);
  const [groups, setGroups] = useState(null);
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({ queryKey: ["gpt2api-config"], queryFn: api.gpt2apiConfig });
  const config = data?.config || {};
  const eff = data?.effective || {};

  // KHÔNG reset `form` mỗi khi query refetch (focus cửa sổ, sau "Kiểm tra kết
  // nối"…). Trước đây làm vậy → admin chọn nhóm xong, chuyển tab qua xpiki rồi
  // quay lại là mất sạch lựa chọn, bấm Lưu ra payload rỗng mà vẫn báo "Đã lưu".
  // `f()` đã tự rơi về config/eff khi `form` chưa có key. Chỉ dọn `form` sau khi
  // lưu THẬT (saveMut.onSuccess).

  // Giá trị đang thật sự áp dụng (từ ENV/mặc định) khi bảng Setting để trống —
  // đổ vào ô để admin thấy hết cấu hình hiện tại. `endpoint` để placeholder (nó
  // tự suy ra khi trống). `token` không bao giờ đổ nguyên văn.
  const EFF_FOR_KEY = {
    GPT2API_BASE: eff.base,
    GPT2API_USER_ID: eff.userId,
    GPT2API_MODELS: (eff.models || []).join(", "),
    GPT2API_FALLBACK_GROUPS: (eff.fallbackGroups || []).join(", "),
    GPT2API_DOC_URL: eff.docUrl,
    GPT2API_USAGE_URL: eff.usageUrl,
  };
  const f = (key) => {
    if (form[key] != null) return form[key];
    if (config[key] != null && config[key] !== "") return config[key];
    return EFF_FOR_KEY[key] ?? "";
  };
  const set = (key, val) => setForm((p) => ({ ...p, [key]: val }));

  const enabledRaw = form.GPT2API_ENABLED ?? config.GPT2API_ENABLED;
  const enabled = enabledRaw == null || enabledRaw === ""
    ? (data?.enabled ?? true)
    : String(enabledRaw).toLowerCase() !== "false";

  const saveMut = useMutation({
    mutationFn: api.updateGpt2apiConfig,
    onSuccess: () => {
      setForm({});
      setTokenInput("");
      qc.invalidateQueries(["gpt2api-config"]);
      qc.invalidateQueries(["gpt2api-model-groups"]);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    },
  });

  const testMut = useMutation({
    mutationFn: api.testGpt2api,
    onSuccess: (res) => {
      if (res?.ok && Array.isArray(res.groups)) setGroups(res.groups);
      qc.invalidateQueries(["gpt2api-model-groups"]);
    },
  });

  function saveConnection() {
    // Chỉ gửi ô admin THẬT SỰ sửa (có trong `form`). Ô hiển thị giá trị kế thừa
    // từ ENV mà không đụng vào thì không ghi đè vào DB. Xoá trắng ô = gửi "" =
    // về mặc định.
    const payload = {};
    for (const k of CONNECTION_KEYS) {
      if (k in form) payload[k] = String(form[k] ?? "");
    }
    const tok = tokenInput.trim();
    if (tok) payload.GPT2API_ADMIN_TOKEN = tok;
    if (!Object.keys(payload).length) { setNoChange(true); setTimeout(() => setNoChange(false), 2500); return; }
    saveMut.mutate(payload);
  }

  if (isLoading) return <div className="py-16 text-center text-sm text-gray-400">Đang tải cấu hình...</div>;

  return (
    <div className="max-w-2xl space-y-5">
      {saved && (
        <div className="flex items-center gap-1.5 text-sm text-emerald-400"><CheckCircle2 size={14} /> Đã lưu</div>
      )}
      {noChange && (
        <div className="flex items-center gap-1.5 text-sm text-gray-400"><AlertTriangle size={14} /> Chưa có ô nào thay đổi — không lưu gì</div>
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

        <FallbackGroupsPicker
          value={f("GPT2API_FALLBACK_GROUPS")}
          onChange={(v) => set("GPT2API_FALLBACK_GROUPS", v)}
          testGroups={groups} />

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

function IssueKeyModal({ onClose }) {
  const [form, setForm] = useState({ telegramId: "", tokensM: "10", rpm: "300", days: "0", notify: true });
  const [copied, setCopied] = useState(false);
  const qc = useQueryClient();
  const set = (k, v) => setForm((p) => ({ ...p, [k]: v }));

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

  function runPreview() {
    previewMut.mutate({ tokens, rpm, validDays });
  }
  function submit() {
    issueMut.mutate({ telegramId: form.telegramId.trim(), tokens, rpm, validDays, notify: form.notify });
  }
  function copyKey() {
    navigator.clipboard.writeText(issueMut.data.key);
    setCopied(true); setTimeout(() => setCopied(false), 2000);
  }

  const done = issueMut.data?.ok;

  return (
    <Modal open onClose={onClose} title="Cấp API key thủ công" width="max-w-lg">
      {done ? (
        <div className="space-y-3 text-sm">
          <p className="text-emerald-400 flex items-center gap-1.5"><CheckCircle2 size={14} /> Đã cấp key
            {issueMut.data.notified ? " và gửi cho khách qua bot." : " (chưa gửi tin cho khách)."}</p>
          <div className="flex items-center gap-2">
            <code className="flex-1 bg-black/40 text-emerald-300 text-xs font-mono px-3 py-2 rounded-lg break-all">{issueMut.data.key}</code>
            <button onClick={copyKey} className="flex-shrink-0 p-2 glass rounded-lg text-gray-400 hover:text-white transition-colors">
              {copied ? <Check size={14} className="text-emerald-400" /> : <Copy size={14} />}
            </button>
          </div>
          <button onClick={onClose} className="px-4 py-2 bg-primary-500 text-white rounded-lg text-sm font-medium hover:bg-primary-600 transition-colors">Xong</button>
        </div>
      ) : (
        <div className="space-y-3 text-sm">
          <Field label="Telegram ID khách" hint="Chỉ số, không phải @username">
            <input value={form.telegramId} onChange={(e) => set("telegramId", e.target.value)}
              className="w-full glass-input rounded-lg px-3 py-2 text-sm font-mono" placeholder="123456789" />
          </Field>
          <div className="grid grid-cols-3 gap-2">
            <Field label="Token (triệu)"><input type="number" value={form.tokensM} onChange={(e) => set("tokensM", e.target.value)}
              className="w-full glass-input rounded-lg px-3 py-2 text-sm" /></Field>
            <Field label="RPM" hint="0 = mặc định"><input type="number" value={form.rpm} onChange={(e) => set("rpm", e.target.value)}
              className="w-full glass-input rounded-lg px-3 py-2 text-sm" /></Field>
            <Field label="Số ngày" hint="0 = ∞"><input type="number" value={form.days} onChange={(e) => set("days", e.target.value)}
              className="w-full glass-input rounded-lg px-3 py-2 text-sm" /></Field>
          </div>
          <label className="flex items-center gap-2 text-gray-300">
            <input type="checkbox" checked={form.notify} onChange={(e) => set("notify", e.target.checked)} />
            Gửi key cho khách qua bot ngay
          </label>

          <div className="rounded-lg border border-amber-800/40 bg-amber-950/30 px-3 py-2 text-xs text-amber-300">
            Sẽ tạo <b>key thật</b> trên GPT2API — tốn credit của tài khoản shop. Kiểm tra kỹ trước khi xác nhận.
          </div>

          {previewMut.data && (
            <div className="rounded-lg border border-white/[0.08] bg-white/[0.02] px-3 py-2 text-xs text-gray-300">
              Giá ước tính (theo cấu hình hiện tại): <b className="text-emerald-300">${previewMut.data.priceUsd.toFixed(2)}</b>
              <span className="text-gray-500"> (gốc ${previewMut.data.baseUsd.toFixed(2)}
                {previewMut.data.rpmPct > 0 && `, RPM +${previewMut.data.rpmPct}%`}
                {previewMut.data.daysPct > 0 && `, ngày +${previewMut.data.daysPct}%`})</span>
              {previewMut.data.overMax && <span className="text-amber-400"> · vượt trần mua</span>}
            </div>
          )}
          {issueMut.isError && (
            <div className="rounded-lg border border-red-800/40 bg-red-950/40 px-3 py-2 text-xs text-red-300">
              {issueMut.error?.response?.data?.error || issueMut.error?.message}
            </div>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <button onClick={runPreview} disabled={!canPreview || previewMut.isPending}
              className="px-3 py-2 bg-white/[0.06] text-gray-200 border border-white/[0.08] rounded-lg text-sm hover:bg-white/[0.1] disabled:opacity-50 transition-colors">
              {previewMut.isPending ? "..." : "Xem giá ước tính"}
            </button>
            <button onClick={submit} disabled={!canPreview || issueMut.isPending}
              className="px-3 py-2 bg-primary-500 text-white rounded-lg text-sm font-medium hover:bg-primary-600 disabled:opacity-50 transition-colors">
              {issueMut.isPending ? "Đang tạo key..." : "Xác nhận — tạo key thật"}
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}

function IssuedKeysTab() {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [source, setSource] = useState("");
  const [qInput, setQInput] = useState("");
  const [q, setQ] = useState("");
  const [detailId, setDetailId] = useState(null);
  const [issueOpen, setIssueOpen] = useState(false);

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
      <div className="flex justify-end">
        <button onClick={() => setIssueOpen(true)}
          className="flex items-center gap-1.5 px-3 py-2 bg-primary-500 text-white rounded-lg text-sm font-medium hover:bg-primary-600 transition-colors">
          <KeyRound size={14} /> Cấp key thủ công
        </button>
      </div>
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
      {issueOpen && <IssueKeyModal onClose={() => setIssueOpen(false)} />}
    </div>
  );
}

// ─────────────────────────── Tab: Giá & giới hạn ───────────────────────────
const PRICING_KEYS = [
  "GPT2API_USD_PER_MTOKEN", "GPT2API_BUY_PRESETS_M",
  "GPT2API_ALLOWED_MODELS_MODE", "GPT2API_QUOTA_REF_PRICE",
  "GPT2API_KEY_RPM", "GPT2API_KEY_TPM", "GPT2API_KEY_VALID_DAYS",
  "GPT2API_RPM_INCLUDED", "GPT2API_RPM_SURCHARGE_PCT", "GPT2API_DAY_SURCHARGE_PCT", "GPT2API_NO_EXPIRY_MULT",
  "GPT2API_MAX_BUY_M", "GPT2API_RPM_PRESETS", "GPT2API_DAYS_PRESETS",
  "GPT2API_FREE_MIN_M", "GPT2API_FREE_MAX_M", "GPT2API_FREE_ALPHA",
];

// Ô số: đổ giá trị ĐANG ÁP DỤNG (eff) vào khi bảng Setting để trống, để admin
// thấy hết cấu hình hiện tại. Không đụng vào = không ghi đè DB (xem save()).
function NumField({ label, k, form, config, eff, set, hint, step, placeholder }) {
  const effVal = eff != null ? String(eff) : "";
  const shown = form[k] ?? (config[k] != null && config[k] !== "" ? config[k] : effVal);
  return (
    <Field label={label} hint={hint}>
      <input type="number" step={step || "any"}
        value={shown}
        onChange={(e) => set(k, e.target.value)}
        placeholder={placeholder ?? ""}
        className="w-full glass-input rounded-lg px-3 py-2 text-sm" />
    </Field>
  );
}
function TextField({ label, k, form, config, eff, set, hint, placeholder }) {
  const effStr = Array.isArray(eff) ? eff.join(", ") : (eff != null ? String(eff) : "");
  const shown = form[k] ?? (config[k] != null && config[k] !== "" ? config[k] : effStr);
  return (
    <Field label={label} hint={hint}>
      <input value={shown}
        onChange={(e) => set(k, e.target.value)}
        placeholder={placeholder ?? ""}
        className="w-full glass-input rounded-lg px-3 py-2 text-sm font-mono" />
    </Field>
  );
}

/**
 * Bảng giá 6 gói ở bước 1, tính NGAY khi admin gõ (chưa cần bấm Lưu) — để thấy
 * liền "đổi giá token thì gói nào thành bao nhiêu".
 *
 * Chỉ nhân giá gốc: đây đúng là con số hiện trên NÚT bước 1 của bot
 * (priceUsdForTokens = ceil(triệu_token × USD/1M, tới cent)). Phụ phí RPM/ngày
 * nhân thêm ở màn xác nhận — dùng ô "Xem trước giá" bên dưới cho số cuối cùng.
 */
function PresetPricePreview({ perM, presetsM }) {
  if (!(perM > 0) || !presetsM?.length) return null;
  const fmtTokens = (m) => (m >= 1000 ? `${Number((m / 1000).toFixed(1))}B` : `${m}M`);
  const price = (m) => Math.ceil(m * perM * 100) / 100;
  return (
    <div className="rounded-lg border border-white/[0.08] bg-white/[0.02] p-3">
      <p className="text-xs text-gray-400 mb-2">
        Giá các nút ở <b className="text-gray-200">bước 1</b> với mức <b className="text-primary-300">${perM}</b>/1M
        <span className="text-gray-600"> — đổi ô trên là bảng này đổi ngay:</span>
      </p>
      <div className="flex flex-wrap gap-2">
        {presetsM.map((m) => (
          <span key={m} className="px-2 py-1 rounded-md bg-white/[0.04] border border-white/[0.08] text-xs text-gray-300">
            {fmtTokens(m)} · <b className="text-emerald-300">${price(m).toFixed(2)}</b>
          </span>
        ))}
      </div>
      <p className="text-xs text-gray-600 mt-2">
        Chưa gồm phụ phí RPM / số ngày (nhân thêm ở màn xác nhận của khách).
      </p>
    </div>
  );
}

function PricingTab() {
  const [form, setForm] = useState({});
  const [saved, setSaved] = useState(false);
  const [pv, setPv] = useState({ tokensM: 50, rpm: 300, days: 30 });
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({ queryKey: ["gpt2api-config"], queryFn: api.gpt2apiConfig });
  const config = data?.config || {};
  const eff = data?.effective || {};

  // Không reset `form` khi query refetch — chỉ dọn sau khi lưu thật (xem
  // ConnectionTab). NumField/TextField đã tự rơi về config/eff khi form trống.
  const set = (k, v) => setForm((p) => ({ ...p, [k]: v }));

  const saveMut = useMutation({
    mutationFn: api.updateGpt2apiConfig,
    onSuccess: () => {
      setForm({});
      qc.invalidateQueries(["gpt2api-config"]);
      setSaved(true); setTimeout(() => setSaved(false), 2500);
    },
  });
  const priceMut = useMutation({ mutationFn: api.gpt2apiPricePreview });

  // Giá/gói ĐANG GÕ (form) → chưa lưu vẫn xem được bảng giá. Thứ tự fallback
  // giống NumField/TextField: form → Setting DB → giá trị đang áp dụng.
  const livePerM = Number(form.GPT2API_USD_PER_MTOKEN ?? config.GPT2API_USD_PER_MTOKEN ?? eff.usdPerMtoken) || 0;
  const livePresetsM = String(form.GPT2API_BUY_PRESETS_M ?? config.GPT2API_BUY_PRESETS_M ?? (eff.buyPresetsM || []).join(","))
    .split(",")
    .map((s) => Math.floor(Number(s.trim())))
    .filter((n) => Number.isFinite(n) && n > 0);

  // Bảng xác suất quà tặng theo miền đang nhập.
  const freeMinM = Number(form.GPT2API_FREE_MIN_M ?? config.GPT2API_FREE_MIN_M ?? eff.freeMinM) || eff.freeMinM;
  const freeMaxM = Number(form.GPT2API_FREE_MAX_M ?? config.GPT2API_FREE_MAX_M ?? eff.freeMaxM) || eff.freeMaxM;
  const freeAlpha = Number(form.GPT2API_FREE_ALPHA ?? config.GPT2API_FREE_ALPHA ?? eff.freeAlpha) || eff.freeAlpha;
  const { data: quota } = useQuery({
    queryKey: ["gpt2api-quota-preview", freeMinM, freeMaxM, freeAlpha],
    queryFn: () => api.gpt2apiQuotaPreview({ minM: freeMinM, maxM: freeMaxM, alpha: freeAlpha }),
    enabled: !!freeMinM && !!freeMaxM,
  });

  function save() {
    const payload = {};
    for (const k of PRICING_KEYS) {
      const v = form[k] ?? config[k];
      if (v != null && v !== "") payload[k] = String(v);
      else if (k in form) payload[k] = ""; // admin xoá ô = về mặc định
    }
    saveMut.mutate(payload);
  }

  function runPreview() {
    priceMut.mutate({ tokens: (Number(pv.tokensM) || 0) * 1e6, rpm: Number(pv.rpm) || 0, validDays: Number(pv.days) || 0 });
  }

  if (isLoading) return <div className="py-16 text-center text-sm text-gray-400">Đang tải cấu hình...</div>;

  return (
    <div className="max-w-3xl space-y-5">
      {saved && <div className="flex items-center gap-1.5 text-sm text-emerald-400"><CheckCircle2 size={14} /> Đã lưu</div>}

      <div className="glass rounded-xl p-5 space-y-4">
        <div>
          <h2 className="text-sm font-semibold text-white">Giá bán</h2>
          <p className="text-xs text-gray-500 mt-1">
            Chỉ cần đổi <b className="text-gray-300">USD / 1M token</b> — mọi giá khác tự tính theo ô này.
            Các mục ở "Nâng cao" là <b className="text-gray-300">tỉ lệ %</b>, không phải giá, nên đổi giá gốc là không phải đụng tới.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <NumField label="USD / 1M token" k="GPT2API_USD_PER_MTOKEN" step="0.001" {...{ form, config, set }} eff={eff.usdPerMtoken}
            hint="Giá gốc theo token, trước phụ phí RPM/ngày" />
          <TextField label="Gói token bán sẵn (triệu)" k="GPT2API_BUY_PRESETS_M" {...{ form, config, set }} eff={eff.buyPresetsM}
            hint="Các nút bấm nhanh ở bước 1, cách nhau dấu phẩy" />
        </div>

        <PresetPricePreview perM={livePerM} presetsM={livePresetsM} />
      </div>

      <details className="group">
        <summary className="cursor-pointer list-none glass rounded-xl px-5 py-3 flex items-center gap-2 text-sm text-gray-300 hover:text-white transition-colors">
          <ChevronRight size={14} className="transition-transform group-open:rotate-90" />
          <span className="font-semibold">Nâng cao</span>
          <span className="text-xs text-gray-500">— phụ phí, quy đổi xpiki, mặc định key, quà tặng (ít khi cần đổi)</span>
        </summary>
        <div className="space-y-5 mt-5">

      <div className="glass rounded-xl p-5 space-y-4">
        <h2 className="text-sm font-semibold text-white">Model & quy đổi quota (xpiki)</h2>
        <p className="text-xs text-gray-500 -mt-2">
          xpiki lưu <b>credit</b> = <code>quota_limit / 10.000</code>, và hiện <code>token = credit / giá_Opus5 × 1.000.000</code>.
          Để "10M token" trên bot = "10M token" trong panel xpiki, bot gửi <code>quota_limit = token × giá / 100</code>.
        </p>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Chế độ allowed models" hint="'all' = key xài mọi model group cho phép (khớp nút All models). 'restrict' = giới hạn theo danh sách Models ở tab Kết nối.">
            <select value={form.GPT2API_ALLOWED_MODELS_MODE ?? config.GPT2API_ALLOWED_MODELS_MODE ?? eff.allowedModelsMode ?? "all"}
              onChange={(e) => set("GPT2API_ALLOWED_MODELS_MODE", e.target.value)}
              className="w-full glass-input rounded-lg px-3 py-2 text-sm">
              <option value="all">All models (khuyên)</option>
              <option value="restrict">Restrict theo danh sách</option>
            </select>
          </Field>
          <NumField label="Giá tham chiếu Opus 5 / 1M" k="GPT2API_QUOTA_REF_PRICE" {...{ form, config, set }} eff={eff.quotaRefPrice}
            hint="= 'Claude Opus 5 input price per 1M' trong panel xpiki (hiện 15). Đặt 0 = tắt quy đổi, gửi token thô." />
        </div>
      </div>

      <div className="glass rounded-xl p-5 space-y-4">
        <h2 className="text-sm font-semibold text-white">Mặc định cho key mới</h2>
        <div className="grid grid-cols-3 gap-3">
          <NumField label="RPM mặc định" k="GPT2API_KEY_RPM" {...{ form, config, set }} eff={eff.keyRpm} hint="0 = không đặt" />
          <NumField label="TPM mặc định" k="GPT2API_KEY_TPM" {...{ form, config, set }} eff={eff.keyTpm} hint="0 = theo group" />
          <NumField label="Số ngày mặc định" k="GPT2API_KEY_VALID_DAYS" {...{ form, config, set }} eff={eff.keyValidDays} hint="0 = không hết hạn" />
        </div>
      </div>

      <div className="glass rounded-xl p-5 space-y-4">
        <h2 className="text-sm font-semibold text-white">Phụ phí (nhân vào giá token)</h2>
        <p className="text-xs text-gray-500 -mt-2">
          giá cuối = giá_token × [1 + (RPM vượt mức)/mức × %RPM] × [1 + ngày/30 × %ngày] (key vĩnh viễn: × hệ số riêng).
          Đặt 2 ô % về 0 và hệ số vĩnh viễn về 1 để tắt phụ phí.
        </p>
        <div className="grid grid-cols-2 gap-3">
          <NumField label="RPM gồm sẵn trong giá" k="GPT2API_RPM_INCLUDED" {...{ form, config, set }} eff={eff.rpmIncluded} />
          <NumField label="+% mỗi block RPM vượt mức" k="GPT2API_RPM_SURCHARGE_PCT" {...{ form, config, set }} eff={eff.rpmSurchargePct} />
          <NumField label="+% mỗi 30 ngày hiệu lực" k="GPT2API_DAY_SURCHARGE_PCT" {...{ form, config, set }} eff={eff.daySurchargePct} />
          <NumField label="Hệ số key không hết hạn" k="GPT2API_NO_EXPIRY_MULT" step="0.1" {...{ form, config, set }} eff={eff.noExpiryMult} hint="≥ 1. 1.5 = đắt hơn 50%" />
        </div>

        {/* Xem trước giá */}
        <div className="rounded-lg border border-white/[0.08] bg-white/[0.02] p-3 mt-1">
          <div className="flex items-center gap-2 mb-2 text-xs font-semibold text-gray-300">
            <Calculator size={13} /> Xem trước giá (dùng cấu hình ĐÃ LƯU)
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <label className="text-xs text-gray-500">Token (M)
              <input type="number" value={pv.tokensM} onChange={(e) => setPv((p) => ({ ...p, tokensM: e.target.value }))}
                className="block w-24 glass-input rounded-lg px-2 py-1.5 text-sm mt-0.5" /></label>
            <label className="text-xs text-gray-500">RPM
              <input type="number" value={pv.rpm} onChange={(e) => setPv((p) => ({ ...p, rpm: e.target.value }))}
                className="block w-24 glass-input rounded-lg px-2 py-1.5 text-sm mt-0.5" /></label>
            <label className="text-xs text-gray-500">Số ngày
              <input type="number" value={pv.days} onChange={(e) => setPv((p) => ({ ...p, days: e.target.value }))}
                className="block w-24 glass-input rounded-lg px-2 py-1.5 text-sm mt-0.5" /></label>
            <button onClick={runPreview} disabled={priceMut.isPending}
              className="px-3 py-1.5 bg-white/[0.08] text-gray-200 border border-white/[0.1] rounded-lg text-sm hover:bg-white/[0.14] transition-colors">
              Tính
            </button>
            {priceMut.data && (
              <span className="text-sm text-emerald-300 font-medium">
                ${priceMut.data.priceUsd.toFixed(2)}
                <span className="text-gray-500 font-normal">
                  {" "}(gốc ${priceMut.data.baseUsd.toFixed(2)}
                  {priceMut.data.rpmPct > 0 && ` · RPM +${priceMut.data.rpmPct}%`}
                  {priceMut.data.daysPct > 0 && ` · ngày +${priceMut.data.daysPct}%`})
                </span>
                {priceMut.data.overMax && <span className="text-amber-400"> · vượt trần</span>}
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="glass rounded-xl p-5 space-y-4">
        <h2 className="text-sm font-semibold text-white">Giới hạn khách chọn</h2>
        <div className="grid grid-cols-3 gap-3">
          <NumField label="Trần mua (triệu token)" k="GPT2API_MAX_BUY_M" {...{ form, config, set }} eff={eff.maxBuyM}
            hint="Để trống = coi như không giới hạn" />
          <TextField label="Nút RPM bán sẵn" k="GPT2API_RPM_PRESETS" {...{ form, config, set }} eff={eff.rpmPresets} />
          <TextField label="Nút số ngày bán sẵn" k="GPT2API_DAYS_PRESETS" {...{ form, config, set }} eff={eff.daysPresets} />
        </div>
      </div>

      <div className="glass rounded-xl p-5 space-y-4">
        <h2 className="text-sm font-semibold text-white">Quà tặng (giftcode APIKEY)</h2>
        <p className="text-xs text-gray-500 -mt-2">
          Miền quota random mặc định khi tạo mã giftcode để trống ô quota. Mã đã tạo giữ nguyên miền của nó.
        </p>
        <div className="grid grid-cols-3 gap-3">
          <NumField label="Quota tối thiểu (M)" k="GPT2API_FREE_MIN_M" {...{ form, config, set }} eff={eff.freeMinM} />
          <NumField label="Quota tối đa (M)" k="GPT2API_FREE_MAX_M" {...{ form, config, set }} eff={eff.freeMaxM} />
          <NumField label="Alpha (độ hiếm mốc cao)" k="GPT2API_FREE_ALPHA" step="0.1" {...{ form, config, set }} eff={eff.freeAlpha}
            hint="Càng lớn mốc cao càng hiếm. 2 là hợp lý" />
        </div>
        {quota && (
          <div className="rounded-lg border border-white/[0.08] bg-white/[0.02] p-3 text-xs">
            <p className="text-gray-400 mb-2">Xác suất theo dải (trung bình ≈ <b className="text-gray-200">{quota.avgM}M</b>):</p>
            <div className="flex flex-wrap gap-2">
              {quota.bands.map((b) => (
                <span key={b.label} className="px-2 py-1 rounded-md bg-white/[0.04] border border-white/[0.08] text-gray-300">
                  {b.label}: <b className="text-primary-300">{(b.probability * 100).toFixed(1)}%</b>
                </span>
              ))}
            </div>
          </div>
        )}
      </div>

        </div>
      </details>

      {saveMut.isError && (
        <div className="rounded-xl px-4 py-3 text-xs text-red-300 bg-red-950/40 border border-red-800/40">
          Lỗi lưu: {saveMut.error?.response?.data?.error || saveMut.error?.message}
        </div>
      )}
      <button onClick={save} disabled={saveMut.isPending}
        className="flex items-center gap-1.5 px-4 py-2 bg-primary-500 text-white rounded-lg text-sm font-medium hover:bg-primary-600 disabled:opacity-50 transition-colors shadow-glow-sm">
        <Save size={13} /> {saveMut.isPending ? "Đang lưu..." : "Lưu giá & giới hạn"}
      </button>
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
      {activeTab === "pricing" && <PricingTab />}
      {activeTab === "keys" && <IssuedKeysTab />}
    </div>
  );
}
