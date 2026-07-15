import { useLocation } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Home, Bot } from "lucide-react";
import { api } from "../api/endpoints";

const BREADCRUMBS = {
  "/":                   ["Tổng quan"],
  "/products":           ["Cửa hàng", "Sản phẩm"],
  "/categories":         ["Cửa hàng", "Danh mục"],
  "/orders":             ["Giao dịch", "Đơn hàng"],
  "/transactions":       ["Giao dịch", "Giao dịch ví"],
  "/complaints":         ["Giao dịch", "Khiếu nại"],
  "/customers":          ["Khách & Đại lý", "Người dùng"],
  "/promotions":         ["Cửa hàng", "Mã giảm giá"],
  "/quantity-discounts": ["Cửa hàng", "Giảm giá số lượng"],
  "/reseller-orders":    ["Khách & Đại lý", "Đơn đại lý"],
  "/seller-api":         ["Nguồn hàng & API", "API cho đại lý"],
  "/api-connections":    ["Nguồn hàng & API", "Kết nối nhà cung cấp"],
  "/stock":              ["Cửa hàng", "Nhập kho"],
  "/api-docs":           ["Nâng cao", "Tài liệu API"],
  "/bot/config":         ["Vận hành Bot", "Cấu hình bot"],
  "/bot/broadcast":      ["Vận hành Bot", "Gửi tin hàng loạt"],
  "/bot/schedule":       ["Vận hành Bot", "Lịch gửi tin"],
  "/bot/logs":           ["Vận hành Bot", "Nhật ký quản trị"],
  "/bot/user-activity":  ["Khách & Đại lý", "Hoạt động khách"],
  "/system/payment":     ["Hệ thống", "Thanh toán"],
  "/system/plans":       ["Khách & Đại lý", "Cấp VIP"],
  "/system/referral":    ["Khách & Đại lý", "Affiliate / CTV"],
  "/system/bank":        ["Hệ thống", "Theo dõi ngân hàng"],
  "/system/sepay":       ["Nâng cao", "SePay Debug"],
  "/system/database":    ["Nâng cao", "Database"],
  "/system/settings":    ["Hệ thống", "Cài đặt chung"],
};

export default function TopBar() {
  const { pathname } = useLocation();
  const crumbs = BREADCRUMBS[pathname] || ["Admin"];
  const { data: botStatus, isLoading: botStatusLoading } = useQuery({
    queryKey: ["bot-status"],
    queryFn: api.botStatus,
    staleTime: 30000,
    refetchInterval: 60000,
    retry: false,
  });

  return (
    <header className="fixed top-0 left-56 right-0 h-12 bg-[#0c0a15]/80 backdrop-blur-md border-b border-white/[0.06] flex items-center justify-between px-6 z-20">
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
      <div className="flex items-center gap-2 text-xs text-gray-400" title={botStatus?.reason || "Trạng thái Telegram bot"}>
        <Bot size={15} className={botStatus?.online ? "text-emerald-400" : "text-gray-500"} />
        <span>{botStatusLoading ? "Đang kiểm tra bot..." : botStatus?.online ? `@${botStatus.username || "Bot"}` : "Bot offline"}</span>
        <span className={`w-1.5 h-1.5 rounded-full ${botStatus?.online ? "bg-emerald-400" : "bg-gray-600"}`} />
      </div>
    </header>
  );
}
