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
    <div>
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-xl font-bold text-white">Lịch gửi tin</h1>
        <button onClick={() => { setForm(EMPTY); setModal(true); }}
          className="flex items-center gap-1.5 px-4 py-2 bg-primary-500 text-white rounded-lg text-sm font-medium hover:bg-primary-600 transition-colors shadow-glow-sm hover:shadow-glow">
          <Plus size={15} /> Lên lịch
        </button>
      </div>
      <p className="text-sm text-gray-500 mb-5">Hẹn giờ gửi broadcast tới người dùng</p>

      <div className="glass rounded-xl p-4">
        {isLoading ? (
          <div className="py-14 text-center text-sm text-gray-500">Đang tải...</div>
        ) : broadcasts.length === 0 ? (
          <EmptyState icon={Clock} message="Chưa có lịch gửi tin nào" action="Lên lịch" onAction={() => setModal(true)} />
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/[0.06] text-left text-xs text-gray-500">
                <th className="px-3 py-2.5 font-medium">Nội dung</th>
                <th className="px-3 py-2.5 font-medium">Đối tượng</th>
                <th className="px-3 py-2.5 font-medium">Thời gian gửi</th>
                <th className="px-3 py-2.5 font-medium">Trạng thái</th>
                <th className="px-3 py-2.5 font-medium">Kết quả</th>
                <th className="px-3 py-2.5 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {broadcasts.map((b) => {
                const m = STATUS_META[b.status] || STATUS_META.SCHEDULED;
                return (
                  <tr key={b.id} className="border-b border-white/[0.04] hover:bg-white/[0.03]">
                    <td className="px-3 py-3 text-gray-200 max-w-xs truncate">{b.message}</td>
                    <td className="px-3 py-3 text-xs text-gray-400">{b.vipOnly ? `VIP ≥ ${b.minVip}` : "Tất cả"}</td>
                    <td className="px-3 py-3 text-xs text-gray-400">{formatDate(b.scheduledAt)}</td>
                    <td className="px-3 py-3"><span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium border ${m.cls}`}>{m.label}</span></td>
                    <td className="px-3 py-3 text-xs text-gray-500">
                      {b.status === "SENT" ? `${b.sentCount} ✓ / ${b.failCount} ✗` : b.status === "FAILED" ? (b.error || "—") : "—"}
                    </td>
                    <td className="px-3 py-3">
                      {b.status === "SCHEDULED" && (
                        <button onClick={() => { if (confirm("Hủy lịch này?")) delMut.mutate(b.id); }}
                          className="text-gray-400 hover:text-red-400 transition-colors">
                          <Trash2 size={14} />
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <Modal open={modal} onClose={() => setModal(false)} title="Lên lịch gửi tin">
        <div className="space-y-3">
          <div>
            <label className="text-xs font-medium text-gray-400 block mb-1">Nội dung</label>
            <textarea value={form.message} onChange={(e) => setForm((f) => ({ ...f, message: e.target.value }))} rows={4}
              placeholder="Nội dung tin nhắn (hỗ trợ Markdown)..."
              className="w-full glass-input rounded-lg px-3 py-2 text-sm resize-none" />
          </div>
          <div>
            <label className="text-xs font-medium text-gray-400 block mb-1">Thời gian gửi</label>
            <input type="datetime-local" value={form.scheduledAt} onChange={(e) => setForm((f) => ({ ...f, scheduledAt: e.target.value }))}
              className="w-full glass-input rounded-lg px-3 py-2 text-sm" />
          </div>
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={form.vipOnly} onChange={(e) => setForm((f) => ({ ...f, vipOnly: e.target.checked }))} className="rounded text-primary-500" />
            <span className="text-sm text-gray-400">Chỉ gửi cho VIP</span>
          </label>
          {form.vipOnly && (
            <div>
              <label className="text-xs font-medium text-gray-400 block mb-1">VIP tối thiểu</label>
              <input type="number" min={1} max={4} value={form.minVip} onChange={(e) => setForm((f) => ({ ...f, minVip: e.target.value }))}
                className="w-full glass-input rounded-lg px-3 py-2 text-sm" />
            </div>
          )}
          <button onClick={submit} disabled={!form.message.trim() || !form.scheduledAt || createMut.isPending}
            className="w-full flex items-center justify-center gap-1.5 py-2 bg-primary-500 text-white rounded-lg text-sm font-medium hover:bg-primary-600 disabled:opacity-50 transition-colors">
            <Send size={15} /> {createMut.isPending ? "Đang lưu..." : "Lên lịch"}
          </button>
        </div>
      </Modal>
    </div>
  );
}
