import { useState } from "react";
import { createPortal } from "react-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Package, Pencil, Trash2, X, Eye, EyeOff, Copy, Check, ChevronDown } from "lucide-react";
import { api } from "../api/endpoints";
import SearchBar from "../components/SearchBar";
import Pagination from "../components/Pagination";
import TabFilter from "../components/TabFilter";
import EmptyState from "../components/EmptyState";
import { formatCurrency } from "../utils/format";

const EMPTY_FORM = {
  name: "", description: "", price: "", costPrice: "",
  currency: "VND", deliveryMode: "TEXT", payload: "", note: "",
  categoryId: "", minQty: "1", maxQty: "",
};

const STATUS_TABS = [
  { value: "all",      label: "Tất cả" },
  { value: "active",   label: "Đang bán" },
  { value: "inactive", label: "Đã ẩn" },
];

const DELIVERY_BADGE = {
  STOCK_LINES: { label: "STOCK",   cls: "bg-emerald-950/60 text-emerald-400 border-emerald-800/30" },
  TEXT:        { label: "TEXT",    cls: "bg-blue-950/60 text-blue-400 border-blue-800/30" },
  FILE:        { label: "FILE",    cls: "bg-purple-950/60 text-purple-400 border-purple-800/30" },
  API_CALL:    { label: "API",     cls: "bg-orange-950/60 text-orange-400 border-orange-800/30" },
};

function DeliveryBadge({ mode }) {
  const b = DELIVERY_BADGE[mode] || { label: mode, cls: "bg-white/[0.06] text-gray-400" };
  return (
    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border ${b.cls}`}>{b.label}</span>
  );
}

function StockBadge({ count, onClick }) {
  if (count === 0)  return <button onClick={onClick} className="text-sm font-bold text-red-500 hover:text-red-400 transition-colors hover:underline underline-offset-2">{count}</button>;
  if (count <= 5)   return <button onClick={onClick} className="text-sm font-bold text-yellow-400 hover:text-yellow-300 transition-colors hover:underline underline-offset-2">{count}</button>;
  return <button onClick={onClick} className="text-sm font-bold text-emerald-400 hover:text-emerald-300 transition-colors hover:underline underline-offset-2">{count}</button>;
}

export default function Products() {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [modeFilter, setModeFilter] = useState("");
  const [modal, setModal] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [stockProduct, setStockProduct] = useState(null);
  const [stockLines, setStockLines] = useState("");
  const [stockPage, setStockPage] = useState(1);
  const [showSold, setShowSold] = useState(false);
  const [copied, setCopied] = useState(null);
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["products", page, pageSize, search, status, categoryFilter, modeFilter],
    queryFn: () => api.products({ page, limit: pageSize, search, status, ...(categoryFilter ? { categoryId: categoryFilter } : {}), ...(modeFilter ? { deliveryMode: modeFilter } : {}) }),
  });
  const { data: catData } = useQuery({ queryKey: ["categories"], queryFn: api.categories });
  const { data: stockData, isLoading: stockLoading } = useQuery({
    queryKey: ["stock-items", stockProduct?.id, stockPage, showSold],
    queryFn: () => api.stockItems({ productId: stockProduct.id, page: stockPage, limit: 50, sold: showSold ? "true" : "false" }),
    enabled: !!stockProduct,
  });

  const saveMut = useMutation({
    mutationFn: (d) => modal?.product ? api.updateProduct(modal.product.id, d) : api.createProduct(d),
    onSuccess: () => { qc.invalidateQueries(["products"]); setModal(null); },
  });
  const delMut    = useMutation({ mutationFn: (id) => api.deleteProduct(id), onSuccess: () => qc.invalidateQueries(["products"]) });
  const toggleMut = useMutation({ mutationFn: (id) => api.toggleProductActive(id), onSuccess: () => qc.invalidateQueries(["products"]) });
  const bulkAddMut = useMutation({
    mutationFn: () => api.bulkAddStock(stockProduct.id, stockLines),
    onSuccess: () => { setStockLines(""); qc.invalidateQueries(["stock-items", stockProduct.id]); qc.invalidateQueries(["products"]); },
  });
  const delStockMut = useMutation({
    mutationFn: (id) => api.deleteStockItem(id),
    onSuccess: () => { qc.invalidateQueries(["stock-items", stockProduct.id]); qc.invalidateQueries(["products"]); },
  });
  const clearStockMut = useMutation({
    mutationFn: () => api.clearUnsoldStock(stockProduct.id),
    onSuccess: () => { qc.invalidateQueries(["stock-items", stockProduct.id]); qc.invalidateQueries(["products"]); },
  });

  const products      = data?.products || [];
  const total         = data?.total || 0;
  const totalPages    = Math.ceil(total / pageSize) || 1;
  const categories    = catData?.categories || catData || [];
  const stockItems    = stockData?.items || [];
  const stockTotal    = stockData?.total || 0;
  const stockSoldCount   = stockData?.soldCount || 0;
  const stockUnsoldCount = !showSold && stockData ? stockTotal : (stockProduct?._count?.stockItems ?? 0);
  const stockTotalPages  = Math.ceil(stockTotal / 50) || 1;
  const stockLineCount   = stockLines.trim().split("\n").filter(Boolean).length;

  function openCreate() { setForm(EMPTY_FORM); setModal({ product: null }); }
  function openEdit(p) {
    setForm({ name: p.name, description: p.description || "", price: p.price, costPrice: p.costPrice || "", currency: p.currency || "VND", deliveryMode: p.deliveryMode, payload: p.payload || "", note: p.note || "", categoryId: p.categoryId || "", minQty: p.minQty ?? "1", maxQty: p.maxQty || "" });
    setModal({ product: p });
  }
  function openStock(p) { setStockProduct(p); setStockPage(1); setShowSold(false); setStockLines(""); }
  function copyItem(content, id) {
    navigator.clipboard?.writeText(content);
    setCopied(id);
    setTimeout(() => setCopied(null), 1500);
  }
  const f = (k) => (e) => setForm((prev) => ({ ...prev, [k]: e.target.value }));

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-xl font-bold text-white">Sản phẩm</h1>
        <button onClick={openCreate} className="flex items-center gap-1.5 px-4 py-2 bg-primary-500 text-white rounded-lg text-sm font-medium hover:bg-primary-600 transition-colors shadow-glow-sm hover:shadow-glow">
          <Plus size={14} /> Thêm sản phẩm
        </button>
      </div>
      <p className="text-sm text-gray-500 mb-5">{total} sản phẩm</p>

      <div className="glass rounded-xl p-4">
        <TabFilter tabs={STATUS_TABS} active={status} onChange={(v) => { setStatus(v); setPage(1); }} />
        <SearchBar placeholder="Tìm tên, mã sản phẩm..." value={search} onChange={setSearch} onSearch={() => setPage(1)} />

        <div className="flex items-center gap-2 mt-2 mb-3 flex-wrap">
          <select value={categoryFilter} onChange={(e) => { setCategoryFilter(e.target.value); setPage(1); }}
            className="glass-input rounded-lg px-2 py-1.5 text-xs text-gray-300">
            <option value="">Tất cả danh mục</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          {[["", "Tất cả"], ["STOCK_LINES", "STOCK"], ["TEXT", "TEXT"], ["FILE", "FILE"], ["API_CALL", "API"]].map(([v, label]) => (
            <button key={v} onClick={() => { setModeFilter(v); setPage(1); }}
              className={`text-xs px-2.5 py-1 rounded-lg transition-colors border ${modeFilter === v ? "bg-primary-600/20 text-primary-400 border-primary-700/50" : "bg-white/[0.05] text-gray-400 border-white/[0.06] hover:bg-white/[0.10] hover:text-white"}`}>
              {label}
            </button>
          ))}
        </div>

        {isLoading ? (
          <p className="text-center py-8 text-sm text-gray-400">Đang tải...</p>
        ) : products.length === 0 ? (
          <EmptyState icon={Package} message="Chưa có sản phẩm nào" />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-white/[0.06] text-left text-[11px] text-gray-500 uppercase tracking-wide">
                    <th className="px-3 py-2.5 font-medium">Tên sản phẩm</th>
                    <th className="px-3 py-2.5 font-medium">Danh mục</th>
                    <th className="px-3 py-2.5 font-medium">Giá bán</th>
                    <th className="px-3 py-2.5 font-medium">Kiểu giao</th>
                    <th className="px-3 py-2.5 font-medium text-center">Tồn kho</th>
                    <th className="px-3 py-2.5 font-medium">Trạng thái</th>
                    <th className="px-3 py-2.5 font-medium">Hành động</th>
                  </tr>
                </thead>
                <tbody>
                  {products.map((p) => (
                    <tr key={p.id} className={`border-b border-white/[0.04] transition-colors hover:bg-white/[0.025] ${!p.isActive ? "opacity-50" : ""}`}>
                      <td className="px-3 py-3 max-w-[220px]">
                        <p className="font-medium text-white truncate text-sm leading-snug">{p.name}</p>
                        {p.code && <p className="text-[10px] text-gray-600 font-mono mt-0.5">{p.code}</p>}
                      </td>
                      <td className="px-3 py-3">
                        <span className="text-xs text-gray-500">{p.category?.name || <span className="text-gray-700">—</span>}</span>
                      </td>
                      <td className="px-3 py-3 font-semibold text-white text-sm">
                        {p.price > 0 ? formatCurrency(p.price) : <span className="text-gray-600 font-normal text-xs">Liên hệ</span>}
                      </td>
                      <td className="px-3 py-3">
                        <DeliveryBadge mode={p.deliveryMode} />
                      </td>
                      <td className="px-3 py-3 text-center">
                        {p.deliveryMode === "STOCK_LINES" ? (
                          <StockBadge count={p._count?.stockItems ?? 0} onClick={() => openStock(p)} />
                        ) : (
                          <span className="text-xs text-gray-700">—</span>
                        )}
                      </td>
                      <td className="px-3 py-3">
                        <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium border ${p.isActive ? "bg-emerald-950/50 text-emerald-400 border-emerald-800/30" : "bg-white/[0.04] text-gray-600 border-white/[0.06]"}`}>
                          <span className={`w-1 h-1 rounded-full ${p.isActive ? "bg-emerald-400" : "bg-gray-600"}`} />
                          {p.isActive ? "Đang bán" : "Đã ẩn"}
                        </span>
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex items-center gap-2.5">
                          <button onClick={() => toggleMut.mutate(p.id)} disabled={toggleMut.isPending}
                            title={p.isActive ? "Ẩn khỏi bot" : "Hiện trên bot"}
                            className={`transition-colors ${p.isActive ? "text-emerald-500 hover:text-gray-500" : "text-gray-600 hover:text-emerald-500"}`}>
                            {p.isActive ? <Eye size={14} /> : <EyeOff size={14} />}
                          </button>
                          <button onClick={() => openEdit(p)} title="Sửa" className="text-gray-500 hover:text-primary-400 transition-colors">
                            <Pencil size={14} />
                          </button>
                          <button onClick={() => { if (confirm(`Xóa "${p.name}"?`)) delMut.mutate(p.id); }}
                            title="Xóa" className="text-gray-600 hover:text-red-500 transition-colors">
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

      {/* ── Create / Edit modal ────────────────────────────── */}
      {modal && createPortal(
        <div className="fixed inset-0 bg-black/70 z-[9999] flex items-center justify-center p-4">
          <div className="glass-md rounded-2xl shadow-modal w-full max-w-lg max-h-[90vh] flex flex-col">
            {/* Header */}
            <div className="px-5 py-4 border-b border-white/[0.07] flex items-center justify-between flex-shrink-0">
              <h2 className="font-semibold text-white">{modal.product ? "Sửa sản phẩm" : "Thêm sản phẩm mới"}</h2>
              <button onClick={() => setModal(null)} className="text-gray-500 hover:text-gray-300 transition-colors"><X size={16} /></button>
            </div>

            <div className="overflow-y-auto flex-1 p-5 space-y-4">
              {/* Section: Thông tin cơ bản */}
              <div>
                <p className="text-[10px] font-semibold text-gray-600 uppercase tracking-widest mb-2">Thông tin cơ bản</p>
                <div className="space-y-2.5">
                  <div>
                    <label className="text-xs text-gray-400 block mb-1">Tên sản phẩm <span className="text-red-500">*</span></label>
                    <input value={form.name} onChange={f("name")} placeholder="VD: ChatGPT Plus 1 Tháng"
                      className="w-full glass-input rounded-lg px-3 py-2 text-sm" />
                  </div>
                  <div>
                    <label className="text-xs text-gray-400 block mb-1">Lưu ý (hiện với khách)</label>
                    <input value={form.note} onChange={f("note")} placeholder="VD: Bảo hành 1 đổi 1 trong 24h"
                      className="w-full glass-input rounded-lg px-3 py-2 text-sm" />
                  </div>
                  <div>
                    <label className="text-xs text-gray-400 block mb-1">Danh mục</label>
                    <select value={form.categoryId} onChange={f("categoryId")} className="w-full glass-input rounded-lg px-3 py-2 text-sm">
                      <option value="">— Không có —</option>
                      {categories.map((c) => <option key={c.id} value={c.id}>{c.icon} {c.name}</option>)}
                    </select>
                  </div>
                </div>
              </div>

              <div className="border-t border-white/[0.06]" />

              {/* Section: Giá & số lượng */}
              <div>
                <p className="text-[10px] font-semibold text-gray-600 uppercase tracking-widest mb-2">Giá & số lượng</p>
                <div className="grid grid-cols-2 gap-2.5">
                  <div>
                    <label className="text-xs text-gray-400 block mb-1">Giá bán (VND) <span className="text-red-500">*</span></label>
                    <input type="number" value={form.price} onChange={f("price")} placeholder="35000"
                      className="w-full glass-input rounded-lg px-3 py-2 text-sm" />
                  </div>
                  <div>
                    <label className="text-xs text-gray-400 block mb-1">Giá vốn (VND)</label>
                    <input type="number" value={form.costPrice} onChange={f("costPrice")} placeholder="Tùy chọn"
                      className="w-full glass-input rounded-lg px-3 py-2 text-sm" />
                  </div>
                  <div>
                    <label className="text-xs text-gray-400 block mb-1">SL tối thiểu</label>
                    <input type="number" min="1" value={form.minQty} onChange={f("minQty")}
                      className="w-full glass-input rounded-lg px-3 py-2 text-sm" />
                  </div>
                  <div>
                    <label className="text-xs text-gray-400 block mb-1">SL tối đa</label>
                    <input type="number" min="1" value={form.maxQty} onChange={f("maxQty")} placeholder="Không giới hạn"
                      className="w-full glass-input rounded-lg px-3 py-2 text-sm" />
                  </div>
                </div>
              </div>

              <div className="border-t border-white/[0.06]" />

              {/* Section: Giao hàng */}
              <div>
                <p className="text-[10px] font-semibold text-gray-600 uppercase tracking-widest mb-2">Giao hàng</p>
                <div className="space-y-2.5">
                  <div>
                    <label className="text-xs text-gray-400 block mb-1">Kiểu giao hàng</label>
                    <select value={form.deliveryMode} onChange={f("deliveryMode")} className="w-full glass-input rounded-lg px-3 py-2 text-sm">
                      <option value="TEXT">TEXT — Nội dung cố định</option>
                      <option value="STOCK_LINES">STOCK_LINES — Tài khoản/mã từ kho</option>
                      <option value="FILE">FILE — File đính kèm</option>
                      <option value="API_CALL">API_CALL — Gọi API nhà cung cấp</option>
                    </select>
                  </div>
                  {form.deliveryMode === "TEXT" && (
                    <div>
                      <label className="text-xs text-gray-400 block mb-1">Nội dung giao hàng</label>
                      <textarea value={form.payload} onChange={f("payload")} rows={3}
                        placeholder="Nội dung sẽ gửi cho khách sau khi mua..."
                        className="w-full glass-input rounded-lg px-3 py-2 text-sm resize-none" />
                    </div>
                  )}
                  {form.deliveryMode === "FILE" && (
                    <div>
                      <label className="text-xs text-gray-400 block mb-1">Đường dẫn file</label>
                      <input value={form.payload} onChange={f("payload")} placeholder="/path/to/file.pdf"
                        className="w-full glass-input rounded-lg px-3 py-2 text-sm font-mono" />
                    </div>
                  )}
                  {form.deliveryMode === "STOCK_LINES" && (
                    <p className="text-xs text-gray-600 bg-emerald-950/20 border border-emerald-900/30 rounded-lg px-3 py-2">
                      Stock được quản lý trong trang <span className="text-emerald-500 font-medium">Nhập kho</span> hoặc click vào số tồn kho trong bảng sản phẩm.
                    </p>
                  )}
                  {form.deliveryMode === "API_CALL" && (
                    <p className="text-xs text-gray-600 bg-orange-950/20 border border-orange-900/30 rounded-lg px-3 py-2">
                      Cấu hình API được quản lý trong trang <span className="text-orange-400 font-medium">Kết nối API</span>.
                    </p>
                  )}
                </div>
              </div>

              <div className="border-t border-white/[0.06]" />

              {/* Mô tả */}
              <div>
                <label className="text-xs text-gray-400 block mb-1">Mô tả (tùy chọn)</label>
                <textarea value={form.description} onChange={f("description")} rows={3}
                  placeholder="Mô tả chi tiết sản phẩm..."
                  className="w-full glass-input rounded-lg px-3 py-2 text-sm resize-none" />
              </div>
            </div>

            {/* Footer */}
            <div className="px-5 py-3.5 border-t border-white/[0.07] flex gap-2 flex-shrink-0">
              <button onClick={() => setModal(null)} className="flex-1 py-2 rounded-lg text-sm text-gray-400 border border-white/[0.08] hover:bg-white/[0.04] transition-colors">
                Hủy
              </button>
              <button onClick={() => saveMut.mutate(form)} disabled={!form.name || !form.price || saveMut.isPending}
                className="flex-1 py-2 bg-primary-500 text-white rounded-lg text-sm font-medium hover:bg-primary-600 disabled:opacity-50 transition-colors shadow-glow-sm hover:shadow-glow">
                {saveMut.isPending ? "Đang lưu..." : modal.product ? "Lưu thay đổi" : "Tạo sản phẩm"}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* ── Stock modal ────────────────────────────────────── */}
      {stockProduct && createPortal(
        <div className="fixed inset-0 bg-black/70 z-[9999] flex items-center justify-center p-4">
          <div className="glass-md rounded-2xl shadow-modal w-full max-w-2xl max-h-[85vh] flex flex-col">
            {/* Header */}
            <div className="px-5 py-4 border-b border-white/[0.07] flex items-start justify-between flex-shrink-0">
              <div>
                <h2 className="font-semibold text-white">{stockProduct.name}</h2>
                <p className="text-xs text-gray-500 mt-0.5">
                  <span className="text-emerald-400 font-semibold">{stockUnsoldCount}</span> chưa bán ·{" "}
                  <span className="text-gray-400">{stockSoldCount} đã bán</span>
                </p>
              </div>
              <button onClick={() => setStockProduct(null)} className="text-gray-500 hover:text-gray-300 transition-colors mt-0.5"><X size={15} /></button>
            </div>

            {/* Bulk add */}
            <div className="px-5 py-4 border-b border-white/[0.07] bg-white/[0.015] flex-shrink-0">
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-xs font-semibold text-gray-400">Nhập stock mới — mỗi dòng 1 tài khoản/mã</label>
                {stockLineCount > 0 && (
                  <span className="text-[10px] font-semibold bg-primary-900/60 text-primary-400 px-1.5 py-0.5 rounded-full">{stockLineCount} dòng</span>
                )}
              </div>
              <textarea value={stockLines} onChange={(e) => setStockLines(e.target.value)} rows={3}
                placeholder={"user1:pass1\nuser2:pass2\nuser3:pass3"}
                className="w-full glass-input rounded-lg px-3 py-2 text-xs font-mono resize-none" />
              <div className="flex items-center gap-2 mt-2">
                <button onClick={() => bulkAddMut.mutate()} disabled={!stockLines.trim() || bulkAddMut.isPending}
                  className="flex items-center gap-1.5 px-3.5 py-1.5 bg-primary-500 text-white rounded-lg text-xs font-semibold hover:bg-primary-600 disabled:opacity-50 transition-colors shadow-glow-sm">
                  <Plus size={11} />
                  {bulkAddMut.isPending ? "Đang thêm..." : `Thêm ${stockLineCount} dòng`}
                </button>
                {bulkAddMut.isSuccess && bulkAddMut.data && (
                  <span className="text-xs text-emerald-400 flex items-center gap-1"><Check size={11} /> Đã thêm {bulkAddMut.data.created} mục</span>
                )}
                <button onClick={() => { if (confirm(`Xóa toàn bộ ${stockUnsoldCount} mục chưa bán?`)) clearStockMut.mutate(); }}
                  disabled={clearStockMut.isPending || stockUnsoldCount === 0}
                  className="ml-auto text-[11px] text-red-500 hover:text-red-400 disabled:opacity-30 transition-colors">
                  {clearStockMut.isPending ? "Đang xóa..." : "Xóa tất cả chưa bán"}
                </button>
              </div>
            </div>

            {/* Tabs */}
            <div className="flex items-center gap-1 px-5 py-2 border-b border-white/[0.07] flex-shrink-0">
              <button onClick={() => { setShowSold(false); setStockPage(1); }}
                className={`px-2.5 py-1 text-xs rounded-md font-medium transition-colors ${!showSold ? "bg-emerald-600/20 text-emerald-400 border border-emerald-700/30" : "text-gray-500 hover:text-gray-300"}`}>
                Chưa bán · <span className="font-bold">{stockUnsoldCount}</span>
              </button>
              <button onClick={() => { setShowSold(true); setStockPage(1); }}
                className={`px-2.5 py-1 text-xs rounded-md font-medium transition-colors ${showSold ? "bg-white/[0.07] text-gray-300 border border-white/[0.1]" : "text-gray-500 hover:text-gray-300"}`}>
                Đã bán · <span className="font-bold">{stockSoldCount}</span>
              </button>
            </div>

            {/* Items */}
            <div className="overflow-y-auto flex-1 py-2 px-3">
              {stockLoading ? (
                <p className="text-center py-10 text-xs text-gray-500">Đang tải...</p>
              ) : stockItems.length === 0 ? (
                <p className="text-center py-10 text-xs text-gray-600">
                  {showSold ? "Chưa có mục nào đã bán" : "Kho trống — nhập stock ở trên"}
                </p>
              ) : (
                <div>
                  {stockItems.map((item, idx) => (
                    <div key={item.id} className="flex items-center gap-2.5 py-1.5 px-2 rounded-lg hover:bg-white/[0.04] group transition-colors">
                      <span className="text-[10px] text-gray-700 w-6 text-right flex-shrink-0 font-mono">
                        {(stockPage - 1) * 50 + idx + 1}
                      </span>
                      <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${item.isSold ? "bg-gray-600" : "bg-emerald-500"}`} />
                      <span className="font-mono text-xs text-gray-300 flex-1 truncate">{item.content}</span>
                      {item.isSold && item.soldAt && (
                        <span className="text-[10px] text-gray-600 flex-shrink-0">{new Date(item.soldAt).toLocaleDateString("vi-VN")}</span>
                      )}
                      <div className="opacity-0 group-hover:opacity-100 flex items-center gap-1 flex-shrink-0 transition-opacity">
                        <button onClick={() => copyItem(item.content, item.id)} title="Sao chép" className="text-gray-600 hover:text-gray-300 transition-colors">
                          {copied === item.id ? <Check size={11} className="text-emerald-400" /> : <Copy size={11} />}
                        </button>
                        {!item.isSold && (
                          <button onClick={() => delStockMut.mutate(item.id)} disabled={delStockMut.isPending}
                            title="Xóa" className="text-gray-600 hover:text-red-400 transition-colors">
                            <X size={11} />
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Pagination */}
            {stockTotalPages > 1 && (
              <div className="px-5 py-2.5 border-t border-white/[0.07] flex items-center justify-between text-[11px] text-gray-600 flex-shrink-0">
                <span>{stockTotal} mục · trang {stockPage}/{stockTotalPages}</span>
                <div className="flex gap-1">
                  <button disabled={stockPage === 1} onClick={() => setStockPage((p) => p - 1)}
                    className="w-6 h-6 flex items-center justify-center border border-white/[0.07] rounded hover:bg-white/[0.05] disabled:opacity-30">‹</button>
                  <button disabled={stockPage === stockTotalPages} onClick={() => setStockPage((p) => p + 1)}
                    className="w-6 h-6 flex items-center justify-center border border-white/[0.07] rounded hover:bg-white/[0.05] disabled:opacity-30">›</button>
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
