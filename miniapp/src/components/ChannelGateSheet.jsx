import React, { useState } from "react";
import { ShieldAlert, ExternalLink, RefreshCw, X } from "lucide-react";
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
        showToast("Xác minh tham gia kênh thành công!", "success");
        onVerified?.(res);
      } else {
        hapticNotify("error");
        showToast("Hệ thống chưa thấy bạn trong kênh. Hãy bấm Tham gia kênh trước nhé!", "error");
      }
    } catch (err) {
      showToast(err.message || "Không thể kiểm tra lúc này.", "error");
    } finally {
      setChecking(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[80] flex items-end justify-center bg-black/70 backdrop-blur-sm animate-fade-in">
      <div className="w-full max-w-lg bg-surface-card border-t border-white/15 rounded-t-3xl p-5 pb-safe-sheet animate-sheet-up">
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-2xl bg-indigo-500/20 border border-indigo-400/30 flex items-center justify-center text-indigo-300">
              <ShieldAlert className="w-6 h-6" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white">{tr(lang, "joinChannelTitle")}</h3>
              <p className="text-xs text-slate-400">Mở khóa mua hàng, nạp ví & nhận quà</p>
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

        <p className="text-sm text-slate-300 leading-relaxed mb-5">
          {tr(lang, "joinChannelDesc")}
        </p>

        <div className="space-y-2.5">
          <button
            type="button"
            onClick={() => openTelegramUrl(gate.joinUrl || "https://t.me/vpluschannelkh")}
            className="w-full py-3 px-4 rounded-2xl bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-sm flex items-center justify-center gap-2 shadow-lg shadow-indigo-600/25"
          >
            <ExternalLink className="w-4 h-4" />
            {tr(lang, "openChannelBtn")}
          </button>

          <button
            type="button"
            disabled={checking}
            onClick={handleVerify}
            className="w-full py-3 px-4 rounded-2xl bg-emerald-600/20 hover:bg-emerald-600/30 border border-emerald-500/40 text-emerald-200 font-semibold text-sm flex items-center justify-center gap-2 disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${checking ? "animate-spin" : ""}`} />
            {tr(lang, "verifyJoinedBtn")}
          </button>
        </div>
      </div>
    </div>
  );
}
