import { useMemo, type CSSProperties } from 'react';

import { MON_FIRST_DOWS, DOW_LABELS_BY_DOW } from '@/lib/splhAnalytics';
import type { SalesVolumeCell } from '@/lib/laborPnlAnalytics';
import { formatCoverageHour } from '@/lib/coverageSummary';
import { Badge } from '@/components/ui/badge';

interface SalesVolumeHeatmapProps {
  readonly cells: SalesVolumeCell[];
  readonly estimated: boolean;
  readonly capped: boolean;
}

const OPACITY_MIN = 0.15;
const OPACITY_MAX = 0.9;
const OPACITY_RANGE = OPACITY_MAX - OPACITY_MIN;

function cellHasSales(cell: SalesVolumeCell): boolean {
  return cell.totalSales > 0;
}

/**
 * Pure: hour columns (0-23) that have sales on ANY day. Sorted ascending,
 * deduped — mirrors `SplhHeatmap.computeActiveHours` so the busy-hours grid
 * shows only the restaurant's actual operating hours (design §7), not the
 * full 7x24.
 */
export function computeActiveSalesHours(cells: SalesVolumeCell[]): number[] {
  const active = new Set<number>();
  for (const cell of cells) {
    if (cellHasSales(cell)) active.add(cell.hour);
  }
  return Array.from(active).sort((a, b) => a - b);
}

/**
 * Pure: background style for a cell — the `--labor-balanced` token ramped
 * from `OPACITY_MIN` to `OPACITY_MAX` by `intensity` (design §7: "intensity
 * via --labor-balanced/green ramp"), or `bg-muted` for a zero-sales cell.
 */
export function getSalesCellStyle(cell: SalesVolumeCell): { className?: string; style?: CSSProperties } {
  if (cell.totalSales <= 0) return { className: 'bg-muted' };
  const opacity = OPACITY_MIN + cell.intensity * OPACITY_RANGE;
  return { style: { backgroundColor: `hsl(var(--labor-balanced) / ${opacity})` } };
}

/** Pure: per-cell aria-label naming day, hour, sales, and peak status (design §5/§7). */
export function getSalesCellAriaLabel(cell: SalesVolumeCell, dayName: string): string {
  const hourLabel = formatCoverageHour(cell.hour);
  if (cell.totalSales <= 0) return `${dayName} ${hourLabel}: no sales`;
  const salesLabel = `$${Math.round(cell.totalSales).toLocaleString()}`;
  return cell.peak
    ? `${dayName} ${hourLabel}: ${salesLabel} in sales, peak hour`
    : `${dayName} ${hourLabel}: ${salesLabel} in sales`;
}

/**
 * Busy-hours sales-volume heatmap (design §2.2/§5/§7) — a distinct read from
 * `SplhHeatmap`'s staffing-efficiency coloring: this grid colors by *sales
 * volume* (green ramp), with peak cells (`SalesVolumeCell.peak`, design §5:
 * ≥72% of the window's max) outlined so the busiest hours stand out even for
 * users who can't distinguish opacity.
 *
 * CSS grid (no virtualization — ~7x14 active cells after trimming), fully
 * accessible: `role="grid"`/`row`/`gridcell`, every cell is focusable with an
 * aria-label carrying day/hour/sales/peak so color is never the only signal.
 * The day-of-week column is `sticky left-0` so it stays pinned while hour
 * columns scroll horizontally on narrow viewports (mirrors `SplhHeatmap`).
 */
export function SalesVolumeHeatmap({ cells, estimated, capped }: SalesVolumeHeatmapProps) {
  const activeHours = useMemo(() => computeActiveSalesHours(cells), [cells]);

  const cellByDowHour = useMemo(() => {
    const map = new Map<string, SalesVolumeCell>();
    for (const cell of cells) map.set(`${cell.dow}-${cell.hour}`, cell);
    return map;
  }, [cells]);

  if (activeHours.length === 0) {
    return (
      <div className="rounded-lg border border-border/40 bg-muted/30 p-4 text-[13px] text-muted-foreground">
        No sales recorded for this period.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {(estimated || capped) && (
        <div className="flex flex-col gap-2">
          {estimated && (
            <div className="flex items-start gap-2">
              <Badge variant="secondary" className="bg-muted text-muted-foreground shrink-0">
                Estimated
              </Badge>
              <span className="text-[12px] text-muted-foreground">
                Hours are spread evenly across each day because the POS data doesn't include per-sale
                timestamps.
              </span>
            </div>
          )}
          {capped && (
            <div className="flex items-start gap-2">
              <Badge variant="secondary" className="bg-muted text-muted-foreground shrink-0">
                Partial window
              </Badge>
              <span className="text-[12px] text-muted-foreground">
                This period has more data than can be loaded at once — narrow your range for a complete
                read.
              </span>
            </div>
          )}
        </div>
      )}

      <div className="overflow-x-auto">
        <div
          role="grid"
          aria-label="Sales volume by day and hour"
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

          {MON_FIRST_DOWS.map((dow) => {
            const dayName = DOW_LABELS_BY_DOW[dow];
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
                        aria-label={`${dayName} ${formatCoverageHour(hour)}: no sales`}
                        className="min-w-10 min-h-10 bg-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
                      />
                    );
                  }
                  const { className: bgClassName, style } = getSalesCellStyle(cell);
                  const ariaLabel = getSalesCellAriaLabel(cell, dayName);
                  const peakClassName = cell.peak
                    ? 'ring-2 ring-inset ring-foreground/70'
                    : '';
                  return (
                    <div
                      key={hour}
                      role="gridcell"
                      tabIndex={0}
                      aria-label={ariaLabel}
                      style={style}
                      className={`min-w-10 min-h-10 flex items-center justify-center text-[11px] text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 ${bgClassName ?? ''} ${peakClassName}`}
                    />
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
