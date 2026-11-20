import React, { useEffect, useState } from "react";
import { tmaFetch } from "../lib/api.js";
import { formatVnd, formatTokensCompact } from "../lib/format.js";
import {
  copyToClipboard,
  shareTelegramUrl,
  openTelegramUrl,
  hapticImpact,
  hapticNotify,
} from "../lib/telegram.js";
import { tr } from "../lib/i18n.js";
import { useToast } from "../components/Toast.jsx";

export default function ProfilePage({
  user,
  shop,
  lang = "vi",
  onChangeLanguage,
  onRewardKeyReceived,
  onOpenDeveloperApi,
}) {
  const [vipData, setVipData] = useState(null);
  const [refData, setRefData] = useState(null);
  const [redeemPts, setRedeemPts] = useState("");
  const [redeemMode, setRedeemMode] = useState("newkey");
  const [selectedTopupKey, setSelectedTopupKey] = useState("");
  const [welcomeInput, setWelcomeInput] = useState("");
  const [busy, setBusy] = useState(false);
  const { showToast } = useToast();

  const loadAll = async () => {
    try {
      const [v, r] = await Promise.all([tmaFetch("/vip"), tmaFetch("/referral")]);
      setVipData(v);
      setRefData(r);
      if (r.welcomeCode) setWelcomeInput(r.welcomeCode);
      if (r.eligibleTopupKeys?.length > 0) {
        setSelectedTopupKey(r.eligibleTopupKeys[0].id);
      }
    } catch (err) {
      showToast(err.message, "error");
    }
  };

  useEffect(() => {
    loadAll();
  }, []);

  const inviteUrl = refData?.miniAppInviteLink || refData?.botInviteLink || "";

  const handleRedeemWelcome = async () => {
    if (!welcomeInput.trim()) return;
    setBusy(true);
    try {
      const res = await tmaFetch("/referral/redeem-welcome", {
        method: "POST",
        body: { code: welcomeInput.trim() },
      });
      hapticNotify("success");
      showToast("Đã kích hoạt quà chào mừng", "success");
      loadAll();
      if (res.keyData?.key) {
        onRewardKeyReceived?.({
          title: "Quà chào mừng thành viên mới",
          apiKey: {
            key: res.keyData.key,
            quotaTokens: res.keyData.quotaTokens,
          },
        });
      }
    } catch (err) {
      if (err.code !== "CHANNEL_JOIN_REQUIRED") showToast(err.message, "error");
    } finally {
      setBusy(false);
    }
  };

  const handleRedeemPoints = async () => {
    const pts = Math.floor(Number(redeemPts || 0));
    if (pts <= 0) return;
    setBusy(true);
    try {
      const res = await tmaFetch("/referral/redeem-points", {
        method: "POST",
        body: {
          points: pts,
          mode: redeemMode,
          issuedKeyId: redeemMode === "topup" ? selectedTopupKey : undefined,
        },
      });
      hapticNotify("success");
      setRedeemPts("");
      showToast("Đổi điểm thành công", "success");
      loadAll();
      if (res.keyData?.key) {
        onRewardKeyReceived?.({
          title: "Đổi điểm nhận API Token",
          apiKey: {
            key: res.keyData.key,
            quotaTokens: res.keyData.quotaTokens || res.tokensGranted,
          },
        });
      }
    } catch (err) {
      if (err.code !== "CHANNEL_JOIN_REQUIRED") showToast(err.message, "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-5">
      <header className="pt-1">
        <h1 className="text-[19px] font-semibold tracking-[-0.03em] text-zinc-100">Tài khoản</h1>
      </header>

      {/* Account & VIP Card */}
      <div className="rounded-2xl bg-card border border-white/[0.08] p-4 space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-[16px] font-semibold tracking-[-0.02em] text-zinc-100">
              {user?.firstName || user?.username || "Khách hàng"}
            </div>
            <div className="text-[12px] text-zinc-500 font-mono mt-0.5">
              ID {user?.telegramId}
              {user?.username ? ` · @${user.username}` : ""}
            </div>
          </div>
          <span className="px-2.5 py-1 rounded-full bg-elevated border border-white/10 text-[11.5px] font-mono font-medium text-zinc-200">
            VIP {vipData?.currentLevel ?? user?.vipLevel ?? 0} · {vipData?.currentName || "Thường"}
          </span>
        </div>

        {vipData && (
          <div className="space-y-2 pt-3 border-t border-white/[0.06] tabular">
            <div className="flex justify-between text-[12.5px] text-zinc-400">
              <span>Tổng chi tiêu: {formatVnd(vipData.totalSpent)}</span>
              <span className="text-zinc-200 font-mono">−{vipData.discountPercent}%</span>
            </div>
            <div className="h-1.5 rounded-full bg-bg overflow-hidden">
              <div
                className="h-full bg-zinc-100 rounded-full transition-all"
                style={{ width: `${Math.min(100, Math.max(3, vipData.progress || 0))}%` }}
              />
            </div>
            {vipData.nextLevel ? (
              <p className="text-[12px] text-zinc-500">
                Còn {formatVnd(vipData.remaining)} để đạt hạng {vipData.nextLevel.name} (giảm{" "}
                {vipData.nextLevel.discountPercent}%)
              </p>
            ) : (
              <p className="text-[12px] text-emerald-400">Đã đạt cấp độ thành viên cao nhất</p>
            )}
          </div>
        )}
      </div>

      {/* Referral & Points */}
      <div className="rounded-2xl bg-card border border-white/[0.08] p-4 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-[15px] font-semibold tracking-[-0.015em] text-zinc-100">
            Giới thiệu & Điểm thưởng
          </h2>
          <span className="font-mono text-[13px] font-semibold text-zinc-100 tabular">
            {refData?.points ?? user?.referralPoints ?? 0} pts
          </span>
        </div>

        {refData?.config?.enabled && (
          <p className="text-[13px] text-zinc-400 leading-relaxed">
            Mời bạn bè tham gia để tặng bạn mới API Key{" "}
            <span className="text-zinc-200 font-medium">{refData.config.rewardTokensM}M token</span>{" "}
            và tích lũy điểm đổi hạn mức cho tài khoản của bạn.
          </p>
        )}

        {inviteUrl && (
          <div className="space-y-2">
            <div className="px-3 py-2.5 rounded-xl bg-bg border border-white/[0.07] font-mono text-[12px] text-zinc-300 truncate select-all">
              {inviteUrl}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={async () => {
                  await copyToClipboard(inviteUrl);
                  showToast("Đã sao chép liên kết mời", "success");
                }}
                className="h-10 rounded-xl bg-elevated hover:bg-subtle border border-white/[0.08] text-[13px] font-medium text-zinc-200"
              >
                Sao chép link
              </button>
              <button
                type="button"
                onClick={() =>
                  shareTelegramUrl(
                    inviteUrl,
                    "Tham gia nhận ngay API Key AI miễn phí và tài khoản số tự động.",
                  )
                }
                className="h-10 rounded-xl bg-zinc-100 hover:bg-white text-[13px] font-semibold text-zinc-950"
              >
                Chia sẻ
              </button>
            </div>
          </div>
        )}

        {refData?.welcomeCode && !refData?.welcomeRedeemed && (
          <div className="p-3.5 rounded-xl bg-bg border border-white/10 space-y-2.5">
            <div className="flex items-center justify-between text-[12.5px]">
              <span className="text-zinc-300">Mã quà chào mừng</span>
              <span className="font-mono font-semibold text-zinc-100">{refData.welcomeCode}</span>
            </div>
            <button
              type="button"
              disabled={busy}
              onClick={handleRedeemWelcome}
              className="w-full h-9 rounded-lg bg-zinc-100 hover:bg-white text-zinc-950 text-[12.5px] font-semibold"
            >
              Kích hoạt ngay
            </button>
          </div>
        )}

        {/* Đổi điểm lấy Token */}
        <div className="pt-3 border-t border-white/[0.06] space-y-3">
          <div className="flex items-center justify-between text-[12.5px]">
            <span className="font-medium text-zinc-300">Quy đổi điểm sang Token</span>
            <span className="font-mono text-zinc-500">
              Tối thiểu {refData?.config?.minRedeemPoints || 10} pts (
              {refData?.config?.tokensPerPointM || 5}M / pt)
            </span>
          </div>

          <div className="grid grid-cols-2 gap-1 p-1 rounded-xl bg-bg border border-white/[0.06]">
            <button
              type="button"
              onClick={() => setRedeemMode("newkey")}
              className={`h-8 rounded-lg text-[12px] font-medium transition-colors ${
                redeemMode === "newkey" ? "bg-zinc-100 text-zinc-950 font-semibold" : "text-zinc-400"
              }`}
            >
              Tạo Key mới
            </button>
            <button
              type="button"
              disabled={!refData?.eligibleTopupKeys?.length}
              onClick={() => setRedeemMode("topup")}
              className={`h-8 rounded-lg text-[12px] font-medium transition-colors disabled:opacity-35 ${
                redeemMode === "topup" ? "bg-zinc-100 text-zinc-950 font-semibold" : "text-zinc-400"
              }`}
            >
              Nạp vào Key cũ
            </button>
          </div>

          {redeemMode === "topup" && refData?.eligibleTopupKeys?.length > 0 && (
            <select
              aria-label="Chọn API Key để nạp thêm"
              value={selectedTopupKey}
              onChange={(e) => setSelectedTopupKey(e.target.value)}
              className="w-full h-10 px-3 rounded-xl bg-bg border border-white/[0.08] text-[12.5px] font-mono text-zinc-200"
            >
              {refData.eligibleTopupKeys.map((k) => (
                <option key={k.id} value={k.id}>
                  {k.maskedKey} ({formatTokensCompact(k.quotaTokens)})
                </option>
              ))}
            </select>
          )}

          <div className="flex gap-2">
            <input
              type="number"
              min="1"
              value={redeemPts}
              onChange={(e) => setRedeemPts(e.target.value)}
              placeholder="Nhập số điểm cần đổi"
              className="flex-1 h-10 px-3.5 rounded-xl bg-bg border border-white/[0.08] text-[13px] font-mono text-zinc-100 placeholder:font-sans placeholder:text-zinc-500 focus:outline-none focus:border-white/25"
            />
            <button
              type="button"
              disabled={busy || !redeemPts}
              onClick={handleRedeemPoints}
              className="h-10 px-4 rounded-xl bg-elevated hover:bg-subtle border border-white/[0.08] text-zinc-100 text-[13px] font-medium shrink-0 disabled:opacity-40"
            >
              Quy đổi
            </button>
          </div>
        </div>

        {/* BXH Đua Top */}
        {Array.isArray(refData?.dailyLeaderboard) && refData.dailyLeaderboard.length > 0 && (
          <div className="pt-3 border-t border-white/[0.06] space-y-2">
            <div className="text-[12.5px] font-medium text-zinc-400">Bảng xếp hạng hôm nay</div>
            <div className="divide-y divide-white/[0.05]">
              {refData.dailyLeaderboard.slice(0, 5).map((row, idx) => (
                <div
                  key={idx}
                  className="py-2 flex items-center justify-between text-[13px] tabular"
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <span className="font-mono text-[11.5px] text-zinc-500 w-5">
                      {String(idx + 1).padStart(2, "0")}
                    </span>
                    <span className="text-zinc-200 truncate">
                      {row.displayName ||
                        row.username ||
                        `User ${String(row.telegramId || "").slice(-4)}`}
                    </span>
                  </div>
                  <span className="font-mono text-[12.5px] text-zinc-300">
                    {row.count || row.points || 0}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* API Kết nối (Seller / User API) */}
      {onOpenDeveloperApi && (
        <div className="rounded-2xl bg-card border border-white/[0.08] p-4 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[14px] font-semibold tracking-[-0.015em] text-zinc-100">
              API Kết nối (Reseller / Dev)
            </div>
            <p className="text-[12px] text-zinc-400 mt-0.5 leading-relaxed">
              Lấy API Key cá nhân, Base URL (/api/seller, /api/user) và mẫu cURL.
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              hapticImpact("light");
              onOpenDeveloperApi();
            }}
            className="h-9 px-3.5 rounded-xl bg-zinc-100 hover:bg-white text-zinc-950 text-[12.5px] font-semibold shrink-0"
          >
            Mở API
          </button>
        </div>
      )}

      {/* Ngôn ngữ & Hỗ trợ */}
      <div className="rounded-2xl bg-card border border-white/[0.08] p-4 space-y-3.5">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[13.5px] font-medium text-zinc-200">
            {tr(lang, "languageLabel")}
          </span>
          <div className="inline-flex p-1 rounded-xl bg-bg border border-white/[0.06]">
            {[
              { code: "vi", label: "VI" },
              { code: "en", label: "EN" },
              { code: "zh", label: "中文" },
            ].map((l) => (
              <button
                key={l.code}
                type="button"
                onClick={() => {
                  hapticImpact("light");
                  onChangeLanguage?.(l.code);
                }}
                className={`h-7 px-3 rounded-lg text-[12px] font-medium transition-colors ${
                  lang === l.code ? "bg-zinc-100 text-zinc-950 font-semibold" : "text-zinc-400"
                }`}
              >
                {l.label}
              </button>
            ))}
          </div>
        </div>

        {(shop?.supportUsername || shop?.botUsername) && (
          <button
            type="button"
            onClick={() =>
              openTelegramUrl(`https://t.me/${shop.supportUsername || shop.botUsername}`)
            }
            className="w-full h-11 rounded-xl bg-elevated hover:bg-subtle border border-white/[0.08] text-[13.5px] font-medium text-zinc-200 transition-colors"
          >
            {tr(lang, "supportLabel")} (@{shop.supportUsername || shop.botUsername})
          </button>
        )}
      </div>
    </div>
  );
}
