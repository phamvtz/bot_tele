export default function TabFilter({ tabs, active, onChange }) {
  return (
    <div className="flex gap-0.5 border-b border-white/[0.06] mb-4">
      {tabs.map((tab) => (
        <button
          key={tab.value}
          onClick={() => onChange(tab.value)}
          className={`relative px-3.5 py-2 text-sm font-medium transition-colors whitespace-nowrap ${
            active === tab.value
              ? "text-primary-400"
              : "text-gray-500 hover:text-gray-300"
          }`}
        >
          {tab.label}
          {active === tab.value && (
            <span className="absolute bottom-0 left-0 right-0 h-[2px] bg-primary-500 rounded-t-full" />
          )}
        </button>
      ))}
    </div>
  );
}
