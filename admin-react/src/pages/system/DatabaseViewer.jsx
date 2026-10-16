import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Database, Table2, Layers, Search, Code2, Hash } from "lucide-react";
import { api } from "../../api/endpoints";
import EmptyState from "../../components/EmptyState";
import Pagination from "../../components/Pagination";

function renderValue(v) {
  if (v === null || v === undefined) {
    return <span className="text-slate-600 font-mono italic">null</span>;
  }
  if (typeof v === "boolean") {
    return (
      <span className={`font-mono font-semibold ${v ? "text-emerald-400" : "text-rose-400"}`}>
        {String(v)}
      </span>
    );
  }
  if (typeof v === "object") {
    const s = JSON.stringify(v);
    return (
      <span className="text-cyan-400/90 font-mono text-[11px]" title={s}>
        {s.length > 50 ? s.slice(0, 50) + "…" : s}
      </span>
    );
  }
  const s = String(v);
  return (
    <span className="text-slate-300 font-mono text-[11px]" title={s}>
      {s.length > 70 ? s.slice(0, 70) + "…" : s}
    </span>
  );
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
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <div className="eyebrow text-electric-cyan mb-1 flex items-center gap-2">
            <span>STORAGE // RAW DATABASE COLLECTIONS</span>
          </div>
          <h1 className="text-xl font-bold tracking-tight text-slate-100">Cơ sở dữ liệu (Inspector)</h1>
          <p className="text-xs text-slate-400 mt-0.5">
            Xem trước cấu trúc và dữ liệu các bảng/collection trong database (Chế độ Read-only)
          </p>
        </div>

        <div className="flex items-center gap-2">
          <span className="mono-badge bg-slate-900 border border-slate-800 text-slate-400">
            COLLECTIONS: {collections.length}
          </span>
          {active && (
            <span className="mono-badge bg-indigo-950/60 border border-indigo-800/60 text-electric-indigo">
              ACTIVE: {active} ({total})
            </span>
          )}
        </div>
      </div>

      {/* Collection Pills Bar */}
      <div className="bento-card p-3">
        <div className="flex items-center gap-2 mb-2 px-1">
          <Layers size={13} className="text-slate-400" />
          <span className="eyebrow text-slate-400">AVAILABLE SCHEMAS</span>
        </div>
        <div className="flex flex-wrap gap-1.5 max-h-40 overflow-y-auto">
          {collections.map((c) => {
            const isSelected = active === c.name;
            return (
              <button
                key={c.name}
                onClick={() => {
                  setActive(c.name);
                  setPage(1);
                }}
                className={`flex items-center gap-2 text-xs font-mono px-3 py-1.5 rounded-lg border transition-all ${
                  isSelected
                    ? "bg-electric-indigo/20 border-electric-indigo text-slate-100 shadow-sm"
                    : "bg-slate-900/80 border-slate-800 text-slate-400 hover:text-slate-200 hover:border-slate-700"
                }`}
              >
                <Table2 size={13} className={isSelected ? "text-electric-cyan" : "text-slate-500"} />
                <span>{c.name}</span>
                <span
                  className={`px-1.5 py-0.5 rounded text-[10px] ${
                    isSelected ? "bg-electric-indigo/40 text-slate-200" : "bg-slate-800 text-slate-400"
                  }`}
                >
                  {c.count}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Main Table Viewer */}
      <div className="bento-card p-4 overflow-hidden">
        {!active ? (
          <div className="py-12">
            <EmptyState icon={Database} message="Chọn một collection ở danh sách bên trên để tải dữ liệu" />
          </div>
        ) : isLoading ? (
          <div className="py-16 text-center">
            <div className="animate-spin w-6 h-6 border-2 border-electric-indigo border-t-transparent rounded-full mx-auto mb-2" />
            <p className="text-xs font-mono text-slate-500">Đang truy vấn bảng "{active}"...</p>
          </div>
        ) : documents.length === 0 ? (
          <div className="py-12">
            <EmptyState icon={Database} message={`Collection "${active}" hiện tại chưa có bản ghi nào`} />
          </div>
        ) : (
          <div className="space-y-4">
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead>
                  <tr className="border-b border-slate-800/80 bg-slate-950/40">
                    {columns.map((col) => (
                      <th
                        key={col}
                        className="px-3 py-2.5 text-[11px] font-mono font-medium text-slate-400 uppercase tracking-wider whitespace-nowrap"
                      >
                        {col}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/40">
                  {documents.map((doc, i) => (
                    <tr
                      key={doc.id || doc._id || i}
                      className="hover:bg-slate-900/40 transition-colors"
                    >
                      {columns.map((col) => (
                        <td
                          key={col}
                          className="px-3 py-2 text-slate-300 max-w-[260px] truncate whitespace-nowrap align-middle"
                        >
                          {renderValue(doc[col])}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <Pagination
              page={page}
              totalPages={totalPages}
              total={total}
              pageSize={pageSize}
              onPage={setPage}
              onPageSize={(s) => {
                setPageSize(s);
                setPage(1);
              }}
            />
          </div>
        )}
      </div>
    </div>
  );
}
