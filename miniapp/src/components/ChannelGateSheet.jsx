import React, { useState } from "react";
import { X } from "lucide-react";
import { openTelegramUrl, hapticNotify } from "../lib/telegram.js";
import { tmaFetch } from "../lib/api.js";
import { tr } from "../lib/i18n.js";
import { useToast } from "./Toast.jsx";

export default function ChannelGateSheet({ gate, lang = "vi", onClose, onVerified }) {
  const [checking, setChecking] = useState(false);
  const { showToast } = useToast();

  if (!gate) return null;

  const handleVerify = async () => {
    setChecking(true);
    try {
      const res = await tmaFetch("/verify-channel", { method: "POST" });
      if (res?.channelGate?.joined) {
        hapticNotify("success");
        showToast("Đã xác minh tham gia kênh", "success");
        onVerified?.(res);
      } else {
        hapticNotify("error");
        showToast("Chưa tìm thấy bạn trong kênh, hãy bấm Tham gia trước", "error");
      }
    } catch (err) {
      showToast(err.message || "Không thể kiểm tra lúc này", "error");
    } finally {
      setChecking(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[80] flex items-end justify-center bg-black/80 backdrop-blur-sm animate-fade-in">
      <div className="w-full max-w-lg bg-card border-t border-white/10 rounded-t-[24px] px-5 pt-3 pb-safe-sheet animate-sheet-up">
        <div className="w-9 h-1 rounded-full bg-zinc-700/80 mx-auto mb-4" />

        <div className="flex items-start justify-between gap-3 mb-2">
          <div>
            <h3 className="text-[17px] font-semibold tracking-[-0.02em] text-zinc-100">
              {tr(lang, "joinChannelTitle")}
            </h3>
            <p className="text-[13px] text-zinc-400 mt-1 leading-relaxed">
              {tr(lang, "joinChannelDesc")}
            </p>
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

        <div className="mt-5 space-y-2.5">
          <button
            type="button"
            onClick={() => openTelegramUrl(gate.joinUrl || "https://t.me/vpluschannelkh")}
            className="w-full h-11 rounded-xl bg-zinc-100 hover:bg-white text-zinc-950 font-semibold text-[14px] transition-colors"
          >
            {tr(lang, "openChannelBtn")}
          </button>

          <button
            type="button"
            disabled={checking}
            onClick={handleVerify}
            className="w-full h-11 rounded-xl bg-elevated hover:bg-subtle border border-white/[0.08] text-zinc-200 font-medium text-[14px] transition-colors disabled:opacity-50"
          >
            {checking ? "Đang kiểm tra..." : tr(lang, "verifyJoinedBtn")}
          </button>
        </div>
      </div>
    </div>
  );
}
