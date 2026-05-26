import { useState } from "react";
import { createPortal } from "react-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Package, Pencil, Trash2, X, Eye, EyeOff } from "lucide-react";
import { api } from "../api/endpoints";
import SearchBar from "../components/SearchBar";
import Pagination from "../components/Pagination";
import TabFilter from "../components/TabFilter";
import EmptyState from "../components/EmptyState";
import Modal from "../components/Modal";
import { formatCurrency } from "../utils/format";

const EMPTY_FORM = { name: "", description: "", price: "", costPrice: "", currency: "VND", deliveryMode: "TEXT", payload: "", note: "", categoryId: "", minQty: "1", maxQty: "" };

const STATUS_TABS = [
  { value: "all",      label: "Tất cả" },
  { value: "active",   label: "Đang bán" },
  { value: "inactive", label: "Đã ẩn" },
];

export default function Products() {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [modal, setModal] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [stockProduct, setStockProduct] = useState(null);
  const [stockLines, setStockLines] = useState("");
  const [stockPage, setStockPage] = useState(1);
  const [showSold, setShowSold] = useState(false);
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["products", page, pageSize, search, status],
    queryFn: () => api.products({ page, limit: pageSize, search, status }),
  });
  const { data: catData } = useQuery({ queryKey: ["categories"], queryFn: api.categories });
  const { data: stockData, isLoading: stockLoading } = useQuery({
    queryKey: ["stock-items", stockProduct?.id, stockPage, showSold],
    queryFn: () => api.stockItems({ productId: stockProduct.id, page: stockPage, limit: 50, sold: showSold ? "true" : "false" }),
    enabled: !!stockProduct,
  });

  const saveMut = useMutation({
    mutationFn: (data) => modal?.product ? api.updateProduct(modal.product.id, data) : api.createProduct(data),
    onSuccess: () => { qc.invalidateQueries(["products"]); setModal(null); },
  });
  const delMut = useMutation({
    mutationFn: (id) => api.deleteProduct(id),
    onSuccess: () => qc.invalidateQueries(["products"]),
  });
  const toggleMut = useMutation({
    mutationFn: (id) => api.toggleProductActive(id),
    onSuccess: () => qc.invalidateQueries(["products"]),
  });
  const bulkAddMut = useMutation({
    mutationFn: () => api.bulkAddStock(stockProduct.id, stockLines),
    onSuccess: () => {
      setStockLines("");
      qc.invalidateQueries(["stock-items", stockProduct.id]);
      qc.invalidateQueries(["products"]);
    },
  });
  const delStockMut = useMutation({
    mutationFn: (id) => api.deleteStockItem(id),
    onSuccess: () => {
      qc.invalidateQueries(["stock-items", stockProduct.id]);
      qc.invalidateQueries(["products"]);
    },
  });
  const clearStockMut = useMutation({
    mutationFn: () => api.clearUnsoldStock(stockProduct.id),
    onSuccess: () => {
      qc.invalidateQueries(["stock-items", stockProduct.id]);
      qc.invalidateQueries(["products"]);
    },
  });

  const products = data?.products || [];
  const total = data?.total || 0;
  const totalPages = Math.ceil(total / pageSize) || 1;
  const categories = catData?.categories || catData || [];
  const stockItems = stockData?.items || [];
  const stockTotal = stockData?.total || 0;
  const stockSoldCount = stockData?.soldCount || 0;
  const stockUnsoldCount = !showSold && stockData ? stockTotal : (stockProduct?._count?.stockItems ?? 0);
  const stockTotalPages = Math.ceil(stockTotal / 50) || 1;

  function openCreate() { setForm(EMPTY_FORM); setModal({ product: null }); }
  function openEdit(p) {
    setForm({ name: p.name, description: p.description || "", price: p.price, costPrice: p.costPrice || "", currency: p.currency || "VND", deliveryMode: p.deliveryMode, payload: p.payload || "", note: p.note || "", categoryId: p.categoryId || "", minQty: p.minQty ?? "1", maxQty: p.maxQty || "" });
    setModal({ product: p });
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-xl font-bold text-white">Sản phẩm</h1>
        <button onClick={openCreate} className="flex items-center gap-1.5 px-4 py-2 bg-primary-500 text-white rounded-lg text-sm font-medium hover:bg-primary-600 transition-colors shadow-glow-sm hover:shadow-glow">
          <Plus size={15} />
          Thêm sản phẩm
        </button>
      </div>
      <p className="text-sm text-gray-500 mb-5">{total} sản phẩm</p>

      <div className="glass rounded-xl p-4">
        <div className="flex items-center gap-3 mb-3">
          <div className="flex-1">
            <SearchBar placeholder="Tìm theo tên..." value={search} onChange={setSearch} onSearch={() => setPage(1)} />
          </div>
        </div>
        <TabFilter tabs={STATUS_TABS} active={status} onChange={(v) => { setStatus(v); setPage(1); }} />

        {isLoading ? (
          <p className="text-center py-8 text-sm text-gray-400">Đang tải...</p>
        ) : products.length === 0 ? (
          <EmptyState icon={Package} message="Chưa có sản phẩm nào" action="Thêm sản phẩm" onAction={openCreate} />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-white/[0.06] text-left text-xs text-gray-500">
                    <th className="px-3 py-2.5 font-medium rounded-l-lg">Tên sản phẩm</th>
                    <th className="px-3 py-2.5 font-medium">Danh mục</th>
                    <th className="px-3 py-2.5 font-medium">Giá</th>
                    <th className="px-3 py-2.5 font-medium">Kiểu giao</th>
                    <th className="px-3 py-2.5 font-medium">Tồn kho</th>
                    <th className="px-3 py-2.5 font-medium">Trạng thái</th>
                    <th className="px-3 py-2.5 font-medium rounded-r-lg">Hành động</th>
                  </tr>
                </thead>
                <tbody>
                  {products.map((p) => (
                    <tr key={p.id} className={`border-b border-white/[0.04] transition-colors ${p.isActive ? "hover:bg-white/[0.03]" : "opacity-50 hover:bg-white/[0.03]"}`}>
                      <td className="px-3 py-3 font-medium text-white max-w-[200px] truncate">{p.name}</td>
                      <td className="px-3 py-3 text-gray-500 text-xs">{p.category?.name || "—"}</td>
                      <td className="px-3 py-3 font-medium text-white">{p.price > 0 ? formatCurrency(p.price) : "Liên hệ"}</td>
                      <td className="px-3 py-3">
                        <span className="text-xs px-2 py-0.5 rounded bg-white/[0.08] text-gray-300">{p.deliveryMode}</span>
                      </td>
                      <td className="px-3 py-3">
                        {p.deliveryMode === "STOCK_LINES" ? (
                          <button
                            onClick={() => { setStockProduct(p); setStockPage(1); setShowSold(false); }}
                            title="Quản lý stock"
                            className={`text-sm font-semibold underline-offset-2 hover:underline transition-colors ${(p._count?.stockItems ?? 0) === 0 ? "text-red-500 hover:text-red-400" : (p._count?.stockItems ?? 0) <= 5 ? "text-yellow-400 hover:text-yellow-300" : "text-emerald-400 hover:text-emerald-300"}`}>
                            {p._count?.stockItems ?? 0}
                          </button>
                        ) : (
                          <span className="text-xs text-gray-600">—</span>
                        )}
                      </td>
                      <td className="px-3 py-3">
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${p.isActive ? "bg-emerald-950/60 text-emerald-300" : "bg-white/[0.06] text-gray-500"}`}>
                          {p.isActive ? "Đang bán" : "Đã ẩn"}
                        </span>
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => toggleMut.mutate(p.id)}
                            disabled={toggleMut.isPending}
                            title={p.isActive ? "Ẩn khỏi bot" : "Hiện trên bot"}
                            className={`transition-colors ${p.isActive ? "text-green-500 hover:text-gray-400" : "text-gray-300 hover:text-green-500"}`}>
                            {p.isActive ? <Eye size={14} /> : <EyeOff size={14} />}
                          </button>
                          <button onClick={() => openEdit(p)} className="text-gray-400 hover:text-primary-600 transition-colors">
                            <Pencil size={14} />
                          </button>
                          <button onClick={() => { if (confirm("Xóa sản phẩm này?")) delMut.mutate(p.id); }}
                            className="text-gray-400 hover:text-red-500 transition-colors">
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

      {/* Product create/edit modal */}
      <Modal open={!!modal} onClose={() => setModal(null)} title={modal?.product ? "Sửa sản phẩm" : "Thêm sản phẩm"}>
        <div className="space-y-3">
          <div>
            <label className="text-xs font-medium text-gray-400 block mb-1">Tên sản phẩm</label>
            <input value={form.name} onChange={(e) => setForm((f) => ({...f,name:e.target.value}))}
              className="w-full glass-input rounded-lg px-3 py-2 text-sm" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-gray-400 block mb-1">Giá bán (VND)</label>
              <input type="number" value={form.price} onChange={(e) => setForm((f) => ({...f,price:e.target.value}))}
                className="w-full glass-input rounded-lg px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-400 block mb-1">Giá vốn (VND)</label>
              <input type="number" value={form.costPrice} onChange={(e) => setForm((f) => ({...f,costPrice:e.target.value}))}
                placeholder="Tùy chọn"
                className="w-full glass-input rounded-lg px-3 py-2 text-sm" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-gray-400 block mb-1">SL mua tối thiểu</label>
              <input type="number" min="1" value={form.minQty} onChange={(e) => setForm((f) => ({...f,minQty:e.target.value}))}
                className="w-full glass-input rounded-lg px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-400 block mb-1">SL mua tối đa</label>
              <input type="number" min="1" value={form.maxQty} onChange={(e) => setForm((f) => ({...f,maxQty:e.target.value}))}
                placeholder="Không giới hạn"
                className="w-full glass-input rounded-lg px-3 py-2 text-sm" />
            </div>
          </div>
          <div>
            <label className="text-xs font-medium text-gray-400 block mb-1">Lưu ý</label>
            <input value={form.note} onChange={(e) => setForm((f) => ({...f,note:e.target.value}))}
              className="w-full glass-input rounded-lg px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="text-xs font-medium text-gray-400 block mb-1">Danh mục</label>
            <select value={form.categoryId} onChange={(e) => setForm((f) => ({...f,categoryId:e.target.value}))}
              className="w-full glass-input rounded-lg px-3 py-2 text-sm">
              <option value="">— Chọn danh mục —</option>
              {categories.map((c) => <option key={c.id} value={c.id}>{c.icon} {c.name}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs font-medium text-gray-400 block mb-1">Kiểu giao hàng</label>
            <select value={form.deliveryMode} onChange={(e) => setForm((f) => ({...f,deliveryMode:e.target.value}))}
              className="w-full glass-input rounded-lg px-3 py-2 text-sm">
              <option value="TEXT">TEXT — Nội dung cố định</option>
              <option value="STOCK_LINES">STOCK_LINES — Tài khoản/mã từ kho</option>
              <option value="FILE">FILE — File đính kèm</option>
              <option value="API_CALL">API_CALL — Gọi API nhà cung cấp</option>
            </select>
          </div>
          {form.deliveryMode !== "STOCK_LINES" && form.deliveryMode !== "API_CALL" && (
            <div>
              <label className="text-xs font-medium text-gray-400 block mb-1">
                {form.deliveryMode === "FILE" ? "Đường dẫn file" : "Nội dung giao hàng"}
              </label>
              <textarea value={form.payload} onChange={(e) => setForm((f) => ({...f,payload:e.target.value}))} rows={3}
                className="w-full glass-input rounded-lg px-3 py-2 text-sm resize-none" />
            </div>
          )}
          {form.deliveryMode === "API_CALL" && (
            <p className="text-xs text-gray-500 bg-white/[0.03] rounded-lg px-3 py-2 border border-white/[0.06]">
              Sản phẩm API — cấu hình giao hàng được quản lý trong trang <b className="text-gray-400">Kết nối API</b>.
            </p>
          )}
          <div>
            <label className="text-xs font-medium text-gray-400 block mb-1">Mô tả</label>
            <textarea value={form.description} onChange={(e) => setForm((f) => ({...f,description:e.target.value}))} rows={3}
              className="w-full glass-input rounded-lg px-3 py-2 text-sm resize-none" />
          </div>
          <button onClick={() => saveMut.mutate(form)} disabled={!form.name || saveMut.isPending}
            className="w-full py-2 bg-primary-500 text-white rounded-lg text-sm font-medium hover:bg-primary-600 disabled:opacity-50 transition-colors shadow-glow-sm hover:shadow-glow">
            {saveMut.isPending ? "Đang lưu..." : "Lưu"}
          </button>
        </div>
      </Modal>

      {/* Stock management modal */}
      {stockProduct && createPortal(
        <div className="fixed inset-0 bg-black/70 z-[9999] flex items-center justify-center p-4">
          <div className="glass-md rounded-2xl shadow-xl w-full max-w-2xl max-h-[85vh] flex flex-col">
            <div className="px-5 py-4 border-b border-white/[0.07] flex items-center justify-between">
              <div>
                <h2 className="font-semibold text-white">Kho stock — {stockProduct.name}</h2>
                <p className="text-xs text-gray-500 mt-0.5">
                  {stockData ? `${stockUnsoldCount} chưa bán · ${stockSoldCount} đã bán` : "Đang tải..."}
                </p>
              </div>
              <button onClick={() => setStockProduct(null)} className="text-gray-400 hover:text-gray-600 transition-colors">
                <X size={18} />
              </button>
            </div>

            <div className="p-5 border-b border-white/[0.07]">
              <label className="text-xs font-medium text-gray-400 block mb-1.5">
                Thêm stock — mỗi dòng là một tài khoản/mã
              </label>
              <textarea value={stockLines} onChange={(e) => setStockLines(e.target.value)} rows={4}
                placeholder={"user1:pass1\nuser2:pass2\nuser3:pass3"}
                className="w-full glass-input rounded-lg px-3 py-2 text-sm font-mono resize-none" />
              <div className="flex gap-2 mt-2">
                <button onClick={() => bulkAddMut.mutate()} disabled={!stockLines.trim() || bulkAddMut.isPending}
                  className="px-4 py-1.5 bg-primary-500 text-white rounded-lg text-xs font-medium hover:bg-primary-600 disabled:opacity-50 transition-colors shadow-glow-sm hover:shadow-glow">
                  {bulkAddMut.isPending ? "Đang thêm..." : `Thêm ${stockLines.trim().split("\n").filter(Boolean).length || 0} dòng`}
                </button>
                {bulkAddMut.data && (
                  <span className="text-xs text-emerald-400 self-center">✓ Đã thêm {bulkAddMut.data.created} mục</span>
                )}
                <button onClick={() => { if (confirm("Xóa tất cả stock chưa bán?")) clearStockMut.mutate(); }}
                  disabled={clearStockMut.isPending}
                  className="ml-auto px-3 py-1.5 text-red-400 border border-red-800/50 rounded-lg text-xs hover:bg-red-950/40 transition-colors">
                  Xóa tất cả chưa bán
                </button>
              </div>
            </div>

            <div className="flex items-center gap-3 px-5 py-2 border-b border-white/[0.07]">
              <button onClick={() => { setShowSold(false); setStockPage(1); }}
                className={`text-xs px-3 py-1 rounded-full transition-colors ${!showSold ? "bg-primary-600 text-white font-medium" : "glass text-gray-400 hover:text-white"}`}>
                Chưa bán ({stockUnsoldCount})
              </button>
              <button onClick={() => { setShowSold(true); setStockPage(1); }}
                className={`text-xs px-3 py-1 rounded-full transition-colors ${showSold ? "bg-primary-600 text-white font-medium" : "glass text-gray-400 hover:text-white"}`}>
                Đã bán ({stockSoldCount})
              </button>
            </div>

            <div className="overflow-y-auto flex-1 px-5 py-2">
              {stockLoading ? (
                <p className="text-center py-8 text-sm text-gray-400">Đang tải...</p>
              ) : stockItems.length === 0 ? (
                <p className="text-center py-8 text-sm text-gray-400">Không có mục nào</p>
              ) : (
                <div className="space-y-1">
                  {stockItems.map((item) => (
                    <div key={item.id} className="flex items-center gap-2 py-1.5 px-2 rounded hover:bg-white/[0.03] group">
                      <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${item.isSold ? "bg-gray-300" : "bg-green-400"}`} />
                      <span className="font-mono text-xs text-gray-300 flex-1 truncate">{item.content}</span>
                      {!item.isSold && (
                        <button onClick={() => delStockMut.mutate(item.id)}
                          className="opacity-0 group-hover:opacity-100 text-gray-300 hover:text-red-500 transition-all">
                          <X size={12} />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {stockTotalPages > 1 && (
              <div className="px-5 py-2 border-t border-white/[0.07] flex items-center justify-between text-xs text-gray-500">
                <span>Trang {stockPage}/{stockTotalPages} · {stockTotal} mục</span>
                <div className="flex gap-1">
                  <button disabled={stockPage === 1} onClick={() => setStockPage(p => p - 1)}
                    className="px-2 py-1 rounded border border-white/[0.07] hover:bg-white/[0.05] disabled:opacity-40">‹</button>
                  <button disabled={stockPage === stockTotalPages} onClick={() => setStockPage(p => p + 1)}
                    className="px-2 py-1 rounded border border-white/[0.07] hover:bg-white/[0.05] disabled:opacity-40">›</button>
                </div>
              </div>
            )}
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
