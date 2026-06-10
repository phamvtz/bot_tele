import { useLocation } from "react-router-dom";
import { Home, Bell } from "lucide-react";

const BREADCRUMBS = {
  "/":                   ["Tổng quan"],
  "/products":           ["Cửa hàng", "Sản phẩm"],
  "/categories":         ["Cửa hàng", "Danh mục"],
  "/suppliers":          ["Cửa hàng", "Nhà cung cấp"],
  "/orders":             ["Giao dịch", "Đơn hàng"],
  "/transactions":       ["Giao dịch", "Nạp tiền"],
  "/complaints":         ["Giao dịch", "Khiếu nại"],
  "/customers":          ["Khách & Đại lý", "Người dùng"],
  "/promotions":         ["Cửa hàng", "Mã giảm giá"],
  "/quantity-discounts": ["Cửa hàng", "Giảm giá số lượng"],
  "/reseller-orders":    ["Khách & Đại lý", "Đơn đại lý"],
  "/seller-api":         ["Khách & Đại lý", "Reseller (API)"],
  "/api-connections":    ["Cửa hàng", "Kết nối API"],
  "/stock":              ["Cửa hàng", "Nhập kho"],
  "/api-docs":           ["Cửa hàng", "Tài liệu API"],
  "/bot/config":         ["Bot", "Cấu hình"],
  "/bot/broadcast":      ["Tin nhắn Bot", "Gửi tin hàng loạt"],
  "/bot/schedule":       ["Tin nhắn Bot", "Lịch gửi tin"],
  "/bot/logs":           ["Tin nhắn Bot", "Lịch sử gửi tin"],
  "/bot/user-activity":  ["Khách & Đại lý", "Hoạt động người dùng"],
  "/system/payment":     ["Hệ thống", "Thanh toán"],
  "/system/plans":       ["Hệ thống", "Cấp VIP"],
  "/system/referral":    ["Hệ thống", "Affiliate"],
  "/system/bank":        ["Hệ thống", "Bank Monitor"],
  "/system/sepay":       ["Hệ thống", "SePay Debug"],
  "/system/database":    ["Hệ thống", "Database"],
  "/system/settings":    ["Hệ thống", "Cấu hình shop"],
};

export default function TopBar() {
  const { pathname } = useLocation();
  const crumbs = BREADCRUMBS[pathname] || ["Admin"];

  return (
    <header className="fixed top-0 left-52 right-0 h-12 bg-[#0c0a15]/80 backdrop-blur-md border-b border-white/[0.06] flex items-center justify-between px-6 z-20">
      {/* Breadcrumb */}
      <div className="flex items-center gap-1.5 text-xs">
        <Home size={12} className="text-gray-500" />
        {crumbs.map((c, i) => (
          <span key={i} className="flex items-center gap-1.5">
            {i > 0 && <span className="text-gray-600">/</span>}
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
