import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Share2, Copy, Check } from "lucide-react";
import { api } from "../../api/endpoints";
import StatsCard from "../../components/StatsCard";
import TabFilter from "../../components/TabFilter";
import EmptyState from "../../components/EmptyState";
import { formatCurrency } from "../../utils/format";

const TABS = [
  { value: "commissions", label: "Hoa hồng" },
  { value: "referrals", label: "Đã giới thiệu" },
  { value: "withdraw", label: "Rút tiền" },
];

export default function Referral() {
  const [tab, setTab] = useState("commissions");
  const [copied, setCopied] = useState(false);
  const { data } = useQuery({ queryKey: ["settings"], queryFn: api.settings });
  const shopSlug = data?.settings?.SHOP_SLUG || "your-shop";
  const referralLink = `${window.location.origin}/register?ref=${shopSlug}`;

  function copyLink() {
    navigator.clipboard.writeText(referralLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div>
      <h1 className="text-xl font-bold text-gray-900 mb-1">Affiliate Program</h1>
      <p className="text-sm text-gray-500 mb-5">Giới thiệu khách hàng mới, nhận 30% hoa hồng mỗi lần thanh toán</p>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <StatsCard icon={Share2} label="Số dư Affiliate" value={formatCurrency(0)} iconBg="bg-green-100" iconColor="text-green-600" />
        <StatsCard icon={Share2} label="Tổng hoa hồng" value={formatCurrency(0)} iconBg="bg-blue-100" iconColor="text-blue-600" />
        <StatsCard icon={Share2} label="Đã giới thiệu" value="0" iconBg="bg-purple-100" iconColor="text-purple-600" />
      </div>

      {/* Referral link */}
      <div className="bg-white rounded-xl border border-gray-200 p-5 mb-4">
        <p className="text-sm font-medium text-gray-700 mb-2">Link giới thiệu</p>
        <div className="flex items-center gap-2 border border-gray-200 rounded-lg px-3 py-2 bg-gray-50">
          <span className="text-sm text-gray-700 flex-1 truncate">{referralLink}</span>
          <button onClick={copyLink} className="flex items-center gap-1.5 px-3 py-1.5 bg-primary-500 text-white rounded-lg text-xs font-medium hover:bg-primary-600 transition-colors flex-shrink-0">
            {copied ? <Check size={12} /> : <Copy size={12} />}
            {copied ? "Đã sao chép" : "Sao chép"}
          </button>
        </div>
        <p className="text-xs text-gray-400 mt-2">Chia sẻ link này. Khi người dùng đăng ký và thanh toán, bạn nhận 30% hoa hồng.</p>
        <button className="mt-3 flex items-center gap-1.5 px-4 py-2 border border-red-200 text-red-600 rounded-lg text-sm hover:bg-red-50 transition-colors">
          ⬇ Rút tiền
        </button>
      </div>

      {/* Tabs */}
      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <TabFilter tabs={TABS} active={tab} onChange={setTab} />
        <EmptyState icon={Share2} message={
          tab === "commissions" ? "Chưa có hoa hồng nào. Chia sẻ link giới thiệu để bắt đầu!" :
          tab === "referrals" ? "Chưa có người dùng nào được giới thiệu." :
          "Chưa có yêu cầu rút tiền nào."
        } />
      </div>
    </div>
  );
}
