import { EyeOff, X } from 'lucide-react';

import type { Shift } from '@/types/scheduling';
import { cn } from '@/lib/utils';
import { formatLocalTime } from '@/hooks/useShiftPlanner';
import { formatCompactTime } from '@/lib/openShiftHelpers';

interface HiddenTemplatesRowProps {
  weekDays: string[];
  /** Map<day, Shift[]> merged across all hidden templates (all areas). */
  shiftsByDay: Map<string, Shift[]>;
  onRemoveShift: (shiftId: string) => void;
  /** Called when "Show templates" is clicked — sets showHidden = true at the tab level. */
  onShowHidden: () => void;
}

/** Builds the "N shift(s) kept" subtitle fragment. */
function keptShiftLabel(count: number): string {
  return count === 1 ? '1 shift kept' : `${count} shifts kept`;
}

/** Read-only lane surfacing shifts assigned to hidden templates, rendered when
 *  `showHidden === false` and it has shifts this week. Renders the row label + 7 day
 *  cells; NOT a drag target (no useDroppable) — same grid column contract as
 *  `OffTemplateRow`. Chips render dimmed (ghost treatment) but keep their remove action. */
export function HiddenTemplatesRow({
  weekDays,
  shiftsByDay,
  onRemoveShift,
  onShowHidden,
}: Readonly<HiddenTemplatesRowProps>) {
  const totalShifts = Array.from(shiftsByDay.values()).reduce((sum, shifts) => sum + shifts.length, 0);

  return (
    <div className="contents">
      <div className="border-t border-border/40 p-2 md:p-3 flex flex-col justify-center">
        <div className="flex items-center gap-1.5 text-[13px] font-medium text-muted-foreground">
          <EyeOff className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span className="truncate">From hidden templates</span>
        </div>
        <span className="text-[12px] text-muted-foreground/70">
          {keptShiftLabel(totalShifts)} ·{' '}
          <button
            type="button"
            onClick={onShowHidden}
            className="underline underline-offset-2 text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-current rounded"
          >
            Show templates
          </button>
        </span>
      </div>
      {weekDays.map((day) => {
        const shifts = shiftsByDay.get(day) ?? [];
        return (
          <div
            key={day}
            data-testid="hidden-templates-cell"
            className="border-t border-l border-border/40 min-h-[64px] p-1.5 space-y-1"
          >
            {shifts.map((s) => {
              const employeeLabel = s.employee?.name ?? 'Unassigned';
              return (
                <div
                  key={s.id}
                  className={cn(
                    'flex items-center gap-1 px-2 py-1 rounded-md border border-dashed border-border/60',
                    'bg-muted/30 text-[12px] text-foreground opacity-60',
                  )}
                >
                  <span className="truncate">{employeeLabel}</span>
                  <span className="shrink-0 text-[10px] text-muted-foreground tabular-nums">
                    {formatCompactTime(formatLocalTime(s.start_time))}–{formatCompactTime(formatLocalTime(s.end_time))}
                  </span>
                  <button
                    type="button"
                    onClick={() => onRemoveShift(s.id)}
                    aria-label={`Remove ${employeeLabel} from hidden-template shift`}
                    className="shrink-0 ml-auto rounded hover:bg-foreground/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-current p-0.5"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}
