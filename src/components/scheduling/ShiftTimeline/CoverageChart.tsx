import { Fragment, memo, useId, useRef, useState } from 'react';

import { Plus } from 'lucide-react';

import type { CoverageHour } from '@/lib/coverageSummary';
import { formatCoverageHour } from '@/lib/coverageSummary';
import { classifyHour, chartSummaryLabel, neededFor } from '@/lib/coverageChartModel';
import { cn } from '@/lib/utils';

// ── Types ──────────────────────────────────────────────────────────────────────

interface CoverageChartProps {
  /** Hourly coverage summary from `summarizeCoverageHours`. */
  readonly hours: CoverageHour[];
  /**
   * Effective minimum-staff floor (post `computeMinStaffFromCrew`). Drives the
   * `floor N` rule line and — via `classifyHour` — the demand/floor column split.
   */
  readonly minStaff: number;
  /**
   * Maps a minute offset to a percentage of the total plot width.
   * Uses the same scale as TimelineBar/TimelineAxis so columns align with the
   * hour grid at every viewport width, including horizontal scroll.
   * When omitted (legacy callers), columns are sized equally.
   */
  readonly minToPct?: (min: number) => number;
  /** The currently-selected column's `startMin`, or null (defaults selection to the first hour). */
  readonly selectedStartMin: number | null;
  /** Called with an hour's `startMin` when its column is selected (click or arrow-key). */
  readonly onSelect: (startMin: number) => void;
  /**
   * Called with an hour's `startMin` from the one-click hover "+" quick-add
   * affordance on `crit`/`floor` columns (design doc §Design-review
   * resolutions #5 — parity with the old `CoverageStatusStrip` gap-click,
   * relocated). Optional — omitting it simply hides the affordance; the
   * `ShiftTimelineTab` caller wires this to the existing `handleGapClick`.
   */
  readonly onQuickAdd?: (startMin: number) => void;
  /** Chart height in px (default 160 — taller than the old two-view chart to fit a real people y-axis). */
  readonly height?: number;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

/**
 * Compute peak headcount across all hours (used for the y-axis scale) —
 * `max(scheduledMax, needed, minStaff)` over every hour, plus one for headroom.
 * Always at least 2 (1 + the floor of 1) so a chart with zero everywhere still
 * has a usable scale.
 */
function computePeak(hours: CoverageHour[], minStaff: number): number {
  let peak = minStaff;
  for (const h of hours) {
    peak = Math.max(peak, h.scheduledMax, h.scheduled);
    if (h.demand !== null) {
      peak = Math.max(peak, neededFor(h.demand, minStaff));
    }
  }
  return Math.max(Math.ceil(peak), 1) + 1;
}

/** Integer y-axis ticks, capped at ~5 so a large peak headcount doesn't crowd the gutter. */
function computeYTicks(peak: number): number[] {
  const maxTicks = 5;
  const step = Math.max(1, Math.ceil(peak / maxTicks));
  const ticks: number[] = [];
  for (let v = 0; v <= peak; v += step) ticks.push(v);
  if (ticks[ticks.length - 1] !== peak) ticks.push(peak);
  return ticks;
}

/**
 * Build the one-line accessible summary for a single hour column — the chart's
 * per-option `aria-label` (design doc §Accessibility: "each column focusable,
 * arrow-navigable, aria-label = its one-line summary").
 *
 * Pure and exported so it's directly unit-tested (SonarCloud gate) rather than
 * only exercised through rendering.
 */
export function columnAriaLabel(h: CoverageHour, minStaff: number): string {
  const label = formatCoverageHour(h.hour);
  const kind = classifyHour(h, minStaff);

  if (kind === 'nodata') {
    return `${label}: ${h.scheduled} scheduled, no sales history — no demand target`;
  }

  const demand = h.demand ?? 0;
  const needed = neededFor(demand, minStaff);

  switch (kind) {
    case 'crit':
      return `${label}: ${h.scheduled} scheduled, ${demand} demand — short ${demand - h.scheduled} on demand`;
    case 'floor':
      return `${label}: ${h.scheduled} scheduled, ${needed} needed — short ${needed - h.scheduled} at the floor`;
    case 'spare':
      return `${label}: ${h.scheduled} scheduled, ${needed} needed — covered, +${h.scheduled - needed} spare`;
    default:
      return `${label}: ${h.scheduled} scheduled, ${needed} needed — on target`;
  }
}

// ── Legend ────────────────────────────────────────────────────────────────────

function Legend() {
  return (
    <div
      data-testid="coverage-chart-legend"
      className="flex flex-wrap items-center gap-4 text-[11px] text-muted-foreground mt-1"
    >
      <span className="flex items-center gap-1.5">
        <span className="inline-block h-[3px] w-4 rounded-full bg-destructive" />
        Short on demand
      </span>
      <span className="flex items-center gap-1.5">
        <span className="inline-block w-4 border-b-2 border-dashed border-warning" />
        At the floor only
      </span>
      <span className="flex items-center gap-1.5">
        <span className="inline-block h-[3px] w-4 rounded-full bg-primary" />
        Covered
      </span>
      <span className="flex items-center gap-1.5">
        <span
          className="inline-block h-2.5 w-4 rounded-sm border border-muted-foreground/40"
          style={{
            backgroundImage:
              'repeating-linear-gradient(45deg, hsl(var(--muted-foreground)) 0, hsl(var(--muted-foreground)) 1px, transparent 1px, transparent 3px)',
          }}
        />
        No sales history
      </span>
    </div>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────────

/**
 * Single SVG coverage chart with a real people y-axis, replacing the old
 * Area/Delta toggle chart. Per hour:
 *  - a **scheduled** bar (0 → scheduled, `--primary`);
 *  - a solid **demand** slice (`--destructive`) when short of raw demand (`crit`);
 *  - a dashed/hatched **floor** slice (`--warning`) covering the gap between
 *    the demand line and the `minStaff` floor (`crit` and `floor` columns);
 *  - a hatched **nodata** ghost — ` no sales history for this hour, so there is
 *    no target line at all (replaces the old, misleading `N / 0` reading).
 * A `floor N` rule line marks the `minStaff` floor across the whole plot.
 *
 * Accessibility (design doc §Design-review resolutions #1/#2): the container is
 * `role="toolbar"` (never `role="img"`, which would flatten the interactive
 * column subtree); each column is `role="option"` with roving `tabIndex`
 * (selected column = 0, all others = -1) and ArrowLeft/ArrowRight move both
 * selection and focus. A visually-hidden `<p>` carries the rolled-up
 * "N short on demand, M at the floor over K hours" summary, and a
 * `<ul aria-label="Understaffed windows">` enumerates every short hour so
 * screen-reader users get the full gap list without arrow-keying through each
 * column.
 *
 * Colors are semantic tokens only (`hsl(var(--destructive))` /
 * `hsl(var(--warning))` / `hsl(var(--primary))` / `hsl(var(--muted-foreground))`)
 * — never raw hex (CLAUDE.md rule). The floor slice's dashed stroke and the
 * nodata hatch `<pattern>` give each state a texture, not just a color, so the
 * distinction survives grayscale/color-blindness.
 *
 * Wrapped in React.memo: all inputs are stable primitives/arrays derived from
 * useMemo in ShiftTimelineTab, so unrelated re-renders don't re-run the O(H)
 * column computations.
 */
export const CoverageChart = memo(function CoverageChart({
  hours,
  minStaff,
  minToPct,
  selectedStartMin,
  onSelect,
  onQuickAdd,
  height = 160,
}: CoverageChartProps) {
  const hatchId = useId();
  const summaryId = useId();
  const buttonRefs = useRef<(HTMLButtonElement | null)[]>([]);
  // Tracks which column is hovered/focused so the one-click "+" quick-add
  // affordance (design doc §Design-review resolutions #5) can reveal itself —
  // only for `crit`/`floor` columns, and only when `onQuickAdd` is supplied.
  const [hoveredStartMin, setHoveredStartMin] = useState<number | null>(null);

  if (hours.length === 0) return null;

  const peak = computePeak(hours, minStaff);
  const yTicks = computeYTicks(peak);
  const floorY = 100 - (minStaff / peak) * 100;
  const summary = chartSummaryLabel(hours, minStaff);

  // Fallback minToPct: distribute hours equally when no scale is provided
  // (backward-compatible with callers that don't yet pass minToPct).
  const effectiveMinToPct =
    minToPct ??
    ((min: number) => {
      const startMin = hours[0]?.startMin ?? min;
      const totalMin = hours.length * 60;
      return ((min - startMin) / totalMin) * 100;
    });

  const selectedIndex = (() => {
    if (selectedStartMin === null) return 0;
    const idx = hours.findIndex((h) => h.startMin === selectedStartMin);
    return idx === -1 ? 0 : idx;
  })();

  const focusAndSelect = (index: number) => {
    const clamped = Math.max(0, Math.min(hours.length - 1, index));
    if (clamped === selectedIndex) return;
    const target = hours[clamped];
    onSelect(target.startMin);
    buttonRefs.current[clamped]?.focus();
  };

  const handleToolbarKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'ArrowRight') {
      event.preventDefault();
      focusAndSelect(selectedIndex + 1);
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault();
      focusAndSelect(selectedIndex - 1);
    }
  };

  return (
    <div>
      {/* sr-only rollup summary — design doc §Design-review resolutions #1 */}
      <p id={summaryId} className="sr-only">
        {summary.ariaLabel}
      </p>

      {/* sr-only understaffed-windows enumeration — resolution #2 */}
      {summary.understaffedWindows.length > 0 && (
        <ul aria-label="Understaffed windows" className="sr-only">
          {summary.understaffedWindows.map((w) => (
            <li key={w.startMin}>{w.label}</li>
          ))}
        </ul>
      )}

      <div className="flex" style={{ height }}>
        {/* Sticky people y-axis gutter — mirrors TimelineLane's sticky label column
            (design doc §Design-review resolutions #3) so it stays visible under
            horizontal scroll. */}
        <div
          data-testid="coverage-y-axis-gutter"
          className="sticky left-0 z-10 w-[120px] shrink-0 relative bg-background border-r border-border/40"
          style={{ height }}
        >
          {yTicks.map((t) => (
            <span
              key={t}
              className="absolute right-2 -translate-y-1/2 text-[11px] tabular-nums text-muted-foreground"
              style={{ top: `${100 - (t / peak) * 100}%` }}
            >
              {t}
            </span>
          ))}
        </div>

        {/* Plot region: pure-visual SVG underneath, interactive option overlay on top */}
        <div
          role="toolbar"
          aria-label="Hourly coverage chart"
          aria-describedby={summaryId}
          aria-orientation="horizontal"
          className="relative flex-1"
          onKeyDown={handleToolbarKeyDown}
        >
          <svg
            aria-hidden="true"
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            className="absolute inset-0 h-full w-full"
          >
            <defs>
              <pattern
                id={hatchId}
                patternUnits="userSpaceOnUse"
                width={4}
                height={4}
                patternTransform="rotate(45)"
              >
                <rect width={4} height={4} fill="hsl(var(--muted) / 0.4)" />
                <line x1={0} y1={0} x2={0} y2={4} stroke="hsl(var(--muted-foreground))" strokeWidth={1.5} />
              </pattern>
            </defs>

            {/* min_staff floor rule */}
            <line
              data-floor-rule=""
              x1={0}
              x2={100}
              y1={floorY}
              y2={floorY}
              stroke="hsl(var(--muted-foreground))"
              strokeDasharray="2 1.5"
              strokeWidth={0.5}
              vectorEffect="non-scaling-stroke"
            />

            {hours.map((h) => {
              const left = effectiveMinToPct(h.startMin);
              const width = effectiveMinToPct(h.startMin + 60) - left;
              const kind = classifyHour(h, minStaff);

              if (kind === 'nodata') {
                return (
                  <rect
                    key={h.startMin}
                    data-nodata=""
                    x={left}
                    y={0}
                    width={width}
                    height={100}
                    fill={`url(#${hatchId})`}
                  />
                );
              }

              // Inset the drawn bar within its column so adjacent hours read as
              // discrete bars, not one abutting block (the flat-block look the
              // first cut had). The full-width transparent hit target below is
              // unaffected — only the visual fill is inset.
              const pad = width * 0.16;
              const bx = left + pad;
              const bw = width - pad * 2;

              const demand = h.demand ?? 0;
              const needed = neededFor(demand, minStaff);
              const scheduled = h.scheduled;

              const scheduledTopY = 100 - (scheduled / peak) * 100;
              const scheduledHeight = (scheduled / peak) * 100;
              const neededY = 100 - (needed / peak) * 100;

              // Demand slice: y(demand) → y(scheduled) — only when short of raw demand (`crit`).
              const hasDemandSlice = kind === 'crit';
              const demandTopY = 100 - (demand / peak) * 100;
              const demandSliceHeight = hasDemandSlice ? scheduledTopY - demandTopY : 0;

              // Floor slice: max(scheduled, demand) → needed — `crit` or `floor`, only
              // when the minStaff floor actually pulls `needed` above that point.
              const flooredBase = Math.max(scheduled, demand);
              const floorSliceTopY = neededY;
              const floorBaseY = 100 - (flooredBase / peak) * 100;
              const hasFloorSlice = (kind === 'crit' || kind === 'floor') && needed > flooredBase;
              const floorSliceHeight = hasFloorSlice ? floorBaseY - floorSliceTopY : 0;

              return (
                <g key={h.startMin}>
                  {/* Scheduled fill + a crisp solid cap line at its top — "what you scheduled". */}
                  <rect
                    data-scheduled=""
                    x={bx}
                    y={scheduledTopY}
                    width={bw}
                    height={scheduledHeight}
                    fill="hsl(var(--primary))"
                    fillOpacity={0.28}
                  />
                  {scheduled > 0 && (
                    <line
                      x1={bx}
                      x2={bx + bw}
                      y1={scheduledTopY}
                      y2={scheduledTopY}
                      stroke="hsl(var(--primary))"
                      strokeWidth={1.5}
                      vectorEffect="non-scaling-stroke"
                    />
                  )}

                  {/* Demand-short slice: red fill + SOLID red cap at the demand line. */}
                  {hasDemandSlice && (
                    <>
                      <rect
                        data-demand-slice=""
                        x={bx}
                        y={demandTopY}
                        width={bw}
                        height={demandSliceHeight}
                        fill="hsl(var(--destructive))"
                        fillOpacity={0.82}
                      />
                      <line
                        x1={bx}
                        x2={bx + bw}
                        y1={demandTopY}
                        y2={demandTopY}
                        stroke="hsl(var(--destructive))"
                        strokeWidth={2}
                        vectorEffect="non-scaling-stroke"
                      />
                    </>
                  )}

                  {/* Floor-only slice: faint amber fill + DASHED amber cap at the needed line. */}
                  {hasFloorSlice && (
                    <>
                      <rect
                        data-floor-slice=""
                        x={bx}
                        y={floorSliceTopY}
                        width={bw}
                        height={floorSliceHeight}
                        fill="hsl(var(--warning))"
                        fillOpacity={0.18}
                      />
                      <line
                        data-floor-cap=""
                        x1={bx}
                        x2={bx + bw}
                        y1={floorSliceTopY}
                        y2={floorSliceTopY}
                        stroke="hsl(var(--warning))"
                        strokeWidth={2}
                        strokeDasharray="4 3"
                        vectorEffect="non-scaling-stroke"
                      />
                    </>
                  )}

                  {/* Needed tick — a short dark reference mark at the target level. */}
                  <line
                    data-need-tick=""
                    x1={bx}
                    x2={bx + bw}
                    y1={neededY}
                    y2={neededY}
                    stroke="hsl(var(--foreground))"
                    strokeWidth={1}
                    strokeOpacity={0.4}
                    vectorEffect="non-scaling-stroke"
                  />
                </g>
              );
            })}
          </svg>

          {/* floor N label — HTML overlay so it stays legible over any fill */}
          <span
            className="absolute left-1 rounded bg-background/80 px-1 text-[10px] text-muted-foreground"
            style={{ top: `${floorY}%`, transform: 'translateY(-50%)' }}
          >
            floor {minStaff}
          </span>

          {/* On-bar shortfall labels (−N), centered in the gap they name — HTML
              overlay so the digits stay upright under the non-uniform SVG scale.
              aria-hidden: each column's <button> already carries the full
              spoken shortfall in its aria-label. */}
          {hours.map((h) => {
            const kind = classifyHour(h, minStaff);
            if (kind !== 'crit' && kind !== 'floor') return null;

            const left = effectiveMinToPct(h.startMin);
            const width = effectiveMinToPct(h.startMin + 60) - left;
            const demand = h.demand ?? 0;
            const needed = neededFor(demand, minStaff);
            const scheduled = h.scheduled;

            const scheduledTopY = 100 - (scheduled / peak) * 100;
            const short = kind === 'crit' ? demand - scheduled : needed - scheduled;
            const gapTopY = kind === 'crit' ? 100 - (demand / peak) * 100 : 100 - (needed / peak) * 100;
            const midY = (gapTopY + scheduledTopY) / 2;

            return (
              <span
                key={h.startMin}
                aria-hidden
                className={cn(
                  'absolute -translate-x-1/2 -translate-y-1/2 text-[11px] font-semibold tabular-nums',
                  kind === 'crit'
                    ? 'text-destructive-foreground'
                    : 'rounded bg-background/70 px-0.5 text-warning',
                )}
                style={{ left: `${left + width / 2}%`, top: `${midY}%` }}
              >
                −{short}
              </span>
            );
          })}

          {/* Interactive option overlay — roving tabindex, one per hour */}
          {hours.map((h, i) => {
            const left = effectiveMinToPct(h.startMin);
            const width = effectiveMinToPct(h.startMin + 60) - left;
            const isSelected = i === selectedIndex;
            const kind = classifyHour(h, minStaff);
            const clearHover = () =>
              setHoveredStartMin((prev) => (prev === h.startMin ? null : prev));
            // One-click hover "+" quick-add (design doc §Design-review resolutions
            // #5): only ever shown for short (`crit`/`floor`) columns, and only
            // when the caller opted in via `onQuickAdd` — omitting it hides the
            // affordance entirely (back-compat with callers that don't wire it).
            const showQuickAdd =
              Boolean(onQuickAdd) &&
              (kind === 'crit' || kind === 'floor') &&
              hoveredStartMin === h.startMin;

            return (
              <Fragment key={h.startMin}>
                <button
                  ref={(el) => {
                    buttonRefs.current[i] = el;
                  }}
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  data-hour-col=""
                  data-kind={kind}
                  tabIndex={isSelected ? 0 : -1}
                  aria-label={columnAriaLabel(h, minStaff)}
                  onClick={() => onSelect(h.startMin)}
                  onMouseEnter={() => setHoveredStartMin(h.startMin)}
                  onMouseLeave={clearHover}
                  onFocus={() => setHoveredStartMin(h.startMin)}
                  onBlur={clearHover}
                  className={cn(
                    'absolute inset-y-0 bg-transparent focus:outline-none',
                    'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring',
                  )}
                  style={{ left: `${left}%`, width: `${width}%` }}
                />
                {showQuickAdd && (
                  <button
                    type="button"
                    data-testid="coverage-quick-add"
                    aria-label={`Add shift for ${formatCoverageHour(h.hour)}`}
                    onClick={(event) => {
                      // Independent of column selection — a true one-click
                      // affordance, not "select then click Add" (design doc's
                      // "quick-add parity" requirement).
                      event.stopPropagation();
                      onQuickAdd?.(h.startMin);
                    }}
                    onMouseEnter={() => setHoveredStartMin(h.startMin)}
                    onMouseLeave={clearHover}
                    className={cn(
                      'absolute z-20 flex h-5 w-5 items-center justify-center rounded-full',
                      'bg-foreground text-background shadow-sm hover:bg-foreground/90',
                      'focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
                    )}
                    style={{
                      left: `${left + width / 2}%`,
                      top: '50%',
                      transform: 'translate(-50%, -50%)',
                    }}
                  >
                    <Plus className="h-3 w-3" aria-hidden="true" />
                  </button>
                )}
              </Fragment>
            );
          })}
        </div>
      </div>

      <Legend />
    </div>
  );
});
