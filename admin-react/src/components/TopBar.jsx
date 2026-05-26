import { useLocation } from "react-router-dom";
import { Home, Bell } from "lucide-react";

const BREADCRUMBS = {
  "/":                   ["Dashboard"],
  "/products":           ["Cửa hàng", "Sản phẩm"],
  "/categories":         ["Cửa hàng", "Danh mục"],
  "/suppliers":          ["Cửa hàng", "Nhà cung cấp"],
  "/orders":             ["Cửa hàng", "Đơn hàng"],
  "/transactions":       ["Cửa hàng", "Giao dịch"],
  "/customers":          ["Cửa hàng", "Khách hàng"],
  "/promotions":         ["Cửa hàng", "Khuyến mãi"],
  "/api-connections":    ["Cửa hàng", "Kết nối API"],
  "/api-docs":           ["Cửa hàng", "Tài liệu API"],
  "/bot/config":         ["Bot", "Cấu hình"],
  "/bot/logs":           ["Bot", "Nhật ký"],
  "/system/payment":     ["Hệ thống", "Thanh toán"],
  "/system/plans":       ["Hệ thống", "Cấp VIP"],
  "/system/referral":    ["Hệ thống", "Affiliate"],
  "/system/settings":    ["Hệ thống", "Cài đặt"],
};

export default function TopBar() {
  const { pathname } = useLocation();
  const crumbs = BREADCRUMBS[pathname] || ["Admin"];

  return (
    <header className="fixed top-0 left-52 right-0 h-12 bg-[#0f0d1a]/95 backdrop-blur-sm border-b border-[#1e1a2e] flex items-center justify-between px-6 z-20">
      {/* Breadcrumb */}
      <div className="flex items-center gap-1.5 text-xs">
        <Home size={12} className="text-gray-500" />
        {crumbs.map((c, i) => (
          <span key={i} className="flex items-center gap-1.5">
            {i > 0 && <span className="text-gray-700">/</span>}
            <span className={i === crumbs.length - 1 ? "font-semibold text-white" : "text-gray-500"}>
              {c}
            </span>
          </span>
        ))}
      </div>

      {/* Right */}
      <div className="flex items-center gap-1">
        <button className="relative w-8 h-8 flex items-center justify-center rounded-lg text-gray-500 hover:text-gray-200 hover:bg-white/[0.06] transition-colors">
          <Bell size={15} />
          <span className="absolute top-1.5 right-1.5 w-1.5 h-1.5 bg-primary-500 rounded-full" />
        </button>
        <div className="ml-2 w-7 h-7 rounded-full bg-gradient-to-br from-primary-400 to-primary-600 flex items-center justify-center shadow-sm cursor-pointer hover:opacity-90 transition-opacity">
          <span className="text-white text-[10px] font-bold">A</span>
        </div>
      </div>
    </header>
  );
}
