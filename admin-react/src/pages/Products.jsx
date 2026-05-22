import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Package, Pencil, Trash2 } from "lucide-react";
import { api } from "../api/endpoints";
import SearchBar from "../components/SearchBar";
import Pagination from "../components/Pagination";
import EmptyState from "../components/EmptyState";
import Modal from "../components/Modal";
import { formatCurrency } from "../utils/format";

const EMPTY_FORM = { name: "", description: "", price: "", currency: "VND", deliveryMode: "TEXT", payload: "", note: "", categoryId: "" };

export default function Products() {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [search, setSearch] = useState("");
  const [modal, setModal] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["products", page, pageSize, search],
    queryFn: () => api.products({ page, limit: pageSize, search }),
  });
  const { data: catData } = useQuery({ queryKey: ["categories"], queryFn: api.categories });

  const saveMut = useMutation({
    mutationFn: (data) => modal?.product ? api.updateProduct(modal.product.id, data) : api.createProduct(data),
    onSuccess: () => { qc.invalidateQueries(["products"]); setModal(null); },
  });
  const delMut = useMutation({
    mutationFn: (id) => api.deleteProduct(id),
    onSuccess: () => qc.invalidateQueries(["products"]),
  });

  const products = data?.products || [];
  const total = data?.total || 0;
  const totalPages = Math.ceil(total / pageSize) || 1;
  const categories = catData?.categories || catData || [];

  function openCreate() { setForm(EMPTY_FORM); setModal({ product: null }); }
  function openEdit(p) { setForm({ name: p.name, description: p.description || "", price: p.price, currency: p.currency || "VND", deliveryMode: p.deliveryMode, payload: p.payload || "", note: p.note || "", categoryId: p.categoryId || "" }); setModal({ product: p }); }

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-xl font-bold text-gray-900">Sản phẩm</h1>
        <button onClick={openCreate} className="flex items-center gap-1.5 px-4 py-2 bg-primary-500 text-white rounded-lg text-sm font-medium hover:bg-primary-600 transition-colors">
          <Plus size={15} />
          Thêm sản phẩm
        </button>
      </div>
      <p className="text-sm text-gray-500 mb-5">{total} sản phẩm</p>

      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <SearchBar placeholder="Tìm theo tên..." value={search} onChange={setSearch} onSearch={() => setPage(1)} />

        {isLoading ? (
          <p className="text-center py-8 text-sm text-gray-400">Đang tải...</p>
        ) : products.length === 0 ? (
          <EmptyState icon={Package} message="Chưa có sản phẩm nào" action="Thêm sản phẩm" onAction={openCreate} />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 text-left text-xs text-gray-500">
                    <th className="px-3 py-2.5 font-medium rounded-l-lg">Tên sản phẩm</th>
                    <th className="px-3 py-2.5 font-medium">Danh mục</th>
                    <th className="px-3 py-2.5 font-medium">Giá</th>
                    <th className="px-3 py-2.5 font-medium">Kiểu giao</th>
                    <th className="px-3 py-2.5 font-medium">Tồn kho</th>
                    <th className="px-3 py-2.5 font-medium rounded-r-lg">Hành động</th>
                  </tr>
                </thead>
                <tbody>
                  {products.map((p) => (
                    <tr key={p.id} className="border-b border-gray-50 hover:bg-gray-50 transition-colors">
                      <td className="px-3 py-3 font-medium text-gray-900 max-w-[200px] truncate">{p.name}</td>
                      <td className="px-3 py-3 text-gray-500 text-xs">{p.category?.name || "—"}</td>
                      <td className="px-3 py-3 font-medium text-gray-900">{p.price > 0 ? formatCurrency(p.price) : "Liên hệ"}</td>
                      <td className="px-3 py-3">
                        <span className="text-xs px-2 py-0.5 rounded bg-gray-100 text-gray-600">{p.deliveryMode}</span>
                      </td>
                      <td className="px-3 py-3 text-gray-600">
                        {p.deliveryMode === "STOCK_LINES" ? (p._count?.stockItems ?? 0) : "∞"}
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex items-center gap-2">
                          <button onClick={() => openEdit(p)} className="text-gray-400 hover:text-primary-600 transition-colors">
                            <Pencil size={14} />
                          </button>
                          <button onClick={() => { if (confirm("Xóa sản phẩm này?")) delMut.mutate(p.id); }} className="text-gray-400 hover:text-red-500 transition-colors">
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination page={page} totalPages={totalPages} total={total} pageSize={pageSize} onPage={setPage} onPageSize={(s) => { setPageSize(s); setPage(1); }} />
          </>
        )}
      </div>

      <Modal open={!!modal} onClose={() => setModal(null)} title={modal?.product ? "Sửa sản phẩm" : "Thêm sản phẩm"}>
        <div className="space-y-3">
          {[["name","Tên sản phẩm","text"],["price","Giá (VND)","number"],["note","Lưu ý","text"]].map(([k,l,t]) => (
            <div key={k}>
              <label className="text-xs font-medium text-gray-700 block mb-1">{l}</label>
              <input type={t} value={form[k]} onChange={(e) => setForm((f) => ({...f,[k]:e.target.value}))}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/30" />
            </div>
          ))}
          <div>
            <label className="text-xs font-medium text-gray-700 block mb-1">Danh mục</label>
            <select value={form.categoryId} onChange={(e) => setForm((f) => ({...f,categoryId:e.target.value}))}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/30">
              <option value="">— Chọn danh mục —</option>
              {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs font-medium text-gray-700 block mb-1">Kiểu giao hàng</label>
            <select value={form.deliveryMode} onChange={(e) => setForm((f) => ({...f,deliveryMode:e.target.value}))}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/30">
              <option value="TEXT">TEXT</option>
              <option value="STOCK_LINES">STOCK_LINES</option>
              <option value="FILE">FILE</option>
            </select>
          </div>
          <div>
            <label className="text-xs font-medium text-gray-700 block mb-1">Mô tả</label>
            <textarea value={form.description} onChange={(e) => setForm((f) => ({...f,description:e.target.value}))} rows={3}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/30 resize-none" />
          </div>
          <button onClick={() => saveMut.mutate(form)} disabled={!form.name || saveMut.isPending}
            className="w-full py-2 bg-primary-500 text-white rounded-lg text-sm font-medium hover:bg-primary-600 disabled:opacity-50 transition-colors">
            {saveMut.isPending ? "Đang lưu..." : "Lưu"}
          </button>
        </div>
      </Modal>
    </div>
  );
}
