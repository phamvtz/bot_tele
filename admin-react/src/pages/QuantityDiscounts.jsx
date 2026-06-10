import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Percent, Plus, Trash2, Save, Search } from "lucide-react";
import { api } from "../api/endpoints";
import Modal from "../components/Modal";
import EmptyState from "../components/EmptyState";
import { formatCurrency } from "../utils/format";

export default function QuantityDiscounts() {
  const [search, setSearch] = useState("");
  const [edit, setEdit] = useState(null); // product being edited
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
    <div>
      <h1 className="text-xl font-bold text-white mb-1">Giảm giá số lượng</h1>
      <p className="text-sm text-gray-500 mb-5">Cấu hình mức giảm giá theo số lượng mua cho từng sản phẩm</p>

      <div className="relative mb-4 max-w-xs">
        <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-500" />
        <input value={search} onChange={(e) => setSearch(e.target.value)}
          placeholder="Tìm sản phẩm..."
          className="glass-input w-full pl-7 pr-3 py-1.5 text-sm rounded-lg" />
      </div>

      <div className="glass rounded-xl p-4">
        {isLoading ? (
          <div className="py-14 text-center text-sm text-gray-500">Đang tải...</div>
        ) : products.length === 0 ? (
          <EmptyState icon={Percent} message="Không có sản phẩm nào" />
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/[0.06] text-left text-xs text-gray-500">
                <th className="px-3 py-2.5 font-medium">Sản phẩm</th>
                <th className="px-3 py-2.5 font-medium">Giá gốc</th>
                <th className="px-3 py-2.5 font-medium">Mức giảm theo SL</th>
                <th className="px-3 py-2.5 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {products.map((p) => (
                <tr key={p.id} className="border-b border-white/[0.04] hover:bg-white/[0.03]">
                  <td className="px-3 py-3 text-gray-200 font-medium">{p.name}</td>
                  <td className="px-3 py-3 text-gray-400">{formatCurrency(p.price)}</td>
                  <td className="px-3 py-3">
                    {p.tiers?.length ? (
                      <div className="flex flex-wrap gap-1.5">
                        {p.tiers.map((t, i) => (
                          <span key={i} className="text-xs px-2 py-0.5 rounded bg-primary-600/20 text-primary-300 border border-primary-500/30">
                            ≥{t.minQty}: -{t.discountPercent}%
                          </span>
                        ))}
                      </div>
                    ) : <span className="text-gray-500 text-xs">Chưa cấu hình</span>}
                  </td>
                  <td className="px-3 py-3 text-right">
                    <button onClick={() => openEdit(p)}
                      className="text-xs px-2.5 py-1 rounded-lg bg-white/[0.05] text-gray-300 hover:bg-white/[0.1] transition-colors">
                      Cấu hình
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <Modal open={!!edit} onClose={() => setEdit(null)} title={edit ? `Giảm giá: ${edit.name}` : ""}>
        <div className="space-y-3">
          <p className="text-xs text-gray-500">Mua từ số lượng tối thiểu sẽ được giảm % tương ứng. Mức cao nhất phù hợp sẽ được áp dụng.</p>
          <div className="space-y-2">
            {tiers.map((t, i) => (
              <div key={i} className="flex items-center gap-2">
                <div className="flex-1">
                  <label className="text-[10px] text-gray-500 block mb-0.5">SL tối thiểu</label>
                  <input type="number" min={2} value={t.minQty} onChange={(e) => updTier(i, "minQty", e.target.value)}
                    className="w-full glass-input rounded-lg px-3 py-1.5 text-sm" placeholder="2" />
                </div>
                <div className="flex-1">
                  <label className="text-[10px] text-gray-500 block mb-0.5">Giảm (%)</label>
                  <input type="number" min={1} max={100} value={t.discountPercent} onChange={(e) => updTier(i, "discountPercent", e.target.value)}
                    className="w-full glass-input rounded-lg px-3 py-1.5 text-sm" placeholder="5" />
                </div>
                <button onClick={() => delTier(i)} className="mt-4 text-gray-500 hover:text-red-400 transition-colors">
                  <Trash2 size={15} />
                </button>
              </div>
            ))}
          </div>
          <button onClick={addTier} className="flex items-center gap-1.5 text-xs text-primary-400 hover:text-primary-300">
            <Plus size={13} /> Thêm mức
          </button>
          <button onClick={save} disabled={saveMut.isPending}
            className="w-full flex items-center justify-center gap-1.5 py-2 bg-primary-500 text-white rounded-lg text-sm font-medium hover:bg-primary-600 disabled:opacity-50 transition-colors">
            <Save size={15} /> {saveMut.isPending ? "Đang lưu..." : "Lưu cấu hình"}
          </button>
        </div>
      </Modal>
    </div>
  );
}
