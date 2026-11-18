import React, { useMemo, useState } from "react";
import { Search, Plus } from "lucide-react";
import {
  formatUsd,
  formatVnd,
  resolveProductIconUrl,
  getProductMonogram,
} from "../lib/format.js";
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
      showToast(`Đã giữ ưu đãi −${sale.discountPct}%`, "success");
      onRefreshFlash?.();
    } catch (err) {
      showToast(err.message, "error");
    } finally {
      setClaimingId("");
    }
  };

  return (
    <div className="space-y-5">
      {/* Minimal Header */}
      <header className="flex items-center justify-between gap-3 pt-1">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h1 className="text-[19px] font-semibold tracking-[-0.03em] text-zinc-100 truncate">
              {shop?.name || "Store"}
            </h1>
            {vip?.level > 0 && (
              <span className="px-2 py-0.5 rounded-full bg-elevated border border-white/10 text-[11px] font-mono font-medium text-zinc-300">
                VIP {vip.level}
              </span>
            )}
          </div>
          <p className="text-[12px] text-zinc-500 mt-0.5">Giao tự động 24/7</p>
        </div>

        <button
          type="button"
          onClick={onGoWallet}
          className="h-10 pl-3.5 pr-2 rounded-full bg-card border border-white/[0.08] hover:border-white/20 flex items-center gap-2.5 transition-colors shrink-0"
        >
          <span className="font-mono text-[13px] font-medium text-zinc-100 tabular">
            {formatVnd(balanceVnd)}
          </span>
          <span className="w-6 h-6 rounded-full bg-zinc-100 text-zinc-950 flex items-center justify-center">
            <Plus className="w-3.5 h-3.5" strokeWidth={2.25} aria-hidden="true" />
          </span>
        </button>
      </header>

      {/* Banner Text */}
      {shop?.bannerText && (
        <div className="px-3.5 py-2.5 rounded-xl bg-card border border-white/[0.07] text-[12.5px] text-zinc-300 leading-relaxed">
          {shop.bannerText}
        </div>
      )}

      {/* Minimal Flash Sale Strip */}
      {flashSales.length > 0 && (
        <section className="space-y-2">
          <div className="flex items-center justify-between">
            <h2 className="text-[12px] font-medium uppercase tracking-[0.06em] text-zinc-400">
              Ưu đãi giới hạn
            </h2>
          </div>
          <div className="flex gap-2.5 overflow-x-auto no-scrollbar pb-0.5">
            {flashSales.map((sale) => (
              <div
                key={sale.id}
                className="min-w-[252px] max-w-[276px] rounded-2xl bg-card border border-white/10 p-4 flex flex-col justify-between gap-3 shrink-0"
              >
                <div>
                  <div className="flex items-center justify-between gap-2 mb-1.5">
                    <span className="px-2 py-0.5 rounded-md bg-amber-400/15 text-amber-300 text-[11px] font-mono font-semibold">
                      −{sale.discountPct}%
                    </span>
                    {sale.slotsLeft !== null && (
                      <span className="text-[11px] text-zinc-400 font-mono tabular">
                        Còn {sale.slotsLeft}/{sale.maxSlots}
                      </span>
                    )}
                  </div>
                  <div className="text-[14px] font-medium text-zinc-100 line-clamp-1">
                    {sale.productName || "Ưu đãi đặc biệt"}
                  </div>
                  {sale.guideText && (
                    <p className="text-[12px] text-zinc-500 line-clamp-1 mt-0.5">{sale.guideText}</p>
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
                    className="w-full h-9 rounded-xl bg-elevated hover:bg-subtle border border-white/10 text-zinc-100 text-[12.5px] font-medium"
                  >
                    Đã giữ suất · Mua ngay
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={claimingId === sale.id || sale.status !== "OPEN"}
                    onClick={() => handleClaimFlash(sale)}
                    className="w-full h-9 rounded-xl bg-zinc-100 hover:bg-white text-zinc-950 text-[12.5px] font-semibold disabled:opacity-45"
                  >
                    {claimingId === sale.id ? "Đang xử lý..." : "Nhận ưu đãi"}
                  </button>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Search + Sort */}
      <div className="space-y-3">
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search
              aria-hidden="true"
              strokeWidth={1.75}
              className="w-4 h-4 text-zinc-500 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none"
            />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={tr(lang, "searchPlaceholder")}
              className="w-full h-11 pl-10 pr-3.5 rounded-xl bg-card border border-white/[0.08] text-[13.5px] text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:border-white/25 transition-colors"
            />
          </div>

          <select
            aria-label="Sắp xếp"
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value)}
            className="h-11 px-3 rounded-xl bg-card border border-white/[0.08] text-[13px] text-zinc-300 focus:outline-none focus:border-white/25"
          >
            <option value="default">Mặc định</option>
            <option value="bestseller">Bán chạy</option>
            <option value="price_asc">Giá thấp</option>
            <option value="price_desc">Giá cao</option>
          </select>
        </div>

        {/* Pure Typographic Category Pills (no emojis) */}
        <div className="flex gap-1.5 overflow-x-auto no-scrollbar pb-0.5">
          <button
            type="button"
            onClick={() => {
              hapticImpact("light");
              setSelectedCat("");
            }}
            className={`h-8 px-3.5 rounded-full text-[12.5px] font-medium whitespace-nowrap transition-colors ${
              selectedCat === ""
                ? "bg-zinc-100 text-zinc-950"
                : "bg-card border border-white/[0.07] text-zinc-400 hover:text-zinc-200"
            }`}
          >
            {tr(lang, "allCategories")}
          </button>
          {categories.map((cat) => (
            <button
              key={cat.id}
              type="button"
              onClick={() => {
                hapticImpact("light");
                setSelectedCat(cat.id);
              }}
              className={`h-8 px-3.5 rounded-full text-[12.5px] font-medium whitespace-nowrap transition-colors ${
                selectedCat === cat.id
                  ? "bg-zinc-100 text-zinc-950"
                  : "bg-card border border-white/[0.07] text-zinc-400 hover:text-zinc-200"
              }`}
            >
              {cat.name}
            </button>
          ))}
        </div>
      </div>

      {/* Product Grid */}
      {loading ? (
        <div className="grid grid-cols-2 gap-2.5">
          {Array.from({ length: 6 }).map((_, idx) => (
            <div
              key={idx}
              className="h-44 rounded-2xl bg-card border border-white/[0.05] animate-pulse"
            />
          ))}
        </div>
      ) : filteredProducts.length === 0 ? (
        <div className="rounded-2xl bg-card border border-white/[0.07] py-12 px-6 text-center space-y-2">
          <p className="text-[14px] font-medium text-zinc-300">Không tìm thấy sản phẩm</p>
          {(selectedCat || search) && (
            <button
              type="button"
              onClick={() => {
                setSelectedCat("");
                setSearch("");
              }}
              className="text-[12.5px] text-zinc-400 underline underline-offset-4 hover:text-zinc-200"
            >
              Đặt lại bộ lọc
            </button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2.5">
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
                className={`group text-left rounded-2xl bg-card border p-3.5 flex flex-col justify-between transition-colors active:bg-elevated ${
                  p.inStock
                    ? "border-white/[0.07] hover:border-white/20"
                    : "border-white/[0.04] opacity-55"
                }`}
              >
                <div>
                  <div className="flex items-start justify-between gap-2 mb-3">
                    <div className="w-10 h-10 rounded-xl bg-elevated border border-white/[0.07] flex items-center justify-center overflow-hidden shrink-0">
                      {iconUrl ? (
                        <img
                          src={iconUrl}
                          alt={p.name}
                          loading="lazy"
                          className="w-5 h-5 object-contain"
                        />
                      ) : (
                        <span className="font-mono text-[11px] font-semibold text-zinc-300">
                          {getProductMonogram(p)}
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-1.5">
                      {p.flashPct > 0 && (
                        <span className="px-1.5 py-0.5 rounded bg-amber-400/15 text-amber-300 text-[10.5px] font-mono font-semibold">
                          −{p.flashPct}%
                        </span>
                      )}
                      <span className="inline-flex items-center gap-1 text-[11px] text-zinc-400 font-mono">
                        <span
                          className={`w-1.5 h-1.5 rounded-full ${
                            !p.inStock ? "bg-rose-400" : "bg-emerald-400"
                          }`}
                        />
                        {!p.inStock
                          ? tr(lang, "outOfStock")
                          : p.deliveryMode === "STOCK_LINES"
                            ? p.stockCount
                            : "Auto"}
                      </span>
                    </div>
                  </div>

                  <div className="text-[13.5px] font-medium text-zinc-100 line-clamp-2 leading-[1.35] min-h-[2.45rem] tracking-[-0.01em]">
                    {p.name}
                  </div>
                </div>

                <div className="mt-3 pt-2.5 border-t border-white/[0.05]">
                  {p.deliveryMode === "CONTACT" || p.priceVnd <= 0 ? (
                    <span className="text-[12.5px] font-medium text-zinc-300">Liên hệ</span>
                  ) : (
                    <div className="flex items-baseline justify-between gap-1 tabular">
                      <span className="font-mono text-[15px] font-semibold text-zinc-100 tracking-[-0.02em]">
                        {formatUsd(usd)}
                      </span>
                      <span className="font-mono text-[11px] text-zinc-500">
                        {formatVnd(p.priceVnd)}
                      </span>
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
