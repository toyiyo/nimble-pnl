import type { BreakEvenData } from '@/types/operatingCosts';
import { buildDayGridCells } from '@/lib/breakEvenDayGrid';

type BreakEvenHistoryRow = BreakEvenData['history'][number];

interface BreakEvenDayGridProps {
  history: BreakEvenHistoryRow[];
}

/** Show one day per cell, from the break-even history, as a small heat grid. */
export function BreakEvenDayGrid({ history }: BreakEvenDayGridProps) {
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
          className={`h-6 w-6 rounded-md ${cell.fillClass} hover:opacity-80 transition-opacity focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring`}
        />
      ))}
    </div>
  );
}
