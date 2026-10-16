import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Tag, Trash2, Pencil, Search } from "lucide-react";
import { api } from "../api/endpoints";
import Modal from "../components/Modal";
import EmptyState from "../components/EmptyState";
import { formatCurrency, formatDate } from "../utils/format";

const EMPTY = { code: "", discountType: "PERCENT", discountValue: "", maxUses: "", expiresAt: "", vipOnly: false };

export default function Promotions() {
  const [modal, setModal] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [editTarget, setEditTarget] = useState(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({ queryKey: ["coupons"], queryFn: api.coupons });
  const createMut = useMutation({
    mutationFn: api.createCoupon,
    onSuccess: () => { qc.invalidateQueries(["coupons"]); setModal(false); setForm(EMPTY); setEditTarget(null); },
  });
  const updateMut = useMutation({
    mutationFn: ({ id, data }) => api.updateCoupon(id, data),
    onSuccess: () => { qc.invalidateQueries(["coupons"]); setModal(false); setForm(EMPTY); setEditTarget(null); },
  });
  const delMut = useMutation({
    mutationFn: api.deleteCoupon,
    onSuccess: () => qc.invalidateQueries(["coupons"]),
  });

  const coupons = data?.coupons || data || [];
  const now = new Date();
  const filtered = coupons.filter((c) => {
    if (search && !c.code.toLowerCase().includes(search.toLowerCase())) return false;
    if (statusFilter === "active" && c.expiresAt && new Date(c.expiresAt) < now) return false;
    if (statusFilter === "expired" && (!c.expiresAt || new Date(c.expiresAt) >= now)) return false;
    return true;
  });

  function openEdit(c) {
    setEditTarget(c);
    setForm({
      code: c.code,
      discountType: c.discountType,
      discountValue: String(c.discountValue),
      maxUses: c.maxUses ? String(c.maxUses) : "",
      expiresAt: c.expiresAt ? c.expiresAt.slice(0, 16) : "",
      vipOnly: c.vipOnly ?? false,
    });
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
    <div className="space-y-4 pb-10">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-1">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="eyebrow text-slate-400">MARKETING // COUPON CAMPAIGNS</span>
            <span className="w-1 h-1 rounded-full bg-slate-600" />
            <span className="text-[10px] font-mono text-indigo-400">DISCOUNT ENGINE</span>
          </div>
          <h1 className="text-xl font-bold text-slate-100 tracking-tight flex items-center gap-2">
            Khuyến mãi & Mã giảm giá
            <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-indigo-500/10 text-indigo-300 border border-indigo-500/25">
              {coupons.length} COUPON
            </span>
          </h1>
          <p className="text-xs text-slate-400 mt-0.5 tracking-tight">
            Tạo mã coupon giảm theo %, giảm cố định tiền mặt hoặc dành riêng cho VIP
          </p>
        </div>

        <div>
          <button
            onClick={() => { setEditTarget(null); setForm(EMPTY); setModal(true); }}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-mono font-medium transition-all shadow-sm cursor-pointer"
          >
            <Plus size={13} />
            <span>TẠO COUPON</span>
          </button>
        </div>
      </div>

      {/* Main Bento Card Container */}
      <div className="bento-card p-4 space-y-3.5">
        {/* Filter bar */}
        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative flex-1 min-w-[180px] max-w-xs">
            <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Tìm mã coupon..."
              className="dev-input w-full pl-7 pr-3 py-1 text-xs font-mono"
            />
          </div>
          {[["TẤT CẢ", "all"], ["CÒN HIỆU LỰC", "active"], ["ĐÃ HẾT HẠN", "expired"]].map(([label, val]) => (
            <button
              key={val}
              onClick={() => setStatusFilter(val)}
              className={`text-[11px] font-mono px-2.5 py-1 rounded-md border transition-all cursor-pointer ${
                statusFilter === val
                  ? "bg-indigo-500/15 text-indigo-300 border-indigo-500/30"
                  : "bg-slate-900/60 text-slate-400 border-slate-800 hover:text-slate-200 hover:bg-slate-800"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {isLoading ? (
          <div className="py-16 text-center text-xs font-mono text-slate-500 animate-pulse">
            ĐANG TẢI COUPON...
          </div>
        ) : filtered.length === 0 ? (
          <EmptyState icon={Tag} message="Chưa có coupon nào" action="Tạo coupon" onAction={() => setModal(true)} />
        ) : (
          <div className="overflow-x-auto rounded-lg border border-slate-800/80">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="bg-slate-900/60 border-b border-slate-800/80 text-[10px] font-mono text-slate-400 uppercase tracking-wider">
                  <th className="px-3.5 py-2.5 font-medium">MÃ COUPON</th>
                  <th className="px-3 py-2.5 font-medium">MỨC GIẢM</th>
                  <th className="px-3 py-2.5 font-medium">ĐÃ DÙNG / TỐI ĐA</th>
                  <th className="px-3 py-2.5 font-medium">ĐỐI TƯỢNG</th>
                  <th className="px-3 py-2.5 font-medium">HẠN DÙNG</th>
                  <th className="px-3.5 py-2.5 font-medium text-right">THAO TÁC</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 font-sans">
                {filtered.map((c) => (
                  <tr key={c.id} className="hover:bg-slate-800/30 transition-colors">
                    <td className="px-3.5 py-3 font-mono font-semibold text-indigo-400 text-xs">
                      {c.code}
                    </td>
                    <td className="px-3 py-3 font-mono text-slate-200">
                      {c.discountType === "PERCENT" ? `${c.discountValue}%` : formatCurrency(c.discountValue)}
                    </td>
                    <td className="px-3 py-3 font-mono text-slate-400">
                      {c.usedCount ?? 0} / {c.maxUses ?? "∞"}
                    </td>
                    <td className="px-3 py-3">
                      {c.vipOnly ? (
                        <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-amber-950/40 text-amber-400 border border-amber-800/40">
                          VIP ONLY
                        </span>
                      ) : (
                        <span className="text-slate-500 font-mono text-[11px]">TẤT CẢ</span>
                      )}
                    </td>
                    <td className="px-3 py-3 font-mono text-[11px] text-slate-400">
                      {c.expiresAt ? formatDate(c.expiresAt) : "Không giới hạn"}
                    </td>
                    <td className="px-3.5 py-3 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        <button
                          onClick={() => openEdit(c)}
                          className="p-1 text-slate-400 hover:text-indigo-400 hover:bg-slate-800/60 rounded border border-transparent hover:border-slate-700 transition-all cursor-pointer"
                        >
                          <Pencil size={13} />
                        </button>
                        <button
                          onClick={() => { if (confirm("Xóa coupon này?")) delMut.mutate(c.id); }}
                          className="p-1 text-slate-400 hover:text-rose-400 hover:bg-slate-800/60 rounded border border-transparent hover:border-slate-700 transition-all cursor-pointer"
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <Modal open={modal} onClose={() => { setModal(false); setEditTarget(null); }} title={editTarget ? "Sửa coupon" : "Tạo coupon mới"}>
        <div className="space-y-3.5 text-xs font-mono">
          <div>
            <label className="text-[10px] text-slate-400 block mb-1 uppercase tracking-wider">Mã coupon</label>
            <input
              value={form.code}
              onChange={(e) => setForm((f) => ({ ...f, code: e.target.value.toUpperCase() }))}
              disabled={!!editTarget}
              className="w-full dev-input px-3 py-2 text-xs uppercase disabled:opacity-50"
              placeholder="SUMMER2026"
            />
          </div>
          <div className="grid grid-cols-2 gap-2.5">
            <div>
              <label className="text-[10px] text-slate-400 block mb-1 uppercase tracking-wider">Kiểu giảm</label>
              <select
                value={form.discountType}
                onChange={(e) => setForm((f) => ({ ...f, discountType: e.target.value }))}
                className="w-full dev-input px-3 py-2 text-xs"
              >
                <option value="PERCENT">Phần trăm (%)</option>
                <option value="FIXED">Số tiền (đ)</option>
              </select>
            </div>
            <div>
              <label className="text-[10px] text-slate-400 block mb-1 uppercase tracking-wider">Giá trị</label>
              <input
                type="number"
                value={form.discountValue}
                onChange={(e) => setForm((f) => ({ ...f, discountValue: e.target.value }))}
                className="w-full dev-input px-3 py-2 text-xs"
                placeholder="10"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2.5">
            <div>
              <label className="text-[10px] text-slate-400 block mb-1 uppercase tracking-wider">Lần dùng tối đa</label>
              <input
                type="number"
                value={form.maxUses}
                onChange={(e) => setForm((f) => ({ ...f, maxUses: e.target.value }))}
                className="w-full dev-input px-3 py-2 text-xs"
                placeholder="Không giới hạn"
              />
            </div>
            <div>
              <label className="text-[10px] text-slate-400 block mb-1 uppercase tracking-wider">Hết hạn</label>
              <input
                type="datetime-local"
                value={form.expiresAt}
                onChange={(e) => setForm((f) => ({ ...f, expiresAt: e.target.value }))}
                className="w-full dev-input px-3 py-2 text-xs"
              />
            </div>
          </div>
          <label className="flex items-center gap-2 cursor-pointer pt-1">
            <input
              type="checkbox"
              checked={form.vipOnly}
              onChange={(e) => setForm((f) => ({ ...f, vipOnly: e.target.checked }))}
              className="rounded bg-slate-900 border-slate-800 text-indigo-500"
            />
            <span className="text-slate-300">Chỉ dành riêng cho thành viên VIP</span>
          </label>
          <button
            onClick={handleSubmit}
            disabled={!form.code || !form.discountValue || isBusy}
            className="w-full py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-mono font-medium disabled:opacity-50 transition-all cursor-pointer shadow-sm mt-2"
          >
            {isBusy ? "ĐANG LƯU..." : editTarget ? "LƯU THAY ĐỔI" : "TẠO COUPON"}
          </button>
        </div>
      </Modal>
    </div>
  );
}
