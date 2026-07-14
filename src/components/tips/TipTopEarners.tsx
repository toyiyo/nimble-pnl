import { useMemo } from 'react';

// UI components (shadcn)
import { Button } from '@/components/ui/button';

// Utils
import {
  aggregateTipDistribution,
  formatSharePct,
  getInitials,
  type EmployeeDistribution,
} from '@/utils/tipDistribution';
import { formatCurrencyFromCents } from '@/utils/tipPooling';

// Types
import type { TipSplitWithItems } from '@/hooks/useTipSplits';

interface TipTopEarnersProps {
  splits: TipSplitWithItems[] | undefined;
  /** Navigates to the Distribution tab. Affordance is hidden when omitted. */
  onViewAll?: () => void;
}

/**
 * TipTopEarners — compact "at a glance" strip inside `TipPeriodSummary`
 * showing the top 3 employees by earned tips for the selected period.
 *
 * Reuses `aggregateTipDistribution` (finalized splits only — no new
 * aggregation, no payout/payment-status data). Presentational only.
 */
export function TipTopEarners({ splits, onViewAll }: TipTopEarnersProps) {
  const topEmployees = useMemo(() => {
    const result = aggregateTipDistribution(splits ?? [], []);
    return result.employees.slice(0, 3);
  }, [splits]);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider">
            Top earners
          </p>
          <p className="text-[11px] text-muted-foreground">Finalized allocations only</p>
        </div>
        {onViewAll && (
          <Button
            variant="ghost"
            onClick={onViewAll}
            aria-label="View all earners in Distribution"
            className="h-9 px-4 rounded-lg text-[13px] font-medium text-muted-foreground hover:text-foreground"
          >
            View all
          </Button>
        )}
      </div>

      {topEmployees.length === 0 ? (
        <p className="text-[13px] text-muted-foreground">No approved allocations yet</p>
      ) : (
        <ul className="space-y-1.5" aria-label="Top earners">
          {topEmployees.map((employee) => (
            <TopEarnerRow key={employee.employeeId} employee={employee} />
          ))}
        </ul>
      )}
    </div>
  );
}

function TopEarnerRow({ employee }: { employee: EmployeeDistribution }) {
  const initials = getInitials(employee.name);
  const roleLabel = employee.role ?? 'No role';
  const sharePctLabel = formatSharePct(employee.sharePct);
  const earnedLabel = formatCurrencyFromCents(employee.earnedCents);

  const ariaLabel = `${employee.name}, ${roleLabel}, earned ${earnedLabel}, ${sharePctLabel} of pool`;

  return (
    <li
      aria-label={ariaLabel}
      className="rounded-lg border border-border/40 bg-background px-3 py-2"
    >
      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-3">
        {/* Avatar + name (role shown inline at sm:+, condensed line below sm:) */}
        <div className="flex min-w-0 flex-1 items-center gap-2.5">
          <div
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-[12px] font-medium text-foreground"
            aria-hidden="true"
          >
            {initials}
          </div>
          <div className="min-w-0">
            <p className="truncate text-[14px] font-medium text-foreground">{employee.name}</p>
            <p className="hidden truncate text-[13px] text-muted-foreground sm:block">{roleLabel}</p>
          </div>
        </div>

        {/* Mobile-only condensed second line: role · share (bar hidden below sm:) */}
        <p className="pl-[42px] text-[13px] text-muted-foreground sm:hidden">
          {roleLabel} &middot; {sharePctLabel}
        </p>

        {/* Share-of-pool bar — number is the a11y signal; bar is decorative */}
        <div className="hidden shrink-0 items-center gap-2 sm:flex sm:w-28">
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted" aria-hidden="true">
            <div
              className="h-full rounded-full bg-foreground"
              style={{ width: `${Math.min(100, employee.sharePct)}%` }}
            />
          </div>
          <span className="w-12 shrink-0 text-right text-[12px] tabular-nums text-muted-foreground">
            {sharePctLabel}
          </span>
        </div>

        <span className="shrink-0 text-[14px] font-medium tabular-nums text-foreground sm:w-20 sm:text-right">
          {earnedLabel}
        </span>
      </div>
    </li>
  );
}
