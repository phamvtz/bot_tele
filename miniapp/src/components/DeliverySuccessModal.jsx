import React, { useState } from "react";
import { CheckCircle2, Copy, Send, X, KeyRound } from "lucide-react";
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

  const handleCopy = async (text, label = "Nội dung") => {
    const ok = await copyToClipboard(text);
    if (ok) showToast(`Đã sao chép ${label}!`, "success");
  };

  const handleResendToBot = async () => {
    if (!data.orderId) return;
    setSendingBot(true);
    try {
      await tmaFetch(`/orders/${data.orderId}/resend-bot`, { method: "POST" });
      showToast("Đã gửi bản lưu vào khung chat Bot!", "success");
    } catch (err) {
      showToast(err.message || "Không thể gửi tin về Bot.", "error");
    } finally {
      setSendingBot(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[75] flex items-end sm:items-center justify-center bg-black/75 backdrop-blur-sm animate-fade-in">
      <div className="w-full max-w-lg bg-surface-card border border-white/15 rounded-t-3xl sm:rounded-3xl p-5 pb-safe-sheet max-h-[88vh] flex flex-col animate-sheet-up">
        <div className="flex items-start justify-between gap-3 mb-4">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-2xl bg-emerald-500/20 border border-emerald-400/30 flex items-center justify-center text-emerald-400">
              <CheckCircle2 className="w-6 h-6" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white">
                {data.title || "Giao dịch hoàn tất!"}
              </h3>
              {data.shortId && (
                <p className="text-xs text-slate-400 font-mono">Mã đơn: #{data.shortId}</p>
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

        <div className="overflow-y-auto space-y-3 pr-1 flex-1">
          {parsedKey ? (
            <div className="rounded-2xl bg-canvas-950/90 border border-indigo-500/30 p-4 space-y-3">
              <div className="flex items-center justify-between text-xs text-indigo-300 font-semibold">
                <span className="flex items-center gap-1.5">
                  <KeyRound className="w-4 h-4" /> API KEY CỦA BẠN
                </span>
                {parsedKey.quotaTokens > 0 && (
                  <span className="px-2 py-0.5 rounded-full bg-indigo-500/20">
                    {formatTokensCompact(parsedKey.quotaTokens)} token
                  </span>
                )}
              </div>
              <div className="p-3 rounded-xl bg-canvas-900 border border-white/10 font-mono text-xs break-all text-emerald-300 select-all">
                {parsedKey.key}
              </div>
              <button
                type="button"
                onClick={() => handleCopy(parsedKey.key, "API Key")}
                className="w-full py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold flex items-center justify-center gap-1.5"
              >
                <Copy className="w-3.5 h-3.5" /> Sao chép API Key
              </button>
              {parsedKey.endpoint && (
                <div className="pt-2 border-t border-white/10 flex items-center justify-between gap-2 text-xs">
                  <span className="text-slate-400 truncate">Endpoint: {parsedKey.endpoint}</span>
                  <button
                    type="button"
                    onClick={() => handleCopy(parsedKey.endpoint, "Endpoint")}
                    className="text-indigo-300 font-semibold shrink-0"
                  >
                    Copy
                  </button>
                </div>
              )}
            </div>
          ) : copyText ? (
            <div className="rounded-2xl bg-canvas-950/90 border border-white/10 p-3.5 space-y-2.5">
              <div className="text-xs font-semibold text-slate-300">Thông tin sản phẩm đã giao:</div>
              <pre className="text-xs font-mono text-emerald-300 whitespace-pre-wrap break-words max-h-56 overflow-y-auto bg-canvas-900 p-3 rounded-xl border border-white/5 select-all">
                {copyText}
              </pre>
              <button
                type="button"
                onClick={() => handleCopy(copyText, "thông tin sản phẩm")}
                className="w-full py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold flex items-center justify-center gap-1.5"
              >
                <Copy className="w-3.5 h-3.5" /> Sao chép toàn bộ
              </button>
            </div>
          ) : (
            <div className="rounded-2xl bg-canvas-900 border border-white/10 p-4 text-sm text-slate-300">
              {data.subtitle || "Đơn hàng đã được xử lý và gửi về khung chat Bot Telegram của bạn!"}
            </div>
          )}

          {data.customerDmSkipped && (
            <div className="rounded-xl bg-amber-500/10 border border-amber-500/30 p-3 text-xs text-amber-200">
              Lưu ý: Bạn chưa khởi động hoặc đang tắt thông báo Bot nên hệ thống hiển thị sản phẩm trực tiếp tại đây. Hãy mở Bot bấm /start để nhận bản sao lưu tự động.
            </div>
          )}
        </div>

        <div className="mt-4 pt-3 border-t border-white/10 flex gap-2.5">
          {data.orderId && copyText && (
            <button
              type="button"
              disabled={sendingBot}
              onClick={handleResendToBot}
              className="flex-1 py-3 rounded-2xl bg-white/5 hover:bg-white/10 border border-white/10 text-slate-200 text-xs font-semibold flex items-center justify-center gap-1.5 disabled:opacity-50"
            >
              <Send className="w-3.5 h-3.5" />
              {sendingBot ? "Đang gửi..." : "Gửi bản lưu về Bot"}
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="flex-1 py-3 rounded-2xl bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-bold"
          >
            Hoàn tất
          </button>
        </div>
      </div>
    </div>
  );
}
