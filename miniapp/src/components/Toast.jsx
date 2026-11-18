import React, { createContext, useContext, useState, useCallback } from "react";

const ToastContext = createContext(null);

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  const showToast = useCallback((message, type = "info") => {
    const id = `${Date.now()}_${Math.random()}`;
    setToasts((prev) => [...prev.slice(-2), { id, message, type }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 2600);
  }, []);

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      <div
        role="status"
        aria-live="polite"
        className="fixed top-3 inset-x-4 z-[90] flex flex-col items-center gap-2 pointer-events-none"
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            className="pointer-events-auto flex items-center gap-2.5 px-4 py-2.5 rounded-full bg-zinc-900/95 border border-white/10 shadow-2xl backdrop-blur-xl text-[13px] font-medium text-zinc-100 animate-fade-in max-w-sm"
          >
            <span
              className={`w-2 h-2 rounded-full shrink-0 ${
                t.type === "success"
                  ? "bg-emerald-400"
                  : t.type === "error"
                    ? "bg-rose-400"
                    : "bg-zinc-400"
              }`}
            />
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
