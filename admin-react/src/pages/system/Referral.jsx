import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Share2, Copy, Check, Users, DollarSign } from "lucide-react";
import { api } from "../../api/endpoints";
import StatsCard from "../../components/StatsCard";
import TabFilter from "../../components/TabFilter";
import EmptyState from "../../components/EmptyState";
import { formatCurrency, formatDate } from "../../utils/format";

const TABS = [
  { value: "commissions", label: "Hoa hồng" },
  { value: "referrals", label: "Đã giới thiệu" },
];

export default function Referral() {
  const [tab, setTab] = useState("commissions");
  const [copied, setCopied] = useState(false);

  const { data: settingsData } = useQuery({ queryKey: ["settings"], queryFn: api.settings });
  const { data, isLoading } = useQuery({ queryKey: ["referral-stats"], queryFn: api.referralStats });

  const shopSlug = settingsData?.settings?.SHOP_SLUG || "your-shop";
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
      <h1 className="text-xl font-bold text-gray-900 mb-1">Affiliate Program</h1>
      <p className="text-sm text-gray-500 mb-5">Giới thiệu khách hàng mới, nhận hoa hồng mỗi lần thanh toán</p>

      <div className="grid grid-cols-3 gap-4 mb-6">
        <StatsCard icon={DollarSign} label="Tổng hoa hồng" value={formatCurrency(totalCommissions)} iconBg="bg-green-100" iconColor="text-green-600" />
        <StatsCard icon={Users} label="Đã giới thiệu" value={String(totalReferrals)} iconBg="bg-purple-100" iconColor="text-purple-600" />
        <StatsCard icon={Share2} label="Hoa hồng TB/người" value={totalReferrals > 0 ? formatCurrency(Math.round(totalCommissions / totalReferrals)) : "—"} iconBg="bg-blue-100" iconColor="text-blue-600" />
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-5 mb-4">
        <p className="text-sm font-medium text-gray-700 mb-2">Link giới thiệu</p>
        <div className="flex items-center gap-2 border border-gray-200 rounded-lg px-3 py-2 bg-gray-50">
          <span className="text-sm text-gray-700 flex-1 truncate">{referralLink}</span>
          <button onClick={copyLink} className="flex items-center gap-1.5 px-3 py-1.5 bg-primary-500 text-white rounded-lg text-xs font-medium hover:bg-primary-600 transition-colors flex-shrink-0">
            {copied ? <Check size={12} /> : <Copy size={12} />}
            {copied ? "Đã sao chép" : "Sao chép"}
          </button>
        </div>
        <p className="text-xs text-gray-400 mt-2">Chia sẻ link này. Khi người dùng đăng ký và thanh toán, hệ thống tự ghi nhận hoa hồng.</p>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <TabFilter tabs={TABS} active={tab} onChange={setTab} />

        {isLoading ? (
          <p className="text-center py-8 text-sm text-gray-400">Đang tải...</p>
        ) : tab === "commissions" ? (
          commissions.length === 0 ? (
            <EmptyState icon={Share2} message="Chưa có hoa hồng nào. Chia sẻ link giới thiệu để bắt đầu!" />
          ) : (
            <div className="overflow-x-auto mt-3">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 text-left text-xs text-gray-500">
                    <th className="px-3 py-2.5 font-medium rounded-l-lg">Người giới thiệu</th>
                    <th className="px-3 py-2.5 font-medium">Người được giới thiệu</th>
                    <th className="px-3 py-2.5 font-medium">Hoa hồng</th>
                    <th className="px-3 py-2.5 font-medium">Trạng thái</th>
                    <th className="px-3 py-2.5 font-medium rounded-r-lg">Thời gian</th>
                  </tr>
                </thead>
                <tbody>
                  {commissions.map((c) => (
                    <tr key={c.id} className="border-b border-gray-50 hover:bg-gray-50 transition-colors">
                      <td className="px-3 py-3 text-xs">
                        <div className="font-medium text-gray-800">{c.referrer?.firstName || "—"}</div>
                        <div className="text-gray-400">{c.referrer?.telegramId}</div>
                      </td>
                      <td className="px-3 py-3 text-xs">
                        <div className="font-medium text-gray-800">{c.referee?.firstName || "—"}</div>
                        <div className="text-gray-400">{c.referee?.telegramId}</div>
                      </td>
                      <td className="px-3 py-3 font-medium text-green-600">{formatCurrency(c.commission)}</td>
                      <td className="px-3 py-3">
                        <span className={`text-xs px-2 py-0.5 rounded font-medium ${c.status === "PAID" ? "bg-green-100 text-green-700" : "bg-yellow-100 text-yellow-700"}`}>
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
                  <tr className="bg-gray-50 text-left text-xs text-gray-500">
                    <th className="px-3 py-2.5 font-medium rounded-l-lg">Chat ID</th>
                    <th className="px-3 py-2.5 font-medium">Tên</th>
                    <th className="px-3 py-2.5 font-medium">Đã chi</th>
                    <th className="px-3 py-2.5 font-medium rounded-r-lg">Ngày tham gia</th>
                  </tr>
                </thead>
                <tbody>
                  {referrals.map((u) => (
                    <tr key={u.id} className="border-b border-gray-50 hover:bg-gray-50 transition-colors">
                      <td className="px-3 py-3 font-mono text-xs text-primary-600">{u.telegramId}</td>
                      <td className="px-3 py-3 text-xs">
                        <div className="font-medium text-gray-800">{u.firstName || "—"}</div>
                        {u.username && <div className="text-gray-400">@{u.username}</div>}
                      </td>
                      <td className="px-3 py-3 text-xs text-gray-700">{formatCurrency(u.totalSpent || 0)}</td>
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
