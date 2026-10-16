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

  const fileMut = useMutation({
    mutationFn: async (fileList) => {
      const files = Array.from(fileList);
      const contents = await Promise.all(files.map((f) => f.text()));
      const BATCH = 100;
      let created = 0;

      if (filePerItem) {
        const items = contents.map((c) => c.replace(/\r\n/g, "\n").trim()).filter(Boolean);
        if (!items.length) throw new Error("Tất cả file đều rỗng");
        for (let i = 0; i < items.length; i += BATCH) {
          const chunk = items.slice(i, i + BATCH);
          const r = await api.bulkAddStockFiles(selected.id, chunk);
          created += r?.created || 0;
        }
        return { created };
      }

      const allLines = contents.join("\n").split("\n").map((l) => l.trim()).filter(Boolean);
      if (!allLines.length) throw new Error("Không có dòng hợp lệ");
      for (let i = 0; i < allLines.length; i += BATCH) {
        const chunk = allLines.slice(i, i + BATCH).join("\n");
        const r = await api.bulkAddStock(selected.id, chunk);
        created += r?.created || 0;
      }
      return { created };
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
    <div className="flex flex-col h-full space-y-3 pb-8">
      {/* Header */}
      <div className="flex items-center justify-between pb-1 flex-shrink-0">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="eyebrow text-slate-400">INVENTORY // STOCK REPOSITORY</span>
            <span className="w-1 h-1 rounded-full bg-slate-600" />
            <span className="text-[10px] font-mono text-indigo-400">STOCK_LINES</span>
          </div>
          <h1 className="text-xl font-bold text-slate-100 tracking-tight flex items-center gap-2">
            Nhập kho tự động
            <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-indigo-500/10 text-indigo-300 border border-indigo-500/25">
              {stockProducts.length} SẢN PHẨM KHO
            </span>
          </h1>
          <p className="text-xs text-slate-400 mt-0.5 tracking-tight">
            Nạp dòng tài khoản, key bản quyền hoặc upload file danh sách vào từng sản phẩm
          </p>
        </div>
        <button
          onClick={() => qc.invalidateQueries(["products-stock"])}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-900/60 border border-slate-800 hover:border-slate-700 text-slate-300 text-xs font-mono transition-all cursor-pointer"
        >
          <RefreshCw size={12} className={prodLoading ? "animate-spin text-indigo-400" : ""} />
          <span>LÀM MỚI</span>
        </button>
      </div>

      <div className="flex gap-4 flex-1 min-h-0" style={{ height: "calc(100vh - 150px)" }}>
        {/* Left: product list (Bento Modular Card) */}
        <div className="w-64 flex-shrink-0 bento-card flex flex-col overflow-hidden">
          {/* Search */}
          <div className="p-3 border-b border-slate-800/80">
            <div className="flex items-center gap-2 bg-slate-900/80 border border-slate-800 rounded-lg px-2.5 py-1.5">
              <Search size={12} className="text-slate-500 flex-shrink-0" />
              <input
                type="text"
                placeholder="Tìm sản phẩm..."
                value={productSearch}
                onChange={(e) => setProductSearch(e.target.value)}
                className="flex-1 bg-transparent text-xs text-slate-200 placeholder-slate-500 outline-none font-mono"
              />
              {productSearch && (
                <button onClick={() => setProductSearch("")} className="text-slate-500 hover:text-slate-300">
                  <X size={10} />
                </button>
              )}
            </div>
          </div>

          {/* List */}
          <div className="flex-1 overflow-y-auto py-1 space-y-0.5">
            {prodLoading ? (
              <p className="text-center py-10 text-xs font-mono text-slate-500 animate-pulse">ĐANG TẢI...</p>
            ) : filteredProducts.length === 0 ? (
              <p className="text-center py-10 text-xs font-mono text-slate-600">
                {productSearch ? "Không tìm thấy" : "Chưa có sản phẩm kho"}
              </p>
            ) : (
              filteredProducts.map((p) => {
                const count = p._count?.stockItems ?? 0;
                const isActive = selected?.id === p.id;
                const stockColor = count === 0
                  ? "bg-rose-950/50 text-rose-400 border-rose-800/40"
                  : count <= 5
                  ? "bg-amber-950/50 text-amber-400 border-amber-800/40"
                  : "bg-emerald-950/50 text-emerald-400 border-emerald-800/40";
                return (
                  <button
                    key={p.id}
                    onClick={() => selectProduct(p)}
                    className={`w-full text-left px-3.5 py-2.5 flex items-center justify-between gap-2 transition-all border-l-2 cursor-pointer ${
                      isActive
                        ? "bg-indigo-500/10 border-indigo-500 text-slate-100"
                        : "hover:bg-slate-800/40 border-transparent text-slate-400"
                    }`}
                  >
                    <div className="min-w-0 flex-1">
                      <p className={`text-xs font-medium truncate ${isActive ? "text-indigo-200" : "text-slate-300"}`}>
                        {p.name}
                      </p>
                      <p className="text-[10px] font-mono text-slate-500 mt-0.5">{formatCurrency(p.price)}</p>
                    </div>
                    <span className={`flex-shrink-0 text-[10px] font-mono font-semibold px-2 py-0.5 rounded border ${stockColor}`}>
                      {count}
                    </span>
                  </button>
                );
              })
            )}
          </div>
        </div>

        {/* Right: stock panel (Bento Modular Card) */}
        <div className="flex-1 bento-card flex flex-col overflow-hidden min-w-0">
          {!selected ? (
            <div className="flex flex-col items-center justify-center h-full gap-3 text-slate-500">
              <div className="w-14 h-14 rounded-xl bg-slate-900 border border-slate-800 flex items-center justify-center">
                <Layers size={24} className="text-slate-500" />
              </div>
              <p className="text-sm font-medium text-slate-300 tracking-tight">Chọn sản phẩm bên trái để quản lý kho</p>
              <p className="text-xs font-mono text-slate-500">Hỗ trợ nhập theo dòng hoặc upload file hàng loạt</p>
            </div>
          ) : (
            <>
              {/* Header + Stats */}
              <div className="px-5 py-3.5 border-b border-slate-800/80">
                <div className="flex items-start justify-between mb-2.5">
                  <div>
                    <span className="eyebrow text-slate-400 block mb-0.5">SELECTED PRODUCT</span>
                    <h2 className="font-bold text-slate-100 text-sm tracking-tight">{selected.name}</h2>
                    <p className="text-[11px] font-mono text-indigo-400 mt-0.5">{formatCurrency(selected.price)}</p>
                  </div>
                  <button
                    onClick={() => setSelected(null)}
                    className="text-slate-500 hover:text-slate-300 p-1 rounded hover:bg-slate-800/60 transition-colors cursor-pointer"
                  >
                    <X size={15} />
                  </button>
                </div>

                {/* Stats chips */}
                <div className="flex items-center gap-2.5 font-mono text-xs">
                  <div className="flex items-center gap-1.5 bg-emerald-950/40 border border-emerald-800/30 rounded-lg px-2.5 py-1">
                    <Package size={11} className="text-emerald-400" />
                    <span className="font-bold text-emerald-400">{unsoldCount}</span>
                    <span className="text-[10px] text-emerald-600">CHƯA BÁN</span>
                  </div>
                  <div className="flex items-center gap-1.5 bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1">
                    <span className="font-bold text-slate-300">{soldCount}</span>
                    <span className="text-[10px] text-slate-500">ĐÃ BÁN</span>
                  </div>
                  {totalItems > 0 && (
                    <div className="flex-1 flex items-center gap-2 ml-2">
                      <div className="flex-1 h-1.5 bg-slate-900 border border-slate-800 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-indigo-500 rounded-full transition-all"
                          style={{ width: `${soldPct}%` }}
                        />
                      </div>
                      <span className="text-[10px] text-slate-400 flex-shrink-0">{soldPct}% ĐÃ BÁN</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Bulk add */}
              <div className="px-5 py-3.5 border-b border-slate-800/80 bg-slate-900/30 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="eyebrow text-slate-400">NHẬP STOCK MỚI VÀO KHO</span>
                  <div className="flex gap-1 bg-slate-900 border border-slate-800 p-0.5 rounded-lg">
                    <button
                      onClick={() => setEntryMode("lines")}
                      className={`px-2.5 py-0.5 text-[11px] font-mono rounded transition-all cursor-pointer ${
                        entryMode === "lines" ? "bg-slate-800 text-slate-100 border border-slate-700 shadow-sm" : "text-slate-400 hover:text-slate-200"
                      }`}
                    >
                      THEO DÒNG
                    </button>
                    <button
                      onClick={() => setEntryMode("files")}
                      className={`px-2.5 py-0.5 text-[11px] font-mono rounded transition-all flex items-center gap-1 cursor-pointer ${
                        entryMode === "files" ? "bg-slate-800 text-slate-100 border border-slate-700 shadow-sm" : "text-slate-400 hover:text-slate-200"
                      }`}
                    >
                      <Upload size={10} /> UPLOAD FILE
                    </button>
                  </div>
                </div>

                {entryMode === "lines" ? (
                  <>
                    <textarea
                      value={lines}
                      onChange={(e) => setLines(e.target.value)}
                      rows={3}
                      placeholder={"user1:pass1\nuser2:pass2\nuser3:pass3"}
                      className="w-full dev-input px-3 py-2 text-xs font-mono resize-none leading-relaxed"
                    />
                    <div className="flex items-center gap-2 pt-1 font-mono text-xs">
                      <button
                        onClick={() => bulkMut.mutate()}
                        disabled={!lines.trim() || bulkMut.isPending}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg font-medium disabled:opacity-50 transition-all cursor-pointer shadow-sm"
                      >
                        <Plus size={11} />
                        <span>{bulkMut.isPending ? "ĐANG THÊM..." : `THÊM ${lineCount || 0} DÒNG`}</span>
                      </button>
                      {bulkMut.isSuccess && bulkMut.data && (
                        <span className="text-emerald-400 flex items-center gap-1">
                          <Check size={11} /> Đã thêm {bulkMut.data.created} mục
                        </span>
                      )}
                      {bulkMut.isError && (
                        <span className="text-rose-400">✗ {bulkMut.error?.message || "Lỗi"}</span>
                      )}
                      <button
                        onClick={() => { if (confirm(`Xóa toàn bộ ${unsoldCount} mục chưa bán?`)) clearMut.mutate(); }}
                        disabled={clearMut.isPending || unsoldCount === 0}
                        className="ml-auto text-rose-400 hover:text-rose-300 disabled:opacity-30 transition-colors cursor-pointer"
                      >
                        {clearMut.isPending ? "ĐANG XÓA..." : "XÓA TẤT CẢ CHƯA BÁN"}
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <label className="flex items-center gap-2 mb-2 cursor-pointer font-mono text-xs">
                      <input
                        type="checkbox"
                        checked={filePerItem}
                        onChange={(e) => setFilePerItem(e.target.checked)}
                        className="rounded bg-slate-900 border-slate-800 text-indigo-500"
                      />
                      <span className="text-slate-400">
                        Mỗi file = 1 mục hàng
                        <span className="text-slate-500"> (bỏ chọn = tách từng dòng trong file)</span>
                      </span>
                    </label>
                    <button
                      onClick={() => fileInputRef.current?.click()}
                      disabled={fileMut.isPending}
                      className="w-full border border-dashed border-slate-700/80 rounded-lg py-5 flex flex-col items-center gap-1.5 text-slate-400 hover:border-indigo-500/50 hover:text-slate-200 transition-colors cursor-pointer disabled:opacity-50"
                    >
                      <FileText size={18} className="text-indigo-400" />
                      <span className="text-xs font-mono font-medium">
                        {fileMut.isPending ? "ĐANG TẢI LÊN..." : "CHỌN FILE (.TXT, .JSON) — CÓ THỂ CHỌN NHIỀU"}
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
                      <p className="text-xs font-mono text-emerald-400 flex items-center gap-1 mt-1">
                        <Check size={11} /> Đã thêm {fileMut.data.created} mục từ file
                      </p>
                    )}
                  </>
                )}
              </div>

              {/* Items List Filter & Table */}
              <div className="px-5 py-2 border-b border-slate-800/80 flex items-center justify-between">
                <div className="flex gap-1 font-mono text-xs">
                  <button
                    onClick={() => { setShowSold(false); setStockPage(1); setItemSearch(""); }}
                    className={`px-2.5 py-1 rounded-md transition-all cursor-pointer ${
                      !showSold
                        ? "bg-slate-800 text-emerald-400 border border-slate-700 font-semibold"
                        : "text-slate-500 hover:text-slate-300"
                    }`}
                  >
                    CHƯA BÁN ({unsoldCount})
                  </button>
                  <button
                    onClick={() => { setShowSold(true); setStockPage(1); setItemSearch(""); }}
                    className={`px-2.5 py-1 rounded-md transition-all cursor-pointer ${
                      showSold
                        ? "bg-slate-800 text-slate-200 border border-slate-700 font-semibold"
                        : "text-slate-500 hover:text-slate-300"
                    }`}
                  >
                    ĐÃ BÁN ({soldCount})
                  </button>
                </div>

                <div className="flex items-center gap-1.5 bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1 w-52">
                  <Search size={10} className="text-slate-500 flex-shrink-0" />
                  <input
                    type="text"
                    placeholder="Tìm mục..."
                    value={itemSearch}
                    onChange={(e) => setItemSearch(e.target.value)}
                    className="flex-1 bg-transparent text-xs text-slate-300 placeholder-slate-500 outline-none font-mono"
                  />
                  {itemSearch && (
                    <button onClick={() => setItemSearch("")} className="text-slate-500 hover:text-slate-300">
                      <X size={9} />
                    </button>
                  )}
                </div>
              </div>

              {/* Items */}
              <div className="flex-1 overflow-y-auto py-2 px-4 space-y-1">
                {stockLoading ? (
                  <p className="text-center py-10 text-xs font-mono text-slate-500 animate-pulse">ĐANG TẢI MỤC KHO...</p>
                ) : filteredItems.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-12 gap-2 text-slate-600">
                    <Archive size={22} className="text-slate-600" />
                    <p className="text-xs font-mono">
                      {itemSearch ? "Không tìm thấy" : showSold ? "Chưa có mục nào đã bán" : "Kho trống"}
                    </p>
                  </div>
                ) : (
                  filteredItems.map((item, idx) => (
                    <div
                      key={item.id}
                      className="flex items-center gap-2.5 py-1 px-2.5 rounded-lg hover:bg-slate-800/40 group transition-colors border border-transparent hover:border-slate-800"
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
                          className="p-1 text-slate-500 hover:text-slate-200 transition-colors cursor-pointer"
                          title="Sao chép"
                        >
                          {copied === item.id ? <Check size={11} className="text-emerald-400" /> : <Copy size={11} />}
                        </button>
                        {!item.isSold && (
                          <button
                            onClick={() => delMut.mutate(item.id)}
                            disabled={delMut.isPending}
                            className="p-1 text-slate-500 hover:text-rose-400 transition-colors cursor-pointer"
                            title="Xóa"
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
              {totalPages > 1 && (
                <div className="px-5 py-2.5 border-t border-slate-800/80 flex items-center justify-between text-xs font-mono text-slate-500">
                  <span>{stockTotal} MỤC · TRANG {stockPage}/{totalPages}</span>
                  <div className="flex gap-1">
                    <button
                      disabled={stockPage === 1}
                      onClick={() => setStockPage((p) => p - 1)}
                      className="w-6 h-6 flex items-center justify-center border border-slate-800 rounded hover:bg-slate-800 text-slate-400 hover:text-white disabled:opacity-30 cursor-pointer"
                    >
                      ‹
                    </button>
                    <button
                      disabled={stockPage === totalPages}
                      onClick={() => setStockPage((p) => p + 1)}
                      className="w-6 h-6 flex items-center justify-center border border-slate-800 rounded hover:bg-slate-800 text-slate-400 hover:text-white disabled:opacity-30 cursor-pointer"
                    >
                      ›
                    </button>
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
