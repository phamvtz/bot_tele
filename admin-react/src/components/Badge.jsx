const CONFIG = {
  PENDING:      { label: "Chờ xử lý",    cls: "bg-amber-950/60  text-amber-300  border-amber-800/50",   dot: "bg-amber-400" },
  PAID:         { label: "Đã thanh toán", cls: "bg-blue-950/60   text-blue-300   border-blue-800/50",    dot: "bg-blue-400" },
  DELIVERED:    { label: "Đã giao",       cls: "bg-emerald-950/60 text-emerald-300 border-emerald-800/50", dot: "bg-emerald-400" },
  CANCELED:     { label: "Đã hủy",        cls: "bg-red-950/60    text-red-400    border-red-800/50",     dot: "bg-red-400" },
  DEPOSIT:      { label: "Nạp tiền",      cls: "bg-sky-950/60    text-sky-300    border-sky-800/50",     dot: "bg-sky-400" },
  PURCHASE:     { label: "Thanh toán",    cls: "bg-violet-950/60 text-violet-300 border-violet-800/50",  dot: "bg-violet-400" },
  REFUND:       { label: "Hoàn tiền",     cls: "bg-orange-950/60 text-orange-300 border-orange-800/50",  dot: "bg-orange-400" },
  ADMIN_ADD:    { label: "Admin +",       cls: "bg-emerald-950/60 text-emerald-300 border-emerald-800/50", dot: "bg-emerald-400" },
  ADMIN_DEDUCT: { label: "Admin −",       cls: "bg-red-950/60    text-red-400    border-red-800/50",     dot: "bg-red-400" },
};

export default function Badge({ status }) {
  const c = CONFIG[status] || { label: status, cls: "bg-white/[0.06] text-gray-400 border-white/[0.1]", dot: "bg-gray-500" };
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium border ${c.cls}`}>
      <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${c.dot}`} />
      {c.label}
    </span>
  );
}
