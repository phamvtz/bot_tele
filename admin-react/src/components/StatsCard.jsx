export default function StatsCard({
  icon: Icon,
  label,
  value,
  trend,
  subtext,
  eyebrow,
  iconBg = "bg-indigo-500/10",
  iconColor = "text-indigo-400",
}) {
  return (
    <div className="bento-card-interactive p-4 relative overflow-hidden flex flex-col justify-between rounded-2xl">
      {/* Top row: Eyebrow + Icon */}
      <div className="flex items-center justify-between mb-2">
        <span className="eyebrow text-slate-400">
          {eyebrow || label}
        </span>
        {Icon && (
          <div className={`w-8 h-8 rounded-xl ${iconBg} ${iconColor} border border-white/10 flex items-center justify-center flex-shrink-0 shadow-sm`}>
            <Icon size={15} strokeWidth={2} />
          </div>
        )}
      </div>

      {/* Middle row: Large tight value */}
      <div className="my-1">
        <p className="text-2xl font-bold text-slate-100 tracking-tight font-display truncate">
          {value ?? "—"}
        </p>
      </div>

      {/* Bottom row: Subtext or Trend badge */}
      {(trend != null || subtext) && (
        <div className="mt-2.5 pt-2 thin-divider flex items-center justify-between text-xs">
          {subtext && (
            <span className="text-[11px] text-slate-400 truncate">{subtext}</span>
          )}
          {trend != null && (
            <span className={`inline-flex items-center gap-1 font-mono text-[10px] font-semibold px-2 py-0.5 rounded-full border ${
              trend >= 0
                ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30"
                : "bg-rose-500/10 text-rose-400 border-rose-500/30"
            }`}>
              {trend >= 0 ? "▲" : "▼"} {Math.abs(trend)}%
            </span>
          )}
        </div>
      )}
    </div>
  );
}
