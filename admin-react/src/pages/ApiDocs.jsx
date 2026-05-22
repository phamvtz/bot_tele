import { FileText } from "lucide-react";

const ENDPOINTS = [
  { method: "GET",  path: "/api/shop/catalog",  desc: "Lấy danh sách sản phẩm đang bán" },
  { method: "POST", path: "/webhook/ipn",        desc: "Webhook xác nhận thanh toán IPN" },
  { method: "GET",  path: "/health",             desc: "Health check server" },
];

export default function ApiDocs() {
  return (
    <div>
      <h1 className="text-xl font-bold text-gray-900 mb-1">Tài liệu API</h1>
      <p className="text-sm text-gray-500 mb-5">Các endpoint công khai của hệ thống</p>

      <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
        {ENDPOINTS.map((ep) => (
          <div key={ep.path} className="flex items-start gap-3 p-3 rounded-lg border border-gray-100">
            <span className={`text-xs font-bold px-2 py-0.5 rounded ${ep.method === "GET" ? "bg-blue-100 text-blue-700" : "bg-orange-100 text-orange-700"}`}>
              {ep.method}
            </span>
            <div>
              <code className="text-sm font-mono text-gray-800">{ep.path}</code>
              <p className="text-xs text-gray-500 mt-0.5">{ep.desc}</p>
            </div>
          </div>
        ))}
        <div className="p-4 bg-gray-50 rounded-xl">
          <p className="text-xs font-medium text-gray-700 mb-2">Xác thực Admin API</p>
          <p className="text-xs text-gray-500">Tất cả request đến <code className="bg-white px-1 rounded border border-gray-200">/api/admin/*</code> cần header:</p>
          <code className="block mt-2 text-xs bg-gray-900 text-green-400 p-3 rounded-lg">x-admin-token: YOUR_ADMIN_SECRET</code>
        </div>
      </div>
    </div>
  );
}
