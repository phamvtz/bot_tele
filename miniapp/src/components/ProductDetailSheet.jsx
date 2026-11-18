import React, { useEffect, useState } from "react";
import { X, Minus, Plus } from "lucide-react";
import { tmaFetch, makeClientRef } from "../lib/api.js";
import {
  formatVnd,
  formatUsd,
  resolveProductIconUrl,
  getProductMonogram,
} from "../lib/format.js";
import { hapticImpact, hapticNotify, openTelegramUrl } from "../lib/telegram.js";
import { useToast } from "./Toast.jsx";

export default function ProductDetailSheet({
  product,
  shop,
  balanceVnd = 0,
  onClose,
  onOrderDelivered,
  onPendingPayment,
  onGoTopup,
}) {
  const [qty, setQty] = useState(1);
  const [couponInput, setCouponInput] = useState("");
  const [appliedCode, setAppliedCode] = useState("");
  const [quote, setQuote] = useState(null);
  const [loadingQuote, setLoadingQuote] = useState(false);
  const [submittingMethod, setSubmittingMethod] = useState("");
  const [activeTab, setActiveTab] = useState("desc");
  const { showToast } = useToast();

  const maxQty =
    product?.deliveryMode === "STOCK_LINES"
      ? Math.max(1, Number(product?.stockCount || 1))
      : 99;

  useEffect(() => {
    if (!product) return;
    setQty(1);
    setCouponInput("");
    setAppliedCode("");
    setActiveTab("desc");
  }, [product?.id]);

  useEffect(() => {
    if (!product || product.deliveryMode === "CONTACT") return undefined;
    let cancelled = false;
    setLoadingQuote(true);
    const timer = setTimeout(async () => {
      try {
        const res = await tmaFetch("/orders/quote", {
          method: "POST",
          body: {
            productId: product.id,
            quantity: qty,
            couponCode: appliedCode,
          },
        });
        if (!cancelled) setQuote(res);
      } catch (err) {
        if (!cancelled) showToast(err.message, "error");
      } finally {
        if (!cancelled) setLoadingQuote(false);
      }
    }, 150);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [product?.id, qty, appliedCode]);

  if (!product) return null;

  const iconUrl = resolveProductIconUrl(product);
  const rate = shop?.usdVndRate || 26500;
  const finalVnd = quote?.finalAmountVnd ?? product.priceVnd * qty;
  const finalUsd = quote?.finalUsd ?? Number((finalVnd / rate).toFixed(2));
  const canPayWallet = (quote?.balanceVnd ?? balanceVnd) >= finalVnd;
  const isContact = product.deliveryMode === "CONTACT";
  const usdOnly = Boolean(quote?.requiresWalletTopup ?? product.requiresWalletOrCryptoPay);

  const handleApplyCoupon = () => {
    hapticImpact("light");
    setAppliedCode(couponInput.trim().toUpperCase());
  };

  const handleCheckout = async (method) => {
    hapticImpact("medium");
    setSubmittingMethod(method);
    try {
      const res = await tmaFetch("/orders/checkout", {
        method: "POST",
        body: {
          productId: product.id,
          quantity: qty,
          couponCode: appliedCode,
          paymentMethod: method,
          clientRef: makeClientRef("ord"),
        },
      });

      if (method === "wallet") {
        hapticNotify("success");
        onOrderDelivered?.({
          orderId: res.orderId,
          shortId: res.shortId,
          title: res.productName || product.name,
          deliveryContent: res.deliveryContent,
          customerDmSkipped: res.customerDmSkipped,
          newBalance: res.newBalance,
        });
      } else if (res.payment) {
        onPendingPayment?.({
          mode: "order",
          targetId: res.orderId,
          shortId: res.shortId,
          title: `${product.name} × ${qty}`,
          amountVnd: res.finalAmountVnd,
          payment: res.payment,
        });
      }
    } catch (err) {
      if (err.code !== "CHANNEL_JOIN_REQUIRED") {
        hapticNotify("error");
        showToast(err.message, "error");
      }
    } finally {
      setSubmittingMethod("");
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/80 backdrop-blur-sm animate-fade-in">
      <div className="w-full max-w-lg bg-card border-t border-white/10 rounded-t-[24px] px-5 pt-3 pb-safe-sheet max-h-[90vh] overflow-y-auto animate-sheet-up">
        <div className="w-9 h-1 rounded-full bg-zinc-700/80 mx-auto mb-4" />

        {/* Header */}
        <div className="flex items-start justify-between gap-3 mb-4">
          <div className="flex items-center gap-3.5 min-w-0">
            <div className="w-12 h-12 rounded-2xl bg-elevated border border-white/[0.08] flex items-center justify-center shrink-0 overflow-hidden">
              {iconUrl ? (
                <img src={iconUrl} alt={product.name} className="w-7 h-7 object-contain" />
              ) : (
                <span className="font-mono text-[13px] font-semibold text-zinc-300">
                  {getProductMonogram(product)}
                </span>
              )}
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-[12px] text-zinc-400 mb-0.5">
                <span>{product.categoryName}</span>
                <span className="text-zinc-600">·</span>
                <span className={product.inStock ? "text-emerald-400" : "text-rose-400"}>
                  {product.deliveryMode === "STOCK_LINES"
                    ? product.inStock
                      ? `Còn ${product.stockCount}`
                      : "Hết hàng"
                    : "Tự động"}
                </span>
                {product.flashPct > 0 && (
                  <>
                    <span className="text-zinc-600">·</span>
                    <span className="text-amber-400 font-mono">−{product.flashPct}%</span>
                  </>
                )}
              </div>
              <h3 className="text-[17px] font-semibold tracking-[-0.02em] text-zinc-100 leading-snug">
                {product.name}
              </h3>
            </div>
          </div>
          <button
            type="button"
            aria-label="Đóng"
            onClick={onClose}
            className="w-9 h-9 rounded-full bg-elevated text-zinc-400 hover:text-zinc-100 flex items-center justify-center shrink-0"
          >
            <X className="w-4 h-4" strokeWidth={1.75} />
          </button>
        </div>

        {/* Mô tả / Lưu ý */}
        {(product.description || product.note) && (
          <div className="mb-4 rounded-2xl bg-bg border border-white/[0.07] p-3.5">
            {product.description && product.note && (
              <div className="inline-flex p-0.5 rounded-lg bg-elevated mb-2.5">
                <button
                  type="button"
                  onClick={() => setActiveTab("desc")}
                  className={`px-3 py-1 rounded-md text-[12px] font-medium transition-colors ${
                    activeTab === "desc" ? "bg-zinc-100 text-zinc-950" : "text-zinc-400"
                  }`}
                >
                  Mô tả
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab("note")}
                  className={`px-3 py-1 rounded-md text-[12px] font-medium transition-colors ${
                    activeTab === "note" ? "bg-zinc-100 text-zinc-950" : "text-zinc-400"
                  }`}
                >
                  Lưu ý bảo hành
                </button>
              </div>
            )}
            <p className="text-[13px] text-zinc-300 whitespace-pre-line leading-relaxed max-h-36 overflow-y-auto">
              {activeTab === "note" && product.note ? product.note : product.description || product.note}
            </p>
          </div>
        )}

        {isContact ? (
          <button
            type="button"
            onClick={() =>
              openTelegramUrl(`https://t.me/${shop?.supportUsername || shop?.botUsername || ""}`)
            }
            className="w-full h-11 rounded-xl bg-zinc-100 hover:bg-white text-zinc-950 font-semibold text-[14px]"
          >
            Liên hệ Admin để đặt mua
          </button>
        ) : (
          <>
            {/* Bậc chiết khấu số lượng */}
            {Array.isArray(product.quantityTiers) && product.quantityTiers.length > 0 && (
              <div className="mb-3 flex items-center gap-1.5 flex-wrap">
                <span className="text-[12px] text-zinc-400">Ưu đãi số lượng:</span>
                {product.quantityTiers.map((t, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => setQty(Math.min(maxQty, Number(t.minQty) || 1))}
                    className="px-2.5 py-1 rounded-lg bg-elevated border border-white/[0.08] text-[12px] font-mono text-zinc-200 hover:border-white/20"
                  >
                    {t.minQty}+ (−{t.discountPercent}%)
                  </button>
                ))}
              </div>
            )}

            {/* Chọn số lượng */}
            <div className="flex items-center justify-between px-3.5 py-2.5 rounded-2xl bg-bg border border-white/[0.07] mb-2.5">
              <span className="text-[13px] text-zinc-300">Số lượng</span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  aria-label="Giảm số lượng"
                  disabled={qty <= 1}
                  onClick={() => setQty((q) => Math.max(1, q - 1))}
                  className="w-9 h-9 rounded-xl bg-elevated hover:bg-subtle flex items-center justify-center text-zinc-200 disabled:opacity-35"
                >
                  <Minus className="w-4 h-4" strokeWidth={1.75} />
                </button>
                <span className="w-9 text-center font-mono font-semibold text-[14px] tabular">
                  {qty}
                </span>
                <button
                  type="button"
                  aria-label="Tăng số lượng"
                  disabled={qty >= maxQty}
                  onClick={() => setQty((q) => Math.min(maxQty, q + 1))}
                  className="w-9 h-9 rounded-xl bg-elevated hover:bg-subtle flex items-center justify-center text-zinc-200 disabled:opacity-35"
                >
                  <Plus className="w-4 h-4" strokeWidth={1.75} />
                </button>
              </div>
            </div>

            {/* Mã giảm giá */}
            <div className="flex gap-2 mb-3">
              <input
                type="text"
                value={couponInput}
                onChange={(e) => setCouponInput(e.target.value.toUpperCase())}
                placeholder="Nhập mã giảm giá (nếu có)"
                className="flex-1 h-10 px-3.5 rounded-xl bg-bg border border-white/[0.07] text-[13px] font-mono text-zinc-100 placeholder:font-sans placeholder:text-zinc-500 focus:outline-none focus:border-white/25"
              />
              <button
                type="button"
                onClick={handleApplyCoupon}
                className="h-10 px-4 rounded-xl bg-elevated hover:bg-subtle border border-white/[0.08] text-[13px] font-medium text-zinc-200 shrink-0"
              >
                Áp dụng
              </button>
            </div>
            {quote?.couponError && appliedCode && (
              <p className="text-[12px] text-rose-400 mb-2.5">{quote.couponError}</p>
            )}
            {quote?.coupon && (
              <p className="text-[12px] text-emerald-400 mb-2.5">
                Đã áp dụng mã {quote.coupon.code} (−{formatVnd(quote.coupon.discountVnd)})
              </p>
            )}

            {/* Bảng tổng kết giá */}
            <div className="rounded-2xl bg-bg border border-white/[0.07] p-3.5 space-y-2 text-[13px] mb-4 tabular">
              <div className="flex justify-between text-zinc-400">
                <span>Tạm tính ({qty})</span>
                <span className="font-mono">{formatVnd(quote?.grossVnd ?? product.priceVnd * qty)}</span>
              </div>
              {quote?.quantityDiscountVnd > 0 && (
                <div className="flex justify-between text-emerald-400">
                  <span>Giảm theo số lượng (−{quote.quantityDiscountPercent}%)</span>
                  <span className="font-mono">−{formatVnd(quote.quantityDiscountVnd)}</span>
                </div>
              )}
              {quote?.vipDiscountVnd > 0 && (
                <div className="flex justify-between text-emerald-400">
                  <span>Chiết khấu VIP (−{quote.vipDiscountPercent}%)</span>
                  <span className="font-mono">−{formatVnd(quote.vipDiscountVnd)}</span>
                </div>
              )}
              {quote?.coupon?.discountVnd > 0 && (
                <div className="flex justify-between text-emerald-400">
                  <span>Mã {quote.coupon.code}</span>
                  <span className="font-mono">−{formatVnd(quote.coupon.discountVnd)}</span>
                </div>
              )}
              <div className="pt-2.5 border-t border-white/[0.07] flex items-baseline justify-between">
                <span className="font-medium text-zinc-200">Tổng thanh toán</span>
                <div className="text-right font-mono">
                  <span className="text-[18px] font-semibold text-zinc-100">
                    {loadingQuote ? "..." : formatUsd(finalUsd)}
                  </span>
                  <span className="text-[12px] text-zinc-500 ml-1.5">
                    {formatVnd(finalVnd)}
                  </span>
                </div>
              </div>
            </div>

            {/* Phương thức thanh toán */}
            {!product.inStock ? (
              <button
                type="button"
                disabled
                className="w-full h-11 rounded-xl bg-elevated text-zinc-500 font-medium text-[14px]"
              >
                Tạm hết hàng
              </button>
            ) : (
              <div className="space-y-2">
                {canPayWallet ? (
                  <button
                    type="button"
                    disabled={Boolean(submittingMethod)}
                    onClick={() => handleCheckout("wallet")}
                    className="w-full h-11 px-4 rounded-xl bg-zinc-100 hover:bg-white text-zinc-950 font-semibold text-[14px] transition-colors disabled:opacity-50 tabular"
                  >
                    {submittingMethod === "wallet"
                      ? "Đang xử lý..."
                      : `Thanh toán bằng Ví · ${formatVnd(finalVnd)}`}
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      onClose?.();
                      onGoTopup?.(Math.max(10000, finalVnd - balanceVnd));
                    }}
                    className="w-full h-11 px-4 rounded-xl bg-elevated hover:bg-subtle border border-white/[0.08] text-zinc-200 font-medium text-[13px] tabular"
                  >
                    Số dư thiếu {formatVnd(Math.max(0, finalVnd - balanceVnd))} · Nạp thêm Ví
                  </button>
                )}

                {!usdOnly && shop?.payments?.vietqr && (
                  <button
                    type="button"
                    disabled={Boolean(submittingMethod)}
                    onClick={() => handleCheckout("vietqr")}
                    className="w-full h-11 px-4 rounded-xl bg-elevated hover:bg-subtle border border-white/[0.08] text-zinc-100 font-medium text-[13.5px] transition-colors disabled:opacity-50"
                  >
                    {submittingMethod === "vietqr"
                      ? "Đang tạo mã QR..."
                      : "Chuyển khoản ngân hàng (VietQR)"}
                  </button>
                )}

                {!usdOnly &&
                  Array.isArray(shop?.payments?.cryptoNetworks) &&
                  shop.payments.cryptoNetworks.length > 0 && (
                    <div className="grid grid-cols-2 gap-2">
                      {shop.payments.cryptoNetworks.map((net) => (
                        <button
                          key={net.key}
                          type="button"
                          disabled={Boolean(submittingMethod)}
                          onClick={() => handleCheckout(net.method)}
                          className="h-10 px-3 rounded-xl bg-elevated hover:bg-subtle border border-white/[0.08] text-zinc-200 font-medium text-[13px] disabled:opacity-50"
                        >
                          USDT {net.label}
                        </button>
                      ))}
                    </div>
                  )}

                {shop?.payments?.cryptopay && (
                  <button
                    type="button"
                    disabled={Boolean(submittingMethod)}
                    onClick={() => handleCheckout("cryptopay")}
                    className="w-full h-10 px-4 rounded-xl bg-elevated hover:bg-subtle border border-white/[0.08] text-zinc-200 font-medium text-[13px] disabled:opacity-50"
                  >
                    Thanh toán qua @CryptoBot
                  </button>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
