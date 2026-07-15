import { useState } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  LayoutDashboard, Wallet, ShoppingCart, AlertTriangle,
  FolderTree, Package, Ticket, Percent, Archive, Link2,
  Users, KeyRound, Building2, Activity, Gift, Crown,
  Store, CreditCard, Bug, Database, Landmark, Bot, BookOpen,
  Radio, Clock, ScrollText,
  LogOut, ChevronDown, Zap,
} from "lucide-react";
import { api } from "../api/endpoints";

const NAV = [
  {
    section: "GIAO DỊCH",
    items: [
      { to: "/transactions", icon: Wallet,        label: "Giao dịch ví" },
      { to: "/orders",       icon: ShoppingCart,  label: "Đơn hàng" },
      { to: "/complaints",   icon: AlertTriangle, label: "Khiếu nại", badge: "complaints" },
    ],
  },
  {
    section: "CỬA HÀNG",
    items: [
      { to: "/categories",         icon: FolderTree, label: "Danh mục" },
      { to: "/products",           icon: Package,    label: "Sản phẩm" },
      { to: "/stock",              icon: Archive,    label: "Nhập kho" },
      { to: "/promotions",         icon: Ticket,     label: "Mã giảm giá" },
      { to: "/quantity-discounts", icon: Percent,    label: "Giảm giá số lượng" },
    ],
  },
  {
    section: "NGUỒN HÀNG & API",
    defaultOpen: false,
    items: [
      { to: "/api-connections", icon: Link2,    label: "Kết nối nhà cung cấp" },
      { to: "/seller-api",      icon: KeyRound, label: "API cho đại lý" },
    ],
  },
  {
    section: "KHÁCH & ĐẠI LÝ",
    items: [
      { to: "/customers",         icon: Users,     label: "Người dùng" },
      { to: "/bot/user-activity", icon: Activity,  label: "Hoạt động khách" },
      { to: "/reseller-orders",   icon: Building2, label: "Đơn đại lý" },
      { to: "/system/referral",   icon: Gift,      label: "Affiliate / CTV" },
      { to: "/system/plans",      icon: Crown,     label: "Cấp VIP" },
    ],
  },
  {
    section: "VẬN HÀNH BOT",
    defaultOpen: false,
    items: [
      { to: "/bot/config",    icon: Bot,        label: "Cấu hình bot" },
      { to: "/bot/broadcast", icon: Radio,      label: "Gửi tin hàng loạt" },
      { to: "/bot/schedule",  icon: Clock,      label: "Lịch gửi tin" },
      { to: "/bot/logs",      icon: ScrollText, label: "Nhật ký quản trị" },
    ],
  },
  {
    section: "HỆ THỐNG",
    items: [
      { to: "/system/settings", icon: Store,      label: "Cài đặt chung" },
      { to: "/system/payment",  icon: CreditCard, label: "Thanh toán" },
      { to: "/system/bank",     icon: Landmark,   label: "Theo dõi ngân hàng" },
    ],
  },
  {
    section: "NÂNG CAO",
    defaultOpen: false,
    items: [
      { to: "/api-docs",        icon: BookOpen, label: "Tài liệu API" },
      { to: "/system/sepay",    icon: Bug,        label: "SePay Debug" },
      { to: "/system/database", icon: Database,   label: "Database" },
    ],
  },
];

function NavItem({ to, icon: Icon, label, exact = false, badge = 0 }) {
  return (
    <NavLink to={to} end={exact} className={({ isActive }) =>
      `relative flex items-center gap-3 px-3 py-2 rounded-xl text-sm mb-0.5 transition-all select-none ${
        isActive
          ? "bg-gradient-to-r from-primary-500 to-primary-700 text-white font-semibold shadow-glow-sm"
          : "text-gray-400 hover:bg-white/[0.05] hover:text-gray-100"
      }`
    }>
      {({ isActive }) => (
        <>
          {isActive && (
            <span className="absolute -left-2.5 inset-y-0 w-[3px] bg-primary-400 rounded-full my-1.5" />
          )}
          <Icon size={16} className="flex-shrink-0" />
          <span className="truncate flex-1">{label}</span>
          {badge > 0 && (
            <span className={`flex-shrink-0 min-w-[18px] h-[18px] px-1 inline-flex items-center justify-center rounded-full text-[10px] font-bold ${
              isActive ? "bg-white/25 text-white" : "bg-red-500 text-white"
            }`}>
              {badge > 99 ? "99+" : badge}
            </span>
          )}
        </>
      )}
    </NavLink>
  );
}

function Section({ section, items, badges, defaultOpen = true }) {
  const { pathname } = useLocation();
  const hasActiveItem = items.some((item) => pathname === item.to);
  const [open, setOpen] = useState(defaultOpen);
  const expanded = open || hasActiveItem;
  return (
    <div className="mt-4 first:mt-2">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between px-3 mb-1.5 group"
      >
        <span className="text-[10px] font-bold text-gray-600 tracking-[0.14em] uppercase select-none group-hover:text-gray-500">
          {section}
        </span>
        <ChevronDown
          size={13}
          className={`text-gray-600 transition-transform ${expanded ? "" : "-rotate-90"}`}
        />
      </button>
      {expanded && items.map(({ to, icon, label, badge }) => (
        <NavItem key={to} to={to} icon={icon} label={label} badge={badge ? badges?.[badge] || 0 : 0} />
      ))}
    </div>
  );
}

export default function Sidebar({ shopName = "Vplus Shop" }) {
  const navigate = useNavigate();

  // Badge counts — gracefully degrade if endpoint chưa có (react-query trả undefined)
  const { data: badges } = useQuery({
    queryKey: ["sidebar-badges"],
    queryFn: api.sidebarBadges,
    refetchInterval: 30000,
    retry: false,
  });

  function logout() {
    localStorage.removeItem("admin_token");
    navigate("/login", { replace: true });
  }

  return (
    <aside className="fixed top-0 left-0 h-screen w-56 bg-[#0c0a15] border-r border-white/[0.07] flex flex-col z-30">
      {/* Header */}
      <div className="px-4 py-4 border-b border-white/[0.07]">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-primary-500 to-primary-700 flex items-center justify-center flex-shrink-0 shadow-glow-sm">
            <Zap size={18} className="text-white" />
          </div>
          <div className="min-w-0">
            <p className="font-semibold text-sm text-white truncate leading-tight">{shopName}</p>
            <div className="flex items-center gap-1.5 mt-0.5">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              <p className="text-[11px] text-gray-500">Bảng điều khiển Admin</p>
            </div>
          </div>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto py-3 px-3">
        <NavItem to="/" icon={LayoutDashboard} label="Tổng quan" exact />
        {NAV.map((group) => (
          <Section key={group.section} section={group.section} items={group.items} badges={badges} defaultOpen={group.defaultOpen} />
        ))}
      </nav>

      {/* Footer */}
      <div className="px-3 py-3 border-t border-white/[0.07]">
        <button onClick={logout}
          className="flex items-center gap-2.5 w-full px-3 py-2 rounded-xl text-sm text-gray-400 hover:text-red-400 hover:bg-white/[0.05] transition-colors">
          <LogOut size={16} />
          <span>Đăng xuất</span>
        </button>
      </div>
    </aside>
  );
}
