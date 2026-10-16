import { useState } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  LayoutDashboard, Wallet, ShoppingCart, AlertTriangle,
  FolderTree, Package, Ticket, Percent, Archive, Link2,
  Users, KeyRound, Building2, Activity, Gift, Crown,
  Store, CreditCard, Bug, Database, Landmark, Bot, BookOpen,
  Radio, Clock, ScrollText, PartyPopper, Sparkles,
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
      { to: "/promotions",         icon: Ticket,       label: "Mã giảm giá" },
      { to: "/flash-sales",        icon: Zap,          label: "Flash sale" },
      { to: "/giftcodes",          icon: PartyPopper,  label: "Mã quà tặng" },
      { to: "/quantity-discounts", icon: Percent,      label: "Giảm giá số lượng" },
    ],
  },
  {
    section: "NGUỒN HÀNG & API",
    defaultOpen: false,
    items: [
      { to: "/key-orders",      icon: ShoppingCart, label: "Đơn hàng key" },
      { to: "/api-keys",        icon: KeyRound,     label: "Quản lý API key" },
      { to: "/api-key-shop",    icon: Sparkles,     label: "Cấu hình cửa hàng key" },
      { to: "/api-connections", icon: Link2,        label: "Kết nối nhà cung cấp" },
      { to: "/seller-api",      icon: Building2,    label: "API cho đại lý" },
    ],
  },
  {
    section: "KHÁCH & ĐẠI LÝ",
    items: [
      { to: "/customers",         icon: Users,     label: "Người dùng" },
      { to: "/bot/user-activity", icon: Activity,  label: "Hoạt động khách" },
      { to: "/reseller-orders",   icon: Building2, label: "Đơn đại lý" },
      { to: "/system/referral",   icon: Gift,      label: "Mời bạn / Affiliate" },
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
      { to: "/system/sepay",    icon: Bug,        label: "Debug Bank API" },
      { to: "/system/database", icon: Database,   label: "Database" },
    ],
  },
];

function NavItem({ to, icon: Icon, label, exact = false, badge = 0 }) {
  return (
    <NavLink to={to} end={exact} className={({ isActive }) =>
      `relative flex items-center gap-2.5 px-2.5 py-1.5 rounded-xl text-xs mb-0.5 transition-all select-none group ${
        isActive
          ? "bg-slate-800/90 text-white font-medium border border-white/10 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.1)]"
          : "text-slate-400 hover:bg-slate-900/60 hover:text-slate-200 border border-transparent"
      }`
    }>
      {({ isActive }) => (
        <>
          {isActive && (
            <span className="absolute left-0 inset-y-1.5 w-[2px] bg-electric-indigo rounded-r-full shadow-[0_0_8px_rgba(99,102,241,0.8)]" />
          )}
          <Icon size={14} className={`flex-shrink-0 transition-colors ${isActive ? "text-electric-cyan" : "text-slate-500 group-hover:text-slate-300"}`} />
          <span className="truncate flex-1 tracking-tight">{label}</span>
          {badge > 0 && (
            <span className={`flex-shrink-0 min-w-[18px] h-[18px] px-1 inline-flex items-center justify-center rounded-full text-[10px] font-mono font-semibold border ${
              isActive
                ? "bg-indigo-500/20 text-indigo-300 border-indigo-500/30"
                : "bg-rose-500/15 text-rose-400 border-rose-500/30"
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
    <div className="mt-3.5 first:mt-1.5">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between px-2.5 mb-1 group cursor-pointer"
      >
        <span className="text-[10px] font-mono font-semibold text-slate-500 tracking-wider uppercase select-none group-hover:text-slate-400">
          {section}
        </span>
        <ChevronDown
          size={12}
          className={`text-slate-600 transition-transform ${expanded ? "" : "-rotate-90"}`}
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
    <aside className="fixed top-0 left-0 h-screen w-56 bg-[#090d16] border-r border-white/[0.08] flex flex-col z-30">
      {/* Header */}
      <div className="px-3.5 py-3 border-b border-white/[0.08]">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl bg-indigo-500/15 border border-indigo-500/30 flex items-center justify-center flex-shrink-0 text-electric-indigo shadow-sm">
            <Zap size={15} />
          </div>
          <div className="min-w-0">
            <p className="font-semibold text-xs text-slate-100 truncate tracking-tight font-display">{shopName}</p>
            <div className="flex items-center gap-1.5 mt-0.5">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(16,185,129,0.7)] animate-pulse" />
              <p className="text-[10px] font-mono text-slate-400 uppercase tracking-wider">Dev Admin</p>
            </div>
          </div>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto py-2.5 px-2">
        <NavItem to="/" icon={LayoutDashboard} label="Tổng quan" exact />
        {NAV.map((group) => (
          <Section key={group.section} section={group.section} items={group.items} badges={badges} defaultOpen={group.defaultOpen} />
        ))}
      </nav>

      {/* Footer */}
      <div className="px-2.5 py-2.5 border-t border-white/[0.08]">
        <button onClick={logout}
          className="flex items-center gap-2 w-full px-2.5 py-1.5 rounded-xl text-xs text-slate-400 hover:text-rose-400 hover:bg-slate-900/60 border border-transparent hover:border-rose-950/40 transition-colors cursor-pointer">
          <LogOut size={14} />
          <span className="tracking-tight">Đăng xuất</span>
        </button>
      </div>
    </aside>
  );
}
