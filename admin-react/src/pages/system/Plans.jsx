import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Crown } from "lucide-react";
import { api } from "../../api/endpoints";
import EmptyState from "../../components/EmptyState";
import { formatCurrency } from "../../utils/format";

export default function Plans() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ["vip-levels"], queryFn: api.vipLevels });
  const updateMut = useMutation({ mutationFn: ({ id, data }) => api.updateVipLevel(id, data), onSuccess: () => qc.invalidateQueries(["vip-levels"]) });

  const levels = data?.vipLevels || data || [];

  return (
    <div>
      <h1 className="text-xl font-bold text-gray-900 mb-1">Gói dịch vụ</h1>
      <p className="text-sm text-gray-500 mb-5">Cấu hình các bậc VIP và quyền lợi</p>

      {isLoading ? (
        <p className="text-sm text-gray-400">Đang tải...</p>
      ) : levels.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <EmptyState icon={Crown} message="Chưa có bậc VIP nào" />
        </div>
      ) : (
        <div className="grid gap-4 max-w-3xl">
          {levels.map((level) => (
            <div key={level.id} className="bg-white rounded-xl border border-gray-200 p-5">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-8 h-8 rounded-lg bg-yellow-100 flex items-center justify-center">
                  <Crown size={16} className="text-yellow-600" />
                </div>
                <div>
                  <p className="font-semibold text-gray-900">{level.name}</p>
                  <p className="text-xs text-gray-500">Bậc {level.level}</p>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-3 text-sm">
                <div>
                  <label className="text-xs font-medium text-gray-700 block mb-1">Chi tối thiểu</label>
                  <div className="border border-gray-200 rounded-lg px-3 py-2 text-gray-700 bg-gray-50 text-xs">{formatCurrency(level.minSpend)}</div>
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-700 block mb-1">Giảm giá (%)</label>
                  <div className="border border-gray-200 rounded-lg px-3 py-2 text-gray-700 bg-gray-50 text-xs">{level.discountPercent ?? 0}%</div>
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-700 block mb-1">Hoa hồng referral (%)</label>
                  <div className="border border-gray-200 rounded-lg px-3 py-2 text-gray-700 bg-gray-50 text-xs">{level.referralPercent ?? 0}%</div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
