import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Search, Send, MessageSquare } from "lucide-react";
import { api } from "../api/endpoints";
import Modal from "../components/Modal";
import EmptyState from "../components/EmptyState";
import Pagination from "../components/Pagination";
import { formatDate } from "../utils/format";

const STATUS_META = {
  OPEN:        { label: "Mở",         cls: "bg-amber-950/60 text-amber-300 border-amber-800/50" },
  IN_PROGRESS: { label: "Đang xử lý", cls: "bg-blue-950/60 text-blue-300 border-blue-800/50" },
  RESOLVED:    { label: "Đã giải quyết", cls: "bg-emerald-950/60 text-emerald-300 border-emerald-800/50" },
  CLOSED:      { label: "Đã đóng",    cls: "bg-white/[0.06] text-gray-400 border-white/[0.1]" },
};

const FILTERS = [["Tất cả", ""], ["Mở", "OPEN"], ["Đang xử lý", "IN_PROGRESS"], ["Đã giải quyết", "RESOLVED"], ["Đã đóng", "CLOSED"]];

function StatusBadge({ status }) {
  const m = STATUS_META[status] || STATUS_META.CLOSED;
  return <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium border ${m.cls}`}>{m.label}</span>;
}

export default function Complaints() {
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [detail, setDetail] = useState(null);
  const [reply, setReply] = useState("");
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["complaints", status, search, page, pageSize],
    queryFn: () => api.complaints({ status, search, page, limit: pageSize }),
  });

  const replyMut = useMutation({
    mutationFn: ({ id, message }) => api.replyComplaint(id, message),
    onSuccess: (_r, vars) => {
      qc.invalidateQueries(["complaints"]);
      qc.invalidateQueries(["sidebar-badges"]);
      setReply("");
      api.complaint(vars.id).then(setDetail);
    },
  });

  const statusMut = useMutation({
    mutationFn: ({ id, status }) => api.updateComplaintStatus(id, status),
    onSuccess: (_r, vars) => {
      qc.invalidateQueries(["complaints"]);
      qc.invalidateQueries(["sidebar-badges"]);
      if (detail) setDetail({ ...detail, status: vars.status });
    },
  });

  const complaints = data?.complaints || [];
  const total = data?.total || 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div>
      <h1 className="text-xl font-bold text-white mb-1">Khiếu nại</h1>
      <p className="text-sm text-gray-500 mb-5">Quản lý khiếu nại / hỗ trợ từ khách hàng</p>

      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <div className="relative flex-1 min-w-[180px] max-w-xs">
          <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-500" />
          <input value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            placeholder="Tìm theo Telegram ID..."
            className="glass-input w-full pl-7 pr-3 py-1.5 text-sm rounded-lg" />
        </div>
        {FILTERS.map(([label, val]) => (
          <button key={val} onClick={() => { setStatus(val); setPage(1); }}
            className={`text-xs px-2.5 py-1.5 rounded-lg border transition-colors ${status === val ? "bg-primary-600/30 border-primary-500/50 text-primary-300" : "bg-white/[0.04] border-white/[0.06] text-gray-400 hover:text-white hover:bg-white/[0.08]"}`}>
            {label}
          </button>
        ))}
      </div>

      <div className="glass rounded-xl p-4">
        {isLoading ? (
          <div className="py-14 text-center text-sm text-gray-500">Đang tải...</div>
        ) : complaints.length === 0 ? (
          <EmptyState icon={AlertTriangle} message="Chưa có khiếu nại nào" />
        ) : (
          <>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/[0.06] text-left text-xs text-gray-500">
                  <th className="px-3 py-2.5 font-medium">Mã</th>
                  <th className="px-3 py-2.5 font-medium">Khách hàng</th>
                  <th className="px-3 py-2.5 font-medium">Nội dung</th>
                  <th className="px-3 py-2.5 font-medium">Trạng thái</th>
                  <th className="px-3 py-2.5 font-medium">Cập nhật</th>
                  <th className="px-3 py-2.5 font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {complaints.map((c) => {
                  const lastMsg = Array.isArray(c.messages) && c.messages.length ? c.messages[c.messages.length - 1] : null;
                  return (
                    <tr key={c.id} className="border-b border-white/[0.04] hover:bg-white/[0.03]">
                      <td className="px-3 py-3 font-mono text-xs text-primary-400">#{String(c.id).slice(-6).toUpperCase()}</td>
                      <td className="px-3 py-3 text-gray-300 font-mono text-xs">{c.odelegramId || "—"}</td>
                      <td className="px-3 py-3 text-gray-400 max-w-xs truncate">{c.subject || lastMsg?.text || "—"}</td>
                      <td className="px-3 py-3"><StatusBadge status={c.status} /></td>
                      <td className="px-3 py-3 text-xs text-gray-500">{formatDate(c.updatedAt || c.createdAt)}</td>
                      <td className="px-3 py-3">
                        <button onClick={() => { setDetail(c); setReply(""); }}
                          className="text-gray-400 hover:text-primary-400 transition-colors">
                          <MessageSquare size={15} />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <Pagination page={page} totalPages={totalPages} total={total} pageSize={pageSize}
              onPage={setPage} onPageSize={(s) => { setPageSize(s); setPage(1); }} />
          </>
        )}
      </div>

      <Modal open={!!detail} onClose={() => setDetail(null)} title={detail ? `Khiếu nại #${String(detail.id).slice(-6).toUpperCase()}` : ""} width="max-w-xl">
        {detail && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="text-xs text-gray-400">
                Khách: <span className="font-mono text-gray-300">{detail.odelegramId || "—"}</span>
              </div>
              <select value={detail.status} onChange={(e) => statusMut.mutate({ id: detail.id, status: e.target.value })}
                className="glass-input rounded-lg px-2 py-1 text-xs">
                {Object.keys(STATUS_META).map((s) => <option key={s} value={s}>{STATUS_META[s].label}</option>)}
              </select>
            </div>

            <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
              {(Array.isArray(detail.messages) ? detail.messages : []).map((m, i) => (
                <div key={i} className={`flex ${m.from === "admin" ? "justify-end" : "justify-start"}`}>
                  <div className={`max-w-[80%] rounded-2xl px-3 py-2 text-sm ${m.from === "admin" ? "bg-primary-600/30 text-primary-100" : "bg-white/[0.06] text-gray-200"}`}>
                    <p className="whitespace-pre-wrap break-words">{m.text}</p>
                    <p className="text-[10px] text-gray-500 mt-1">{m.at ? formatDate(m.at) : ""}</p>
                  </div>
                </div>
              ))}
              {(!detail.messages || detail.messages.length === 0) && (
                <p className="text-xs text-gray-500 text-center py-4">Chưa có tin nhắn</p>
              )}
            </div>

            <div className="flex items-end gap-2">
              <textarea value={reply} onChange={(e) => setReply(e.target.value)} rows={2}
                placeholder="Nhập phản hồi gửi tới khách..."
                className="flex-1 glass-input rounded-lg px-3 py-2 text-sm resize-none" />
              <button onClick={() => reply.trim() && replyMut.mutate({ id: detail.id, message: reply.trim() })}
                disabled={!reply.trim() || replyMut.isPending}
                className="px-3 py-2 bg-primary-500 text-white rounded-lg text-sm font-medium hover:bg-primary-600 disabled:opacity-50 transition-colors">
                <Send size={15} />
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
