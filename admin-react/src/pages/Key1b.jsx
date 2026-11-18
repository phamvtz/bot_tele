import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  KeyRound, Save, RotateCcw, Copy, Check, Users, Radio, ShieldCheck,
  Search, RefreshCw, Sparkles, ArrowLeft, Globe,
} from "lucide-react";
import { api } from "../api/endpoints";
import StatsCard from "../components/StatsCard";
import EmptyState from "../components/EmptyState";
import { formatDate } from "../utils/format";

function ToggleSwitch({ checked, onChange, label, hint }) {
  return (
    <div
      onClick={() => onChange(!checked)}
      className="flex items-start justify-between gap-3 p-3 rounded-lg bg-slate-900/50 border border-slate-800/80 cursor-pointer hover:border-slate-700/80 transition-colors"
    >
      <div>
        <div className="text-xs font-medium text-slate-200">{label}</div>
        {hint && <div className="text-[11px] text-slate-400 mt-0.5">{hint}</div>}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={(e) => {
          e.stopPropagation();
          onChange(!checked);
        }}
        className={`relative inline-flex h-5 w-9 flex-shrink-0 items-center rounded-full transition-colors cursor-pointer ${
          checked ? "bg-emerald-500" : "bg-slate-700"
        }`}
      >
        <span
          className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
            checked ? "translate-x-[18px]" : "translate-x-1"
          }`}
        />
      </button>
    </div>
  );
}

const MILESTONE_STEPS = [25, 50, 75, 90];

export default function Key1b() {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [form, setForm] = useState(null);
  const [newKeyInput, setNewKeyInput] = useState("");
  const [copiedId, setCopiedId] = useState("");
  const [copiedAllIps, setCopiedAllIps] = useState(false);
  const [copiedDeepLink, setCopiedDeepLink] = useState(false);

  const { data, isLoading, isFetching, refetch } = useQuery({
    queryKey: ["key1b-status", search],
    queryFn: () => api.key1bStatus({ limit: 250, q: search }),
    refetchInterval: 30_000, // Tự động refresh danh sách & IP mỗi 30 giây theo đặc tả
  });

  const { data: botStatus } = useQuery({
    queryKey: ["bot-status"],
    queryFn: api.botStatus,
    staleTime: 60_000,
  });

  const cfg = data?.config || {};
  const stats = data?.stats || {};
  const redemptions = data?.redemptions || [];

  useEffect(() => {
    if (!data?.config) return;
    const c = data.config;
    setForm({
      key1bEnabled: Boolean(c.key1bEnabled),
      key1bDisplayName: c.key1bDisplayName || "Key 1.5B",
      key1bCost: String(c.key1bCost ?? 1),
      key1bLimit: String(c.key1bLimit ?? 50),
      key1bUnlimited: Boolean(c.key1bUnlimited),
      key1bNote: c.key1bNote || "",
      key1bMilestoneEnabled: c.key1bMilestoneEnabled !== false,
      key1bMilestoneBroadcastUsers: Boolean(c.key1bMilestoneBroadcastUsers),
      key1bMilestoneChannelEnabled: c.key1bMilestoneChannelEnabled !== false,
      key1bMilestoneChannelId: c.key1bMilestoneChannelId || "",
    });
  }, [data?.config]);

  const setF = (k, v) => setForm((p) => ({ ...(p || {}), [k]: v }));

  const saveMut = useMutation({
    mutationFn: (payload) => api.updateKey1bConfig(payload),
    onSuccess: () => {
      setNewKeyInput("");
      qc.invalidateQueries({ queryKey: ["key1b-status"] });
    },
  });

  const resetMut = useMutation({
    mutationFn: () => api.resetKey1bBatch(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["key1b-status"] });
    },
  });

  function handleSave(e) {
    e.preventDefault();
    if (!form) return;
    saveMut.mutate({
      ...form,
      ...(newKeyInput.trim() ? { key1bKeyValue: newKeyInput.trim() } : {}),
    });
  }

  const allDistinctIps = [...new Set(redemptions.flatMap((r) => r.ips || []))];
  const deepLink = botStatus?.username ? `https://t.me/${botStatus.username}?start=key1b` : "";

  function copyAllIps() {
    if (!allDistinctIps.length) return;
    navigator.clipboard.writeText(allDistinctIps.join("\n"));
    setCopiedAllIps(true);
    setTimeout(() => setCopiedAllIps(false), 2000);
  }

  function copyText(id, text) {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(""), 1800);
  }

  const loggedMilestones = Array.isArray(cfg.key1bMilestoneLog) ? cfg.key1bMilestoneLog : [];

  return (
    <div className="space-y-4 pb-12">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="eyebrow text-slate-400">REFERRAL // BRANCH 5</span>
            <span className="w-1 h-1 rounded-full bg-slate-600" />
            <span className="text-[10px] font-mono text-amber-400">SHARED KEY + IP WHITELIST</span>
          </div>
          <h1 className="text-xl font-bold text-slate-100 tracking-tight flex items-center gap-2">
            Sự kiện Key 1.5B (Dùng chung · Khóa 1–2 IP)
            <span
              className={`text-[10px] font-mono px-2 py-0.5 rounded-full border ${
                cfg.key1bEnabled && cfg._key1bKeyValue_configured
                  ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/30"
                  : "bg-slate-800 text-slate-400 border-slate-700"
              }`}
            >
              {cfg.key1bEnabled && cfg._key1bKeyValue_configured ? "ĐANG BẬT" : "ĐANG TẮT"}
            </span>
          </h1>
          <p className="text-xs text-slate-400 mt-0.5 tracking-tight">
            Mỗi user đổi tối đa 1 lần / đợt bằng điểm giới thiệu ⭐, bắt buộc khai báo 1–2 IPv4/IPv6 hợp lệ. Tự động rao mốc 25/50/75/90% & Sold-out không lộ số lượng thật.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Link
            to="/system/referral"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800/80 hover:bg-slate-700 text-slate-200 border border-slate-700/80 text-xs font-mono"
          >
            <ArrowLeft size={13} />
            Cấu hình Referral
          </Link>
          <button
            type="button"
            onClick={() => {
              if (window.confirm("Reset mở đợt Key 1.5B mới? Mọi user sẽ được phép đổi lại 1 lần trong đợt mới và bộ đếm rao mốc 25/50/75/90% được đặt lại.")) {
                resetMut.mutate();
              }
            }}
            disabled={resetMut.isPending}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 border border-amber-500/30 text-xs font-mono cursor-pointer"
          >
            <RotateCcw size={13} />
            {resetMut.isPending ? "Đang reset..." : "Reset đợt mới"}
          </button>
        </div>
      </div>

      {/* Metrics */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5">
        <StatsCard
          icon={Users}
          label="ĐÃ ĐỔI TRONG ĐỢT"
          value={stats.unlimited ? `${stats.used ?? 0} (Unlimited)` : `${stats.used ?? 0} / ${stats.limit ?? 50}`}
          iconBg="bg-indigo-950/60"
          iconColor="text-indigo-400"
        />
        <StatsCard
          icon={Sparkles}
          label="SUẤT CÒN LẠI"
          value={stats.unlimited ? "Không giới hạn" : String(stats.remaining ?? 0)}
          iconBg="bg-emerald-950/60"
          iconColor="text-emerald-400"
        />
        <StatsCard
          icon={Globe}
          label="TỔNG IP ĐÃ ĐĂNG KÝ"
          value={`${allDistinctIps.length} IP`}
          iconBg="bg-cyan-950/60"
          iconColor="text-cyan-400"
        />
        <StatsCard
          icon={KeyRound}
          label="TRẠNG THÁI KEY GỐC"
          value={cfg._key1bKeyValue_configured ? (cfg.maskedKeyPreview || "Đã cấu hình") : "Chưa nhập Key"}
          iconBg="bg-amber-950/60"
          iconColor="text-amber-400"
        />
      </div>

      {/* Deep-link Bar */}
      {deepLink && (
        <div className="bento-card p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div className="text-xs text-slate-300">
            <span className="text-slate-400 font-mono mr-2">DEEP-LINK SỰ KIỆN:</span>
            <code className="text-indigo-300 font-mono select-all">{deepLink}</code>
          </div>
          <button
            type="button"
            onClick={() => {
              navigator.clipboard.writeText(deepLink);
              setCopiedDeepLink(true);
              setTimeout(() => setCopiedDeepLink(false), 1800);
            }}
            className="flex items-center gap-1.5 px-3 py-1 bg-indigo-600 hover:bg-indigo-500 text-white rounded text-xs font-mono cursor-pointer self-start sm:self-auto"
          >
            {copiedDeepLink ? <Check size={12} /> : <Copy size={12} />}
            {copiedDeepLink ? "ĐÃ COPY LINK" : "COPY DEEP-LINK"}
          </button>
        </div>
      )}

      {/* Config Form + Milestone Panel */}
      {form && (
        <form onSubmit={handleSave} className="bento-card p-4 space-y-5">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            {/* Left: Core Config */}
            <div className="space-y-3.5">
              <h2 className="text-xs font-mono uppercase tracking-wider text-indigo-400 font-semibold flex items-center gap-1.5">
                <ShieldCheck size={14} /> Cấu hình Gói & Chuỗi Key Dùng Chung
              </h2>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <ToggleSwitch
                  checked={form.key1bEnabled}
                  onChange={(v) => setF("key1bEnabled", v)}
                  label="Mở sự kiện Key 1.5B"
                  hint="Cho phép khách bấm đổi trên Bot & qua ?start=key1b."
                />
                <ToggleSwitch
                  checked={form.key1bUnlimited}
                  onChange={(v) => setF("key1bUnlimited", v)}
                  label="Không giới hạn số slot (Unlimited)"
                  hint="Tắt giới hạn lượt đổi của đợt (vẫn khóa 1 lần/user)."
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="sm:col-span-1">
                  <label className="text-xs text-slate-400 block mb-1">Tên hiển thị sự kiện</label>
                  <input
                    value={form.key1bDisplayName}
                    onChange={(e) => setF("key1bDisplayName", e.target.value)}
                    placeholder="Key 1.5B"
                    className="w-full glass-input rounded px-3 py-1.5 text-sm"
                  />
                </div>
                <div>
                  <label className="text-xs text-slate-400 block mb-1">Giá đổi (Điểm ⭐)</label>
                  <input
                    type="number"
                    min="0"
                    value={form.key1bCost}
                    onChange={(e) => setF("key1bCost", e.target.value)}
                    className="w-full glass-input rounded px-3 py-1.5 text-sm"
                  />
                </div>
                <div>
                  <label className="text-xs text-slate-400 block mb-1">Giới hạn Slot đợt</label>
                  <input
                    type="number"
                    min="1"
                    disabled={form.key1bUnlimited}
                    value={form.key1bLimit}
                    onChange={(e) => setF("key1bLimit", e.target.value)}
                    className="w-full glass-input rounded px-3 py-1.5 text-sm disabled:opacity-40"
                  />
                </div>
              </div>

              <div>
                <label className="text-xs text-slate-400 block mb-1">
                  Chuỗi API Key dùng chung (Bảo mật — để trống để giữ nguyên key hiện tại)
                </label>
                <input
                  type="password"
                  value={newKeyInput}
                  onChange={(e) => setNewKeyInput(e.target.value)}
                  placeholder={
                    cfg._key1bKeyValue_configured
                      ? `Đã cấu hình (${cfg.maskedKeyPreview}) — dán key mới nếu muốn thay đổi`
                      : "Dán chuỗi sk-... dùng chung cho cả đợt vào đây"
                  }
                  className="w-full glass-input rounded px-3 py-1.5 text-xs font-mono"
                />
              </div>

              <div>
                <label className="text-xs text-slate-400 block mb-1">Ghi chú / Hướng dẫn kèm theo (hiển thị sau khi đổi)</label>
                <textarea
                  rows={2}
                  value={form.key1bNote}
                  onChange={(e) => setF("key1bNote", e.target.value)}
                  placeholder="VD: Base URL https://... · Chỉ gọi từ đúng 1–2 IP đã đăng ký"
                  className="w-full glass-input rounded px-3 py-1.5 text-xs"
                />
              </div>
            </div>

            {/* Right: Milestone Announcer */}
            <div className="space-y-3.5">
              <h2 className="text-xs font-mono uppercase tracking-wider text-amber-400 font-semibold flex items-center gap-1.5">
                <Radio size={14} /> Rao mốc Slot tự động (25% / 50% / 75% / 90% / Sold-out)
              </h2>

              <ToggleSwitch
                checked={form.key1bMilestoneEnabled}
                onChange={(v) => setF("key1bMilestoneEnabled", v)}
                label="Tự động rao mốc ước lượng (khi giới hạn slot)"
                hint="Tuyệt đối không lộ con số used/limit thật — chỉ báo ước lượng ~25%, ~50%, ~75%, ~90% và hết suất."
              />

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <ToggleSwitch
                  checked={form.key1bMilestoneChannelEnabled}
                  onChange={(v) => setF("key1bMilestoneChannelEnabled", v)}
                  label="Đăng lên Channel kèm nút ?start=key1b"
                  hint="Tạo hiệu ứng FOMO trên kênh thông báo."
                />
                <ToggleSwitch
                  checked={form.key1bMilestoneBroadcastUsers}
                  onChange={(v) => setF("key1bMilestoneBroadcastUsers", v)}
                  label="Broadcast tới user của Bot"
                  hint="Gửi thông báo trực tiếp qua bot khi chạm mốc."
                />
              </div>

              <div>
                <label className="text-xs text-slate-400 block mb-1">Channel ID nhận thông báo mốc</label>
                <input
                  value={form.key1bMilestoneChannelId}
                  onChange={(e) => setF("key1bMilestoneChannelId", e.target.value)}
                  placeholder="VD: -100123456789 (trống = theo kênh mặc định)"
                  className="w-full glass-input rounded px-3 py-1.5 text-xs font-mono"
                />
              </div>

              <div className="rounded-lg bg-slate-900/60 border border-slate-800 p-3 space-y-2">
                <div className="text-[11px] font-mono text-slate-400">
                  TRẠNG THÁI CÁC MỐC ĐÃ RAO TRONG ĐỢT HIỆN TẠI
                  {stats.resetAt && (
                    <span className="text-slate-500 ml-1">(từ {formatDate(stats.resetAt)})</span>
                  )}
                </div>
                <div className="flex flex-wrap gap-2">
                  {MILESTONE_STEPS.map((m) => {
                    const hit = loggedMilestones.includes(m);
                    return (
                      <span
                        key={m}
                        className={`text-xs font-mono px-2.5 py-1 rounded border ${
                          hit
                            ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/30"
                            : "bg-slate-800/70 text-slate-500 border-slate-700/60"
                        }`}
                      >
                        {hit ? "✓" : "○"} Mốc {m}%
                      </span>
                    );
                  })}
                  <span
                    className={`text-xs font-mono px-2.5 py-1 rounded border ${
                      cfg.key1bMilestoneSoldOut
                        ? "bg-rose-500/20 text-rose-300 border-rose-500/40"
                        : "bg-slate-800/70 text-slate-500 border-slate-700/60"
                    }`}
                  >
                    {cfg.key1bMilestoneSoldOut ? "✓" : "○"} SOLD OUT
                  </span>
                </div>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3 border-t border-white/[0.06] pt-3.5">
            <button
              type="submit"
              disabled={saveMut.isPending}
              className="flex items-center gap-1.5 px-5 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-mono font-semibold cursor-pointer disabled:opacity-50"
            >
              <Save size={14} />
              {saveMut.isPending ? "ĐANG LƯU..." : "LƯU CẤU HÌNH KEY 1.5B"}
            </button>
            {saveMut.isSuccess && (
              <span className="text-xs text-emerald-400 font-mono">✓ Đã lưu cấu hình thành công!</span>
            )}
            {saveMut.isError && (
              <span className="text-xs text-rose-400 font-mono">
                ✕ {saveMut.error?.response?.data?.error || "Lưu thất bại"}
              </span>
            )}
          </div>
        </form>
      )}

      {/* Redemptions Table (auto-refresh 30s) */}
      <div className="bento-card p-4 space-y-3.5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
          <div>
            <h2 className="text-sm font-semibold text-slate-100 flex items-center gap-2">
              Danh sách người đã nhận trong đợt ({redemptions.length})
              <span className="text-[10px] font-mono text-slate-400 font-normal">
                • tự làm mới mỗi 30s {isFetching ? "(đang tải...)" : ""}
              </span>
            </h2>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Tìm Telegram ID hoặc IP..."
                className="glass-input rounded pl-8 pr-3 py-1.5 text-xs font-mono w-56"
              />
            </div>

            <button
              type="button"
              onClick={copyAllIps}
              disabled={!allDistinctIps.length}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-cyan-500/15 hover:bg-cyan-500/25 text-cyan-300 border border-cyan-500/30 text-xs font-mono cursor-pointer disabled:opacity-40"
            >
              {copiedAllIps ? <Check size={12} /> : <Copy size={12} />}
              {copiedAllIps ? "ĐÃ COPY WHITELIST" : `COPY ${allDistinctIps.length} IP`}
            </button>

            <button
              type="button"
              onClick={() => refetch()}
              className="p-1.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 cursor-pointer"
              title="Làm mới ngay"
            >
              <RefreshCw size={13} className={isFetching ? "animate-spin" : ""} />
            </button>
          </div>
        </div>

        {isLoading ? (
          <p className="text-center py-8 text-sm text-slate-400">Đang tải danh sách...</p>
        ) : redemptions.length === 0 ? (
          <EmptyState icon={KeyRound} message="Chưa có thành viên nào đổi Key 1.5B trong đợt hiện tại." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/[0.06] text-left text-xs text-slate-400">
                  <th className="px-3 py-2.5 font-medium">#</th>
                  <th className="px-3 py-2.5 font-medium">Người dùng</th>
                  <th className="px-3 py-2.5 font-medium">Địa chỉ IP đăng ký (1–2 IP)</th>
                  <th className="px-3 py-2.5 font-medium text-right">Điểm trừ</th>
                  <th className="px-3 py-2.5 font-medium">Thời gian đổi</th>
                </tr>
              </thead>
              <tbody>
                {redemptions.map((r, idx) => (
                  <tr key={r.id} className="border-b border-white/[0.04] hover:bg-white/[0.02]">
                    <td className="px-3 py-2.5 text-xs text-slate-500 font-mono">{idx + 1}</td>
                    <td className="px-3 py-2.5 text-xs">
                      <div className="font-medium text-slate-200">
                        {r.user?.firstName || r.user?.username || "—"}
                      </div>
                      <div className="text-slate-400 font-mono">
                        {r.telegramId}
                        {r.user?.username ? ` · @${r.user.username}` : ""}
                      </div>
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="flex flex-wrap items-center gap-1.5">
                        {(r.ips || []).map((ip) => (
                          <button
                            key={ip}
                            type="button"
                            onClick={() => copyText(`${r.id}:${ip}`, ip)}
                            className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-slate-900 border border-slate-700/80 hover:border-cyan-500/50 text-xs font-mono text-cyan-300 cursor-pointer"
                            title="Bấm để sao chép IP"
                          >
                            {ip}
                            {copiedId === `${r.id}:${ip}` ? <Check size={10} className="text-emerald-400" /> : <Copy size={10} className="text-slate-500" />}
                          </button>
                        ))}
                      </div>
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono text-xs text-amber-300">
                      -{r.pointsUsed} ⭐
                    </td>
                    <td className="px-3 py-2.5 text-xs text-slate-400">{formatDate(r.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
