export default function TabFilter({ tabs, active, onChange }) {
  return (
    <div className="flex gap-1 mb-4">
      {tabs.map((tab) => (
        <button
          key={tab.value}
          onClick={() => onChange(tab.value)}
          className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
            active === tab.value
              ? "bg-primary-500 text-white"
              : "bg-gray-100 text-gray-600 hover:bg-gray-200"
          }`}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
