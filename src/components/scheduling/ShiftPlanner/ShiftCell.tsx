import { memo } from 'react';

import { useDroppable } from '@dnd-kit/core';
import { AlertTriangle, ArrowRight, Check } from 'lucide-react';

import type { Shift, SlotCoverage, CoveringEmployee } from '@/types/scheduling';
import type { AllocationStatus } from '@/lib/shiftAllocation';

import { cn } from '@/lib/utils';

import { EmployeeChip } from './EmployeeChip';

interface ShiftCellProps {
  templateId: string;
  day: string;
  isActiveDay: boolean;
  shifts: Shift[];
  capacity?: number;
  onRemoveShift: (shiftId: string) => void;
  isHighlighted?: boolean;
  /** Mobile tap-to-assign: called when cell is tapped with an employee selected */
  onMobileTap?: (templateId: string, day: string) => void;
  /** Whether a mobile employee is selected (enables tap-to-assign visual) */
  hasMobileSelection?: boolean;
  allocationStatus?: AllocationStatus;
  pickedEmployeeName?: string;
  /** Coverage data for this slot (computed by ShiftPlannerTab). */
  coverage?: SlotCoverage;
  /** Called when the coverage indicator is clicked; lifted to tab-level popover. */
  onCoverageClick?: (templateId: string, day: string, rect: DOMRect) => void;
  /** Concise slot identity for the coverage indicator aria-label (e.g. "Cold Stone Server").
   *  Derived from template area + position in TemplateGrid. Falls back to "Coverage" when omitted. */
  slotName?: string;
  /** Human-readable weekday name for the coverage indicator aria-label (e.g. "Monday").
   *  When omitted, falls back to the ISO date string which is not screen-reader friendly. */
  dayLabel?: string;
  /** Area of this cell's template (for covering detection on chips). */
  cellArea?: string | null;
  /** De-duped loaned-out ghosts for this cell (employees from this area working elsewhere). */
  ghostLoanedOut?: CoveringEmployee[];
}

/** Tiny badge shown when coverage data is unavailable and capacity > 1. */
function FallbackCapacityBadge({ shifts, capacity }: { shifts: Shift[]; capacity: number }) {
  const openSpots = Math.max(0, capacity - shifts.length);
  const status = openSpots === 0 ? 'full' : shifts.length > 0 ? 'partial' : 'empty';
  return (
    <div
      className={cn(
        'text-[10px] font-medium px-1.5 py-0.5 rounded text-center',
        status === 'full'
          ? 'text-foreground bg-muted/50'
          : status === 'partial'
            ? 'text-muted-foreground bg-muted/30'
            : 'text-destructive bg-destructive/10',
      )}
    >
      {shifts.length}/{capacity}
    </div>
  );
}

export const ShiftCell = memo(
  function ShiftCell({
    templateId,
    day,
    isActiveDay,
    shifts,
    capacity = 1,
    onRemoveShift,
    isHighlighted,
    onMobileTap,
    hasMobileSelection,
    allocationStatus,
    pickedEmployeeName,
    coverage,
    onCoverageClick,
    slotName,
    dayLabel,
    cellArea,
    ghostLoanedOut,
  }: ShiftCellProps) {
    const { isOver, setNodeRef } = useDroppable({
      id: `${templateId}:${day}`,
      data: { templateId, day },
      disabled: !isActiveDay,
    });

    if (!isActiveDay) {
      return (
        <div
          className="min-h-[64px] p-1.5 opacity-60 bg-hatched-inactive"
          aria-label={`${day} inactive`}
        />
      );
    }

    const overlayClass = cn(
      allocationStatus === 'highlight' && 'outline outline-2 outline-primary bg-primary/5',
      allocationStatus === 'conflict' && 'outline outline-2 outline-destructive bg-destructive/10',
      allocationStatus === 'available' && 'bg-primary/5',
    );

    // Always show the coverage indicator when coverage data is available.
    // Two-tier treatment prevents visual noise:
    //   • Fully covered (openSpots === 0): quiet — Check icon, N/N count, text-muted-foreground, no bar.
    //   • Under-covered (openSpots > 0): prominent — AlertTriangle, progress bar, text-destructive.
    const showCoverageIndicator = coverage !== undefined;
    const filledCount = coverage !== undefined ? capacity - coverage.openSpots : 0;

    return (
      <div
        ref={setNodeRef}
        onClick={hasMobileSelection && onMobileTap ? () => onMobileTap(templateId, day) : undefined}
        data-allocation-status={allocationStatus ?? 'none'}
        className={cn(
          'min-h-[64px] p-1.5 space-y-1 transition-colors duration-200 relative',
          'border-l-2 border-primary/40',
          isOver && 'bg-foreground/5 ring-1 ring-foreground/20 rounded',
          isHighlighted && 'bg-primary/10',
          hasMobileSelection && 'bg-primary/5 ring-1 ring-primary/30 rounded cursor-pointer',
          overlayClass,
        )}
      >
        {allocationStatus === 'highlight' && pickedEmployeeName && (
          <div className="absolute top-0 right-0 m-1 text-[10px] font-medium px-1.5 py-0.5 rounded bg-primary text-primary-foreground pointer-events-none">
            {pickedEmployeeName}
          </div>
        )}
        {allocationStatus === 'conflict' && (
          <div className="absolute top-0 right-0 m-1 text-[10px] font-medium px-1.5 py-0.5 rounded bg-destructive text-destructive-foreground pointer-events-none">
            Conflicts
          </div>
        )}
        {shifts.map((shift) => (
          <EmployeeChip
            key={shift.id}
            shiftId={shift.id}
            employeeName={shift.employee?.name ?? 'Unassigned'}
            position={shift.position}
            source={shift.source}
            homeArea={shift.employee?.area ?? null}
            cellArea={cellArea ?? null}
            onRemove={onRemoveShift}
          />
        ))}

        {ghostLoanedOut?.map((g) => (
          <div
            key={`ghost-${g.employeeId}`}
            aria-label={`${g.employeeName ?? 'Employee'} working ${g.workArea ?? 'another area'} this slot`}
            className="flex items-center gap-1 px-2 py-1 rounded-md border border-dashed border-border/50 text-[11px] text-muted-foreground"
          >
            <ArrowRight className="h-3 w-3 shrink-0" aria-hidden="true" />
            <span className="truncate">{g.employeeName ?? 'Employee'}</span>
            <span className="shrink-0 text-[10px]">· at {g.workArea ?? '—'}</span>
          </div>
        ))}

        {/* Coverage indicator — always shown when coverage data is available (two-tier treatment) */}
        {showCoverageIndicator && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onCoverageClick?.(templateId, day, e.currentTarget.getBoundingClientRect());
            }}
            aria-label={[
              `${slotName ?? 'Coverage'} ${dayLabel ?? day}: ${filledCount} of ${capacity} staffed`,
              coverage.openSpots > 0 ? `needs ${coverage.openSpots} more` : '',
              `${coverage.coveragePct}% of window covered`,
              'Open details',
            ].filter(Boolean).join('. ')}
            aria-haspopup="dialog"
            className={cn(
              'mt-1 flex items-center gap-1',
              coverage.openSpots > 0
                ? 'text-[11px] text-destructive'
                : 'text-[10px] text-muted-foreground',
            )}
          >
            {coverage.openSpots > 0 ? (
              /* Under-covered tier: prominent — progress bar + AlertTriangle + "needs N" */
              <>
                <span
                  className="inline-block h-1.5 w-10 rounded-full bg-muted overflow-hidden"
                  aria-hidden="true"
                >
                  <span
                    className="block h-full bg-destructive/70"
                    style={{ width: `${coverage.coveragePct}%` }}
                  />
                </span>
                <AlertTriangle className="h-3 w-3" aria-hidden="true" />
                <span>{filledCount}/{capacity}</span>
              </>
            ) : (
              /* Fully-covered tier: quiet — Check icon + N/N count, no progress bar */
              <>
                <Check className="h-3 w-3" aria-hidden="true" />
                <span>{filledCount}/{capacity}</span>
              </>
            )}
          </button>
        )}

        {/* Fallback capacity badge (only when no coverage data and capacity > 1) */}
        {!coverage && capacity > 1 && (
          <FallbackCapacityBadge shifts={shifts} capacity={capacity} />
        )}
      </div>
    );
  },
  (prev, next) =>
    prev.coverage === next.coverage &&
    prev.templateId === next.templateId &&
    prev.day === next.day &&
    prev.isActiveDay === next.isActiveDay &&
    prev.shifts === next.shifts &&
    prev.capacity === next.capacity &&
    prev.onRemoveShift === next.onRemoveShift &&
    prev.isHighlighted === next.isHighlighted &&
    prev.hasMobileSelection === next.hasMobileSelection &&
    prev.onMobileTap === next.onMobileTap &&
    prev.allocationStatus === next.allocationStatus &&
    prev.pickedEmployeeName === next.pickedEmployeeName &&
    prev.onCoverageClick === next.onCoverageClick &&
    prev.slotName === next.slotName &&
    prev.dayLabel === next.dayLabel &&
    prev.cellArea === next.cellArea &&
    prev.ghostLoanedOut === next.ghostLoanedOut,
);
