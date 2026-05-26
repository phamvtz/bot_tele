export default function StatsCard({ icon: Icon, label, value, trend, iconBg = "bg-primary-500/20", iconColor = "text-primary-400" }) {
  return (
    <div className="glass rounded-xl p-4 flex items-center gap-3.5 hover:shadow-glow-sm transition-all">
      <div className={`${iconBg} ${iconColor} rounded-xl p-2.5 flex-shrink-0`}>
        <Icon size={18} strokeWidth={2} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-[11px] text-gray-500 font-medium uppercase tracking-wide mb-0.5">{label}</p>
        <p className="text-xl font-bold text-white truncate leading-tight">{value}</p>
        {trend != null && (
          <span className={`text-xs font-semibold ${trend >= 0 ? "text-emerald-400" : "text-red-400"}`}>
            {trend >= 0 ? "▲" : "▼"} {Math.abs(trend)}%
          </span>
        )}
      </div>
    </div>
  );
}
