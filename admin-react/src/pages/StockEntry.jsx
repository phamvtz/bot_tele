import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Archive, X, RefreshCw, Layers, Search, Copy, Check, Package, Plus, Upload, FileText } from "lucide-react";
import { api } from "../api/endpoints";
import { formatCurrency } from "../utils/format";

export default function StockEntry() {
  const [selected, setSelected] = useState(null);
  const [lines, setLines] = useState("");
  const [stockPage, setStockPage] = useState(1);
  const [showSold, setShowSold] = useState(false);
  const [productSearch, setProductSearch] = useState("");
  const [itemSearch, setItemSearch] = useState("");
  const [copied, setCopied] = useState(null);
  const [entryMode, setEntryMode] = useState("lines"); // "lines" | "files"
  const [filePerItem, setFilePerItem] = useState(true); // true = mỗi file 1 item, false = gộp dòng
  const fileInputRef = useRef(null);
  const qc = useQueryClient();

  const { data: prodData, isLoading: prodLoading } = useQuery({
    queryKey: ["products-stock"],
    queryFn: () => api.products({ limit: 200, status: "all" }),
  });

  const { data: stockData, isLoading: stockLoading } = useQuery({
    queryKey: ["stock-items", selected?.id, stockPage, showSold],
    queryFn: () => api.stockItems({ productId: selected.id, page: stockPage, limit: 50, sold: showSold ? "true" : "false" }),
    enabled: !!selected,
  });

  const bulkMut = useMutation({
    mutationFn: () => api.bulkAddStock(selected.id, lines),
    onSuccess: () => {
      setLines("");
      qc.invalidateQueries(["stock-items", selected.id]);
      qc.invalidateQueries(["products-stock"]);
    },
  });

  // Upload nhiều file: mỗi file = 1 item (filePerItem) hoặc gộp tất cả dòng (lines)
  const fileMut = useMutation({
    mutationFn: async (fileList) => {
      const files = Array.from(fileList);
      const contents = await Promise.all(files.map((f) => f.text()));
      if (filePerItem) {
        // Mỗi file = 1 stock item nguyên content
        const items = contents.map((c) => c.replace(/\r\n/g, "\n").trim()).filter(Boolean);
        if (!items.length) throw new Error("Tất cả file đều rỗng");
        return api.bulkAddStockFiles(selected.id, items);
      }
      // Gộp tất cả dòng từ mọi file
      const merged = contents.join("\n");
      return api.bulkAddStock(selected.id, merged);
    },
    onSuccess: () => {
      qc.invalidateQueries(["stock-items", selected.id]);
      qc.invalidateQueries(["products-stock"]);
      if (fileInputRef.current) fileInputRef.current.value = "";
    },
  });

  const delMut = useMutation({
    mutationFn: (id) => api.deleteStockItem(id),
    onSuccess: () => {
      qc.invalidateQueries(["stock-items", selected.id]);
      qc.invalidateQueries(["products-stock"]);
    },
  });

  const clearMut = useMutation({
    mutationFn: () => api.clearUnsoldStock(selected.id),
    onSuccess: () => {
      qc.invalidateQueries(["stock-items", selected.id]);
      qc.invalidateQueries(["products-stock"]);
    },
  });

  const allProducts = prodData?.products || [];
  const stockProducts = allProducts.filter((p) => p.deliveryMode === "STOCK_LINES");
  const filteredProducts = productSearch
    ? stockProducts.filter((p) => p.name.toLowerCase().includes(productSearch.toLowerCase()))
    : stockProducts;

  const stockItems = stockData?.items || [];
  const stockTotal = stockData?.total || 0;
  const soldCount = stockData?.soldCount || 0;
  const unsoldCount = !showSold && stockData ? stockTotal : (selected?._count?.stockItems ?? 0);
  const totalPages = Math.ceil(stockTotal / 50) || 1;
  const totalItems = unsoldCount + soldCount;
  const soldPct = totalItems > 0 ? Math.round((soldCount / totalItems) * 100) : 0;

  const filteredItems = itemSearch
    ? stockItems.filter((i) => i.content.toLowerCase().includes(itemSearch.toLowerCase()))
    : stockItems;

  const lineCount = lines.trim().split("\n").filter(Boolean).length;

  useEffect(() => {
    if (selected && prodData) {
      const fresh = prodData.products.find((p) => p.id === selected.id);
      if (fresh) setSelected(fresh);
    }
  }, [prodData]);

  function selectProduct(p) {
    setSelected(p);
    setLines("");
    setStockPage(1);
    setShowSold(false);
    setItemSearch("");
  }

  function copyItem(content, id) {
    navigator.clipboard?.writeText(content);
    setCopied(id);
    setTimeout(() => setCopied(null), 1500);
  }

  return (
    <div className="flex flex-col h-full">
      {/* Page header */}
      <div className="flex items-center justify-between mb-1">
        <div>
          <h1 className="text-xl font-bold text-white">Nhập kho</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {prodLoading ? "Đang tải..." : `${stockProducts.length} sản phẩm STOCK_LINES`}
          </p>
        </div>
        <button
          onClick={() => qc.invalidateQueries(["products-stock"])}
          className="flex items-center gap-1.5 px-3 py-1.5 text-gray-400 glass rounded-lg text-sm hover:text-white transition-colors"
        >
          <RefreshCw size={13} />
          Làm mới
        </button>
      </div>

      <div className="flex gap-4 flex-1 min-h-0 mt-4" style={{ height: "calc(100vh - 148px)" }}>

        {/* ── Left: product list ─────────────────────────────── */}
        <div className="w-60 flex-shrink-0 glass rounded-xl flex flex-col overflow-hidden">
          {/* search */}
          <div className="px-3 pt-3 pb-2 border-b border-white/[0.06]">
            <div className="flex items-center gap-2 bg-white/[0.05] rounded-lg px-2.5 py-1.5">
              <Search size={12} className="text-gray-500 flex-shrink-0" />
              <input
                type="text"
                placeholder="Tìm sản phẩm..."
                value={productSearch}
                onChange={(e) => setProductSearch(e.target.value)}
                className="flex-1 bg-transparent text-xs text-gray-300 placeholder-gray-600 outline-none"
              />
              {productSearch && (
                <button onClick={() => setProductSearch("")} className="text-gray-600 hover:text-gray-400">
                  <X size={10} />
                </button>
              )}
            </div>
          </div>

          {/* list */}
          <div className="flex-1 overflow-y-auto py-1">
            {prodLoading ? (
              <p className="text-center py-10 text-xs text-gray-500">Đang tải...</p>
            ) : filteredProducts.length === 0 ? (
              <p className="text-center py-10 text-xs text-gray-500">
                {productSearch ? "Không tìm thấy" : "Chưa có sản phẩm STOCK_LINES"}
              </p>
            ) : (
              filteredProducts.map((p) => {
                const count = p._count?.stockItems ?? 0;
                const isActive = selected?.id === p.id;
                const stockColor = count === 0
                  ? "bg-red-950/60 text-red-400"
                  : count <= 5
                  ? "bg-yellow-950/60 text-yellow-400"
                  : "bg-emerald-950/60 text-emerald-400";
                return (
                  <button
                    key={p.id}
                    onClick={() => selectProduct(p)}
                    className={`w-full text-left px-3 py-2.5 flex items-center justify-between gap-2 transition-colors border-l-2 ${
                      isActive
                        ? "bg-primary-950/40 border-primary-500"
                        : "hover:bg-white/[0.04] border-transparent"
                    }`}
                  >
                    <div className="min-w-0 flex-1">
                      <p className={`text-xs font-medium truncate leading-snug ${isActive ? "text-primary-300" : "text-gray-300"}`}>
                        {p.name}
                      </p>
                      <p className="text-[10px] text-gray-600 mt-0.5">{formatCurrency(p.price)}</p>
                    </div>
                    <span className={`flex-shrink-0 text-[10px] font-bold px-1.5 py-0.5 rounded-full ${stockColor}`}>
                      {count}
                    </span>
                  </button>
                );
              })
            )}
          </div>
        </div>

        {/* ── Right: stock panel ─────────────────────────────── */}
        <div className="flex-1 glass rounded-xl flex flex-col overflow-hidden min-w-0">
          {!selected ? (
            <div className="flex flex-col items-center justify-center h-full gap-3 text-gray-600">
              <div className="w-16 h-16 rounded-2xl glass flex items-center justify-center">
                <Layers size={28} strokeWidth={1.2} className="text-gray-600" />
              </div>
              <p className="text-sm font-medium text-gray-500">Chọn sản phẩm để quản lý kho</p>
              <p className="text-xs text-gray-600">← Danh sách bên trái</p>
            </div>
          ) : (
            <>
              {/* Header + stats */}
              <div className="px-5 py-4 border-b border-white/[0.06]">
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <h2 className="font-semibold text-white text-base leading-tight">{selected.name}</h2>
                    <p className="text-xs text-gray-500 mt-0.5">{formatCurrency(selected.price)}</p>
                  </div>
                  <button onClick={() => setSelected(null)} className="text-gray-600 hover:text-gray-400 transition-colors mt-0.5">
                    <X size={15} />
                  </button>
                </div>

                {/* Stats chips */}
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-1.5 bg-emerald-950/40 border border-emerald-800/30 rounded-lg px-2.5 py-1.5">
                    <Package size={11} className="text-emerald-500" />
                    <span className="text-xs font-semibold text-emerald-400">{unsoldCount}</span>
                    <span className="text-[10px] text-emerald-700">còn</span>
                  </div>
                  <div className="flex items-center gap-1.5 bg-white/[0.03] border border-white/[0.07] rounded-lg px-2.5 py-1.5">
                    <span className="text-xs font-semibold text-gray-400">{soldCount}</span>
                    <span className="text-[10px] text-gray-600">đã bán</span>
                  </div>
                  {totalItems > 0 && (
                    <div className="flex-1 flex items-center gap-2">
                      <div className="flex-1 h-1 bg-white/[0.06] rounded-full overflow-hidden">
                        <div
                          className="h-full bg-gradient-to-r from-primary-600 to-primary-400 rounded-full transition-all"
                          style={{ width: `${soldPct}%` }}
                        />
                      </div>
                      <span className="text-[10px] text-gray-500 flex-shrink-0">{soldPct}% bán</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Bulk add */}
              <div className="px-5 py-3.5 border-b border-white/[0.06] bg-white/[0.015]">
                <div className="flex items-center justify-between mb-2">
                  <label className="text-xs font-semibold text-gray-400 flex items-center gap-1.5">
                    <Plus size={11} className="text-primary-500" />
                    Nhập stock mới
                  </label>
                  {/* Mode toggle */}
                  <div className="flex gap-0.5 bg-white/[0.04] rounded-lg p-0.5">
                    <button
                      onClick={() => setEntryMode("lines")}
                      className={`px-2 py-0.5 text-[11px] rounded-md font-medium transition-colors ${entryMode === "lines" ? "bg-primary-600/30 text-primary-300" : "text-gray-500 hover:text-gray-300"}`}
                    >
                      Theo dòng
                    </button>
                    <button
                      onClick={() => setEntryMode("files")}
                      className={`px-2 py-0.5 text-[11px] rounded-md font-medium transition-colors flex items-center gap-1 ${entryMode === "files" ? "bg-primary-600/30 text-primary-300" : "text-gray-500 hover:text-gray-300"}`}
                    >
                      <Upload size={10} /> Upload file
                    </button>
                  </div>
                </div>

                {entryMode === "lines" ? (
                  <>
                    {lineCount > 0 && (
                      <div className="flex justify-end mb-1.5">
                        <span className="text-[10px] font-semibold bg-primary-900/60 text-primary-400 px-1.5 py-0.5 rounded-full">
                          {lineCount} dòng
                        </span>
                      </div>
                    )}
                    <textarea
                      value={lines}
                      onChange={(e) => setLines(e.target.value)}
                      rows={4}
                      placeholder={"user1:pass1\nuser2:pass2\nuser3:pass3"}
                      className="w-full glass-input rounded-lg px-3 py-2 text-xs font-mono resize-none leading-relaxed"
                    />
                    <div className="flex items-center gap-2 mt-2">
                      <button
                        onClick={() => bulkMut.mutate()}
                        disabled={!lines.trim() || bulkMut.isPending}
                        className="flex items-center gap-1.5 px-3.5 py-1.5 bg-primary-500 text-white rounded-lg text-xs font-semibold hover:bg-primary-600 disabled:opacity-50 transition-colors shadow-glow-sm hover:shadow-glow"
                      >
                        <Plus size={11} />
                        {bulkMut.isPending ? "Đang thêm..." : `Thêm ${lineCount || 0} dòng`}
                      </button>
                      {bulkMut.isSuccess && bulkMut.data && (
                        <span className="text-xs text-emerald-400 font-medium flex items-center gap-1">
                          <Check size={11} /> Đã thêm {bulkMut.data.created} mục
                        </span>
                      )}
                      {bulkMut.isError && (
                        <span className="text-xs text-red-400 font-medium">
                          ✗ {bulkMut.error?.message || "Lỗi"}
                        </span>
                      )}
                      <button
                        onClick={() => { if (confirm(`Xóa toàn bộ ${unsoldCount} mục chưa bán?`)) clearMut.mutate(); }}
                        disabled={clearMut.isPending || unsoldCount === 0}
                        className="ml-auto text-[11px] text-red-500 hover:text-red-400 disabled:opacity-30 transition-colors"
                      >
                        {clearMut.isPending ? "Đang xóa..." : "Xóa tất cả chưa bán"}
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <label className="flex items-center gap-2 mb-2 cursor-pointer">
                      <input type="checkbox" checked={filePerItem} onChange={(e) => setFilePerItem(e.target.checked)} className="rounded text-primary-500" />
                      <span className="text-[11px] text-gray-400">
                        Mỗi file = 1 sản phẩm
                        <span className="text-gray-600"> (bỏ chọn = gộp tất cả dòng trong các file)</span>
                      </span>
                    </label>
                    <button
                      onClick={() => fileInputRef.current?.click()}
                      disabled={fileMut.isPending}
                      className="w-full border-2 border-dashed border-white/[0.1] rounded-lg py-5 flex flex-col items-center gap-1.5 text-gray-500 hover:border-primary-500/40 hover:text-primary-400 transition-colors disabled:opacity-50"
                    >
                      <FileText size={20} strokeWidth={1.4} />
                      <span className="text-xs font-medium">
                        {fileMut.isPending ? "Đang tải lên..." : "Chọn file (.txt, .json) — có thể chọn nhiều"}
                      </span>
                      <span className="text-[10px] text-gray-600">
                        {filePerItem ? "Mỗi file thành 1 dòng kho" : "Gộp mọi dòng từ tất cả file"}
                      </span>
                    </button>
                    <input
                      ref={fileInputRef}
                      type="file"
                      multiple
                      accept=".txt,.json,text/plain,application/json"
                      onChange={(e) => { if (e.target.files?.length) fileMut.mutate(e.target.files); }}
                      className="hidden"
                    />
                    {fileMut.isSuccess && fileMut.data && (
                      <p className="text-xs text-emerald-400 font-medium flex items-center gap-1 mt-2">
                        <Check size={11} /> Đã thêm {fileMut.data.created} mục từ file
                      </p>
                    )}
                    {fileMut.isError && (
                      <p className="text-xs text-red-400 font-medium mt-2">✗ {fileMut.error?.message || "Lỗi tải file"}</p>
                    )}
                  </>
                )}
              </div>

              {/* Tabs + search */}
              <div className="px-5 py-2 border-b border-white/[0.06] flex items-center gap-3">
                <div className="flex gap-0.5">
                  <button
                    onClick={() => { setShowSold(false); setStockPage(1); setItemSearch(""); }}
                    className={`px-2.5 py-1 text-xs rounded-md font-medium transition-colors ${
                      !showSold ? "bg-emerald-600/20 text-emerald-400 border border-emerald-700/30" : "text-gray-500 hover:text-gray-300"
                    }`}
                  >
                    Chưa bán · <span className="font-bold">{unsoldCount}</span>
                  </button>
                  <button
                    onClick={() => { setShowSold(true); setStockPage(1); setItemSearch(""); }}
                    className={`px-2.5 py-1 text-xs rounded-md font-medium transition-colors ${
                      showSold ? "bg-white/[0.07] text-gray-300 border border-white/[0.1]" : "text-gray-500 hover:text-gray-300"
                    }`}
                  >
                    Đã bán · <span className="font-bold">{soldCount}</span>
                  </button>
                </div>
                {stockTotal > 5 && (
                  <div className="flex items-center gap-1.5 bg-white/[0.04] rounded-lg px-2 py-1 flex-1 max-w-[200px]">
                    <Search size={10} className="text-gray-600 flex-shrink-0" />
                    <input
                      type="text"
                      placeholder="Tìm trong danh sách..."
                      value={itemSearch}
                      onChange={(e) => setItemSearch(e.target.value)}
                      className="flex-1 bg-transparent text-[11px] text-gray-400 placeholder-gray-600 outline-none"
                    />
                    {itemSearch && (
                      <button onClick={() => setItemSearch("")} className="text-gray-600 hover:text-gray-400">
                        <X size={9} />
                      </button>
                    )}
                  </div>
                )}
              </div>

              {/* Items */}
              <div className="flex-1 overflow-y-auto py-2">
                {stockLoading ? (
                  <p className="text-center py-10 text-xs text-gray-500">Đang tải...</p>
                ) : filteredItems.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-12 gap-2">
                    <Archive size={24} strokeWidth={1.2} className="text-gray-700" />
                    <p className="text-xs text-gray-600">
                      {itemSearch ? "Không tìm thấy kết quả" : showSold ? "Chưa có mục nào đã bán" : "Kho trống — nhập stock ở trên"}
                    </p>
                  </div>
                ) : (
                  <div className="px-3">
                    {filteredItems.map((item, idx) => (
                      <div
                        key={item.id}
                        className="flex items-center gap-2.5 py-1.5 px-2 rounded-lg hover:bg-white/[0.04] group transition-colors"
                      >
                        <span className="text-[10px] text-gray-700 w-6 text-right flex-shrink-0 font-mono">
                          {(stockPage - 1) * 50 + idx + 1}
                        </span>
                        <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${item.isSold ? "bg-gray-600" : "bg-emerald-500"}`} />
                        <span className="font-mono text-xs text-gray-300 flex-1 truncate">{item.content}</span>
                        {item.isSold && item.soldAt && (
                          <span className="text-[10px] text-gray-600 flex-shrink-0">
                            {new Date(item.soldAt).toLocaleDateString("vi-VN")}
                          </span>
                        )}
                        <div className="opacity-0 group-hover:opacity-100 flex items-center gap-1 transition-opacity flex-shrink-0">
                          <button
                            onClick={() => copyItem(item.content, item.id)}
                            className="text-gray-600 hover:text-gray-300 transition-colors"
                            title="Sao chép"
                          >
                            {copied === item.id ? <Check size={11} className="text-emerald-400" /> : <Copy size={11} />}
                          </button>
                          {!item.isSold && (
                            <button
                              onClick={() => delMut.mutate(item.id)}
                              disabled={delMut.isPending}
                              className="text-gray-600 hover:text-red-400 transition-colors"
                              title="Xóa"
                            >
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
              {totalPages > 1 && (
                <div className="px-5 py-2.5 border-t border-white/[0.06] flex items-center justify-between text-[11px] text-gray-600">
                  <span>{stockTotal} mục · trang {stockPage}/{totalPages}</span>
                  <div className="flex gap-1">
                    <button
                      disabled={stockPage === 1}
                      onClick={() => setStockPage((p) => p - 1)}
                      className="w-6 h-6 flex items-center justify-center border border-white/[0.07] rounded hover:bg-white/[0.05] disabled:opacity-30 transition-colors"
                    >‹</button>
                    <button
                      disabled={stockPage === totalPages}
                      onClick={() => setStockPage((p) => p + 1)}
                      className="w-6 h-6 flex items-center justify-center border border-white/[0.07] rounded hover:bg-white/[0.05] disabled:opacity-30 transition-colors"
                    >›</button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
