import { useState } from "react";
import { createPortal } from "react-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Package, Pencil, Trash2, X, Eye, EyeOff, Copy, Check, ChevronDown, ChevronUp, Link2, Link2Off } from "lucide-react";
import { api } from "../api/endpoints";
import SearchBar from "../components/SearchBar";
import Pagination from "../components/Pagination";
import TabFilter from "../components/TabFilter";
import EmptyState from "../components/EmptyState";
import { formatCurrency, formatDate } from "../utils/format";

const EMPTY_FORM = {
  name: "", description: "", price: "", costPrice: "",
  currency: "VND", deliveryMode: "TEXT", payload: "", note: "",
  categoryId: "", minQty: "1", maxQty: "", icon: "📦", iconEmojiId: "",
};

const STATUS_TABS = [
  { value: "all",      label: "Tất cả" },
  { value: "active",   label: "Đang bán" },
  { value: "inactive", label: "Đã ẩn" },
  { value: "unlisted", label: "Bán riêng" },
];

const DELIVERY_BADGE = {
  STOCK_LINES: { label: "STOCK",   cls: "bg-emerald-950/60 text-emerald-300 border-emerald-800/40" },
  TEXT:        { label: "TEXT",    cls: "bg-indigo-950/60 text-indigo-300 border-indigo-800/40" },
  FILE:        { label: "FILE",    cls: "bg-purple-950/60 text-purple-300 border-purple-800/40" },
  API_CALL:    { label: "API",     cls: "bg-amber-950/60 text-amber-300 border-amber-800/40" },
};

function DeliveryBadge({ mode }) {
  const b = DELIVERY_BADGE[mode] || { label: mode, cls: "bg-slate-900 text-slate-400 border-slate-800" };
  return (
    <span className={`text-[10px] font-mono font-semibold px-2 py-0.5 rounded border ${b.cls}`}>{b.label}</span>
  );
}

function StockBadge({ count, onClick }) {
  if (count === 0) {
    return (
      <button onClick={onClick} className="text-xs font-mono font-semibold text-rose-400 hover:text-rose-300 transition-colors px-2 py-0.5 rounded bg-rose-950/40 border border-rose-800/40 cursor-pointer">
        0
      </button>
    );
  }
  if (count <= 5) {
    return (
      <button onClick={onClick} className="text-xs font-mono font-semibold text-amber-400 hover:text-amber-300 transition-colors px-2 py-0.5 rounded bg-amber-950/40 border border-amber-800/40 cursor-pointer">
        {count}
      </button>
    );
  }
  return (
    <button onClick={onClick} className="text-xs font-mono font-semibold text-emerald-400 hover:text-emerald-300 transition-colors px-2 py-0.5 rounded bg-emerald-950/40 border border-emerald-800/40 cursor-pointer">
      {count}
    </button>
  );
}

export default function Products() {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [modeFilter, setModeFilter] = useState("");
  const [sortCol, setSortCol] = useState("createdAt");
  const [sortDir, setSortDir] = useState("desc");
  const [modal, setModal] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [stockProduct, setStockProduct] = useState(null);
  const [stockLines, setStockLines] = useState("");
  const [stockPage, setStockPage] = useState(1);
  const [showSold, setShowSold] = useState(false);
  const [copied, setCopied] = useState(null);
  const qc = useQueryClient();

  function toggleSort(col) {
    if (sortCol === col) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortCol(col); setSortDir("desc"); }
    setPage(1);
  }

  const { data, isLoading } = useQuery({
    queryKey: ["products", page, pageSize, search, status, categoryFilter, modeFilter, sortCol, sortDir],
    queryFn: () => api.products({
      page, limit: pageSize, search, status, sort: sortCol, order: sortDir,
      ...(categoryFilter ? { categoryId: categoryFilter } : {}),
      ...(modeFilter ? { deliveryMode: modeFilter } : {})
    }),
  });
  const { data: catData } = useQuery({ queryKey: ["categories"], queryFn: api.categories });
  const { data: botStatus } = useQuery({ queryKey: ["bot-status"], queryFn: api.botStatus });
  const botUsername = botStatus?.username;
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
  const unlistMut = useMutation({ mutationFn: (id) => api.toggleProductUnlisted(id), onSuccess: () => qc.invalidateQueries(["products"]) });
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
    setForm({
      name: p.name, description: p.description || "", price: p.price, costPrice: p.costPrice || "",
      currency: p.currency || "VND", deliveryMode: p.deliveryMode, payload: p.payload || "", note: p.note || "",
      categoryId: p.categoryId || "", minQty: p.minQty ?? "1", maxQty: p.maxQty || "", icon: p.icon || "📦",
      iconEmojiId: p.iconEmojiId || "",
    });
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
    <div className="space-y-4 pb-10">
      {/* Header with eyebrow, tight tracking, dev toolbar */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-1">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="eyebrow text-slate-400">CATALOG // INVENTORY</span>
            <span className="w-1 h-1 rounded-full bg-slate-600" />
            <span className="text-[10px] font-mono text-indigo-400">STOCK ENGINE</span>
          </div>
          <h1 className="text-xl font-bold text-slate-100 tracking-tight flex items-center gap-2">
            Sản phẩm
            <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-indigo-500/10 text-indigo-300 border border-indigo-500/25">
              {total} SẢN PHẨM
            </span>
          </h1>
          <p className="text-xs text-slate-400 mt-0.5 tracking-tight">
            Quản lý kho hàng, chế độ giao tự động/thủ công và link bán riêng
          </p>
        </div>

        <div>
          <button
            onClick={openCreate}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-mono font-medium transition-all shadow-sm cursor-pointer"
          >
            <Plus size={13} />
            <span>THÊM SẢN PHẨM</span>
          </button>
        </div>
      </div>

      {/* Main Bento Card Container */}
      <div className="bento-card p-4 space-y-3.5">
        <TabFilter tabs={STATUS_TABS} active={status} onChange={(v) => { setStatus(v); setPage(1); }} />

        <div className="pt-1 border-t border-slate-800/60">
          <SearchBar placeholder="Tìm tên, mã sản phẩm..." value={search} onChange={setSearch} onSearch={() => setPage(1)} />
        </div>

        {/* Filter Toolbar row */}
        <div className="flex items-center gap-2 pt-1 border-t border-slate-800/60 flex-wrap">
          <select
            value={categoryFilter}
            onChange={(e) => { setCategoryFilter(e.target.value); setPage(1); }}
            className="dev-input rounded-lg px-2.5 py-1 text-xs font-mono text-slate-300"
          >
            <option value="">Tất cả danh mục</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>

          {[["", "TẤT CẢ KIỂU"], ["STOCK_LINES", "STOCK"], ["TEXT", "TEXT"], ["FILE", "FILE"], ["API_CALL", "API"]].map(([v, label]) => (
            <button
              key={v}
              onClick={() => { setModeFilter(v); setPage(1); }}
              className={`text-[11px] font-mono px-2.5 py-1 rounded-md transition-all border cursor-pointer ${
                modeFilter === v
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
            ĐANG TẢI SẢN PHẨM...
          </div>
        ) : products.length === 0 ? (
          <EmptyState icon={Package} message="Chưa có sản phẩm nào khớp với điều kiện lọc" />
        ) : (
          <>
            <div className="overflow-x-auto rounded-lg border border-slate-800/80">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="bg-slate-900/60 border-b border-slate-800/80 text-[10px] font-mono text-slate-400 uppercase tracking-wider">
                    <th
                      className="px-3.5 py-2.5 font-medium cursor-pointer select-none hover:text-slate-200 transition-colors"
                      onClick={() => toggleSort("name")}
                    >
                      <span className="flex items-center gap-1">
                        TÊN SẢN PHẨM {sortCol === "name" ? (sortDir === "asc" ? <ChevronUp size={11} className="text-indigo-400" /> : <ChevronDown size={11} className="text-indigo-400" />) : <ChevronDown size={11} className="opacity-30" />}
                      </span>
                    </th>
                    <th className="px-3 py-2.5 font-medium">DANH MỤC</th>
                    <th
                      className="px-3 py-2.5 font-medium cursor-pointer select-none hover:text-slate-200 transition-colors"
                      onClick={() => toggleSort("price")}
                    >
                      <span className="flex items-center gap-1">
                        GIÁ BÁN {sortCol === "price" ? (sortDir === "asc" ? <ChevronUp size={11} className="text-indigo-400" /> : <ChevronDown size={11} className="text-indigo-400" />) : <ChevronDown size={11} className="opacity-30" />}
                      </span>
                    </th>
                    <th className="px-3 py-2.5 font-medium">KIỂU GIAO</th>
                    <th className="px-3 py-2.5 font-medium text-center">TỒN KHO</th>
                    <th className="px-3 py-2.5 font-medium">TRẠNG THÁI</th>
                    <th
                      className="px-3 py-2.5 font-medium cursor-pointer select-none hover:text-slate-200 transition-colors"
                      onClick={() => toggleSort("createdAt")}
                    >
                      <span className="flex items-center gap-1">
                        NGÀY TẠO {sortCol === "createdAt" ? (sortDir === "asc" ? <ChevronUp size={11} className="text-indigo-400" /> : <ChevronDown size={11} className="text-indigo-400" />) : <ChevronDown size={11} className="opacity-30" />}
                      </span>
                    </th>
                    <th className="px-3.5 py-2.5 font-medium text-right">THAO TÁC</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60 font-sans">
                  {products.map((p) => (
                    <tr
                      key={p.id}
                      className={`hover:bg-slate-800/30 transition-colors ${!p.isActive ? "opacity-50" : ""}`}
                    >
                      <td className="px-3.5 py-3 max-w-[240px]">
                        <p className="font-medium text-slate-100 truncate text-xs">{p.name}</p>
                        {p.code && <p className="text-[10px] text-slate-500 font-mono mt-0.5">{p.code}</p>}
                      </td>
                      <td className="px-3 py-3 text-slate-400 text-xs">
                        {p.category?.name || <span className="text-slate-600">—</span>}
                      </td>
                      <td className="px-3 py-3 font-mono font-semibold text-slate-100 text-xs">
                        {p.price > 0 ? formatCurrency(p.price) : <span className="text-slate-500 font-normal">Liên hệ</span>}
                      </td>
                      <td className="px-3 py-3">
                        <DeliveryBadge mode={p.deliveryMode} />
                      </td>
                      <td className="px-3 py-3 text-center">
                        {p.deliveryMode === "STOCK_LINES" ? (
                          <StockBadge count={p._count?.stockItems ?? 0} onClick={() => openStock(p)} />
                        ) : (
                          <span className="text-xs font-mono text-slate-600">—</span>
                        )}
                      </td>
                      <td className="px-3 py-3">
                        {!p.isActive ? (
                          <span className="inline-flex items-center gap-1 text-[10px] font-mono px-2 py-0.5 rounded-full border bg-slate-900 text-slate-500 border-slate-800">
                            <span className="w-1 h-1 rounded-full bg-slate-500" />
                            ĐÃ ẨN
                          </span>
                        ) : p.unlisted ? (
                          <span className="inline-flex items-center gap-1 text-[10px] font-mono px-2 py-0.5 rounded-full border bg-amber-950/40 text-amber-400 border-amber-800/40" title="Chỉ bán qua link">
                            <span className="w-1 h-1 rounded-full bg-amber-400" />
                            BÁN RIÊNG
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-[10px] font-mono px-2 py-0.5 rounded-full border bg-emerald-950/40 text-emerald-400 border-emerald-800/40">
                            <span className="w-1 h-1 rounded-full bg-emerald-400" />
                            ĐANG BÁN
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-3 font-mono text-[11px] text-slate-400">
                        {formatDate(p.createdAt)}
                      </td>
                      <td className="px-3.5 py-3 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            onClick={() => toggleMut.mutate(p.id)}
                            disabled={toggleMut.isPending}
                            title={p.isActive ? "Ẩn khỏi bot" : "Hiện trên bot"}
                            className={`p-1.5 rounded border border-transparent hover:border-slate-700 transition-all cursor-pointer ${
                              p.isActive ? "text-emerald-400 hover:text-slate-400 hover:bg-slate-800/60" : "text-slate-500 hover:text-emerald-400 hover:bg-slate-800/60"
                            }`}
                          >
                            {p.isActive ? <Eye size={13} /> : <EyeOff size={13} />}
                          </button>
                          <button
                            onClick={() => unlistMut.mutate(p.id)}
                            disabled={unlistMut.isPending || !p.isActive}
                            title={!p.isActive ? "Bật sản phẩm trước" : p.unlisted ? "Hiện công khai" : "Chỉ bán qua link"}
                            className={`p-1.5 rounded border border-transparent hover:border-slate-700 transition-all cursor-pointer ${
                              !p.isActive ? "text-slate-700 cursor-not-allowed" : p.unlisted ? "text-amber-400 hover:text-slate-400 hover:bg-slate-800/60" : "text-slate-500 hover:text-amber-400 hover:bg-slate-800/60"
                            }`}
                          >
                            {p.unlisted ? <Link2Off size={13} /> : <Link2 size={13} />}
                          </button>
                          {p.unlisted && botUsername && (
                            <button
                              onClick={() => copyItem(`https://t.me/${botUsername}?start=product_${p.id}`, `link-${p.id}`)}
                              title="Copy link bán riêng"
                              className="p-1.5 rounded border border-transparent hover:border-slate-700 text-slate-500 hover:text-amber-400 hover:bg-slate-800/60 transition-all cursor-pointer"
                            >
                              {copied === `link-${p.id}` ? <Check size={13} className="text-emerald-400" /> : <Copy size={13} />}
                            </button>
                          )}
                          <button
                            onClick={() => openEdit(p)}
                            title="Sửa sản phẩm"
                            className="p-1.5 text-slate-400 hover:text-indigo-400 hover:bg-slate-800/60 rounded border border-transparent hover:border-slate-700 transition-all cursor-pointer"
                          >
                            <Pencil size={13} />
                          </button>
                          <button
                            onClick={() => { if (confirm(`Xóa "${p.name}"?`)) delMut.mutate(p.id); }}
                            title="Xóa sản phẩm"
                            className="p-1.5 text-slate-400 hover:text-rose-400 hover:bg-slate-800/60 rounded border border-transparent hover:border-slate-700 transition-all cursor-pointer"
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
            <Pagination
              page={page}
              totalPages={totalPages}
              total={total}
              pageSize={pageSize}
              onPage={setPage}
              onPageSize={(s) => { setPageSize(s); setPage(1); }}
            />
          </>
        )}
      </div>

      {/* ── Create / Edit modal ────────────────────────────── */}
      {modal && createPortal(
        <div className="fixed inset-0 bg-black/80 z-[9999] flex items-center justify-center p-4 backdrop-blur-sm animate-fade-in">
          <div className="bento-card border-slate-800 w-full max-w-lg max-h-[90vh] flex flex-col shadow-2xl animate-modal-in">
            {/* Header */}
            <div className="px-5 py-3.5 border-b border-slate-800/80 flex items-center justify-between flex-shrink-0">
              <div>
                <span className="eyebrow text-slate-400 block mb-0.5">PRODUCT CONFIGURATION</span>
                <h2 className="font-bold text-slate-100 tracking-tight text-sm">
                  {modal.product ? "Sửa sản phẩm" : "Thêm sản phẩm mới"}
                </h2>
              </div>
              <button
                onClick={() => setModal(null)}
                className="text-slate-400 hover:text-slate-200 p-1 rounded hover:bg-slate-800/60 transition-colors cursor-pointer"
              >
                <X size={16} />
              </button>
            </div>

            <div className="overflow-y-auto flex-1 p-5 space-y-4 text-xs font-mono">
              {/* Section: Thông tin cơ bản */}
              <div>
                <span className="eyebrow text-slate-400 block mb-2">THÔNG TIN CƠ BẢN</span>
                <div className="space-y-2.5">
                  <div>
                    <label className="text-[10px] text-slate-400 block mb-1 uppercase tracking-wider">
                      Tên sản phẩm <span className="text-rose-400">*</span>
                    </label>
                    <input
                      value={form.name}
                      onChange={f("name")}
                      placeholder="VD: ChatGPT Plus 1 Tháng"
                      className="w-full dev-input px-3 py-2 text-xs font-sans"
                    />
                  </div>
                  <div className="grid grid-cols-[80px_1fr] gap-2.5">
                    <div>
                      <label className="text-[10px] text-slate-400 block mb-1 uppercase tracking-wider">Emoji</label>
                      <input
                        value={form.icon}
                        onChange={f("icon")}
                        maxLength={8}
                        className="w-full dev-input px-3 py-2 text-xs text-center font-mono"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] text-slate-400 block mb-1 uppercase tracking-wider">Custom Emoji ID</label>
                      <input
                        value={form.iconEmojiId}
                        onChange={f("iconEmojiId")}
                        inputMode="numeric"
                        placeholder="5368324170671202286"
                        className="w-full dev-input px-3 py-2 text-xs font-mono"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="text-[10px] text-slate-400 block mb-1 uppercase tracking-wider">Lưu ý cho khách</label>
                    <input
                      value={form.note}
                      onChange={f("note")}
                      placeholder="VD: Bảo hành 1 đổi 1 trong 24h"
                      className="w-full dev-input px-3 py-2 text-xs font-sans"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] text-slate-400 block mb-1 uppercase tracking-wider">Danh mục</label>
                    <select
                      value={form.categoryId}
                      onChange={f("categoryId")}
                      className="w-full dev-input px-3 py-2 text-xs font-sans"
                    >
                      <option value="">— Không có —</option>
                      {categories.map((c) => <option key={c.id} value={c.id}>{c.icon} {c.name}</option>)}
                    </select>
                  </div>
                </div>
              </div>

              <div className="border-t border-slate-800/60" />

              {/* Section: Giá & số lượng */}
              <div>
                <span className="eyebrow text-slate-400 block mb-2">GIÁ & SỐ LƯỢNG MUA</span>
                <div className="grid grid-cols-2 gap-2.5">
                  <div>
                    <label className="text-[10px] text-slate-400 block mb-1 uppercase tracking-wider">
                      Giá bán (VND) <span className="text-rose-400">*</span>
                    </label>
                    <input
                      type="number"
                      value={form.price}
                      onChange={f("price")}
                      placeholder="35000"
                      className="w-full dev-input px-3 py-2 text-xs font-mono"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] text-slate-400 block mb-1 uppercase tracking-wider">Giá vốn (VND)</label>
                    <input
                      type="number"
                      value={form.costPrice}
                      onChange={f("costPrice")}
                      placeholder="Tùy chọn"
                      className="w-full dev-input px-3 py-2 text-xs font-mono"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] text-slate-400 block mb-1 uppercase tracking-wider">SL tối thiểu</label>
                    <input
                      type="number"
                      min="1"
                      value={form.minQty}
                      onChange={f("minQty")}
                      className="w-full dev-input px-3 py-2 text-xs font-mono"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] text-slate-400 block mb-1 uppercase tracking-wider">SL tối đa</label>
                    <input
                      type="number"
                      min="1"
                      value={form.maxQty}
                      onChange={f("maxQty")}
                      placeholder="Vô hạn"
                      className="w-full dev-input px-3 py-2 text-xs font-mono"
                    />
                  </div>
                </div>
              </div>

              <div className="border-t border-slate-800/60" />

              {/* Section: Giao hàng */}
              <div>
                <span className="eyebrow text-slate-400 block mb-2">CƠ CHẾ PHÁT HÀNG</span>
                <div className="space-y-2.5">
                  <div>
                    <label className="text-[10px] text-slate-400 block mb-1 uppercase tracking-wider">Kiểu giao hàng</label>
                    <select
                      value={form.deliveryMode}
                      onChange={f("deliveryMode")}
                      className="w-full dev-input px-3 py-2 text-xs font-mono"
                    >
                      <option value="TEXT">TEXT — Nội dung cố định</option>
                      <option value="STOCK_LINES">STOCK_LINES — Tài khoản/mã từ kho</option>
                      <option value="FILE">FILE — File đính kèm</option>
                      <option value="API_CALL">API_CALL — Gọi API nhà cung cấp</option>
                    </select>
                  </div>
                  {form.deliveryMode === "TEXT" && (
                    <div>
                      <label className="text-[10px] text-slate-400 block mb-1 uppercase tracking-wider">Nội dung gửi</label>
                      <textarea
                        value={form.payload}
                        onChange={f("payload")}
                        rows={3}
                        placeholder="Nội dung sẽ gửi cho khách sau khi mua..."
                        className="w-full dev-input px-3 py-2 text-xs font-sans resize-none"
                      />
                    </div>
                  )}
                  {form.deliveryMode === "FILE" && (
                    <div>
                      <label className="text-[10px] text-slate-400 block mb-1 uppercase tracking-wider">Đường dẫn file</label>
                      <input
                        value={form.payload}
                        onChange={f("payload")}
                        placeholder="/path/to/file.pdf"
                        className="w-full dev-input px-3 py-2 text-xs font-mono"
                      />
                    </div>
                  )}
                  {form.deliveryMode === "STOCK_LINES" && (
                    <p className="text-[11px] text-slate-400 bg-slate-900/60 border border-slate-800 rounded-lg px-3 py-2 font-mono">
                      Stock được quản lý trong mục <span className="text-emerald-400 font-semibold">Tồn kho</span> của sản phẩm này.
                    </p>
                  )}
                  {form.deliveryMode === "API_CALL" && (
                    <p className="text-[11px] text-slate-400 bg-slate-900/60 border border-slate-800 rounded-lg px-3 py-2 font-mono">
                      Cấu hình API được kết nối qua mục <span className="text-amber-400 font-semibold">Kết nối API</span>.
                    </p>
                  )}
                </div>
              </div>

              <div className="border-t border-slate-800/60" />

              {/* Mô tả */}
              <div>
                <span className="eyebrow text-slate-400 block mb-1">MÔ TẢ CHI TIẾT</span>
                <textarea
                  value={form.description}
                  onChange={f("description")}
                  rows={2}
                  placeholder="Mô tả chi tiết sản phẩm..."
                  className="w-full dev-input px-3 py-2 text-xs font-sans resize-none"
                />
              </div>
            </div>

            {/* Footer */}
            <div className="px-5 py-3 border-t border-slate-800/80 flex gap-2 flex-shrink-0">
              {saveMut.isError && (
                <span className="w-full text-xs font-mono text-rose-400">
                  {saveMut.error?.response?.data?.error || saveMut.error?.message}
                </span>
              )}
              <button
                onClick={() => setModal(null)}
                className="flex-1 py-1.5 rounded-lg text-xs font-mono text-slate-400 border border-slate-800 hover:text-white transition-colors cursor-pointer"
              >
                HỦY
              </button>
              <button
                onClick={() => saveMut.mutate(form)}
                disabled={!form.name || !form.price || saveMut.isPending}
                className="flex-1 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-mono font-medium disabled:opacity-50 transition-all cursor-pointer shadow-sm"
              >
                {saveMut.isPending ? "ĐANG LƯU..." : modal.product ? "LƯU THAY ĐỔI" : "TẠO SẢN PHẨM"}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* ── Stock modal ────────────────────────────────────── */}
      {stockProduct && createPortal(
        <div className="fixed inset-0 bg-black/80 z-[9999] flex items-center justify-center p-4 backdrop-blur-sm animate-fade-in">
          <div className="bento-card border-slate-800 w-full max-w-2xl max-h-[85vh] flex flex-col shadow-2xl animate-modal-in">
            {/* Header */}
            <div className="px-5 py-3.5 border-b border-slate-800/80 flex items-start justify-between flex-shrink-0">
              <div>
                <span className="eyebrow text-slate-400 block mb-0.5">INVENTORY // STOCK REPOSITORY</span>
                <h2 className="font-bold text-slate-100 text-sm tracking-tight">{stockProduct.name}</h2>
                <p className="text-[11px] font-mono text-slate-500 mt-0.5">
                  <span className="text-emerald-400 font-semibold">{stockUnsoldCount} CHƯA BÁN</span> ·{" "}
                  <span className="text-slate-400">{stockSoldCount} ĐÃ BÁN</span>
                </p>
              </div>
              <button
                onClick={() => setStockProduct(null)}
                className="text-slate-400 hover:text-slate-200 p-1 rounded hover:bg-slate-800/60 transition-colors cursor-pointer"
              >
                <X size={15} />
              </button>
            </div>

            {/* Bulk add */}
            <div className="px-5 py-3.5 border-b border-slate-800/80 bg-slate-900/40 flex-shrink-0 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-mono uppercase text-slate-400 tracking-wider">
                  Nhập stock mới — mỗi dòng 1 tài khoản/mã
                </span>
                {stockLineCount > 0 && (
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-indigo-500/10 text-indigo-300 border border-indigo-500/25">
                    {stockLineCount} DÒNG
                  </span>
                )}
              </div>
              <textarea
                value={stockLines}
                onChange={(e) => setStockLines(e.target.value)}
                rows={3}
                placeholder={"user1:pass1\nuser2:pass2\nuser3:pass3"}
                className="w-full dev-input px-3 py-2 text-xs font-mono resize-none"
              />
              <div className="flex items-center gap-2 pt-1">
                <button
                  onClick={() => bulkAddMut.mutate()}
                  disabled={!stockLines.trim() || bulkAddMut.isPending}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-mono font-medium disabled:opacity-50 transition-all cursor-pointer shadow-sm"
                >
                  <Plus size={12} />
                  <span>{bulkAddMut.isPending ? "ĐANG THÊM..." : `THÊM ${stockLineCount} DÒNG`}</span>
                </button>
                {bulkAddMut.isSuccess && bulkAddMut.data && (
                  <span className="text-xs font-mono text-emerald-400 flex items-center gap-1">
                    <Check size={12} /> Đã thêm {bulkAddMut.data.created} mục
                  </span>
                )}
                <button
                  onClick={() => { if (confirm(`Xóa toàn bộ ${stockUnsoldCount} mục chưa bán?`)) clearStockMut.mutate(); }}
                  disabled={clearStockMut.isPending || stockUnsoldCount === 0}
                  className="ml-auto text-xs font-mono text-rose-400 hover:text-rose-300 disabled:opacity-30 transition-colors cursor-pointer"
                >
                  {clearStockMut.isPending ? "ĐANG XÓA..." : "XÓA TẤT CẢ CHƯA BÁN"}
                </button>
              </div>
            </div>

            {/* Tabs */}
            <div className="flex items-center gap-1 px-5 py-2 border-b border-slate-800/80 flex-shrink-0">
              <button
                onClick={() => { setShowSold(false); setStockPage(1); }}
                className={`px-2.5 py-1 text-xs font-mono rounded-md transition-all cursor-pointer ${
                  !showSold
                    ? "bg-slate-800 text-emerald-400 border border-slate-700 font-semibold"
                    : "text-slate-500 hover:text-slate-300"
                }`}
              >
                CHƯA BÁN ({stockUnsoldCount})
              </button>
              <button
                onClick={() => { setShowSold(true); setStockPage(1); }}
                className={`px-2.5 py-1 text-xs font-mono rounded-md transition-all cursor-pointer ${
                  showSold
                    ? "bg-slate-800 text-slate-200 border border-slate-700 font-semibold"
                    : "text-slate-500 hover:text-slate-300"
                }`}
              >
                ĐÃ BÁN ({stockSoldCount})
              </button>
            </div>

            {/* Items list */}
            <div className="overflow-y-auto flex-1 py-2 px-4 space-y-1">
              {stockLoading ? (
                <p className="text-center py-10 text-xs font-mono text-slate-500 animate-pulse">ĐANG TẢI DỮ LIỆU KHO...</p>
              ) : stockItems.length === 0 ? (
                <p className="text-center py-10 text-xs font-mono text-slate-600">
                  {showSold ? "Chưa có mục nào đã bán" : "Kho trống — nhập stock ở trên"}
                </p>
              ) : (
                stockItems.map((item, idx) => (
                  <div
                    key={item.id}
                    className="flex items-center gap-2.5 py-1.5 px-2.5 rounded-lg hover:bg-slate-800/40 group transition-colors border border-transparent hover:border-slate-800"
                  >
                    <span className="text-[10px] text-slate-600 w-6 text-right flex-shrink-0 font-mono">
                      {(stockPage - 1) * 50 + idx + 1}
                    </span>
                    <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${item.isSold ? "bg-slate-600" : "bg-emerald-400"}`} />
                    <span className="font-mono text-xs text-slate-300 flex-1 truncate">{item.content}</span>
                    {item.isSold && item.soldAt && (
                      <span className="text-[10px] font-mono text-slate-500 flex-shrink-0">
                        {new Date(item.soldAt).toLocaleDateString("vi-VN")}
                      </span>
                    )}
                    <div className="opacity-0 group-hover:opacity-100 flex items-center gap-1 flex-shrink-0 transition-opacity">
                      <button
                        onClick={() => copyItem(item.content, item.id)}
                        title="Sao chép"
                        className="p-1 text-slate-500 hover:text-slate-200 transition-colors cursor-pointer"
                      >
                        {copied === item.id ? <Check size={11} className="text-emerald-400" /> : <Copy size={11} />}
                      </button>
                      {!item.isSold && (
                        <button
                          onClick={() => delStockMut.mutate(item.id)}
                          disabled={delStockMut.isPending}
                          title="Xóa"
                          className="p-1 text-slate-500 hover:text-rose-400 transition-colors cursor-pointer"
                        >
                          <X size={11} />
                        </button>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* Pagination */}
            {stockTotalPages > 1 && (
              <div className="px-5 py-2.5 border-t border-slate-800/80 flex items-center justify-between text-xs font-mono text-slate-500 flex-shrink-0">
                <span>{stockTotal} MỤC · TRANG {stockPage}/{stockTotalPages}</span>
                <div className="flex gap-1">
                  <button
                    disabled={stockPage === 1}
                    onClick={() => setStockPage((p) => p - 1)}
                    className="w-6 h-6 flex items-center justify-center border border-slate-800 rounded hover:bg-slate-800 text-slate-400 hover:text-white disabled:opacity-30 cursor-pointer"
                  >
                    ‹
                  </button>
                  <button
                    disabled={stockPage === stockTotalPages}
                    onClick={() => setStockPage((p) => p + 1)}
                    className="w-6 h-6 flex items-center justify-center border border-slate-800 rounded hover:bg-slate-800 text-slate-400 hover:text-white disabled:opacity-30 cursor-pointer"
                  >
                    ›
                  </button>
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
