import type { CoverageVerdict as CVType } from '@/lib/coverageSummary';
import { formatCoverageHour } from '@/lib/coverageSummary';

interface CoverageVerdictProps {
  /** The verdict object computed by `buildVerdict` from `src/lib/coverageSummary`. */
  readonly verdict: CVType;
  /**
   * Optional override for formatting a clock hour (0–23) into a human-readable
   * string, e.g. `17 → "5 PM"`.  Defaults to a built-in 12-hour formatter.
   */
  readonly formatHour?: (hour: number) => string;
}

/**
 * Plain-language coverage verdict displayed above the coverage chart.
 *
 * Three states:
 * - No demand configured → neutral dot + "Add staffing targets to see demand."
 * - All hours met → green dot + "Meeting demand all day."
 * - Some hours short → red dot + "Short-staffed N of M hours today" + worst-hour subline.
 *
 * Colors use semantic tokens only (never direct bg-* color literals).
 */
export function CoverageVerdict({
  verdict,
  formatHour = formatCoverageHour,
}: CoverageVerdictProps) {
  const { hasDemand, metAll, shortHours, totalHours, worst } = verdict;

  if (!hasDemand) {
    return (
      <div className="flex items-center gap-2 py-1">
        <span
          aria-hidden
          className="h-2.5 w-2.5 flex-shrink-0 rounded-full bg-muted-foreground/50"
        />
        <p className="text-[15px] font-medium text-muted-foreground">
          Add staffing targets to see demand.
        </p>
      </div>
    );
  }

  if (metAll) {
    return (
      <div className="flex items-center gap-2 py-1">
        <span
          aria-hidden
          className="h-2.5 w-2.5 flex-shrink-0 rounded-full bg-success"
        />
        <p className="text-[15px] font-medium text-foreground">
          Meeting demand all day.
        </p>
      </div>
    );
  }

  // Short-staffed state
  const worstLabel = worst ? formatHour(worst.hour) : null;
  const deficit = worst ? Math.abs(worst.delta) : null;

  return (
    <div className="flex items-start gap-2 py-1">
      <span
        aria-hidden
        className="mt-[3px] h-2.5 w-2.5 flex-shrink-0 rounded-full bg-destructive"
      />
      <div>
        <p className="text-[15px] font-medium text-foreground">
          Short-staffed {shortHours} of {totalHours} hours today
        </p>
        {worstLabel !== null && deficit !== null && (
          <p className="text-[13px] text-muted-foreground mt-0.5">
            Biggest gap: {worstLabel} — short {deficit}
          </p>
        )}
      </div>
    </div>
  );
}
