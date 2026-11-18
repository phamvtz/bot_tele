import React, { useEffect, useState } from "react";
import { X } from "lucide-react";
import { copyToClipboard, openTelegramUrl, hapticNotify } from "../lib/telegram.js";
import { formatVnd, formatCountdown } from "../lib/format.js";
import { tmaFetch } from "../lib/api.js";
import { tr } from "../lib/i18n.js";
import { useToast } from "./Toast.jsx";

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
            showToast("Giao dịch đã hết hạn hoặc bị hủy", "error");
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
            showToast("Lệnh nạp đã hết hạn", "error");
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
    if (ok) showToast(`Đã sao chép ${label}`, "success");
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
        showToast("Chưa ghi nhận giao dịch mới, hệ thống đang tự quét mỗi 4 giây", "info");
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
      showToast("Đã hủy giao dịch", "info");
      onCanceled?.();
    } catch (err) {
      showToast(err.message, "error");
    } finally {
      setCanceling(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/80 backdrop-blur-sm animate-fade-in">
      <div className="w-full max-w-lg bg-card border-t border-white/10 rounded-t-[24px] px-5 pt-3 pb-safe-sheet max-h-[92vh] overflow-y-auto animate-sheet-up">
        <div className="w-9 h-1 rounded-full bg-zinc-700/80 mx-auto mb-4" />

        <div className="flex items-start justify-between gap-3 mb-4">
          <div>
            <h3 className="text-[17px] font-semibold tracking-[-0.02em] text-zinc-100">
              {session.title || (isOrder ? "Thanh toán đơn hàng" : "Nạp tiền vào Ví")}
            </h3>
            <div className="flex items-center gap-2 text-[12px] text-zinc-400 mt-0.5 font-mono tabular">
              {session.shortId && <span>#{session.shortId}</span>}
              {countdown && (
                <>
                  {session.shortId && <span className="text-zinc-600">·</span>}
                  <span className={countdown.totalSec < 120 ? "text-amber-400" : "text-zinc-300"}>
                    Còn {countdown.text}
                  </span>
                </>
              )}
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

        {/* VIETQR */}
        {payment.kind === "vietqr" && (
          <div className="space-y-3.5">
            {(payment.qrDataUrl || payment.qrUrl) && (
              <div className="bg-white p-3.5 rounded-2xl w-52 h-52 mx-auto flex items-center justify-center">
                <img
                  src={payment.qrDataUrl || payment.qrUrl}
                  alt="Mã QR chuyển khoản VietQR"
                  className="w-full h-full object-contain"
                />
              </div>
            )}

            <div className="rounded-2xl bg-bg border border-white/[0.08] divide-y divide-white/[0.06] text-[13px]">
              <div className="px-3.5 py-3 flex items-center justify-between">
                <span className="text-zinc-400">Ngân hàng</span>
                <span className="font-medium text-zinc-100">
                  {payment.bankInfo?.bankName || payment.bankInfo?.bankCode}
                </span>
              </div>
              <div className="px-3.5 py-3 flex items-center justify-between gap-2">
                <span className="text-zinc-400">Số tài khoản</span>
                <button
                  type="button"
                  onClick={() => handleCopy(payment.bankInfo?.accountNumber, "số tài khoản")}
                  className="flex items-center gap-2 font-mono font-medium text-zinc-100 hover:text-white"
                >
                  <span>{payment.bankInfo?.accountNumber}</span>
                  <span className="text-[11px] font-sans px-2 py-0.5 rounded-md bg-elevated text-zinc-300">
                    Copy
                  </span>
                </button>
              </div>
              {payment.bankInfo?.accountName && (
                <div className="px-3.5 py-3 flex items-center justify-between">
                  <span className="text-zinc-400">Chủ tài khoản</span>
                  <span className="font-medium text-zinc-200">{payment.bankInfo.accountName}</span>
                </div>
              )}
              <div className="px-3.5 py-3 flex items-center justify-between gap-2">
                <span className="text-zinc-400">Số tiền</span>
                <button
                  type="button"
                  onClick={() => handleCopy(payment.amountVnd, "số tiền")}
                  className="flex items-center gap-2 font-mono font-semibold text-emerald-400 tabular"
                >
                  <span>{formatVnd(payment.amountVnd)}</span>
                  <span className="text-[11px] font-sans px-2 py-0.5 rounded-md bg-elevated text-zinc-300 font-medium">
                    Copy
                  </span>
                </button>
              </div>
              <div className="px-3.5 py-3 flex items-center justify-between gap-2">
                <span className="text-zinc-400">Nội dung CK</span>
                <button
                  type="button"
                  onClick={() => handleCopy(payment.transferContent, "nội dung chuyển khoản")}
                  className="flex items-center gap-2 font-mono font-semibold text-zinc-100"
                >
                  <span>{payment.transferContent}</span>
                  <span className="text-[11px] font-sans px-2 py-0.5 rounded-md bg-zinc-100 text-zinc-950 font-semibold">
                    Copy
                  </span>
                </button>
              </div>
            </div>

            <p className="text-[12px] text-zinc-400 leading-relaxed text-center px-2">
              Giữ nguyên nội dung chuyển khoản và số tiền. Hệ thống tự động xác nhận sau 10–30 giây.
            </p>
          </div>
        )}

        {/* CRYPTO USDT */}
        {payment.kind === "crypto" && (
          <div className="space-y-3.5">
            {payment.qrSupported && payment.qrDataUrl && (
              <div className="bg-white p-3.5 rounded-2xl w-48 h-48 mx-auto flex items-center justify-center">
                <img
                  src={payment.qrDataUrl}
                  alt="Mã QR địa chỉ ví USDT"
                  className="w-full h-full object-contain"
                />
              </div>
            )}

            <div className="rounded-2xl bg-bg border border-white/[0.08] divide-y divide-white/[0.06] text-[13px]">
              <div className="px-3.5 py-3 flex items-center justify-between">
                <span className="text-zinc-400">Mạng lưới</span>
                <span className="font-mono font-medium text-zinc-100">
                  {payment.token || "USDT"} · {payment.networkLabel}
                </span>
              </div>
              <div className="px-3.5 py-3 flex items-center justify-between gap-2">
                <span className="text-zinc-400">Số lượng chính xác</span>
                <button
                  type="button"
                  onClick={() => handleCopy(payment.amountToken, "số lượng USDT")}
                  className="flex items-center gap-2 font-mono font-semibold text-emerald-400 tabular"
                >
                  <span>
                    {payment.amountToken} {payment.token || "USDT"}
                  </span>
                  <span className="text-[11px] font-sans px-2 py-0.5 rounded-md bg-zinc-100 text-zinc-950 font-semibold">
                    Copy
                  </span>
                </button>
              </div>
              <div className="px-3.5 py-3 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-zinc-400">
                    {payment.network === "binance_pay" ? "Binance Pay ID" : "Địa chỉ ví nhận"}
                  </span>
                  <button
                    type="button"
                    onClick={() => handleCopy(payment.address, "địa chỉ nhận")}
                    className="text-[11px] px-2 py-0.5 rounded-md bg-elevated text-zinc-200 font-medium"
                  >
                    Sao chép
                  </button>
                </div>
                <div className="p-2.5 rounded-xl bg-card border border-white/[0.06] font-mono text-[12px] text-zinc-200 break-all select-all">
                  {payment.address}
                </div>
              </div>
            </div>

            <p className="text-[12px] text-amber-400/90 leading-relaxed text-center px-2">
              Chuyển chính xác cả phần số thập phân ({payment.amountToken} USDT) để khớp đơn tự động.
            </p>
          </div>
        )}

        {/* CRYPTOPAY */}
        {payment.kind === "cryptopay" && (
          <div className="rounded-2xl bg-bg border border-white/[0.08] p-5 text-center space-y-3">
            <div className="text-[12px] text-zinc-400">Hóa đơn CryptoBot</div>
            <div className="text-[26px] font-semibold tracking-[-0.03em] text-zinc-100 font-mono tabular">
              {payment.amountToken} {payment.asset || "USDT"}
            </div>
            <button
              type="button"
              onClick={() => openTelegramUrl(payment.payUrl)}
              className="w-full h-11 rounded-xl bg-zinc-100 hover:bg-white text-zinc-950 font-semibold text-[14px]"
            >
              Mở hóa đơn trên @CryptoBot
            </button>
          </div>
        )}

        <div className="mt-4 space-y-2">
          <button
            type="button"
            disabled={checking}
            onClick={handleManualCheck}
            className="w-full h-11 rounded-xl bg-zinc-100 hover:bg-white text-zinc-950 font-semibold text-[14px] transition-colors disabled:opacity-50"
          >
            {checking ? "Đang kiểm tra..." : tr(lang, "checkPayment")}
          </button>

          <button
            type="button"
            disabled={canceling}
            onClick={handleCancel}
            className="w-full h-10 rounded-xl text-zinc-400 hover:text-zinc-200 text-[13px] font-medium transition-colors"
          >
            {isOrder ? tr(lang, "cancelOrder") : "Thu gọn"}
          </button>
        </div>
      </div>
    </div>
  );
}
