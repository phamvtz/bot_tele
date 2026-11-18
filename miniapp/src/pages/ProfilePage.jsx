import React, { useEffect, useState } from "react";
import {
  Crown,
  Share2,
  Copy,
  Sparkles,
  Trophy,
  Globe,
  MessageCircle,
  Star,
} from "lucide-react";
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
      showToast("🎉 Kích hoạt quà chào mừng thành công!", "success");
      loadAll();
      if (res.keyData?.key) {
        onRewardKeyReceived?.({
          title: "🌟 Quà Chào Mừng Bạn Mới",
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
      showToast("💎 Đổi điểm giới thiệu thành công!", "success");
      loadAll();
      if (res.keyData?.key) {
        onRewardKeyReceived?.({
          title: "💎 Đổi điểm lấy API Token",
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
    <div className="space-y-4">
      {/* User Header + VIP Progress */}
      <div className="rounded-3xl bg-gradient-to-br from-amber-500/20 via-surface-card to-surface-card border border-amber-400/30 p-4 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-base font-extrabold text-white">
              {user?.firstName || user?.username || "Khách hàng"}
            </div>
            <div className="text-xs text-slate-400 font-mono">
              ID: {user?.telegramId} {user?.username ? `· @${user.username}` : ""}
            </div>
          </div>
          <div className="px-3 py-1.5 rounded-2xl bg-amber-400/20 border border-amber-400/40 text-amber-300 text-xs font-extrabold flex items-center gap-1">
            <Crown className="w-4 h-4" /> VIP {vipData?.currentLevel ?? user?.vipLevel ?? 0} ·{" "}
            {vipData?.currentName || "Thường"}
          </div>
        </div>

        {vipData && (
          <div className="space-y-1.5 pt-1">
            <div className="flex justify-between text-[11px] text-slate-300">
              <span>Chi tiêu tích lũy: {formatVnd(vipData.totalSpent)}</span>
              <span className="text-amber-300 font-semibold">
                Ưu đãi giảm {vipData.discountPercent}%
              </span>
            </div>
            <div className="h-2 rounded-full bg-canvas-950 overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-amber-400 to-yellow-300 rounded-full"
                style={{ width: `${Math.min(100, Math.max(4, vipData.progress || 0))}%` }}
              />
            </div>
            {vipData.nextLevel ? (
              <p className="text-[11px] text-slate-400">
                Còn thiếu <b>{formatVnd(vipData.remaining)}</b> để lên hạng{" "}
                <b className="text-amber-300">{vipData.nextLevel.name}</b> (giảm{" "}
                {vipData.nextLevel.discountPercent}%)
              </p>
            ) : (
              <p className="text-[11px] text-emerald-400 font-semibold">
                ✨ Bạn đã đạt cấp VIP cao nhất của cửa hàng!
              </p>
            )}
          </div>
        )}
      </div>

      {/* Trung tâm Mời bạn & Đổi Điểm API (Referral v2) */}
      <div className="rounded-2xl bg-surface-card border border-white/10 p-4 space-y-3.5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm font-bold text-white">
            <Sparkles className="w-4 h-4 text-indigo-400" />
            <span>Mời bạn & Đổi điểm API</span>
          </div>
          <span className="px-2.5 py-1 rounded-full bg-indigo-500/20 text-indigo-200 text-xs font-extrabold flex items-center gap-1">
            <Star className="w-3.5 h-3.5 fill-amber-400 text-amber-400" />
            {refData?.points ?? user?.referralPoints ?? 0} điểm
          </span>
        </div>

        {refData?.config?.enabled && (
          <p className="text-xs text-slate-300 leading-relaxed">
            Mời bạn mới tham gia nhận ngay API Key{" "}
            <b className="text-emerald-400">{refData.config.rewardTokensM}M token</b> cho bạn mới và cộng dồn
            quota + điểm ⭐ cho bạn!
          </p>
        )}

        {inviteUrl && (
          <div className="space-y-2">
            <div className="p-2.5 rounded-xl bg-canvas-900 border border-white/10 font-mono text-[11px] text-sky-300 truncate">
              {inviteUrl}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={async () => {
                  await copyToClipboard(inviteUrl);
                  showToast("Đã sao chép link giới thiệu!", "success");
                }}
                className="py-2.5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-xs font-semibold text-white flex items-center justify-center gap-1.5"
              >
                <Copy className="w-3.5 h-3.5" /> Sao chép Link
              </button>
              <button
                type="button"
                onClick={() =>
                  shareTelegramUrl(
                    inviteUrl,
                    "Mở Shop nhận ngay API Key AI miễn phí & tài khoản số giá tốt!",
                  )
                }
                className="py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-xs font-bold text-white flex items-center justify-center gap-1.5"
              >
                <Share2 className="w-3.5 h-3.5" /> Chia sẻ Telegram
              </button>
            </div>
          </div>
        )}

        {/* Mã quà chào mừng WEL... */}
        {refData?.welcomeCode && !refData?.welcomeRedeemed && (
          <div className="p-3 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 space-y-2">
            <div className="text-xs font-bold text-emerald-300">
              🎁 Bạn có mã quà chào mừng chưa kích hoạt: {refData.welcomeCode}
            </div>
            <button
              type="button"
              disabled={busy}
              onClick={handleRedeemWelcome}
              className="w-full py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold"
            >
              Nhận ngay API Key Chào Mừng
            </button>
          </div>
        )}

        {/* Đổi điểm ⭐ lấy Token */}
        <div className="pt-2 border-t border-white/10 space-y-2.5">
          <div className="flex items-center justify-between text-xs">
            <span className="font-semibold text-slate-300">Đổi điểm ⭐ lấy Token API</span>
            <span className="text-[11px] text-slate-400">
              Tối thiểu {refData?.config?.minRedeemPoints || 1}⭐ ({refData?.config?.tokensPerPointM || 10}M/⭐)
            </span>
          </div>
          <div className="grid grid-cols-2 gap-1.5">
            <button
              type="button"
              onClick={() => setRedeemMode("newkey")}
              className={`py-1.5 rounded-lg text-xs font-semibold border ${
                redeemMode === "newkey"
                  ? "bg-indigo-500/20 border-indigo-400 text-indigo-200"
                  : "bg-canvas-900 border-white/10 text-slate-400"
              }`}
            >
              Tạo Key mới
            </button>
            <button
              type="button"
              disabled={!refData?.eligibleTopupKeys?.length}
              onClick={() => setRedeemMode("topup")}
              className={`py-1.5 rounded-lg text-xs font-semibold border disabled:opacity-40 ${
                redeemMode === "topup"
                  ? "bg-indigo-500/20 border-indigo-400 text-indigo-200"
                  : "bg-canvas-900 border-white/10 text-slate-400"
              }`}
            >
              Nạp vào Key đang dùng
            </button>
          </div>

          {redeemMode === "topup" && refData?.eligibleTopupKeys?.length > 0 && (
            <select
              value={selectedTopupKey}
              onChange={(e) => setSelectedTopupKey(e.target.value)}
              className="w-full px-3 py-2 rounded-xl bg-canvas-900 border border-white/10 text-xs font-mono text-slate-200"
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
              placeholder="Số điểm ⭐ muốn đổi..."
              className="flex-1 px-3 py-2 rounded-xl bg-canvas-900 border border-white/10 text-xs text-white focus:outline-none focus:border-indigo-500"
            />
            <button
              type="button"
              disabled={busy || !redeemPts}
              onClick={handleRedeemPoints}
              className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold disabled:opacity-40"
            >
              Đổi ngay
            </button>
          </div>
        </div>

        {/* BXH Đua Top Hôm Nay */}
        {Array.isArray(refData?.dailyLeaderboard) && refData.dailyLeaderboard.length > 0 && (
          <div className="pt-2 border-t border-white/10 space-y-2">
            <div className="flex items-center gap-1.5 text-xs font-bold text-amber-300">
              <Trophy className="w-3.5 h-3.5" /> Đua Top Mời Bạn Hôm Nay
            </div>
            <div className="space-y-1">
              {refData.dailyLeaderboard.slice(0, 5).map((row, idx) => (
                <div
                  key={idx}
                  className="flex items-center justify-between text-xs py-1 px-2 rounded-lg bg-canvas-900/70"
                >
                  <span className="text-slate-300 truncate">
                    #{idx + 1} {row.displayName || row.username || `User ${String(row.telegramId || "").slice(-4)}`}
                  </span>
                  <span className="font-bold text-emerald-400">
                    {row.count || row.points || 0} lượt
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Đổi ngôn ngữ & Hỗ trợ */}
      <div className="rounded-2xl bg-surface-card border border-white/10 p-4 space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-xs font-bold text-slate-200 flex items-center gap-1.5">
            <Globe className="w-4 h-4 text-sky-400" /> {tr(lang, "languageLabel")}
          </span>
          <div className="flex gap-1.5">
            {[
              { code: "vi", label: "🇻🇳 VI" },
              { code: "en", label: "🇬🇧 EN" },
              { code: "zh", label: "🇨🇳 中文" },
            ].map((l) => (
              <button
                key={l.code}
                type="button"
                onClick={() => {
                  hapticImpact("light");
                  onChangeLanguage?.(l.code);
                }}
                className={`px-2.5 py-1 rounded-lg text-xs font-bold border ${
                  lang === l.code
                    ? "bg-indigo-600 border-indigo-400 text-white"
                    : "bg-canvas-900 border-white/10 text-slate-400"
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
            className="w-full py-3 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-xs font-bold text-slate-200 flex items-center justify-center gap-2"
          >
            <MessageCircle className="w-4 h-4 text-emerald-400" />
            {tr(lang, "supportLabel")} (@{shop.supportUsername || shop.botUsername})
          </button>
        )}
      </div>
    </div>
  );
}
