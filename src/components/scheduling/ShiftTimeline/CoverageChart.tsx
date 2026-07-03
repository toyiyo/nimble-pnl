import { forwardRef, memo } from 'react';

import type { CoverageHour } from '@/lib/coverageSummary';
import { formatCoverageHour } from '@/lib/coverageSummary';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';

// ── Types ──────────────────────────────────────────────────────────────────────

interface CoverageChartProps {
  /** Hourly coverage summary from `summarizeCoverageHours`. */
  readonly hours: CoverageHour[];
  /** Which chart variant to render. */
  readonly view: 'area' | 'delta';
  /**
   * Maps a minute offset to a percentage of the total plot width.
   * Uses the same scale as TimelineBar/TimelineAxis so columns align with the
   * hour grid at every viewport width, including horizontal scroll.
   * When omitted (legacy callers), columns are sized equally.
   */
  readonly minToPct?: (min: number) => number;
  /**
   * Target SPLH (sales per labor-hour) from active staffing settings.
   * Displayed in the per-hour tooltip. Null when settings are not configured.
   */
  readonly targetSplh?: number | null;
  /** Chart height in px (default 120). */
  readonly height?: number;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

/**
 * Build the per-hour tooltip lines for an hour column.
 *
 * Returns an array of strings — one per visual line — so callers can join them
 * as needed (aria-label uses comma-join; TooltipContent renders each on its own line).
 *
 * Content follows the design spec:
 *   Line 1: "10 AM–11 AM"  (time range)
 *   Line 2: "3 scheduled · 5 needed"  (or "4 scheduled" when no demand)
 *   Line 3: "Projected sales $480"  (when projectedSales != null)
 *   Line 4: "÷ $95/labor-hr target ≈ 5 needed"  (when targetSplh and projectedSales)
 *   Line 5: verdict — "Short 2 — add staff" / "Covered · +1 spare" / "Right on target" /
 *            "No demand target — set staffing targets to see needed staff."
 *
 * Exported so it can be unit-tested directly (pure function, no React).
 */
export function buildHourTooltip(h: CoverageHour, targetSplh: number | null): string[] {
  const lines: string[] = [];

  // Line 1: time range, e.g. "10 AM–11 AM"
  const startLabel = formatCoverageHour(h.hour);
  const endLabel = formatCoverageHour(h.hour + 1);
  lines.push(`${startLabel}–${endLabel}`);

  // Line 2: scheduled / needed summary
  if (h.needed !== null) {
    lines.push(`${h.scheduled} scheduled · ${h.needed} needed`);
  } else {
    lines.push(`${h.scheduled} scheduled`);
  }

  // Lines 3–4: sales and SPLH math (only when rec data is present)
  if (h.projectedSales !== null && h.needed !== null) {
    const salesFmt = h.projectedSales.toLocaleString('en-US', {
      style: 'currency',
      currency: 'USD',
      maximumFractionDigits: 0,
    });
    lines.push(`Projected sales ${salesFmt}`);

    if (targetSplh !== null) {
      const approxNeeded = Math.round(h.projectedSales / targetSplh);
      lines.push(`÷ $${targetSplh}/labor-hr target ≈ ${approxNeeded} needed`);
    }
  }

  // Line 5: verdict
  if (h.needed === null) {
    lines.push('No demand target — set staffing targets to see needed staff.');
  } else if (h.delta !== null && h.delta < 0) {
    lines.push(`Short ${Math.abs(h.delta)} — add staff`);
  } else if (h.delta === 0) {
    lines.push('Right on target');
  } else if (h.delta !== null && h.delta > 0) {
    lines.push(`Covered · +${h.delta} spare`);
  }

  return lines;
}

/**
 * Compute peak headcount across all hours (used for bar height scaling).
 * Always returns at least 1 to avoid divide-by-zero.
 */
function computePeak(hours: CoverageHour[]): number {
  const peak = hours.reduce((acc, h) => {
    const candidates = [acc, h.scheduled];
    if (h.needed !== null) candidates.push(h.needed);
    return Math.max(...candidates);
  }, 1);
  return Math.max(Math.ceil(peak), 1);
}

// ── Per-Hour Column (area view) ────────────────────────────────────────────────

interface AreaColumnProps {
  h: CoverageHour;
  left: number;
  width: number;
  peak: number;
  ariaLabel: string;
}

const AreaColumn = forwardRef<HTMLDivElement, AreaColumnProps>(
  function AreaColumn({ h, left, width, peak, ariaLabel }, ref) {
    const scheduledPct = (h.scheduled / peak) * 100;
    const neededPct = h.needed !== null ? (h.needed / peak) * 100 : null;
    const isShort = h.delta !== null && h.delta < 0 && neededPct !== null;

    // Shortfall block spans from "scheduled" height up to "needed" height
    const shortfallHeightPct = isShort && neededPct !== null ? neededPct - scheduledPct : 0;

    return (
      <div
        ref={ref}
        data-hour-col=""
        tabIndex={0}
        aria-label={ariaLabel}
        className="absolute inset-y-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
        style={{ left: `${left}%`, width: `${width}%` }}
      >
        {/* Bottom-anchored scheduled block */}
        <div
          data-scheduled=""
          className="absolute bottom-0 left-0 right-0 bg-primary/15 border-t border-primary"
          style={{ height: `${scheduledPct}%` }}
        />

        {/* Shortfall block — spans from scheduled up to needed (red fill) */}
        {isShort && (
          <div
            data-shortfall=""
            className="absolute left-0 right-0 bg-destructive/70 flex items-center justify-center"
            style={{
              bottom: `${scheduledPct}%`,
              height: `${shortfallHeightPct}%`,
            }}
          >
            {shortfallHeightPct > 10 && h.delta !== null && (
              <span className="text-[9px] text-background font-medium">{h.delta}</span>
            )}
          </div>
        )}

        {/* Dashed needed tick line */}
        {neededPct !== null && (
          <div
            data-needed=""
            className="absolute left-0 right-0 border-t border-dashed border-muted-foreground"
            style={{ bottom: `${neededPct}%` }}
          />
        )}
      </div>
    );
  },
);

// ── Per-Hour Column (delta view) ───────────────────────────────────────────────

interface DeltaColumnProps {
  h: CoverageHour;
  left: number;
  width: number;
  peak: number;
  deltaPeak: number;
  ariaLabel: string;
}

const DeltaColumn = forwardRef<HTMLDivElement, DeltaColumnProps>(
  function DeltaColumn({ h, left, width, peak, deltaPeak, ariaLabel }, ref) {
    // No-demand hour — show scheduled headcount scaled by peak (not deltaPeak)
    if (h.delta === null) {
      const barPct = Math.min(50, Math.max(0.5, (h.scheduled / peak) * 50));
      return (
        <div
          ref={ref}
          data-hour-col=""
          tabIndex={0}
          aria-label={ariaLabel}
          className="absolute inset-y-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
          style={{ left: `${left}%`, width: `${width}%` }}
        >
          {/* Zero line at 50% height */}
          <div className="absolute left-0 right-0" style={{ top: '50%' }}>
            <div
              data-bar="no-demand"
              className="bg-muted/60 w-full"
              style={{ height: `${barPct}%` }}
            />
          </div>
        </div>
      );
    }

    const isShort = h.delta < 0;
    const isZero = h.delta === 0;

    if (isZero) {
      return (
        <div
          ref={ref}
          data-hour-col=""
          tabIndex={0}
          aria-label={ariaLabel}
          className="absolute inset-y-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
          style={{ left: `${left}%`, width: `${width}%` }}
        >
          {/* Tick at zero baseline (50%) */}
          <div
            className="absolute left-0 right-0"
            style={{ top: 'calc(50% - 2px)', height: '2px' }}
          >
            <div
              data-bar="covered"
              className="bg-success opacity-40 w-full h-full"
            />
          </div>
        </div>
      );
    }

    const absD = Math.abs(h.delta);
    const barPct = Math.min(48, (absD / deltaPeak) * 50);
    const barState = isShort ? 'short' : 'covered';
    const barClass = isShort ? 'bg-destructive' : 'bg-success';
    const label = h.delta > 0 ? `+${h.delta}` : String(h.delta);

    return (
      <div
        ref={ref}
        data-hour-col=""
        tabIndex={0}
        aria-label={ariaLabel}
        className="absolute inset-y-0 flex flex-col focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
        style={{ left: `${left}%`, width: `${width}%` }}
      >
        {/* Bar + label for short hours (below zero line) */}
        {isShort ? (
          <>
            {/* Top half: empty */}
            <div className="flex-1" />
            {/* Bottom half: bar below zero line */}
            <div className="flex-1 flex flex-col-reverse">
              <div
                data-bar={barState}
                className={`w-full ${barClass}`}
                style={{ height: `${barPct}%` }}
              />
            </div>
            {/* Label below bar */}
            <div className="absolute bottom-0 left-0 right-0 flex items-end justify-center" style={{ bottom: `calc(50% - ${barPct}% - 10px)` }}>
              <span className="text-[8px] text-foreground/80 leading-none">{label}</span>
            </div>
          </>
        ) : (
          <>
            {/* Top half: bar above zero line */}
            <div className="flex-1 flex flex-col-reverse">
              <div
                data-bar={barState}
                className={`w-full ${barClass}`}
                style={{ height: `${barPct}%` }}
              />
            </div>
            {/* Bottom half: empty */}
            <div className="flex-1" />
            {/* Label above bar */}
            <div className="absolute top-0 left-0 right-0 flex items-start justify-center" style={{ top: `calc(50% - ${barPct}% - 10px)` }}>
              <span className="text-[8px] text-foreground/80 leading-none">{label}</span>
            </div>
          </>
        )}
      </div>
    );
  },
);

// ── Legend ────────────────────────────────────────────────────────────────────

function Legend({ hasDemand, view }: { hasDemand: boolean; view: 'area' | 'delta' }) {
  if (view === 'delta') {
    return (
      <div className="flex items-center gap-4 text-[11px] text-muted-foreground mt-1">
        <span className="flex items-center gap-1">
          <span className="inline-block h-2 w-3 rounded-sm bg-success opacity-80" />
          Covered
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-2 w-3 rounded-sm bg-destructive opacity-80" />
          Short
        </span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-4 text-[11px] text-muted-foreground mt-1">
      <span className="flex items-center gap-1">
        <span className="inline-block h-2 w-3 rounded-sm bg-primary opacity-40" />
        Scheduled
      </span>
      {hasDemand && (
        <>
          <span className="flex items-center gap-1">
            <span className="inline-block h-[1.5px] w-4 border-t-[1.5px] border-dashed border-muted-foreground" />
            Needed
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block h-2 w-3 rounded-sm bg-destructive opacity-70" />
            Short
          </span>
        </>
      )}
    </div>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────────

/**
 * Grid-aligned HTML column chart with two toggleable views:
 * - **area**: per-hour bottom-anchored scheduled blocks + shortfall fill + dashed needed tick.
 * - **delta**: diverging bars (short below, covered/spare above the zero line).
 *
 * Columns are positioned with the shared `minToPct` scale (same as TimelineBar /
 * TimelineAxis) so they line up exactly with hour-grid ticks at every viewport
 * width, including horizontal scroll.
 *
 * Accessible via `role="img"` + `aria-label` on the container.
 * Colors use semantic Tailwind tokens (never direct color literals).
 *
 * Wrapped in React.memo: all inputs are stable primitives/arrays derived from
 * useMemo in ShiftTimelineTab, so setActiveShift calls (popover open/close) do
 * not re-run the O(H) column computations unnecessarily.
 */
export const CoverageChart = memo(function CoverageChart({
  hours,
  view,
  minToPct,
  targetSplh = null,
  height = 120,
}: CoverageChartProps) {
  if (hours.length === 0) return null;

  const hasDemand = hours.some((h) => h.needed !== null);
  const peak = computePeak(hours);
  // Delta view uses its own scale (max absolute delta) so bars aren't dwarfed by
  // a large headcount peak when the deltas are small.
  const deltaPeak = Math.max(1, ...hours.map((h) => Math.abs(h.delta ?? 0)));

  // Compute accessible description — no nested ternaries per project rules.
  const shortCount = hours.filter((h) => h.delta !== null && h.delta < 0).length;
  let descText: string;
  if (!hasDemand) {
    descText = `Scheduled headcount over ${hours.length} hour${hours.length !== 1 ? 's' : ''}.`;
  } else if (shortCount > 0) {
    descText = `Short-staffed in ${shortCount} of ${hours.length} hour${hours.length !== 1 ? 's' : ''}.`;
  } else {
    descText = 'Meeting demand all hours.';
  }

  // Fallback minToPct: distribute hours equally when no scale is provided
  // (backward-compatible with callers that don't yet pass minToPct).
  const effectiveMinToPct =
    minToPct ??
    ((min: number) => {
      const startMin = hours[0]?.startMin ?? min;
      const totalMin = hours.length * 60;
      return ((min - startMin) / totalMin) * 100;
    });

  return (
    <TooltipProvider delayDuration={0}>
      <div>
        <div
          role="img"
          aria-label={descText}
          className="relative w-full"
          style={{ height }}
        >
          {hours.map((h) => {
              const left = effectiveMinToPct(h.startMin);
              const width = effectiveMinToPct(h.startMin + 60) - left;
              const tooltipLines = buildHourTooltip(h, targetSplh);
              const ariaLabel = tooltipLines.join(', ');
              const col =
                view === 'area' ? (
                  <AreaColumn h={h} left={left} width={width} peak={peak} ariaLabel={ariaLabel} />
                ) : (
                  <DeltaColumn
                    h={h}
                    left={left}
                    width={width}
                    peak={peak}
                    deltaPeak={deltaPeak}
                    ariaLabel={ariaLabel}
                  />
                );
              return (
                <Tooltip key={h.startMin}>
                  <TooltipTrigger asChild>{col}</TooltipTrigger>
                  <TooltipContent side="top" className="text-[12px] max-w-[220px]">
                    <div className="space-y-0.5">
                      {tooltipLines.map((line, i) => (
                        <p key={i} className={i === 0 ? 'font-medium' : 'text-muted-foreground'}>{line}</p>
                      ))}
                    </div>
                  </TooltipContent>
                </Tooltip>
              );
            })}
        </div>

        <Legend hasDemand={hasDemand} view={view} />
      </div>
    </TooltipProvider>
  );
});
