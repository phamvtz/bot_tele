export default function EmptyState({ icon: Icon, message, action, onAction }) {
  return (
    <div className="flex flex-col items-center justify-center py-14 text-gray-300">
      {Icon && (
        <div className="w-14 h-14 rounded-2xl bg-gray-50 flex items-center justify-center mb-3">
          <Icon size={26} strokeWidth={1.5} className="text-gray-300" />
        </div>
      )}
      <p className="text-sm text-gray-400 font-medium">{message}</p>
      {action && (
        <button
          onClick={onAction}
          className="mt-4 px-4 py-2 bg-primary-500 text-white rounded-lg text-sm font-medium hover:bg-primary-600 transition-colors shadow-sm"
        >
          {action}
        </button>
      )}
    </div>
  );
}
