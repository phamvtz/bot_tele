import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Share2, Copy, Check, Users, Coins, Save, Trophy, Gift, Crown,
  Star, RefreshCw, Shield, Sparkles, Search, RotateCcw, Zap, KeyRound, Package,
} from "lucide-react";
import { api } from "../../api/endpoints";
import StatsCard from "../../components/StatsCard";
import TabFilter from "../../components/TabFilter";
import EmptyState from "../../components/EmptyState";
import { formatCurrency, formatDate } from "../../utils/format";

const TABS = [
  { value: "leaderboard", label: "BXH & Đua Top" },
  { value: "pairs", label: "Ghép cặp Invite" },
  { value: "grants", label: "Nhật ký Key/Token" },
  { value: "events", label: "Lịch sử Điểm" },
  { value: "commissions", label: "Hoa hồng ví" },
  { value: "config", label: "Cài đặt & Luật" },
];

function fmtTokens(n) {
  const v = Number(n) || 0;
  if (v <= 0) return "0";
  if (v >= 1e9) {
    const b = v / 1e9;
    return Number.isInteger(b) ? `${b}B` : `${Number(b.toFixed(2))}B`;
  }
  const m = v / 1e6;
  return Number.isInteger(m) ? `${m}M` : `${Number(m.toFixed(2))}M`;
}

function toMillionsInput(tokens, fallbackM = 0) {
  if (tokens === undefined || tokens === null || tokens === "") return String(fallbackM);
  const m = Number(tokens) / 1e6;
  return Number.isFinite(m) ? String(Math.round(m * 100) / 100) : String(fallbackM);
}

const MEDALS = ["🥇", "🥈", "🥉"];

const GRANT_TYPE_LABELS = {
  ref_invite_token: "Tặng 2 phía (Invite)",
  ref_milestone: "Thưởng Mốc 5/10/20",
  ref_daily_top: "Giải Đua Top Ngày",
  ref_welcome_key: "Quà Welcome (WEL)",
  token_newkey: "Đổi điểm → Key mới",
  token_topup: "Đổi điểm → Nạp Key",
  buyer_voucher: "Coupon Mốc Người Mua",
  key1b: "Sự kiện Key 1.5B (IP)",
  classic_basic: "Đổi SP Basic",
  classic_bh3d: "Đổi SP BH 3 ngày",
  classic_bh7d: "Đổi SP BH 7 ngày",
  classic_gpt: "Đổi SP GPT 7 ngày",
};

const EVENT_TYPE_LABELS = {
  start_bot: "Vào link (/start)",
  join_channel: "Vào kênh (Người mời)",
  join_channel_self: "Vào kênh (Bạn mới)",
  purchase: "Mua đơn đầu tiên",
  admin_bonus: "Admin cộng/trừ ⭐",
};

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

export default function Referral() {
  const [tab, setTab] = useState("leaderboard");
  const [copied, setCopied] = useState(false);
  const [form, setForm] = useState({});
  const [bonusTarget, setBonusTarget] = useState("");
  const [bonusDelta, setBonusDelta] = useState("5");
  const [bonusReason, setBonusReason] = useState("");
  const [grantFilter, setGrantFilter] = useState({ rewardType: "", status: "", q: "" });
  const [eventFilter, setEventFilter] = useState({ eventType: "", q: "" });
  const [pairSearch, setPairSearch] = useState("");

  const qc = useQueryClient();

  const { data: statsData, isLoading: statsLoading } = useQuery({
    queryKey: ["referral-stats"],
    queryFn: api.referralStats,
  });
  const { data: board, isLoading: boardLoading } = useQuery({
    queryKey: ["referral-leaderboard"],
    queryFn: () => api.referralLeaderboard(100),
  });
  const { data: cfgData } = useQuery({
    queryKey: ["referral-config"],
    queryFn: api.referralConfig,
  });
  const { data: botStatus } = useQuery({
    queryKey: ["bot-status"],
    queryFn: api.botStatus,
    staleTime: 60000,
  });
  const { data: pairsData, isLoading: pairsLoading } = useQuery({
    queryKey: ["referral-invite-pairs", pairSearch],
    queryFn: () => api.referralInvitePairs({ limit: 120, q: pairSearch }),
    enabled: tab === "pairs",
  });
  const { data: productsData } = useQuery({
    queryKey: ["products-for-referral"],
    queryFn: () => api.products({ limit: 200 }),
    enabled: tab === "config",
    staleTime: 60000,
  });
  const { data: grantsData, isLoading: grantsLoading } = useQuery({
    queryKey: ["referral-grants", grantFilter],
    queryFn: () => api.referralGrants({ limit: 120, ...grantFilter }),
    enabled: tab === "grants",
  });
  const { data: eventsData, isLoading: eventsLoading } = useQuery({
    queryKey: ["referral-events", eventFilter],
    queryFn: () => api.referralEvents({ limit: 120, ...eventFilter }),
    enabled: tab === "events",
  });

  const eff = cfgData?.effective || {};

  useEffect(() => {
    if (!cfgData?.effective) return;
    const e = cfgData.effective;
    setForm({
      referralEnabled: e.referralEnabled !== false,
      referralChannelId: e.channelId || "",
      referralChannelUrl: e.channelUrl || "",
      referralAgeFilterEnabled: e.ageFilterEnabled !== false,
      referralMinTgAgeDays: String(e.minTgAgeDays ?? 7),
      REFERRAL_REWARD_SINCE: e.since || "",

      referralInviteTokenEnabled: e.inviteTokenEnabled !== false,
      inviteTokenM: toMillionsInput(e.inviteTokenAmount, 20),
      referralInviteTokenDays: String(e.inviteTokenDays ?? 1),
      inviteRefMinM: toMillionsInput(e.inviteReferrerMinTokens, 2),
      inviteRefMaxM: toMillionsInput(e.inviteReferrerMaxTokens, 7),
      referralInviteReferrerKeyDays: String(e.inviteReferrerKeyDays ?? 30),
      referralInviteTokenMaxPerReferrer: String(e.inviteMaxPerReferrer ?? 0),
      referralInviteTokenMaxPairsPerDay: String(e.inviteMaxPairsPerDay ?? 0),
      referralLuckyProtectEnabled: e.luckyProtectEnabled !== false,
      luckyMinM: toMillionsInput(e.luckyMinTokens, 6),

      referralMilestoneEnabled: e.milestoneEnabled !== false,
      ms5M: toMillionsInput(e.milestone5Tokens, 15),
      ms10M: toMillionsInput(e.milestone10Tokens, 25),
      ms20M: toMillionsInput(e.milestone20Tokens, 50),
      referralExpiryWarnEnabled: e.expiryWarnEnabled !== false,
      referralDailyTopEnabled: e.dailyTopEnabled !== false,
      top1M: toMillionsInput(e.dailyTop1Tokens, 50),
      top2M: toMillionsInput(e.dailyTop2Tokens, 30),
      top3M: toMillionsInput(e.dailyTop3Tokens, 15),

      referralWelcomeKeyEnabled: e.welcomeKeyEnabled !== false,
      referralWelcomeTokenMinM: String(e.welcomeTokenMinM ?? 5),
      referralWelcomeTokenMaxM: String(e.welcomeTokenMaxM ?? 10),
      referralWelcomeMaxPerDay: String(e.welcomeMaxPerDay ?? 0),

      referralPointStartBot: String(e.pointStartBot ?? 0),
      referralPointJoinChannel: String(e.pointJoinChannel ?? 1),
      referralPointPurchase: String(e.pointPurchase ?? 3),
      referralBuyerTarget: String(e.buyerTarget ?? 3),
      referralPersonalVoucherPercent: String(e.personalVoucherPercent ?? 49),
      referralExtraWarrantyHours: String(e.extraWarrantyHours ?? 48),

      referralRedeemEnabled: e.redeemEnabled !== false,
      referralTokenRedeemEnabled: e.tokenRedeemEnabled !== false,
      tokenPerPointM: toMillionsInput(e.tokenPerPoint, 10),
      tokenMaxPerUserM: toMillionsInput(e.tokenMaxPerUser, 100),
      referralTokenNewKeyRpm: String(e.tokenNewKeyRpm ?? 100),
      referralTokenNewKeyDays: String(e.tokenNewKeyDays ?? 3),
      tokenRedeemBroadcastEnabled: e.tokenRedeemBroadcastEnabled !== false,
      tokenRedeemBroadcastChance: String(e.tokenRedeemBroadcastChance ?? 100),
      tokenRedeemBroadcastCooldownMin: String(e.tokenRedeemBroadcastCooldownMin ?? 0),
      tokenRedeemBroadcastWindowMin: String(e.tokenRedeemBroadcastWindowMin ?? 30),
      tokenRedeemBroadcastWindowMax: String(e.tokenRedeemBroadcastWindowMax ?? 5),
      REFERRAL_COMMISSION: String(e.commissionPercent ?? 0),

      referralRedeemBasicSlug: e.redeemBasicSlug || "",
      referralRedeemBh3dSlug: e.redeemBh3dSlug || "",
      referralRedeemBh7dSlug: e.redeemBh7dSlug || "",
      referralRedeemGptSlug: e.redeemGptSlug || "",
      referralRedeemBasicPoints: String(e.redeemBasicPoints ?? 1),
      referralRedeemBh3dPoints: String(e.redeemBh3dPoints ?? 2),
      referralRedeemBh7dPoints: String(e.redeemBh7dPoints ?? 3),
      referralRedeemGptPoints: String(e.redeemGptPoints ?? 5),
    });
  }, [cfgData]);

  const setF = (key, val) => setForm((p) => ({ ...p, [key]: val }));

  const saveMut = useMutation({
    mutationFn: (payload) => api.updateReferralConfig(payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["referral-config"] });
    },
  });

  const resetBatchMut = useMutation({
    mutationFn: () => api.resetReferralTokenBatch(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["referral-config"] });
    },
  });

  const bonusMut = useMutation({
    mutationFn: (payload) => api.adjustReferralPoints(payload),
    onSuccess: () => {
      setBonusReason("");
      qc.invalidateQueries({ queryKey: ["referral-leaderboard"] });
      qc.invalidateQueries({ queryKey: ["referral-events"] });
    },
  });

  const retryMut = useMutation({
    mutationFn: () => api.retryReferralGrants(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["referral-grants"] });
      qc.invalidateQueries({ queryKey: ["referral-leaderboard"] });
    },
  });

  function handleSaveConfig() {
    const mToTok = (v, defM) => String(Math.max(0, Math.round((Number(v ?? defM) || 0) * 1_000_000)));
    saveMut.mutate({
      referralEnabled: String(Boolean(form.referralEnabled)),
      referralChannelId: String(form.referralChannelId || "").trim(),
      referralChannelUrl: String(form.referralChannelUrl || "").trim(),
      referralAgeFilterEnabled: String(Boolean(form.referralAgeFilterEnabled)),
      referralMinTgAgeDays: String(form.referralMinTgAgeDays ?? "7"),
      REFERRAL_REWARD_SINCE: String(form.REFERRAL_REWARD_SINCE || "").trim(),

      referralInviteTokenEnabled: String(Boolean(form.referralInviteTokenEnabled)),
      referralInviteTokenAmount: mToTok(form.inviteTokenM, 20),
      REFERRAL_REWARD_TOKENS_M: String(Math.max(0, Math.round(Number(form.inviteTokenM ?? 20) || 0))),
      referralInviteTokenDays: String(form.referralInviteTokenDays ?? "1"),
      REFERRAL_REWARD_DAYS: String(form.referralInviteTokenDays ?? "1"),
      referralInviteReferrerMinTokens: mToTok(form.inviteRefMinM, 2),
      referralInviteReferrerMaxTokens: mToTok(form.inviteRefMaxM, 7),
      referralInviteReferrerKeyDays: String(form.referralInviteReferrerKeyDays ?? "30"),
      referralInviteTokenMaxPerReferrer: String(form.referralInviteTokenMaxPerReferrer ?? "0"),
      referralInviteTokenMaxPairsPerDay: String(form.referralInviteTokenMaxPairsPerDay ?? "0"),
      referralLuckyProtectEnabled: String(Boolean(form.referralLuckyProtectEnabled)),
      referralLuckyMinTokens: mToTok(form.luckyMinM, 6),

      referralMilestoneEnabled: String(Boolean(form.referralMilestoneEnabled)),
      referralMilestone5Tokens: mToTok(form.ms5M, 15),
      referralMilestone10Tokens: mToTok(form.ms10M, 25),
      referralMilestone20Tokens: mToTok(form.ms20M, 50),
      referralExpiryWarnEnabled: String(Boolean(form.referralExpiryWarnEnabled)),
      referralDailyTopEnabled: String(Boolean(form.referralDailyTopEnabled)),
      referralDailyTop1Tokens: mToTok(form.top1M, 50),
      referralDailyTop2Tokens: mToTok(form.top2M, 30),
      referralDailyTop3Tokens: mToTok(form.top3M, 15),

      referralWelcomeKeyEnabled: String(Boolean(form.referralWelcomeKeyEnabled)),
      referralWelcomeTokenMinM: String(form.referralWelcomeTokenMinM ?? "5"),
      referralWelcomeTokenMaxM: String(form.referralWelcomeTokenMaxM ?? "10"),
      referralWelcomeMaxPerDay: String(form.referralWelcomeMaxPerDay ?? "0"),

      referralPointStartBot: String(form.referralPointStartBot ?? "0"),
      referralPointJoinChannel: String(form.referralPointJoinChannel ?? "1"),
      referralPointPurchase: String(form.referralPointPurchase ?? "3"),
      referralBuyerTarget: String(form.referralBuyerTarget ?? "3"),
      referralPersonalVoucherPercent: String(form.referralPersonalVoucherPercent ?? "49"),
      referralExtraWarrantyHours: String(form.referralExtraWarrantyHours ?? "48"),

      referralRedeemEnabled: String(Boolean(form.referralRedeemEnabled)),
      referralTokenRedeemEnabled: String(Boolean(form.referralTokenRedeemEnabled)),
      referralTokenPerPoint: mToTok(form.tokenPerPointM, 10),
      referralTokenMaxPerUser: mToTok(form.tokenMaxPerUserM, 100),
      referralTokenNewKeyRpm: String(form.referralTokenNewKeyRpm ?? "100"),
      REFERRAL_REWARD_RPM: String(form.referralTokenNewKeyRpm ?? "100"),
      referralTokenNewKeyDays: String(form.referralTokenNewKeyDays ?? "3"),
      tokenRedeemBroadcastEnabled: String(Boolean(form.tokenRedeemBroadcastEnabled)),
      tokenRedeemBroadcastChance: String(form.tokenRedeemBroadcastChance ?? "100"),
      tokenRedeemBroadcastCooldownMin: String(form.tokenRedeemBroadcastCooldownMin ?? "0"),
      tokenRedeemBroadcastWindowMin: String(form.tokenRedeemBroadcastWindowMin ?? "30"),
      tokenRedeemBroadcastWindowMax: String(form.tokenRedeemBroadcastWindowMax ?? "5"),
      REFERRAL_COMMISSION: String(form.REFERRAL_COMMISSION ?? "0"),

      referralRedeemBasicSlug: String(form.referralRedeemBasicSlug || "").trim(),
      referralRedeemBh3dSlug: String(form.referralRedeemBh3dSlug || "").trim(),
      referralRedeemBh7dSlug: String(form.referralRedeemBh7dSlug || "").trim(),
      referralRedeemGptSlug: String(form.referralRedeemGptSlug || "").trim(),
      referralRedeemBasicPoints: String(form.referralRedeemBasicPoints ?? "1"),
      referralRedeemBh3dPoints: String(form.referralRedeemBh3dPoints ?? "2"),
      referralRedeemBh7dPoints: String(form.referralRedeemBh7dPoints ?? "3"),
      referralRedeemGptPoints: String(form.referralRedeemGptPoints ?? "5"),
    });
  }

  const botUsername = botStatus?.username;
  const referralLink = botUsername ? `https://t.me/${botUsername}?start=ref` : null;

  const totals = board?.totals || {};
  const rows = board?.rows || [];
  const daily = board?.daily || { dayKey: "", rows: [] };
  const commissions = statsData?.commissions || [];
  const totalCommissions = statsData?.totalCommissions || 0;
  const grants = grantsData?.grants || [];
  const events = eventsData?.events || [];
  const pairs = pairsData?.pairs || [];
  const allProducts = productsData?.products || (Array.isArray(productsData) ? productsData : []);

  function copyLink() {
    if (!referralLink) return;
    navigator.clipboard.writeText(referralLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const headerSummary = eff.referralEnabled === false
    ? "Hệ thống giới thiệu đang TẮT"
    : `Bạn mới: Key ${fmtTokens(eff.inviteTokenAmount)}/${eff.inviteTokenDays || 1}d + WEL ${eff.welcomeTokenMinM || 5}–${eff.welcomeTokenMaxM || 10}M · Người mời: +${fmtTokens(eff.inviteReferrerMinTokens)}–${fmtTokens(eff.inviteReferrerMaxTokens)} vào Key ${eff.inviteReferrerKeyDays || 30}d + Điểm đổi Token`;

  return (
    <div className="space-y-4 pb-12">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="eyebrow text-slate-400">GROWTH // AFFILIATE & API REWARDS V2</span>
            <span className="w-1 h-1 rounded-full bg-slate-600" />
            <span className="text-[10px] font-mono text-indigo-400">5-BRANCH ENGINE</span>
          </div>
          <h1 className="text-xl font-bold text-slate-100 tracking-tight flex items-center gap-2">
            Hệ thống Mời bạn & Tặng API Key
          </h1>
          <p className="text-xs text-slate-400 mt-0.5 tracking-tight">{headerSummary}</p>
        </div>

        <Link
          to="/key-1b"
          className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 border border-amber-500/30 text-xs font-mono font-semibold self-start sm:self-auto"
        >
          <KeyRound size={14} />
          Quản trị Event Key 1.5B (IP)
        </Link>
      </div>

      {/* Stats Row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5">
        <StatsCard
          icon={Users}
          label="LƯỢT MỜI / HỢP LỆ"
          value={`${totals.invited ?? 0} / ${totals.rewarded ?? 0}`}
          iconBg="bg-indigo-950/60"
          iconColor="text-indigo-400"
        />
        <StatsCard
          icon={Gift}
          label="TỔNG TOKEN ĐÃ TẶNG"
          value={totals.tokensGiven != null ? `${fmtTokens(totals.tokensGiven)} (${totals.keysGiven || 0} keys)` : "—"}
          iconBg="bg-emerald-950/60"
          iconColor="text-emerald-400"
        />
        <StatsCard
          icon={Star}
          label="ĐIỂM ĐANG LƯU HÀNH"
          value={`${totals.totalPointsActive ?? 0} ⭐ (đã đổi ${totals.breakdown?.pointsRedeemed ?? 0}⭐)`}
          iconBg="bg-amber-950/60"
          iconColor="text-amber-400"
        />
        <StatsCard
          icon={Trophy}
          label="NGƯỜI MỜI HỢP LỆ"
          value={String(totals.inviters ?? 0)}
          iconBg="bg-cyan-950/60"
          iconColor="text-cyan-400"
        />
      </div>

      {/* Link Spec + Quick Point Adjust */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-3.5">
        <div className="lg:col-span-6 bento-card p-4 space-y-2">
          <p className="text-[10px] font-mono uppercase tracking-wider text-slate-400 font-semibold">
            CÚ PHÁP LINK GIỚI THIỆU // REFERRAL LINK
          </p>
          {referralLink ? (
            <>
              <div className="flex items-center gap-2 bg-[#050811] border border-slate-800/80 rounded-md p-2">
                <span className="text-xs text-slate-300 flex-1 truncate font-mono select-all">
                  {referralLink}<span className="text-indigo-400 font-bold">[TELEGRAM_ID]</span>
                </span>
                <button
                  onClick={copyLink}
                  className="flex items-center gap-1.5 px-3 py-1 bg-indigo-600 hover:bg-indigo-500 text-white rounded text-xs font-mono font-medium transition-colors flex-shrink-0 cursor-pointer"
                >
                  {copied ? <Check size={12} /> : <Copy size={12} />}
                  {copied ? "ĐÃ COPY" : "COPY"}
                </button>
              </div>
              <p className="text-[11px] text-slate-400 tracking-tight">
                Hỗ trợ đồng thời cả link mới <code className="text-indigo-300">?start=ref7368118922</code> và link cũ <code className="text-slate-300">?start=ref_CODE</code>.
              </p>
            </>
          ) : (
            <div className="bg-amber-950/30 border border-amber-800/30 rounded p-3 text-xs font-mono text-amber-300">
              ⚠ Chưa đọc được username bot.
            </div>
          )}
        </div>

        <div className="lg:col-span-6 bento-card p-4 space-y-2.5">
          <p className="text-[10px] font-mono uppercase tracking-wider text-amber-400 font-semibold flex items-center gap-1.5">
            <Star size={12} /> CỘNG / TRỪ ĐIỂM GIỚI THIỆU THỦ CÔNG (/refbonus)
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!bonusTarget.trim() || !Number(bonusDelta)) return;
              bonusMut.mutate({
                target: bonusTarget.trim(),
                deltaPoints: Number(bonusDelta),
                reason: bonusReason.trim(),
              });
            }}
            className="grid grid-cols-1 sm:grid-cols-12 gap-2"
          >
            <input
              value={bonusTarget}
              onChange={(e) => setBonusTarget(e.target.value)}
              placeholder="@username hoặc Telegram ID"
              className="sm:col-span-5 dev-input rounded px-2.5 py-1.5 text-xs font-mono"
            />
            <input
              type="number"
              value={bonusDelta}
              onChange={(e) => setBonusDelta(e.target.value)}
              placeholder="+/- điểm"
              className="sm:col-span-2 dev-input rounded px-2.5 py-1.5 text-xs font-mono"
            />
            <input
              value={bonusReason}
              onChange={(e) => setBonusReason(e.target.value)}
              placeholder="Lý do (tuỳ chọn)"
              className="sm:col-span-3 dev-input rounded px-2.5 py-1.5 text-xs"
            />
            <button
              type="submit"
              disabled={!bonusTarget.trim() || !Number(bonusDelta) || bonusMut.isPending}
              className="sm:col-span-2 px-2.5 py-1.5 bg-amber-600 hover:bg-amber-500 text-white rounded text-xs font-mono font-medium disabled:opacity-50 cursor-pointer transition-colors"
            >
              {bonusMut.isPending ? "..." : "LƯU ⭐"}
            </button>
          </form>
          {bonusMut.isSuccess && (
            <p className="text-[11px] text-emerald-400 font-mono">
              ✓ Đã cập nhật {bonusMut.data?.delta >= 0 ? `+${bonusMut.data?.delta}` : bonusMut.data?.delta}⭐ cho {bonusMut.data?.user?.telegramId} (mới: {bonusMut.data?.newPoints}⭐)
            </p>
          )}
          {bonusMut.isError && (
            <p className="text-[11px] text-rose-400 font-mono">
              ✕ {bonusMut.error?.response?.data?.error || "Không cập nhật được điểm"}
            </p>
          )}
        </div>
      </div>

      {/* Main Bento Tab Card */}
      <div className="bento-card p-4 space-y-4">
        <TabFilter tabs={TABS} active={tab} onChange={setTab} />

        {/* ── TAB 1: LEADERBOARD & DAILY TOP ── */}
        {tab === "leaderboard" && (
          <div className="space-y-5 mt-2">
            {/* Daily Top Box */}
            <div className="rounded-lg border border-amber-500/25 bg-amber-950/15 p-3.5 space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-xs font-semibold text-amber-300 flex items-center gap-1.5">
                  <Sparkles size={14} /> ĐUA TOP HÔM NAY ({daily.dayKey || "Hôm nay"} · tự động trao giải lúc 00:05 VN)
                </div>
                <span className="text-[11px] font-mono text-slate-300">
                  Giải: 🥇 {fmtTokens(eff.dailyTop1Tokens)} · 🥈 {fmtTokens(eff.dailyTop2Tokens)} · 🥉 {fmtTokens(eff.dailyTop3Tokens)}
                </span>
              </div>
              {daily.rows?.length ? (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-2 pt-1">
                  {daily.rows.slice(0, 6).map((d, i) => (
                    <div key={d.telegramId} className="flex items-center justify-between px-3 py-2 rounded bg-slate-900/70 border border-slate-800 text-xs">
                      <div className="truncate">
                        <span className="mr-1.5">{MEDALS[i] || `#${i + 1}`}</span>
                        <span className="font-medium text-slate-200">{d.firstName || d.username || d.telegramId}</span>
                        {d.username && <span className="text-slate-400 ml-1">@{d.username}</span>}
                      </div>
                      <span className="font-mono font-bold text-emerald-400 ml-2">{d.count} người</span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-slate-400 italic">Hôm nay chưa có lượt xác minh kênh mới nào.</p>
              )}
            </div>

            {/* All-time Leaderboard */}
            {boardLoading ? (
              <p className="text-center py-8 text-sm text-gray-400">Đang tải...</p>
            ) : rows.length === 0 ? (
              <EmptyState icon={Trophy} message="Chưa có ai mời được người nào." />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-white/[0.06] text-left text-xs text-gray-500">
                      <th className="px-3 py-2.5 font-medium">#</th>
                      <th className="px-3 py-2.5 font-medium">Người mời</th>
                      <th className="px-3 py-2.5 font-medium text-right">Đã mời</th>
                      <th className="px-3 py-2.5 font-medium text-right">Hợp lệ</th>
                      <th className="px-3 py-2.5 font-medium text-right">Người mua</th>
                      <th className="px-3 py-2.5 font-medium text-right">Điểm ⭐</th>
                      <th className="px-3 py-2.5 font-medium text-right">Token nhận</th>
                      <th className="px-3 py-2.5 font-medium text-right">Đã chi</th>
                      <th className="px-3 py-2.5 font-medium text-right">Thao tác</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r, i) => (
                      <tr key={r.referrerId} className="border-b border-white/[0.04] hover:bg-white/[0.03] transition-colors">
                        <td className="px-3 py-3 text-xs text-gray-400 w-10">{MEDALS[i] || i + 1}</td>
                        <td className="px-3 py-3 text-xs">
                          <div className="font-medium text-gray-200 flex items-center gap-1.5">
                            {r.firstName || r.username || "—"}
                            {r.vipLevel > 0 && <Crown size={11} className="text-amber-400" />}
                          </div>
                          <div className="text-gray-400 font-mono">
                            {r.telegramId || <span className="text-red-400/70">user đã xoá</span>}
                            {r.username && ` · @${r.username}`}
                          </div>
                        </td>
                        <td className="px-3 py-3 text-right font-medium text-gray-200">{r.invited}</td>
                        <td className="px-3 py-3 text-right font-medium text-emerald-300">{r.rewarded}</td>
                        <td className="px-3 py-3 text-right font-medium text-cyan-300">{r.buyers || 0}</td>
                        <td className="px-3 py-3 text-right font-mono font-semibold text-amber-300">{r.referralPoints || 0}⭐</td>
                        <td className="px-3 py-3 text-right font-medium text-indigo-300">{fmtTokens(r.tokensEarned)}</td>
                        <td className="px-3 py-3 text-right text-xs text-gray-300">{formatCurrency(r.totalSpent)}</td>
                        <td className="px-3 py-3 text-right">
                          {r.telegramId && (
                            <button
                              onClick={() => {
                                setBonusTarget(r.telegramId);
                                window.scrollTo({ top: 0, behavior: "smooth" });
                              }}
                              className="px-2 py-1 rounded bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 border border-amber-500/30 text-[11px] font-mono cursor-pointer"
                            >
                              ⭐ Điểm
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* ── TAB 1B: PAIRED INVITE GRANTS ── */}
        {tab === "pairs" && (
          <div className="space-y-3 mt-2">
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative flex-1 min-w-[200px]">
                <Search size={13} className="absolute left-2.5 top-2 text-slate-500" />
                <input
                  value={pairSearch}
                  onChange={(e) => setPairSearch(e.target.value)}
                  placeholder="Tìm theo Telegram ID người được mời hoặc người mời..."
                  className="w-full dev-input rounded pl-8 pr-3 py-1.5 text-xs font-mono"
                />
              </div>
            </div>

            {pairsLoading ? (
              <p className="text-center py-8 text-xs text-slate-400">Đang tải danh sách ghép cặp...</p>
            ) : pairs.length === 0 ? (
              <EmptyState icon={Users} message="Chưa có cặp thưởng mời bạn nào." />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-white/[0.06] text-left text-slate-400">
                      <th className="px-3 py-2">Thời gian</th>
                      <th className="px-3 py-2">Bạn mới (Referred)</th>
                      <th className="px-3 py-2">Quà bạn mới</th>
                      <th className="px-3 py-2">Người mời (Referrer)</th>
                      <th className="px-3 py-2">Thưởng người mời</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pairs.map((p) => (
                      <tr key={p.invitedTgId} className="border-b border-white/[0.04] hover:bg-white/[0.02]">
                        <td className="px-3 py-2.5 font-mono text-slate-400">{formatDate(p.createdAt)}</td>
                        <td className="px-3 py-2.5">
                          <div className="font-medium text-slate-200">
                            {p.invitedUser?.firstName || p.invitedUser?.username || p.invitedTgId}
                          </div>
                          <div className="font-mono text-[11px] text-slate-400">{p.invitedTgId}</div>
                        </td>
                        <td className="px-3 py-2.5 font-mono">
                          <span className={p.referredStatus === "completed" ? "text-emerald-400 font-semibold" : "text-amber-300"}>
                            {p.referredTokens > 0 ? `+${fmtTokens(p.referredTokens)}` : "—"} ({p.referredStatus || "—"})
                          </span>
                        </td>
                        <td className="px-3 py-2.5">
                          <div className="font-medium text-slate-200">
                            {p.referrerUser?.firstName || p.referrerUser?.username || p.referrerTgId || "—"}
                          </div>
                          <div className="font-mono text-[11px] text-slate-400">{p.referrerTgId || "—"}</div>
                        </td>
                        <td className="px-3 py-2.5 font-mono">
                          <span className={p.referrerStatus === "completed" ? "text-cyan-300 font-semibold" : "text-amber-300"}>
                            {p.referrerTokens > 0 ? `+${fmtTokens(p.referrerTokens)}` : "—"} ({p.referrerMode || "—"} · {p.referrerStatus || "—"})
                            {p.lucky ? " 🍀" : ""}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* ── TAB 2: GRANTS LOG (RedeemRequest) ── */}
        {tab === "grants" && (
          <div className="space-y-3 mt-2">
            <div className="flex flex-wrap items-center gap-2">
              <select
                value={grantFilter.rewardType}
                onChange={(e) => setGrantFilter((p) => ({ ...p, rewardType: e.target.value }))}
                className="dev-input rounded px-2.5 py-1.5 text-xs"
              >
                <option value="">Tất cả nhánh thưởng</option>
                {Object.entries(GRANT_TYPE_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </select>
              <select
                value={grantFilter.status}
                onChange={(e) => setGrantFilter((p) => ({ ...p, status: e.target.value }))}
                className="dev-input rounded px-2.5 py-1.5 text-xs"
              >
                <option value="">Tất cả trạng thái</option>
                <option value="completed">Completed</option>
                <option value="failed">Failed (Chờ retry)</option>
                <option value="minting">Minting</option>
              </select>
              <div className="relative flex-1 min-w-[180px]">
                <Search size={13} className="absolute left-2.5 top-2 text-slate-500" />
                <input
                  value={grantFilter.q}
                  onChange={(e) => setGrantFilter((p) => ({ ...p, q: e.target.value }))}
                  placeholder="Tìm theo Telegram ID / ghi chú..."
                  className="w-full dev-input rounded pl-8 pr-3 py-1.5 text-xs font-mono"
                />
              </div>
              <button
                onClick={() => retryMut.mutate()}
                disabled={retryMut.isPending}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded text-xs font-mono cursor-pointer disabled:opacity-50"
              >
                <RefreshCw size={12} className={retryMut.isPending ? "animate-spin" : ""} />
                Retry lượt kẹt
              </button>
            </div>

            {grantsLoading ? (
              <p className="text-center py-8 text-xs text-slate-400">Đang tải nhật ký phát thưởng...</p>
            ) : grants.length === 0 ? (
              <EmptyState icon={Gift} message="Chưa có bản ghi phát thưởng nào khớp bộ lọc." />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-white/[0.06] text-left text-slate-400">
                      <th className="px-3 py-2">Thời gian</th>
                      <th className="px-3 py-2">Người nhận</th>
                      <th className="px-3 py-2">Nhánh thưởng</th>
                      <th className="px-3 py-2 text-right">Token cấp</th>
                      <th className="px-3 py-2 text-right">Điểm trừ</th>
                      <th className="px-3 py-2">Trạng thái</th>
                      <th className="px-3 py-2">Ghi chú</th>
                    </tr>
                  </thead>
                  <tbody>
                    {grants.map((g) => (
                      <tr key={g.id} className="border-b border-white/[0.04] hover:bg-white/[0.02]">
                        <td className="px-3 py-2.5 text-slate-400 font-mono">{formatDate(g.createdAt)}</td>
                        <td className="px-3 py-2.5">
                          <div className="font-medium text-slate-200">
                            {g.user?.firstName || g.user?.username || g.telegramId}
                          </div>
                          <div className="font-mono text-[11px] text-slate-400">
                            {g.telegramId}
                            {g.user?.username ? ` · @${g.user.username}` : ""}
                          </div>
                        </td>
                        <td className="px-3 py-2.5 font-medium text-indigo-300">
                          {GRANT_TYPE_LABELS[g.rewardType] || g.rewardType}
                        </td>
                        <td className="px-3 py-2.5 text-right font-mono font-semibold text-emerald-400">
                          {g.tokensGranted > 0 ? `+${fmtTokens(g.tokensGranted)}` : "—"}
                        </td>
                        <td className="px-3 py-2.5 text-right font-mono text-amber-300">
                          {g.pointsUsed > 0 ? `-${g.pointsUsed}⭐` : "—"}
                        </td>
                        <td className="px-3 py-2.5">
                          <span
                            className={`px-2 py-0.5 rounded font-mono text-[10px] uppercase ${
                              g.status === "completed"
                                ? "bg-emerald-950/60 text-emerald-300"
                                : g.status === "failed"
                                  ? "bg-rose-950/60 text-rose-300"
                                  : "bg-amber-950/60 text-amber-300"
                            }`}
                          >
                            {g.status}
                          </span>
                        </td>
                        <td className="px-3 py-2.5 font-mono text-[11px] text-slate-400 max-w-[240px] truncate" title={g.note || ""}>
                          {g.note || "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* ── TAB 3: REFERRAL EVENTS ── */}
        {tab === "events" && (
          <div className="space-y-3 mt-2">
            <div className="flex flex-wrap items-center gap-2">
              <select
                value={eventFilter.eventType}
                onChange={(e) => setEventFilter((p) => ({ ...p, eventType: e.target.value }))}
                className="dev-input rounded px-2.5 py-1.5 text-xs"
              >
                <option value="">Tất cả sự kiện</option>
                {Object.entries(EVENT_TYPE_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </select>
              <div className="relative flex-1 min-w-[180px]">
                <Search size={13} className="absolute left-2.5 top-2 text-slate-500" />
                <input
                  value={eventFilter.q}
                  onChange={(e) => setEventFilter((p) => ({ ...p, q: e.target.value }))}
                  placeholder="Tìm theo Telegram ID người mời / bạn mới..."
                  className="w-full dev-input rounded pl-8 pr-3 py-1.5 text-xs font-mono"
                />
              </div>
            </div>

            {eventsLoading ? (
              <p className="text-center py-8 text-xs text-slate-400">Đang tải sự kiện điểm...</p>
            ) : events.length === 0 ? (
              <EmptyState icon={Star} message="Chưa có sự kiện điểm giới thiệu nào." />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-white/[0.06] text-left text-slate-400">
                      <th className="px-3 py-2">Thời gian</th>
                      <th className="px-3 py-2">Người nhận điểm</th>
                      <th className="px-3 py-2">Từ người được mời</th>
                      <th className="px-3 py-2">Loại sự kiện</th>
                      <th className="px-3 py-2 text-right">Điểm</th>
                      <th className="px-3 py-2">Ghi chú</th>
                    </tr>
                  </thead>
                  <tbody>
                    {events.map((ev) => (
                      <tr key={ev.id} className="border-b border-white/[0.04] hover:bg-white/[0.02]">
                        <td className="px-3 py-2.5 text-slate-400 font-mono">{formatDate(ev.createdAt)}</td>
                        <td className="px-3 py-2.5">
                          <div className="font-medium text-slate-200">
                            {ev.referrerUser?.firstName || ev.referrerUser?.username || ev.referrerTgId}
                          </div>
                          <div className="font-mono text-[11px] text-slate-400">{ev.referrerTgId}</div>
                        </td>
                        <td className="px-3 py-2.5 font-mono text-slate-300">
                          {ev.referredUser
                            ? `${ev.referredUser.firstName || ev.referredUserId} (${ev.referredUserId})`
                            : ev.referredUserId}
                        </td>
                        <td className="px-3 py-2.5 text-indigo-300">
                          {EVENT_TYPE_LABELS[ev.eventType] || ev.eventType}
                        </td>
                        <td className="px-3 py-2.5 text-right font-mono font-bold text-amber-300">
                          {ev.points >= 0 ? `+${ev.points}⭐` : `${ev.points}⭐`}
                        </td>
                        <td className="px-3 py-2.5 text-slate-400 font-mono text-[11px]">{ev.note || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* ── TAB 4: WALLET COMMISSIONS ── */}
        {tab === "commissions" && (
          statsLoading ? (
            <p className="text-center py-8 text-sm text-gray-400">Đang tải...</p>
          ) : commissions.length === 0 ? (
            <EmptyState
              icon={Share2}
              message={
                eff.commissionPercent > 0
                  ? "Chưa có hoa hồng nào."
                  : "Hoa hồng ví đang tắt (0%) — hệ thống đang thưởng bằng API Key & Điểm Token."
              }
            />
          ) : (
            <div className="overflow-x-auto mt-3">
              <p className="text-xs text-gray-500 mb-2">
                Tổng hoa hồng đã trả: <b className="text-emerald-400">{formatCurrency(totalCommissions)}</b>
              </p>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-white/[0.06] text-left text-xs text-gray-500">
                    <th className="px-3 py-2.5 font-medium">Người giới thiệu</th>
                    <th className="px-3 py-2.5 font-medium">Người được giới thiệu</th>
                    <th className="px-3 py-2.5 font-medium">Hoa hồng</th>
                    <th className="px-3 py-2.5 font-medium">Trạng thái</th>
                    <th className="px-3 py-2.5 font-medium">Thời gian</th>
                  </tr>
                </thead>
                <tbody>
                  {commissions.map((c) => (
                    <tr key={c.id} className="border-b border-white/[0.04] hover:bg-white/[0.03]">
                      <td className="px-3 py-3 text-xs">
                        <div className="font-medium text-gray-200">{c.referrer?.firstName || "—"}</div>
                        <div className="text-gray-400">{c.referrer?.telegramId}</div>
                      </td>
                      <td className="px-3 py-3 text-xs">
                        <div className="font-medium text-gray-200">{c.referee?.firstName || "—"}</div>
                        <div className="text-gray-400">{c.referee?.telegramId}</div>
                      </td>
                      <td className="px-3 py-3 font-medium text-emerald-400">{formatCurrency(c.commission)}</td>
                      <td className="px-3 py-3">
                        <span className="text-xs px-2 py-0.5 rounded font-medium bg-emerald-950/60 text-emerald-300">
                          {c.status}
                        </span>
                      </td>
                      <td className="px-3 py-3 text-xs text-gray-400">{formatDate(c.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        )}

        {/* ── TAB 5: FULL SETTINGS CONFIG ── */}
        {tab === "config" && (
          <div className="mt-3 space-y-6 max-w-4xl">
            {/* Preview Box */}
            <div className="rounded-lg border border-indigo-500/30 bg-indigo-950/20 p-3.5 text-xs text-slate-300 space-y-1">
              <div className="font-mono text-[11px] text-indigo-300 font-semibold uppercase">
                XEM TRƯỚC LUẬT THƯỞNG TRÊN BOT
              </div>
              <p>
                • <b>Bạn mới:</b> Nhận Key riêng <b>{form.inviteTokenM || 0}M token</b> ({form.referralInviteTokenDays || 1} ngày)
                {form.referralWelcomeKeyEnabled ? ` + Mã quà WEL ngẫu nhiên ${form.referralWelcomeTokenMinM}M–${form.referralWelcomeTokenMaxM}M (${form.referralTokenNewKeyDays || 3} ngày)` : ""}
                {Number(form.referralPointJoinChannel) > 0 ? ` + ${form.referralPointJoinChannel}⭐ điểm` : ""}.
              </p>
              <p>
                • <b>Người mời:</b> Cộng dồn <b>+{form.inviteRefMinM}M–{form.inviteRefMaxM}M token</b> vào <b>Referral Key {form.referralInviteReferrerKeyDays} ngày</b>
                {form.referralLuckyProtectEnabled ? ` (Bảo hiểm xui >= ${form.luckyMinM}M sau 3 lượt thấp)` : ""}
                {form.referralMilestoneEnabled ? ` + Mốc 5/10/20 (+${form.ms5M}M / +${form.ms10M}M / +${form.ms20M}M)` : ""}.
              </p>
              <p>
                • <b>Đổi điểm (/tok):</b> <b>1⭐ = {form.tokenPerPointM}M token</b>, trần <b>{Number(form.tokenMaxPerUserM) > 0 ? `${form.tokenMaxPerUserM}M/đợt` : "không giới hạn"}</b>, RPM <b>{form.referralTokenNewKeyRpm}</b>.
              </p>
            </div>

            {/* Section 1: Master & Age Gate */}
            <div className="space-y-3">
              <h3 className="text-xs font-mono uppercase tracking-wider text-indigo-400 font-semibold flex items-center gap-1.5">
                <Shield size={14} /> 1. Công tắc tổng & Lọc tuổi tài khoản Telegram (Chống Clone)
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <ToggleSwitch
                  checked={Boolean(form.referralEnabled)}
                  onChange={(v) => setF("referralEnabled", v)}
                  label="Bật hệ thống Giới thiệu (referralEnabled)"
                  hint="Tắt công tắc này sẽ dừng toàn bộ liên kết mời mới và đổi quà."
                />
                <ToggleSwitch
                  checked={Boolean(form.referralAgeFilterEnabled)}
                  onChange={(v) => setF("referralAgeFilterEnabled", v)}
                  label="Lọc tuổi tài khoản Telegram (Peer Envelope)"
                  hint="Hoãn cộng điểm & key mời với acc Telegram quá mới; miễn lọc cho Telegram Premium."
                />
              </div>
              <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                <div>
                  <label className="text-xs text-slate-400 block mb-1">Tuổi TG tối thiểu (ngày)</label>
                  <input
                    type="number"
                    min="1"
                    max="90"
                    value={form.referralMinTgAgeDays ?? "7"}
                    onChange={(e) => setF("referralMinTgAgeDays", e.target.value)}
                    className="w-full glass-input rounded px-3 py-1.5 text-sm"
                  />
                </div>
                <div>
                  <label className="text-xs text-slate-400 block mb-1">Channel ID kiểm tra join</label>
                  <input
                    value={form.referralChannelId ?? ""}
                    onChange={(e) => setF("referralChannelId", e.target.value)}
                    placeholder="VD: -100123456789 (trống = theo ENV)"
                    className="w-full glass-input rounded px-3 py-1.5 text-xs font-mono"
                  />
                </div>
                <div>
                  <label className="text-xs text-slate-400 block mb-1">Link Channel (URL)</label>
                  <input
                    value={form.referralChannelUrl ?? ""}
                    onChange={(e) => setF("referralChannelUrl", e.target.value)}
                    placeholder="https://t.me/..."
                    className="w-full glass-input rounded px-3 py-1.5 text-xs font-mono"
                  />
                </div>
                <div>
                  <label className="text-xs text-slate-400 block mb-1">Chỉ tính lượt mời từ ngày</label>
                  <input
                    type="date"
                    value={form.REFERRAL_REWARD_SINCE ?? ""}
                    onChange={(e) => setF("REFERRAL_REWARD_SINCE", e.target.value)}
                    className="w-full glass-input rounded px-3 py-1.5 text-xs"
                  />
                </div>
              </div>
            </div>

            {/* Section 2: Auto 2-Way Invite Tokens & 30d Referral Key */}
            <div className="space-y-3 border-t border-white/[0.06] pt-4">
              <h3 className="text-xs font-mono uppercase tracking-wider text-emerald-400 font-semibold flex items-center gap-1.5">
                <Zap size={14} /> 2. Nhánh 1 — Tự động tặng Key 2 phía & Referral Key cộng dồn
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <ToggleSwitch
                  checked={Boolean(form.referralInviteTokenEnabled)}
                  onChange={(v) => setF("referralInviteTokenEnabled", v)}
                  label="Tự động cấp Key 2 phía khi bạn mới vào kênh"
                  hint="Bạn mới nhận key riêng; người mời được cộng dồn vào Referral Key."
                />
                <ToggleSwitch
                  checked={Boolean(form.referralLuckyProtectEnabled)}
                  onChange={(v) => setF("referralLuckyProtectEnabled", v)}
                  label="Bảo hiểm xui (Lucky Protect)"
                  hint="Sau 3 lượt liên tiếp quay dưới ngưỡng, lượt thứ 4 ép nổ từ ngưỡng trở lên."
                />
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div>
                  <label className="text-xs text-slate-400 block mb-1">Token Bạn mới (Triệu M)</label>
                  <input
                    type="number"
                    min="0"
                    value={form.inviteTokenM ?? "20"}
                    onChange={(e) => setF("inviteTokenM", e.target.value)}
                    className="w-full glass-input rounded px-3 py-1.5 text-sm"
                  />
                </div>
                <div>
                  <label className="text-xs text-slate-400 block mb-1">Hạn key Bạn mới (ngày)</label>
                  <input
                    type="number"
                    min="0"
                    value={form.referralInviteTokenDays ?? "1"}
                    onChange={(e) => setF("referralInviteTokenDays", e.target.value)}
                    className="w-full glass-input rounded px-3 py-1.5 text-sm"
                  />
                </div>
                <div>
                  <label className="text-xs text-slate-400 block mb-1">Người mời Min (Triệu M)</label>
                  <input
                    type="number"
                    min="1"
                    value={form.inviteRefMinM ?? "2"}
                    onChange={(e) => setF("inviteRefMinM", e.target.value)}
                    className="w-full glass-input rounded px-3 py-1.5 text-sm"
                  />
                </div>
                <div>
                  <label className="text-xs text-slate-400 block mb-1">Người mời Max (Triệu M)</label>
                  <input
                    type="number"
                    min="1"
                    value={form.inviteRefMaxM ?? "7"}
                    onChange={(e) => setF("inviteRefMaxM", e.target.value)}
                    className="w-full glass-input rounded px-3 py-1.5 text-sm"
                  />
                </div>
                <div>
                  <label className="text-xs text-slate-400 block mb-1">Hạn Referral Key (ngày)</label>
                  <input
                    type="number"
                    min="1"
                    max="400"
                    value={form.referralInviteReferrerKeyDays ?? "30"}
                    onChange={(e) => setF("referralInviteReferrerKeyDays", e.target.value)}
                    className="w-full glass-input rounded px-3 py-1.5 text-sm"
                  />
                </div>
                <div>
                  <label className="text-xs text-slate-400 block mb-1">Ngưỡng Lucky (Triệu M)</label>
                  <input
                    type="number"
                    min="1"
                    value={form.luckyMinM ?? "6"}
                    onChange={(e) => setF("luckyMinM", e.target.value)}
                    className="w-full glass-input rounded px-3 py-1.5 text-sm"
                  />
                </div>
                <div>
                  <label className="text-xs text-slate-400 block mb-1">Trần lượt / người mời</label>
                  <input
                    type="number"
                    min="0"
                    value={form.referralInviteTokenMaxPerReferrer ?? "0"}
                    onChange={(e) => setF("referralInviteTokenMaxPerReferrer", e.target.value)}
                    className="w-full glass-input rounded px-3 py-1.5 text-sm"
                  />
                  <span className="text-[10px] text-slate-500">0 = không giới hạn</span>
                </div>
                <div>
                  <label className="text-xs text-slate-400 block mb-1">Trần cặp / ngày toàn shop</label>
                  <input
                    type="number"
                    min="0"
                    value={form.referralInviteTokenMaxPairsPerDay ?? "0"}
                    onChange={(e) => setF("referralInviteTokenMaxPairsPerDay", e.target.value)}
                    className="w-full glass-input rounded px-3 py-1.5 text-sm"
                  />
                  <span className="text-[10px] text-slate-500">0 = không giới hạn</span>
                </div>
              </div>
            </div>

            {/* Section 3: Milestones, Expiry Warn & Daily Top */}
            <div className="space-y-3 border-t border-white/[0.06] pt-4">
              <h3 className="text-xs font-mono uppercase tracking-wider text-amber-400 font-semibold flex items-center gap-1.5">
                <Trophy size={14} /> 3. Nhánh 2 — Thưởng Mốc 5/10/20, Nhắc hết hạn & Đua Top Ngày
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <ToggleSwitch
                  checked={Boolean(form.referralMilestoneEnabled)}
                  onChange={(v) => setF("referralMilestoneEnabled", v)}
                  label="Thưởng Mốc 5 / 10 / 20 người"
                  hint="Nạp thẳng vào Referral Key 1 lần duy nhất mỗi mốc."
                />
                <ToggleSwitch
                  checked={Boolean(form.referralExpiryWarnEnabled)}
                  onChange={(v) => setF("referralExpiryWarnEnabled", v)}
                  label="Nhắc Referral Key còn 3d & 1d"
                  hint="Tự động gửi DM nhắc trước khi hết hạn."
                />
                <ToggleSwitch
                  checked={Boolean(form.referralDailyTopEnabled)}
                  onChange={(v) => setF("referralDailyTopEnabled", v)}
                  label="Trả thưởng Top 1–2–3 mỗi ngày"
                  hint={`Chạy lúc 00:05 VN (đã trả: ${eff.dailyTopLastPaidDate || "chưa"})`}
                />
              </div>
              <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
                <div>
                  <label className="text-xs text-slate-400 block mb-1">Mốc 5 người (M)</label>
                  <input type="number" min="0" value={form.ms5M ?? "15"} onChange={(e) => setF("ms5M", e.target.value)} className="w-full glass-input rounded px-3 py-1.5 text-sm" />
                </div>
                <div>
                  <label className="text-xs text-slate-400 block mb-1">Mốc 10 người (M)</label>
                  <input type="number" min="0" value={form.ms10M ?? "25"} onChange={(e) => setF("ms10M", e.target.value)} className="w-full glass-input rounded px-3 py-1.5 text-sm" />
                </div>
                <div>
                  <label className="text-xs text-slate-400 block mb-1">Mốc 20 người (M)</label>
                  <input type="number" min="0" value={form.ms20M ?? "50"} onChange={(e) => setF("ms20M", e.target.value)} className="w-full glass-input rounded px-3 py-1.5 text-sm" />
                </div>
                <div>
                  <label className="text-xs text-slate-400 block mb-1">🥇 Top 1 ngày (M)</label>
                  <input type="number" min="0" value={form.top1M ?? "50"} onChange={(e) => setF("top1M", e.target.value)} className="w-full glass-input rounded px-3 py-1.5 text-sm" />
                </div>
                <div>
                  <label className="text-xs text-slate-400 block mb-1">🥈 Top 2 ngày (M)</label>
                  <input type="number" min="0" value={form.top2M ?? "30"} onChange={(e) => setF("top2M", e.target.value)} className="w-full glass-input rounded px-3 py-1.5 text-sm" />
                </div>
                <div>
                  <label className="text-xs text-slate-400 block mb-1">🥉 Top 3 ngày (M)</label>
                  <input type="number" min="0" value={form.top3M ?? "15"} onChange={(e) => setF("top3M", e.target.value)} className="w-full glass-input rounded px-3 py-1.5 text-sm" />
                </div>
              </div>
            </div>

            {/* Section 4: Welcome Key WEL... */}
            <div className="space-y-3 border-t border-white/[0.06] pt-4">
              <h3 className="text-xs font-mono uppercase tracking-wider text-pink-400 font-semibold flex items-center gap-1.5">
                <Gift size={14} /> 4. Nhánh 3 — Mã quà chào mừng bạn mới (WELxxxxxxxx)
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-4 gap-3 items-start">
                <div className="md:col-span-1">
                  <ToggleSwitch
                    checked={Boolean(form.referralWelcomeKeyEnabled)}
                    onChange={(v) => setF("referralWelcomeKeyEnabled", v)}
                    label="Bật Welcome Key"
                    hint="Tự phát khi vào link ref <= 30p đầu."
                  />
                </div>
                <div>
                  <label className="text-xs text-slate-400 block mb-1">Token tối thiểu (Triệu M)</label>
                  <input type="number" min="1" value={form.referralWelcomeTokenMinM ?? "5"} onChange={(e) => setF("referralWelcomeTokenMinM", e.target.value)} className="w-full glass-input rounded px-3 py-1.5 text-sm" />
                </div>
                <div>
                  <label className="text-xs text-slate-400 block mb-1">Token tối đa (Triệu M)</label>
                  <input type="number" min="1" value={form.referralWelcomeTokenMaxM ?? "10"} onChange={(e) => setF("referralWelcomeTokenMaxM", e.target.value)} className="w-full glass-input rounded px-3 py-1.5 text-sm" />
                </div>
                <div>
                  <label className="text-xs text-slate-400 block mb-1">Trần phát / ngày toàn shop</label>
                  <input type="number" min="0" value={form.referralWelcomeMaxPerDay ?? "0"} onChange={(e) => setF("referralWelcomeMaxPerDay", e.target.value)} className="w-full glass-input rounded px-3 py-1.5 text-sm" />
                  <span className="text-[10px] text-slate-500">0 = không giới hạn</span>
                </div>
              </div>
            </div>

            {/* Section 5: Points & Token Redeem */}
            <div className="space-y-3 border-t border-white/[0.06] pt-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-xs font-mono uppercase tracking-wider text-cyan-400 font-semibold flex items-center gap-1.5">
                  <Coins size={14} /> 5. Nhánh 4 — Tích điểm ⭐, Đổi điểm lấy Token (/tok) & Coupon Buyer
                </h3>
                <button
                  type="button"
                  onClick={() => {
                    if (window.confirm("Reset đợt đổi điểm mới? Trần token/user sẽ tính lại từ thời điểm này.")) {
                      resetBatchMut.mutate();
                    }
                  }}
                  disabled={resetBatchMut.isPending}
                  className="flex items-center gap-1.5 px-3 py-1 rounded bg-cyan-500/15 hover:bg-cyan-500/25 text-cyan-300 border border-cyan-500/30 text-xs font-mono cursor-pointer"
                >
                  <RotateCcw size={12} />
                  {resetBatchMut.isPending ? "Đang reset..." : "Reset đợt đổi điểm mới"}
                </button>
              </div>
              {eff.tokenRedeemResetAt && (
                <p className="text-[11px] font-mono text-slate-400">
                  Đợt đổi điểm hiện tại bắt đầu từ: <span className="text-cyan-300">{formatDate(eff.tokenRedeemResetAt)}</span>
                </p>
              )}

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <ToggleSwitch
                  checked={Boolean(form.referralRedeemEnabled)}
                  onChange={(v) => setF("referralRedeemEnabled", v)}
                  label="Mở menu Đổi quà"
                  hint="Hiển thị nút Đổi điểm trong mục Giới thiệu."
                />
                <ToggleSwitch
                  checked={Boolean(form.referralTokenRedeemEnabled)}
                  onChange={(v) => setF("referralTokenRedeemEnabled", v)}
                  label="Cho phép đổi Điểm → Token"
                  hint="Nạp vào key cũ hoặc tạo key mới (1 lần/ngày)."
                />
                <ToggleSwitch
                  checked={Boolean(form.tokenRedeemBroadcastEnabled)}
                  onChange={(v) => setF("tokenRedeemBroadcastEnabled", v)}
                  label="Broadcast Social-Proof"
                  hint="Thông báo toàn shop khi có khách đổi ra key mới."
                />
              </div>

              <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
                <div>
                  <label className="text-xs text-slate-400 block mb-1">Điểm lúc /start</label>
                  <input type="number" min="0" value={form.referralPointStartBot ?? "0"} onChange={(e) => setF("referralPointStartBot", e.target.value)} className="w-full glass-input rounded px-3 py-1.5 text-sm" />
                </div>
                <div>
                  <label className="text-xs text-slate-400 block mb-1">Điểm vào kênh (2 bên)</label>
                  <input type="number" min="0" value={form.referralPointJoinChannel ?? "1"} onChange={(e) => setF("referralPointJoinChannel", e.target.value)} className="w-full glass-input rounded px-3 py-1.5 text-sm" />
                </div>
                <div>
                  <label className="text-xs text-slate-400 block mb-1">Điểm mua đơn đầu</label>
                  <input type="number" min="0" value={form.referralPointPurchase ?? "3"} onChange={(e) => setF("referralPointPurchase", e.target.value)} className="w-full glass-input rounded px-3 py-1.5 text-sm" />
                </div>
                <div>
                  <label className="text-xs text-slate-400 block mb-1">Mốc N người mua</label>
                  <input type="number" min="0" value={form.referralBuyerTarget ?? "3"} onChange={(e) => setF("referralBuyerTarget", e.target.value)} className="w-full glass-input rounded px-3 py-1.5 text-sm" />
                </div>
                <div>
                  <label className="text-xs text-slate-400 block mb-1">% Coupon thưởng mốc</label>
                  <input type="number" min="0" max="95" value={form.referralPersonalVoucherPercent ?? "49"} onChange={(e) => setF("referralPersonalVoucherPercent", e.target.value)} className="w-full glass-input rounded px-3 py-1.5 text-sm" />
                </div>
                <div>
                  <label className="text-xs text-slate-400 block mb-1">+Giờ BH mốc buyer</label>
                  <input type="number" min="0" value={form.referralExtraWarrantyHours ?? "48"} onChange={(e) => setF("referralExtraWarrantyHours", e.target.value)} className="w-full glass-input rounded px-3 py-1.5 text-sm" />
                </div>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-5 gap-3 pt-1">
                <div>
                  <label className="text-xs text-slate-400 block mb-1">1 Điểm = (Triệu M)</label>
                  <input type="number" min="1" value={form.tokenPerPointM ?? "10"} onChange={(e) => setF("tokenPerPointM", e.target.value)} className="w-full glass-input rounded px-3 py-1.5 text-sm" />
                </div>
                <div>
                  <label className="text-xs text-slate-400 block mb-1">Trần / user / đợt (M)</label>
                  <input type="number" min="0" value={form.tokenMaxPerUserM ?? "100"} onChange={(e) => setF("tokenMaxPerUserM", e.target.value)} className="w-full glass-input rounded px-3 py-1.5 text-sm" />
                </div>
                <div>
                  <label className="text-xs text-slate-400 block mb-1">RPM Key mới / Quà</label>
                  <input type="number" min="0" value={form.referralTokenNewKeyRpm ?? "100"} onChange={(e) => setF("referralTokenNewKeyRpm", e.target.value)} className="w-full glass-input rounded px-3 py-1.5 text-sm" />
                  <span className="text-[10px] text-slate-500">0 = theo server ({cfgData?.shopRpm ?? 100})</span>
                </div>
                <div>
                  <label className="text-xs text-slate-400 block mb-1">Hạn Key mới / WEL (ngày)</label>
                  <input type="number" min="0" value={form.referralTokenNewKeyDays ?? "3"} onChange={(e) => setF("referralTokenNewKeyDays", e.target.value)} className="w-full glass-input rounded px-3 py-1.5 text-sm" />
                </div>
                <div>
                  <label className="text-xs text-slate-400 block mb-1">Hoa hồng ví (%/đơn)</label>
                  <input type="number" min="0" max="100" value={form.REFERRAL_COMMISSION ?? "0"} onChange={(e) => setF("REFERRAL_COMMISSION", e.target.value)} className="w-full glass-input rounded px-3 py-1.5 text-sm" />
                  <span className="text-[10px] text-slate-500">0 = tắt</span>
                </div>
              </div>

              {form.tokenRedeemBroadcastEnabled && (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 pt-1">
                  <div>
                    <label className="text-xs text-slate-400 block mb-1">Tỷ lệ Broadcast (%)</label>
                    <input type="number" min="0" max="100" value={form.tokenRedeemBroadcastChance ?? "100"} onChange={(e) => setF("tokenRedeemBroadcastChance", e.target.value)} className="w-full glass-input rounded px-3 py-1.5 text-sm" />
                  </div>
                  <div>
                    <label className="text-xs text-slate-400 block mb-1">Cooldown giữa 2 tin (phút)</label>
                    <input type="number" min="0" value={form.tokenRedeemBroadcastCooldownMin ?? "0"} onChange={(e) => setF("tokenRedeemBroadcastCooldownMin", e.target.value)} className="w-full glass-input rounded px-3 py-1.5 text-sm" />
                  </div>
                  <div>
                    <label className="text-xs text-slate-400 block mb-1">Cửa sổ giới hạn (phút)</label>
                    <input type="number" min="1" value={form.tokenRedeemBroadcastWindowMin ?? "30"} onChange={(e) => setF("tokenRedeemBroadcastWindowMin", e.target.value)} className="w-full glass-input rounded px-3 py-1.5 text-sm" />
                  </div>
                  <div>
                    <label className="text-xs text-slate-400 block mb-1">Tối đa tin / cửa sổ</label>
                    <input type="number" min="0" value={form.tokenRedeemBroadcastWindowMax ?? "5"} onChange={(e) => setF("tokenRedeemBroadcastWindowMax", e.target.value)} className="w-full glass-input rounded px-3 py-1.5 text-sm" />
                  </div>
                </div>
              )}
            </div>

            {/* Section 6: 4 Classic Account / Product Redeem Tiers */}
            <div className="space-y-3 border-t border-white/[0.06] pt-4">
              <h3 className="text-xs font-mono uppercase tracking-wider text-violet-400 font-semibold flex items-center gap-1.5">
                <Package size={14} /> 6. 4 Tier Đổi Account / Sản phẩm Cổ điển (Cooldown 3 ngày · Xuất Đơn 0đ)
              </h3>
              <p className="text-xs text-slate-400">
                Nhập <b>Mã sản phẩm (code)</b> cho mốc muốn mở; để trống (<code>""</code>) Bot sẽ tự ẩn nút đó để tập trung vào đổi Token API.
              </p>

              <datalist id="referral-product-codes">
                {allProducts.map((p) => (
                  <option key={p.id} value={p.code}>{p.name}</option>
                ))}
              </datalist>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {[
                  { label: "🎁 Tier Basic", slugKey: "referralRedeemBasicSlug", ptsKey: "referralRedeemBasicPoints", defPts: "1" },
                  { label: "🛡️ Tier BH 3 ngày", slugKey: "referralRedeemBh3dSlug", ptsKey: "referralRedeemBh3dPoints", defPts: "2" },
                  { label: "💎 Tier BH 7 ngày", slugKey: "referralRedeemBh7dSlug", ptsKey: "referralRedeemBh7dPoints", defPts: "3" },
                  { label: "🤖 Tier GPT 7 ngày", slugKey: "referralRedeemGptSlug", ptsKey: "referralRedeemGptPoints", defPts: "5" },
                ].map((t) => (
                  <div key={t.slugKey} className="p-3 rounded-lg bg-slate-900/50 border border-slate-800/80 grid grid-cols-12 gap-2.5 items-end">
                    <div className="col-span-8">
                      <label className="text-xs text-slate-300 font-medium block mb-1">{t.label} — Mã SP</label>
                      <input
                        list="referral-product-codes"
                        value={form[t.slugKey] ?? ""}
                        onChange={(e) => setF(t.slugKey, e.target.value)}
                        placeholder="Để trống = ẩn nút trên Bot"
                        className="w-full glass-input rounded px-2.5 py-1.5 text-xs font-mono"
                      />
                    </div>
                    <div className="col-span-4">
                      <label className="text-xs text-slate-400 block mb-1">Số điểm ⭐</label>
                      <input
                        type="number"
                        min="1"
                        value={form[t.ptsKey] ?? t.defPts}
                        onChange={(e) => setF(t.ptsKey, e.target.value)}
                        className="w-full glass-input rounded px-2.5 py-1.5 text-sm"
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Save Bar */}
            <div className="flex items-center gap-3 pt-2">
              <button
                onClick={handleSaveConfig}
                disabled={saveMut.isPending}
                className="flex items-center gap-1.5 px-5 py-2.5 bg-indigo-600 text-white rounded-lg text-xs font-mono font-semibold hover:bg-indigo-500 disabled:opacity-50 transition-colors cursor-pointer shadow-sm"
              >
                <Save size={14} />
                {saveMut.isPending ? "ĐANG LƯU..." : "LƯU TOÀN BỘ CÀI ĐẶT"}
              </button>
              {saveMut.isSuccess && (
                <p className="text-xs text-emerald-400 font-mono">
                  ✓ Đã lưu thành công — áp dụng ngay lập tức trên Bot!
                </p>
              )}
              {saveMut.isError && (
                <p className="text-xs text-rose-400 font-mono">
                  ✕ {saveMut.error?.response?.data?.error || "Lưu thất bại"}
                </p>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
