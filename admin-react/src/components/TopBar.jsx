import { useLocation } from "react-router-dom";
import { Moon, Globe } from "lucide-react";

const BREADCRUMBS = {
  "/":                   "Dashboard",
  "/products":           "Sản phẩm",
  "/suppliers":          "Nhà cung cấp",
  "/orders":             "Đơn hàng",
  "/transactions":       "Giao dịch",
  "/customers":          "Khách hàng",
  "/promotions":         "Khuyến mãi",
  "/api-connections":    "Kết nối API",
  "/api-docs":           "Tài liệu API",
  "/bot/config":         "Cấu hình Bot",
  "/bot/logs":           "Nhật ký Bot",
  "/system/payment":     "Thanh toán",
  "/system/plans":       "Gói dịch vụ",
  "/system/referral":    "Tiếp thị liên kết",
  "/system/settings":    "Cài đặt",
};

export default function TopBar({ botName = "vplusPre+bot", contactUsername = "" }) {
  const { pathname } = useLocation();
  const crumb = BREADCRUMBS[pathname] || "Admin";

  return (
    <header className="fixed top-0 left-[155px] right-0 h-12 bg-white border-b border-gray-200 flex items-center justify-between px-5 z-20">
      {/* Breadcrumb pill */}
      <div className="flex items-center gap-2">
        <span className="inline-flex items-center gap-1.5 text-xs text-gray-500">
          <span className="w-1.5 h-1.5 rounded-full bg-primary-500 inline-block" />
          {botName}
        </span>
        <span className="text-gray-300">/</span>
        <span className="text-xs font-medium text-gray-900">{crumb}</span>
      </div>

      {/* Right actions */}
      <div className="flex items-center gap-3 text-sm">
        {contactUsername && (
          <span className="text-xs text-gray-500">
            Contact: <span className="text-primary-600 font-medium">@{contactUsername}</span>
          </span>
        )}
        <button className="text-gray-400 hover:text-gray-700 transition-colors">
          <Moon size={16} />
        </button>
        <button className="text-gray-400 hover:text-gray-700 transition-colors flex items-center gap-1 text-xs font-medium">
          <Globe size={14} />
          VN
        </button>
        <div className="w-7 h-7 rounded-full bg-primary-500 flex items-center justify-center">
          <span className="text-white text-xs font-bold">A</span>
        </div>
      </div>
    </header>
  );
}
