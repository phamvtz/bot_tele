import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Share2, Copy, Check, Users, DollarSign, Save } from "lucide-react";
import { api } from "../../api/endpoints";
import StatsCard from "../../components/StatsCard";
import TabFilter from "../../components/TabFilter";
import EmptyState from "../../components/EmptyState";
import { formatCurrency, formatDate } from "../../utils/format";

const TABS = [
  { value: "commissions", label: "Hoa hồng" },
  { value: "referrals", label: "Đã giới thiệu" },
  { value: "config", label: "Cài đặt" },
];

export default function Referral() {
  const [tab, setTab] = useState("commissions");
  const [copied, setCopied] = useState(false);
  const [cfgForm, setCfgForm] = useState({});
  const qc = useQueryClient();

  const { data: settingsData } = useQuery({ queryKey: ["settings"], queryFn: api.settings });
  const { data, isLoading } = useQuery({ queryKey: ["referral-stats"], queryFn: api.referralStats });
  const settings = settingsData?.settings || settingsData || {};
  const cf = (key, def = "") => cfgForm[key] ?? settings[key] ?? def;
  const setCf = (key, val) => setCfgForm((p) => ({ ...p, [key]: val }));

  const saveMut = useMutation({
    mutationFn: (d) => api.updateSettings(d),
    onSuccess: () => qc.invalidateQueries(["settings"]),
  });

  useEffect(() => {
    if (settingsData) setCfgForm({});
  }, [settingsData]);

  const shopSlug = settings.SHOP_SLUG || "your-shop";
  const referralLink = `${window.location.origin}/register?ref=${shopSlug}`;

  const totalCommissions = data?.totalCommissions || 0;
  const totalReferrals = data?.totalReferrals || 0;
  const commissions = data?.commissions || [];
  const referrals = data?.referrals || [];

  function copyLink() {
    navigator.clipboard.writeText(referralLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div>
      <h1 className="text-xl font-bold text-white mb-1">Affiliate Program</h1>
      <p className="text-sm text-gray-500 mb-5">Giới thiệu khách hàng mới, nhận hoa hồng mỗi lần thanh toán</p>

      <div className="grid grid-cols-3 gap-4 mb-6">
        <StatsCard icon={DollarSign} label="Tổng hoa hồng" value={formatCurrency(totalCommissions)} iconBg="bg-green-950/60" iconColor="text-emerald-400" />
        <StatsCard icon={Users} label="Đã giới thiệu" value={String(totalReferrals)} iconBg="bg-purple-950/60" iconColor="text-purple-400" />
        <StatsCard icon={Share2} label="Hoa hồng TB/người" value={totalReferrals > 0 ? formatCurrency(Math.round(totalCommissions / totalReferrals)) : "—"} iconBg="bg-blue-950/60" iconColor="text-blue-400" />
      </div>

      <div className="glass rounded-xl p-5 mb-4">
        <p className="text-sm font-medium text-gray-300 mb-2">Link giới thiệu</p>
        <div className="flex items-center gap-2 glass border border-white/[0.07] rounded-lg px-3 py-2">
          <span className="text-sm text-gray-300 flex-1 truncate">{referralLink}</span>
          <button onClick={copyLink} className="flex items-center gap-1.5 px-3 py-1.5 bg-primary-500 text-white rounded-lg text-xs font-medium hover:bg-primary-600 transition-colors flex-shrink-0 shadow-glow-sm hover:shadow-glow">
            {copied ? <Check size={12} /> : <Copy size={12} />}
            {copied ? "Đã sao chép" : "Sao chép"}
          </button>
        </div>
        <p className="text-xs text-gray-400 mt-2">Chia sẻ link này. Khi người dùng đăng ký và thanh toán, hệ thống tự ghi nhận hoa hồng.</p>
      </div>

      <div className="glass rounded-xl p-4">
        <TabFilter tabs={TABS} active={tab} onChange={setTab} />

        {tab === "config" ? (
          <div className="mt-4 space-y-4 max-w-sm">
            <div>
              <label className="text-xs font-medium text-gray-400 block mb-1">Tỉ lệ hoa hồng mặc định (%)</label>
              <div className="flex items-center gap-2">
                <input type="number" min="0" max="100" value={cf("DEFAULT_REFERRAL_PERCENT", "5")}
                  onChange={(e) => setCf("DEFAULT_REFERRAL_PERCENT", e.target.value)}
                  className="w-24 glass-input rounded-lg px-3 py-2 text-sm" />
                <span className="text-xs text-gray-500">% trên mỗi đơn hàng thành công</span>
              </div>
              <p className="text-xs text-gray-400 mt-1">VIP levels có thể ghi đè tỉ lệ này trong Gói VIP.</p>
            </div>
            <div>
              <label className="text-xs font-medium text-gray-400 block mb-1">Số tiền rút hoa hồng tối thiểu (VND)</label>
              <input type="number" min="0" value={cf("CTV_MIN_WITHDRAW", "50000")}
                onChange={(e) => setCf("CTV_MIN_WITHDRAW", e.target.value)}
                className="w-full glass-input rounded-lg px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-400 block mb-1">Thời hạn link giới thiệu (ngày)</label>
              <input type="number" min="1" value={cf("REFERRAL_COOKIE_DAYS", "30")}
                onChange={(e) => setCf("REFERRAL_COOKIE_DAYS", e.target.value)}
                className="w-full glass-input rounded-lg px-3 py-2 text-sm" />
              <p className="text-xs text-gray-400 mt-1">Sau bao nhiêu ngày mà khách chưa mua thì hoa hồng không được tính.</p>
            </div>
            <button onClick={() => saveMut.mutate({ DEFAULT_REFERRAL_PERCENT: cf("DEFAULT_REFERRAL_PERCENT", "5"), CTV_MIN_WITHDRAW: cf("CTV_MIN_WITHDRAW", "50000"), REFERRAL_COOKIE_DAYS: cf("REFERRAL_COOKIE_DAYS", "30") })}
              disabled={saveMut.isPending}
              className="flex items-center gap-1.5 px-4 py-2 bg-primary-500 text-white rounded-lg text-sm font-medium hover:bg-primary-600 disabled:opacity-50 transition-colors shadow-glow-sm hover:shadow-glow">
              <Save size={14} />
              {saveMut.isPending ? "Đang lưu..." : "Lưu cài đặt"}
            </button>
            {saveMut.isSuccess && <p className="text-xs text-emerald-400">✓ Đã lưu</p>}
          </div>
        ) : isLoading ? (
          <p className="text-center py-8 text-sm text-gray-400">Đang tải...</p>
        ) : tab === "commissions" ? (
          commissions.length === 0 ? (
            <EmptyState icon={Share2} message="Chưa có hoa hồng nào. Chia sẻ link giới thiệu để bắt đầu!" />
          ) : (
            <div className="overflow-x-auto mt-3">
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
