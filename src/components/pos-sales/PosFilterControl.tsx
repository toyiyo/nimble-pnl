import { memo } from 'react';

import { posColor, posLabel } from '@/lib/posColors';
import type { PosFilter } from '@/lib/salesTrends';

interface PosFilterControlProps {
  posSystems: string[];
  value: PosFilter;
  onChange: (pos: PosFilter) => void;
}

/**
 * Plain-button segmented control (NOT `role="tablist"`) — matches the
 * `categorizationFilter`/`recipeFilter` pills already in `POSSales.tsx`.
 * Rendered only when >1 POS system is present in the range (design §4.2).
 */
export const PosFilterControl = memo(function PosFilterControl({
  posSystems,
  value,
  onChange,
}: PosFilterControlProps) {
  if (posSystems.length <= 1) return null;

  return (
    <div
      role="group"
      aria-label="Filter sales trends by POS system"
      className="inline-flex flex-wrap items-center gap-0.5 rounded-lg bg-muted/50 p-0.5"
    >
      <PillButton pressed={value === 'all'} onClick={() => onChange('all')}>
        All POS
      </PillButton>
      {posSystems.map((pos) => (
        <PillButton key={pos} pressed={value === pos} onClick={() => onChange(pos)}>
          <span
            className="h-2 w-2 rounded-full shrink-0"
            style={{ backgroundColor: posColor(pos) }}
            aria-hidden="true"
          />
          {posLabel(pos)}
        </PillButton>
      ))}
    </div>
  );
});

function PillButton({
  pressed,
  onClick,
  children,
}: {
  pressed: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-[13px] font-medium rounded-md transition-colors ${
        pressed ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
      }`}
    >
      {children}
    </button>
  );
}
