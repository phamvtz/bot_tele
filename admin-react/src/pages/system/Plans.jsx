import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Crown, Save } from "lucide-react";
import { api } from "../../api/endpoints";
import EmptyState from "../../components/EmptyState";
import { formatCurrency } from "../../utils/format";

function VipCard({ level, onSave }) {
  const [form, setForm] = useState({
    name: level.name,
    minSpend: level.minSpend,
    discountPercent: level.discountPercent ?? 0,
    referralPercent: level.referralPercent ?? 0,
  });
  const f = (k) => (e) => setForm((p) => ({ ...p, [k]: e.target.value }));

  return (
    <div className="glass rounded-xl p-5">
      <div className="flex items-center gap-3 mb-4">
        <div className="w-8 h-8 rounded-lg bg-yellow-950/60 flex items-center justify-center">
          <Crown size={16} className="text-yellow-400" />
        </div>
        <div className="flex-1">
          <input value={form.name} onChange={f("name")}
            className="font-semibold text-white bg-transparent border-b border-dashed border-white/[0.2] focus:border-primary-500 focus:outline-none w-full text-sm" />
          <p className="text-xs text-gray-500">Bậc {level.level}</p>
        </div>
      </div>
      <div className="grid grid-cols-3 gap-3 text-sm mb-4">
        <div>
          <label className="text-xs font-medium text-gray-400 block mb-1">Chi tối thiểu (VND)</label>
          <input type="number" value={form.minSpend} onChange={f("minSpend")}
            className="w-full glass-input rounded-lg px-3 py-2 text-xs" />
        </div>
        <div>
          <label className="text-xs font-medium text-gray-400 block mb-1">Giảm giá (%)</label>
          <input type="number" min="0" max="100" value={form.discountPercent} onChange={f("discountPercent")}
            className="w-full glass-input rounded-lg px-3 py-2 text-xs" />
        </div>
        <div>
          <label className="text-xs font-medium text-gray-400 block mb-1">Hoa hồng referral (%)</label>
          <input type="number" min="0" max="100" value={form.referralPercent} onChange={f("referralPercent")}
            className="w-full glass-input rounded-lg px-3 py-2 text-xs" />
        </div>
      </div>
      <button onClick={() => onSave(level.id, { name: form.name, minSpend: Number(form.minSpend), discountPercent: Number(form.discountPercent), referralPercent: Number(form.referralPercent) })}
        className="flex items-center gap-1.5 px-3 py-1.5 bg-primary-500 text-white rounded-lg text-xs font-medium hover:bg-primary-600 transition-colors shadow-glow-sm hover:shadow-glow">
        <Save size={12} />
        Lưu bậc này
      </button>
    </div>
  );
}

export default function Plans() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ["vip-levels"], queryFn: api.vipLevels });
  const updateMut = useMutation({
    mutationFn: ({ id, data }) => api.updateVipLevel(id, data),
    onSuccess: () => qc.invalidateQueries(["vip-levels"]),
  });

  const levels = data?.vipLevels || data || [];

  return (
    <div>
      <h1 className="text-xl font-bold text-white mb-1">Cấp VIP</h1>
      <p className="text-sm text-gray-500 mb-5">Cấu hình các bậc VIP và quyền lợi tương ứng</p>

      {isLoading ? (
        <p className="text-sm text-gray-400">Đang tải...</p>
      ) : levels.length === 0 ? (
        <div className="glass rounded-xl p-4">
          <EmptyState icon={Crown} message="Chưa có bậc VIP nào" />
        </div>
      ) : (
        <div className="grid gap-4 max-w-3xl">
          {levels.map((level) => (
            <VipCard key={level.id} level={level} onSave={(id, data) => updateMut.mutate({ id, data })} />
          ))}
        </div>
      )}
    </div>
  );
}
