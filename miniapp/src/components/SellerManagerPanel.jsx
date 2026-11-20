import React, { useCallback, useEffect, useState } from "react";
import { RotateCw, Plus, Copy, X, Power, Trash2, RefreshCw } from "lucide-react";
import { makeClientRef } from "../lib/api.js";
import { formatUsd, formatVnd, formatTokensCompact, formatDateTime } from "../lib/format.js";
import { copyToClipboard, hapticImpact, hapticNotify } from "../lib/telegram.js";
import { useToast } from "./Toast.jsx";

const STATUS_META = {
  active: { label: "Hoạt động", cls: "text-emerald-400", dot: "bg-emerald-400" },
  low: { label: "Sắp cạn", cls: "text-amber-400", dot: "bg-amber-400" },
  exhausted: { label: "Hết quota", cls: "text-rose-400", dot: "bg-rose-400" },
  expired: { label: "Hết hạn", cls: "text-rose-400", dot: "bg-rose-400" },
  disabled: { label: "Đã tắt", cls: "text-zinc-400", dot: "bg-zinc-500" },
  unknown: { label: "Chưa rõ", cls: "text-zinc-400", dot: "bg-zinc-500" },
};

export default function SellerManagerPanel({ devApi, onGoTopup }) {
  const apiKey = devApi?.apiKey || "";
  const { showToast } = useToast();

  const [me, setMe] = useState(null);
  const [keys, setKeys] = useState([]);
  const [stats, setStats] = useState(null);
  const [profiles, setProfiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState("");

  const [filter, setFilter] = useState("visible");
  const [search, setSearch] = useState("");

  // Form cấp nhanh key cho khách
  const [showCreate, setShowCreate] = useState(false);
  const [profileId, setProfileId] = useState(null);
  const [tokensInput, setTokensInput] = useState("100m");
  const [rpmInput, setRpmInput] = useState("100");
  const [daysInput, setDaysInput] = useState("30");
  const [custTgId, setCustTgId] = useState("");
  const [notifyBot, setNotifyBot] = useState(false);
  const [createQuote, setCreateQuote] = useState(null);
  const [quotingCreate, setQuotingCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createdBanner, setCreatedBanner] = useState(null);

  // Gia hạn inline sheet
  const [renewTarget, setRenewTarget] = useState(null);
  const [addM, setAddM] = useState(50);
  const [addDays, setAddDays] = useState(0);
  const [renewQuote, setRenewQuote] = useState(null);
  const [quotingRenew, setQuotingRenew] = useState(false);
  const [renewing, setRenewing] = useState(false);

  // Busy states per key
  const [togglingId, setTogglingId] = useState("");
  const [confirmRevokeId, setConfirmRevokeId] = useState("");
  const [revokingId, setRevokingId] = useState("");

  const sellerFetch = useCallback(
    async (path, { method = "GET", body = null } = {}) => {
      const headers = {
        Accept: "application/json",
        Authorization: `Bearer ${apiKey}`,
      };
      if (body !== null) headers["Content-Type"] = "application/json";
      const res = await fetch(`/api/seller${path}`, {
        method,
        headers,
        body: body !== null ? JSON.stringify(body) : undefined,
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        const err = new Error(json.error || `HTTP ${res.status}`);
        err.status = res.status;
        err.code = json.code || "";
        throw err;
      }
      return json;
    },
    [apiKey],
  );

  const loadAll = useCallback(async () => {
    if (!apiKey) return;
    setLoading(true);
    setAuthError("");
    try {
      const [meRes, keysRes, statsRes, profRes] = await Promise.all([
        sellerFetch("/me"),
        sellerFetch("/keys?live=1&limit=100"),
        sellerFetch("/stats/keys?days=30").catch(() => null),
        sellerFetch("/profiles").catch(() => ({ profiles: [] })),
      ]);
      setMe(meRes);
      setKeys(keysRes?.keys || []);
      setStats(statsRes);
      const list = (profRes?.profiles || []).filter((p) => p.enabled !== false && p.configured);
      setProfiles(list);
      if (list.length > 0 && profileId === null) {
        setProfileId(list[0].profileId);
        setRpmInput(String(list[0].defaultRpm || 100));
        setDaysInput(String(list[0].defaultValidDays ?? 30));
      }
    } catch (err) {
      if (err.status === 401) {
        setAuthError("API Seller của bạn hiện đang bị tạm khóa hoặc chưa hợp lệ.");
      } else {
        showToast(err.message || "Không tải được dữ liệu Seller", "error");
      }
    } finally {
      setLoading(false);
    }
  }, [apiKey, profileId, sellerFetch, showToast]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  // Quote tạo key
  useEffect(() => {
    if (!showCreate || !apiKey) return undefined;
    let cancelled = false;
    setQuotingCreate(true);
    const t = setTimeout(async () => {
      try {
        const q = await sellerFetch("/quote", {
          method: "POST",
          body: {
            profileId,
            tokens: tokensInput,
            rpm: rpmInput,
            validDays: daysInput,
          },
        });
        if (!cancelled) setCreateQuote(q);
      } catch (err) {
        if (!cancelled) setCreateQuote({ error: err.message });
      } finally {
        if (!cancelled) setQuotingCreate(false);
      }
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [showCreate, apiKey, profileId, tokensInput, rpmInput, daysInput, sellerFetch]);

  // Quote gia hạn
  useEffect(() => {
    if (!renewTarget || !apiKey) return undefined;
    const addTokens = Math.max(0, Math.round(Number(addM || 0) * 1_000_000));
    if (addTokens <= 0 && Number(addDays) <= 0) {
      setRenewQuote(null);
      return undefined;
    }
    let cancelled = false;
    setQuotingRenew(true);
    const t = setTimeout(async () => {
      try {
        const q = await sellerFetch("/quote", {
          method: "POST",
          body: {
            keyId: renewTarget.id,
            addTokens,
            addDays: Number(addDays) || 0,
          },
        });
        if (!cancelled) setRenewQuote(q);
      } catch (err) {
        if (!cancelled) setRenewQuote({ error: err.message });
      } finally {
        if (!cancelled) setQuotingRenew(false);
      }
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [renewTarget, addM, addDays, apiKey, sellerFetch]);

  const handleCreateCustomerKey = async (e) => {
    e.preventDefault();
    if (creating) return;
    hapticImpact("medium");
    setCreating(true);
    try {
      const canNotifyOthers = meInfo?.role === "SUPPLIER" || (Array.isArray(meInfo?.scopes) && meInfo.scopes.includes("stock"));
      const cleanTg = canNotifyOthers ? custTgId.trim() : "";
      const res = await sellerFetch("/keys", {
        method: "POST",
        body: {
          profileId,
          tokens: tokensInput,
          rpm: rpmInput,
          validDays: daysInput,
          telegramId: cleanTg || undefined,
          notify: Boolean(cleanTg && notifyBot),
          clientRef: makeClientRef("selcreate"),
        },
      });
      hapticNotify("success");
      setCreatedBanner(res);
      setShowCreate(false);
      setCustTgId("");
      setNotifyBot(false);
      showToast("Đã cấp Key Seller cho khách", "success");
      loadAll();
    } catch (err) {
      hapticNotify("error");
      showToast(err.message || "Không thể cấp key", "error");
    } finally {
      setCreating(false);
    }
  };

  const handleToggleEnabled = async (row) => {
    if (togglingId || revokingId) return;
    const currentlyDisabled = row.live?.status === "disabled" || row.live?.enabled === false;
    const wantEnabled = currentlyDisabled;
    hapticImpact("light");
    setTogglingId(row.id);
    try {
      const res = await sellerFetch(`/keys/${encodeURIComponent(row.id)}/enabled`, {
        method: "PATCH",
        body: { enabled: wantEnabled },
      });
      hapticNotify("success");
      showToast(res.enabled ? "Đã bật lại Key" : "Đã tạm tắt Key", "success");
      loadAll();
    } catch (err) {
      hapticNotify("error");
      showToast(err.message || "Không thể đổi trạng thái", "error");
    } finally {
      setTogglingId("");
    }
  };

  const handleRevoke = async (row, revokeProvider = true) => {
    if (revokingId || togglingId) return;
    hapticImpact("medium");
    setRevokingId(row.id);
    try {
      await sellerFetch(`/keys/${encodeURIComponent(row.id)}?revoke=${revokeProvider ? "true" : "false"}`, {
        method: "DELETE",
      });
      hapticNotify("success");
      setConfirmRevokeId("");
      showToast(revokeProvider ? "Đã thu hồi & ẩn Key" : "Đã ẩn Key khỏi danh sách", "success");
      loadAll();
    } catch (err) {
      hapticNotify("error");
      showToast(err.message || "Thu hồi thất bại", "error");
    } finally {
      setRevokingId("");
    }
  };

  const handleRenewSubmit = async () => {
    if (!renewTarget || renewing) return;
    const addTokens = Math.max(0, Math.round(Number(addM || 0) * 1_000_000));
    const days = Math.max(0, Math.floor(Number(addDays || 0)));
    if (!addTokens && !days) return;
    hapticImpact("medium");
    setRenewing(true);
    try {
      await sellerFetch(`/keys/${encodeURIComponent(renewTarget.id)}`, {
        method: "PATCH",
        body: {
          addTokens,
          addDays: days,
          clientRef: makeClientRef("selrnw"),
        },
      });
      hapticNotify("success");
      setRenewTarget(null);
      showToast("Gia hạn Key thành công", "success");
      loadAll();
    } catch (err) {
      hapticNotify("error");
      showToast(err.message || "Gia hạn thất bại", "error");
    } finally {
      setRenewing(false);
    }
  };

  if (authError) {
    return (
      <div className="rounded-2xl bg-card border border-rose-500/30 p-5 space-y-2 text-center">
        <div className="text-[14px] font-semibold text-rose-400">Không thể truy cập Quản lý Seller</div>
        <p className="text-[12.5px] text-zinc-400">{authError}</p>
      </div>
    );
  }

  const byStatus = stats?.byStatus || {};
  const activeCount = byStatus.active || 0;
  const expiredOrEmpty = (byStatus.expired || 0) + (byStatus.exhausted || 0);
  const disabledCount = byStatus.disabled || 0;

  const q = search.trim().toLowerCase();
  const visibleKeys = keys.filter((k) => {
    const st = k.live?.status || "unknown";
    if (filter === "visible" && k.hidden) return false;
    if (filter === "active" && (k.hidden || st !== "active")) return false;
    if (filter === "dead" && (k.hidden || !["expired", "exhausted"].includes(st))) return false;
    if (filter === "disabled" && (k.hidden || st !== "disabled")) return false;
    if (filter === "hidden" && !k.hidden) return false;
    if (!q) return true;
    return [k.key, k.profileName, k.telegramId, k.id].some((v) =>
      String(v || "").toLowerCase().includes(q),
    );
  });

  return (
    <div className="space-y-4">
      {/* Banner Key mới tạo thành công (chỉ hiện 1 lần) */}
      {createdBanner?.key && (
        <div className="rounded-2xl bg-card border border-emerald-500/35 p-4 space-y-3">
          <div className="flex items-start justify-between gap-2">
            <div>
              <div className="text-[13.5px] font-semibold text-emerald-400">
                Cấp Key Seller thành công (chỉ hiển thị 1 lần)
              </div>
              <div className="text-[11.5px] text-zinc-400 mt-0.5">
                {createdBanner.profileName || "Server"} · {formatTokensCompact(createdBanner.quotaTokens)} ·{" "}
                {createdBanner.rpm} RPM
              </div>
            </div>
            <button
              type="button"
              aria-label="Đóng"
              onClick={() => setCreatedBanner(null)}
              className="w-7 h-7 rounded-full bg-bg border border-white/[0.08] text-zinc-400 flex items-center justify-center"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
          <div className="px-3 py-2.5 rounded-xl bg-bg border border-white/[0.08] font-mono text-[12px] text-emerald-300 break-all select-all">
            {createdBanner.key}
          </div>
          <button
            type="button"
            onClick={async () => {
              await copyToClipboard(createdBanner.key);
              showToast("Đã sao chép Key gửi khách", "success");
            }}
            className="w-full h-9 rounded-xl bg-zinc-100 hover:bg-white text-zinc-950 text-[12.5px] font-semibold inline-flex items-center justify-center gap-1.5"
          >
            <Copy className="w-3.5 h-3.5" />
            Sao chép Key gửi khách
          </button>
        </div>
      )}

      {/* Tóm tắt Seller & Phân quyền */}
      <div className="rounded-2xl bg-card border border-white/[0.08] p-4 space-y-3.5">
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[15px] font-semibold tracking-[-0.015em] text-zinc-100">
                Quản lý Seller
              </span>
              <span className="px-2 py-0.5 rounded-full bg-bg border border-white/10 font-mono text-[10.5px] text-emerald-400">
                {me?.role || devApi?.role || "RESELLER"}
              </span>
            </div>
            <div className="text-[12px] text-zinc-500 mt-0.5">
              Chỉ hiển thị &amp; thao tác trên đúng các Key AI do bạn cấp
            </div>
          </div>
          <button
            type="button"
            aria-label="Làm mới bảng Seller"
            onClick={loadAll}
            className="w-8 h-8 rounded-full bg-bg border border-white/[0.08] text-zinc-400 hover:text-zinc-100 flex items-center justify-center shrink-0"
          >
            <RotateCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} strokeWidth={1.75} />
          </button>
        </div>

        {/* Số dư & Nạp ví */}
        <div className="px-3.5 py-2.5 rounded-xl bg-bg border border-white/[0.07] flex items-center justify-between gap-2 tabular">
          <div>
            <div className="text-[11px] text-zinc-500">Số dư ví Seller</div>
            <div className="text-[16px] font-semibold font-mono text-zinc-100">
              {me?.balance != null ? formatVnd(me.balance) : formatVnd(devApi?.balanceVnd || 0)}
            </div>
          </div>
          {onGoTopup && (
            <button
              type="button"
              onClick={() => onGoTopup(0)}
              className="h-8 px-3 rounded-lg bg-elevated hover:bg-subtle border border-white/[0.08] text-zinc-100 text-[12px] font-medium"
            >
              + Nạp ví
            </button>
          )}
        </div>

        {/* 4 chỉ số tổng hợp */}
        <div className="grid grid-cols-4 gap-2 tabular">
          {[
            { label: "Tổng key", val: stats?.keys ?? keys.length, cls: "text-zinc-100" },
            { label: "Đang chạy", val: activeCount, cls: "text-emerald-400" },
            { label: "Hết/Cạn", val: expiredOrEmpty, cls: "text-rose-400" },
            { label: "Đang tắt", val: disabledCount, cls: "text-zinc-400" },
          ].map((m) => (
            <div key={m.label} className="p-2.5 rounded-xl bg-bg border border-white/[0.06] text-center">
              <div className={`text-[15px] font-semibold font-mono ${m.cls}`}>{m.val}</div>
              <div className="text-[10.5px] text-zinc-500 mt-0.5">{m.label}</div>
            </div>
          ))}
        </div>

        <button
          type="button"
          onClick={() => {
            hapticImpact("light");
            setShowCreate((v) => !v);
          }}
          className="w-full h-10 rounded-xl bg-zinc-100 hover:bg-white text-zinc-950 text-[13px] font-semibold inline-flex items-center justify-center gap-1.5"
        >
          <Plus className="w-4 h-4" strokeWidth={2} />
          {showCreate ? "Đóng form cấp Key cho khách" : "Cấp nhanh Key cho khách"}
        </button>
      </div>

      {/* Form cấp key nhanh cho khách */}
      {showCreate && (
        <form
          onSubmit={handleCreateCustomerKey}
          className="rounded-2xl bg-card border border-white/[0.1] p-4 space-y-3.5"
        >
          <div className="text-[13.5px] font-semibold text-zinc-100">Cấp Key mới cho khách (trừ ví)</div>

          {profiles.length > 0 && (
            <div className="grid grid-cols-2 gap-2">
              {profiles.map((p) => {
                const active = profileId === p.profileId;
                return (
                  <button
                    key={p.profileId}
                    type="button"
                    onClick={() => {
                      setProfileId(p.profileId);
                      setRpmInput(String(p.defaultRpm || 100));
                      setDaysInput(String(p.defaultValidDays ?? 30));
                    }}
                    className={`p-2.5 rounded-xl border text-left transition-colors ${
                      active
                        ? "bg-zinc-100 border-zinc-100 text-zinc-950"
                        : "bg-bg border-white/[0.07] text-zinc-200"
                    }`}
                  >
                    <div className="text-[12.5px] font-semibold truncate">{p.name}</div>
                    <div className={`text-[11px] font-mono ${active ? "text-zinc-700" : "text-zinc-400"}`}>
                      ${p.usdPerMtoken}/1M
                    </div>
                  </button>
                );
              })}
            </div>
          )}

          <div className="space-y-1.5">
            <div className="text-[12px] text-zinc-400">Dung lượng Token</div>
            <div className="flex flex-wrap gap-1.5">
              {["10m", "50m", "100m", "500m", "1b"].map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => setTokensInput(preset)}
                  className={`h-7 px-2.5 rounded-lg border font-mono text-[11.5px] ${
                    tokensInput.toLowerCase() === preset
                      ? "bg-zinc-100 border-zinc-100 text-zinc-950 font-semibold"
                      : "bg-bg border-white/[0.08] text-zinc-300"
                  }`}
                >
                  {preset.toUpperCase()}
                </button>
              ))}
            </div>
            <input
              value={tokensInput}
              onChange={(e) => setTokensInput(e.target.value)}
              placeholder="VD: 100m hoặc 1000000"
              className="w-full h-9 px-3 rounded-xl bg-bg border border-white/[0.08] font-mono text-[12.5px] text-zinc-100 focus:outline-none focus:border-white/25"
            />
          </div>

          <div className="grid grid-cols-2 gap-2.5">
            <div>
              <label className="block text-[11.5px] text-zinc-400 mb-1">RPM</label>
              <input
                type="number"
                min="1"
                value={rpmInput}
                onChange={(e) => setRpmInput(e.target.value)}
                className="w-full h-9 px-3 rounded-xl bg-bg border border-white/[0.08] font-mono text-[12.5px] text-zinc-100"
              />
            </div>
            <div>
              <label className="block text-[11.5px] text-zinc-400 mb-1">Số ngày (0 = vĩnh viễn)</label>
              <input
                type="number"
                min="0"
                value={daysInput}
                onChange={(e) => setDaysInput(e.target.value)}
                className="w-full h-9 px-3 rounded-xl bg-bg border border-white/[0.08] font-mono text-[12.5px] text-zinc-100"
              />
            </div>
          </div>

          {(meInfo?.role === "SUPPLIER" || (Array.isArray(meInfo?.scopes) && meInfo.scopes.includes("stock"))) ? (
            <div className="space-y-2">
              <label className="block text-[11.5px] text-zinc-400">
                Telegram ID khách (bỏ trống nếu chỉ quản lý tại đây)
              </label>
              <input
                value={custTgId}
                onChange={(e) => setCustTgId(e.target.value)}
                placeholder="VD: 5912345678"
                className="w-full h-9 px-3 rounded-xl bg-bg border border-white/[0.08] font-mono text-[12.5px] text-zinc-100"
              />
              {custTgId.trim() && (
                <label className="flex items-center gap-2 text-[12px] text-zinc-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={notifyBot}
                    onChange={(e) => setNotifyBot(e.target.checked)}
                  />
                  Tự động nhắn Key qua Bot cho Telegram ID này
                </label>
              )}
            </div>
          ) : (
            <div className="px-3 py-2 rounded-xl bg-bg border border-white/[0.06] text-[11.5px] text-zinc-400">
              Key tạo xong sẽ hiển thị 1 lần ngay tại đây để bạn sao chép gửi cho khách của mình.
            </div>
          )}

          {createQuote?.error ? (
            <div className="px-3 py-2 rounded-xl bg-bg border border-rose-500/30 text-[12px] text-rose-400">
              {createQuote.error}
            </div>
          ) : createQuote ? (
            <div className="px-3.5 py-2.5 rounded-xl bg-bg border border-white/[0.07] flex items-center justify-between text-[12.5px] tabular">
              <span className="text-zinc-400">Tạm tính trừ ví</span>
              <span className="font-mono font-semibold text-zinc-100">
                {quotingCreate ? "..." : `${formatUsd(createQuote.priceUsd)} · ${formatVnd(createQuote.priceVnd)}`}
              </span>
            </div>
          ) : null}

          <button
            type="submit"
            disabled={creating || Boolean(createQuote?.error) || createQuote?.canPay === false}
            className="w-full h-10 rounded-xl bg-zinc-100 hover:bg-white text-zinc-950 font-semibold text-[13px] disabled:opacity-45"
          >
            {creating
              ? "Đang cấp Key..."
              : createQuote?.canPay === false
                ? `Thiếu ${formatVnd(createQuote.shortfall || 0)} trong ví`
                : "Xác nhận tạo Key Seller"}
          </button>
        </form>
      )}

      {/* Bộ lọc & tìm kiếm danh sách */}
      <div className="space-y-2.5">
        <div className="flex gap-1.5 overflow-x-auto no-scrollbar pb-0.5">
          {[
            { id: "visible", label: "Đang quản lý" },
            { id: "active", label: "Đang chạy" },
            { id: "dead", label: "Hết / Cạn" },
            { id: "disabled", label: "Đã tắt" },
            { id: "hidden", label: "Đã thu hồi" },
          ].map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => setFilter(f.id)}
              className={`h-8 px-3 rounded-full text-[12px] font-medium whitespace-nowrap transition-colors ${
                filter === f.id
                  ? "bg-zinc-100 text-zinc-950"
                  : "bg-card border border-white/[0.07] text-zinc-400 hover:text-zinc-200"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>

        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Tìm theo key che, server, Telegram ID..."
          className="w-full h-9 px-3.5 rounded-xl bg-card border border-white/[0.08] text-[12.5px] text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:border-white/25"
        />
      </div>

      {/* Danh sách Key đã cấp */}
      {loading && keys.length === 0 ? (
        <div className="py-10 text-center text-[13px] text-zinc-500">
          Đang tải danh sách key Seller...
        </div>
      ) : visibleKeys.length === 0 ? (
        <div className="rounded-2xl bg-card border border-white/[0.07] py-10 px-5 text-center text-[13px] text-zinc-400">
          Không có Key Seller nào trong mục này.
        </div>
      ) : (
        <div className="space-y-3">
          {visibleKeys.map((k) => {
            const stKey = k.live?.status || "unknown";
            const stMeta = STATUS_META[stKey] || STATUS_META.unknown;
            const currentlyDisabled = stKey === "disabled" || k.live?.enabled === false;
            const hasLiveQuota =
              k.live?.live && !k.live?.unlimitedQuota && Number(k.live?.quotaTokensLive) > 0;
            const pct = Math.min(100, Math.max(0, Number(k.live?.usedPct ?? 0)));

            return (
              <div key={k.id} className="rounded-2xl bg-card border border-white/[0.08] p-4 space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-mono text-[13px] font-medium text-zinc-100 break-all">
                      {k.key}
                    </div>
                    <div className="flex items-center gap-2 text-[11px] font-mono text-zinc-500 mt-1 flex-wrap">
                      {k.profileName && <span>{k.profileName}</span>}
                      <span>· {k.rpm || "—"} RPM</span>
                      <span>· {k.expiresAt ? formatDateTime(k.expiresAt) : "Vĩnh viễn"}</span>
                      {k.telegramId && <span>· TG {k.telegramId}</span>}
                    </div>
                  </div>
                  <span className={`inline-flex items-center gap-1.5 text-[11.5px] font-mono shrink-0 ${stMeta.cls}`}>
                    <span className={`w-1.5 h-1.5 rounded-full ${stMeta.dot}`} />
                    {k.hidden ? "Đã thu hồi" : stMeta.label}
                  </span>
                </div>

                {hasLiveQuota && (
                  <div className="space-y-1 tabular">
                    <div className="h-1.5 rounded-full bg-bg overflow-hidden">
                      <div
                        className={`h-full rounded-full ${
                          pct >= 95 ? "bg-rose-400" : pct >= 80 ? "bg-amber-400" : "bg-zinc-100"
                        }`}
                        style={{ width: `${Math.max(2, pct)}%` }}
                      />
                    </div>
                    <div className="flex justify-between text-[11px] font-mono text-zinc-400">
                      <span>Đã dùng {formatTokensCompact(k.live.usedTokensLive)}</span>
                      <span>Tổng {formatTokensCompact(k.live.quotaTokensLive)}</span>
                    </div>
                  </div>
                )}

                {!k.hidden && (
                  <div className="flex flex-wrap gap-2 pt-0.5">
                    <button
                      type="button"
                      onClick={() => {
                        setRenewTarget(k);
                        setAddM(50);
                        setAddDays(0);
                      }}
                      className="flex-1 h-8 px-2.5 rounded-lg bg-zinc-100 hover:bg-white text-zinc-950 text-[12px] font-semibold inline-flex items-center justify-center gap-1"
                    >
                      <RefreshCw className="w-3 h-3" />
                      Gia hạn
                    </button>
                    <button
                      type="button"
                      disabled={togglingId === k.id}
                      onClick={() => handleToggleEnabled(k)}
                      className="h-8 px-3 rounded-lg bg-elevated hover:bg-subtle border border-white/[0.08] text-zinc-200 text-[12px] font-medium inline-flex items-center gap-1 disabled:opacity-50"
                    >
                      <Power className="w-3 h-3" />
                      {togglingId === k.id ? "..." : currentlyDisabled ? "Mở lại" : "Tắt tạm"}
                    </button>
                    {confirmRevokeId === k.id ? (
                      <div className="w-full flex gap-1.5 pt-1">
                        <button
                          type="button"
                          disabled={revokingId === k.id}
                          onClick={() => handleRevoke(k, true)}
                          className="flex-1 h-8 rounded-lg bg-rose-500/20 border border-rose-500/40 text-rose-300 text-[11.5px] font-semibold"
                        >
                          {revokingId === k.id ? "Đang xử lý..." : "Thu hồi & ẩn"}
                        </button>
                        <button
                          type="button"
                          disabled={revokingId === k.id}
                          onClick={() => handleRevoke(k, false)}
                          className="h-8 px-2.5 rounded-lg bg-elevated border border-white/[0.08] text-zinc-300 text-[11.5px]"
                        >
                          Chỉ ẩn
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmRevokeId("")}
                          className="h-8 px-2.5 rounded-lg bg-bg border border-white/[0.08] text-zinc-400 text-[11.5px]"
                        >
                          Hủy
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setConfirmRevokeId(k.id)}
                        className="h-8 px-3 rounded-lg bg-elevated hover:bg-subtle border border-white/[0.08] text-rose-400 text-[12px] font-medium inline-flex items-center gap-1"
                      >
                        <Trash2 className="w-3 h-3" />
                        Thu hồi
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Sheet Gia hạn Key Seller */}
      {renewTarget && (
        <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/80 backdrop-blur-sm">
          <div className="w-full max-w-lg bg-card border-t border-white/10 rounded-t-[24px] px-5 pt-3 pb-safe-sheet space-y-4">
            <div className="w-9 h-1 rounded-full bg-zinc-700/80 mx-auto" />
            <div className="flex items-start justify-between gap-2">
              <div>
                <h3 className="text-[16px] font-semibold text-zinc-100">Gia hạn Key Seller</h3>
                <p className="font-mono text-[12px] text-zinc-400 mt-0.5">{renewTarget.key}</p>
              </div>
              <button
                type="button"
                onClick={() => setRenewTarget(null)}
                className="w-8 h-8 rounded-full bg-elevated text-zinc-400 flex items-center justify-center"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-1.5">
              <div className="text-[12px] text-zinc-400">Nạp thêm Token (M)</div>
              <div className="grid grid-cols-5 gap-1.5">
                {[0, 50, 100, 200, 500].map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setAddM(m)}
                    className={`h-9 rounded-xl border font-mono text-[12px] ${
                      addM === m ? "bg-zinc-100 border-zinc-100 text-zinc-950 font-semibold" : "bg-bg border-white/[0.08] text-zinc-300"
                    }`}
                  >
                    {m === 0 ? "0" : `+${m}M`}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-1.5">
              <div className="text-[12px] text-zinc-400">Cộng thêm Số ngày</div>
              <div className="grid grid-cols-5 gap-1.5">
                {[0, 1, 7, 30, 90].map((d) => (
                  <button
                    key={d}
                    type="button"
                    onClick={() => setAddDays(d)}
                    className={`h-9 rounded-xl border font-mono text-[12px] ${
                      addDays === d ? "bg-zinc-100 border-zinc-100 text-zinc-950 font-semibold" : "bg-bg border-white/[0.08] text-zinc-300"
                    }`}
                  >
                    {d === 0 ? "0" : `+${d}d`}
                  </button>
                ))}
              </div>
            </div>

            {renewQuote?.error ? (
              <div className="p-3 rounded-xl bg-bg border border-rose-500/30 text-[12px] text-rose-400">
                {renewQuote.error}
              </div>
            ) : renewQuote ? (
              <div className="px-3.5 py-2.5 rounded-xl bg-bg border border-white/[0.08] flex items-center justify-between tabular">
                <span className="text-[12.5px] text-zinc-400">Chi phí gia hạn</span>
                <span className="font-mono font-semibold text-zinc-100">
                  {quotingRenew ? "..." : `${formatUsd(renewQuote.priceUsd)} · ${formatVnd(renewQuote.priceVnd)}`}
                </span>
              </div>
            ) : null}

            <button
              type="button"
              disabled={renewing || !renewQuote || Boolean(renewQuote?.error) || renewQuote?.canPay === false}
              onClick={handleRenewSubmit}
              className="w-full h-11 rounded-xl bg-zinc-100 hover:bg-white text-zinc-950 font-semibold text-[13.5px] disabled:opacity-45"
            >
              {renewing
                ? "Đang gia hạn..."
                : renewQuote?.canPay === false
                  ? `Ví thiếu ${formatVnd(renewQuote.shortfall || 0)}`
                  : "Xác nhận gia hạn từ Ví"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
