import type { TimelineWindow, TimelineGap } from './useTimelineModel';

interface CoverageCurveProps {
  /** Derived time window for the selected day. */
  window: TimelineWindow;
  /** 15-min headcount samples over the window. */
  coverage: { min: number; count: number }[];
  /** 15-min demand step samples, or null when no recommendations are available. */
  demand: { min: number; target: number }[] | null;
  /** Understaffed windows to highlight with red shading. */
  gaps: TimelineGap[];
  /** Maps a minute value to a horizontal percent within [0, 100]. */
  minToPct: (min: number) => number;
  /** Fixed SVG height in px (default 80). */
  height?: number;
}

/**
 * SVG coverage-vs-demand area chart.
 *
 * Renders:
 *  - A light-filled area path tracing actual headcount (coverage).
 *  - A dashed step line for the demand target (omitted when demand is null).
 *  - Red shaded rectangles beneath the demand line for each gap window.
 *
 * Accessible via `role="img"` + `<title>` / `<desc>`.
 * Colors use CSS custom properties (hsl(var(--...))) via Tailwind utility
 * classes on SVG elements so they adapt to dark mode without raw hex.
 */
export function CoverageCurve({
  window,
  coverage,
  demand,
  gaps,
  minToPct,
  height = 80,
}: CoverageCurveProps) {
  const { startMin, endMin } = window;

  if (coverage.length === 0) return null;

  const peak = Math.max(...coverage.map((c) => c.count), demand ? Math.max(...demand.map((d) => d.target)) : 0, 1);
  const totalSpan = endMin - startMin;

  /** Map a headcount value to a Y coordinate (0 = bottom baseline). */
  const toY = (count: number) => height - (count / peak) * (height - 4);

  /** Map a minute to an SVG x-coordinate in [0, 100%] viewBox units. */
  const toX = (m: number) => ((m - startMin) / totalSpan) * 100;

  // ── Coverage area path ───────────────────────────────────────────────────
  // Step function: each sample occupies from its minute to the next sample's
  // minute.  We close the path back along the bottom baseline.
  const coveragePath = (() => {
    const parts: string[] = [];
    const baseline = height;

    // Start at the bottom-left
    parts.push(`M ${toX(coverage[0].min)} ${baseline}`);

    for (let i = 0; i < coverage.length; i++) {
      const x = toX(coverage[i].min);
      const y = toY(coverage[i].count);
      parts.push(`L ${x} ${y}`);

      // Horizontal segment to the next sample (or end of window)
      const nextX = i + 1 < coverage.length ? toX(coverage[i + 1].min) : toX(endMin);
      parts.push(`L ${nextX} ${y}`);
    }

    // Close back to bottom baseline
    parts.push(`L ${toX(endMin)} ${baseline}`);
    parts.push('Z');

    return parts.join(' ');
  })();

  // ── Demand step-line path ────────────────────────────────────────────────
  const demandPath = (() => {
    if (!demand || demand.length === 0) return null;
    const parts: string[] = [];

    for (let i = 0; i < demand.length; i++) {
      const x = toX(demand[i].min);
      const y = toY(demand[i].target);

      if (i === 0) {
        parts.push(`M ${x} ${y}`);
      } else {
        parts.push(`L ${x} ${y}`);
      }

      // Extend horizontally to the next sample
      const nextX = i + 1 < demand.length ? toX(demand[i + 1].min) : toX(endMin);
      parts.push(`L ${nextX} ${y}`);
    }

    return parts.join(' ');
  })();

  const understaffedCount = gaps.length;
  const peakCount = Math.max(...coverage.map((c) => c.count));

  return (
    <svg
      role="img"
      viewBox={`0 0 100 ${height}`}
      preserveAspectRatio="none"
      className="w-full"
      style={{ height }}
    >
      <title>Coverage curve</title>
      <desc>{`Peak coverage ${peakCount} staff. ${understaffedCount} understaffed window${understaffedCount === 1 ? '' : 's'}.`}</desc>

      {/* Gap shading: red rectangles for understaffed windows */}
      {gaps.map((g) => {
        const x1 = toX(g.startMin);
        const x2 = toX(Math.min(g.endMin + 15, endMin)); // extend to end of last under-staffed step
        return (
          <rect
            key={g.startMin}
            x={x1}
            y={0}
            width={x2 - x1}
            height={height}
            className="fill-destructive/10"
          />
        );
      })}

      {/* Coverage area */}
      <path
        d={coveragePath}
        className="fill-primary/15 stroke-primary/60"
        strokeWidth="0.5"
      />

      {/* Demand step line */}
      {demandPath && (
        <path
          d={demandPath}
          fill="none"
          className="stroke-muted-foreground"
          strokeWidth="0.8"
          strokeDasharray="2 1.5"
        />
      )}
    </svg>
  );
}
