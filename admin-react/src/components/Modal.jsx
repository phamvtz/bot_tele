import { useEffect } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

export default function Modal({ open, onClose, title, children, width = "max-w-lg" }) {
  useEffect(() => {
    if (open) document.body.style.overflow = "hidden";
    else document.body.style.overflow = "";
    return () => { document.body.style.overflow = ""; };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handler = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4">
      {/* Dark backdrop */}
      <div className="absolute inset-0 bg-[#020617]/80 backdrop-blur-md animate-fade-in" onClick={onClose} />
      
      {/* Linear & Vercel style Modal Box: rounded-2xl, top highlight bevel, ultra-subtle 1px border */}
      <div className={`relative bg-gradient-to-b from-[#131b2e] to-[#0f172a] border border-white/10 rounded-2xl shadow-2xl shadow-black/90 ring-1 ring-white/[0.04] w-full ${width} max-h-[90vh] flex flex-col animate-modal-in z-10`}>
        {/* Header with thin divider */}
        <div className="flex items-center justify-between px-5 py-3.5 thin-divider flex-shrink-0">
          <h2 className="text-sm font-semibold text-slate-100 tracking-tight font-display flex items-center gap-2">
            {title}
          </h2>
          <div className="flex items-center gap-2">
            <kbd className="hidden sm:inline font-mono text-[10px] text-slate-400 uppercase px-1.5 py-0.5 rounded border border-white/10 bg-slate-900/60">
              ESC
            </kbd>
            <button
              onClick={onClose}
              className="w-7 h-7 flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-100 hover:bg-white/[0.06] border border-transparent hover:border-white/10 transition-all cursor-pointer">
              <X size={14} />
            </button>
          </div>
        </div>

        {/* Scrollable content */}
        <div className="p-5 overflow-y-auto">{children}</div>
      </div>
    </div>,
    document.body
  );
}
