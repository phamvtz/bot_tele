import React, { createContext, useContext, useState, useCallback } from "react";
import { CheckCircle2, AlertCircle, Info } from "lucide-react";

const ToastContext = createContext(null);

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  const showToast = useCallback((message, type = "info") => {
    const id = `${Date.now()}_${Math.random()}`;
    setToasts((prev) => [...prev.slice(-2), { id, message, type }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 2800);
  }, []);

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      <div className="fixed top-3 inset-x-3 z-[90] flex flex-col items-center gap-2 pointer-events-none">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`pointer-events-auto flex items-center gap-2.5 px-4 py-2.5 rounded-2xl border shadow-xl backdrop-blur-md text-sm font-medium animate-fade-in max-w-sm w-full ${
              t.type === "success"
                ? "bg-emerald-950/90 border-emerald-500/40 text-emerald-100"
                : t.type === "error"
                  ? "bg-rose-950/90 border-rose-500/40 text-rose-100"
                  : "bg-surface-elevated/95 border-white/15 text-slate-100"
            }`}
          >
            {t.type === "success" ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            ) : t.type === "error" ? (
              <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
            ) : (
              <Info className="w-4 h-4 text-sky-400 shrink-0" />
            )}
            <span className="leading-snug">{t.message}</span>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext) || { showToast: () => {} };
}
