import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Archive, X, RefreshCw, Layers } from "lucide-react";
import { api } from "../api/endpoints";
import { formatCurrency } from "../utils/format";

export default function StockEntry() {
  const [selected, setSelected] = useState(null);
  const [lines, setLines] = useState("");
  const [stockPage, setStockPage] = useState(1);
  const [showSold, setShowSold] = useState(false);
  const qc = useQueryClient();

  const { data: prodData, isLoading: prodLoading } = useQuery({
    queryKey: ["products-stock"],
    queryFn: () => api.products({ limit: 200, status: "all" }),
  });

  const { data: stockData, isLoading: stockLoading } = useQuery({
    queryKey: ["stock-items", selected?.id, stockPage, showSold],
    queryFn: () => api.stockItems({
      productId: selected.id,
      page: stockPage,
      limit: 50,
      sold: showSold ? "true" : "false",
    }),
    enabled: !!selected,
  });

  const bulkMut = useMutation({
    mutationFn: () => api.bulkAddStock(selected.id, lines),
    onSuccess: (data) => {
      setLines("");
      qc.invalidateQueries(["stock-items", selected.id]);
      qc.invalidateQueries(["products-stock"]);
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
  const stockItems = stockData?.items || [];
  const stockTotal = stockData?.total || 0;
  const soldCount = stockData?.soldCount || 0;
  const unsoldCount = !showSold && stockData ? stockTotal : (selected?._count?.stockItems ?? 0);
  const totalPages = Math.ceil(stockTotal / 50) || 1;

  // Keep selected in sync when product list refreshes after mutations
  useEffect(() => {
    if (selected && prodData) {
      const fresh = prodData.products.find((p) => p.id === selected.id);
      if (fresh) setSelected(fresh);
    }
  }, [prodData]);

  const lineCount = lines.trim().split("\n").filter(Boolean).length;

  function selectProduct(p) {
    setSelected(p);
    setLines("");
    setStockPage(1);
    setShowSold(false);
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-xl font-bold text-white">Nhập kho</h1>
        <button
          onClick={() => qc.invalidateQueries(["products-stock"])}
          className="flex items-center gap-1.5 px-3 py-1.5 text-gray-400 border border-white/[0.07] rounded-lg text-sm hover:bg-white/[0.05] transition-colors"
        >
          <RefreshCw size={13} />
          Làm mới
        </button>
      </div>
      <p className="text-sm text-gray-500 mb-5">
        {stockProducts.length} sản phẩm dạng STOCK_LINES
      </p>

      <div className="flex gap-4 h-[calc(100vh-160px)] min-h-[500px]">
        {/* Left — product list */}
        <div className="w-64 flex-shrink-0 glass rounded-xl flex flex-col overflow-hidden">
          <div className="px-4 py-3 border-b border-white/[0.06]">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Sản phẩm</p>
          </div>
          <div className="flex-1 overflow-y-auto py-1.5">
            {prodLoading ? (
              <p className="text-center py-8 text-xs text-gray-400">Đang tải...</p>
            ) : stockProducts.length === 0 ? (
              <p className="text-center py-8 text-xs text-gray-400">Chưa có sản phẩm STOCK_LINES</p>
            ) : (
              stockProducts.map((p) => {
                const count = p._count?.stockItems ?? 0;
                const isActive = selected?.id === p.id;
                return (
                  <button
                    key={p.id}
                    onClick={() => selectProduct(p)}
                    className={`w-full text-left px-4 py-2.5 flex items-center justify-between gap-2 transition-colors ${
                      isActive
                        ? "bg-white/[0.08] border-l-2 border-primary-500"
                        : "hover:bg-white/[0.04] border-l-2 border-transparent"
                    }`}
                  >
                    <div className="min-w-0">
                      <p className={`text-sm font-medium truncate ${isActive ? "text-primary-400" : "text-gray-300"}`}>
                        {p.name}
                      </p>
                      <p className="text-[10px] text-gray-500 mt-0.5">{formatCurrency(p.price)}</p>
                    </div>
                    <span
                      className={`flex-shrink-0 text-xs font-semibold px-2 py-0.5 rounded-full ${
                        count === 0
                          ? "bg-red-950/60 text-red-400"
                          : "bg-emerald-950/60 text-emerald-400"
                      }`}
                    >
                      {count}
                    </span>
                  </button>
                );
              })
            )}
          </div>
        </div>

        {/* Right — stock panel */}
        <div className="flex-1 glass rounded-xl flex flex-col overflow-hidden">
          {!selected ? (
            <div className="flex flex-col items-center justify-center h-full text-gray-500">
              <div className="w-14 h-14 rounded-2xl glass flex items-center justify-center mb-3">
                <Layers size={26} strokeWidth={1.5} className="text-gray-500" />
              </div>
              <p className="text-sm text-gray-500 font-medium">Chọn sản phẩm để quản lý kho</p>
            </div>
          ) : (
            <>
              {/* Header */}
              <div className="px-5 py-4 border-b border-white/[0.06] flex items-start justify-between">
                <div>
                  <h2 className="font-semibold text-white">{selected.name}</h2>
                  <p className="text-xs text-gray-500 mt-0.5">
                    <span className="text-emerald-400 font-semibold">{unsoldCount}</span> chưa bán ·{" "}
                    <span className="text-gray-400">{soldCount} đã bán</span>
                  </p>
                </div>
                <button onClick={() => setSelected(null)} className="text-gray-300 hover:text-gray-500 transition-colors">
                  <X size={16} />
                </button>
              </div>

              {/* Bulk add */}
              <div className="px-5 py-4 border-b border-white/[0.06] bg-white/[0.02]">
                <label className="text-xs font-semibold text-gray-400 block mb-1.5">
                  Thêm stock — mỗi dòng là một tài khoản / mã
                </label>
                <textarea
                  value={lines}
                  onChange={(e) => setLines(e.target.value)}
                  rows={5}
                  placeholder={"user1:pass1\nuser2:pass2\nuser3:pass3"}
                  className="w-full glass-input rounded-lg px-3 py-2 text-xs font-mono resize-none"
                />
                <div className="flex items-center gap-2 mt-2">
                  <button
                    onClick={() => bulkMut.mutate()}
                    disabled={!lines.trim() || bulkMut.isPending}
                    className="px-4 py-1.5 bg-primary-500 text-white rounded-lg text-xs font-semibold hover:bg-primary-600 disabled:opacity-50 transition-colors shadow-glow-sm hover:shadow-glow"
                  >
                    {bulkMut.isPending ? "Đang thêm..." : `Thêm ${lineCount || 0} dòng`}
                  </button>
                  {bulkMut.isSuccess && bulkMut.data && (
                    <span className="text-xs text-emerald-400 font-medium">
                      ✓ Đã thêm {bulkMut.data.created} mục
                    </span>
                  )}
                  {bulkMut.isError && (
                    <span className="text-xs text-red-400 font-medium">
                      ✗ {bulkMut.error?.message || "Lỗi khi thêm"}
                    </span>
                  )}
                  <button
                    onClick={() => { if (confirm("Xóa toàn bộ stock chưa bán?")) clearMut.mutate(); }}
                    disabled={clearMut.isPending}
                    className="ml-auto px-3 py-1.5 text-red-400 border border-red-800/50 rounded-lg text-xs hover:bg-red-950/40 transition-colors"
                  >
                    Xóa tất cả chưa bán
                  </button>
                </div>
              </div>

              {/* Tabs */}
              <div className="flex items-center gap-0.5 px-5 py-2 border-b border-white/[0.06]">
                <button
                  onClick={() => { setShowSold(false); setStockPage(1); }}
                  className={`px-3 py-1.5 text-xs rounded-lg font-medium transition-colors ${
                    !showSold ? "bg-primary-600 text-white shadow-glow-sm" : "text-gray-500 hover:bg-white/[0.05]"
                  }`}
                >
                  Chưa bán ({unsoldCount})
                </button>
                <button
                  onClick={() => { setShowSold(true); setStockPage(1); }}
                  className={`px-3 py-1.5 text-xs rounded-lg font-medium transition-colors ${
                    showSold ? "bg-primary-600 text-white shadow-glow-sm" : "text-gray-500 hover:bg-white/[0.05]"
                  }`}
                >
                  Đã bán ({soldCount})
                </button>
              </div>

              {/* Items list */}
              <div className="flex-1 overflow-y-auto px-5 py-3">
                {stockLoading ? (
                  <p className="text-center py-8 text-sm text-gray-400">Đang tải...</p>
                ) : stockItems.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-10">
                    <Archive size={28} strokeWidth={1.5} className="text-gray-600 mb-2" />
                    <p className="text-sm text-gray-500">
                      {showSold ? "Chưa có mục nào đã bán" : "Kho trống — thêm stock ở trên"}
                    </p>
                  </div>
                ) : (
                  <div className="space-y-0.5">
                    {stockItems.map((item) => (
                      <div
                        key={item.id}
                        className="flex items-center gap-3 py-1.5 px-2 rounded-lg hover:bg-white/[0.04] group"
                      >
                        <span
                          className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                            item.isSold ? "bg-gray-300" : "bg-emerald-400"
                          }`}
                        />
                        <span className="font-mono text-xs text-gray-300 flex-1 truncate">{item.content}</span>
                        {item.isSold && item.soldAt && (
                          <span className="text-[10px] text-gray-500 flex-shrink-0">
                            {new Date(item.soldAt).toLocaleDateString("vi-VN")}
                          </span>
                        )}
                        {!item.isSold && (
                          <button
                            onClick={() => delMut.mutate(item.id)}
                            disabled={delMut.isPending}
                            className="opacity-0 group-hover:opacity-100 text-gray-300 hover:text-red-500 transition-all"
                          >
                            <X size={12} />
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Pagination */}
              {totalPages > 1 && (
                <div className="px-5 py-2.5 border-t border-white/[0.06] flex items-center justify-between text-xs text-gray-500">
                  <span>{stockTotal} mục · trang {stockPage}/{totalPages}</span>
                  <div className="flex gap-1">
                    <button
                      disabled={stockPage === 1}
                      onClick={() => setStockPage((p) => p - 1)}
                      className="w-7 h-7 flex items-center justify-center border border-white/[0.07] rounded-lg hover:bg-white/[0.05] disabled:opacity-40"
                    >‹</button>
                    <button
                      disabled={stockPage === totalPages}
                      onClick={() => setStockPage((p) => p + 1)}
                      className="w-7 h-7 flex items-center justify-center border border-white/[0.07] rounded-lg hover:bg-white/[0.05] disabled:opacity-40"
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
