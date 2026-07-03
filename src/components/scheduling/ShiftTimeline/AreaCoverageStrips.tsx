import type { AreaCoverage } from '@/lib/coverageSummary';
import { formatCoverageHour } from '@/lib/coverageSummary';

interface AreaCoverageStripsProps {
  /** Per-area scheduled coverage produced by `summarizeAreaCoverage`. */
  readonly areas: AreaCoverage[];
}

/**
 * Per-area scheduled headcount strips for the Timeline coverage panel.
 *
 * Renders one compact row per `area` when the Timeline is grouped by Area.
 * Each row shows:
 *   - Area name label
 *   - A flex strip of per-hour cells with the scheduled headcount
 *
 * Cells are neutral (not red/green) because per-area demand is not yet
 * available. A footnote explains that demand targets are whole-location.
 *
 * Returns null when `areas` is empty.
 *
 * Design spec: docs/superpowers/specs/2026-07-03-timeline-area-coverage-design.md
 * Section: "Per-area scheduled coverage (coverage-only)"
 */
export function AreaCoverageStrips({ areas }: AreaCoverageStripsProps) {
  if (areas.length === 0) return null;

  return (
    <div className="space-y-2 mt-2">
      {areas.map(({ area, hours }) => {
        const totalScheduled = hours.reduce((sum, h) => sum + h.scheduled, 0);

        return (
          <div key={area} className="space-y-1">
            {/* Row header */}
            <div className="flex items-baseline gap-2">
              <span className="text-[13px] font-medium text-foreground truncate">
                {area}
              </span>
              <span className="text-[12px] text-muted-foreground">
                {totalScheduled} scheduled
              </span>
            </div>

            {/* Per-hour cell strip */}
            <div className="flex gap-[3px]" role="group" aria-label={`${area} hourly coverage`}>
              {hours.map((h) => {
                const hourLabel = formatCoverageHour(h.hour);
                const ariaLabel = `${area}, ${hourLabel}, ${h.scheduled} scheduled`;

                return (
                  <div
                    key={h.startMin}
                    role="img"
                    aria-label={ariaLabel}
                    title={ariaLabel}
                    className="flex min-w-0 flex-1 flex-col items-center gap-0.5 rounded py-1 px-0.5 bg-muted/40"
                  >
                    <span className="text-[9px] font-medium leading-none text-muted-foreground">
                      {hourLabel}
                    </span>
                    <span className="text-[11px] font-medium leading-none tabular-nums text-foreground">
                      {h.scheduled}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}

      {/* Footnote: per-area demand not yet available */}
      <p className="text-[11px] text-muted-foreground mt-1">
        Demand targets are set for the whole location — per-area targets coming soon.
      </p>
    </div>
  );
}
