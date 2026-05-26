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
  GET:    "bg-blue-100 text-blue-700",
  POST:   "bg-orange-100 text-orange-700",
  PUT:    "bg-yellow-100 text-yellow-700",
  DELETE: "bg-red-100 text-red-600",
};

function Section({ section }) {
  const [open, setOpen] = useState(true);
  return (
    <div className="border border-gray-100 rounded-xl overflow-hidden">
      <button onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between px-4 py-3 bg-gray-50 hover:bg-gray-100 transition-colors text-left">
        <span className="text-sm font-semibold text-gray-800">{section.title}</span>
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-400">{section.endpoints.length} endpoint{section.endpoints.length !== 1 ? "s" : ""}</span>
          {open ? <ChevronDown size={14} className="text-gray-400" /> : <ChevronRight size={14} className="text-gray-400" />}
        </div>
      </button>
      {open && (
        <div className="divide-y divide-gray-50">
          {section.endpoints.map((ep, i) => (
            <div key={i} className="px-4 py-3 hover:bg-gray-50/50 transition-colors">
              <div className="flex items-start gap-3">
                <span className={`text-xs font-bold px-2 py-0.5 rounded flex-shrink-0 mt-0.5 ${METHOD_STYLE[ep.method]}`}>
                  {ep.method}
                </span>
                <div className="flex-1 min-w-0">
                  <code className="text-sm font-mono text-gray-800 break-all">{ep.path}</code>
                  {ep.params && <span className="text-xs text-gray-400 ml-1">{ep.params}</span>}
                  <p className="text-xs text-gray-500 mt-0.5">{ep.desc}</p>
                  {ep.body && (
                    <pre className="mt-2 text-xs bg-gray-900 text-green-400 p-2.5 rounded-lg overflow-x-auto whitespace-pre-wrap break-all">{ep.body}</pre>
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
  return (
    <div>
      <h1 className="text-xl font-bold text-gray-900 mb-1">Tài liệu API</h1>
      <p className="text-sm text-gray-500 mb-5">Tất cả endpoints của hệ thống admin</p>

      <div className="bg-gray-900 text-green-400 rounded-xl p-4 mb-5 text-xs font-mono">
        <p className="text-gray-400 mb-1">// Xác thực — thêm header này vào mọi request admin:</p>
        <p>x-admin-token: <span className="text-yellow-300">YOUR_ADMIN_SECRET</span></p>
        <p className="text-gray-400 mt-2">// Base URL:</p>
        <p>http://your-server:<span className="text-yellow-300">3001</span>/api/admin/...</p>
      </div>

      <div className="space-y-3">
        {SECTIONS.map((s) => (
          <Section key={s.title} section={s} />
        ))}
      </div>
    </div>
  );
}
