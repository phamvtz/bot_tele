import { NavLink, useNavigate } from "react-router-dom";
import {
  LayoutDashboard, Package, FolderOpen, Truck, ShoppingCart, ArrowLeftRight,
  Users, Tag, Link2, FileText, Settings, CreditCard, Crown,
  Share2, Bot, ScrollText, LogOut, Store
} from "lucide-react";

const NAV = [
  {
    section: "CỬA HÀNG",
    items: [
      { to: "/products",        icon: Package,        label: "Sản phẩm" },
      { to: "/categories",      icon: FolderOpen,     label: "Danh mục" },
      { to: "/suppliers",       icon: Truck,          label: "Nhà cung cấp" },
      { to: "/orders",          icon: ShoppingCart,   label: "Đơn hàng" },
      { to: "/transactions",    icon: ArrowLeftRight, label: "Giao dịch" },
      { to: "/customers",       icon: Users,          label: "Khách hàng" },
      { to: "/promotions",      icon: Tag,            label: "Khuyến mãi" },
      { to: "/api-connections", icon: Link2,          label: "Kết nối API" },
      { to: "/api-docs",        icon: FileText,       label: "Tài liệu API" },
    ],
  },
  {
    section: "TELEGRAM BOT",
    items: [
      { to: "/bot/config", icon: Bot,        label: "Cấu hình Bot" },
      { to: "/bot/logs",   icon: ScrollText, label: "Nhật ký Bot" },
    ],
  },
  {
    section: "HỆ THỐNG",
    items: [
      { to: "/system/payment",  icon: CreditCard, label: "Thanh toán" },
      { to: "/system/plans",    icon: Crown,      label: "Cấp VIP" },
      { to: "/system/referral", icon: Share2,     label: "Affiliate" },
      { to: "/system/settings", icon: Settings,   label: "Cài đặt" },
    ],
  },
];

function NavItem({ to, icon: Icon, label, exact = false }) {
  return (
    <NavLink to={to} end={exact} className={({ isActive }) =>
      `relative flex items-center gap-2.5 px-3 py-[7px] rounded-lg text-sm mb-px transition-all select-none ${
        isActive
          ? "bg-white/[0.08] text-white font-semibold"
          : "text-gray-400 hover:bg-white/[0.05] hover:text-gray-100"
      }`
    }>
      {({ isActive }) => (
        <>
          {isActive && (
            <span className="absolute left-0 inset-y-0 w-[3px] bg-primary-500 rounded-full my-1 -ml-[1px]" />
          )}
          <Icon size={15} className="flex-shrink-0" />
          <span className="truncate">{label}</span>
        </>
      )}
    </NavLink>
  );
}

export default function Sidebar({ shopName = "mortal Shop" }) {
  const navigate = useNavigate();
  const initials = (shopName || "MS").slice(0, 2).toUpperCase();

  function logout() {
    localStorage.removeItem("admin_token");
    navigate("/login", { replace: true });
  }

  return (
    <aside className="fixed top-0 left-0 h-screen w-52 bg-[#0f0d1a] border-r border-[#1e1a2e] flex flex-col z-30">
      {/* Logo */}
      <div className="px-4 py-4 border-b border-[#1e1a2e]">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-primary-500 to-primary-700 flex items-center justify-center flex-shrink-0 shadow-sm">
            <Store size={14} className="text-white" />
          </div>
          <div className="min-w-0">
            <p className="font-semibold text-sm text-white truncate leading-tight">{shopName}</p>
            <p className="text-[10px] text-primary-400 font-medium tracking-wide">ADMIN PANEL</p>
          </div>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto py-3 px-2.5">
        <NavItem to="/" icon={LayoutDashboard} label="Dashboard" exact />

        {NAV.map((group) => (
          <div key={group.section} className="mt-5 first:mt-3">
            <p className="px-3 text-[9px] font-bold text-gray-600 tracking-[0.15em] uppercase mb-1.5 select-none">
              {group.section}
            </p>
            {group.items.map(({ to, icon, label }) => (
              <NavItem key={to} to={to} icon={icon} label={label} />
            ))}
          </div>
        ))}
      </nav>

      {/* Footer */}
      <div className="px-3 py-3 border-t border-[#1e1a2e]">
        <div className="flex items-center gap-2.5 px-2 py-1.5 rounded-lg mb-1">
          <div className="w-6 h-6 rounded-full bg-gradient-to-br from-primary-400 to-primary-600 flex items-center justify-center flex-shrink-0 shadow-sm">
            <span className="text-white font-bold text-[9px]">{initials}</span>
          </div>
          <span className="text-xs text-gray-300 font-medium truncate flex-1">Admin</span>
        </div>
        <button onClick={logout}
          className="flex items-center gap-2 w-full px-2 py-1.5 rounded-lg text-xs text-gray-500 hover:text-red-400 hover:bg-white/[0.05]">
          <LogOut size={13} />
          <span>Đăng xuất</span>
        </button>
      </div>
    </aside>
  );
}
