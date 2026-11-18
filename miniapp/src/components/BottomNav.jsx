import React from "react";
import { Store, KeyRound, Wallet, PackageCheck, UserCheck } from "lucide-react";
import { hapticImpact } from "../lib/telegram.js";
import { tr } from "../lib/i18n.js";

const TABS = [
  { id: "shop", key: "tabShop", Icon: Store },
  { id: "keys", key: "tabKeys", Icon: KeyRound },
  { id: "wallet", key: "tabWallet", Icon: Wallet },
  { id: "orders", key: "tabOrders", Icon: PackageCheck },
  { id: "profile", key: "tabProfile", Icon: UserCheck },
];

export default function BottomNav({ activeTab, onChange, lang = "vi", pendingOrdersCount = 0 }) {
  return (
    <nav
      className="fixed bottom-0 inset-x-0 z-40 bg-canvas-900/90 backdrop-blur-xl border-t border-white/10"
      style={{ paddingBottom: "var(--safe-bottom, 0px)" }}
    >
      <div className="max-w-lg mx-auto grid grid-cols-5 px-1.5 py-1.5">
        {TABS.map(({ id, key, Icon }) => {
          const active = activeTab === id;
          return (
            <button
              key={id}
              type="button"
              onClick={() => {
                if (activeTab !== id) hapticImpact("light");
                onChange(id);
              }}
              className={`relative flex flex-col items-center justify-center py-1.5 rounded-xl transition-all ${
                active ? "text-indigo-400" : "text-slate-400 hover:text-slate-200"
              }`}
            >
              {active && (
                <span className="absolute inset-x-3 top-0 h-0.5 rounded-full bg-indigo-400 shadow-[0_0_10px_#818cf8]" />
              )}
              <div className="relative">
                <Icon className={`w-5 h-5 ${active ? "stroke-[2.4]" : "stroke-[1.9]"}`} />
                {id === "orders" && pendingOrdersCount > 0 && (
                  <span className="absolute -top-1 -right-2 min-w-[16px] h-4 px-1 rounded-full bg-amber-500 text-canvas-950 text-[10px] font-bold flex items-center justify-center">
                    {pendingOrdersCount}
                  </span>
                )}
              </div>
              <span className="text-[11px] font-semibold mt-1 tracking-tight">
                {tr(lang, key)}
              </span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
