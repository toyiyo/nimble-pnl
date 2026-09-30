import { Skeleton } from '@/components/ui/skeleton';

import type { BreakEvenData } from '@/types/operatingCosts';
import { buildDayGridCells } from '@/lib/breakEvenDayGrid';

type BreakEvenHistoryRow = BreakEvenData['history'][number];

interface BreakEvenDayGridProps {
  history: BreakEvenHistoryRow[];
  isLoading?: boolean;
  error?: boolean;
}

/** Stable keys for the loading skeleton cells; there is no day data yet to key by. */
const SKELETON_CELL_KEYS = Array.from({ length: 14 }, (_, index) => `skeleton-${index}`);

/** Show one day per cell, from the break-even history, as a small heat grid. */
export function BreakEvenDayGrid({ history, isLoading = false, error = false }: BreakEvenDayGridProps) {
  if (isLoading) {
    return (
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Break-even by day">
        {SKELETON_CELL_KEYS.map((key) => (
          <Skeleton key={key} className="h-6 w-6 rounded-md" />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="px-4 py-6 text-[13px] text-muted-foreground text-center">
        Break-even history is not available right now.
      </div>
    );
  }

  if (history.length === 0) {
    return (
      <div className="px-4 py-6 text-[13px] text-muted-foreground text-center">
        No break-even history yet.
      </div>
    );
  }

  const cells = buildDayGridCells(history);

  return (
    <div className="flex flex-wrap gap-1.5" role="group" aria-label="Break-even by day">
      {cells.map((cell) => (
        <button
          key={cell.date}
          type="button"
          aria-label={cell.ariaLabel}
          title={cell.ariaLabel}
          className={`h-6 w-6 rounded-md ${cell.fillClass} hover:opacity-80 transition-opacity focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring flex items-center justify-center text-[10px] font-medium text-foreground/70`}
        >
          {cell.dayNumber}
        </button>
      ))}
    </div>
  );
}
