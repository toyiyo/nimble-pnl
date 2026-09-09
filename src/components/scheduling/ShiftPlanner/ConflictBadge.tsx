import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

import { AlertTriangle } from 'lucide-react';

interface ConflictBadgeProps {
  /** Display-ready conflict lines from usePlannerShiftConflicts. */
  lines: string[];
}

/** Element-wise equality of two conflict-line lists, for the EmployeeChip and
 *  ShiftCell memo comparators. The conflict map rebuilds wholesale on every
 *  planner edit, so reference equality would re-render every chip. */
export function sameConflictLines(a: string[] | undefined, b: string[] | undefined): boolean {
  if (a === b) return true;
  if (!a || !b || a.length !== b.length) return false;
  return a.every((line, i) => line === b[i]);
}

/**
 * Shared triangle-with-tooltip affordance for a conflicted planner shift.
 * Rendered by EmployeeChip, OffTemplateRow, and HiddenTemplatesRow so every
 * lane marks a conflict the same way.
 *
 * The click handler stops propagation: the chip sits inside a ShiftCell
 * whose cell-level onClick assigns the selected employee on mobile tap —
 * a tap on the badge must not assign.
 */
export function ConflictBadge({ lines }: Readonly<ConflictBadgeProps>) {
  if (lines.length === 0) return null;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={(e) => e.stopPropagation()}
          aria-label={`Conflicts: ${lines.join('. ')}`}
          className="shrink-0 rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-current"
        >
          <AlertTriangle className="h-3 w-3 text-amber-500" aria-hidden="true" />
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-xs">
        <div className="space-y-1">
          {lines.map((line) => (
            <p key={line} className="text-xs">
              • {line}
            </p>
          ))}
        </div>
      </TooltipContent>
    </Tooltip>
  );
}
