const CONFIG = {
  PENDING:      { label: "Chờ xử lý",    cls: "bg-amber-50  text-amber-700  border-amber-200",  dot: "bg-amber-400" },
  PAID:         { label: "Đã thanh toán", cls: "bg-blue-50   text-blue-700   border-blue-200",   dot: "bg-blue-400" },
  DELIVERED:    { label: "Đã giao",       cls: "bg-emerald-50 text-emerald-700 border-emerald-200", dot: "bg-emerald-400" },
  CANCELED:     { label: "Đã hủy",        cls: "bg-red-50    text-red-600    border-red-200",    dot: "bg-red-400" },
  DEPOSIT:      { label: "Nạp tiền",      cls: "bg-blue-50   text-blue-700   border-blue-200",   dot: "bg-blue-400" },
  PURCHASE:     { label: "Thanh toán",    cls: "bg-violet-50 text-violet-700 border-violet-200", dot: "bg-violet-400" },
  REFUND:       { label: "Hoàn tiền",     cls: "bg-orange-50 text-orange-700 border-orange-200", dot: "bg-orange-400" },
  ADMIN_ADD:    { label: "Admin +",       cls: "bg-emerald-50 text-emerald-700 border-emerald-200", dot: "bg-emerald-400" },
  ADMIN_DEDUCT: { label: "Admin −",       cls: "bg-red-50    text-red-600    border-red-200",    dot: "bg-red-400" },
};

export default function Badge({ status }) {
  const c = CONFIG[status] || { label: status, cls: "bg-gray-50 text-gray-600 border-gray-200", dot: "bg-gray-400" };
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium border ${c.cls}`}>
      <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${c.dot}`} />
      {c.label}
    </span>
  );
}
