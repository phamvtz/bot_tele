import React, { useEffect, useState } from "react";
import { Copy, ExternalLink, RefreshCw, X, Clock, AlertTriangle } from "lucide-react";
import { copyToClipboard, openTelegramUrl, hapticNotify } from "../lib/telegram.js";
import { formatVnd, formatCountdown } from "../lib/format.js";
import { tmaFetch } from "../lib/api.js";
import { tr } from "../lib/i18n.js";
import { useToast } from "./Toast.jsx";

/**
 * Sheet thanh toán Realtime dùng chung cho:
 *  - Đơn mua hàng / API Key (`mode = "order"`, `targetId = orderId`)
 *  - Nạp tiền vào Ví (`mode = "deposit"`, `targetId = depositId`)
 */
export default function PaymentSheet({
  session,
  lang = "vi",
  onClose,
  onCompleted,
  onCanceled,
}) {
  const [checking, setChecking] = useState(false);
  const [canceling, setCanceling] = useState(false);
  const [now, setNow] = useState(Date.now());
  const { showToast } = useToast();

  const payment = session?.payment;
  const isOrder = session?.mode === "order";
  const targetId = session?.targetId;

  useEffect(() => {
    if (!session) return undefined;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [session]);

  // Polling tự động mỗi 4 giây để phát hiện ngay khi bank-poller / crypto-poller khớp tiền
  useEffect(() => {
    if (!session || !targetId) return undefined;
    let cancelled = false;

    const poll = async () => {
      try {
        if (isOrder) {
          const res = await tmaFetch(`/orders/${targetId}`);
          if (cancelled) return;
          const st = res?.order?.status;
          if (st === "DELIVERED") {
            hapticNotify("success");
            onCompleted?.({
              mode: "order",
              orderId: res.order.id,
              shortId: res.order.shortId,
              title: res.order.title,
              deliveryContent: res.order.deliveryContent,
            });
          } else if (st === "CANCELED") {
            showToast("Giao dịch đã hết hạn hoặc bị hủy.", "error");
            onCanceled?.();
          }
        } else {
          const res = await tmaFetch(`/wallet/deposit/${targetId}`);
          if (cancelled) return;
          if (res?.status === "SUCCESS") {
            hapticNotify("success");
            onCompleted?.({
              mode: "deposit",
              depositId: targetId,
              amountVnd: res.amountVnd,
              balanceVnd: res.balanceVnd,
            });
          } else if (res?.status === "EXPIRED" || res?.status === "FAILED") {
            showToast("Lệnh nạp đã hết hạn.", "error");
            onCanceled?.();
          }
        }
      } catch {}
    };

    const timer = setInterval(poll, 4000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [session, targetId, isOrder, onCompleted, onCanceled, showToast]);

  if (!session || !payment) return null;

  const countdown = formatCountdown(payment.expiresAt, now);

  const handleCopy = async (val, label) => {
    const ok = await copyToClipboard(val);
    if (ok) showToast(`Đã sao chép ${label}!`, "success");
  };

  const handleManualCheck = async () => {
    setChecking(true);
    try {
      const path = isOrder
        ? `/orders/${targetId}/check`
        : `/wallet/deposit/${targetId}/check`;
      const res = await tmaFetch(path, { method: "POST" });
      if (isOrder && res.status === "DELIVERED") {
        hapticNotify("success");
        onCompleted?.({
          mode: "order",
          orderId: targetId,
          shortId: session.shortId,
          title: session.title,
          deliveryContent: res.deliveryContent,
        });
      } else if (!isOrder && res.status === "SUCCESS") {
        hapticNotify("success");
        onCompleted?.({
          mode: "deposit",
          depositId: targetId,
          amountVnd: session.amountVnd,
          balanceVnd: res.balanceVnd,
        });
      } else {
        showToast("Hệ thống chưa ghi nhận giao dịch mới, vui lòng chờ thêm 15–30 giây nhé!", "info");
      }
    } catch (err) {
      showToast(err.message, "error");
    } finally {
      setChecking(false);
    }
  };

  const handleCancel = async () => {
    if (!isOrder) {
      onClose?.();
      return;
    }
    setCanceling(true);
    try {
      await tmaFetch(`/orders/${targetId}/cancel`, { method: "POST" });
      showToast("Đã hủy đơn chờ thanh toán.", "info");
      onCanceled?.();
    } catch (err) {
      showToast(err.message, "error");
    } finally {
      setCanceling(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/75 backdrop-blur-sm animate-fade-in">
      <div className="w-full max-w-lg bg-surface-card border-t border-white/15 rounded-t-3xl p-5 pb-safe-sheet max-h-[92vh] overflow-y-auto animate-sheet-up">
        <div className="flex items-center justify-between gap-2 mb-3">
          <div>
            <h3 className="text-base font-bold text-white">
              {session.title || (isOrder ? "Thanh toán đơn hàng" : "Nạp tiền vào Ví")}
            </h3>
            <div className="flex items-center gap-2 text-xs text-slate-400 mt-0.5">
              {session.shortId && <span className="font-mono">#{session.shortId}</span>}
              {countdown && (
                <span
                  className={`inline-flex items-center gap-1 font-mono font-semibold ${
                    countdown.totalSec < 120 ? "text-amber-400" : "text-emerald-400"
                  }`}
                >
                  <Clock className="w-3.5 h-3.5" /> {countdown.text}
                </span>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-xl bg-white/5 text-slate-400 hover:text-white"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* VIETQR */}
        {payment.kind === "vietqr" && (
          <div className="space-y-3">
            {(payment.qrDataUrl || payment.qrUrl) && (
              <div className="bg-white p-3 rounded-2xl w-52 h-52 mx-auto flex items-center justify-center shadow-lg">
                <img
                  src={payment.qrDataUrl || payment.qrUrl}
                  alt="VietQR"
                  className="w-full h-full object-contain"
                />
              </div>
            )}

            <div className="rounded-2xl bg-canvas-900 border border-white/10 divide-y divide-white/10 text-xs">
              <div className="p-3 flex items-center justify-between">
                <span className="text-slate-400">Ngân hàng</span>
                <span className="font-semibold text-white">
                  {payment.bankInfo?.bankName || payment.bankInfo?.bankCode}
                </span>
              </div>
              <div className="p-3 flex items-center justify-between gap-2">
                <span className="text-slate-400">Số tài khoản</span>
                <button
                  type="button"
                  onClick={() => handleCopy(payment.bankInfo?.accountNumber, "Số tài khoản")}
                  className="flex items-center gap-1.5 font-mono font-bold text-sky-300"
                >
                  {payment.bankInfo?.accountNumber}
                  <Copy className="w-3.5 h-3.5" />
                </button>
              </div>
              {payment.bankInfo?.accountName && (
                <div className="p-3 flex items-center justify-between">
                  <span className="text-slate-400">Chủ tài khoản</span>
                  <span className="font-semibold text-slate-200">{payment.bankInfo.accountName}</span>
                </div>
              )}
              <div className="p-3 flex items-center justify-between gap-2">
                <span className="text-slate-400">Số tiền chính xác</span>
                <button
                  type="button"
                  onClick={() => handleCopy(payment.amountVnd, "Số tiền")}
                  className="flex items-center gap-1.5 font-bold text-emerald-400 text-sm"
                >
                  {formatVnd(payment.amountVnd)}
                  <Copy className="w-3.5 h-3.5" />
                </button>
              </div>
              <div className="p-3 flex items-center justify-between gap-2 bg-indigo-500/10">
                <span className="text-indigo-200 font-medium">Nội dung CK</span>
                <button
                  type="button"
                  onClick={() => handleCopy(payment.transferContent, "Nội dung chuyển khoản")}
                  className="flex items-center gap-1.5 font-mono font-bold text-amber-300 text-sm"
                >
                  {payment.transferContent}
                  <Copy className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            <div className="flex items-start gap-2 p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/25 text-[11px] text-amber-200">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-amber-400" />
              <span>
                Chuyển đúng <b>số tiền</b> và <b>nội dung chuyển khoản</b>. Hệ thống tự động xác nhận và giao hàng ngay trên màn hình này trong 10–30 giây!
              </span>
            </div>
          </div>
        )}

        {/* CRYPTO USDT */}
        {payment.kind === "crypto" && (
          <div className="space-y-3">
            {payment.qrSupported && payment.qrDataUrl && (
              <div className="bg-white p-3 rounded-2xl w-48 h-48 mx-auto flex items-center justify-center shadow-lg">
                <img src={payment.qrDataUrl} alt="USDT QR" className="w-full h-full object-contain" />
              </div>
            )}

            <div className="rounded-2xl bg-canvas-900 border border-white/10 divide-y divide-white/10 text-xs">
              <div className="p-3 flex items-center justify-between">
                <span className="text-slate-400">Mạng lưới</span>
                <span className="px-2 py-0.5 rounded-lg bg-emerald-500/20 text-emerald-300 font-bold">
                  {payment.token || "USDT"} · {payment.networkLabel}
                </span>
              </div>
              <div className="p-3 flex items-center justify-between gap-2 bg-amber-500/10">
                <span className="text-amber-200 font-medium">Số lượng cần chuyển</span>
                <button
                  type="button"
                  onClick={() => handleCopy(payment.amountToken, "Số lượng USDT")}
                  className="flex items-center gap-1.5 font-mono font-bold text-amber-300 text-sm"
                >
                  {payment.amountToken} {payment.token || "USDT"}
                  <Copy className="w-3.5 h-3.5" />
                </button>
              </div>
              <div className="p-3 space-y-1.5">
                <div className="flex items-center justify-between text-slate-400">
                  <span>{payment.network === "binance_pay" ? "Binance Pay ID" : "Địa chỉ ví nhận"}</span>
                  <button
                    type="button"
                    onClick={() => handleCopy(payment.address, "Địa chỉ nhận")}
                    className="text-sky-300 font-semibold flex items-center gap-1"
                  >
                    Sao chép <Copy className="w-3 h-3" />
                  </button>
                </div>
                <div className="p-2.5 rounded-xl bg-canvas-950 font-mono text-[11px] text-slate-200 break-all">
                  {payment.address}
                </div>
              </div>
            </div>

            <div className="flex items-start gap-2 p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/25 text-[11px] text-amber-200">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-amber-400" />
              <span>
                Bắt buộc chuyển <b>ĐÚNG TỪNG SỐ LẺ</b> ({payment.amountToken} USDT) để hệ thống tự động nhận diện giao dịch của bạn!
              </span>
            </div>
          </div>
        )}

        {/* CRYPTOPAY */}
        {payment.kind === "cryptopay" && (
          <div className="space-y-3 py-2">
            <div className="rounded-2xl bg-canvas-900 border border-white/10 p-4 text-center space-y-2">
              <div className="text-xs text-slate-400">Thanh toán tự động qua @CryptoBot</div>
              <div className="text-2xl font-extrabold text-emerald-400 font-mono">
                {payment.amountToken} {payment.asset || "USDT"}
              </div>
              <button
                type="button"
                onClick={() => openTelegramUrl(payment.payUrl)}
                className="w-full mt-2 py-3 rounded-2xl bg-sky-500 hover:bg-sky-400 text-canvas-950 font-bold text-sm flex items-center justify-center gap-2"
              >
                <ExternalLink className="w-4 h-4" /> Mở Hóa Đơn @CryptoBot
              </button>
            </div>
          </div>
        )}

        <div className="mt-4 space-y-2">
          <button
            type="button"
            disabled={checking}
            onClick={handleManualCheck}
            className="w-full py-3 rounded-2xl bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-sm flex items-center justify-center gap-2 disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${checking ? "animate-spin" : ""}`} />
            {tr(lang, "checkPayment")}
          </button>

          <button
            type="button"
            disabled={canceling}
            onClick={handleCancel}
            className="w-full py-2.5 rounded-2xl bg-white/5 hover:bg-rose-500/15 text-slate-300 hover:text-rose-300 text-xs font-semibold transition-colors"
          >
            {isOrder ? tr(lang, "cancelOrder") : "Đóng cửa sổ"}
          </button>
        </div>
      </div>
    </div>
  );
}
