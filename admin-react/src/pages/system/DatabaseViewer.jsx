import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Database, Table2 } from "lucide-react";
import { api } from "../../api/endpoints";
import EmptyState from "../../components/EmptyState";
import Pagination from "../../components/Pagination";

function renderValue(v) {
  if (v === null || v === undefined) return <span className="text-gray-600">—</span>;
  if (typeof v === "boolean") return <span className={v ? "text-emerald-400" : "text-red-400"}>{String(v)}</span>;
  if (typeof v === "object") {
    const s = JSON.stringify(v);
    return <span className="text-gray-400" title={s}>{s.length > 60 ? s.slice(0, 60) + "…" : s}</span>;
  }
  const s = String(v);
  return s.length > 80 ? <span title={s}>{s.slice(0, 80) + "…"}</span> : s;
}

export default function DatabaseViewer() {
  const [active, setActive] = useState(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  const { data: colData } = useQuery({ queryKey: ["db-collections"], queryFn: api.dbCollections });
  const { data: docData, isLoading } = useQuery({
    queryKey: ["db-docs", active, page, pageSize],
    queryFn: () => api.dbDocuments(active, { page, limit: pageSize }),
    enabled: !!active,
  });

  const collections = colData?.collections || [];
  const documents = docData?.documents || [];
  const total = docData?.total || 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  // Derive columns from first few docs
  const columns = documents.length
    ? [...new Set(documents.flatMap((d) => Object.keys(d)))].slice(0, 8)
    : [];

  return (
    <div>
      <h1 className="text-xl font-bold text-white mb-1">Database</h1>
      <p className="text-sm text-gray-500 mb-5">Xem dữ liệu các collection (chỉ đọc)</p>

      <div className="flex flex-wrap gap-2 mb-4">
        {collections.map((c) => (
          <button key={c.name} onClick={() => { setActive(c.name); setPage(1); }}
            className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border transition-colors ${active === c.name ? "bg-primary-600/30 border-primary-500/50 text-primary-300" : "bg-white/[0.04] border-white/[0.06] text-gray-400 hover:text-white hover:bg-white/[0.08]"}`}>
            <Table2 size={13} /> {c.name}
            <span className="px-1.5 py-0.5 rounded-full bg-white/[0.08] text-[10px] text-gray-300">{c.count}</span>
          </button>
        ))}
      </div>

      <div className="glass rounded-xl p-4 overflow-x-auto">
        {!active ? (
          <EmptyState icon={Database} message="Chọn một collection để xem dữ liệu" />
        ) : isLoading ? (
          <div className="py-14 text-center text-sm text-gray-500">Đang tải...</div>
        ) : documents.length === 0 ? (
          <EmptyState icon={Database} message="Collection rỗng" />
        ) : (
          <>
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-white/[0.06] text-left text-gray-500">
                  {columns.map((col) => (
                    <th key={col} className="px-2.5 py-2 font-medium whitespace-nowrap">{col}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {documents.map((doc, i) => (
                  <tr key={doc.id || i} className="border-b border-white/[0.04] hover:bg-white/[0.03]">
                    {columns.map((col) => (
                      <td key={col} className="px-2.5 py-2 text-gray-300 max-w-[220px] truncate font-mono">
                        {renderValue(doc[col])}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            <Pagination page={page} totalPages={totalPages} total={total} pageSize={pageSize}
              onPage={setPage} onPageSize={(s) => { setPageSize(s); setPage(1); }} />
          </>
        )}
      </div>
    </div>
  );
}
