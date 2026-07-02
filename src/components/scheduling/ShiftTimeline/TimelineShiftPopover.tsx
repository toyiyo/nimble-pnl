import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { minutesToCompact, isoToLocalMinutes } from '@/lib/shiftCoverage';
import { calculateShiftHours } from '@/lib/scheduleRoster';
import type { Shift } from '@/types/scheduling';

interface TimelineShiftPopoverProps {
  /** The currently active shift to show, or null when none is selected. */
  readonly activeShift: Shift | null;
  /** Restaurant IANA timezone for displaying local times. */
  readonly tz: string;
  /** The calendar date string (YYYY-MM-DD) of the selected day. */
  readonly dateStr: string;
  /** Called when the popover is closed or dismissed. */
  readonly onClose: () => void;
}

/**
 * A single read-only shadcn Popover that shows the details of the active shift.
 *
 * Per the CLAUDE.md single-dialog pattern, this is ONE instance rendered at the
 * container level (ShiftTimelineTab), controlled by `activeShift` state.  Each
 * shift bar sets the active shift via `onSelect`; this component opens/closes
 * based on whether `activeShift` is non-null.
 *
 * When used without an explicit `trigger`, it renders as a floating panel
 * anchored to the top-left of the viewport via an invisible zero-size trigger.
 */
export function TimelineShiftPopover({
  activeShift,
  tz,
  dateStr,
  onClose,
}: TimelineShiftPopoverProps) {
  if (!activeShift) return null;

  const leftMin = isoToLocalMinutes(activeShift.start_time, dateStr, tz);
  let endMin = isoToLocalMinutes(activeShift.end_time, dateStr, tz);
  if (endMin <= leftMin) endMin += 1440;

  const startLabel = minutesToCompact(leftMin);
  const endLabel = minutesToCompact(endMin % 1440);
  const hours = calculateShiftHours(activeShift).toFixed(1);

  const statusLabel =
    activeShift.status.charAt(0).toUpperCase() + activeShift.status.slice(1);

  return (
    <Popover open onOpenChange={(open) => { if (!open) onClose(); }}>
      {/* Zero-size invisible trigger so Radix has an anchor to position against */}
      <PopoverTrigger asChild>
        <span className="sr-only" />
      </PopoverTrigger>

      <PopoverContent
        className="w-64 p-0 gap-0 border-border/40"
        align="center"
        sideOffset={8}
      >
        {/* Header */}
        <div className="px-4 pt-4 pb-3 border-b border-border/40">
          <p className="text-[14px] font-semibold text-foreground truncate">
            {activeShift.position}
          </p>
          <p className="text-[12px] text-muted-foreground mt-0.5">
            {startLabel} – {endLabel} · {hours}h
          </p>
        </div>

        {/* Details */}
        <div className="px-4 py-3 space-y-2">
          {activeShift.notes && (
            <Row label="Notes" value={activeShift.notes} />
          )}
          <Row label="Status" value={statusLabel} />
          <Row label="Hours" value={`${hours}h`} />
        </div>
      </PopoverContent>
    </Popover>
  );
}

function Row({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider">
        {label}
      </span>
      <span className="text-[13px] text-foreground">{value}</span>
    </div>
  );
}
