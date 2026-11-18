import React, { useEffect, useState } from "react";
import { RotateCw } from "lucide-react";
import { tmaFetch } from "../lib/api.js";
import { formatVnd, formatDateTime } from "../lib/format.js";
import { useToast } from "../components/Toast.jsx";

const FILTERS = [
  { id: "ALL", label: "Tất cả" },
  { id: "PENDING", label: "Chờ thanh toán" },
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
      <header className="flex items-center justify-between pt-1">
        <h1 className="text-[19px] font-semibold tracking-[-0.03em] text-zinc-100">Đơn hàng</h1>
        <button
          type="button"
          aria-label="Làm mới danh sách đơn hàng"
          onClick={() => loadOrders(status)}
          className="w-9 h-9 rounded-full bg-card border border-white/[0.08] text-zinc-400 hover:text-zinc-100 flex items-center justify-center"
        >
          <RotateCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} strokeWidth={1.75} />
        </button>
      </header>

      <div className="flex gap-1.5 overflow-x-auto no-scrollbar pb-0.5">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            onClick={() => setStatus(f.id)}
            className={`h-8 px-3.5 rounded-full text-[12.5px] font-medium whitespace-nowrap transition-colors ${
              status === f.id
                ? "bg-zinc-100 text-zinc-950"
                : "bg-card border border-white/[0.07] text-zinc-400 hover:text-zinc-200"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="py-12 text-center text-[13px] text-zinc-500">Đang tải đơn hàng...</div>
      ) : orders.length === 0 ? (
        <div className="rounded-2xl bg-card border border-white/[0.07] py-12 px-6 text-center">
          <p className="text-[13.5px] text-zinc-400">Chưa có đơn hàng nào</p>
        </div>
      ) : (
        <div className="space-y-2.5">
          {orders.map((o) => {
            const st =
              o.status === "DELIVERED"
                ? { dot: "bg-emerald-400", text: "text-emerald-400", label: "Đã giao" }
                : o.status === "PENDING"
                  ? { dot: "bg-amber-400", text: "text-amber-400", label: "Chờ thanh toán" }
                  : o.status === "PAID"
                    ? { dot: "bg-zinc-200", text: "text-zinc-200", label: "Đang giao" }
                    : { dot: "bg-zinc-600", text: "text-zinc-500", label: "Đã hủy" };

            return (
              <div
                key={o.id}
                className="rounded-2xl bg-card border border-white/[0.07] p-4 space-y-3"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-[14px] font-medium text-zinc-100 line-clamp-1">
                      {o.title} {o.quantity > 1 ? `× ${o.quantity}` : ""}
                    </div>
                    <div className="text-[12px] text-zinc-500 font-mono mt-0.5">
                      #{o.shortId} · {formatDateTime(o.createdAt)}
                    </div>
                  </div>
                  <span className={`inline-flex items-center gap-1.5 text-[12px] font-medium shrink-0 ${st.text}`}>
                    <span className={`w-1.5 h-1.5 rounded-full ${st.dot}`} />
                    {st.label}
                  </span>
                </div>

                <div className="pt-2.5 border-t border-white/[0.06] flex items-center justify-between gap-2">
                  <span className="font-mono text-[14px] font-semibold text-zinc-100 tabular">
                    {formatVnd(o.amountVnd)}
                  </span>

                  {o.status === "DELIVERED" && (
                    <button
                      type="button"
                      onClick={() => handleOpenDetail(o)}
                      className="h-8 px-3.5 rounded-lg bg-elevated hover:bg-subtle border border-white/[0.08] text-zinc-100 text-[12.5px] font-medium"
                    >
                      Xem nội dung
                    </button>
                  )}
                  {o.status === "PENDING" && (
                    <button
                      type="button"
                      onClick={() => handleOpenDetail(o)}
                      className="h-8 px-3.5 rounded-lg bg-zinc-100 hover:bg-white text-zinc-950 text-[12.5px] font-semibold"
                    >
                      Thanh toán
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
