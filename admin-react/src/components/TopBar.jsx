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
  "/flash-sales":        ["Cửa hàng", "Flash sale"],
  "/quantity-discounts": ["Cửa hàng", "Giảm giá số lượng"],
  "/reseller-orders":    ["Khách & Đại lý", "Đơn đại lý"],
  "/seller-api":         ["Nguồn hàng & API", "API cho đại lý"],
  "/key-orders":         ["Nguồn hàng & API", "Đơn hàng key"],
  "/api-keys":           ["Nguồn hàng & API", "Quản lý API key"],
  "/api-connections":    ["Nguồn hàng & API", "Kết nối nhà cung cấp"],
  "/api-key-shop":       ["Nguồn hàng & API", "Cửa hàng API key"],
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
  "/system/sepay":       ["Nâng cao", "Debug Bank API"],
  "/system/database":    ["Nâng cao", "Database"],
  "/system/settings":    ["Hệ thống", "Cài đặt chung"],
};

export default function TopBar() {
  const { pathname } = useLocation();
  const crumbs = BREADCRUMBS[pathname] || ["Admin"];
  const { data: botStatus, isLoading: botStatusLoading } = useQuery({
    queryKey: ["bot-status"],
    queryFn: api.botStatus,
    staleTime: 60000,
    refetchInterval: 60000,
    retry: 2,
    placeholderData: (prev) => prev,
  });

  return (
    <header className="fixed top-0 left-56 right-0 h-11 bg-[#090d16]/85 backdrop-blur-md border-b border-white/[0.08] flex items-center justify-between px-5 z-20">
      {/* Breadcrumb with eyebrow & tight letter-spacing */}
      <div className="flex items-center gap-2 text-xs">
        <Home size={13} className="text-slate-500" />
        <span className="text-slate-600">/</span>
        {crumbs.map((c, i) => (
          <span key={i} className="flex items-center gap-2">
            {i > 0 && <span className="text-slate-600">/</span>}
            <span className={
              i === crumbs.length - 1
                ? "font-semibold text-slate-100 tracking-tight font-display text-[13px]"
                : "text-[11px] font-mono uppercase tracking-wider text-slate-400"
            }>
              {c}
            </span>
          </span>
        ))}
      </div>

      {/* Center - Quick Command Palette Indicator (Linear Style) */}
      <div className="hidden md:flex items-center gap-2 px-2.5 py-1 rounded-lg bg-slate-900/70 border border-white/[0.08] text-[11px] text-slate-400">
        <span className="text-slate-400">Quick search</span>
        <kbd className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-200 border border-white/10 font-semibold shadow-sm">⌘K</kbd>
      </div>

      {/* Right - Dev-tools status badge */}
      <div className="flex items-center gap-3">
        <div
          className="flex items-center gap-2 px-3 py-1 rounded-full bg-slate-900/70 border border-white/[0.08] text-xs font-mono select-none shadow-sm"
          title={botStatus?.reason || "Trạng thái Telegram bot"}>
          <Bot size={13} className={botStatus?.online ? "text-emerald-400" : "text-slate-500"} />
          <span className="text-slate-300 text-[11px] tracking-tight">
            {botStatusLoading ? "checking..." : botStatus?.online ? `@${botStatus.username || "Bot"}` : "offline"}
          </span>
          <span className={`w-1.5 h-1.5 rounded-full ${botStatus?.online ? "bg-emerald-400 shadow-[0_0_8px_rgba(16,185,129,0.7)] animate-pulse" : "bg-slate-600"}`} />
        </div>
      </div>
    </header>
  );
}
