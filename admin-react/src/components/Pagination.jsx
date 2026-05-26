export default function Pagination({ page, totalPages, total, pageSize = 20, onPage, onPageSize }) {
  const pageSizeOptions = [10, 20, 50, 100];

  const pages = [];
  const range = 2;
  for (let i = Math.max(1, page - range); i <= Math.min(totalPages, page + range); i++) {
    pages.push(i);
  }

  return (
    <div className="flex items-center justify-between pt-4 mt-1 border-t border-gray-50">
      <span className="text-xs text-gray-400">
        <span className="font-semibold text-gray-600">{total}</span> mục ·
        trang <span className="font-semibold text-gray-600">{page}</span>/{totalPages}
      </span>
      <div className="flex items-center gap-2">
        <select
          value={pageSize}
          onChange={(e) => onPageSize?.(Number(e.target.value))}
          className="border border-gray-200 rounded-lg px-2 py-1 text-xs text-gray-600 bg-white hover:border-gray-300 cursor-pointer focus:outline-none"
        >
          {pageSizeOptions.map((s) => (
            <option key={s} value={s}>{s} / trang</option>
          ))}
        </select>
        <div className="flex gap-0.5">
          <button
            disabled={page <= 1}
            onClick={() => onPage?.(page - 1)}
            className="w-7 h-7 flex items-center justify-center border border-gray-200 rounded-lg text-sm text-gray-500 disabled:opacity-30 hover:bg-gray-50 hover:border-gray-300 transition-colors"
          >‹</button>
          {pages.map((p) => (
            <button key={p} onClick={() => onPage?.(p)}
              className={`w-7 h-7 flex items-center justify-center rounded-lg text-xs font-medium transition-colors ${
                p === page
                  ? "bg-primary-500 text-white border border-primary-500"
                  : "border border-gray-200 text-gray-500 hover:bg-gray-50 hover:border-gray-300"
              }`}>
              {p}
            </button>
          ))}
          <button
            disabled={page >= totalPages}
            onClick={() => onPage?.(page + 1)}
            className="w-7 h-7 flex items-center justify-center border border-gray-200 rounded-lg text-sm text-gray-500 disabled:opacity-30 hover:bg-gray-50 hover:border-gray-300 transition-colors"
          >›</button>
        </div>
      </div>
    </div>
  );
}
