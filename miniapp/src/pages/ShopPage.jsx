import React, { useMemo, useState } from "react";
import { Search, Zap, Crown, Plus, Sparkles, ArrowUpDown } from "lucide-react";
import { formatUsd, formatVnd, resolveProductIconUrl } from "../lib/format.js";
import { hapticImpact, hapticNotify } from "../lib/telegram.js";
import { tmaFetch } from "../lib/api.js";
import { tr } from "../lib/i18n.js";
import { useToast } from "../components/Toast.jsx";

export default function ShopPage({
  catalog,
  flashSales = [],
  balanceVnd = 0,
  vip,
  lang = "vi",
  loading,
  onSelectProduct,
  onRefreshFlash,
  onGoWallet,
  onGoKeys,
}) {
  const [search, setSearch] = useState("");
  const [selectedCat, setSelectedCat] = useState("");
  const [sortBy, setSortBy] = useState("default");
  const [claimingId, setClaimingId] = useState("");
  const { showToast } = useToast();

  const shop = catalog?.shop;
  const categories = catalog?.categories || [];
  const products = catalog?.products || [];
  const rate = shop?.usdVndRate || 26500;

  const filteredProducts = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = products.filter((p) => {
      const catOk = !selectedCat || p.categoryId === selectedCat;
      const qOk =
        !q ||
        p.name.toLowerCase().includes(q) ||
        (p.code || "").toLowerCase().includes(q) ||
        (p.categoryName || "").toLowerCase().includes(q);
      return catOk && qOk;
    });

    if (sortBy === "price_asc") list.sort((a, b) => a.priceVnd - b.priceVnd);
    else if (sortBy === "price_desc") list.sort((a, b) => b.priceVnd - a.priceVnd);
    else if (sortBy === "bestseller") list.sort((a, b) => (b.soldCount || 0) - (a.soldCount || 0));
    return list;
  }, [products, selectedCat, search, sortBy]);

  const handleClaimFlash = async (sale) => {
    hapticImpact("medium");
    setClaimingId(sale.id);
    try {
      await tmaFetch(`/flash-sales/${sale.id}/claim`, {
        method: "POST",
        body: { action: "accept" },
      });
      hapticNotify("success");
      showToast(`Đã giữ suất giảm ${sale.discountPct}% thành công!`, "success");
      onRefreshFlash?.();
    } catch (err) {
      showToast(err.message, "error");
    } finally {
      setClaimingId("");
    }
  };

  return (
    <div className="space-y-4">
      {/* Top Header */}
      <div className="flex items-center justify-between gap-2 pt-1">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center font-extrabold text-white shadow-lg shadow-indigo-600/30 shrink-0">
            {(shop?.name || "S").charAt(0).toUpperCase()}
          </div>
          <div className="min-w-0">
            <h1 className="text-base font-extrabold text-white truncate">
              {shop?.name || "Telegram Shop"}
            </h1>
            <div className="flex items-center gap-1.5 text-[11px] text-slate-400">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-400" />
              <span>Giao tự động 24/7</span>
              {vip?.level > 0 && (
                <span className="px-1.5 py-0.2 rounded bg-amber-500/20 text-amber-300 font-bold inline-flex items-center gap-0.5">
                  <Crown className="w-3 h-3" /> VIP {vip.level}
                </span>
              )}
            </div>
          </div>
        </div>

        <button
          type="button"
          onClick={onGoWallet}
          className="flex items-center gap-2 pl-3 pr-2 py-1.5 rounded-2xl bg-surface-card border border-white/10 hover:border-indigo-500/40 transition-colors shrink-0"
        >
          <div className="text-right">
            <div className="text-[10px] text-slate-400 leading-none">{tr(lang, "balance")}</div>
            <div className="text-xs font-bold text-emerald-400 mt-0.5">{formatVnd(balanceVnd)}</div>
          </div>
          <span className="w-6 h-6 rounded-xl bg-indigo-600 text-white flex items-center justify-center">
            <Plus className="w-3.5 h-3.5" />
          </span>
        </button>
      </div>

      {/* Shop Banner */}
      {shop?.bannerText && (
        <div className="px-3.5 py-2.5 rounded-2xl bg-indigo-500/10 border border-indigo-400/25 text-xs text-indigo-200 flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-indigo-400 shrink-0" />
          <span className="line-clamp-2">{shop.bannerText}</span>
        </div>
      )}

      {/* Flash Sale Carousel */}
      {flashSales.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center gap-1.5 text-xs font-bold text-amber-300">
            <Zap className="w-4 h-4 fill-amber-400 text-amber-400" />
            <span>FLASH SALE GIỚI HẠN SUẤT</span>
          </div>
          <div className="flex gap-2.5 overflow-x-auto no-scrollbar pb-1">
            {flashSales.map((sale) => (
              <div
                key={sale.id}
                className="min-w-[250px] max-w-[275px] rounded-2xl bg-gradient-to-br from-amber-500/15 via-surface-card to-surface-card border border-amber-400/30 p-3.5 flex flex-col justify-between gap-2.5 shrink-0"
              >
                <div>
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <span className="px-2 py-0.5 rounded-full bg-amber-400 text-canvas-950 text-[10px] font-extrabold">
                      GIẢM {sale.discountPct}%
                    </span>
                    {sale.slotsLeft !== null && (
                      <span className="text-[11px] text-amber-200 font-medium">
                        Còn {sale.slotsLeft}/{sale.maxSlots} suất
                      </span>
                    )}
                  </div>
                  <div className="text-sm font-bold text-white line-clamp-1">
                    {sale.productName || "Ưu đãi đặc biệt"}
                  </div>
                  {sale.guideText && (
                    <p className="text-[11px] text-slate-400 line-clamp-1 mt-0.5">{sale.guideText}</p>
                  )}
                </div>

                {sale.claimed ? (
                  <button
                    type="button"
                    onClick={() => {
                      if (sale.totalDiscount) {
                        onGoKeys?.();
                      } else {
                        const p = products.find((x) => x.id === sale.productId);
                        if (p) onSelectProduct?.(p);
                      }
                    }}
                    className="w-full py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold"
                  >
                    ✓ Đã giữ ưu đãi · Mua ngay →
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={claimingId === sale.id || sale.status !== "OPEN"}
                    onClick={() => handleClaimFlash(sale)}
                    className="w-full py-2 rounded-xl bg-amber-400 hover:bg-amber-300 text-canvas-950 text-xs font-extrabold disabled:opacity-50"
                  >
                    {claimingId === sale.id ? "Đang nhận..." : "⚡ Nhận suất giảm giá"}
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Search + Sort */}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={tr(lang, "searchPlaceholder")}
            className="w-full pl-9 pr-3 py-2.5 rounded-2xl bg-surface-card border border-white/10 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-indigo-500"
          />
        </div>
        <div className="relative">
          <ArrowUpDown className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value)}
            className="pl-7 pr-2.5 py-2.5 rounded-2xl bg-surface-card border border-white/10 text-xs text-slate-200 focus:outline-none"
          >
            <option value="default">Mặc định</option>
            <option value="bestseller">Bán chạy</option>
            <option value="price_asc">Giá tăng</option>
            <option value="price_desc">Giá giảm</option>
          </select>
        </div>
      </div>

      {/* Category Chips */}
      <div className="flex gap-2 overflow-x-auto no-scrollbar pb-0.5">
        <button
          type="button"
          onClick={() => {
            hapticImpact("light");
            setSelectedCat("");
          }}
          className={`px-3.5 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap border transition-all ${
            selectedCat === ""
              ? "bg-indigo-600 border-indigo-400 text-white shadow-md shadow-indigo-600/25"
              : "bg-surface-card border-white/10 text-slate-300"
          }`}
        >
          {tr(lang, "allCategories")} ({products.length})
        </button>
        {categories.map((cat) => (
          <button
            key={cat.id}
            type="button"
            onClick={() => {
              hapticImpact("light");
              setSelectedCat(cat.id);
            }}
            className={`px-3.5 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap border transition-all ${
              selectedCat === cat.id
                ? "bg-indigo-600 border-indigo-400 text-white shadow-md shadow-indigo-600/25"
                : "bg-surface-card border-white/10 text-slate-300"
            }`}
          >
            {cat.icon ? `${cat.icon} ` : ""}
            {cat.name}
          </button>
        ))}
      </div>

      {/* Product Grid */}
      {loading ? (
        <div className="grid grid-cols-2 gap-3">
          {Array.from({ length: 6 }).map((_, idx) => (
            <div
              key={idx}
              className="h-44 rounded-2xl bg-surface-card border border-white/5 animate-pulse"
            />
          ))}
        </div>
      ) : filteredProducts.length === 0 ? (
        <div className="rounded-2xl bg-surface-card border border-white/10 p-8 text-center space-y-2">
          <div className="text-2xl">🔍</div>
          <div className="text-sm font-semibold text-slate-300">Không tìm thấy sản phẩm phù hợp</div>
          {selectedCat || search ? (
            <button
              type="button"
              onClick={() => {
                setSelectedCat("");
                setSearch("");
              }}
              className="text-xs text-indigo-400 font-semibold"
            >
              Xóa bộ lọc
            </button>
          ) : null}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          {filteredProducts.map((p) => {
            const iconUrl = resolveProductIconUrl(p);
            const usd = p.priceUsd ?? Number((p.priceVnd / rate).toFixed(2));
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => {
                  hapticImpact("light");
                  onSelectProduct?.(p);
                }}
                className={`text-left rounded-2xl bg-surface-card border p-3 flex flex-col justify-between transition-transform active:scale-[0.98] ${
                  p.inStock
                    ? "border-white/10 hover:border-indigo-500/40"
                    : "border-white/5 opacity-65"
                }`}
              >
                <div>
                  <div className="flex items-start justify-between gap-2 mb-2.5">
                    <div className="w-10 h-10 rounded-xl bg-canvas-900 border border-white/10 flex items-center justify-center overflow-hidden shrink-0">
                      {iconUrl ? (
                        <img src={iconUrl} alt={p.name} className="w-6 h-6 object-contain" />
                      ) : (
                        <span className="text-base">{p.icon || p.categoryIcon || "📦"}</span>
                      )}
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      {p.flashPct > 0 && (
                        <span className="px-1.5 py-0.5 rounded-md bg-amber-400 text-canvas-950 text-[10px] font-extrabold">
                          −{p.flashPct}%
                        </span>
                      )}
                      <span
                        className={`px-1.5 py-0.5 rounded-md text-[10px] font-semibold ${
                          !p.inStock
                            ? "bg-rose-500/15 text-rose-300"
                            : p.deliveryMode === "STOCK_LINES"
                              ? "bg-emerald-500/15 text-emerald-300"
                              : "bg-sky-500/15 text-sky-300"
                        }`}
                      >
                        {!p.inStock
                          ? tr(lang, "outOfStock")
                          : p.deliveryMode === "STOCK_LINES"
                            ? `${tr(lang, "inStock")} ${p.stockCount}`
                            : tr(lang, "autoDelivery")}
                      </span>
                    </div>
                  </div>

                  <div className="text-xs font-bold text-white line-clamp-2 leading-snug min-h-[2.1rem]">
                    {p.name}
                  </div>
                </div>

                <div className="mt-3 pt-2 border-t border-white/5">
                  {p.deliveryMode === "CONTACT" || p.priceVnd <= 0 ? (
                    <span className="text-xs font-bold text-indigo-300">Liên hệ Admin</span>
                  ) : (
                    <div className="flex items-baseline justify-between gap-1">
                      <div>
                        <div className="text-sm font-extrabold text-emerald-400">
                          {formatUsd(usd)}
                        </div>
                        <div className="text-[10px] text-slate-400">{formatVnd(p.priceVnd)}</div>
                      </div>
                      {p.soldCount > 0 && (
                        <span className="text-[10px] text-slate-500">Đã bán {p.soldCount}</span>
                      )}
                    </div>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
