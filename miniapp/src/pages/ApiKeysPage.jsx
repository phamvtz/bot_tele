import React, { useEffect, useState } from "react";
import {
  KeyRound,
  PlusCircle,
  Copy,
  Eye,
  RefreshCw,
  Server,
  Gauge,
  Calendar,
  Wallet,
  QrCode,
  Coins,
  X,
  Loader2,
} from "lucide-react";
import { tmaFetch, makeClientRef } from "../lib/api.js";
import { formatUsd, formatVnd, formatTokensCompact, formatDateTime } from "../lib/format.js";
import { copyToClipboard, hapticImpact, hapticNotify } from "../lib/telegram.js";
import { useToast } from "../components/Toast.jsx";

export default function ApiKeysPage({
  shop,
  balanceVnd = 0,
  initialSubTab = "buy",
  initialRenewKeyId = "",
  onKeyDelivered,
  onPendingPayment,
  onGoTopup,
}) {
  const [subTab, setSubTab] = useState(initialSubTab);
  const [profiles, setProfiles] = useState([]);
  const [loadingProfiles, setLoadingProfiles] = useState(true);

  // Builder state
  const [profileId, setProfileId] = useState(null);
  const [tokensInput, setTokensInput] = useState("10m");
  const [rpmInput, setRpmInput] = useState("");
  const [daysInput, setDaysInput] = useState("");
  const [quote, setQuote] = useState(null);
  const [quoting, setQuoting] = useState(false);
  const [submitting, setSubmitting] = useState("");

  // My keys state
  const [myKeysData, setMyKeysData] = useState(null);
  const [keyFilter, setKeyFilter] = useState("all");
  const [loadingKeys, setLoadingKeys] = useState(false);
  const [revealedMap, setRevealedMap] = useState({});

  // Renew sheet state
  const [renewTarget, setRenewTarget] = useState(null);
  const [addM, setAddM] = useState(50);
  const [addDays, setAddDays] = useState(0);
  const [wantRpm, setWantRpm] = useState(0);
  const [renewQuote, setRenewQuote] = useState(null);
  const [renewQuoting, setRenewQuoting] = useState(false);
  const [renewSubmitting, setRenewSubmitting] = useState("");

  const { showToast } = useToast();

  useEffect(() => {
    if (initialRenewKeyId) setSubTab("mine");
  }, [initialRenewKeyId]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoadingProfiles(true);
      try {
        const res = await tmaFetch("/apikey/profiles");
        if (cancelled) return;
        const list = res.profiles || [];
        setProfiles(list);
        if (list.length > 0) {
          const first = list[0];
          setProfileId(first.profileId);
          setRpmInput(String(first.defaultRpm || 100));
          setDaysInput(String(first.defaultValidDays ?? 30));
        }
      } catch (err) {
        if (!cancelled) showToast(err.message, "error");
      } finally {
        if (!cancelled) setLoadingProfiles(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const activeProfile = profiles.find((p) => p.profileId === profileId) || profiles[0] || null;

  // Live quote khi đổi thông số mua mới
  useEffect(() => {
    if (subTab !== "buy" || !activeProfile) return undefined;
    let cancelled = false;
    setQuoting(true);
    const timer = setTimeout(async () => {
      try {
        const res = await tmaFetch("/apikey/quote", {
          method: "POST",
          body: {
            profileId: activeProfile.profileId,
            tokens: tokensInput,
            rpm: rpmInput,
            validDays: daysInput,
          },
        });
        if (!cancelled) setQuote(res);
      } catch {
        if (!cancelled) setQuote(null);
      } finally {
        if (!cancelled) setQuoting(false);
      }
    }, 180);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [subTab, activeProfile?.profileId, tokensInput, rpmInput, daysInput]);

  const loadMyKeys = async (f = keyFilter) => {
    setLoadingKeys(true);
    try {
      const res = await tmaFetch(`/apikey/my-keys?filter=${encodeURIComponent(f)}`);
      setMyKeysData(res);
      if (initialRenewKeyId && !renewTarget) {
        const found = (res.keys || []).find((k) => k.id === initialRenewKeyId);
        if (found) openRenewSheet(found);
      }
    } catch (err) {
      showToast(err.message, "error");
    } finally {
      setLoadingKeys(false);
    }
  };

  useEffect(() => {
    if (subTab === "mine") {
      loadMyKeys(keyFilter);
    }
  }, [subTab, keyFilter]);

  const openRenewSheet = (k) => {
    setRenewTarget(k);
    if (k.expired) {
      setAddM(0);
      setAddDays(30);
    } else {
      setAddM(50);
      setAddDays(0);
    }
    setWantRpm(0);
    setRenewQuote(null);
  };

  useEffect(() => {
    if (!renewTarget) return undefined;
    if (addM <= 0 && addDays <= 0 && wantRpm <= 0) {
      setRenewQuote(null);
      return undefined;
    }
    let cancelled = false;
    setRenewQuoting(true);
    const timer = setTimeout(async () => {
      try {
        const res = await tmaFetch(`/apikey/keys/${renewTarget.id}/renew-quote`, {
          method: "POST",
          body: { addM, addDays, wantRpm },
        });
        if (!cancelled) setRenewQuote(res);
      } catch (err) {
        if (!cancelled) {
          setRenewQuote({ error: err.message });
        }
      } finally {
        if (!cancelled) setRenewQuoting(false);
      }
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [renewTarget?.id, addM, addDays, wantRpm]);

  const handleBuyKey = async (method) => {
    if (!activeProfile) return;
    hapticImpact("medium");
    setSubmitting(method);
    try {
      const res = await tmaFetch("/apikey/checkout", {
        method: "POST",
        body: {
          profileId: activeProfile.profileId,
          tokens: tokensInput,
          rpm: rpmInput,
          validDays: daysInput,
          paymentMethod: method,
          clientRef: makeClientRef("key"),
        },
      });
      if (method === "wallet") {
        hapticNotify("success");
        onKeyDelivered?.({
          orderId: res.orderId,
          shortId: res.shortId,
          title: "Cấp API Key thành công!",
          apiKey: res.apiKey,
          newBalance: res.newBalance,
        });
      } else if (res.payment) {
        onPendingPayment?.({
          mode: "order",
          targetId: res.orderId,
          shortId: res.shortId,
          title: `Mua API Key (${tokensInput.toUpperCase()})`,
          amountVnd: res.finalAmountVnd,
          payment: res.payment,
        });
      }
    } catch (err) {
      if (err.code !== "CHANNEL_JOIN_REQUIRED") {
        hapticNotify("error");
        showToast(err.message, "error");
      }
    } finally {
      setSubmitting("");
    }
  };

  const handleRevealAndCopy = async (keyRow, copyOnly = true) => {
    try {
      let full = revealedMap[keyRow.id];
      if (!full) {
        const res = await tmaFetch(`/apikey/keys/${keyRow.id}/reveal`);
        full = res.key;
        setRevealedMap((m) => ({ ...m, [keyRow.id]: full }));
      }
      if (copyOnly) {
        await copyToClipboard(full);
        showToast("Đã sao chép chuỗi sk-... đầy đủ!", "success");
      }
    } catch (err) {
      showToast(err.message, "error");
    }
  };

  const handleRenewCheckout = async (method) => {
    if (!renewTarget) return;
    hapticImpact("medium");
    setRenewSubmitting(method);
    try {
      const res = await tmaFetch(`/apikey/keys/${renewTarget.id}/renew-checkout`, {
        method: "POST",
        body: {
          addM,
          addDays,
          wantRpm,
          paymentMethod: method,
          clientRef: makeClientRef("rnw"),
        },
      });
      if (method === "wallet") {
        hapticNotify("success");
        setRenewTarget(null);
        showToast("Gia hạn API Key thành công! Key giữ nguyên không cần đổi.", "success");
        loadMyKeys(keyFilter);
        onKeyDelivered?.({
          orderId: res.orderId,
          shortId: res.shortId,
          title: "Gia hạn API Key thành công!",
          subtitle: "Quota / Hạn dùng đã được cộng trực tiếp vào mã sk-... hiện tại của bạn.",
          newBalance: res.newBalance,
        });
      } else if (res.payment) {
        setRenewTarget(null);
        onPendingPayment?.({
          mode: "order",
          targetId: res.orderId,
          shortId: res.shortId,
          title: "Gia hạn API Key",
          amountVnd: res.finalAmountVnd,
          payment: res.payment,
        });
      }
    } catch (err) {
      if (err.code !== "CHANNEL_JOIN_REQUIRED") {
        hapticNotify("error");
        showToast(err.message, "error");
      }
    } finally {
      setRenewSubmitting("");
    }
  };

  const canPayWallet = (quote?.balanceVnd ?? balanceVnd) >= (quote?.priceVnd ?? Infinity);

  return (
    <div className="space-y-4">
      {/* Sub-tab Switcher */}
      <div className="grid grid-cols-2 gap-1.5 p-1 rounded-2xl bg-surface-card border border-white/10">
        <button
          type="button"
          onClick={() => {
            hapticImpact("light");
            setSubTab("buy");
          }}
          className={`py-2.5 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition-all ${
            subTab === "buy" ? "bg-indigo-600 text-white shadow-md" : "text-slate-400"
          }`}
        >
          <PlusCircle className="w-4 h-4" /> Tạo API Key
        </button>
        <button
          type="button"
          onClick={() => {
            hapticImpact("light");
            setSubTab("mine");
          }}
          className={`py-2.5 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition-all ${
            subTab === "mine" ? "bg-indigo-600 text-white shadow-md" : "text-slate-400"
          }`}
        >
          <KeyRound className="w-4 h-4" /> Key của tôi
        </button>
      </div>

      {/* SUB-TAB 1: TẠO KEY MỚI */}
      {subTab === "buy" && (
        <div className="space-y-3.5">
          {loadingProfiles ? (
            <div className="p-8 text-center text-xs text-slate-400">Đang tải cấu hình máy chủ AI...</div>
          ) : profiles.length === 0 ? (
            <div className="rounded-2xl bg-surface-card border border-white/10 p-6 text-center text-xs text-slate-400">
              Cửa hàng API Key hiện đang tạm đóng hoặc bảo trì.
            </div>
          ) : (
            <>
              {/* Bước 1: Chọn Server */}
              {profiles.length > 1 && (
                <div className="rounded-2xl bg-surface-card border border-white/10 p-3.5 space-y-2.5">
                  <div className="flex items-center gap-1.5 text-xs font-bold text-slate-200">
                    <Server className="w-4 h-4 text-indigo-400" />
                    <span>Chọn Máy chủ (Server)</span>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    {profiles.map((p) => (
                      <button
                        key={p.profileId}
                        type="button"
                        onClick={() => {
                          setProfileId(p.profileId);
                          setRpmInput(String(p.defaultRpm || 100));
                          setDaysInput(String(p.defaultValidDays ?? 30));
                        }}
                        className={`p-3 rounded-xl border text-left transition-all ${
                          activeProfile?.profileId === p.profileId
                            ? "bg-indigo-500/20 border-indigo-400 text-white"
                            : "bg-canvas-900 border-white/10 text-slate-300"
                        }`}
                      >
                        <div className="text-xs font-bold truncate">{p.name}</div>
                        <div className="text-[11px] text-emerald-400 font-semibold mt-0.5">
                          ${p.usdPerMtoken}/1M token
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Bước 2: Chọn lượng Token */}
              <div className="rounded-2xl bg-surface-card border border-white/10 p-3.5 space-y-2.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-bold text-slate-200">1. Lượng Quota Token</span>
                  <span className="text-emerald-400 font-semibold">
                    Đơn giá: ${activeProfile.usdPerMtoken}/1M
                  </span>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  {(activeProfile.buyPresetsM || [5, 10, 20, 50, 100, 200]).slice(0, 6).map((m) => {
                    const val = `${m}m`;
                    return (
                      <button
                        key={m}
                        type="button"
                        onClick={() => {
                          hapticImpact("light");
                          setTokensInput(val);
                        }}
                        className={`py-2 rounded-xl border text-xs font-bold ${
                          tokensInput.toLowerCase() === val
                            ? "bg-indigo-500/20 border-indigo-400 text-indigo-200"
                            : "bg-canvas-900 border-white/10 text-slate-300"
                        }`}
                      >
                        {m >= 1000 ? `${m / 1000}B` : `${m}M`} token
                      </button>
                    );
                  })}
                </div>
                <input
                  type="text"
                  value={tokensInput}
                  onChange={(e) => setTokensInput(e.target.value)}
                  placeholder="Nhập tùy ý: 15m, 250m, 1b..."
                  className="w-full px-3 py-2 rounded-xl bg-canvas-900 border border-white/10 text-xs font-mono text-white focus:outline-none focus:border-indigo-500"
                />
              </div>

              {/* Bước 3: Chọn RPM & Số Ngày */}
              <div className="grid grid-cols-1 gap-3">
                <div className="rounded-2xl bg-surface-card border border-white/10 p-3.5 space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-bold text-slate-200 flex items-center gap-1.5">
                      <Gauge className="w-3.5 h-3.5 text-sky-400" /> 2. Giới hạn RPM (lượt/phút)
                    </span>
                    <span className="text-[11px] text-slate-400">Gồm sẵn {activeProfile.rpmIncluded} RPM</span>
                  </div>
                  <div className="flex gap-2 overflow-x-auto no-scrollbar">
                    {(activeProfile.rpmPresets || [100, 300, 600, 1200]).map((r) => (
                      <button
                        key={r}
                        type="button"
                        onClick={() => setRpmInput(String(r))}
                        className={`px-3 py-1.5 rounded-xl border text-xs font-bold whitespace-nowrap ${
                          Number(rpmInput) === r
                            ? "bg-sky-500/20 border-sky-400 text-sky-200"
                            : "bg-canvas-900 border-white/10 text-slate-300"
                        }`}
                      >
                        {r} RPM
                      </button>
                    ))}
                  </div>
                </div>

                <div className="rounded-2xl bg-surface-card border border-white/10 p-3.5 space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-bold text-slate-200 flex items-center gap-1.5">
                      <Calendar className="w-3.5 h-3.5 text-amber-400" /> 3. Thời hạn sử dụng
                    </span>
                  </div>
                  <div className="flex gap-2 flex-wrap">
                    {[...(activeProfile.daysPresets || [1, 3, 7, 30, 90]), 0].map((d) => (
                      <button
                        key={d}
                        type="button"
                        onClick={() => setDaysInput(String(d))}
                        className={`px-3 py-1.5 rounded-xl border text-xs font-bold ${
                          Number(daysInput) === d && daysInput !== ""
                            ? "bg-amber-500/20 border-amber-400 text-amber-200"
                            : "bg-canvas-900 border-white/10 text-slate-300"
                        }`}
                      >
                        {d === 0 ? "∞ Vĩnh viễn" : `${d} ngày`}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Bảng Báo Giá Realtime */}
              <div className="rounded-2xl bg-canvas-950 border border-indigo-500/30 p-4 space-y-2 text-xs">
                <div className="flex justify-between text-slate-400">
                  <span>Cấu hình đã chọn</span>
                  <span className="font-semibold text-white">
                    {quote ? formatTokensCompact(quote.tokens) : tokensInput} · {rpmInput || activeProfile.defaultRpm} RPM ·{" "}
                    {Number(daysInput) === 0 ? "Vĩnh viễn" : `${daysInput} ngày`}
                  </span>
                </div>
                {quote?.breakdown && (
                  <div className="flex justify-between text-slate-400">
                    <span>Hệ số RPM × Ngày</span>
                    <span>
                      ×{Number(quote.breakdown.rpmMult || 1).toFixed(2)} · ×
                      {Number(quote.breakdown.dayMult || 1).toFixed(2)}
                    </span>
                  </div>
                )}
                {quote?.discountPct > 0 && (
                  <div className="flex justify-between text-emerald-400 font-semibold">
                    <span>
                      {quote.discountKind === "vip" ? "👑 Ưu đãi VIP" : "⚡ Flash Sale"} (−
                      {quote.discountPct}%)
                    </span>
                    <span>
                      <s>{formatUsd(quote.listPriceUsd)}</s> → {formatUsd(quote.priceUsd)}
                    </span>
                  </div>
                )}
                <div className="pt-2 border-t border-white/10 flex items-baseline justify-between">
                  <span className="font-bold text-slate-200">Thành tiền</span>
                  <div className="text-right">
                    <span className="text-lg font-extrabold text-emerald-400">
                      {quoting || !quote ? "..." : formatUsd(quote.priceUsd)}
                    </span>
                    {quote && (
                      <span className="text-xs text-slate-400 ml-1.5">
                        (≈ {formatVnd(quote.priceVnd)})
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {/* Nút Thanh Toán */}
              {quote && (
                <div className="space-y-2">
                  {canPayWallet ? (
                    <button
                      type="button"
                      disabled={Boolean(submitting)}
                      onClick={() => handleBuyKey("wallet")}
                      className="w-full py-3.5 rounded-2xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-sm flex items-center justify-center gap-2 shadow-lg shadow-indigo-600/25 disabled:opacity-50"
                    >
                      {submitting === "wallet" ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <Wallet className="w-4 h-4" />
                      )}
                      Trừ Ví · Nhận Key ngay ({formatVnd(quote.priceVnd)})
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => onGoTopup?.(quote.shortfallVnd)}
                      className="w-full py-3 rounded-2xl bg-amber-500/15 border border-amber-400/35 text-amber-200 font-semibold text-xs"
                    >
                      Ví thiếu {formatVnd(quote.shortfallVnd)} · Bấm nạp thêm hoặc trả QR bên dưới
                    </button>
                  )}

                  {shop?.payments?.vietqr && (
                    <button
                      type="button"
                      disabled={Boolean(submitting)}
                      onClick={() => handleBuyKey("vietqr")}
                      className="w-full py-3 rounded-2xl bg-surface-card hover:bg-surface-elevated border border-white/10 text-slate-100 font-semibold text-xs flex items-center justify-center gap-2"
                    >
                      <QrCode className="w-4 h-4 text-sky-400" /> Thanh toán bằng QR Ngân hàng
                    </button>
                  )}

                  {Array.isArray(shop?.payments?.cryptoNetworks) && shop.payments.cryptoNetworks.length > 0 && (
                    <div className="grid grid-cols-2 gap-2">
                      {shop.payments.cryptoNetworks.map((net) => (
                        <button
                          key={net.key}
                          type="button"
                          disabled={Boolean(submitting)}
                          onClick={() => handleBuyKey(net.method)}
                          className="py-2.5 rounded-xl bg-surface-card border border-white/10 text-emerald-300 font-semibold text-xs flex items-center justify-center gap-1.5"
                        >
                          <Coins className="w-3.5 h-3.5" /> USDT {net.label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* SUB-TAB 2: KEY CỦA TÔI */}
      {subTab === "mine" && (
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div className="flex gap-1.5 overflow-x-auto no-scrollbar">
              {[
                { id: "all", label: "Tất cả" },
                { id: "active", label: "Còn dùng" },
                { id: "low", label: "Sắp hết" },
                { id: "expired", label: "Đã hết" },
              ].map((f) => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => setKeyFilter(f.id)}
                  className={`px-3 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap border ${
                    keyFilter === f.id
                      ? "bg-indigo-600 border-indigo-400 text-white"
                      : "bg-surface-card border-white/10 text-slate-400"
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => loadMyKeys(keyFilter)}
              className="p-2 rounded-xl bg-surface-card border border-white/10 text-slate-300 shrink-0"
            >
              <RefreshCw className={`w-4 h-4 ${loadingKeys ? "animate-spin" : ""}`} />
            </button>
          </div>

          {myKeysData?.endpoint && (
            <div className="px-3.5 py-2.5 rounded-2xl bg-canvas-950 border border-white/10 flex items-center justify-between gap-2 text-xs">
              <span className="text-slate-400 truncate font-mono">Base: {myKeysData.endpoint}</span>
              <button
                type="button"
                onClick={async () => {
                  await copyToClipboard(myKeysData.endpoint);
                  showToast("Đã sao chép API Base URL!", "success");
                }}
                className="text-indigo-300 font-bold shrink-0"
              >
                Copy URL
              </button>
            </div>
          )}

          {loadingKeys ? (
            <div className="py-10 text-center text-xs text-slate-400">Đang đồng bộ quota thực tế...</div>
          ) : !myKeysData?.keys?.length ? (
            <div className="rounded-2xl bg-surface-card border border-white/10 p-8 text-center space-y-2">
              <KeyRound className="w-8 h-8 text-slate-500 mx-auto" />
              <p className="text-xs text-slate-400">Chưa có API Key nào trong mục này.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {myKeysData.keys.map((k) => {
                const barColor = k.dead
                  ? "bg-rose-500"
                  : k.usedPct >= 80
                    ? "bg-amber-400"
                    : "bg-emerald-400";
                const revealed = revealedMap[k.id];

                return (
                  <div
                    key={k.id}
                    className="rounded-2xl bg-surface-card border border-white/10 p-4 space-y-3"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="font-mono text-xs font-bold text-emerald-300 break-all">
                          {revealed || k.maskedKey}
                        </div>
                        <div className="flex items-center gap-2 text-[11px] text-slate-400 mt-1 flex-wrap">
                          {k.profileName && <span>🖥 {k.profileName}</span>}
                          <span>⚡ {k.rpm || "—"} RPM</span>
                          <span>
                            ⏳ {k.expiresAt ? formatDateTime(k.expiresAt) : "Không hết hạn"}
                          </span>
                        </div>
                      </div>
                      <span
                        className={`px-2 py-0.5 rounded-md text-[10px] font-bold shrink-0 ${
                          k.dead
                            ? "bg-rose-500/20 text-rose-300"
                            : k.usedPct >= 80
                              ? "bg-amber-500/20 text-amber-300"
                              : "bg-emerald-500/20 text-emerald-300"
                        }`}
                      >
                        {k.dead ? "Đã hết" : k.unlimitedQuota ? "Vô hạn" : `Đã dùng ${k.usedPct}%`}
                      </span>
                    </div>

                    {/* Quota bar */}
                    {!k.unlimitedQuota && (
                      <div className="space-y-1">
                        <div className="h-2 rounded-full bg-canvas-950 overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all ${barColor}`}
                            style={{ width: `${Math.min(100, Math.max(3, k.usedPct))}%` }}
                          />
                        </div>
                        <div className="flex justify-between text-[11px] text-slate-400">
                          <span>Đã dùng: {formatTokensCompact(k.usedTokens)}</span>
                          <span>Tổng: {formatTokensCompact(k.quotaTokens)} token</span>
                        </div>
                      </div>
                    )}

                    <div className="flex gap-2 pt-1">
                      <button
                        type="button"
                        onClick={() => handleRevealAndCopy(k, true)}
                        className="flex-1 py-2 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-xs font-semibold text-slate-200 flex items-center justify-center gap-1.5"
                      >
                        <Copy className="w-3.5 h-3.5" /> Copy Key
                      </button>
                      {!revealed && (
                        <button
                          type="button"
                          onClick={() => handleRevealAndCopy(k, false)}
                          className="px-3 py-2 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-xs text-slate-300"
                          title="Hiện đầy đủ"
                        >
                          <Eye className="w-3.5 h-3.5" />
                        </button>
                      )}
                      {k.canRenew && (
                        <button
                          type="button"
                          onClick={() => openRenewSheet(k)}
                          className="flex-1 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-xs font-bold text-white flex items-center justify-center gap-1.5"
                        >
                          <RefreshCw className="w-3.5 h-3.5" /> Gia hạn
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* SHEET GIA HẠN TẠI CHỖ */}
      {renewTarget && (
        <div className="fixed inset-0 z-[65] flex items-end justify-center bg-black/75 backdrop-blur-sm animate-fade-in">
          <div className="w-full max-w-lg bg-surface-card border-t border-white/15 rounded-t-3xl p-5 pb-safe-sheet max-h-[88vh] overflow-y-auto animate-sheet-up space-y-3.5">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-base font-bold text-white">Gia hạn trực tiếp trên Key cũ</h3>
                <p className="text-[11px] text-slate-400 font-mono">{renewTarget.maskedKey}</p>
              </div>
              <button
                type="button"
                onClick={() => setRenewTarget(null)}
                className="p-2 rounded-xl bg-white/5 text-slate-400"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-2">
              <div className="text-xs font-semibold text-slate-300">Nạp thêm Quota Token</div>
              <div className="grid grid-cols-5 gap-1.5">
                {[0, 50, 100, 200, 500].map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setAddM(m)}
                    className={`py-2 rounded-xl border text-xs font-bold ${
                      addM === m
                        ? "bg-indigo-500/20 border-indigo-400 text-indigo-200"
                        : "bg-canvas-900 border-white/10 text-slate-300"
                    }`}
                  >
                    {m === 0 ? "Không" : `+${m}M`}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <div className="text-xs font-semibold text-slate-300">Cộng thêm Số ngày</div>
              <div className="grid grid-cols-4 gap-1.5">
                {[0, 7, 30, 90].map((d) => (
                  <button
                    key={d}
                    type="button"
                    onClick={() => setAddDays(d)}
                    className={`py-2 rounded-xl border text-xs font-bold ${
                      addDays === d
                        ? "bg-amber-500/20 border-amber-400 text-amber-200"
                        : "bg-canvas-900 border-white/10 text-slate-300"
                    }`}
                  >
                    {d === 0 ? "Không" : `+${d} ngày`}
                  </button>
                ))}
              </div>
            </div>

            {renewQuote?.error ? (
              <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-xs text-rose-200">
                {renewQuote.error}
              </div>
            ) : renewQuote ? (
              <div className="rounded-2xl bg-canvas-950 border border-white/10 p-3.5 flex items-baseline justify-between">
                <span className="text-xs font-semibold text-slate-300">Chi phí gia hạn</span>
                <div className="text-right">
                  <span className="text-base font-extrabold text-emerald-400">
                    {renewQuoting ? "..." : formatUsd(renewQuote.priceUsd)}
                  </span>
                  <span className="text-xs text-slate-400 ml-1.5">
                    (≈ {formatVnd(renewQuote.priceVnd)})
                  </span>
                </div>
              </div>
            ) : null}

            {renewQuote && !renewQuote.error && (
              <div className="space-y-2">
                {renewQuote.canPayWallet ? (
                  <button
                    type="button"
                    disabled={Boolean(renewSubmitting)}
                    onClick={() => handleRenewCheckout("wallet")}
                    className="w-full py-3 rounded-2xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-sm flex items-center justify-center gap-2"
                  >
                    <Wallet className="w-4 h-4" /> Trừ Ví · Gia hạn ngay ({formatVnd(renewQuote.priceVnd)})
                  </button>
                ) : null}
                {shop?.payments?.vietqr && (
                  <button
                    type="button"
                    disabled={Boolean(renewSubmitting)}
                    onClick={() => handleRenewCheckout("vietqr")}
                    className="w-full py-2.5 rounded-2xl bg-canvas-900 border border-white/10 text-slate-200 font-semibold text-xs flex items-center justify-center gap-2"
                  >
                    <QrCode className="w-4 h-4 text-sky-400" /> Thanh toán gia hạn bằng QR Ngân hàng
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
