import { useMemo, type CSSProperties } from 'react';

import type { SplhGridCell } from '@/lib/splhAnalytics';
import { formatCoverageHour } from '@/lib/coverageSummary';
import { Badge } from '@/components/ui/badge';

interface SplhHeatmapProps {
  readonly cells: SplhGridCell[];
  readonly target: number;
  readonly estimated: boolean;
}

// `SplhGridCell.dow` is 0=Sun..6=Sat (JS `getUTCDay()` convention). Displayed
// Mon-first for readability — this array maps display column -> dow value.
const MON_FIRST_DOWS = [1, 2, 3, 4, 5, 6, 0];
const DOW_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const OPACITY_MIN = 0.35;
const OPACITY_MAX = 0.9;
const OPACITY_RANGE = OPACITY_MAX - OPACITY_MIN;

function cellHasActivity(cell: SplhGridCell): boolean {
  return cell.totalSales > 0 || cell.totalHours > 0;
}

/**
 * Pure: hour columns (0-23) that have sales or labor hours on ANY day.
 * Sorted ascending, deduped — used to trim dead columns from the grid so it
 * shows only the restaurant's actual operating hours (design §7.2: ~7x14,
 * not the full 7x24).
 */
export function computeActiveHours(cells: SplhGridCell[]): number[] {
  const active = new Set<number>();
  for (const cell of cells) {
    if (cellHasActivity(cell)) active.add(cell.hour);
  }
  return Array.from(active).sort((a, b) => a - b);
}

/**
 * Pure: opacity for a cell's background fill.
 * - `balanced` is a fixed, low-key opacity (it's the "nothing to see here" state).
 * - `lean`/`slack` ramp from OPACITY_MIN to OPACITY_MAX with distance from
 *   target (relative), clamped at 100% distance so one wild outlier can't
 *   wash out the rest of the scale.
 * - `no-labor`/`closed` don't use this (they render with `bg-muted` instead).
 */
export function computeCellOpacity(cell: SplhGridCell, target: number): number {
  if (cell.state === 'balanced') return OPACITY_MIN;
  if (cell.state !== 'lean' && cell.state !== 'slack') return OPACITY_MIN;
  if (cell.splh === null || target <= 0) return OPACITY_MIN;
  const distanceRatio = Math.min(Math.abs(cell.splh - target) / target, 1);
  return OPACITY_MIN + distanceRatio * OPACITY_RANGE;
}

/** Pure: background style for a cell — a theme token + distance-ramped opacity, or `bg-muted` for no-data states. */
export function getCellBackground(
  cell: SplhGridCell,
  target: number,
): { className?: string; style?: CSSProperties } {
  if (cell.state === 'no-labor' || cell.state === 'closed') {
    return { className: 'bg-muted' };
  }
  const token =
    cell.state === 'lean' ? '--splh-lean' : cell.state === 'slack' ? '--splh-slack' : '--splh-balanced';
  const opacity = computeCellOpacity(cell, target);
  return { style: { backgroundColor: `hsl(var(${token}) / ${opacity})` } };
}

/** Pure: per-cell aria-label naming day, hour, SPLH, and state (design §7.2). */
export function getCellAriaLabel(cell: SplhGridCell, dayName: string): string {
  const hourLabel = formatCoverageHour(cell.hour);
  if (cell.state === 'closed') return `${dayName} ${hourLabel}: closed`;
  if (cell.state === 'no-labor') return `${dayName} ${hourLabel}: sales but no labor logged`;
  return `${dayName} ${hourLabel}: $${cell.splh} per labor hour, ${cell.state}`;
}

function Legend() {
  return (
    <div className="flex flex-wrap items-center gap-4 text-[11px] text-muted-foreground">
      <span className="flex items-center gap-1">
        <span
          className="inline-block h-2.5 w-2.5 rounded-sm"
          style={{ backgroundColor: 'hsl(var(--splh-lean) / 0.7)' }}
        />
        Lean — understaffed
      </span>
      <span className="flex items-center gap-1">
        <span
          className="inline-block h-2.5 w-2.5 rounded-sm"
          style={{ backgroundColor: 'hsl(var(--splh-balanced) / 0.35)' }}
        />
        Balanced
      </span>
      <span className="flex items-center gap-1">
        <span
          className="inline-block h-2.5 w-2.5 rounded-sm"
          style={{ backgroundColor: 'hsl(var(--splh-slack) / 0.7)' }}
        />
        Slack — overstaffed
      </span>
      <span className="flex items-center gap-1">
        <span className="inline-block h-2.5 w-2.5 rounded-sm bg-muted" />
        Closed / no data
      </span>
    </div>
  );
}

/**
 * Diverging heatmap of sales-per-labor-hour by day-of-week x hour.
 *
 * CSS grid (no virtualization — ~7x14 active cells after trimming). Fully
 * accessible: `role="grid"`/`row`/`gridcell`, every cell is focusable with an
 * aria-label carrying the same day/hour/SPLH/state info sighted users get
 * from color + the in-cell $ value, so color is never the only signal.
 * The day-of-week column is `sticky left-0` so it stays pinned while the
 * hour columns scroll horizontally on narrow viewports.
 */
export function SplhHeatmap({ cells, target, estimated }: SplhHeatmapProps) {
  const activeHours = useMemo(() => computeActiveHours(cells), [cells]);

  const cellByDowHour = useMemo(() => {
    const map = new Map<string, SplhGridCell>();
    for (const cell of cells) map.set(`${cell.dow}-${cell.hour}`, cell);
    return map;
  }, [cells]);

  if (activeHours.length === 0) {
    return (
      <div className="rounded-lg border border-border/40 bg-muted/30 p-4 text-[13px] text-muted-foreground">
        No sales or labor hours recorded for this period.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {estimated && (
        <div className="flex items-start gap-2">
          <Badge variant="secondary" className="bg-muted text-muted-foreground shrink-0">
            Estimated
          </Badge>
          <span className="text-[12px] text-muted-foreground">
            Hours are spread evenly across each shift because the POS or time-tracking data doesn't
            include per-hour timestamps.
          </span>
        </div>
      )}

      <div className="overflow-x-auto">
        <div
          role="grid"
          aria-label="Sales per labor hour by day and hour"
          className="inline-grid"
          style={{ gridTemplateColumns: `auto repeat(${activeHours.length}, minmax(2.5rem, 1fr))` }}
        >
          <div role="row" className="contents">
            <div className="sticky left-0 z-10 bg-background" />
            {activeHours.map((hour) => (
              <div
                key={hour}
                role="columnheader"
                className="px-1 py-1 text-center text-[10px] font-medium text-muted-foreground"
              >
                {formatCoverageHour(hour)}
              </div>
            ))}
          </div>

          {MON_FIRST_DOWS.map((dow, i) => {
            const dayName = DOW_LABELS[i];
            return (
              <div role="row" key={dow} className="contents">
                <div
                  role="rowheader"
                  className="sticky left-0 z-10 flex items-center bg-background px-2 py-1 text-[12px] font-medium text-foreground"
                >
                  {dayName}
                </div>
                {activeHours.map((hour) => {
                  const cell = cellByDowHour.get(`${dow}-${hour}`);
                  if (!cell) {
                    return (
                      <div
                        key={hour}
                        role="gridcell"
                        tabIndex={0}
                        aria-label={`${dayName} ${formatCoverageHour(hour)}: no data`}
                        className="min-w-10 min-h-10 bg-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
                      />
                    );
                  }
                  const { className: bgClassName, style } = getCellBackground(cell, target);
                  const ariaLabel = getCellAriaLabel(cell, dayName);
                  const isNoData = cell.state === 'no-labor' || cell.state === 'closed';
                  return (
                    <div
                      key={hour}
                      role="gridcell"
                      tabIndex={0}
                      aria-label={ariaLabel}
                      style={style}
                      className={`min-w-10 min-h-10 flex items-center justify-center text-[11px] focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 ${isNoData ? 'text-muted-foreground' : 'text-foreground'} ${bgClassName ?? ''}`}
                    >
                      {cell.splh !== null ? `$${cell.splh}` : ''}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>

      <Legend />
    </div>
  );
}
