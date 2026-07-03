import type { CoverageHour } from '@/lib/coverageSummary';
import { formatCoverageHour } from '@/lib/coverageSummary';

// ── Constants ──────────────────────────────────────────────────────────────────

// Plot spans the full viewBox width so the hour columns line up exactly with
// the TimelineAxis ticks and shift bars (both share the 120px lane-label offset
// applied by the parent). Y-axis value labels are drawn inside the top-left of
// the plot; the "Needed" series is named in the legend rather than an end-label.
const MARGIN_LEFT = 0;
const MARGIN_RIGHT = 0;
/** Top padding so the top gridline isn't clipped. */
const MARGIN_TOP = 8;
/** Bottom margin for x-axis hour labels. */
const MARGIN_BOTTOM = 20;

/** Total viewBox width. The plot area is [MARGIN_LEFT, WIDTH - MARGIN_RIGHT]. */
const WIDTH = 400;

/**
 * Compute a nice maximum for the y-axis, rounding up to the next integer ≥ 1.
 */
function computePeak(hours: CoverageHour[]): number {
  const peak = hours.reduce((acc, h) => {
    const candidates = [acc, h.scheduled];
    if (h.needed !== null) candidates.push(h.needed);
    return Math.max(...candidates);
  }, 1);
  return Math.max(Math.ceil(peak), 1);
}

// ── Types ──────────────────────────────────────────────────────────────────────

interface CoverageChartProps {
  /** Hourly coverage summary from `summarizeCoverageHours`. */
  readonly hours: CoverageHour[];
  /** Which chart variant to render. */
  readonly view: 'area' | 'delta';
  /** Fixed SVG height in px (default 120). */
  readonly height?: number;
}

// ── Area View ──────────────────────────────────────────────────────────────────

interface AreaViewProps {
  hours: CoverageHour[];
  plotW: number;
  plotH: number;
  peak: number;
  hasDemand: boolean;
}

function AreaView({ hours, plotW, plotH, peak, hasDemand }: AreaViewProps) {
  if (hours.length === 0) return null;

  /** X position for a given hour index (left edge of the hour column). */
  const xForIndex = (i: number) => MARGIN_LEFT + (i / hours.length) * plotW;
  /** X position for the right edge of the last hour. */
  const xEnd = MARGIN_LEFT + plotW;
  /** Y position for a headcount value (0 = bottom plot baseline). */
  const yForCount = (count: number) => MARGIN_TOP + plotH - (count / peak) * plotH;

  // ── Scheduled stepped area path ──────────────────────────────────────────
  const bottomY = MARGIN_TOP + plotH;

  const scheduledPath = (() => {
    const parts: string[] = [`M ${xForIndex(0)} ${bottomY}`];
    for (let i = 0; i < hours.length; i++) {
      const x0 = xForIndex(i);
      const x1 = i + 1 < hours.length ? xForIndex(i + 1) : xEnd;
      const y = yForCount(hours[i].scheduled);
      parts.push(`L ${x0} ${y} L ${x1} ${y}`);
    }
    parts.push(`L ${xEnd} ${bottomY} Z`);
    return parts.join(' ');
  })();

  // ── Needed dashed step line ───────────────────────────────────────────────
  const neededPath = (() => {
    if (!hasDemand) return null;
    const parts: string[] = [];
    for (let i = 0; i < hours.length; i++) {
      if (hours[i].needed === null) continue;
      const x0 = xForIndex(i);
      const x1 = i + 1 < hours.length ? xForIndex(i + 1) : xEnd;
      const y = yForCount(hours[i].needed as number);
      const cmd = parts.length === 0 ? 'M' : 'L';
      parts.push(`${cmd} ${x0} ${y} L ${x1} ${y}`);
    }
    return parts.length > 0 ? parts.join(' ') : null;
  })();

  // ── Shortfall wedges (between needed and scheduled where delta < 0) ───────
  const shortfallRects = hours
    .map((h, i) => {
      if (h.delta === null || h.delta >= 0 || h.needed === null) return null;
      const x0 = xForIndex(i);
      const x1 = i + 1 < hours.length ? xForIndex(i + 1) : xEnd;
      const yNeeded = yForCount(h.needed);
      const yScheduled = yForCount(h.scheduled);
      // wedge spans from scheduled up to needed (scheduled < needed here)
      return (
        <rect
          key={h.startMin}
          data-shortfall=""
          x={x0}
          y={yNeeded}
          width={x1 - x0}
          height={yScheduled - yNeeded}
          className="fill-destructive/70"
        />
      );
    })
    .filter(Boolean);

  // ── Worst-hour deficit label ──────────────────────────────────────────────
  const worstIndex = hasDemand
    ? hours.reduce<number | null>((worst, h, i) => {
        if (h.delta === null || h.delta >= 0) return worst;
        if (worst === null) return i;
        return (h.delta as number) < (hours[worst].delta as number) ? i : worst;
      }, null)
    : null;

  return (
    <>
      {/* Scheduled filled step area */}
      <path
        d={scheduledPath}
        className="fill-primary/15 stroke-primary"
        strokeWidth="1"
        strokeLinejoin="round"
      />

      {/* Shortfall wedges */}
      {shortfallRects}

      {/* Needed dashed step line */}
      {neededPath && (
        <path
          d={neededPath}
          fill="none"
          className="stroke-muted-foreground"
          strokeWidth="1.2"
          strokeDasharray="4 3"
        />
      )}

      {/* Worst-hour deficit label inside the wedge */}
      {worstIndex !== null && (() => {
        const h = hours[worstIndex];
        if (h.delta === null || h.needed === null) return null;
        const x0 = xForIndex(worstIndex);
        const x1 = worstIndex + 1 < hours.length ? xForIndex(worstIndex + 1) : xEnd;
        const xMid = (x0 + x1) / 2;
        const yNeeded = yForCount(h.needed);
        const yScheduled = yForCount(h.scheduled);
        const yMid = (yNeeded + yScheduled) / 2;
        const wedgeH = yScheduled - yNeeded;
        if (wedgeH < 10) return null; // skip label if wedge too thin
        return (
          <text
            x={xMid}
            y={yMid}
            textAnchor="middle"
            dominantBaseline="middle"
            className="fill-background font-medium"
            fontSize="9"
          >
            {h.delta}
          </text>
        );
      })()}
    </>
  );
}

// ── Delta (diverging bar) View ─────────────────────────────────────────────────

interface DeltaViewProps {
  hours: CoverageHour[];
  plotW: number;
  plotH: number;
  /** Headcount peak — scales the "no demand" scheduled bars proportionally. */
  peak: number;
  /** Max absolute delta — passed from parent to avoid recomputing. */
  deltaPeak: number;
  /** Total SVG height (px) — used to clamp label positions inside the viewBox. */
  svgHeight: number;
}

function DeltaView({ hours, plotW, plotH, peak, deltaPeak, svgHeight }: DeltaViewProps) {
  if (hours.length === 0) return null;

  const xForIndex = (i: number) => MARGIN_LEFT + (i / hours.length) * plotW;
  const xEnd = MARGIN_LEFT + plotW;
  const barPad = 2; // gap between bars

  // Delta range: from -deltaPeak to +deltaPeak (symmetric around 0)
  // Zero baseline in the middle of plotH
  const zeroY = MARGIN_TOP + plotH / 2;
  const halfH = plotH / 2;
  const pixelsPerUnit = halfH / deltaPeak;

  return (
    <>
      {/* Zero baseline */}
      <line
        x1={MARGIN_LEFT}
        y1={zeroY}
        x2={xEnd}
        y2={zeroY}
        className="stroke-border/60"
        strokeWidth="0.8"
        strokeDasharray="2 2"
      />

      {hours.map((h, i) => {
        const x0 = xForIndex(i) + barPad / 2;
        const x1 = (i + 1 < hours.length ? xForIndex(i + 1) : xEnd) - barPad / 2;
        const barW = x1 - x0;
        const xMid = (x0 + x1) / 2;

        if (h.delta === null) {
          // No demand — there's no delta to plot, so show scheduled headcount
          // scaled by the headcount peak (NOT deltaPeak, which collapses to 1
          // when every hour is demand-less and would peg every bar to max height).
          const barH = Math.min(halfH - 2, Math.max(1, (h.scheduled / peak) * halfH));
          return (
            <g key={h.startMin}>
              <rect
                data-bar="no-demand"
                x={x0}
                y={zeroY - barH}
                width={barW}
                height={barH}
                className="fill-muted/60"
              />
            </g>
          );
        }

        const isShort = h.delta < 0;
        // Exactly zero (demand met precisely) — render a subtle tick at baseline
        // so it's visually distinguishable from a no-bar slot.
        if (h.delta === 0) {
          return (
            <g key={h.startMin}>
              <rect
                data-bar="covered"
                x={x0}
                y={zeroY - 2}
                width={barW}
                height={2}
                className="fill-success opacity-40"
              />
            </g>
          );
        }

        const absD = Math.abs(h.delta);
        // Cap bar height so it doesn't overflow the SVG bottom margin when
        // the shortfall is very large relative to deltaPeak.
        const barH = Math.min(halfH - 2, absD * pixelsPerUnit);

        const barY = isShort ? zeroY : zeroY - barH;

        let barClass: string;
        if (isShort) {
          barClass = 'fill-destructive';
        } else {
          barClass = 'fill-success';
        }
        const barState = isShort ? 'short' : 'covered';

        // Label: signed delta, shown above or below bar depending on direction.
        // Clamp labelY to stay inside the SVG viewBox.
        const labelYRaw = isShort ? zeroY + barH + 8 : zeroY - barH - 4;
        const labelY = Math.min(labelYRaw, svgHeight - MARGIN_BOTTOM - 2);

        return (
          <g key={h.startMin}>
            <rect
              data-bar={barState}
              x={x0}
              y={barY}
              width={barW}
              height={barH}
              className={barClass}
            />
            {/* Signed delta label */}
            <text
              x={xMid}
              y={labelY}
              textAnchor="middle"
              dominantBaseline="auto"
              className="fill-foreground/80"
              fontSize="8"
            >
              {h.delta > 0 ? `+${h.delta}` : h.delta}
            </text>
          </g>
        );
      })}
    </>
  );
}

// ── Shared: Y-axis + X-axis labels, gridlines ──────────────────────────────────

interface AxesProps {
  plotW: number;
  plotH: number;
  peak: number;
  /** Max absolute delta — used for delta-view axis scale (separate from headcount peak). */
  deltaPeak: number;
  view: 'area' | 'delta';
  hourLabels: string[];
  hours: CoverageHour[];
}

function Axes({ plotW, plotH, peak, deltaPeak, view, hourLabels, hours }: AxesProps) {
  const xEnd = MARGIN_LEFT + plotW;

  // X-axis hour labels are identical in both views — render once.
  const xAxisLabels = hourLabels.map((label, i) => (
    <text
      key={hours[i].startMin}
      x={MARGIN_LEFT + ((i + 0.5) / hours.length) * plotW}
      y={MARGIN_TOP + plotH + 12}
      textAnchor="middle"
      className="fill-muted-foreground"
      fontSize="8"
    >
      {label}
    </text>
  ));

  if (view === 'area') {
    // Y: 0…peak, gridlines at integer steps (max 5 lines to avoid clutter)
    const step = Math.max(1, Math.ceil(peak / 5));
    const gridVals: number[] = [];
    for (let v = 0; v <= peak; v += step) gridVals.push(v);
    const yForCount = (count: number) => MARGIN_TOP + plotH - (count / peak) * plotH;

    return (
      <>
        {gridVals.map((v) => {
          const y = yForCount(v);
          return (
            <g key={v}>
              <line
                x1={MARGIN_LEFT}
                y1={y}
                x2={xEnd}
                y2={y}
                className="stroke-border/30"
                strokeWidth="0.5"
              />
              <text
                x={2}
                y={y - 2}
                textAnchor="start"
                dominantBaseline="auto"
                className="fill-muted-foreground"
                fontSize="8"
              >
                {v}
              </text>
            </g>
          );
        })}

        {xAxisLabels}
      </>
    );
  }

  // Delta view axes: symmetric around 0, scaled to deltaPeak so ticks match bars.
  const zeroY = MARGIN_TOP + plotH / 2;
  const halfH = plotH / 2;
  const gridStep = Math.max(1, Math.ceil(deltaPeak / 3));

  return (
    <>
      {/* Y gridlines above/below zero */}
      {[-gridStep, 0, gridStep].map((v) => {
        const y = zeroY - (v / deltaPeak) * halfH;
        return (
          <g key={v}>
            <line
              x1={MARGIN_LEFT}
              y1={y}
              x2={xEnd}
              y2={y}
              className="stroke-border/30"
              strokeWidth="0.5"
            />
            <text
              x={2}
              y={y - 2}
              textAnchor="start"
              dominantBaseline="auto"
              className="fill-muted-foreground"
              fontSize="8"
            >
              {v > 0 ? `+${v}` : v}
            </text>
          </g>
        );
      })}

      {xAxisLabels}
    </>
  );
}

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
 * SVG chart with two toggleable views:
 * - **area**: stepped scheduled area + dashed needed line + red shortfall wedges.
 * - **delta**: diverging bar chart, one bar per hour, red for short / teal for covered.
 *
 * Accessible via `role="img"` + `<title>` / `<desc>`.
 * Colors use semantic Tailwind tokens (never direct color literals).
 * Uses a proper viewBox — no `preserveAspectRatio="none"`.
 */
export function CoverageChart({ hours, view, height = 120 }: CoverageChartProps) {
  if (hours.length === 0) return null;

  const hasDemand = hours.some((h) => h.needed !== null);
  const peak = computePeak(hours);
  // Delta view uses its own scale (max absolute delta) so bars aren't dwarfed by
  // a large headcount peak when the deltas are small.
  const deltaPeak = Math.max(1, ...hours.map((h) => Math.abs(h.delta ?? 0)));
  const plotW = WIDTH - MARGIN_LEFT - MARGIN_RIGHT;
  const plotH = height - MARGIN_TOP - MARGIN_BOTTOM;

  const hourLabels = hours.map((h) => formatCoverageHour(h.hour));

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

  const titleText = view === 'area' ? 'Coverage vs demand chart' : 'Coverage delta bar chart';

  return (
    <div>
      <svg
        role="img"
        viewBox={`0 0 ${WIDTH} ${height}`}
        className="w-full"
        style={{ height }}
      >
        <title>{titleText}</title>
        <desc>{descText}</desc>

        <Axes
          plotW={plotW}
          plotH={plotH}
          peak={peak}
          deltaPeak={deltaPeak}
          view={view}
          hourLabels={hourLabels}
          hours={hours}
        />

        {view === 'area' ? (
          <AreaView
            hours={hours}
            plotW={plotW}
            plotH={plotH}
            peak={peak}
            hasDemand={hasDemand}
          />
        ) : (
          <DeltaView
            hours={hours}
            plotW={plotW}
            plotH={plotH}
            peak={peak}
            deltaPeak={deltaPeak}
            svgHeight={height}
          />
        )}
      </svg>

      <Legend hasDemand={hasDemand} view={view} />
    </div>
  );
}
