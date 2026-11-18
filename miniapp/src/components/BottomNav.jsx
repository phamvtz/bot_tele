import React from "react";
import { LayoutGrid, KeyRound, Wallet, ReceiptText, User } from "lucide-react";
import { hapticImpact } from "../lib/telegram.js";
import { tr } from "../lib/i18n.js";

const TABS = [
  { id: "shop", key: "tabShop", Icon: LayoutGrid },
  { id: "keys", key: "tabKeys", Icon: KeyRound },
  { id: "wallet", key: "tabWallet", Icon: Wallet },
  { id: "orders", key: "tabOrders", Icon: ReceiptText },
  { id: "profile", key: "tabProfile", Icon: User },
];

export default function BottomNav({ activeTab, onChange, lang = "vi", pendingOrdersCount = 0 }) {
  return (
    <nav
      aria-label="Điều hướng chính"
      className="fixed bottom-0 inset-x-0 z-40 bg-bg/85 backdrop-blur-2xl border-t border-white/[0.07]"
      style={{ paddingBottom: "var(--safe-bottom, 0px)" }}
    >
      <div className="max-w-lg mx-auto grid grid-cols-5 px-2 h-16">
        {TABS.map(({ id, key, Icon }) => {
          const active = activeTab === id;
          return (
            <button
              key={id}
              type="button"
              aria-current={active ? "page" : undefined}
              onClick={() => {
                if (activeTab !== id) hapticImpact("light");
                onChange(id);
              }}
              className={`relative flex flex-col items-center justify-center gap-1 transition-colors ${
                active ? "text-zinc-100" : "text-zinc-500 hover:text-zinc-300"
              }`}
            >
              <div className="relative">
                <Icon
                  aria-hidden="true"
                  strokeWidth={active ? 2 : 1.65}
                  className="w-[20px] h-[20px]"
                />
                {id === "orders" && pendingOrdersCount > 0 && (
                  <span className="absolute -top-1 -right-2 min-w-[15px] h-[15px] px-1 rounded-full bg-zinc-100 text-zinc-950 text-[10px] font-mono font-semibold flex items-center justify-center">
                    {pendingOrdersCount}
                  </span>
                )}
              </div>
              <span className="text-[11px] font-medium tracking-[-0.01em]">
                {tr(lang, key)}
              </span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
