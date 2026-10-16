export default function Pagination({ page, totalPages, total, pageSize = 20, onPage, onPageSize }) {
  const pageSizeOptions = [10, 20, 50, 100];

  const pages = [];
  const range = 2;
  for (let i = Math.max(1, page - range); i <= Math.min(totalPages, page + range); i++) {
    pages.push(i);
  }

  return (
    <div className="flex items-center justify-between pt-3.5 mt-2 thin-divider">
      <span className="text-xs text-slate-400 font-mono">
        <span className="font-semibold text-slate-200">{total}</span> items · page{" "}
        <span className="font-semibold text-electric-cyan">{page}</span>/{totalPages}
      </span>

      <div className="flex items-center gap-2">
        <select
          value={pageSize}
          onChange={(e) => onPageSize?.(Number(e.target.value))}
          className="dev-input rounded-lg px-2 py-1 text-xs font-mono cursor-pointer focus:outline-none"
        >
          {pageSizeOptions.map((s) => (
            <option key={s} value={s}>{s} / page</option>
          ))}
        </select>

        <div className="flex gap-1 font-mono">
          <button
            disabled={page <= 1}
            onClick={() => onPage?.(page - 1)}
            className="w-7 h-7 flex items-center justify-center rounded-lg text-xs font-mono bg-slate-900 border border-slate-800 text-slate-400 disabled:opacity-30 hover:text-slate-100 hover:border-slate-700 transition-colors"
          >
            ‹
          </button>
          {pages.map((p) => (
            <button
              key={p}
              onClick={() => onPage?.(p)}
              className={`w-7 h-7 flex items-center justify-center rounded-lg text-xs font-mono transition-colors ${
                p === page
                  ? "bg-electric-indigo text-white font-semibold shadow-sm"
                  : "bg-slate-900 border border-slate-800 text-slate-400 hover:text-slate-200 hover:border-slate-700"
              }`}
            >
              {p}
            </button>
          ))}
          <button
            disabled={page >= totalPages}
            onClick={() => onPage?.(page + 1)}
            className="w-7 h-7 flex items-center justify-center rounded-lg text-xs font-mono bg-slate-900 border border-slate-800 text-slate-400 disabled:opacity-30 hover:text-slate-100 hover:border-slate-700 transition-colors"
          >
            ›
          </button>
        </div>
      </div>
    </div>
  );
}
