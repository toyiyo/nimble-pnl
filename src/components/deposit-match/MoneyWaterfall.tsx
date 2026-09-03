import { formatCurrency } from '@/lib/utils';
import { waterfallSegments } from '@/lib/depositMatchUi';
import type { DepositMatchReport } from '@/types/depositMatch';

interface MoneyWaterfallProps {
  report: DepositMatchReport;
}

const SEGMENT_COLOR: Record<string, string> = {
  deposited: 'bg-emerald-500',
  settling: 'bg-blue-500',
  fees: 'bg-muted-foreground/40',
  needs_review: 'bg-amber-500',
};

/** POS card total = deposited + settling + fees + needs review. */
export function MoneyWaterfall({ report }: MoneyWaterfallProps) {
  const segments = waterfallSegments(report);
  const total = report.summary.total_expected;

  return (
    <div className="rounded-xl border border-border/40 bg-background p-4 space-y-3">
      <h3 className="text-[13px] font-semibold text-foreground">Money trail</h3>
      <div className="flex h-3 w-full overflow-hidden rounded-full bg-muted">
        {segments.map((segment) => {
          const widthPct = total > 0 ? Math.max(0, (segment.amount / total) * 100) : 0;
          return (
            <div
              key={segment.key}
              className={SEGMENT_COLOR[segment.key]}
              style={{ width: `${widthPct}%` }}
              title={`${segment.label}: ${formatCurrency(segment.amount)}`}
            />
          );
        })}
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {segments.map((segment) => (
          <div key={segment.key} className="space-y-0.5">
            <div className="flex items-center gap-1.5">
              <span className={`h-2 w-2 rounded-full ${SEGMENT_COLOR[segment.key]}`} aria-hidden="true" />
              <span className="text-[12px] text-muted-foreground">{segment.label}</span>
            </div>
            <p className="text-[14px] font-medium text-foreground">{formatCurrency(segment.amount)}</p>
          </div>
        ))}
      </div>
      <p className="text-[12px] text-muted-foreground">POS card total: {formatCurrency(total)}</p>
    </div>
  );
}
