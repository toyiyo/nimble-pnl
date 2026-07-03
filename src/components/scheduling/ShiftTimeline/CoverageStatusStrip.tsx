import type { CoverageHour } from '@/lib/coverageSummary';
import { formatCoverageHour } from '@/lib/coverageSummary';
import { cn } from '@/lib/utils';

interface CoverageStatusStripProps {
  /** Per-hour coverage summary produced by `summarizeCoverageHours`. */
  readonly hours: CoverageHour[];
  /**
   * Optional override for formatting a clock hour (0–23) into a human-readable
   * string, e.g. `17 → "5 PM"`.  Defaults to a built-in 12-hour formatter.
   */
  readonly formatHour?: (hour: number) => string;
}

/**
 * Derive an aria-label for a single hour cell.
 *
 * - Short with demand: "{Hour label}, {scheduled} of {needed}, short {N}"
 * - Covered with demand: "{Hour label}, {scheduled} of {needed}, covered"
 * - No demand: "{Hour label}, {scheduled} scheduled"  (neutral)
 */
function cellAriaLabel(hour: CoverageHour, label: string): string {
  if (hour.delta === null || hour.needed === null) {
    // No demand configured — announce hour and scheduled count
    return `${label}, ${hour.scheduled} scheduled`;
  }
  const fraction = `${hour.scheduled} of ${hour.needed}`;
  if (hour.delta < 0) {
    return `${label}, ${fraction}, short ${Math.abs(hour.delta)}`;
  }
  return `${label}, ${fraction}, covered`;
}

/**
 * Per-hour status strip — one colored cell per hour, green for covered and red
 * for short, each carrying an `aria-label` so color is never the only cue.
 *
 * A visually-hidden `<ul aria-label="Understaffed windows">` enumerates each
 * short hour for screen readers, preserving the former `CoverageGapList`
 * accessibility guarantee.
 *
 * Returns null when `hours` is empty.
 */
export function CoverageStatusStrip({
  hours,
  formatHour = formatCoverageHour,
}: CoverageStatusStripProps) {
  if (hours.length === 0) return null;

  const shortHours = hours.filter((h) => h.delta !== null && h.delta < 0);

  return (
    <div className="space-y-1">
      {/* Visual strip of per-hour cells */}
      <div className="flex gap-[3px]" role="group" aria-label="Hourly coverage status">
        {hours.map((h) => {
          const label = formatHour(h.hour);
          const ariaLabel = cellAriaLabel(h, label);
          const isShort = h.delta !== null && h.delta < 0;
          const hasDemand = h.delta !== null;

          let cellColorClass: string;
          if (isShort) {
            cellColorClass = 'bg-destructive/15 text-destructive';
          } else if (hasDemand) {
            cellColorClass = 'bg-success/15 text-success';
          } else {
            cellColorClass = 'bg-muted/50 text-muted-foreground';
          }

          return (
            <div
              key={h.startMin}
              role="img"
              aria-label={ariaLabel}
              title={ariaLabel}
              className={cn(
                'flex min-w-0 flex-1 flex-col items-center gap-0.5 rounded py-1 px-0.5',
                cellColorClass,
              )}
            >
              <span className="text-[9px] font-medium leading-none">{label}</span>
              <span className="text-[11px] leading-none tabular-nums">
                {hasDemand ? `${h.scheduled}/${h.needed!}` : `${h.scheduled}`}
              </span>
            </div>
          );
        })}
      </div>

      {/* Visually-hidden list for screen readers — color-independent enumeration */}
      {shortHours.length > 0 && (
        <ul aria-label="Understaffed windows" className="sr-only">
          {shortHours.map((h) => {
            const label = formatHour(h.hour);
            const deficit = Math.abs(h.delta as number);
            return (
              <li key={h.startMin}>
                {label}: short {deficit} {deficit === 1 ? 'person' : 'people'}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
