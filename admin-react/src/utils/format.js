export function formatCurrency(amount) {
  if (amount == null) return "0đ";
  const n = Number(amount);
  if (isNaN(n)) return "0đ";
  return new Intl.NumberFormat("vi-VN", { style: "currency", currency: "VND" })
    .format(n)
    .replace("₫", "đ");
}

export function formatDate(date) {
  if (!date) return "—";
  const d = new Date(date);
  // Ngày không parse được (vd API ngân hàng trả định dạng lạ) → trả nguyên chuỗi thay vì
  // để Intl.format throw "Invalid time value" làm trắng cả trang.
  if (isNaN(d.getTime())) return String(date);
  return new Intl.DateTimeFormat("vi-VN", {
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  }).format(d);
}

export function formatDateShort(date) {
  if (!date) return "—";
  const d = new Date(date);
  if (isNaN(d.getTime())) return String(date);
  return new Intl.DateTimeFormat("vi-VN", {
    day: "2-digit", month: "2-digit", year: "numeric",
  }).format(d);
}

export function formatOrderCode(orderId) {
  const value = String(orderId || "").trim();
  return value ? value.slice(-8).toUpperCase() : "—";
}

export function relativeTime(date) {
  if (!date) return "—";
  const t = new Date(date).getTime();
  if (isNaN(t)) return String(date);
  const diff = Date.now() - t;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "vừa xong";
  if (mins < 60) return `${mins} phút trước`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} giờ trước`;
  const days = Math.floor(hrs / 24);
  return `${days} ngày trước`;
}
