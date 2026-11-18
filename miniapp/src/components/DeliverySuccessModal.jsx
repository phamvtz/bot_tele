import React, { useState } from "react";
import { X } from "lucide-react";
import { copyToClipboard } from "../lib/telegram.js";
import { formatTokensCompact } from "../lib/format.js";
import { tmaFetch } from "../lib/api.js";
import { useToast } from "./Toast.jsx";

export default function DeliverySuccessModal({ data, onClose }) {
  const [sendingBot, setSendingBot] = useState(false);
  const { showToast } = useToast();

  if (!data) return null;

  let parsedKey = data.apiKey || null;
  if (!parsedKey && data.deliveryContent) {
    try {
      const maybe = JSON.parse(data.deliveryContent);
      if (maybe && maybe.key) parsedKey = maybe;
    } catch {}
  }

  const copyText = parsedKey?.key || data.deliveryContent || "";

  const handleCopy = async (text, label = "nội dung") => {
    const ok = await copyToClipboard(text);
    if (ok) showToast(`Đã sao chép ${label}`, "success");
  };

  const handleResendToBot = async () => {
    if (!data.orderId) return;
    setSendingBot(true);
    try {
      await tmaFetch(`/orders/${data.orderId}/resend-bot`, { method: "POST" });
      showToast("Đã gửi bản lưu vào khung chat Bot", "success");
    } catch (err) {
      showToast(err.message || "Không thể gửi tin về Bot", "error");
    } finally {
      setSendingBot(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[75] flex items-end sm:items-center justify-center bg-black/80 backdrop-blur-sm animate-fade-in">
      <div className="w-full max-w-lg bg-card border-t sm:border border-white/10 rounded-t-[24px] sm:rounded-[24px] px-5 pt-3 pb-safe-sheet max-h-[88vh] flex flex-col animate-sheet-up">
        <div className="w-9 h-1 rounded-full bg-zinc-700/80 mx-auto mb-4 sm:hidden" />

        <div className="flex items-start justify-between gap-3 mb-4">
          <div>
            <div className="inline-flex items-center gap-1.5 text-[12px] font-medium text-emerald-400 mb-1">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
              Giao dịch hoàn tất
            </div>
            <h3 className="text-[18px] font-semibold tracking-[-0.02em] text-zinc-100">
              {data.title || "Thông tin đơn hàng"}
            </h3>
            {data.shortId && (
              <p className="text-[12px] text-zinc-500 font-mono mt-0.5">#{data.shortId}</p>
            )}
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

        <div className="overflow-y-auto space-y-3 flex-1">
          {parsedKey ? (
            <div className="rounded-2xl bg-bg border border-white/[0.08] p-4 space-y-3">
              <div className="flex items-center justify-between text-[12px] text-zinc-400">
                <span>API Key</span>
                {parsedKey.quotaTokens > 0 && (
                  <span className="font-mono text-zinc-200">
                    {formatTokensCompact(parsedKey.quotaTokens)} tokens
                  </span>
                )}
              </div>
              <div className="p-3 rounded-xl bg-card border border-white/[0.06] font-mono text-[12.5px] break-all text-zinc-100 select-all">
                {parsedKey.key}
              </div>
              <button
                type="button"
                onClick={() => handleCopy(parsedKey.key, "API Key")}
                className="w-full h-10 rounded-xl bg-zinc-100 hover:bg-white text-zinc-950 text-[13px] font-semibold transition-colors"
              >
                Sao chép API Key
              </button>
              {parsedKey.endpoint && (
                <div className="pt-2.5 border-t border-white/[0.06] flex items-center justify-between gap-2 text-[12px]">
                  <span className="text-zinc-400 font-mono truncate">{parsedKey.endpoint}</span>
                  <button
                    type="button"
                    onClick={() => handleCopy(parsedKey.endpoint, "Base URL")}
                    className="text-zinc-100 font-medium shrink-0 hover:underline"
                  >
                    Sao chép URL
                  </button>
                </div>
              )}
            </div>
          ) : copyText ? (
            <div className="rounded-2xl bg-bg border border-white/[0.08] p-4 space-y-3">
              <div className="text-[12px] text-zinc-400">Nội dung đã giao</div>
              <pre className="text-[12.5px] font-mono text-zinc-100 whitespace-pre-wrap break-words max-h-56 overflow-y-auto bg-card p-3 rounded-xl border border-white/[0.06] select-all">
                {copyText}
              </pre>
              <button
                type="button"
                onClick={() => handleCopy(copyText, "nội dung sản phẩm")}
                className="w-full h-10 rounded-xl bg-zinc-100 hover:bg-white text-zinc-950 text-[13px] font-semibold transition-colors"
              >
                Sao chép toàn bộ
              </button>
            </div>
          ) : (
            <div className="rounded-2xl bg-bg border border-white/[0.08] p-4 text-[13px] text-zinc-300 leading-relaxed">
              {data.subtitle || "Đơn hàng đã hoàn tất và được lưu vào lịch sử của bạn."}
            </div>
          )}

          {data.customerDmSkipped && (
            <div className="rounded-xl bg-elevated border border-white/[0.07] p-3 text-[12px] text-zinc-400 leading-relaxed">
              Bạn chưa mở khung chat với Bot nên nội dung được hiển thị trực tiếp tại đây. Mở Bot và gửi /start nếu muốn nhận thêm bản lưu qua tin nhắn.
            </div>
          )}
        </div>

        <div className="mt-4 pt-3 border-t border-white/[0.07] flex gap-2.5">
          {data.orderId && copyText && (
            <button
              type="button"
              disabled={sendingBot}
              onClick={handleResendToBot}
              className="flex-1 h-11 rounded-xl bg-elevated hover:bg-subtle border border-white/[0.08] text-zinc-200 text-[13px] font-medium disabled:opacity-50"
            >
              {sendingBot ? "Đang gửi..." : "Gửi về chat Bot"}
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="flex-1 h-11 rounded-xl bg-zinc-100 hover:bg-white text-zinc-950 text-[14px] font-semibold"
          >
            Đóng
          </button>
        </div>
      </div>
    </div>
  );
}
