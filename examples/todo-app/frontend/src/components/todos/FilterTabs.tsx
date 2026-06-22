// src/components/todos/FilterTabs.tsx
// Story: S-TODO-04 (frontend)
// Maps to REQ: REQ-005
//
// Three filter tabs (All / Active / Completed) with counts.
// The active tab is visually highlighted. Clicking a tab calls setFilter.

import type { StatusFilter } from '../../hooks/useTodos'

interface FilterTabsProps {
  filter: StatusFilter
  counts: Record<StatusFilter, number>
  onFilterChange: (f: StatusFilter) => void
}

const TABS: { key: StatusFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'active', label: 'Active' },
  { key: 'completed', label: 'Completed' },
]

export function FilterTabs({ filter, counts, onFilterChange }: FilterTabsProps) {
  return (
    <div className="filter-tabs" role="tablist" aria-label="Filter todos">
      {TABS.map(({ key, label }) => (
        <button
          key={key}
          role="tab"
          aria-selected={filter === key}
          className={`filter-tab${filter === key ? ' filter-tab--active' : ''}`}
          onClick={() => onFilterChange(key)}
          type="button"
        >
          {label} ({counts[key]})
        </button>
      ))}
    </div>
  )
}
