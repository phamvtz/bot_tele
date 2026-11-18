import React, { useEffect, useState } from "react";
import {
  X,
  Minus,
  Plus,
  TicketPercent,
  Wallet,
  QrCode,
  Coins,
  Zap,
  MessageCircle,
  Loader2,
} from "lucide-react";
import { tmaFetch, makeClientRef } from "../lib/api.js";
import { formatVnd, formatUsd, resolveProductIconUrl } from "../lib/format.js";
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
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/75 backdrop-blur-sm animate-fade-in">
      <div className="w-full max-w-lg bg-surface-card border-t border-white/15 rounded-t-3xl p-5 pb-safe-sheet max-h-[90vh] overflow-y-auto animate-sheet-up">
        {/* Header */}
        <div className="flex items-start justify-between gap-3 mb-4">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-14 h-14 rounded-2xl bg-canvas-900 border border-white/10 flex items-center justify-center shrink-0 overflow-hidden">
              {iconUrl ? (
                <img src={iconUrl} alt={product.name} className="w-9 h-9 object-contain" />
              ) : (
                <span className="text-xl">{product.icon || product.categoryIcon || "📦"}</span>
              )}
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 flex-wrap mb-1">
                <span className="px-2 py-0.5 rounded-md bg-white/5 text-[10px] font-semibold text-slate-300">
                  {product.categoryName}
                </span>
                {product.flashPct > 0 && (
                  <span className="px-2 py-0.5 rounded-md bg-amber-500/20 text-amber-300 text-[10px] font-bold flex items-center gap-0.5">
                    <Zap className="w-3 h-3" /> −{product.flashPct}% Flash
                  </span>
                )}
                <span
                  className={`px-2 py-0.5 rounded-md text-[10px] font-semibold ${
                    product.inStock
                      ? "bg-emerald-500/15 text-emerald-300"
                      : "bg-rose-500/15 text-rose-300"
                  }`}
                >
                  {product.deliveryMode === "STOCK_LINES"
                    ? product.inStock
                      ? `Còn ${product.stockCount}`
                      : "Hết hàng"
                    : "Giao tự động"}
                </span>
              </div>
              <h3 className="text-base font-bold text-white leading-snug">{product.name}</h3>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-xl bg-white/5 text-slate-400 hover:text-white shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Mô tả / Lưu ý */}
        {(product.description || product.note) && (
          <div className="mb-4 rounded-2xl bg-canvas-900/90 border border-white/10 p-3">
            {product.description && product.note && (
              <div className="flex gap-1.5 mb-2">
                <button
                  type="button"
                  onClick={() => setActiveTab("desc")}
                  className={`px-3 py-1 rounded-lg text-xs font-semibold ${
                    activeTab === "desc" ? "bg-indigo-600 text-white" : "bg-white/5 text-slate-400"
                  }`}
                >
                  Mô tả
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab("note")}
                  className={`px-3 py-1 rounded-lg text-xs font-semibold ${
                    activeTab === "note" ? "bg-indigo-600 text-white" : "bg-white/5 text-slate-400"
                  }`}
                >
                  Lưu ý bảo hành
                </button>
              </div>
            )}
            <p className="text-xs text-slate-300 whitespace-pre-line leading-relaxed max-h-36 overflow-y-auto">
              {activeTab === "note" && product.note ? product.note : product.description || product.note}
            </p>
          </div>
        )}

        {isContact ? (
          <button
            type="button"
            onClick={() =>
              openTelegramUrl(
                `https://t.me/${shop?.supportUsername || shop?.botUsername || ""}`,
              )
            }
            className="w-full py-3.5 rounded-2xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-sm flex items-center justify-center gap-2"
          >
            <MessageCircle className="w-4 h-4" /> Liên hệ Admin để đặt mua
          </button>
        ) : (
          <>
            {/* Bậc chiết khấu số lượng */}
            {Array.isArray(product.quantityTiers) && product.quantityTiers.length > 0 && (
              <div className="mb-3 flex items-center gap-1.5 flex-wrap">
                <span className="text-[11px] text-slate-400">Mua nhiều giảm thêm:</span>
                {product.quantityTiers.map((t, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => setQty(Math.min(maxQty, Number(t.minQty) || 1))}
                    className="px-2 py-0.5 rounded-lg bg-indigo-500/15 border border-indigo-400/30 text-[11px] font-semibold text-indigo-300"
                  >
                    Từ {t.minQty}+ giảm {t.discountPercent}%
                  </button>
                ))}
              </div>
            )}

            {/* Chọn số lượng */}
            <div className="flex items-center justify-between p-3 rounded-2xl bg-canvas-900 border border-white/10 mb-3">
              <span className="text-xs font-semibold text-slate-300">Số lượng mua</span>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  disabled={qty <= 1}
                  onClick={() => setQty((q) => Math.max(1, q - 1))}
                  className="w-8 h-8 rounded-xl bg-white/5 hover:bg-white/10 flex items-center justify-center disabled:opacity-40"
                >
                  <Minus className="w-4 h-4" />
                </button>
                <span className="w-8 text-center font-bold text-sm">{qty}</span>
                <button
                  type="button"
                  disabled={qty >= maxQty}
                  onClick={() => setQty((q) => Math.min(maxQty, q + 1))}
                  className="w-8 h-8 rounded-xl bg-white/5 hover:bg-white/10 flex items-center justify-center disabled:opacity-40"
                >
                  <Plus className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Mã giảm giá */}
            <div className="flex gap-2 mb-3">
              <div className="relative flex-1">
                <TicketPercent className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={couponInput}
                  onChange={(e) => setCouponInput(e.target.value.toUpperCase())}
                  placeholder="Mã giảm giá (nếu có)..."
                  className="w-full pl-9 pr-3 py-2.5 rounded-xl bg-canvas-900 border border-white/10 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-indigo-500"
                />
              </div>
              <button
                type="button"
                onClick={handleApplyCoupon}
                className="px-4 py-2.5 rounded-xl bg-white/10 hover:bg-white/15 text-xs font-semibold text-white shrink-0"
              >
                Áp dụng
              </button>
            </div>
            {quote?.couponError && appliedCode && (
              <p className="text-xs text-rose-400 mb-2">⚠️ {quote.couponError}</p>
            )}
            {quote?.coupon && (
              <p className="text-xs text-emerald-400 mb-2">
                ✓ Đã áp mã {quote.coupon.code} (−{formatVnd(quote.coupon.discountVnd)})
              </p>
            )}

            {/* Bảng tổng kết giá */}
            <div className="rounded-2xl bg-canvas-900 border border-white/10 p-3.5 space-y-1.5 text-xs mb-4">
              <div className="flex justify-between text-slate-400">
                <span>Tạm tính ({qty} sản phẩm)</span>
                <span>{formatVnd(quote?.grossVnd ?? product.priceVnd * qty)}</span>
              </div>
              {quote?.quantityDiscountVnd > 0 && (
                <div className="flex justify-between text-emerald-400">
                  <span>Chiết khấu số lượng (−{quote.quantityDiscountPercent}%)</span>
                  <span>−{formatVnd(quote.quantityDiscountVnd)}</span>
                </div>
              )}
              {quote?.vipDiscountVnd > 0 && (
                <div className="flex justify-between text-amber-300">
                  <span>Đặc quyền VIP (−{quote.vipDiscountPercent}%)</span>
                  <span>−{formatVnd(quote.vipDiscountVnd)}</span>
                </div>
              )}
              {quote?.coupon?.discountVnd > 0 && (
                <div className="flex justify-between text-emerald-400">
                  <span>Coupon ({quote.coupon.code})</span>
                  <span>−{formatVnd(quote.coupon.discountVnd)}</span>
                </div>
              )}
              <div className="pt-2 border-t border-white/10 flex items-baseline justify-between">
                <span className="font-semibold text-slate-200">Tổng thanh toán</span>
                <div className="text-right">
                  <span className="text-base font-extrabold text-emerald-400">
                    {loadingQuote ? "..." : formatUsd(finalUsd)}
                  </span>
                  <span className="text-xs text-slate-400 ml-1.5">
                    (≈ {formatVnd(finalVnd)})
                  </span>
                </div>
              </div>
            </div>

            {/* Phương thức thanh toán */}
            {!product.inStock ? (
              <button
                type="button"
                disabled
                className="w-full py-3.5 rounded-2xl bg-white/5 text-slate-500 font-bold text-sm"
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
                    className="w-full py-3.5 px-4 rounded-2xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-sm flex items-center justify-center gap-2 shadow-lg shadow-indigo-600/25 disabled:opacity-50"
                  >
                    {submittingMethod === "wallet" ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Wallet className="w-4 h-4" />
                    )}
                    Trừ số dư Ví · Nhận ngay ({formatVnd(finalVnd)})
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      onClose?.();
                      onGoTopup?.(Math.max(10000, finalVnd - balanceVnd));
                    }}
                    className="w-full py-3 px-4 rounded-2xl bg-amber-500/15 border border-amber-400/35 text-amber-200 font-semibold text-xs flex items-center justify-center gap-2"
                  >
                    <Wallet className="w-4 h-4 text-amber-400" />
                    Ví thiếu {formatVnd(Math.max(0, finalVnd - balanceVnd))} · Bấm nạp thêm
                  </button>
                )}

                {!usdOnly && shop?.payments?.vietqr && (
                  <button
                    type="button"
                    disabled={Boolean(submittingMethod)}
                    onClick={() => handleCheckout("vietqr")}
                    className="w-full py-3 px-4 rounded-2xl bg-surface-elevated hover:bg-white/10 border border-white/10 text-slate-100 font-semibold text-xs flex items-center justify-center gap-2 disabled:opacity-50"
                  >
                    {submittingMethod === "vietqr" ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <QrCode className="w-4 h-4 text-sky-400" />
                    )}
                    Chuyển khoản QR Ngân hàng (VietQR)
                  </button>
                )}

                {!usdOnly && Array.isArray(shop?.payments?.cryptoNetworks) && shop.payments.cryptoNetworks.length > 0 && (
                  <div className="grid grid-cols-2 gap-2">
                    {shop.payments.cryptoNetworks.map((net) => (
                      <button
                        key={net.key}
                        type="button"
                        disabled={Boolean(submittingMethod)}
                        onClick={() => handleCheckout(net.method)}
                        className="py-2.5 px-3 rounded-xl bg-surface-elevated hover:bg-white/10 border border-white/10 text-emerald-300 font-semibold text-xs flex items-center justify-center gap-1.5 disabled:opacity-50"
                      >
                        <Coins className="w-3.5 h-3.5" />
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
                    className="w-full py-2.5 px-4 rounded-xl bg-sky-500/15 hover:bg-sky-500/25 border border-sky-400/30 text-sky-200 font-semibold text-xs flex items-center justify-center gap-2 disabled:opacity-50"
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
