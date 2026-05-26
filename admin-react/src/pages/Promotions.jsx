import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Tag, Trash2, Pencil } from "lucide-react";
import { api } from "../api/endpoints";
import Modal from "../components/Modal";
import EmptyState from "../components/EmptyState";
import { formatCurrency, formatDate } from "../utils/format";

const EMPTY = { code: "", discountType: "PERCENT", discountValue: "", maxUses: "", expiresAt: "", vipOnly: false };

export default function Promotions() {
  const [modal, setModal] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [editTarget, setEditTarget] = useState(null);
  const qc = useQueryClient();

  const { data } = useQuery({ queryKey: ["coupons"], queryFn: api.coupons });
  const createMut = useMutation({ mutationFn: api.createCoupon, onSuccess: () => { qc.invalidateQueries(["coupons"]); setModal(false); setForm(EMPTY); setEditTarget(null); } });
  const updateMut = useMutation({ mutationFn: ({ id, data }) => api.updateCoupon(id, data), onSuccess: () => { qc.invalidateQueries(["coupons"]); setModal(false); setForm(EMPTY); setEditTarget(null); } });
  const delMut = useMutation({ mutationFn: api.deleteCoupon, onSuccess: () => qc.invalidateQueries(["coupons"]) });

  const coupons = data?.coupons || data || [];

  function openEdit(c) {
    setEditTarget(c);
    setForm({ code: c.code, discountType: c.discountType, discountValue: String(c.discountValue), maxUses: c.maxUses ? String(c.maxUses) : "", expiresAt: c.expiresAt ? c.expiresAt.slice(0, 16) : "", vipOnly: c.vipOnly ?? false });
    setModal(true);
  }

  function handleSubmit() {
    if (editTarget) {
      updateMut.mutate({ id: editTarget.id, data: form });
    } else {
      createMut.mutate(form);
    }
  }

  const isBusy = createMut.isPending || updateMut.isPending;

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-xl font-bold text-white">Khuyến mãi</h1>
        <button onClick={() => { setEditTarget(null); setForm(EMPTY); setModal(true); }} className="flex items-center gap-1.5 px-4 py-2 bg-primary-500 text-white rounded-lg text-sm font-medium hover:bg-primary-600 transition-colors shadow-glow-sm hover:shadow-glow">
          <Plus size={15} />
          Tạo coupon
        </button>
      </div>
      <p className="text-sm text-gray-500 mb-5">Quản lý mã giảm giá</p>

      <div className="glass rounded-xl p-4">
        {coupons.length === 0 ? (
          <EmptyState icon={Tag} message="Chưa có coupon nào" action="Tạo coupon" onAction={() => setModal(true)} />
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/[0.06] text-left text-xs text-gray-500">
                <th className="px-3 py-2.5 font-medium rounded-l-lg">Mã coupon</th>
                <th className="px-3 py-2.5 font-medium">Giảm giá</th>
                <th className="px-3 py-2.5 font-medium">Đã dùng / Tối đa</th>
                <th className="px-3 py-2.5 font-medium">VIP only</th>
                <th className="px-3 py-2.5 font-medium">Hết hạn</th>
                <th className="px-3 py-2.5 font-medium rounded-r-lg">Hành động</th>
              </tr>
            </thead>
            <tbody>
              {coupons.map((c) => (
                <tr key={c.id} className="border-b border-white/[0.04] hover:bg-white/[0.03]">
                  <td className="px-3 py-3 font-mono font-semibold text-primary-600">{c.code}</td>
                  <td className="px-3 py-3 text-gray-800">
                    {c.discountType === "PERCENT" ? `${c.discountValue}%` : formatCurrency(c.discountValue)}
                  </td>
                  <td className="px-3 py-3 text-gray-600">{c.usedCount ?? 0} / {c.maxUses ?? "∞"}</td>
                  <td className="px-3 py-3">
                    {c.vipOnly ? <span className="text-xs px-2 py-0.5 rounded bg-white/[0.08] text-gray-300">VIP</span> : <span className="text-gray-400">—</span>}
                  </td>
                  <td className="px-3 py-3 text-xs text-gray-400">{c.expiresAt ? formatDate(c.expiresAt) : "Không giới hạn"}</td>
                  <td className="px-3 py-3 flex items-center gap-2">
                    <button onClick={() => openEdit(c)} className="text-gray-400 hover:text-primary-500 transition-colors">
                      <Pencil size={14} />
                    </button>
                    <button onClick={() => { if (confirm("Xóa coupon này?")) delMut.mutate(c.id); }} className="text-gray-400 hover:text-red-500 transition-colors">
                      <Trash2 size={14} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <Modal open={modal} onClose={() => { setModal(false); setEditTarget(null); }} title={editTarget ? "Sửa coupon" : "Tạo coupon mới"}>
        <div className="space-y-3">
          <div>
            <label className="text-xs font-medium text-gray-400 block mb-1">Mã coupon</label>
            <input value={form.code} onChange={(e) => setForm((f) => ({...f,code:e.target.value.toUpperCase()}))}
              disabled={!!editTarget}
              className="w-full glass-input rounded-lg px-3 py-2 text-sm uppercase disabled:opacity-50 disabled:text-gray-500" placeholder="SUMMER2024" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-gray-400 block mb-1">Kiểu giảm</label>
              <select value={form.discountType} onChange={(e) => setForm((f) => ({...f,discountType:e.target.value}))}
                className="w-full glass-input rounded-lg px-3 py-2 text-sm">
                <option value="PERCENT">Phần trăm (%)</option>
                <option value="FIXED">Số tiền (đ)</option>
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-gray-400 block mb-1">Giá trị</label>
              <input type="number" value={form.discountValue} onChange={(e) => setForm((f) => ({...f,discountValue:e.target.value}))}
                className="w-full glass-input rounded-lg px-3 py-2 text-sm" placeholder="10" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-gray-400 block mb-1">Số lần dùng tối đa</label>
              <input type="number" value={form.maxUses} onChange={(e) => setForm((f) => ({...f,maxUses:e.target.value}))}
                className="w-full glass-input rounded-lg px-3 py-2 text-sm" placeholder="Không giới hạn" />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-400 block mb-1">Hết hạn</label>
              <input type="datetime-local" value={form.expiresAt} onChange={(e) => setForm((f) => ({...f,expiresAt:e.target.value}))}
                className="w-full glass-input rounded-lg px-3 py-2 text-sm" />
            </div>
          </div>
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={form.vipOnly} onChange={(e) => setForm((f) => ({...f,vipOnly:e.target.checked}))} className="rounded text-primary-500" />
            <span className="text-sm text-gray-400">Chỉ dành cho VIP</span>
          </label>
          <button onClick={handleSubmit} disabled={!form.code || !form.discountValue || isBusy}
            className="w-full py-2 bg-primary-500 text-white rounded-lg text-sm font-medium hover:bg-primary-600 disabled:opacity-50 transition-colors shadow-glow-sm hover:shadow-glow">
            {isBusy ? "Đang lưu..." : editTarget ? "Lưu thay đổi" : "Tạo coupon"}
          </button>
        </div>
      </Modal>
    </div>
  );
}
