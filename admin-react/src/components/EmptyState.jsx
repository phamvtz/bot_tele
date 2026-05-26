export default function EmptyState({ icon: Icon, message, action, onAction }) {
  return (
    <div className="flex flex-col items-center justify-center py-14">
      {Icon && (
        <div className="w-14 h-14 rounded-2xl glass flex items-center justify-center mb-3">
          <Icon size={26} strokeWidth={1.5} className="text-gray-500" />
        </div>
      )}
      <p className="text-sm text-gray-500 font-medium">{message}</p>
      {action && (
        <button
          onClick={onAction}
          className="mt-4 px-4 py-2 bg-primary-600 text-white rounded-lg text-sm font-medium hover:bg-primary-500 shadow-glow-sm hover:shadow-glow transition-all"
        >
          {action}
        </button>
      )}
    </div>
  );
}
