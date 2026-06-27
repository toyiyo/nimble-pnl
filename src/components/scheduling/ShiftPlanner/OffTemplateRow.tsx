import { Clock, X } from 'lucide-react';

import type { Shift } from '@/types/scheduling';
import { cn } from '@/lib/utils';
import { formatLocalTime } from '@/hooks/useShiftPlanner';

interface OffTemplateRowProps {
  area: string;
  weekDays: string[];
  /** Map<day, Shift[]> for this area's unmatched shifts. */
  shiftsByDay: Map<string, Shift[]>;
  onRemoveShift: (shiftId: string) => void;
}

/** Compact 12h label from "HH:MM:SS", e.g. "13:00:00" -> "1:00p", "09:00:00" -> "9a". */
function compact(t: string): string {
  const [h, m] = t.split(':').map(Number);
  const ampm = h >= 12 ? 'p' : 'a';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return m === 0 ? `${h12}${ampm}` : `${h12}:${String(m).padStart(2, '0')}${ampm}`;
}

/** Read-only lane that surfaces shifts not bound to any active template.
 *  Renders the row label + 7 day cells; NOT a drag target (no useDroppable). */
export function OffTemplateRow({ area, weekDays, shiftsByDay, onRemoveShift }: Readonly<OffTemplateRowProps>) {
  return (
    <div className="contents">
      <div className="border-t border-border/40 p-2 md:p-3 flex flex-col justify-center">
        <div className="flex items-center gap-1.5 text-[12px] font-medium text-muted-foreground">
          <Clock className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span className="truncate">Off-template</span>
        </div>
        <span className="text-[11px] text-muted-foreground/70">odd hours · no plan</span>
      </div>
      {weekDays.map((day) => {
        const shifts = shiftsByDay.get(day) ?? [];
        return (
          <div
            key={day}
            data-testid="off-template-cell"
            className="border-t border-l border-border/40 min-h-[64px] p-1.5 space-y-1"
          >
            {shifts.map((s) => (
              <div
                key={s.id}
                className={cn(
                  'flex items-center gap-1 px-2 py-1 rounded-md border border-dashed border-border/60',
                  'bg-muted/30 text-[12px] text-foreground',
                )}
              >
                <span className="truncate">{s.employee?.name ?? 'Unassigned'}</span>
                <span className="shrink-0 text-[10px] text-muted-foreground tabular-nums">
                  {compact(formatLocalTime(s.start_time))}–{compact(formatLocalTime(s.end_time))}
                </span>
                <button
                  type="button"
                  onClick={() => onRemoveShift(s.id)}
                  aria-label={`Remove off-template shift for ${s.employee?.name ?? 'employee'}`}
                  className="shrink-0 ml-auto rounded hover:bg-foreground/10 p-0.5"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}
