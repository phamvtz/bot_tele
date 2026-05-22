import { useQuery } from "@tanstack/react-query";
import { ShoppingCart, Users, TrendingUp, DollarSign, Package } from "lucide-react";
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

  return (
    <div>
      <h1 className="text-xl font-bold text-gray-900 mb-1">Dashboard</h1>
      <p className="text-sm text-gray-500 mb-5">Tổng quan hoạt động cửa hàng</p>

      {/* Stats row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <StatsCard icon={DollarSign}    label="Doanh thu hôm nay"  value={formatCurrency(stats.todayRevenue)} iconBg="bg-green-100" iconColor="text-green-600" />
        <StatsCard icon={ShoppingCart}  label="Đơn hàng hôm nay"  value={stats.todayOrders ?? "—"} iconBg="bg-blue-100" iconColor="text-blue-600" />
        <StatsCard icon={Users}         label="Người dùng mới"     value={stats.newUsers ?? "—"} iconBg="bg-purple-100" iconColor="text-purple-600" />
        <StatsCard icon={Package}       label="Sản phẩm đang bán"  value={stats.activeProducts ?? "—"} iconBg="bg-orange-100" iconColor="text-orange-600" />
      </div>

      {/* Chart */}
      <div className="bg-white rounded-xl border border-gray-200 p-5 mb-6">
        <h2 className="text-sm font-semibold text-gray-900 mb-4">Doanh thu 7 ngày</h2>
        {chartData.length > 0 ? (
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="date" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} />
              <Tooltip formatter={(v) => formatCurrency(v)} />
              <Line type="monotone" dataKey="revenue" stroke="#10b981" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        ) : (
          <div className="h-[200px] flex items-center justify-center text-gray-400 text-sm">
            {isLoading ? "Đang tải..." : "Chưa có dữ liệu"}
          </div>
        )}
      </div>

      {/* Recent orders */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <h2 className="text-sm font-semibold text-gray-900 mb-4">Đơn hàng gần đây</h2>
        {recentOrders.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-6">Chưa có đơn hàng</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 text-left text-gray-500 text-xs">
                <th className="pb-2 font-medium">Mã đơn</th>
                <th className="pb-2 font-medium">Sản phẩm</th>
                <th className="pb-2 font-medium">Số tiền</th>
                <th className="pb-2 font-medium">Trạng thái</th>
                <th className="pb-2 font-medium">Thời gian</th>
              </tr>
            </thead>
            <tbody>
              {recentOrders.map((o) => (
                <tr key={o.id} className="border-b border-gray-50 hover:bg-gray-50 transition-colors">
                  <td className="py-2.5 font-mono text-xs text-gray-700">{o.id?.slice(-8).toUpperCase()}</td>
                  <td className="py-2.5 text-gray-800 max-w-[180px] truncate">{o.product?.name || "—"}</td>
                  <td className="py-2.5 font-medium text-gray-900">{formatCurrency(o.finalAmount)}</td>
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
