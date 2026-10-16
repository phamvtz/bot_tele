export default function TabFilter({ tabs, active, onChange }) {
  return (
    <div className="inline-flex items-center gap-1 p-1 rounded-xl bg-slate-950/60 border border-slate-800/80 mb-4 max-w-full overflow-x-auto scrollbar-none">
      {tabs.map((tab) => {
        const isActive = active === tab.value;
        return (
          <button
            key={tab.value}
            onClick={() => onChange(tab.value)}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-all cursor-pointer select-none ${
              isActive
                ? "bg-slate-800 text-slate-100 border border-slate-700/80 shadow-sm font-semibold"
                : "text-slate-400 hover:text-slate-200 hover:bg-slate-900/50 border border-transparent"
            }`}
          >
            <span className="tracking-tight">{tab.label}</span>
            {tab.count != null && (
              <span className={`px-1.5 py-0.2 rounded text-[10px] font-mono font-semibold ${
                isActive
                  ? "bg-indigo-500/20 text-indigo-300 border border-indigo-500/30"
                  : "bg-slate-800 text-slate-400 border border-slate-700/50"
              }`}>
                {tab.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
