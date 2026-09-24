import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

import { AlertTriangle } from 'lucide-react';

interface ConflictBadgeProps {
  /** Display-ready conflict lines from usePlannerShiftConflicts. */
  lines: string[];
}

/** Amber left-border treatment for a conflicted row or chip — the semantic
 *  `warning` token resolves to the same amber TimelineBar uses. Defined once
 *  and shared by every render site. */
export const CONFLICT_BORDER_CLASS = 'border-l-2 border-l-warning';

/**
 * Shared triangle affordance for a conflicted planner shift. Rendered by
 * EmployeeChip, OffTemplateRow, and HiddenTemplatesRow so every lane marks
 * a conflict the same way.
 *
 * A Popover, not a Tooltip: a Radix tooltip never opens from touch, and the
 * planner runs on mobile. A click or a tap opens the conflict lines — the
 * same click-opened idiom the coverage indicator uses. The trigger stops
 * propagation: the chip sits inside a ShiftCell whose cell-level onClick
 * assigns the selected employee on mobile tap — a tap on the badge must
 * not assign.
 */
export function ConflictBadge({ lines }: Readonly<ConflictBadgeProps>) {
  if (lines.length === 0) return null;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          onClick={(e) => e.stopPropagation()}
          aria-label={`Conflicts: ${lines.join('. ')}`}
          className="shrink-0 rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-current"
        >
          <AlertTriangle className="h-3 w-3 text-warning" aria-hidden="true" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        className="w-auto max-w-xs p-2.5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="space-y-1">
          {/* Index keys are safe: each render replaces the full list and
              never reorders it, and two identical time-off requests can
              produce identical line text. */}
          {lines.map((line, i) => (
            <p key={i} className="text-xs">
              • {line}
            </p>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
