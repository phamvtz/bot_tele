import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { ShoppingCart, Users, TrendingUp, DollarSign, Package, AlertTriangle } from "lucide-react";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import { api } from "../api/endpoints";
import StatsCard from "../components/StatsCard";
import Badge from "../components/Badge";
import { formatCurrency, formatDate } from "../utils/format";

export default function Dashboard() {
  const { data, isLoading } = useQuery({ queryKey: ["stats"], queryFn: api.stats });

  const stats = data?.stats || {};
  const recentOrders = data?.recentOrders || [];
  const chartData = data?.revenueChart || [];
  const topProducts = data?.topProducts || [];
  const lowStock = data?.lowStock || [];

  return (
    <div>
      <h1 className="text-xl font-bold text-white mb-1">Dashboard</h1>
      <p className="text-sm text-gray-500 mb-5">Tổng quan hoạt động cửa hàng</p>

      {/* Stats row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <StatsCard icon={DollarSign}    label="Doanh thu hôm nay"  value={formatCurrency(stats.todayRevenue)} iconBg="bg-green-950/60" iconColor="text-emerald-400" />
        <StatsCard icon={ShoppingCart}  label="Đơn hàng hôm nay"  value={stats.todayOrders ?? "—"} iconBg="bg-blue-950/60" iconColor="text-blue-400" />
        <StatsCard icon={Users}         label="Người dùng mới"     value={stats.newUsers ?? "—"} iconBg="bg-purple-950/60" iconColor="text-purple-400" />
        <StatsCard icon={Package}       label="Sản phẩm đang bán"  value={stats.activeProducts ?? "—"} iconBg="bg-orange-950/60" iconColor="text-orange-400" />
      </div>

      {/* Chart */}
      <div className="glass rounded-xl p-5 mb-6">
        <h2 className="text-sm font-semibold text-white mb-4">Doanh thu 7 ngày</h2>
        {chartData.length > 0 ? (
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
              <XAxis dataKey="date" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} />
              <Tooltip contentStyle={{ background: 'rgba(15,13,26,0.9)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', color: '#e5e7eb' }} formatter={(v) => formatCurrency(v)} />
              <Line type="monotone" dataKey="revenue" stroke="#7c3aed" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        ) : (
          <div className="h-[200px] flex items-center justify-center text-gray-400 text-sm">
            {isLoading ? "Đang tải..." : "Chưa có dữ liệu"}
          </div>
        )}
      </div>

      {/* Top products + Low stock */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5 mb-6">
        {/* Top products */}
        <div className="glass rounded-xl p-5">
          <h2 className="text-sm font-semibold text-white mb-4 flex items-center gap-2">
            <TrendingUp size={14} className="text-primary-400" />
            Top sản phẩm (30 ngày)
          </h2>
          {isLoading ? (
            <p className="text-sm text-gray-400 py-4 text-center">Đang tải...</p>
          ) : topProducts.length === 0 ? (
            <p className="text-sm text-gray-500 py-4 text-center">Chưa có dữ liệu</p>
          ) : (
            <div className="space-y-3">
              {topProducts.map((p, i) => {
                const maxOrders = topProducts[0]?.orders || 1;
                const pct = Math.max(8, Math.round((p.orders / maxOrders) * 100));
                return (
                  <div key={i} className="flex items-center gap-3">
                    <span className="text-xs text-gray-500 w-4 flex-shrink-0">{i + 1}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-gray-300 truncate mb-1">{p.name}</p>
                      <div className="h-1.5 bg-white/[0.06] rounded-full overflow-hidden">
                        <div className="h-full bg-gradient-to-r from-primary-600 to-primary-400 rounded-full transition-all"
                          style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                    <span className="text-xs font-semibold text-white flex-shrink-0">{p.orders} đơn</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Low stock alerts */}
        <div className="glass rounded-xl p-5">
          <h2 className="text-sm font-semibold text-white mb-4 flex items-center gap-2">
            <AlertTriangle size={14} className="text-orange-400" />
            Cảnh báo hết hàng
          </h2>
          {isLoading ? (
            <p className="text-sm text-gray-400 py-4 text-center">Đang tải...</p>
          ) : lowStock.length === 0 ? (
            <p className="text-sm text-gray-500 py-4 text-center">Tất cả sản phẩm còn hàng</p>
          ) : (
            <div className="space-y-2">
              {lowStock.map((p) => (
                <div key={p.id} className="flex items-center justify-between py-1.5 px-2 rounded-lg hover:bg-white/[0.03] transition-colors">
                  <Link to="/products" className="text-xs text-gray-300 hover:text-white transition-colors truncate flex-1">{p.name}</Link>
                  <span className={`text-xs font-semibold ml-3 flex-shrink-0 ${p.stock === 0 ? "text-red-400" : p.stock <= 2 ? "text-orange-400" : "text-yellow-400"}`}>
                    {p.stock === 0 ? "Hết hàng" : `${p.stock} còn`}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Recent orders */}
      <div className="glass rounded-xl p-5">
        <h2 className="text-sm font-semibold text-white mb-4">Đơn hàng gần đây</h2>
        {recentOrders.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-6">Chưa có đơn hàng</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/[0.06] text-left text-gray-500 text-xs">
                <th className="pb-2 font-medium">Mã đơn</th>
                <th className="pb-2 font-medium">Sản phẩm</th>
                <th className="pb-2 font-medium">Số tiền</th>
                <th className="pb-2 font-medium">Trạng thái</th>
                <th className="pb-2 font-medium">Thời gian</th>
              </tr>
            </thead>
            <tbody>
              {recentOrders.map((o) => (
                <tr key={o.id} className="border-b border-white/[0.04] hover:bg-white/[0.03] transition-colors">
                  <td className="py-2.5 font-mono text-xs text-gray-400">{o.id?.slice(-8).toUpperCase()}</td>
                  <td className="py-2.5 text-gray-300 max-w-[180px] truncate">{o.product?.name || "—"}</td>
                  <td className="py-2.5 font-medium text-white">{formatCurrency(o.finalAmount)}</td>
                  <td className="py-2.5"><Badge status={o.status} /></td>
                  <td className="py-2.5 text-gray-400 text-xs">{formatDate(o.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
