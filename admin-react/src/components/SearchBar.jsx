import { Search } from "lucide-react";

export default function SearchBar({ placeholder, value, onChange, onSearch, sortOptions, sortValue, onSort, rightSlot }) {
  return (
    <div className="flex items-center gap-2 mb-4">
      <div className="relative flex-1">
        <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
        <input
          type="text"
          placeholder={placeholder}
          value={value}
          onChange={(e) => onChange?.(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && onSearch?.()}
          className="glass-input w-full pl-9 pr-3 py-2 rounded-lg text-sm transition-all"
        />
      </div>
      {sortOptions && (
        <select
          value={sortValue}
          onChange={(e) => onSort?.(e.target.value)}
          className="glass-input rounded-lg px-3 py-2 text-sm cursor-pointer"
        >
          {sortOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      )}
      {rightSlot}
    </div>
  );
}
