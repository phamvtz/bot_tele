import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Share2, Copy, Check, Users, Coins, Save, Trophy, Gift, Crown } from "lucide-react";
import { api } from "../../api/endpoints";
import StatsCard from "../../components/StatsCard";
import TabFilter from "../../components/TabFilter";
import EmptyState from "../../components/EmptyState";
import { formatCurrency, formatDate } from "../../utils/format";

const TABS = [
  { value: "leaderboard", label: "Bảng xếp hạng" },
  { value: "referrals", label: "Đã giới thiệu" },
  { value: "commissions", label: "Hoa hồng" },
  { value: "config", label: "Cài đặt quà" },
];

// 20000000 → "20M". Dùng chung cách hiển thị với tab Cửa hàng API key.
function fmtTokens(n) {
  const v = Number(n) || 0;
  if (v <= 0) return "0";
  const m = v / 1e6;
  return Number.isInteger(m) ? `${m}M` : `${Number(m.toFixed(2))}M`;
}

const MEDALS = ["🥇", "🥈", "🥉"];

export default function Referral() {
  const [tab, setTab] = useState("leaderboard");
  const [copied, setCopied] = useState(false);
  const [form, setForm] = useState({});
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({ queryKey: ["referral-stats"], queryFn: api.referralStats });
  const { data: board, isLoading: boardLoading } = useQuery({ queryKey: ["referral-leaderboard"], queryFn: () => api.referralLeaderboard(100) });
  const { data: cfgData } = useQuery({ queryKey: ["referral-config"], queryFn: api.referralConfig });
  const { data: botStatus } = useQuery({ queryKey: ["bot-status"], queryFn: api.botStatus, staleTime: 60000 });

  const saved = cfgData?.config || {};
  const eff = cfgData?.effective || {};
  // Ô trống = "theo ENV/mặc định" → đổ giá trị ĐANG áp dụng vào để admin thấy số thật.
  const f = (key, effValue) => form[key] ?? (saved[key] ?? (effValue === undefined || effValue === null ? "" : String(effValue)));
  const setF = (key, val) => setForm((p) => ({ ...p, [key]: val }));

  const saveMut = useMutation({
    mutationFn: (d) => api.updateReferralConfig(d),
    onSuccess: () => {
      setForm({});
      qc.invalidateQueries({ queryKey: ["referral-config"] });
    },
  });

  useEffect(() => { setForm({}); }, [cfgData]);

  const botUsername = botStatus?.username;
  const referralLink = botUsername ? `https://t.me/${botUsername}?start=ref_` : null;

  const totals = board?.totals || {};
  const rows = board?.rows || [];
  const commissions = data?.commissions || [];
  const referrals = data?.referrals || [];
  const totalCommissions = data?.totalCommissions || 0;

  function copyLink() {
    navigator.clipboard.writeText(referralLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const offerText = eff.enabled
    ? `Mời 1 người → CẢ HAI nhận API key ${fmtTokens(eff.tokens)} token, hạn ${eff.days > 0 ? `${eff.days} ngày` : "không hết hạn"}`
    : "Quà mời bạn đang TẮT (số token = 0)";

  return (
    <div>
      <h1 className="text-xl font-bold text-white mb-1">Chương trình mời bạn</h1>
      <p className="text-sm text-gray-500 mb-5">{offerText}</p>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <StatsCard icon={Users} label="Lượt mời" value={String(totals.invited ?? "—")} iconBg="bg-purple-950/60" iconColor="text-purple-400" />
        <StatsCard icon={Gift} label="Đã phát quà" value={String(totals.rewarded ?? "—")} iconBg="bg-pink-950/60" iconColor="text-pink-400" />
        <StatsCard icon={Coins} label="Token đã tặng" value={totals.tokensGiven != null ? `${fmtTokens(totals.tokensGiven)} (${totals.keysGiven || 0} key)` : "—"} iconBg="bg-amber-950/60" iconColor="text-amber-400" />
        <StatsCard icon={Trophy} label="Người mời" value={String(totals.inviters ?? "—")} iconBg="bg-blue-950/60" iconColor="text-blue-400" />
      </div>

      <div className="glass rounded-xl p-5 mb-4">
        <p className="text-sm font-medium text-gray-300 mb-2">Link giới thiệu (mẫu)</p>
        {referralLink ? (
          <>
            <div className="flex items-center gap-2 glass border border-white/[0.07] rounded-lg px-3 py-2">
              <span className="text-sm text-gray-300 flex-1 truncate font-mono">{referralLink}<span className="text-gray-500">[MÃ_USER]</span></span>
              <button onClick={copyLink} className="flex items-center gap-1.5 px-3 py-1.5 bg-primary-500 text-white rounded-lg text-xs font-medium hover:bg-primary-600 transition-colors flex-shrink-0 shadow-glow-sm hover:shadow-glow">
                {copied ? <Check size={12} /> : <Copy size={12} />}
                {copied ? "Đã sao chép" : "Sao chép mẫu"}
              </button>
            </div>
            <p className="text-xs text-gray-400 mt-2">
              Mỗi user có mã riêng. Quà phát khi người được mời <b>chọn ngôn ngữ và vào nhóm xong</b> — bấm link rồi bỏ đi giữa chừng thì không tính.
            </p>
          </>
        ) : (
          <div className="bg-amber-950/30 border border-amber-800/30 rounded-lg px-3 py-2.5 text-xs text-amber-300">
            ⚠ Bot chưa online hoặc chưa lấy được username. Hãy kiểm tra trạng thái bot tại <span className="font-semibold">Cấu hình Bot</span>.
          </div>
        )}
      </div>

      <div className="glass rounded-xl p-4">
        <TabFilter tabs={TABS} active={tab} onChange={setTab} />

        {tab === "config" ? (
          <div className="mt-4 space-y-5 max-w-xl">
            <div className="bg-primary-950/30 border border-primary-800/30 rounded-lg px-3 py-2.5 text-xs text-primary-300">
              Đang áp dụng: <b>{fmtTokens(eff.tokens)} token</b> · hạn <b>{eff.days > 0 ? `${eff.days} ngày` : "không hết hạn"}</b> · RPM{" "}
              <b>{eff.rpm > 0 ? eff.rpm : `${cfgData?.shopRpm ?? 300} (theo cửa hàng API key)`}</b>
              {eff.since ? <> · chỉ tính lượt mời từ <b>{eff.since}</b></> : null}
              . Mỗi lượt mời tốn <b>2 key</b> (người mời + người được mời).
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-xs font-medium text-gray-400 block mb-1">Token mỗi key (triệu)</label>
                <input type="number" min="0" max="100000" value={f("REFERRAL_REWARD_TOKENS_M", eff.tokensM)}
                  onChange={(e) => setF("REFERRAL_REWARD_TOKENS_M", e.target.value)}
                  className="w-full glass-input rounded-lg px-3 py-2 text-sm" />
                <p className="text-xs text-gray-400 mt-1">
                  = {fmtTokens((Number(f("REFERRAL_REWARD_TOKENS_M", eff.tokensM)) || 0) * 1e6)} token cho <b>mỗi bên</b>. Đặt 0 để tắt hẳn quà.
                </p>
              </div>
              <div>
                <label className="text-xs font-medium text-gray-400 block mb-1">Hạn dùng (ngày)</label>
                <input type="number" min="0" max="3650" value={f("REFERRAL_REWARD_DAYS", eff.days)}
                  onChange={(e) => setF("REFERRAL_REWARD_DAYS", e.target.value)}
                  className="w-full glass-input rounded-lg px-3 py-2 text-sm" />
                <p className="text-xs text-gray-400 mt-1">0 = không hết hạn theo thời gian (chỉ hết khi cạn quota).</p>
              </div>
              <div>
                <label className="text-xs font-medium text-gray-400 block mb-1">RPM của key</label>
                <input type="number" min="0" max="100000" value={f("REFERRAL_REWARD_RPM", eff.rpm)}
                  onChange={(e) => setF("REFERRAL_REWARD_RPM", e.target.value)}
                  className="w-full glass-input rounded-lg px-3 py-2 text-sm" />
                <p className="text-xs text-gray-400 mt-1">Mặc định 100. Đặt 0 để dùng RPM của cửa hàng API key ({cfgData?.shopRpm ?? 300}).</p>
              </div>
              <div>
                <label className="text-xs font-medium text-gray-400 block mb-1">Chỉ tính lượt mời từ ngày</label>
                <input type="date" value={f("REFERRAL_REWARD_SINCE", eff.since)}
                  onChange={(e) => setF("REFERRAL_REWARD_SINCE", e.target.value)}
                  className="w-full glass-input rounded-lg px-3 py-2 text-sm" />
                <p className="text-xs text-gray-400 mt-1">
                  Để trống = trả bù cho <b>mọi</b> cặp giới thiệu cũ ở lần /start kế tiếp. Cẩn thận, rất tốn quota.
                </p>
              </div>
            </div>

            <div className="border-t border-white/[0.06] pt-4">
              <label className="text-xs font-medium text-gray-400 block mb-1">Hoa hồng mỗi đơn (%)</label>
              <div className="flex items-center gap-2">
                <input type="number" min="0" max="100" value={f("REFERRAL_COMMISSION", eff.commissionPercent)}
                  onChange={(e) => setF("REFERRAL_COMMISSION", e.target.value)}
                  className="w-24 glass-input rounded-lg px-3 py-2 text-sm" />
                <span className="text-xs text-gray-500">% cộng vào ví người mời mỗi khi người được mời mua hàng</span>
              </div>
              <p className="text-xs text-gray-400 mt-1">
                <b>0 = tắt</b> (mặc định — chương trình trả bằng API key). Đặt &gt; 0 nếu muốn chạy song song cả hai.
              </p>
            </div>

            <div className="flex items-center gap-3">
              <button
                onClick={() => saveMut.mutate({
                  REFERRAL_REWARD_TOKENS_M: f("REFERRAL_REWARD_TOKENS_M", eff.tokensM),
                  REFERRAL_REWARD_DAYS: f("REFERRAL_REWARD_DAYS", eff.days),
                  REFERRAL_REWARD_RPM: f("REFERRAL_REWARD_RPM", eff.rpm),
                  REFERRAL_REWARD_SINCE: f("REFERRAL_REWARD_SINCE", eff.since),
                  REFERRAL_COMMISSION: f("REFERRAL_COMMISSION", eff.commissionPercent),
                })}
                disabled={saveMut.isPending}
                className="flex items-center gap-1.5 px-4 py-2 bg-primary-500 text-white rounded-lg text-sm font-medium hover:bg-primary-600 disabled:opacity-50 transition-colors shadow-glow-sm hover:shadow-glow">
                <Save size={14} />
                {saveMut.isPending ? "Đang lưu..." : "Lưu cài đặt"}
              </button>
              {saveMut.isSuccess && <p className="text-xs text-emerald-400">✓ Đã lưu — bot áp dụng ngay, không cần restart</p>}
              {saveMut.isError && <p className="text-xs text-red-400">{saveMut.error?.response?.data?.error || "Lưu thất bại"}</p>}
            </div>
          </div>
        ) : tab === "leaderboard" ? (
          boardLoading ? (
            <p className="text-center py-8 text-sm text-gray-400">Đang tải...</p>
          ) : rows.length === 0 ? (
            <EmptyState icon={Trophy} message="Chưa có ai mời được người nào." />
          ) : (
            <div className="overflow-x-auto mt-3">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-white/[0.06] text-left text-xs text-gray-500">
                    <th className="px-3 py-2.5 font-medium rounded-l-lg">#</th>
                    <th className="px-3 py-2.5 font-medium">Người mời</th>
                    <th className="px-3 py-2.5 font-medium text-right">Đã mời</th>
                    <th className="px-3 py-2.5 font-medium text-right">Đã phát quà</th>
                    <th className="px-3 py-2.5 font-medium text-right">Token đã nhận</th>
                    <th className="px-3 py-2.5 font-medium text-right">Đã chi</th>
                    <th className="px-3 py-2.5 font-medium rounded-r-lg">Mời gần nhất</th>
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
                      <td className="px-3 py-3 text-right font-medium text-pink-300">{r.rewarded}</td>
                      <td className="px-3 py-3 text-right font-medium text-amber-300">{fmtTokens(r.tokensEarned)}</td>
                      <td className="px-3 py-3 text-right text-xs text-gray-300">{formatCurrency(r.totalSpent)}</td>
                      <td className="px-3 py-3 text-xs text-gray-400">{formatDate(r.lastInviteAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="text-xs text-gray-500 mt-3">
                Xếp theo số lượt <b>đã phát quà</b> trước (mời thật, người được mời đã qua onboarding), rồi mới tới tổng lượt mời.
                "Token đã nhận" là tổng quota các key nguồn <b>Mời bạn</b> của chính người đó.
              </p>
            </div>
          )
        ) : isLoading ? (
          <p className="text-center py-8 text-sm text-gray-400">Đang tải...</p>
        ) : tab === "commissions" ? (
          commissions.length === 0 ? (
            <EmptyState icon={Share2} message={eff.commissionPercent > 0 ? "Chưa có hoa hồng nào." : "Hoa hồng đang tắt (0%) — chương trình trả bằng API key."} />
          ) : (
            <div className="overflow-x-auto mt-3">
              <p className="text-xs text-gray-500 mb-2">Tổng hoa hồng đã trả: <b className="text-emerald-400">{formatCurrency(totalCommissions)}</b></p>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-white/[0.06] text-left text-xs text-gray-500">
                    <th className="px-3 py-2.5 font-medium rounded-l-lg">Người giới thiệu</th>
                    <th className="px-3 py-2.5 font-medium">Người được giới thiệu</th>
                    <th className="px-3 py-2.5 font-medium">Hoa hồng</th>
                    <th className="px-3 py-2.5 font-medium">Trạng thái</th>
                    <th className="px-3 py-2.5 font-medium rounded-r-lg">Thời gian</th>
                  </tr>
                </thead>
                <tbody>
                  {commissions.map((c) => (
                    <tr key={c.id} className="border-b border-white/[0.04] hover:bg-white/[0.03] transition-colors">
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
                        <span className={`text-xs px-2 py-0.5 rounded font-medium ${c.status === "PAID" ? "bg-emerald-950/60 text-emerald-300" : "bg-yellow-950/60 text-yellow-300"}`}>
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
        ) : (
          referrals.length === 0 ? (
            <EmptyState icon={Users} message="Chưa có người dùng nào được giới thiệu." />
          ) : (
            <div className="overflow-x-auto mt-3">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-white/[0.06] text-left text-xs text-gray-500">
                    <th className="px-3 py-2.5 font-medium rounded-l-lg">Chat ID</th>
                    <th className="px-3 py-2.5 font-medium">Tên</th>
                    <th className="px-3 py-2.5 font-medium">Đã chi</th>
                    <th className="px-3 py-2.5 font-medium rounded-r-lg">Ngày tham gia</th>
                  </tr>
                </thead>
                <tbody>
                  {referrals.map((u) => (
                    <tr key={u.id} className="border-b border-white/[0.04] hover:bg-white/[0.03] transition-colors">
                      <td className="px-3 py-3 font-mono text-xs text-primary-600">{u.telegramId}</td>
                      <td className="px-3 py-3 text-xs">
                        <div className="font-medium text-gray-200">{u.firstName || "—"}</div>
                        {u.username && <div className="text-gray-400">@{u.username}</div>}
                      </td>
                      <td className="px-3 py-3 text-xs text-gray-300">{formatCurrency(u.totalSpent || 0)}</td>
                      <td className="px-3 py-3 text-xs text-gray-400">{formatDate(u.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        )}
      </div>
    </div>
  );
}
