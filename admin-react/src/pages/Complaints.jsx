import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Search, Send, MessageSquare } from "lucide-react";
import { api } from "../api/endpoints";
import Modal from "../components/Modal";
import EmptyState from "../components/EmptyState";
import Pagination from "../components/Pagination";
import { formatDate } from "../utils/format";

const STATUS_META = {
  OPEN:        { label: "MỞ",         cls: "bg-amber-950/40 text-amber-400 border-amber-800/40" },
  IN_PROGRESS: { label: "ĐANG XỬ LÝ", cls: "bg-indigo-950/40 text-indigo-400 border-indigo-800/40" },
  RESOLVED:    { label: "ĐÃ XỬ LÝ",   cls: "bg-emerald-950/40 text-emerald-400 border-emerald-800/40" },
  CLOSED:      { label: "ĐÃ ĐÓNG",    cls: "bg-slate-900 text-slate-500 border-slate-800" },
};

const FILTERS = [
  ["TẤT CẢ", ""],
  ["MỞ", "OPEN"],
  ["ĐANG XỬ LÝ", "IN_PROGRESS"],
  ["ĐÃ XỬ LÝ", "RESOLVED"],
  ["ĐÃ ĐÓNG", "CLOSED"],
];

function StatusBadge({ status }) {
  const m = STATUS_META[status] || STATUS_META.CLOSED;
  return (
    <span className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-mono font-semibold border ${m.cls}`}>
      {m.label}
    </span>
  );
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
    <div className="space-y-4 pb-10">
      {/* Header */}
      <div className="pb-1">
        <div className="flex items-center gap-2 mb-1">
          <span className="eyebrow text-slate-400">SUPPORT // CUSTOMER TICKETS</span>
          <span className="w-1 h-1 rounded-full bg-slate-600" />
          <span className="text-[10px] font-mono text-indigo-400">HELPDESK</span>
        </div>
        <h1 className="text-xl font-bold text-slate-100 tracking-tight flex items-center gap-2">
          Khiếu nại & Hỗ trợ
          <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-indigo-500/10 text-indigo-300 border border-indigo-500/25">
            {total} YÊU CẦU
          </span>
        </h1>
        <p className="text-xs text-slate-400 mt-0.5 tracking-tight">
          Tiếp nhận và phản hồi trực tiếp khiếu nại của khách hàng gửi từ bot Telegram
        </p>
      </div>

      {/* Main Bento Card Container */}
      <div className="bento-card p-4 space-y-3.5">
        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative flex-1 min-w-[180px] max-w-xs">
            <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500" />
            <input
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
              placeholder="Tìm theo Telegram ID..."
              className="dev-input w-full pl-7 pr-3 py-1 text-xs font-mono"
            />
          </div>
          {FILTERS.map(([label, val]) => (
            <button
              key={val}
              onClick={() => { setStatus(val); setPage(1); }}
              className={`text-[11px] font-mono px-2.5 py-1 rounded-md border transition-all cursor-pointer ${
                status === val
                  ? "bg-indigo-500/15 text-indigo-300 border-indigo-500/30"
                  : "bg-slate-900/60 text-slate-400 border-slate-800 hover:text-slate-200 hover:bg-slate-800"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {isLoading ? (
          <div className="py-16 text-center text-xs font-mono text-slate-500 animate-pulse">
            ĐANG TẢI KHIẾU NẠI...
          </div>
        ) : complaints.length === 0 ? (
          <EmptyState icon={AlertTriangle} message="Chưa có khiếu nại nào" />
        ) : (
          <>
            <div className="overflow-x-auto rounded-lg border border-slate-800/80">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="bg-slate-900/60 border-b border-slate-800/80 text-[10px] font-mono text-slate-400 uppercase tracking-wider">
                    <th className="px-3.5 py-2.5 font-medium">MÃ</th>
                    <th className="px-3 py-2.5 font-medium">KHÁCH HÀNG</th>
                    <th className="px-3 py-2.5 font-medium">NỘI DUNG</th>
                    <th className="px-3 py-2.5 font-medium">TRẠNG THÁI</th>
                    <th className="px-3 py-2.5 font-medium">CẬP NHẬT</th>
                    <th className="px-3.5 py-2.5 font-medium text-right">THAO TÁC</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60 font-sans">
                  {complaints.map((c) => {
                    const lastMsg = Array.isArray(c.messages) && c.messages.length ? c.messages[c.messages.length - 1] : null;
                    return (
                      <tr key={c.id} className="hover:bg-slate-800/30 transition-colors">
                        <td className="px-3.5 py-3 font-mono font-semibold text-indigo-400 text-xs">
                          #{String(c.id).slice(-6).toUpperCase()}
                        </td>
                        <td className="px-3 py-3 font-mono text-slate-300 text-xs">
                          {c.odelegramId || "—"}
                        </td>
                        <td className="px-3 py-3 text-slate-400 max-w-xs truncate text-xs">
                          {c.subject || lastMsg?.text || "—"}
                        </td>
                        <td className="px-3 py-3">
                          <StatusBadge status={c.status} />
                        </td>
                        <td className="px-3 py-3 font-mono text-[11px] text-slate-500">
                          {formatDate(c.updatedAt || c.createdAt)}
                        </td>
                        <td className="px-3.5 py-3 text-right">
                          <button
                            onClick={() => { setDetail(c); setReply(""); }}
                            className="p-1 text-slate-400 hover:text-indigo-400 hover:bg-slate-800/60 rounded border border-transparent hover:border-slate-700 transition-all cursor-pointer"
                          >
                            <MessageSquare size={14} />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <Pagination
              page={page}
              totalPages={totalPages}
              total={total}
              pageSize={pageSize}
              onPage={setPage}
              onPageSize={(s) => { setPageSize(s); setPage(1); }}
            />
          </>
        )}
      </div>

      <Modal open={!!detail} onClose={() => setDetail(null)} title={detail ? `Khiếu nại #${String(detail.id).slice(-6).toUpperCase()}` : ""} width="max-w-xl">
        {detail && (
          <div className="space-y-4 text-xs font-mono">
            <div className="flex items-center justify-between pb-2 border-b border-slate-800">
              <div className="text-slate-400">
                Khách hàng: <span className="font-mono text-indigo-400">{detail.odelegramId || "—"}</span>
              </div>
              <select
                value={detail.status}
                onChange={(e) => statusMut.mutate({ id: detail.id, status: e.target.value })}
                className="dev-input rounded-md px-2 py-1 text-xs"
              >
                {Object.keys(STATUS_META).map((s) => <option key={s} value={s}>{STATUS_META[s].label}</option>)}
              </select>
            </div>

            <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
              {(Array.isArray(detail.messages) ? detail.messages : []).map((m, i) => (
                <div key={i} className={`flex ${m.from === "admin" ? "justify-end" : "justify-start"}`}>
                  <div className={`max-w-[80%] rounded-xl px-3 py-2 ${m.from === "admin" ? "bg-indigo-600/25 border border-indigo-500/30 text-indigo-100" : "bg-slate-900 border border-slate-800 text-slate-200"}`}>
                    <p className="whitespace-pre-wrap break-words font-sans">{m.text}</p>
                    <p className="text-[10px] text-slate-500 mt-1 font-mono">{m.at ? formatDate(m.at) : ""}</p>
                  </div>
                </div>
              ))}
              {(!detail.messages || detail.messages.length === 0) && (
                <p className="text-xs text-slate-500 text-center py-4">Chưa có tin nhắn</p>
              )}
            </div>

            <div className="flex items-end gap-2 pt-2 border-t border-slate-800">
              <textarea
                value={reply}
                onChange={(e) => setReply(e.target.value)}
                rows={2}
                placeholder="Nhập nội dung phản hồi gửi khách..."
                className="flex-1 dev-input px-3 py-2 text-xs font-sans resize-none"
              />
              <button
                onClick={() => reply.trim() && replyMut.mutate({ id: detail.id, message: reply.trim() })}
                disabled={!reply.trim() || replyMut.isPending}
                className="px-3 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-medium disabled:opacity-50 transition-all cursor-pointer shadow-sm"
              >
                <Send size={14} />
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
