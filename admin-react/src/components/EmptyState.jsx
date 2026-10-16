export default function EmptyState({ icon: Icon, message, action, onAction }) {
  return (
    <div className="flex flex-col items-center justify-center py-12 px-4 rounded-xl border border-dashed border-slate-800/90 bg-slate-950/30 text-center my-2">
      {Icon && (
        <div className="w-10 h-10 rounded-xl bg-slate-900 border border-slate-800 flex items-center justify-center mb-3 text-slate-500 shadow-sm">
          <Icon size={18} strokeWidth={1.75} />
        </div>
      )}
      <p className="text-xs font-mono text-slate-500 uppercase tracking-wider mb-1">Dữ liệu trống</p>
      <p className="text-xs text-slate-400 max-w-sm tracking-tight">{message}</p>
      {action && (
        <button
          onClick={onAction}
          className="mt-3.5 px-3.5 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-medium border border-indigo-400/30 shadow-sm transition-all cursor-pointer"
        >
          {action}
        </button>
      )}
    </div>
  );
}
