export default function EmptyState({ icon: Icon, message, action, onAction }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-gray-400">
      {Icon && <Icon size={40} strokeWidth={1.5} className="mb-3" />}
      <p className="text-sm">{message}</p>
      {action && (
        <button
          onClick={onAction}
          className="mt-4 px-4 py-2 bg-primary-500 text-white rounded-lg text-sm hover:bg-primary-600 transition-colors"
        >
          {action}
        </button>
      )}
    </div>
  );
}
