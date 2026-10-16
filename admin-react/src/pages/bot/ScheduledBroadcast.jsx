import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Send, Plus, Trash2, Clock } from "lucide-react";
import { api } from "../../api/endpoints";
import Modal from "../../components/Modal";
import EmptyState from "../../components/EmptyState";
import { formatDate } from "../../utils/format";

const STATUS_META = {
  SCHEDULED: { label: "Đã lên lịch", cls: "bg-blue-950/60 text-blue-300 border-blue-800/50" },
  SENDING:   { label: "Đang gửi",   cls: "bg-amber-950/60 text-amber-300 border-amber-800/50" },
  SENT:      { label: "Đã gửi",     cls: "bg-emerald-950/60 text-emerald-300 border-emerald-800/50" },
  FAILED:    { label: "Thất bại",   cls: "bg-red-950/60 text-red-400 border-red-800/50" },
};

const EMPTY = { message: "", scheduledAt: "", vipOnly: false, minVip: 1 };

export default function ScheduledBroadcast() {
  const [modal, setModal] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({ queryKey: ["scheduled-broadcasts"], queryFn: api.scheduledBroadcasts, refetchInterval: 15000 });
  const createMut = useMutation({
    mutationFn: api.createScheduledBroadcast,
    onSuccess: () => { qc.invalidateQueries(["scheduled-broadcasts"]); setModal(false); setForm(EMPTY); },
  });
  const delMut = useMutation({
    mutationFn: api.deleteScheduledBroadcast,
    onSuccess: () => qc.invalidateQueries(["scheduled-broadcasts"]),
  });

  const broadcasts = data?.broadcasts || [];

  function submit() {
    if (!form.message.trim() || !form.scheduledAt) return;
    createMut.mutate({ ...form, minVip: Number(form.minVip) || 1 });
  }

  return (
    <div className="space-y-4 pb-10">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="eyebrow text-slate-400">AUTOMATION // SCHEDULED BROADCASTS</span>
            <span className="w-1 h-1 rounded-full bg-slate-600" />
            <span className="text-[10px] font-mono text-cyan-400">CRON QUEUE</span>
          </div>
          <h1 className="text-xl font-bold text-slate-100 tracking-tight flex items-center gap-2">
            Lịch gửi tin
            <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-indigo-500/10 text-indigo-300 border border-indigo-500/25">
              {broadcasts.length} QUEUED
            </span>
          </h1>
          <p className="text-xs text-slate-400 mt-0.5 tracking-tight">
            Hẹn giờ tự động phát thông báo tới khách hàng theo lịch trình định sẵn
          </p>
        </div>
        <button
          onClick={() => { setForm(EMPTY); setModal(true); }}
          className="flex items-center gap-1.5 px-3.5 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-md text-xs font-mono font-medium transition-colors cursor-pointer"
        >
          <Plus size={13} /> LÊN LỊCH GỬI
        </button>
      </div>

      <div className="bento-card p-4">
        {isLoading ? (
          <div className="py-16 text-center text-xs font-mono text-slate-500 animate-pulse">
            ĐANG TẢI HÀNG ĐỢI LỊCH PHÁT...
          </div>
        ) : broadcasts.length === 0 ? (
          <EmptyState icon={Clock} message="Chưa có lịch gửi tin tự động nào" action="Lên lịch" onAction={() => setModal(true)} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-800/80 text-[10px] font-mono uppercase tracking-wider text-slate-400 bg-slate-900/40">
                  <th className="px-3 py-2.5">NỘI DUNG THÔNG BÁO</th>
                  <th className="px-3 py-2.5">ĐỐI TƯỢNG</th>
                  <th className="px-3 py-2.5">HẸN GIỜ PHÁT</th>
                  <th className="px-3 py-2.5">TRẠNG THÁI</th>
                  <th className="px-3 py-2.5">KẾT QUẢ GIAO</th>
                  <th className="px-3 py-2.5 text-right">THAO TÁC</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/50">
                {broadcasts.map((b) => {
                  const m = STATUS_META[b.status] || STATUS_META.SCHEDULED;
                  return (
                    <tr key={b.id} className="hover:bg-slate-800/30 transition-colors">
                      <td className="px-3 py-3 text-slate-200 max-w-xs truncate font-medium">{b.message}</td>
                      <td className="px-3 py-3 text-xs font-mono text-slate-400">{b.vipOnly ? `VIP ≥ ${b.minVip}` : "TẤT CẢ USERS"}</td>
                      <td className="px-3 py-3 text-xs font-mono text-indigo-300">{formatDate(b.scheduledAt)}</td>
                      <td className="px-3 py-3">
                        <span className={`inline-flex px-2 py-0.5 rounded text-[10px] font-mono font-semibold border ${m.cls}`}>
                          {m.label}
                        </span>
                      </td>
                      <td className="px-3 py-3 text-xs font-mono text-slate-400">
                        {b.status === "SENT" ? `${b.sentCount} ✓ / ${b.failCount} ✗` : b.status === "FAILED" ? (b.error || "—") : "—"}
                      </td>
                      <td className="px-3 py-3 text-right">
                        {b.status === "SCHEDULED" && (
                          <button
                            onClick={() => { if (confirm("Hủy lịch này?")) delMut.mutate(b.id); }}
                            className="text-slate-500 hover:text-rose-400 transition-colors cursor-pointer p-1"
                          >
                            <Trash2 size={13} />
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <Modal open={modal} onClose={() => setModal(false)} title="Lên lịch gửi tin mới">
        <div className="space-y-3.5">
          <div>
            <label className="text-xs font-mono text-slate-400 block mb-1">NỘI DUNG TIN NHẮN</label>
            <textarea
              value={form.message}
              onChange={(e) => setForm((f) => ({ ...f, message: e.target.value }))}
              rows={4}
              placeholder="Nội dung thông báo tự động..."
              className="dev-input w-full px-3 py-2 text-xs font-mono resize-none leading-relaxed"
            />
          </div>
          <div>
            <label className="text-xs font-mono text-slate-400 block mb-1">THỜI GIAN GỬI DỰ KIẾN</label>
            <input
              type="datetime-local"
              value={form.scheduledAt}
              onChange={(e) => setForm((f) => ({ ...f, scheduledAt: e.target.value }))}
              className="dev-input w-full px-3 py-2 text-xs font-mono"
            />
          </div>
          <div className="p-3 bg-slate-900/60 rounded border border-slate-800/60 space-y-2">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={form.vipOnly}
                onChange={(e) => setForm((f) => ({ ...f, vipOnly: e.target.checked }))}
                className="rounded border-slate-700 text-indigo-600 focus:ring-0 cursor-pointer"
              />
              <span className="text-xs font-mono text-slate-300">CHỈ GỬI CHO KHÁCH HÀNG VIP</span>
            </label>
            {form.vipOnly && (
              <div className="pt-1">
                <label className="text-[11px] font-mono text-slate-400 block mb-1">CẤP VIP TỐI THIỂU (1-4)</label>
                <input
                  type="number"
                  min={1}
                  max={4}
                  value={form.minVip}
                  onChange={(e) => setForm((f) => ({ ...f, minVip: e.target.value }))}
                  className="dev-input w-24 px-3 py-1.5 text-xs font-mono"
                />
              </div>
            )}
          </div>
          <button
            onClick={submit}
            disabled={!form.message.trim() || !form.scheduledAt || createMut.isPending}
            className="w-full flex items-center justify-center gap-1.5 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-md text-xs font-mono font-medium transition-colors disabled:opacity-50 cursor-pointer"
          >
            <Send size={13} /> {createMut.isPending ? "ĐANG LÊN LỊCH..." : "XÁC NHẬN HẸN GIỜ"}
          </button>
        </div>
      </Modal>
    </div>
  );
}
