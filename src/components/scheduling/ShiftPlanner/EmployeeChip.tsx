import { memo } from 'react';

import { X } from 'lucide-react';

import { cn } from '@/lib/utils';
import { getPositionColors } from '@/lib/positionColors';

import { ConflictBadge, sameConflictLines } from './ConflictBadge';

import type { Shift } from '@/types/scheduling';

interface EmployeeChipProps {
  employeeName: string;
  shiftId: string;
  position: string;
  source?: Shift['source'];
  /** Employee's home area. */
  homeArea?: string | null;
  /** The area of the cell this chip renders in (template area). */
  cellArea?: string | null;
  /** Display-ready conflict lines (usePlannerShiftConflicts). Non-empty
   *  adds the amber left border and the ConflictBadge. */
  conflictLines?: string[];
  onRemove: (shiftId: string) => void;
}

export const EmployeeChip = memo(
  function EmployeeChip({
    employeeName,
    shiftId,
    position,
    source,
    homeArea,
    cellArea,
    conflictLines = [],
    onRemove,
  }: EmployeeChipProps) {
    const colors = getPositionColors(position);
    const isCovering = !!homeArea && !!cellArea && homeArea !== cellArea;
    const hasConflicts = conflictLines.length > 0;

    return (
      <div
        className={cn(
          'flex items-center gap-1 px-2 py-1 rounded-md border text-[12px] font-medium',
          colors.bg,
          colors.border,
          colors.text,
          isCovering && 'border-dashed',
          // Same low-contrast warning treatment as TimelineBar — the
          // position color stays the fill.
          hasConflicts && 'border-l-2 border-l-amber-500',
        )}
      >
        <ConflictBadge lines={conflictLines} />
        {source === 'ai' && (
          <span className="text-violet-400 text-[10px] shrink-0" aria-label="AI generated">✦</span>
        )}
        {isCovering && (
          <span
            className="shrink-0 truncate max-w-[72px] text-[10px] px-1 rounded bg-muted/50 text-muted-foreground"
            title={`Covering from ${homeArea}`}
          >
            {homeArea}
          </span>
        )}
        <span className="truncate">{employeeName}</span>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onRemove(shiftId);
          }}
          aria-label={isCovering
            ? `Remove ${employeeName} from shift (covering from ${homeArea})`
            : `Remove ${employeeName} from shift`}
          className="shrink-0 ml-0.5 rounded hover:bg-foreground/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-current p-0.5"
        >
          <X className="h-3 w-3" />
        </button>
      </div>
    );
  },
  (prev, next) =>
    prev.shiftId === next.shiftId &&
    prev.employeeName === next.employeeName &&
    prev.position === next.position &&
    prev.source === next.source &&
    prev.homeArea === next.homeArea &&
    prev.cellArea === next.cellArea &&
    sameConflictLines(prev.conflictLines, next.conflictLines) &&
    prev.onRemove === next.onRemove,
);
