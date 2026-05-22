import { NavLink, useNavigate } from "react-router-dom";
import {
  LayoutDashboard, Package, Truck, ShoppingCart, ArrowLeftRight,
  Users, Tag, Link2, FileText, Settings, CreditCard, Crown,
  Share2, Bot, ScrollText, ChevronDown, LogOut, Store
} from "lucide-react";

const NAV = [
  { to: "/", icon: LayoutDashboard, label: "Dashboard", exact: true },
  {
    section: "CỬA HÀNG",
    items: [
      { to: "/products",        icon: Package,       label: "Sản phẩm" },
      { to: "/suppliers",       icon: Truck,         label: "Nhà cung cấp" },
      { to: "/orders",          icon: ShoppingCart,  label: "Đơn hàng" },
      { to: "/transactions",    icon: ArrowLeftRight,label: "Giao dịch" },
      { to: "/customers",       icon: Users,         label: "Khách hàng" },
      { to: "/promotions",      icon: Tag,           label: "Khuyến mãi" },
      { to: "/api-connections", icon: Link2,         label: "Kết nối API" },
      { to: "/api-docs",        icon: FileText,      label: "Tài liệu API" },
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
      { to: "/system/plans",    icon: Crown,      label: "Gói dịch vụ" },
      { to: "/system/referral", icon: Share2,     label: "Tiếp thị liên kết" },
      { to: "/system/settings", icon: Settings,   label: "Cài đặt" },
    ],
  },
];

const linkClass = ({ isActive }) =>
  `flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors cursor-pointer select-none ${
    isActive
      ? "bg-primary-50 text-primary-600 font-medium"
      : "text-gray-600 hover:bg-gray-100 hover:text-gray-900"
  }`;

export default function Sidebar({ shopName = "mortal Shop", botName = "vplusPre+bot" }) {
  const navigate = useNavigate();
  function logout() {
    localStorage.removeItem("admin_token");
    navigate("/login", { replace: true });
  }
  return (
    <aside className="fixed top-0 left-0 h-screen w-[155px] bg-white border-r border-gray-200 flex flex-col z-30">
      {/* Logo */}
      <div className="px-3 py-4 border-b border-gray-100">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-primary-500 flex items-center justify-center flex-shrink-0">
            <Store size={14} className="text-white" />
          </div>
          <span className="font-semibold text-sm text-gray-900 truncate">{shopName}</span>
        </div>
      </div>

      {/* Bot selector pill */}
      <div className="px-3 py-2 border-b border-gray-100">
        <div className="flex items-center gap-2 px-2 py-1.5 bg-gray-50 rounded-lg cursor-pointer hover:bg-gray-100 transition-colors">
          <div className="w-5 h-5 rounded-full bg-primary-100 flex items-center justify-center flex-shrink-0">
            <span className="text-primary-600 font-bold text-[9px]">v</span>
          </div>
          <span className="text-xs text-gray-700 truncate flex-1">{botName}</span>
          <ChevronDown size={12} className="text-gray-400 flex-shrink-0" />
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto py-2 px-2 space-y-0.5">
        {/* Dashboard (top-level) */}
        <NavLink to="/" end className={linkClass}>
          <LayoutDashboard size={15} />
          <span className="truncate">Dashboard</span>
        </NavLink>

        {NAV.filter((n) => n.section).map((group) => (
          <div key={group.section} className="pt-3">
            <p className="px-3 text-[10px] font-semibold text-gray-400 tracking-wider mb-1">
              {group.section}
            </p>
            {group.items.map(({ to, icon: Icon, label }) => (
              <NavLink key={to} to={to} className={linkClass}>
                <Icon size={15} />
                <span className="truncate">{label}</span>
              </NavLink>
            ))}
          </div>
        ))}
      </nav>

      {/* Footer */}
      <div className="px-3 py-3 border-t border-gray-100">
        <button onClick={logout} className="flex items-center gap-2 text-xs text-gray-500 hover:text-red-500 transition-colors w-full px-2 py-1.5 rounded-lg hover:bg-red-50">
          <LogOut size={13} />
          <span>Đăng xuất</span>
        </button>
      </div>
    </aside>
  );
}
