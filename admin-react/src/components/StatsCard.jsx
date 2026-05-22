export default function StatsCard({ icon: Icon, label, value, trend, iconBg = "bg-primary-100", iconColor = "text-primary-600" }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4 flex items-start gap-3">
      <div className={`${iconBg} ${iconColor} rounded-lg p-2 flex-shrink-0`}>
        <Icon size={20} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-xs text-gray-500 mb-1">{label}</p>
        <p className="text-lg font-semibold text-gray-900 truncate">{value}</p>
        {trend != null && (
          <span className={`text-xs font-medium ${trend >= 0 ? "text-green-600" : "text-red-500"}`}>
            {trend >= 0 ? "+" : ""}{trend}%
          </span>
        )}
      </div>
    </div>
  );
}
