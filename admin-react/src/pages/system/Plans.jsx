import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Crown, Save, Sparkles, TrendingUp, Users, CheckCircle2 } from "lucide-react";
import { api } from "../../api/endpoints";
import EmptyState from "../../components/EmptyState";
import { formatCurrency } from "../../utils/format";

const TIER_ACCENTS = [
  { level: 1, border: "border-amber-700/40", glow: "text-amber-400", bg: "bg-amber-500/10", label: "TIER 01" },
  { level: 2, border: "border-slate-400/40", glow: "text-slate-300", bg: "bg-slate-400/10", label: "TIER 02" },
  { level: 3, border: "border-yellow-500/40", glow: "text-yellow-400", bg: "bg-yellow-500/10", label: "TIER 03" },
  { level: 4, border: "border-electric-indigo/50", glow: "text-electric-indigo", bg: "bg-electric-indigo/10", label: "TIER 04" },
];

function VipCard({ level, onSave, isSaving }) {
  const [form, setForm] = useState({
    name: level.name || "",
    minSpent: level.minSpent ?? 0,
    discountPercent: level.discountPercent ?? 0,
    referralBonus: level.referralBonus ?? 0,
  });
  const [savedSuccess, setSavedSuccess] = useState(false);

  const meta = TIER_ACCENTS.find((t) => t.level === level.level) || TIER_ACCENTS[0];
  const f = (k) => (e) => setForm((p) => ({ ...p, [k]: e.target.value }));

  const handleSave = () => {
    onSave(
      level.id,
      {
        name: form.name,
        minSpent: Number(form.minSpent),
        discountPercent: Number(form.discountPercent),
        referralBonus: Number(form.referralBonus),
      },
      () => {
        setSavedSuccess(true);
        setTimeout(() => setSavedSuccess(false), 2500);
      }
    );
  };

  return (
    <div className={`bento-card relative overflow-hidden border ${meta.border} transition-all duration-200`}>
      <div className="flex items-center justify-between mb-4 pb-3 thin-divider">
        <div className="flex items-center gap-3">
          <div className={`w-9 h-9 rounded-lg ${meta.bg} flex items-center justify-center border border-white/[0.08]`}>
            <Crown size={18} className={meta.glow} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="mono-badge text-[10px] bg-slate-900/90 text-slate-400 border border-slate-800">
                {meta.label}
              </span>
              <span className="text-[11px] font-mono text-slate-500">LEVEL #{level.level}</span>
            </div>
            <input
              value={form.name}
              onChange={f("name")}
              placeholder="Tên hạng VIP"
              className="mt-1 font-semibold text-slate-100 bg-transparent border-b border-dashed border-slate-700 hover:border-slate-500 focus:border-electric-indigo focus:outline-none w-full text-sm tracking-tight"
            />
          </div>
        </div>

        <div className="text-right">
          <span className="eyebrow text-slate-500 block mb-0.5">CURRENT REQUIREMENT</span>
          <span className="font-mono text-xs font-semibold text-emerald-400">
            ≥ {formatCurrency(Number(form.minSpent) || 0)}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
        <div className="bg-slate-950/40 p-3 rounded-lg border border-slate-800/80">
          <div className="flex items-center justify-between mb-1">
            <label className="eyebrow text-slate-400">Chi tối thiểu</label>
            <span className="text-[10px] font-mono text-slate-500">VND</span>
          </div>
          <input
            type="number"
            value={form.minSpent}
            onChange={f("minSpent")}
            className="w-full dev-input px-2.5 py-1.5 text-xs font-mono text-slate-100"
          />
          <p className="text-[10px] text-slate-500 mt-1 font-mono">
            {formatCurrency(Number(form.minSpent) || 0)}
          </p>
        </div>

        <div className="bg-slate-950/40 p-3 rounded-lg border border-slate-800/80">
          <div className="flex items-center justify-between mb-1">
            <label className="eyebrow text-slate-400">Giảm giá đơn</label>
            <span className="text-[10px] font-mono text-electric-cyan font-bold">% OFF</span>
          </div>
          <input
            type="number"
            min="0"
            max="100"
            value={form.discountPercent}
            onChange={f("discountPercent")}
            className="w-full dev-input px-2.5 py-1.5 text-xs font-mono text-slate-100"
          />
          <p className="text-[10px] text-slate-500 mt-1">Áp dụng trực tiếp giỏ hàng</p>
        </div>

        <div className="bg-slate-950/40 p-3 rounded-lg border border-slate-800/80">
          <div className="flex items-center justify-between mb-1">
            <label className="eyebrow text-slate-400">Hoa hồng ref</label>
            <span className="text-[10px] font-mono text-purple-400 font-bold">% BONUS</span>
          </div>
          <input
            type="number"
            min="0"
            max="100"
            value={form.referralBonus}
            onChange={f("referralBonus")}
            className="w-full dev-input px-2.5 py-1.5 text-xs font-mono text-slate-100"
          />
          <p className="text-[10px] text-slate-500 mt-1">Cộng thêm cho F1 nạp tiền</p>
        </div>
      </div>

      <div className="flex items-center justify-between pt-2">
        <div className="flex items-center gap-2">
          {savedSuccess && (
            <span className="flex items-center gap-1 text-[11px] font-mono text-emerald-400 bg-emerald-950/50 px-2 py-0.5 rounded border border-emerald-800/60 animate-in fade-in">
              <CheckCircle2 size={12} /> Đã cập nhật bậc #{level.level}
            </span>
          )}
        </div>

        <button
          onClick={handleSave}
          disabled={isSaving}
          className="flex items-center gap-1.5 px-3.5 py-1.5 bg-electric-indigo hover:bg-indigo-500 text-white rounded-lg text-xs font-medium transition-all shadow-sm active:scale-95 disabled:opacity-50"
        >
          <Save size={13} />
          <span>{isSaving ? "Đang lưu..." : "Lưu thay đổi"}</span>
        </button>
      </div>
    </div>
  );
}

export default function Plans() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ["vip-levels"], queryFn: api.vipLevels });
  const updateMut = useMutation({
    mutationFn: ({ id, data }) => api.updateVipLevel(id, data),
    onSuccess: (_, variables) => {
      qc.invalidateQueries(["vip-levels"]);
      if (variables.cb) variables.cb();
    },
  });

  const levels = data?.vipLevels || data || [];

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <div className="eyebrow text-electric-amber mb-1 flex items-center gap-2">
            <span>MEMBERSHIP // VIP TIERS & BENEFITS</span>
          </div>
          <h1 className="text-xl font-bold tracking-tight text-slate-100">Cấu hình cấp bậc VIP</h1>
          <p className="text-xs text-slate-400 mt-0.5">
            Quản lý điều kiện tích lũy chi tiêu và các đặc quyền giảm giá, hoa hồng cho từng cấp bậc khách hàng
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="mono-badge bg-slate-900 border border-slate-800 text-slate-400">
            ACTIVE TIERS: {levels.length}
          </span>
        </div>
      </div>

      {/* Bento Overview Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="bento-card p-3.5 flex items-start gap-3">
          <div className="p-2 rounded-lg bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
            <TrendingUp size={16} />
          </div>
          <div>
            <span className="eyebrow text-slate-500 block mb-0.5">AUTO ELEVATION</span>
            <p className="text-xs text-slate-300 font-medium">Tự động nâng hạng khi đạt mốc</p>
            <p className="text-[11px] text-slate-500 mt-0.5">Hệ thống quét tổng nạp sau mỗi đơn thành công để set VIP tức thì.</p>
          </div>
        </div>

        <div className="bento-card p-3.5 flex items-start gap-3">
          <div className="p-2 rounded-lg bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
            <Sparkles size={16} />
          </div>
          <div>
            <span className="eyebrow text-slate-500 block mb-0.5">EXCLUSIVE DISCOUNTS</span>
            <p className="text-xs text-slate-300 font-medium">Chiết khấu trực tiếp trên đơn</p>
            <p className="text-[11px] text-slate-500 mt-0.5">Tự động trừ theo % cấu hình khi bot tạo hóa đơn thanh toán.</p>
          </div>
        </div>

        <div className="bento-card p-3.5 flex items-start gap-3">
          <div className="p-2 rounded-lg bg-purple-500/10 text-purple-400 border border-purple-500/20">
            <Users size={16} />
          </div>
          <div>
            <span className="eyebrow text-slate-500 block mb-0.5">REFERRAL REWARDS</span>
            <p className="text-xs text-slate-300 font-medium">Tăng tỷ lệ hoa hồng đại lý</p>
            <p className="text-[11px] text-slate-500 mt-0.5">Khách VIP nhận % hoa hồng cao hơn khi bạn bè nạp tiền vào bot.</p>
          </div>
        </div>
      </div>

      {/* Main Content */}
      {isLoading ? (
        <div className="bento-card p-12 text-center">
          <div className="animate-spin w-6 h-6 border-2 border-electric-indigo border-t-transparent rounded-full mx-auto mb-2" />
          <p className="text-xs font-mono text-slate-500">Đang tải danh sách bậc VIP...</p>
        </div>
      ) : levels.length === 0 ? (
        <div className="bento-card p-8">
          <EmptyState icon={Crown} message="Chưa có bậc VIP nào được thiết lập trong database" />
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {levels.map((level) => (
            <VipCard
              key={level.id}
              level={level}
              isSaving={updateMut.isPending}
              onSave={(id, payload, cb) => updateMut.mutate({ id, data: payload, cb })}
            />
          ))}
        </div>
      )}
    </div>
  );
}
