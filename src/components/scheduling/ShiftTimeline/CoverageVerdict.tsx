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

/** `1 → "1 hour"`, `2 → "2 hours"`. */
function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

// ── Chips ────────────────────────────────────────────────────────────────────

interface ChipSpec {
  readonly count: number;
  readonly dot: string;
  readonly label: string;
}

/**
 * The colored-dot + count chips beneath the verdict sentence (design mock's
 * `.chips` row). Only nonzero categories render, so a fully-covered day shows a
 * single "covered" chip rather than a wall of zeroes. `data-testid` lets the
 * chart legend and this row stay independently testable.
 */
function VerdictChips({ verdict }: { readonly verdict: CVType }) {
  const chips: ChipSpec[] = [
    { count: verdict.demandShortHours, dot: 'bg-destructive', label: 'short on demand' },
    { count: verdict.floorOnlyHours, dot: 'bg-warning', label: 'at the floor only' },
    { count: verdict.coveredHours, dot: 'bg-primary', label: 'covered' },
    { count: verdict.nodataHours, dot: 'bg-muted-foreground/40', label: 'no sales history' },
  ].filter((c) => c.count > 0);

  if (chips.length === 0) return null;

  return (
    <div data-testid="coverage-verdict-chips" className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
      {chips.map((c) => (
        <span key={c.label} className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
          <span aria-hidden className={`h-2 w-2 flex-shrink-0 rounded-full ${c.dot}`} />
          <span className="font-medium tabular-nums text-foreground">{c.count}</span>
          {c.label}
        </span>
      ))}
    </div>
  );
}

// ── Verdict ────────────────────────────────────────────────────────────────

/**
 * Plain-language coverage verdict shown above the coverage chart — the mock's
 * lead sentence that tells the manager, in words, *why* the day is short:
 *
 * - No demand configured → "Add staffing targets to see where sales justify
 *   more hands."
 * - Everything covered → "Every hour is covered — you're meeting demand all day."
 * - Otherwise a two-clause sentence distinguishing **demand-short** hours
 *   (sales genuinely justify more hands, red emphasis) from **floor-only**
 *   hours (demand met, only the minimum-staff rule trips, amber emphasis) —
 *   followed by the chips row.
 *
 * Colors use semantic tokens only (`text-destructive` / `text-warning` /
 * `bg-primary`); the demand/floor emphasis carries meaning, not decoration.
 */
export function CoverageVerdict({
  verdict,
  formatHour = formatCoverageHour,
}: CoverageVerdictProps) {
  const {
    hasDemand,
    minStaff,
    demandShortHours,
    demandShortPeopleHours,
    worstCrit,
    floorOnlyHours,
  } = verdict;

  if (!hasDemand) {
    return (
      <p className="font-serif text-[19px] leading-snug text-muted-foreground max-w-[62ch]">
        Add staffing targets to see where sales justify more hands.
      </p>
    );
  }

  if (demandShortHours === 0 && floorOnlyHours === 0) {
    return (
      <div className="space-y-2.5">
        <p className="font-serif text-[19px] leading-snug text-foreground max-w-[62ch]">
          Every hour is covered — you're meeting demand all day.
        </p>
        <VerdictChips verdict={verdict} />
      </div>
    );
  }

  const critClause = demandShortHours > 0 && (
    <>
      Sales justify{' '}
      <span className="font-medium text-destructive">
        {plural(demandShortPeopleHours, 'more people-hour', 'more people-hours')}
      </span>{' '}
      than you've scheduled
      {worstCrit && (
        <>
          , worst at {formatHour(worstCrit.hour)} (short {worstCrit.short})
        </>
      )}
      .{' '}
    </>
  );

  const floorClause = floorOnlyHours > 0 && (
    <>
      {demandShortHours > 0 ? 'Another ' : ''}
      <span className="font-medium text-warning">
        {plural(floorOnlyHours, 'hour', 'hours')}
      </span>{' '}
      only {floorOnlyHours === 1 ? 'trips' : 'trip'} the {minStaff}-person floor — demand there is
      already met.
    </>
  );

  return (
    <div className="space-y-2.5">
      <p className="font-serif text-[19px] leading-snug text-foreground max-w-[62ch]">
        {critClause}
        {floorClause}
      </p>
      <VerdictChips verdict={verdict} />
    </div>
  );
}
