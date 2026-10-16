import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import {
  ShoppingCart, Users, TrendingUp, DollarSign, Package, AlertTriangle,
  BarChart3, Clock, ArrowUpRight, ShieldCheck, Zap, Activity, CheckCircle2,
  RefreshCw, ChevronRight, Layers, ArrowRight
} from "lucide-react";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import { api } from "../api/endpoints";
import StatsCard from "../components/StatsCard";
import Badge from "../components/Badge";
import { formatCurrency, formatDate } from "../utils/format";

export default function Dashboard() {
  const [chartDays, setChartDays] = useState(7);
  const { data, isLoading, isFetching, refetch } = useQuery({
    queryKey: ["stats", chartDays],
    queryFn: () => api.stats({ chartDays }),
  });

  const stats = data?.stats || {};
  const recentOrders = data?.recentOrders || [];
  const chartData = data?.revenueChart || [];
  const topProducts = data?.topProducts || [];
  const lowStock = data?.lowStock || [];

  return (
    <div className="space-y-4 pb-10">
      {/* ── HEADER ── */}
      <div className="flex items-center justify-between gap-4 flex-wrap pb-1">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="eyebrow text-slate-400">STORE // OVERVIEW</span>
            <span className="w-1 h-1 rounded-full bg-slate-600" />
            <span className="text-[10px] font-mono text-emerald-400 flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
              LIVE METRICS
            </span>
          </div>
          <h1 className="text-xl font-bold text-slate-100 tracking-tight flex items-center gap-2">
            Bảng điều khiển hoạt động
          </h1>
          <p className="text-xs text-slate-400 mt-0.5 tracking-tight">
            Theo dõi dòng tiền, tỷ lệ chốt đơn và tình trạng tồn kho theo thời gian thực
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => refetch()}
            disabled={isFetching}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-900/60 border border-slate-800 hover:border-slate-700 text-slate-300 text-xs font-mono transition-all cursor-pointer disabled:opacity-50">
            <RefreshCw size={12} className={isFetching ? "animate-spin text-indigo-400" : ""} />
            <span>ĐỒNG BỘ</span>
          </button>
          <Link
            to="/orders"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium border border-indigo-500/40 shadow-sm transition-all">
            <span>Quản lý đơn hàng</span>
            <ArrowRight size={13} />
          </Link>
        </div>
      </div>

      {/* ── BENTO GRID ROW 1: ASYMMETRIC METRICS ── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-12 gap-3.5">
        {/* Cell 1: Doanh thu hôm nay vs Tháng (Col 4) */}
        <div className="lg:col-span-4 bento-card p-4 flex flex-col justify-between relative overflow-hidden group">
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="eyebrow text-slate-400">FINANCIALS // REVENUE</span>
              <div className="w-7 h-7 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 flex items-center justify-center">
                <DollarSign size={14} />
              </div>
            </div>
            <p className="text-[11px] text-slate-400 font-medium">Doanh thu hôm nay</p>
            <p className="text-2xl font-bold text-slate-100 tracking-tight mt-0.5">
              {formatCurrency(stats.todayRevenue)}
            </p>
          </div>

          <div className="mt-3 pt-2.5 border-t border-slate-800/70 flex items-center justify-between text-xs font-mono">
            <div>
              <span className="text-[10px] text-slate-500 block uppercase">30 ngày qua</span>
              <span className="text-emerald-400 font-semibold">{formatCurrency(stats.monthRevenue)}</span>
            </div>
            <div className="text-right">
              <span className="text-[10px] text-slate-500 block uppercase">Toàn thời gian</span>
              <span className="text-slate-300 font-semibold">{formatCurrency(stats.allTimeRevenue)}</span>
            </div>
          </div>
        </div>

        {/* Cell 2: Đơn hàng & Tỷ lệ chốt (Col 3) */}
        <div className="lg:col-span-3 bento-card p-4 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="eyebrow text-slate-400">ORDERS // VELOCITY</span>
              <div className="w-7 h-7 rounded-lg bg-blue-500/10 border border-blue-500/20 text-blue-400 flex items-center justify-center">
                <ShoppingCart size={14} />
              </div>
            </div>
            <p className="text-[11px] text-slate-400 font-medium">Đơn thành công (Hôm nay)</p>
            <div className="flex items-baseline gap-2 mt-0.5">
              <span className="text-2xl font-bold text-slate-100 tracking-tight">
                {stats.todayOrders ?? "0"}
              </span>
              <span className="text-xs font-mono text-slate-500">/ {stats.monthOrders ?? "0"} tháng</span>
            </div>
          </div>

          <div className="mt-3 pt-2.5 border-t border-slate-800/70 flex items-center justify-between text-xs">
            <span className="text-[11px] text-slate-400">Chờ thanh toán:</span>
            <span className={`font-mono text-xs font-semibold px-2 py-0.5 rounded border ${
              (stats.pendingOrders || 0) > 0
                ? "bg-amber-500/10 text-amber-400 border-amber-500/30"
                : "bg-slate-800/60 text-slate-400 border-slate-700/60"
            }`}>
              {stats.pendingOrders ?? 0} đơn
            </span>
          </div>
        </div>

        {/* Cell 3: Khách hàng mới (Col 3) */}
        <div className="lg:col-span-3 bento-card p-4 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="eyebrow text-slate-400">USERS // GROWTH</span>
              <div className="w-7 h-7 rounded-lg bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 flex items-center justify-center">
                <Users size={14} />
              </div>
            </div>
            <p className="text-[11px] text-slate-400 font-medium">Người dùng mới (Hôm nay)</p>
            <p className="text-2xl font-bold text-slate-100 tracking-tight mt-0.5">
              +{stats.newUsers ?? "0"}
            </p>
          </div>

          <div className="mt-3 pt-2.5 border-t border-slate-800/70 flex items-center justify-between text-xs">
            <span className="text-[11px] text-slate-400">Khách Telegram</span>
            <span className="text-[11px] font-mono text-indigo-400 flex items-center gap-1">
              <CheckCircle2 size={12} /> Hoạt động
            </span>
          </div>
        </div>

        {/* Cell 4: Kho & Danh mục (Col 2) */}
        <div className="lg:col-span-2 bento-card p-4 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="eyebrow text-slate-400">CATALOG // STOCK</span>
              <div className="w-7 h-7 rounded-lg bg-orange-500/10 border border-orange-500/20 text-orange-400 flex items-center justify-center">
                <Package size={14} />
              </div>
            </div>
            <p className="text-[11px] text-slate-400 font-medium">Đang mở bán</p>
            <p className="text-2xl font-bold text-slate-100 tracking-tight mt-0.5">
              {stats.activeProducts ?? "0"}
            </p>
          </div>

          <div className="mt-3 pt-2.5 border-t border-slate-800/70">
            {lowStock.length > 0 ? (
              <span className="text-[10px] font-mono font-semibold text-rose-400 bg-rose-500/10 border border-rose-500/25 px-1.5 py-0.5 rounded block text-center">
                ⚠️ {lowStock.length} mục sắp hết
              </span>
            ) : (
              <span className="text-[10px] font-mono text-emerald-400 bg-emerald-500/10 border border-emerald-500/25 px-1.5 py-0.5 rounded block text-center">
                Kho ổn định
              </span>
            )}
          </div>
        </div>
      </div>

      {/* ── BENTO GRID ROW 2: CHART + TOP PRODUCTS (Col 8 + 4) ── */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-3.5">
        {/* Biểu đồ doanh thu (Col 8) */}
        <div className="lg:col-span-8 bento-card p-5 flex flex-col justify-between">
          <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
            <div>
              <span className="eyebrow text-slate-400">STREAM // REVENUE TREND</span>
              <h2 className="text-sm font-semibold text-slate-100 tracking-tight mt-0.5">
                Dòng tiền doanh thu theo thời gian
              </h2>
            </div>

            {/* Segmented control timeframe switcher */}
            <div className="inline-flex items-center gap-1 p-0.5 rounded-lg bg-slate-950 border border-slate-800">
              {[7, 30].map((d) => (
                <button
                  key={d}
                  onClick={() => setChartDays(d)}
                  className={`text-xs font-mono px-2.5 py-1 rounded transition-colors cursor-pointer ${
                    chartDays === d
                      ? "bg-slate-800 text-slate-100 border border-slate-700/80 font-semibold"
                      : "text-slate-400 hover:text-slate-200"
                  }`}>
                  {d}D
                </button>
              ))}
            </div>
          </div>

          {chartData.length > 0 ? (
            <div>
              <div className="h-[210px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartData} margin={{ top: 10, right: 10, left: -15, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="2 2" stroke="rgba(51, 65, 85, 0.3)" vertical={false} />
                    <XAxis
                      dataKey="date"
                      tick={{ fontSize: 10, fill: "#64748b", fontFamily: "JetBrains Mono" }}
                      interval={chartDays === 30 ? 4 : 0}
                      axisLine={{ stroke: "rgba(51, 65, 85, 0.5)" }}
                      tickLine={false}
                    />
                    <YAxis
                      tick={{ fontSize: 10, fill: "#64748b", fontFamily: "JetBrains Mono" }}
                      tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`}
                      axisLine={false}
                      tickLine={false}
                    />
                    <Tooltip
                      contentStyle={{
                        background: '#090d19',
                        border: '1px solid rgba(51, 65, 85, 0.9)',
                        borderRadius: '8px',
                        boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
                        fontFamily: 'JetBrains Mono',
                        fontSize: '11px',
                        color: '#f1f5f9'
                      }}
                      formatter={(v) => [formatCurrency(v), "Doanh thu"]}
                    />
                    <Line
                      type="monotone"
                      dataKey="revenue"
                      stroke="#6366f1"
                      strokeWidth={2}
                      dot={{ r: 2, fill: "#6366f1", strokeWidth: 0 }}
                      activeDot={{ r: 4, fill: "#818cf8", stroke: "#090d19", strokeWidth: 2 }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>

              {/* Bảng phân tích chi tiết mini */}
              <div className="mt-4 pt-3 border-t border-slate-800/70 overflow-x-auto">
                <table className="w-full text-xs font-mono">
                  <thead>
                    <tr className="text-left text-slate-500 text-[10px] uppercase">
                      <th className="pb-1.5 font-semibold">Mốc ngày</th>
                      <th className="pb-1.5 font-semibold text-right">Lượt đơn</th>
                      <th className="pb-1.5 font-semibold text-right">Doanh thu</th>
                      <th className="pb-1.5 font-semibold w-28 pl-3">Tỷ trọng</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/40">
                    {[...chartData].slice(-5).reverse().map((d, i) => {
                      const maxRev = Math.max(...chartData.map((x) => x.revenue), 1);
                      const pct = Math.round((d.revenue / maxRev) * 100);
                      return (
                        <tr key={i} className="hover:bg-slate-800/30 transition-colors">
                          <td className="py-1.5 text-slate-400">{d.date}</td>
                          <td className="py-1.5 text-right text-slate-300">{d.count || 0}</td>
                          <td className={`py-1.5 text-right font-semibold ${d.revenue > 0 ? "text-emerald-400" : "text-slate-600"}`}>
                            {d.revenue > 0 ? formatCurrency(d.revenue) : "—"}
                          </td>
                          <td className="py-1.5 pl-3">
                            <div className="h-1 bg-slate-800 rounded-full overflow-hidden">
                              <div className="h-full bg-indigo-500 rounded-full" style={{ width: `${pct}%` }} />
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <div className="h-[210px] flex items-center justify-center text-slate-500 text-xs font-mono">
              {isLoading ? "ĐANG TẢI DỮ LIỆU..." : "CHƯA CÓ DỮ LIỆU DOANH THU"}
            </div>
          )}
        </div>

        {/* Top Sản phẩm bán chạy (Col 4) */}
        <div className="lg:col-span-4 bento-card p-5 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-3">
              <div>
                <span className="eyebrow text-slate-400">RANKING // TOP SELLERS</span>
                <h2 className="text-sm font-semibold text-slate-100 tracking-tight mt-0.5 flex items-center gap-1.5">
                  <TrendingUp size={14} className="text-indigo-400" />
                  Sản phẩm bán chạy (30D)
                </h2>
              </div>
              <Link to="/products" className="text-[11px] font-mono text-indigo-400 hover:text-indigo-300">
                KHO →
              </Link>
            </div>

            {isLoading ? (
              <p className="text-xs font-mono text-slate-500 py-6 text-center">ĐANG TẢI...</p>
            ) : topProducts.length === 0 ? (
              <p className="text-xs text-slate-500 py-6 text-center">Chưa có dữ liệu bán chạy</p>
            ) : (
              <div className="space-y-3 mt-1">
                {topProducts.slice(0, 5).map((p, i) => {
                  const maxOrders = topProducts[0]?.orders || 1;
                  const pct = Math.max(6, Math.round((p.orders / maxOrders) * 100));
                  return (
                    <div key={i} className="group">
                      <div className="flex items-center justify-between text-xs mb-1">
                        <span className="text-slate-300 font-medium truncate max-w-[190px] tracking-tight">
                          <span className="font-mono text-[10px] text-slate-500 mr-1.5">#{String(i + 1).padStart(2, "0")}</span>
                          {p.name}
                        </span>
                        <span className="font-mono text-xs font-semibold text-slate-200">
                          {p.orders} đơn
                        </span>
                      </div>
                      <div className="h-1 bg-slate-800 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-gradient-to-r from-indigo-500 to-cyan-400 rounded-full transition-all"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="mt-4 pt-3 border-t border-slate-800/70">
            <Link
              to="/products"
              className="w-full flex items-center justify-center gap-1.5 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800/80 border border-slate-800 text-slate-300 text-xs font-mono transition-colors">
              <span>XEM TẤT CẢ SẢN PHẨM</span>
              <ArrowRight size={12} />
            </Link>
          </div>
        </div>
      </div>

      {/* ── BENTO GRID ROW 3: RECENT ORDERS + INVENTORY ALERTS (Col 7 + 5) ── */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-3.5">
        {/* Đơn hàng gần đây (Col 7) */}
        <div className="lg:col-span-7 bento-card p-5">
          <div className="flex items-center justify-between mb-3.5">
            <div>
              <span className="eyebrow text-slate-400">TRANSACTIONS // RECENT ORDERS</span>
              <h2 className="text-sm font-semibold text-slate-100 tracking-tight mt-0.5">
                Đơn hàng vừa phát sinh
              </h2>
            </div>
            <Link to="/orders" className="text-xs font-mono text-indigo-400 hover:text-indigo-300 flex items-center gap-1">
              TẤT CẢ ĐƠN →
            </Link>
          </div>

          {recentOrders.length === 0 ? (
            <p className="text-xs font-mono text-slate-500 text-center py-8">CHƯA CÓ ĐƠN HÀNG PHÁT SINH</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-slate-800/80 text-left text-slate-500 text-[10px] font-mono uppercase">
                    <th className="pb-2 font-semibold">Mã đơn</th>
                    <th className="pb-2 font-semibold">Sản phẩm</th>
                    <th className="pb-2 font-semibold text-right">Số tiền</th>
                    <th className="pb-2 font-semibold text-center">Trạng thái</th>
                    <th className="pb-2 font-semibold text-right">Thời gian</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/40">
                  {recentOrders.slice(0, 6).map((o) => (
                    <tr key={o.id} className="hover:bg-slate-800/30 transition-colors">
                      <td className="py-2.5 font-mono text-xs text-indigo-400 font-medium">
                        {o.id?.slice(-8).toUpperCase()}
                      </td>
                      <td className="py-2.5 text-slate-300 max-w-[170px] truncate font-medium">
                        {o.product?.name || "—"}
                      </td>
                      <td className="py-2.5 text-right font-mono font-semibold text-slate-100">
                        {formatCurrency(o.finalAmount)}
                      </td>
                      <td className="py-2.5 text-center">
                        <Badge status={o.status} />
                      </td>
                      <td className="py-2.5 text-right text-slate-500 text-[11px] font-mono">
                        {formatDate(o.createdAt)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Cảnh báo kho & Lối tắt điều khiển (Col 5) */}
        <div className="lg:col-span-5 bento-card p-5 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-3">
              <div>
                <span className="eyebrow text-slate-400">OPS // INVENTORY & HEALTH</span>
                <h2 className="text-sm font-semibold text-slate-100 tracking-tight mt-0.5 flex items-center gap-1.5">
                  <AlertTriangle size={14} className="text-amber-400" />
                  Cảnh báo lượng tồn kho
                </h2>
              </div>
              <Link to="/stock" className="text-[11px] font-mono text-indigo-400 hover:text-indigo-300">
                NHẬP KHO →
              </Link>
            </div>

            {lowStock.length === 0 ? (
              <div className="p-4 rounded-xl bg-slate-900/40 border border-slate-800/80 text-center my-2">
                <CheckCircle2 size={18} className="text-emerald-400 mx-auto mb-1.5" />
                <p className="text-xs text-slate-300 font-medium tracking-tight">Tất cả sản phẩm đều đủ số lượng</p>
                <p className="text-[11px] text-slate-500 mt-0.5">Không có mục nào chạm ngưỡng cảnh báo</p>
              </div>
            ) : (
              <div className="space-y-2 mt-1">
                {lowStock.slice(0, 4).map((p) => (
                  <div
                    key={p.id}
                    className="flex items-center justify-between py-2 px-3 rounded-lg bg-slate-950/40 border border-slate-800/60 hover:border-slate-700/80 transition-colors">
                    <span className="text-xs text-slate-200 font-medium truncate flex-1 tracking-tight">
                      {p.name}
                    </span>
                    <span
                      className={`text-[11px] font-mono font-semibold ml-3 px-2 py-0.5 rounded border flex-shrink-0 ${
                        p.stock === 0
                          ? "bg-rose-500/10 text-rose-400 border-rose-500/30"
                          : p.stock <= 2
                          ? "bg-amber-500/10 text-amber-400 border-amber-500/30"
                          : "bg-slate-800 text-slate-300 border-slate-700"
                      }`}>
                      {p.stock === 0 ? "HẾT HÀNG" : `CÒN ${p.stock}`}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Lối tắt quản trị nhanh (Dev-tools shortcuts) */}
          <div className="mt-4 pt-3 border-t border-slate-800/70 space-y-2">
            <span className="eyebrow text-slate-500 block">QUICK ACTIONS // THAO TÁC</span>
            <div className="grid grid-cols-2 gap-2 text-xs font-mono">
              <Link
                to="/flash-sales"
                className="flex items-center justify-between p-2 rounded-lg bg-slate-900/60 hover:bg-slate-800 border border-slate-800 text-slate-300 hover:text-white transition-colors">
                <span className="flex items-center gap-1.5">
                  <Zap size={12} className="text-amber-400" />
                  Flash Sale
                </span>
                <ChevronRight size={12} className="text-slate-500" />
              </Link>
              <Link
                to="/key-orders"
                className="flex items-center justify-between p-2 rounded-lg bg-slate-900/60 hover:bg-slate-800 border border-slate-800 text-slate-300 hover:text-white transition-colors">
                <span className="flex items-center gap-1.5">
                  <Layers size={12} className="text-indigo-400" />
                  Đơn hàng key
                </span>
                <ChevronRight size={12} className="text-slate-500" />
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
