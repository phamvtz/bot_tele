export default function Pagination({ page, totalPages, total, pageSize = 20, onPage, onPageSize }) {
  const pageSizeOptions = [10, 20, 50, 100];
  return (
    <div className="flex items-center justify-between pt-3 text-sm text-gray-500">
      <span>
        Trang <b className="text-gray-900">{page}/{totalPages}</b> · {total} mục
      </span>
      <div className="flex items-center gap-3">
        <select
          value={pageSize}
          onChange={(e) => onPageSize?.(Number(e.target.value))}
          className="border border-gray-200 rounded-lg px-2 py-1 text-sm text-gray-700 bg-white"
        >
          {pageSizeOptions.map((s) => (
            <option key={s} value={s}>{s} / trang</option>
          ))}
        </select>
        <div className="flex gap-1">
          <button
            disabled={page <= 1}
            onClick={() => onPage?.(page - 1)}
            className="px-3 py-1 border border-gray-200 rounded-lg disabled:opacity-40 hover:bg-gray-50 transition"
          >
            ‹
          </button>
          <button
            disabled={page >= totalPages}
            onClick={() => onPage?.(page + 1)}
            className="px-3 py-1 border border-gray-200 rounded-lg disabled:opacity-40 hover:bg-gray-50 transition"
          >
            ›
          </button>
        </div>
      </div>
    </div>
  );
}
