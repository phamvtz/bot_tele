import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";

const SECTIONS = [
  {
    title: "Sản phẩm",
    endpoints: [
      { method: "GET",    path: "/api/admin/products",          desc: "Lấy danh sách sản phẩm", params: "?page=1&limit=20&search=&status=all" },
      { method: "POST",   path: "/api/admin/products",          desc: "Tạo sản phẩm mới", body: '{ "name": "...", "price": 50000, "deliveryMode": "TEXT", "payload": "...", "categoryId": "..." }' },
      { method: "PUT",    path: "/api/admin/products/:id",      desc: "Cập nhật sản phẩm" },
      { method: "DELETE", path: "/api/admin/products/:id",      desc: "Xóa (ẩn) sản phẩm" },
      { method: "PUT",    path: "/api/admin/products/:id/toggle-active", desc: "Bật/tắt hiển thị sản phẩm" },
    ],
  },
  {
    title: "Danh mục",
    endpoints: [
      { method: "GET",    path: "/api/admin/categories",        desc: "Lấy tất cả danh mục" },
      { method: "POST",   path: "/api/admin/categories",        desc: "Tạo danh mục mới", body: '{ "name": "...", "icon": "📦", "description": "..." }' },
      { method: "PUT",    path: "/api/admin/categories/:id",    desc: "Cập nhật danh mục" },
      { method: "DELETE", path: "/api/admin/categories/:id",    desc: "Xóa danh mục" },
    ],
  },
  {
    title: "Đơn hàng",
    endpoints: [
      { method: "GET",  path: "/api/admin/orders",              desc: "Lấy danh sách đơn hàng", params: "?status=PAID&page=1&limit=20" },
      { method: "GET",  path: "/api/admin/orders/:id",          desc: "Chi tiết một đơn hàng" },
      { method: "PUT",  path: "/api/admin/orders/:id/status",   desc: "Cập nhật trạng thái đơn", body: '{ "status": "DELIVERED" }' },
    ],
  },
  {
    title: "Khách hàng",
    endpoints: [
      { method: "GET", path: "/api/admin/users",                desc: "Danh sách khách hàng", params: "?search=&sort=newest&page=1&limit=20" },
      { method: "GET", path: "/api/admin/users/:id",            desc: "Chi tiết khách hàng" },
      { method: "PUT", path: "/api/admin/users/:id/wallet",     desc: "Nạp/trừ ví khách", body: '{ "amount": 50000, "note": "Nạp thủ công" }' },
      { method: "PUT", path: "/api/admin/users/:id/block",      desc: "Block/unblock khách" },
    ],
  },
  {
    title: "Giao dịch",
    endpoints: [
      { method: "GET", path: "/api/admin/transactions",         desc: "Lịch sử giao dịch", params: "?type=DEPOSIT&page=1&limit=20&search=" },
    ],
  },
  {
    title: "Coupon",
    endpoints: [
      { method: "GET",    path: "/api/admin/coupons",           desc: "Danh sách coupon" },
      { method: "POST",   path: "/api/admin/coupons",           desc: "Tạo coupon", body: '{ "code": "SALE10", "discountType": "PERCENT", "discountValue": 10, "maxUses": 100 }' },
      { method: "PUT",    path: "/api/admin/coupons/:id",       desc: "Cập nhật coupon" },
      { method: "DELETE", path: "/api/admin/coupons/:id",       desc: "Xóa coupon" },
    ],
  },
  {
    title: "Cài đặt",
    endpoints: [
      { method: "GET", path: "/api/admin/settings",             desc: "Lấy tất cả settings" },
      { method: "PUT", path: "/api/admin/settings",             desc: "Cập nhật settings", body: '{ "SHOP_NAME": "...", "WELCOME_GREETING": "..." }' },
    ],
  },
  {
    title: "VIP Levels",
    endpoints: [
      { method: "GET", path: "/api/admin/vip-levels",           desc: "Danh sách cấp VIP" },
      { method: "PUT", path: "/api/admin/vip-levels/:id",       desc: "Cập nhật cấp VIP", body: '{ "name": "Vàng", "minSpend": 500000, "discountPercent": 5 }' },
    ],
  },
  {
    title: "API Providers",
    endpoints: [
      { method: "GET",    path: "/api/admin/api-providers",                     desc: "Danh sách API providers" },
      { method: "POST",   path: "/api/admin/api-providers",                     desc: "Thêm API provider" },
      { method: "PUT",    path: "/api/admin/api-providers/:id",                 desc: "Cập nhật API provider" },
      { method: "DELETE", path: "/api/admin/api-providers/:id",                 desc: "Xóa API provider" },
      { method: "POST",   path: "/api/admin/api-providers/:id/fetch-products",  desc: "Lấy danh sách sản phẩm từ provider" },
      { method: "POST",   path: "/api/admin/api-providers/:id/import",          desc: "Import sản phẩm từ provider vào shop" },
    ],
  },
  {
    title: "Stock",
    endpoints: [
      { method: "GET",    path: "/api/admin/stock-items",                   desc: "Lấy stock items", params: "?productId=&sold=false&page=1" },
      { method: "POST",   path: "/api/admin/stock-items/bulk",              desc: "Thêm nhiều stock dòng", body: '{ "productId": "...", "lines": "user1:pass1\\nuser2:pass2" }' },
      { method: "DELETE", path: "/api/admin/stock-items/:id",               desc: "Xóa một stock item" },
      { method: "DELETE", path: "/api/admin/products/:id/stock-unsold",     desc: "Xóa tất cả stock chưa bán của sản phẩm" },
    ],
  },
  {
    title: "Thống kê & Logs",
    endpoints: [
      { method: "GET", path: "/api/admin/stats",                desc: "Thống kê tổng quan (dashboard)" },
      { method: "GET", path: "/api/admin/bot-status",           desc: "Trạng thái bot online/offline" },
      { method: "GET", path: "/api/admin/audit-logs",           desc: "Nhật ký hành động admin", params: "?page=1&limit=20" },
      { method: "GET", path: "/api/admin/referral-stats",       desc: "Thống kê hoa hồng giới thiệu" },
    ],
  },
  {
    title: "Public API",
    endpoints: [
      { method: "GET",  path: "/api/shop/catalog",   desc: "Catalog sản phẩm (không cần auth)" },
      { method: "POST", path: "/webhook/ipn",         desc: "Webhook xác nhận thanh toán IPN" },
      { method: "GET",  path: "/health",              desc: "Health check server" },
    ],
  },
];

const METHOD_STYLE = {
  GET:    "bg-cyan-950/60 text-cyan-300 border-cyan-800/50",
  POST:   "bg-emerald-950/60 text-emerald-300 border-emerald-800/50",
  PUT:    "bg-amber-950/60 text-amber-300 border-amber-800/50",
  DELETE: "bg-rose-950/60 text-rose-300 border-rose-800/50",
};

function Section({ section }) {
  const [open, setOpen] = useState(true);
  return (
    <div className="bento-card overflow-hidden">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between px-4 py-3 bg-slate-900/60 hover:bg-slate-800/40 transition-colors text-left border-b border-slate-800/60 cursor-pointer"
      >
        <span className="text-xs font-mono font-semibold text-slate-200 tracking-wide">{section.title}</span>
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-mono text-slate-400 bg-slate-800 px-2 py-0.5 rounded border border-slate-700/60">
            {section.endpoints.length} ENDPOINTS
          </span>
          {open ? <ChevronDown size={14} className="text-slate-400" /> : <ChevronRight size={14} className="text-slate-400" />}
        </div>
      </button>
      {open && (
        <div className="divide-y divide-slate-800/50">
          {section.endpoints.map((ep, i) => (
            <div key={i} className="px-4 py-3 hover:bg-slate-800/25 transition-colors">
              <div className="flex items-start gap-3">
                <span className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded border flex-shrink-0 mt-0.5 ${METHOD_STYLE[ep.method]}`}>
                  {ep.method}
                </span>
                <div className="flex-1 min-w-0">
                  <code className="text-xs font-mono text-indigo-300 font-medium break-all">{ep.path}</code>
                  {ep.params && <span className="text-[11px] font-mono text-slate-400 ml-1.5">{ep.params}</span>}
                  <p className="text-xs text-slate-400 mt-1 tracking-tight">{ep.desc}</p>
                  {ep.body && (
                    <pre className="mt-2 text-xs bg-[#050811] border border-slate-800/80 text-emerald-400 p-2.5 rounded font-mono overflow-x-auto whitespace-pre-wrap break-all">
                      {ep.body}
                    </pre>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function ApiDocs() {
  const totalEndpoints = SECTIONS.reduce((acc, s) => acc + s.endpoints.length, 0);

  return (
    <div className="space-y-4 pb-10">
      {/* Header */}
      <div>
        <div className="flex items-center gap-2 mb-1">
          <span className="eyebrow text-slate-400">DEVELOPER // REST API SPECIFICATION</span>
          <span className="w-1 h-1 rounded-full bg-slate-600" />
          <span className="text-[10px] font-mono text-indigo-400">V1 DOCUMENTATION</span>
        </div>
        <h1 className="text-xl font-bold text-slate-100 tracking-tight flex items-center gap-2">
          Tài liệu API
          <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-indigo-500/10 text-indigo-300 border border-indigo-500/25">
            {totalEndpoints} ENDPOINTS
          </span>
        </h1>
        <p className="text-xs text-slate-400 mt-0.5 tracking-tight">
          Toàn bộ đặc tả các endpoint quản trị và tích hợp hệ thống
        </p>
      </div>

      {/* Auth Banner */}
      <div className="bento-card bg-[#050811] border-slate-800/90 text-xs font-mono p-4 space-y-1">
        <p className="text-slate-500">// Header xác thực — bắt buộc kèm trong mọi HTTP request quản trị:</p>
        <p className="text-slate-200">
          x-admin-token: <span className="text-amber-400">YOUR_ADMIN_SECRET</span>
        </p>
        <p className="text-slate-500 pt-2">// Base URL:</p>
        <p className="text-slate-200">
          http://your-server:<span className="text-amber-400">3001</span>/api/admin/...
        </p>
      </div>

      {/* Sections */}
      <div className="space-y-3">
        {SECTIONS.map((s) => (
          <Section key={s.title} section={s} />
        ))}
      </div>
    </div>
  );
}
