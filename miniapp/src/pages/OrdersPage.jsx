import React, { useEffect, useState } from "react";
import { PackageCheck, Clock, CheckCircle2, XCircle, RefreshCw, Eye, QrCode } from "lucide-react";
import { tmaFetch } from "../lib/api.js";
import { formatVnd, formatDateTime } from "../lib/format.js";
import { useToast } from "../components/Toast.jsx";

const FILTERS = [
  { id: "ALL", label: "Tất cả" },
  { id: "PENDING", label: "Chờ TT" },
  { id: "DELIVERED", label: "Đã giao" },
  { id: "CANCELED", label: "Đã hủy" },
];

export default function OrdersPage({ onOpenDelivery, onResumePayment }) {
  const [status, setStatus] = useState("ALL");
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const { showToast } = useToast();

  const loadOrders = async (st = status) => {
    setLoading(true);
    try {
      const res = await tmaFetch(`/orders?status=${encodeURIComponent(st)}`);
      setOrders(res.orders || []);
    } catch (err) {
      showToast(err.message, "error");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadOrders(status);
  }, [status]);

  const handleOpenDetail = async (o) => {
    try {
      const res = await tmaFetch(`/orders/${o.id}`);
      const detail = res.order;
      if (detail.status === "PENDING" && detail.payment) {
        onResumePayment?.({
          mode: "order",
          targetId: detail.id,
          shortId: detail.shortId,
          title: detail.title,
          amountVnd: detail.amountVnd,
          payment: detail.payment,
        });
      } else if (detail.status === "DELIVERED") {
        onOpenDelivery?.({
          orderId: detail.id,
          shortId: detail.shortId,
          title: detail.title,
          deliveryContent: detail.deliveryContent,
        });
      }
    } catch (err) {
      showToast(err.message, "error");
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-extrabold text-white">Đơn hàng của tôi</h2>
        <button
          type="button"
          onClick={() => loadOrders(status)}
          className="p-2 rounded-xl bg-surface-card border border-white/10 text-slate-300"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
        </button>
      </div>

      <div className="flex gap-1.5 overflow-x-auto no-scrollbar">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            onClick={() => setStatus(f.id)}
            className={`px-3.5 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap border ${
              status === f.id
                ? "bg-indigo-600 border-indigo-400 text-white"
                : "bg-surface-card border-white/10 text-slate-400"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="py-10 text-center text-xs text-slate-400">Đang tải đơn hàng...</div>
      ) : orders.length === 0 ? (
        <div className="rounded-2xl bg-surface-card border border-white/10 p-8 text-center space-y-2">
          <PackageCheck className="w-8 h-8 text-slate-500 mx-auto" />
          <p className="text-xs text-slate-400">Chưa có đơn hàng nào trong danh mục này.</p>
        </div>
      ) : (
        <div className="space-y-2.5">
          {orders.map((o) => {
            const badge =
              o.status === "DELIVERED"
                ? {
                    cls: "bg-emerald-500/15 text-emerald-300",
                    label: "Đã giao",
                    Icon: CheckCircle2,
                  }
                : o.status === "PENDING"
                  ? { cls: "bg-amber-500/15 text-amber-300", label: "Chờ TT", Icon: Clock }
                  : o.status === "PAID"
                    ? { cls: "bg-sky-500/15 text-sky-300", label: "Đang giao", Icon: RefreshCw }
                    : { cls: "bg-rose-500/15 text-rose-300", label: "Đã hủy", Icon: XCircle };
            const BadgeIcon = badge.Icon;

            return (
              <div
                key={o.id}
                className="rounded-2xl bg-surface-card border border-white/10 p-3.5 space-y-2.5"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-xs font-bold text-white line-clamp-1">
                      {o.title} {o.quantity > 1 ? `× ${o.quantity}` : ""}
                    </div>
                    <div className="text-[11px] text-slate-400 font-mono mt-0.5">
                      #{o.shortId} · {formatDateTime(o.createdAt)}
                    </div>
                  </div>
                  <span
                    className={`px-2 py-0.5 rounded-lg text-[10px] font-bold inline-flex items-center gap-1 shrink-0 ${badge.cls}`}
                  >
                    <BadgeIcon className="w-3 h-3" /> {badge.label}
                  </span>
                </div>

                <div className="pt-2 border-t border-white/5 flex items-center justify-between gap-2">
                  <span className="text-xs font-extrabold text-emerald-400">
                    {formatVnd(o.amountVnd)}
                  </span>

                  {o.status === "DELIVERED" && (
                    <button
                      type="button"
                      onClick={() => handleOpenDetail(o)}
                      className="px-3 py-1.5 rounded-xl bg-indigo-600/20 border border-indigo-400/30 text-indigo-200 text-xs font-semibold flex items-center gap-1.5"
                    >
                      <Eye className="w-3.5 h-3.5" /> Xem sản phẩm
                    </button>
                  )}
                  {o.status === "PENDING" && (
                    <button
                      type="button"
                      onClick={() => handleOpenDetail(o)}
                      className="px-3 py-1.5 rounded-xl bg-amber-400 text-canvas-950 text-xs font-extrabold flex items-center gap-1.5"
                    >
                      <QrCode className="w-3.5 h-3.5" /> Thanh toán tiếp
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
