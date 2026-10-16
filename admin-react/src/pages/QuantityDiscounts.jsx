import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Percent, Plus, Trash2, Save, Search } from "lucide-react";
import { api } from "../api/endpoints";
import Modal from "../components/Modal";
import EmptyState from "../components/EmptyState";
import { formatCurrency } from "../utils/format";

export default function QuantityDiscounts() {
  const [search, setSearch] = useState("");
  const [edit, setEdit] = useState(null);
  const [tiers, setTiers] = useState([]);
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({ queryKey: ["quantity-discounts"], queryFn: api.quantityDiscounts });
  const saveMut = useMutation({
    mutationFn: ({ productId, tiers }) => api.setQuantityDiscounts(productId, tiers),
    onSuccess: () => { qc.invalidateQueries(["quantity-discounts"]); setEdit(null); },
  });

  const products = (data?.products || []).filter((p) =>
    !search || p.name.toLowerCase().includes(search.toLowerCase())
  );

  function openEdit(p) {
    setEdit(p);
    setTiers(p.tiers?.length ? p.tiers.map((t) => ({ ...t })) : [{ minQty: 2, discountPercent: 5 }]);
  }
  function addTier() { setTiers((t) => [...t, { minQty: "", discountPercent: "" }]); }
  function updTier(i, key, val) { setTiers((t) => t.map((x, j) => j === i ? { ...x, [key]: val } : x)); }
  function delTier(i) { setTiers((t) => t.filter((_, j) => j !== i)); }
  function save() {
    const clean = tiers
      .map((t) => ({ minQty: Number(t.minQty), discountPercent: Number(t.discountPercent) }))
      .filter((t) => t.minQty > 1 && t.discountPercent > 0);
    saveMut.mutate({ productId: edit.id, tiers: clean });
  }

  return (
    <div className="space-y-4 pb-10">
      {/* Header */}
      <div className="pb-1">
        <div className="flex items-center gap-2 mb-1">
          <span className="eyebrow text-slate-400">PRICING // VOLUME TIERS</span>
          <span className="w-1 h-1 rounded-full bg-slate-600" />
          <span className="text-[10px] font-mono text-indigo-400">AUTOMATIC DISCOUNTS</span>
        </div>
        <h1 className="text-xl font-bold text-slate-100 tracking-tight flex items-center gap-2">
          Giảm giá theo số lượng mua
          <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-indigo-500/10 text-indigo-300 border border-indigo-500/25">
            {products.length} SẢN PHẨM
          </span>
        </h1>
        <p className="text-xs text-slate-400 mt-0.5 tracking-tight">
          Cấu hình bậc chiết khấu phần trăm tự động theo số lượng mua buôn cho từng sản phẩm
        </p>
      </div>

      {/* Main Bento Card Container */}
      <div className="bento-card p-4 space-y-3.5">
        <div className="relative max-w-xs">
          <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Tìm sản phẩm..."
            className="dev-input w-full pl-7 pr-3 py-1 text-xs font-mono"
          />
        </div>

        {isLoading ? (
          <div className="py-16 text-center text-xs font-mono text-slate-500 animate-pulse">
            ĐANG TẢI BẬC GIÁ...
          </div>
        ) : products.length === 0 ? (
          <EmptyState icon={Percent} message="Không có sản phẩm nào" />
        ) : (
          <div className="overflow-x-auto rounded-lg border border-slate-800/80">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="bg-slate-900/60 border-b border-slate-800/80 text-[10px] font-mono text-slate-400 uppercase tracking-wider">
                  <th className="px-3.5 py-2.5 font-medium">SẢN PHẨM</th>
                  <th className="px-3 py-2.5 font-medium">GIÁ BÁN LẺ</th>
                  <th className="px-3 py-2.5 font-medium">CÁC MỨC GIẢM THEO SL</th>
                  <th className="px-3.5 py-2.5 font-medium text-right">THAO TÁC</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 font-sans">
                {products.map((p) => (
                  <tr key={p.id} className="hover:bg-slate-800/30 transition-colors">
                    <td className="px-3.5 py-3 text-slate-200 font-medium">
                      {p.name}
                    </td>
                    <td className="px-3 py-3 font-mono text-slate-300">
                      {formatCurrency(p.price)}
                    </td>
                    <td className="px-3 py-3">
                      {p.tiers?.length ? (
                        <div className="flex flex-wrap gap-1.5">
                          {p.tiers.map((t, i) => (
                            <span
                              key={i}
                              className="text-[11px] font-mono px-2 py-0.5 rounded bg-indigo-500/10 text-indigo-300 border border-indigo-500/25"
                            >
                              ≥{t.minQty} cái: -{t.discountPercent}%
                            </span>
                          ))}
                        </div>
                      ) : (
                        <span className="text-slate-500 font-mono text-xs">Chưa cấu hình</span>
                      )}
                    </td>
                    <td className="px-3.5 py-3 text-right">
                      <button
                        onClick={() => openEdit(p)}
                        className="px-2.5 py-1 rounded-md bg-slate-900 border border-slate-800 hover:border-slate-700 text-slate-300 text-xs font-mono transition-all cursor-pointer"
                      >
                        CẤU HÌNH
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <Modal open={!!edit} onClose={() => setEdit(null)} title={edit ? `Chiết khấu số lượng: ${edit.name}` : ""}>
        <div className="space-y-3.5 text-xs font-mono">
          <p className="text-[11px] text-slate-400">
            Khách mua từ số lượng tối thiểu sẽ tự động giảm % tương ứng. Mức chiết khấu cao nhất sẽ được áp dụng.
          </p>
          <div className="space-y-2">
            {tiers.map((t, i) => (
              <div key={i} className="flex items-center gap-2 p-2 rounded-lg bg-slate-900/60 border border-slate-800">
                <div className="flex-1">
                  <label className="text-[10px] text-slate-400 block mb-0.5 uppercase tracking-wider">SL tối thiểu</label>
                  <input
                    type="number"
                    min={2}
                    value={t.minQty}
                    onChange={(e) => updTier(i, "minQty", e.target.value)}
                    className="w-full dev-input px-2.5 py-1.5 text-xs"
                    placeholder="2"
                  />
                </div>
                <div className="flex-1">
                  <label className="text-[10px] text-slate-400 block mb-0.5 uppercase tracking-wider">Giảm (%)</label>
                  <input
                    type="number"
                    min={1}
                    max={100}
                    value={t.discountPercent}
                    onChange={(e) => updTier(i, "discountPercent", e.target.value)}
                    className="w-full dev-input px-2.5 py-1.5 text-xs"
                    placeholder="5"
                  />
                </div>
                <button
                  onClick={() => delTier(i)}
                  className="mt-4 p-1.5 text-slate-500 hover:text-rose-400 transition-colors cursor-pointer"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
          <button
            onClick={addTier}
            className="flex items-center gap-1.5 text-xs font-mono text-indigo-400 hover:text-indigo-300 cursor-pointer"
          >
            <Plus size={13} /> THÊM MỨC MỚI
          </button>
          <button
            onClick={save}
            disabled={saveMut.isPending}
            className="w-full flex items-center justify-center gap-1.5 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-mono font-medium disabled:opacity-50 transition-all cursor-pointer shadow-sm mt-3"
          >
            <Save size={13} /> {saveMut.isPending ? "ĐANG LƯU..." : "XÁC NHẬN LƯU"}
          </button>
        </div>
      </Modal>
    </div>
  );
}
