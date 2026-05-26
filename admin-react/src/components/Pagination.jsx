export default function Pagination({ page, totalPages, total, pageSize = 20, onPage, onPageSize }) {
  const pageSizeOptions = [10, 20, 50, 100];

  const pages = [];
  const range = 2;
  for (let i = Math.max(1, page - range); i <= Math.min(totalPages, page + range); i++) {
    pages.push(i);
  }

  return (
    <div className="flex items-center justify-between pt-4 mt-1 border-t border-white/[0.06]">
      <span className="text-xs text-gray-500">
        <span className="font-semibold text-gray-300">{total}</span> mục ·
        trang <span className="font-semibold text-gray-300">{page}</span>/{totalPages}
      </span>
      <div className="flex items-center gap-2">
        <select
          value={pageSize}
          onChange={(e) => onPageSize?.(Number(e.target.value))}
          className="glass-input rounded-lg px-2 py-1 text-xs cursor-pointer focus:outline-none"
        >
          {pageSizeOptions.map((s) => (
            <option key={s} value={s}>{s} / trang</option>
          ))}
        </select>
        <div className="flex gap-0.5">
          <button
            disabled={page <= 1}
            onClick={() => onPage?.(page - 1)}
            className="w-7 h-7 flex items-center justify-center glass rounded-lg text-sm text-gray-400 disabled:opacity-30 hover:text-white transition-colors"
          >‹</button>
          {pages.map((p) => (
            <button key={p} onClick={() => onPage?.(p)}
              className={`w-7 h-7 flex items-center justify-center rounded-lg text-xs font-medium transition-colors ${
                p === page
                  ? "bg-primary-600 text-white shadow-glow-sm"
                  : "glass text-gray-400 hover:text-white"
              }`}>
              {p}
            </button>
          ))}
          <button
            disabled={page >= totalPages}
            onClick={() => onPage?.(page + 1)}
            className="w-7 h-7 flex items-center justify-center glass rounded-lg text-sm text-gray-400 disabled:opacity-30 hover:text-white transition-colors"
          >›</button>
        </div>
      </div>
    </div>
  );
}
