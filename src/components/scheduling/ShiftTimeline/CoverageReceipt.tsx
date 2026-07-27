import { useEffect, useRef, useState } from 'react';

import { buildReceipt, classifyHour, type Receipt, type ReceiptTone } from '@/lib/coverageChartModel';
import type { CoverageHour } from '@/lib/coverageSummary';
import { formatCoverageHour } from '@/lib/coverageSummary';
import { cn } from '@/lib/utils';

// ── Types ──────────────────────────────────────────────────────────────────────

interface CoverageReceiptProps {
  /** The selected column's coverage hour — drives every ledger row and aside. */
  readonly hour: CoverageHour;
  /** Effective minimum-staff floor (post `computeMinStaffFromCrew`) — see `buildReceipt`. */
  readonly minStaff: number;
  /** Weekday name used in the "Avg {weekday} sales" row and the nodata aside. */
  readonly weekdayKey: string;
  /** Average hourly wage — drives the implied-SPLH-at-scheduled aside. */
  readonly wage: number;
  /** Lookback window (in weeks) — surfaced in the nodata aside's copy. */
  readonly lookbackWeeks: number;
  /**
   * Called with `hour.startMin` when "Add shift for this hour" is clicked
   * (design doc §D — the receipt's quick-add entry point, secondary to the
   * chart's own one-click hover "+"). Optional — omitting it hides the button
   * entirely, and it never renders for `ok`/`spare`/`nodata` hours regardless.
   */
  readonly onQuickAdd?: (startMin: number) => void;
}

const TONE_CLASS: Record<ReceiptTone, string> = {
  default: 'text-foreground',
  critical: 'text-destructive',
  warning: 'text-warning',
  positive: 'text-success',
};

// ── SR announcement text ─────────────────────────────────────────────────────

/**
 * Flatten a `Receipt` + its hour into a single sentence for the `aria-live`
 * region — screen readers get one coherent announcement rather than a stream
 * of per-row updates.
 */
function announcementText(receipt: Receipt, h: CoverageHour): string {
  const label = formatCoverageHour(h.hour);
  if (receipt.rows.length === 0) {
    return `${label}: ${receipt.asides[0] ?? ''}`;
  }
  const rowText = receipt.rows.map((r) => `${r.label} ${r.value}`).join(', ');
  return `${label}: ${rowText}`;
}

// ── Component ────────────────────────────────────────────────────────────────

/**
 * Pinned "receipt" panel (design doc §C) — the arithmetic ledger behind the
 * selected chart column, plus contextual asides and the "Add shift for this
 * hour" quick-add action for short (`crit`/`floor`) hours.
 *
 * The visible ledger/asides re-render from `hour` on every prop change,
 * including every live SPLH-slider drag frame (the whole staffing pipeline
 * reruns as the slider moves, per design doc §B) — so the panel always shows
 * current numbers. The `aria-live="polite"` region, however, is only
 * re-announced on slider **commit** (`pointerup`/`keyup`), never on
 * intermediate drag frames (design doc §Design-review resolutions #4) — this
 * component doesn't own the slider, so it listens for those two events
 * globally as the commit signal. Selecting a *different* hour (an
 * independent, non-slider action) still announces immediately.
 */
export function CoverageReceipt({
  hour,
  minStaff,
  weekdayKey,
  wage,
  lookbackWeeks,
  onQuickAdd,
}: CoverageReceiptProps) {
  const receipt = buildReceipt(hour, { minStaff, weekdayKey, wage, lookbackWeeks });
  const kind = classifyHour(hour, minStaff);
  const showQuickAdd = Boolean(onQuickAdd) && (kind === 'crit' || kind === 'floor');

  // Always-current ref so the commit-event handler (registered once) reads
  // the latest receipt/hour rather than a stale closure.
  const latestRef = useRef({ receipt, hour });
  latestRef.current = { receipt, hour };

  const [announced, setAnnounced] = useState(() => announcementText(receipt, hour));

  useEffect(() => {
    const commit = () => {
      const { receipt: r, hour: h } = latestRef.current;
      setAnnounced(announcementText(r, h));
    };
    window.addEventListener('pointerup', commit);
    window.addEventListener('keyup', commit);
    return () => {
      window.removeEventListener('pointerup', commit);
      window.removeEventListener('keyup', commit);
    };
  }, []);

  // Selecting a different hour is independent of slider dragging and should
  // announce right away (design doc §C: "selecting updates the receipt").
  useEffect(() => {
    setAnnounced(announcementText(latestRef.current.receipt, latestRef.current.hour));
     
  }, [hour.startMin]);

  // The ledger's last row is always the verdict (Short on demand / Short on
  // floor / Covered / On target) — set it off as an emphasized "total" below a
  // divider, the way the mock's receipt reads. `nodata` hours have no rows, so
  // guard the split.
  const hasRows = receipt.rows.length > 0;
  const ledgerRows = hasRows ? receipt.rows.slice(0, -1) : [];
  const totalRow = hasRows ? receipt.rows[receipt.rows.length - 1] : null;

  return (
    <div
      data-testid="coverage-receipt"
      className="rounded-xl border border-border/40 bg-muted/30 overflow-hidden"
    >
      {/* SR-only, debounced-to-commit announcement (see doc comment above) */}
      <div aria-live="polite" className="sr-only" data-testid="coverage-receipt-announcement">
        {announced}
      </div>

      {/* Header — eyebrow + the hour this arithmetic explains. */}
      <div className="px-4 pt-4 pb-3 border-b border-border/40">
        <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
          The arithmetic
        </p>
        <p className="text-[15px] font-semibold text-foreground tabular-nums mt-0.5">
          {formatCoverageHour(hour.hour)}
        </p>
      </div>

      <div className="p-4 space-y-1.5">
        {ledgerRows.map((row) => (
          <div key={row.label} className="flex items-baseline justify-between gap-3">
            <span className="text-[13px] text-muted-foreground">{row.label}</span>
            <span className={cn('text-[14px] font-medium tabular-nums', TONE_CLASS[row.tone])}>
              {row.value}
            </span>
          </div>
        ))}

        {totalRow && (
          <div className="flex items-baseline justify-between gap-3 mt-1.5 pt-2.5 border-t border-border/40">
            <span className={cn('text-[13px] font-semibold', TONE_CLASS[totalRow.tone])}>
              {totalRow.label}
            </span>
            <span className={cn('text-[16px] font-semibold tabular-nums', TONE_CLASS[totalRow.tone])}>
              {totalRow.value}
            </span>
          </div>
        )}

        {receipt.asides.map((aside) => (
          <p key={aside} className="text-[12px] text-muted-foreground pt-1 leading-relaxed">
            {aside}
          </p>
        ))}

        {showQuickAdd && (
          <button
            type="button"
            onClick={() => onQuickAdd?.(hour.startMin)}
            className="mt-2 h-8 px-3 rounded-lg bg-foreground text-background hover:bg-foreground/90 text-[13px] font-medium transition-colors"
          >
            Add shift for this hour
          </button>
        )}
      </div>
    </div>
  );
}
