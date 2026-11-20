import React, { useEffect, useState } from "react";
import { RotateCw, X } from "lucide-react";
import { tmaFetch, makeClientRef } from "../lib/api.js";
import { formatUsd, formatVnd, formatTokensCompact, formatDateTime } from "../lib/format.js";
import { copyToClipboard, hapticImpact, hapticNotify } from "../lib/telegram.js";
import { useToast } from "../components/Toast.jsx";
import DeveloperApiPanel from "../components/DeveloperApiPanel.jsx";

export default function ApiKeysPage({
  shop,
  balanceVnd = 0,
  initialSubTab = "buy",
  initialDevMode = "connect",
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
  const [wantRpm] = useState(0);
  const [renewQuote, setRenewQuote] = useState(null);
  const [renewQuoting, setRenewQuoting] = useState(false);
  const [renewSubmitting, setRenewSubmitting] = useState("");

  const { showToast } = useToast();

  useEffect(() => {
    if (initialRenewKeyId) setSubTab("mine");
  }, [initialRenewKeyId]);

  useEffect(() => {
    if (initialSubTab) setSubTab(initialSubTab);
  }, [initialSubTab]);

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
          title: "Cấp API Key thành công",
          apiKey: res.apiKey,
          newBalance: res.newBalance,
        });
      } else if (res.payment) {
        onPendingPayment?.({
          mode: "order",
          targetId: res.orderId,
          shortId: res.shortId,
          title: `API Key (${tokensInput.toUpperCase()})`,
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
        showToast("Đã sao chép API Key", "success");
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
        showToast("Đã gia hạn API Key", "success");
        loadMyKeys(keyFilter);
        onKeyDelivered?.({
          orderId: res.orderId,
          shortId: res.shortId,
          title: "Gia hạn thành công",
          subtitle: "Quota và thời hạn đã được cộng trực tiếp vào chuỗi sk-... hiện tại của bạn.",
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
    <div className="space-y-5">
      {/* Header + Segmented Switcher */}
      <div className="space-y-3 pt-1">
        <h1 className="text-[19px] font-semibold tracking-[-0.03em] text-zinc-100">API Keys</h1>
        <div className="grid grid-cols-3 gap-1 p-1 rounded-xl bg-card border border-white/[0.08]">
          {[
            { id: "buy", label: "Tạo Key mới" },
            { id: "mine", label: "Key của tôi" },
            { id: "api", label: "API Kết nối" },
          ].map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => {
                hapticImpact("light");
                setSubTab(tab.id);
              }}
              className={`h-9 px-1 rounded-lg text-[12.5px] font-medium truncate transition-colors ${
                subTab === tab.id ? "bg-zinc-100 text-zinc-950 font-semibold" : "text-zinc-400"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* SUB-TAB 1: TẠO KEY MỚI */}
      {subTab === "buy" && (
        <div className="space-y-4">
          {loadingProfiles ? (
            <div className="py-12 text-center text-[13px] text-zinc-500">
              Đang tải cấu hình máy chủ...
            </div>
          ) : profiles.length === 0 ? (
            <div className="rounded-2xl bg-card border border-white/[0.07] py-10 px-6 text-center text-[13.5px] text-zinc-400">
              Cửa hàng API Key hiện đang tạm đóng.
            </div>
          ) : (
            <>
              {/* Chọn Server */}
              {profiles.length > 1 && (
                <div className="rounded-2xl bg-card border border-white/[0.08] p-4 space-y-2.5">
                  <div className="text-[13px] font-medium text-zinc-300">Máy chủ</div>
                  <div className="grid grid-cols-2 gap-2">
                    {profiles.map((p) => {
                      const active = activeProfile?.profileId === p.profileId;
                      return (
                        <button
                          key={p.profileId}
                          type="button"
                          onClick={() => {
                            setProfileId(p.profileId);
                            setRpmInput(String(p.defaultRpm || 100));
                            setDaysInput(String(p.defaultValidDays ?? 30));
                          }}
                          className={`p-3 rounded-xl border text-left transition-colors ${
                            active
                              ? "bg-zinc-100 border-zinc-100 text-zinc-950"
                              : "bg-bg border-white/[0.07] text-zinc-200 hover:border-white/20"
                          }`}
                        >
                          <div className="text-[13px] font-semibold truncate">{p.name}</div>
                          <div
                            className={`text-[11.5px] font-mono mt-0.5 ${
                              active ? "text-zinc-700" : "text-zinc-400"
                            }`}
                          >
                            ${p.usdPerMtoken} / 1M
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Quota Token */}
              <div className="rounded-2xl bg-card border border-white/[0.08] p-4 space-y-3">
                <div className="flex items-center justify-between text-[13px]">
                  <span className="font-medium text-zinc-200">Lượng Token</span>
                  <span className="font-mono text-zinc-400">
                    ${activeProfile.usdPerMtoken} / 1M
                  </span>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  {(activeProfile.buyPresetsM || [5, 10, 20, 50, 100, 200]).slice(0, 6).map((m) => {
                    const val = `${m}m`;
                    const active = tokensInput.toLowerCase() === val;
                    return (
                      <button
                        key={m}
                        type="button"
                        onClick={() => {
                          hapticImpact("light");
                          setTokensInput(val);
                        }}
                        className={`h-10 rounded-xl border text-[13px] font-mono transition-colors ${
                          active
                            ? "bg-zinc-100 border-zinc-100 text-zinc-950 font-semibold"
                            : "bg-bg border-white/[0.07] text-zinc-300 hover:border-white/20"
                        }`}
                      >
                        {m >= 1000 ? `${m / 1000}B` : `${m}M`}
                      </button>
                    );
                  })}
                </div>
                <input
                  type="text"
                  aria-label="Nhập lượng token tùy chọn"
                  value={tokensInput}
                  onChange={(e) => setTokensInput(e.target.value)}
                  placeholder="Nhập số lượng tùy ý (ví dụ: 15m, 250m, 1b)"
                  className="w-full h-10 px-3.5 rounded-xl bg-bg border border-white/[0.08] text-[13px] font-mono text-zinc-100 placeholder:font-sans placeholder:text-zinc-500 focus:outline-none focus:border-white/25"
                />
              </div>

              {/* RPM & Thời hạn */}
              <div className="rounded-2xl bg-card border border-white/[0.08] p-4 space-y-4">
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-[13px]">
                    <span className="font-medium text-zinc-200">Giới hạn RPM</span>
                    <span className="text-[12px] text-zinc-500 font-mono">
                      Mặc định {activeProfile.rpmIncluded} RPM
                    </span>
                  </div>
                  <div className="flex gap-2 overflow-x-auto no-scrollbar">
                    {(activeProfile.rpmPresets || [100, 300, 600, 1200]).map((r) => {
                      const active = Number(rpmInput) === r;
                      return (
                        <button
                          key={r}
                          type="button"
                          onClick={() => setRpmInput(String(r))}
                          className={`h-9 px-3.5 rounded-xl border text-[12.5px] font-mono whitespace-nowrap transition-colors ${
                            active
                              ? "bg-zinc-100 border-zinc-100 text-zinc-950 font-semibold"
                              : "bg-bg border-white/[0.07] text-zinc-300"
                          }`}
                        >
                          {r} RPM
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="pt-3 border-t border-white/[0.06] space-y-2">
                  <div className="text-[13px] font-medium text-zinc-200">Thời hạn sử dụng</div>
                  <div className="flex gap-2 flex-wrap">
                    {[...(activeProfile.daysPresets || [1, 3, 7, 30, 90]), 0].map((d) => {
                      const active = Number(daysInput) === d && daysInput !== "";
                      return (
                        <button
                          key={d}
                          type="button"
                          onClick={() => setDaysInput(String(d))}
                          className={`h-9 px-3.5 rounded-xl border text-[12.5px] font-medium transition-colors ${
                            active
                              ? "bg-zinc-100 border-zinc-100 text-zinc-950 font-semibold"
                              : "bg-bg border-white/[0.07] text-zinc-300"
                          }`}
                        >
                          {d === 0 ? "Không giới hạn" : `${d} ngày`}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>

              {/* Báo giá Realtime */}
              <div className="rounded-2xl bg-card border border-white/[0.08] p-4 space-y-2 text-[13px] tabular">
                <div className="flex justify-between text-zinc-400">
                  <span>Cấu hình</span>
                  <span className="font-mono text-zinc-200">
                    {quote ? formatTokensCompact(quote.tokens) : tokensInput} ·{" "}
                    {rpmInput || activeProfile.defaultRpm} RPM ·{" "}
                    {Number(daysInput) === 0 ? "Vĩnh viễn" : `${daysInput}d`}
                  </span>
                </div>
                {quote?.breakdown && (
                  <div className="flex justify-between text-zinc-400">
                    <span>Hệ số RPM × Ngày</span>
                    <span className="font-mono">
                      ×{Number(quote.breakdown.rpmMult || 1).toFixed(2)} · ×
                      {Number(quote.breakdown.dayMult || 1).toFixed(2)}
                    </span>
                  </div>
                )}
                {quote?.discountPct > 0 && (
                  <div className="flex justify-between text-emerald-400">
                    <span>
                      {quote.discountKind === "vip" ? "Chiết khấu VIP" : "Ưu đãi Flash"} (−
                      {quote.discountPct}%)
                    </span>
                    <span className="font-mono">
                      <s>{formatUsd(quote.listPriceUsd)}</s> → {formatUsd(quote.priceUsd)}
                    </span>
                  </div>
                )}
                <div className="pt-2.5 border-t border-white/[0.07] flex items-baseline justify-between">
                  <span className="font-medium text-zinc-200">Thành tiền</span>
                  <div className="text-right font-mono">
                    <span className="text-[19px] font-semibold text-zinc-100">
                      {quoting || !quote ? "..." : formatUsd(quote.priceUsd)}
                    </span>
                    {quote && (
                      <span className="text-[12px] text-zinc-500 ml-1.5">
                        {formatVnd(quote.priceVnd)}
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {/* Thanh toán */}
              {quote && (
                <div className="space-y-2">
                  {canPayWallet ? (
                    <button
                      type="button"
                      disabled={Boolean(submitting)}
                      onClick={() => handleBuyKey("wallet")}
                      className="w-full h-11 rounded-xl bg-zinc-100 hover:bg-white text-zinc-950 font-semibold text-[14px] transition-colors disabled:opacity-50 tabular"
                    >
                      {submitting === "wallet"
                        ? "Đang cấp key..."
                        : `Thanh toán bằng Ví · ${formatVnd(quote.priceVnd)}`}
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => onGoTopup?.(quote.shortfallVnd)}
                      className="w-full h-11 rounded-xl bg-elevated hover:bg-subtle border border-white/[0.08] text-zinc-200 font-medium text-[13px] tabular"
                    >
                      Số dư thiếu {formatVnd(quote.shortfallVnd)} · Nạp thêm Ví
                    </button>
                  )}

                  {shop?.payments?.vietqr && (
                    <button
                      type="button"
                      disabled={Boolean(submitting)}
                      onClick={() => handleBuyKey("vietqr")}
                      className="w-full h-11 rounded-xl bg-card hover:bg-elevated border border-white/[0.08] text-zinc-100 font-medium text-[13.5px] transition-colors disabled:opacity-50"
                    >
                      Chuyển khoản ngân hàng (VietQR)
                    </button>
                  )}

                  {Array.isArray(shop?.payments?.cryptoNetworks) &&
                    shop.payments.cryptoNetworks.length > 0 && (
                      <div className="grid grid-cols-2 gap-2">
                        {shop.payments.cryptoNetworks.map((net) => (
                          <button
                            key={net.key}
                            type="button"
                            disabled={Boolean(submitting)}
                            onClick={() => handleBuyKey(net.method)}
                            className="h-10 rounded-xl bg-card hover:bg-elevated border border-white/[0.08] text-zinc-200 font-medium text-[13px]"
                          >
                            USDT {net.label}
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
        <div className="space-y-3.5">
          <div className="flex items-center justify-between gap-2">
            <div className="flex gap-1.5 overflow-x-auto no-scrollbar">
              {[
                { id: "all", label: "Tất cả" },
                { id: "active", label: "Đang hoạt động" },
                { id: "low", label: "Sắp cạn" },
                { id: "expired", label: "Đã hết" },
              ].map((f) => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => setKeyFilter(f.id)}
                  className={`h-8 px-3.5 rounded-full text-[12.5px] font-medium whitespace-nowrap transition-colors ${
                    keyFilter === f.id
                      ? "bg-zinc-100 text-zinc-950"
                      : "bg-card border border-white/[0.07] text-zinc-400 hover:text-zinc-200"
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>
            <button
              type="button"
              aria-label="Làm mới trạng thái key"
              onClick={() => loadMyKeys(keyFilter)}
              className="w-9 h-9 rounded-full bg-card border border-white/[0.08] text-zinc-400 hover:text-zinc-100 flex items-center justify-center shrink-0"
            >
              <RotateCw className={`w-4 h-4 ${loadingKeys ? "animate-spin" : ""}`} strokeWidth={1.75} />
            </button>
          </div>

          {myKeysData?.endpoint && (
            <div className="px-3.5 py-2.5 rounded-xl bg-card border border-white/[0.07] flex items-center justify-between gap-2 text-[12.5px]">
              <span className="text-zinc-400 truncate font-mono">{myKeysData.endpoint}</span>
              <button
                type="button"
                onClick={async () => {
                  await copyToClipboard(myKeysData.endpoint);
                  showToast("Đã sao chép API Base URL", "success");
                }}
                className="text-zinc-100 font-medium shrink-0 hover:underline"
              >
                Copy URL
              </button>
            </div>
          )}

          {loadingKeys ? (
            <div className="py-12 text-center text-[13px] text-zinc-500">
              Đang đồng bộ hạn mức...
            </div>
          ) : !myKeysData?.keys?.length ? (
            <div className="rounded-2xl bg-card border border-white/[0.07] py-12 px-6 text-center">
              <p className="text-[13.5px] text-zinc-400">Chưa có API Key nào trong mục này</p>
            </div>
          ) : (
            <div className="space-y-3">
              {myKeysData.keys.map((k) => {
                const barColor = k.dead
                  ? "bg-rose-400"
                  : k.usedPct >= 80
                    ? "bg-amber-400"
                    : "bg-zinc-100";
                const revealed = revealedMap[k.id];

                return (
                  <div
                    key={k.id}
                    className="rounded-2xl bg-card border border-white/[0.08] p-4 space-y-3.5"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="font-mono text-[13px] font-medium text-zinc-100 break-all">
                          {revealed || k.maskedKey}
                        </div>
                        <div className="flex items-center gap-2 text-[11.5px] text-zinc-500 font-mono mt-1 flex-wrap">
                          {k.profileName && <span>{k.profileName}</span>}
                          {k.profileName && <span>·</span>}
                          <span>{k.rpm || "—"} RPM</span>
                          <span>·</span>
                          <span>{k.expiresAt ? formatDateTime(k.expiresAt) : "Vĩnh viễn"}</span>
                        </div>
                      </div>
                      <span
                        className={`inline-flex items-center gap-1.5 text-[11.5px] font-mono shrink-0 ${
                          k.dead
                            ? "text-rose-400"
                            : k.usedPct >= 80
                              ? "text-amber-400"
                              : "text-emerald-400"
                        }`}
                      >
                        <span
                          className={`w-1.5 h-1.5 rounded-full ${
                            k.dead
                              ? "bg-rose-400"
                              : k.usedPct >= 80
                                ? "bg-amber-400"
                                : "bg-emerald-400"
                          }`}
                        />
                        {k.dead ? "Đã hết" : k.unlimitedQuota ? "Vô hạn" : `${k.usedPct}%`}
                      </span>
                    </div>

                    {!k.unlimitedQuota && (
                      <div className="space-y-1.5 tabular">
                        <div className="h-1.5 rounded-full bg-bg overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all ${barColor}`}
                            style={{ width: `${Math.min(100, Math.max(2, k.usedPct))}%` }}
                          />
                        </div>
                        <div className="flex justify-between text-[11.5px] font-mono text-zinc-400">
                          <span>Đã dùng {formatTokensCompact(k.usedTokens)}</span>
                          <span>Hạn mức {formatTokensCompact(k.quotaTokens)}</span>
                        </div>
                      </div>
                    )}

                    <div className="flex gap-2 pt-0.5">
                      <button
                        type="button"
                        onClick={() => handleRevealAndCopy(k, true)}
                        className="flex-1 h-9 rounded-xl bg-elevated hover:bg-subtle border border-white/[0.08] text-[12.5px] font-medium text-zinc-200"
                      >
                        Sao chép
                      </button>
                      {!revealed && (
                        <button
                          type="button"
                          onClick={() => handleRevealAndCopy(k, false)}
                          className="h-9 px-3.5 rounded-xl bg-elevated hover:bg-subtle border border-white/[0.08] text-[12.5px] font-medium text-zinc-300"
                        >
                          Hiện
                        </button>
                      )}
                      {k.canRenew && (
                        <button
                          type="button"
                          onClick={() => openRenewSheet(k)}
                          className="flex-1 h-9 rounded-xl bg-zinc-100 hover:bg-white text-[12.5px] font-semibold text-zinc-950"
                        >
                          Gia hạn
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

      {/* SUB-TAB 3: API KẾT NỐI (SELLER & USER API) */}
      {subTab === "api" && <DeveloperApiPanel onGoTopup={onGoTopup} initialMode={initialDevMode} />}

      {/* SHEET GIA HẠN TẠI CHỖ */}
      {renewTarget && (
        <div className="fixed inset-0 z-[65] flex items-end justify-center bg-black/80 backdrop-blur-sm animate-fade-in">
          <div className="w-full max-w-lg bg-card border-t border-white/10 rounded-t-[24px] px-5 pt-3 pb-safe-sheet max-h-[88vh] overflow-y-auto animate-sheet-up space-y-4">
            <div className="w-9 h-1 rounded-full bg-zinc-700/80 mx-auto" />

            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-[17px] font-semibold tracking-[-0.02em] text-zinc-100">
                  Gia hạn API Key
                </h3>
                <p className="text-[12px] text-zinc-400 font-mono mt-0.5">
                  {renewTarget.maskedKey}
                </p>
              </div>
              <button
                type="button"
                aria-label="Đóng"
                onClick={() => setRenewTarget(null)}
                className="w-9 h-9 rounded-full bg-elevated text-zinc-400 hover:text-zinc-100 flex items-center justify-center"
              >
                <X className="w-4 h-4" strokeWidth={1.75} />
              </button>
            </div>

            <div className="space-y-2">
              <div className="text-[12.5px] text-zinc-400">Nạp thêm Quota</div>
              <div className="grid grid-cols-5 gap-1.5">
                {[0, 50, 100, 200, 500].map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setAddM(m)}
                    className={`h-9 rounded-xl border text-[12.5px] font-mono transition-colors ${
                      addM === m
                        ? "bg-zinc-100 border-zinc-100 text-zinc-950 font-semibold"
                        : "bg-bg border-white/[0.07] text-zinc-300"
                    }`}
                  >
                    {m === 0 ? "0" : `+${m}M`}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <div className="text-[12.5px] text-zinc-400">Cộng thêm Số ngày</div>
              <div className="grid grid-cols-5 gap-1.5">
                {[0, 1, 7, 30, 90].map((d) => (
                  <button
                    key={d}
                    type="button"
                    onClick={() => setAddDays(d)}
                    className={`h-9 rounded-xl border text-[12.5px] font-mono transition-colors ${
                      addDays === d
                        ? "bg-zinc-100 border-zinc-100 text-zinc-950 font-semibold"
                        : "bg-bg border-white/[0.07] text-zinc-300"
                    }`}
                  >
                    {d === 0 ? "0" : `+${d}d`}
                  </button>
                ))}
              </div>
            </div>

            {renewQuote?.error ? (
              <div className="p-3 rounded-xl bg-bg border border-rose-500/30 text-[12.5px] text-rose-400">
                {renewQuote.error}
              </div>
            ) : renewQuote ? (
              <div className="rounded-2xl bg-bg border border-white/[0.08] p-4 flex items-baseline justify-between tabular">
                <span className="text-[13px] text-zinc-400">Chi phí gia hạn</span>
                <div className="text-right font-mono">
                  <span className="text-[18px] font-semibold text-zinc-100">
                    {renewQuoting ? "..." : formatUsd(renewQuote.priceUsd)}
                  </span>
                  <span className="text-[12px] text-zinc-500 ml-1.5">
                    {formatVnd(renewQuote.priceVnd)}
                  </span>
                </div>
              </div>
            ) : null}

            {renewQuote && !renewQuote.error && (
              <div className="space-y-2">
                {renewQuote.canPayWallet && (
                  <button
                    type="button"
                    disabled={Boolean(renewSubmitting)}
                    onClick={() => handleRenewCheckout("wallet")}
                    className="w-full h-11 rounded-xl bg-zinc-100 hover:bg-white text-zinc-950 font-semibold text-[14px] tabular"
                  >
                    Thanh toán bằng Ví · {formatVnd(renewQuote.priceVnd)}
                  </button>
                )}
                {shop?.payments?.vietqr && (
                  <button
                    type="button"
                    disabled={Boolean(renewSubmitting)}
                    onClick={() => handleRenewCheckout("vietqr")}
                    className="w-full h-11 rounded-xl bg-elevated hover:bg-subtle border border-white/[0.08] text-zinc-200 font-medium text-[13.5px]"
                  >
                    Chuyển khoản ngân hàng (VietQR)
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
