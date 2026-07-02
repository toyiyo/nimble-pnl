import type { CoverageHour } from '@/lib/coverageSummary';
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
 * Format a clock hour (0-23) into a compact 12-hour label, e.g. 0 → "12 AM", 17 → "5 PM".
 */
function defaultFormatHour(hour: number): string {
  const h24 = ((hour % 24) + 24) % 24;
  const period = h24 < 12 ? 'AM' : 'PM';
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12} ${period}`;
}

/**
 * Derive an aria-label for a single hour cell.
 *
 * - Short: "{Hour label}, short {N}"
 * - Covered: "{Hour label}, covered"
 * - No demand: "{Hour label}"  (neutral)
 */
function cellAriaLabel(hour: CoverageHour, label: string): string {
  if (hour.delta === null) {
    // No demand configured — just announce the hour
    return label;
  }
  if (hour.delta < 0) {
    return `${label}, short ${Math.abs(hour.delta)}`;
  }
  return `${label}, covered`;
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
  formatHour = defaultFormatHour,
}: CoverageStatusStripProps) {
  if (hours.length === 0) return null;

  const shortHours = hours.filter((h) => h.delta !== null && h.delta < 0);

  return (
    <div className="space-y-1">
      {/* Visual strip of per-hour cells */}
      <div className="flex gap-0.5" role="group" aria-label="Hourly coverage status">
        {hours.map((h) => {
          const label = formatHour(h.hour);
          const ariaLabel = cellAriaLabel(h, label);
          const isShort = h.delta !== null && h.delta < 0;
          const hasDemand = h.delta !== null;

          return (
            <div
              key={h.startMin}
              aria-label={ariaLabel}
              title={ariaLabel}
              className={cn(
                'flex min-w-0 flex-1 flex-col items-center gap-0.5 rounded py-1 px-0.5',
                isShort
                  ? 'bg-destructive/15 text-destructive'
                  : hasDemand
                    ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400'
                    : 'bg-muted/50 text-muted-foreground',
              )}
            >
              <span className="text-[10px] font-medium leading-none">{label}</span>
              {hasDemand && (
                <span className="text-[10px] leading-none">
                  {isShort ? `−${Math.abs(h.delta as number)}` : '✓'}
                </span>
              )}
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
