import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ScrollText } from "lucide-react";
import { api } from "../../api/endpoints";
import Pagination from "../../components/Pagination";
import EmptyState from "../../components/EmptyState";
import { formatDate } from "../../utils/format";

export default function BotLogs() {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  const { data, isLoading } = useQuery({
    queryKey: ["audit-logs", page, pageSize],
    queryFn: () => api.auditLogs({ page, limit: pageSize }),
  });

  const logs = data?.logs || [];
  const total = data?.total || 0;
  const totalPages = Math.ceil(total / pageSize) || 1;

  return (
    <div>
      <h1 className="text-xl font-bold text-white mb-1">Nhật ký Bot</h1>
      <p className="text-sm text-gray-500 mb-5">Lịch sử hành động của admin</p>

      <div className="glass rounded-xl p-4">
        {isLoading ? (
          <p className="text-center py-8 text-sm text-gray-400">Đang tải...</p>
        ) : logs.length === 0 ? (
          <EmptyState icon={ScrollText} message="Chưa có nhật ký nào" />
        ) : (
          <>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/[0.06] text-left text-xs text-gray-500">
                  <th className="px-3 py-2.5 font-medium rounded-l-lg">Hành động</th>
                  <th className="px-3 py-2.5 font-medium">Admin</th>
                  <th className="px-3 py-2.5 font-medium">Chi tiết</th>
                  <th className="px-3 py-2.5 font-medium rounded-r-lg">Thời gian</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((log) => (
                  <tr key={log.id} className="border-b border-white/[0.04] hover:bg-white/[0.03] transition-colors">
                    <td className="px-3 py-3">
                      <span className="text-xs px-2 py-0.5 rounded bg-blue-950/60 text-blue-300 border border-blue-800/50 font-mono">{log.action}</span>
                    </td>
                    <td className="px-3 py-3 text-gray-300">{log.adminId || "—"}</td>
                    <td className="px-3 py-3 text-xs text-gray-500 max-w-[300px] truncate">{log.details || "—"}</td>
                    <td className="px-3 py-3 text-xs text-gray-400">{formatDate(log.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <Pagination page={page} totalPages={totalPages} total={total} pageSize={pageSize} onPage={setPage} onPageSize={(s) => { setPageSize(s); setPage(1); }} />
          </>
        )}
      </div>
    </div>
  );
}
