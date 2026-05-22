const CONFIG = {
  PENDING:   { label: "Chờ xử lý",  cls: "bg-yellow-100 text-yellow-700" },
  PAID:      { label: "Đã thanh toán", cls: "bg-blue-100 text-blue-700" },
  DELIVERED: { label: "Đã giao",     cls: "bg-green-100 text-green-700" },
  CANCELED:  { label: "Đã hủy",      cls: "bg-red-100 text-red-700" },
  DEPOSIT:   { label: "Nạp tiền",    cls: "bg-blue-100 text-blue-700" },
  PURCHASE:  { label: "Thanh toán",  cls: "bg-purple-100 text-purple-700" },
  REFUND:    { label: "Hoàn tiền",   cls: "bg-orange-100 text-orange-700" },
  ADMIN_ADD: { label: "Admin +",     cls: "bg-green-100 text-green-700" },
  ADMIN_DEDUCT: { label: "Admin −",  cls: "bg-red-100 text-red-700" },
};

export default function Badge({ status }) {
  const c = CONFIG[status] || { label: status, cls: "bg-gray-100 text-gray-600" };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${c.cls}`}>
      {c.label}
    </span>
  );
}
