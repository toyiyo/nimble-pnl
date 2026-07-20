import { balanceStateBgClassName, type BalanceState, type FinancialPoint } from '@/lib/laborPnlAnalytics';

interface LaborBalanceRibbonProps {
  readonly points: readonly FinancialPoint[];
}

/**
 * Pure: bucket balance state -> Tailwind arbitrary-value background class on
 * the dedicated `--labor-over` / `--labor-under` / `--labor-balanced` tokens
 * (design §7). Thin wrapper over the shared `laborPnlAnalytics.balanceStateBgClassName`
 * (also used by `LaborVerdict`'s tone dot) so the tone->background mapping
 * has one source of truth.
 */
export function balanceChipClassName(state: BalanceState): string {
  return balanceStateBgClassName(state);
}

/** Pure: per-chip aria-label naming the bucket and its balance state. */
export function balanceChipAriaLabel(point: FinancialPoint): string {
  return `${point.label}: ${point.balanceState}`;
}

/**
 * Staffing-balance ribbon (design §2.2/§7): a flex strip with one chip per
 * bucket in `points`, colored over/balanced/under via the dedicated
 * `--labor-*` tokens — never `--splh-lean/slack` (inverted semantics there,
 * design §7). Sits under the shared x-axis of `DemandVsStaffingChart` (D3).
 * Renders nothing for an empty window; the parent chart owns the shared
 * loading/error/empty states (design §6).
 */
export function LaborBalanceRibbon({ points }: LaborBalanceRibbonProps) {
  if (points.length === 0) return null;

  return (
    <div role="list" aria-label="Staffing balance by period" className="flex w-full gap-px">
      {points.map((point) => (
        <div
          key={point.bucketStart}
          role="listitem"
          aria-label={balanceChipAriaLabel(point)}
          className={`h-2 flex-1 rounded-sm ${balanceChipClassName(point.balanceState)}`}
        />
      ))}
    </div>
  );
}
