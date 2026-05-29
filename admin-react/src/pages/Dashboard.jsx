import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { ShoppingCart, Users, TrendingUp, DollarSign, Package, AlertTriangle, BarChart3, Clock } from "lucide-react";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import { api } from "../api/endpoints";
import StatsCard from "../components/StatsCard";
import Badge from "../components/Badge";
import { formatCurrency, formatDate } from "../utils/format";

export default function Dashboard() {
  const [chartDays, setChartDays] = useState(7);
  const { data, isLoading } = useQuery({
    queryKey: ["stats", chartDays],
    queryFn: () => api.stats({ chartDays }),
  });

  const stats = data?.stats || {};
  const recentOrders = data?.recentOrders || [];
  const chartData = data?.revenueChart || [];
  const topProducts = data?.topProducts || [];
  const lowStock = data?.lowStock || [];

  return (
    <div>
      <h1 className="text-xl font-bold text-white mb-1">Dashboard</h1>
      <p className="text-sm text-gray-500 mb-5">Tổng quan hoạt động cửa hàng</p>

      {/* Today stats */}
      <p className="text-xs font-semibold text-gray-600 uppercase tracking-widest mb-2">Hôm nay</p>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
        <StatsCard icon={DollarSign}   label="Doanh thu"         value={formatCurrency(stats.todayRevenue)} iconBg="bg-green-950/60" iconColor="text-emerald-400" />
        <StatsCard icon={ShoppingCart} label="Đơn thành công"    value={stats.todayOrders ?? "—"} iconBg="bg-blue-950/60" iconColor="text-blue-400" />
        <StatsCard icon={Users}        label="Người dùng mới"    value={stats.newUsers ?? "—"} iconBg="bg-purple-950/60" iconColor="text-purple-400" />
        <StatsCard icon={Clock}        label="Chờ thanh toán"    value={stats.pendingOrders ?? "—"} iconBg="bg-yellow-950/60" iconColor="text-yellow-400" />
      </div>

      {/* Month + All-time stats */}
      <p className="text-xs font-semibold text-gray-600 uppercase tracking-widest mb-2">30 ngày qua</p>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
        <StatsCard icon={DollarSign}  label="Doanh thu tháng"   value={formatCurrency(stats.monthRevenue)} iconBg="bg-emerald-950/50" iconColor="text-emerald-500" />
        <StatsCard icon={BarChart3}   label="Đơn tháng"         value={stats.monthOrders ?? "—"} iconBg="bg-blue-950/50" iconColor="text-blue-500" />
        <StatsCard icon={DollarSign}  label="Doanh thu tích lũy" value={formatCurrency(stats.allTimeRevenue)} iconBg="bg-emerald-950/30" iconColor="text-emerald-700" />
        <StatsCard icon={Package}     label="Sản phẩm đang bán" value={stats.activeProducts ?? "—"} iconBg="bg-orange-950/60" iconColor="text-orange-400" />
      </div>

      {/* Chart */}
      <div className="glass rounded-xl p-5 mb-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-white">Doanh thu</h2>
          <div className="flex gap-1">
            {[7, 30].map((d) => (
              <button key={d} onClick={() => setChartDays(d)}
                className={`text-xs px-2.5 py-1 rounded-lg transition-colors border ${chartDays === d ? "bg-primary-600/20 text-primary-400 border-primary-700/50" : "bg-white/[0.05] text-gray-400 border-white/[0.06] hover:text-white"}`}>
                {d} ngày
              </button>
            ))}
          </div>
        </div>
        {chartData.length > 0 ? (
          <>
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                <XAxis dataKey="date" tick={{ fontSize: 11 }} interval={chartDays === 30 ? 4 : 0} />
                <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} />
                <Tooltip contentStyle={{ background: 'rgba(15,13,26,0.9)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', color: '#e5e7eb' }} formatter={(v) => formatCurrency(v)} />
                <Line type="monotone" dataKey="revenue" stroke="#7c3aed" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>

            {/* Daily breakdown table */}
            <div className="mt-4 border-t border-white/[0.06] pt-4 overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-gray-500">
                    <th className="pb-2 font-medium">Ngày</th>
                    <th className="pb-2 font-medium text-right">Đơn</th>
                    <th className="pb-2 font-medium text-right">Doanh thu</th>
                    <th className="pb-2 font-medium w-32 pl-3">Tỷ lệ</th>
                  </tr>
                </thead>
                <tbody>
                  {[...chartData].reverse().map((d, i) => {
                    const maxRev = Math.max(...chartData.map(x => x.revenue), 1);
                    const pct = Math.round((d.revenue / maxRev) * 100);
                    return (
                      <tr key={i} className="border-t border-white/[0.04] hover:bg-white/[0.02] transition-colors">
                        <td className="py-1.5 text-gray-400">{d.date}</td>
                        <td className="py-1.5 text-right text-gray-300">{d.count || 0}</td>
                        <td className={`py-1.5 text-right font-semibold ${d.revenue > 0 ? "text-emerald-400" : "text-gray-600"}`}>
                          {d.revenue > 0 ? formatCurrency(d.revenue) : "—"}
                        </td>
                        <td className="py-1.5 pl-3">
                          <div className="h-1.5 bg-white/[0.06] rounded-full overflow-hidden">
                            <div className="h-full bg-primary-500/60 rounded-full" style={{ width: `${pct}%` }} />
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
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
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-white">Đơn hàng gần đây</h2>
          <Link to="/orders" className="text-xs text-primary-400 hover:text-primary-300 transition-colors">Xem tất cả →</Link>
        </div>
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
