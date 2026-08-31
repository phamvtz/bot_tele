import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Save, CheckCircle2, Plug, RefreshCw, AlertTriangle } from "lucide-react";
import { api } from "../api/endpoints";

const TABS = [
  { key: "connection", label: "Kết nối" },
  // Phase B: { key: "pricing", label: "Giá & giới hạn" }
  // Phase C: { key: "keys", label: "Key đã cấp" }
];

// Các key gửi kèm khi Lưu tab "Kết nối". Token xử lý riêng (rỗng = giữ nguyên).
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

export default function ApiKeyShop() {
  const [activeTab, setActiveTab] = useState("connection");
  const [form, setForm] = useState({});
  const [tokenInput, setTokenInput] = useState("");
  const [saved, setSaved] = useState(false);
  const [groups, setGroups] = useState(null); // [{ id, name, order }] sau khi bấm Kiểm tra
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

  const selectedGroups = f("GPT2API_FALLBACK_GROUPS")
    .split(/[,\s]+/).map((s) => s.trim()).filter(Boolean);

  function toggleGroup(id) {
    const s = new Set(selectedGroups);
    if (s.has(id)) s.delete(id); else s.add(id);
    set("GPT2API_FALLBACK_GROUPS", [...s].join(","));
  }

  if (isLoading) return (
    <div className="flex items-center justify-center py-20 text-sm text-gray-400">Đang tải cấu hình...</div>
  );

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-xl font-bold text-white">Cửa hàng API key</h1>
        <div className="flex items-center gap-2">
          {saved && (
            <span className="flex items-center gap-1.5 text-sm text-emerald-400 animate-in fade-in">
              <CheckCircle2 size={14} /> Đã lưu
            </span>
          )}
          <span className={`text-[11px] px-2 py-1 rounded-full border ${
            data?.configured
              ? "text-emerald-400 border-emerald-700/40 bg-emerald-950/30"
              : "text-amber-400 border-amber-700/40 bg-amber-950/30"
          }`}>
            {data?.configured ? "Đã cấu hình" : "Chưa đủ cấu hình"}
          </span>
          <span className={`text-[11px] px-2 py-1 rounded-full border ${
            enabled
              ? "text-emerald-400 border-emerald-700/40 bg-emerald-950/30"
              : "text-gray-400 border-white/10 bg-white/[0.03]"
          }`}>
            {enabled ? "Đang bật" : "Đang tắt"}
          </span>
        </div>
      </div>
      <p className="text-sm text-gray-500 mb-5">Kết nối GPT2API (xpiki) — nguồn tạo key sk-* bán cho khách</p>

      {/* Tabs */}
      <div className="flex gap-1 mb-5">
        {TABS.map((t) => (
          <button key={t.key} onClick={() => setActiveTab(t.key)}
            className={`text-sm px-4 py-2 rounded-lg transition-colors ${
              activeTab === t.key
                ? "bg-primary-600/20 text-primary-400 border border-primary-700/50"
                : "text-gray-400 hover:text-white glass border border-white/[0.06]"
            }`}>
            {t.label}
          </button>
        ))}
      </div>

      {activeTab === "connection" && (
        <div className="max-w-2xl space-y-5">
          {/* Bật/tắt */}
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

          {/* Kết nối */}
          <div className="glass rounded-xl p-5 space-y-4">
            <h2 className="text-sm font-semibold text-white">Thông tin kết nối</h2>

            <Field label="Base URL" hint="Admin Public API của GPT2API, kết thúc bằng /api/admin-pub">
              <input value={f("GPT2API_BASE")} onChange={(e) => set("GPT2API_BASE", e.target.value)}
                className="w-full glass-input rounded-lg px-3 py-2 text-sm font-mono"
                placeholder="https://api.xpiki.com/api/admin-pub" />
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
                className="w-full glass-input rounded-lg px-3 py-2 text-sm font-mono"
                placeholder="386572b4-4ea5-4d07-..." />
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
                className="w-full glass-input rounded-lg px-3 py-2 text-sm font-mono"
                placeholder="(trống = tất cả)" />
              {groups && groups.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {groups.map((g) => {
                    const on = selectedGroups.includes(g.id);
                    return (
                      <button key={g.id} type="button" onClick={() => toggleGroup(g.id)}
                        title={g.id}
                        className={`text-xs px-2 py-1 rounded-md border transition-colors ${
                          on
                            ? "bg-primary-500/25 text-primary-100 border-primary-500/50"
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

          {/* Test result */}
          {testMut.data && (
            <div className={`rounded-xl px-4 py-3 text-xs border ${
              testMut.data.ok
                ? "text-emerald-300 bg-emerald-950/30 border-emerald-800/40"
                : "text-red-300 bg-red-950/40 border-red-800/40"
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

          {/* Actions */}
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
      )}
    </div>
  );
}
