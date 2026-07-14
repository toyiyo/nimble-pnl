import { useMemo } from 'react';

// UI components (shadcn)
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';

// Icons
import { AlertTriangle, Check, Clock, Users } from 'lucide-react';

// Utils
import {
  aggregateTipDistribution,
  paymentStatus,
  type EmployeeDistribution,
  type PaymentStatus,
} from '@/utils/tipDistribution';
import { formatCurrencyFromCents } from '@/utils/tipPooling';

// Types
import type { TipSplitWithItems } from '@/hooks/useTipSplits';
import type { TipPayoutWithEmployee } from '@/hooks/useTipPayouts';

interface TipDistributionProps {
  splits: TipSplitWithItems[] | undefined;
  payouts: TipPayoutWithEmployee[];
  /** periodSplitsLoading || payoutsLoading */
  isLoading: boolean;
  /** !!periodSplitsError || !!payoutsError */
  isError: boolean;
  /** CTA target when there's nothing finalized to show yet */
  onNavigateToOverview: () => void;
}

/**
 * TipDistribution — read-only per-employee breakdown of finalized tips for
 * the selected period, including payout status.
 *
 * Aggregation logic lives in `src/utils/tipDistribution.ts`; this component
 * is purely presentational over that result.
 */
export function TipDistribution({
  splits,
  payouts,
  isLoading,
  isError,
  onNavigateToOverview,
}: TipDistributionProps) {
  const result = useMemo(
    () => aggregateTipDistribution(splits ?? [], payouts),
    [splits, payouts],
  );

  if (isLoading) {
    return (
      <div
        className="space-y-3"
        data-testid="tip-distribution-loading"
        role="status"
        aria-live="polite"
      >
        <Card className="rounded-xl border-border/40">
          <CardContent className="pt-6">
            <Skeleton className="h-16 w-full" />
          </CardContent>
        </Card>
        <div className="space-y-2">
          <Skeleton className="h-16 w-full rounded-xl" />
          <Skeleton className="h-16 w-full rounded-xl" />
          <Skeleton className="h-16 w-full rounded-xl" />
        </div>
      </div>
    );
  }

  if (isError) {
    return (
      <Alert className="border-destructive/50 bg-destructive/10" data-testid="tip-distribution-error">
        <AlertTriangle className="h-4 w-4 text-destructive" />
        <AlertDescription className="text-sm">
          Couldn&apos;t load the tip distribution. Try again in a moment.
        </AlertDescription>
      </Alert>
    );
  }

  if (result.employees.length === 0) {
    return (
      <Card className="rounded-xl border-border/40">
        <CardContent className="pt-8 pb-8 flex flex-col items-center gap-3 text-center">
          <div className="h-10 w-10 rounded-xl bg-muted/50 flex items-center justify-center">
            <Users className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
          </div>
          <div>
            <p className="text-[14px] font-medium text-foreground">No finalized tips for this period</p>
            <p className="text-[13px] text-muted-foreground mt-0.5 max-w-sm">
              Approve or archive a day&apos;s split in Overview to see the distribution here.
            </p>
          </div>
          <Button
            onClick={onNavigateToOverview}
            className="h-9 px-4 rounded-lg bg-foreground text-background hover:bg-foreground/90 text-[13px] font-medium"
          >
            Go to Overview
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card className="rounded-xl border-border/40" data-testid="tip-distribution-summary">
        <CardContent className="pt-6">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="space-y-1">
              <p className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider">
                Total distributed
              </p>
              <p className="text-[22px] font-semibold text-foreground">
                {formatCurrencyFromCents(result.totalEarnedCents)}
              </p>
            </div>
            <div className="space-y-1">
              <p className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider">
                Employees
              </p>
              <p className="text-[22px] font-semibold text-foreground">{result.employees.length}</p>
            </div>
            <div className="space-y-1">
              <p className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider">
                Paid
              </p>
              <p className="text-[22px] font-semibold text-foreground">
                {formatCurrencyFromCents(result.totalPaidCents)}
              </p>
            </div>
            <div className="space-y-1">
              <p className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider">
                Unpaid
              </p>
              <p className="text-[22px] font-semibold text-foreground">
                {formatCurrencyFromCents(result.totalUnpaidCents)}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      <ul className="space-y-2" aria-label="Tip distribution by employee">
        {result.employees.map((employee) => (
          <EmployeeRow key={employee.employeeId} employee={employee} />
        ))}
      </ul>
    </div>
  );
}

function EmployeeRow({ employee }: { employee: EmployeeDistribution }) {
  const status = paymentStatus(employee);
  const initials = getInitials(employee.name);
  const sharePctLabel = formatSharePct(employee.sharePct);
  const roleLabel = employee.role ?? 'No role';

  const ariaLabel = `${employee.name}, ${roleLabel}, earned ${formatCurrencyFromCents(
    employee.earnedCents,
  )}, ${sharePctLabel} of pool, ${statusAriaText(status, employee)}`;

  return (
    <li aria-label={ariaLabel} className="rounded-xl border border-border/40 bg-background p-4">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-3">
        {/* Avatar + name + role (role hidden on the same line below sm:) */}
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <div
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted text-[13px] font-medium text-foreground"
            aria-hidden="true"
          >
            {initials}
          </div>
          <div className="min-w-0">
            <p className="truncate text-[14px] font-medium text-foreground">{employee.name}</p>
            {employee.role && (
              <p className="hidden truncate text-[13px] text-muted-foreground sm:block">
                {employee.role}
              </p>
            )}
          </div>
        </div>

        {/* Mobile-only second line: role · hours · share (bar hidden below sm:) */}
        <p className="pl-12 text-[13px] text-muted-foreground sm:hidden">
          {roleLabel} &middot; {formatHours(employee.hoursWorked)} &middot; {sharePctLabel}
        </p>

        {/* Share-of-pool bar — number is the a11y signal; bar is decorative */}
        <div className="hidden shrink-0 items-center gap-2 sm:flex sm:w-32">
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

        <div className="hidden shrink-0 text-right text-[13px] tabular-nums text-muted-foreground sm:block sm:w-14">
          {formatHours(employee.hoursWorked)}
        </div>

        <div className="flex shrink-0 items-center justify-between gap-2 sm:justify-end">
          <span className="text-[14px] font-medium tabular-nums text-foreground sm:w-20 sm:text-right">
            {formatCurrencyFromCents(employee.earnedCents)}
          </span>
          <StatusBadge status={status} employee={employee} />
        </div>
      </div>
    </li>
  );
}

function StatusBadge({ status, employee }: { status: PaymentStatus; employee: EmployeeDistribution }) {
  if (status === 'paid') {
    return (
      <Badge className="bg-success/10 text-success border-success/20">
        <Check className="mr-1 h-3 w-3" aria-hidden="true" />
        Paid
      </Badge>
    );
  }

  if (status === 'partial') {
    return (
      <Badge className="bg-warning/10 text-warning border-warning/20">
        <Clock className="mr-1 h-3 w-3" aria-hidden="true" />
        {formatCurrencyFromCents(employee.paidCents)} / {formatCurrencyFromCents(employee.earnedCents)}
      </Badge>
    );
  }

  return (
    <Badge className="bg-muted text-muted-foreground border-border/40">
      <Clock className="mr-1 h-3 w-3" aria-hidden="true" />
      Unpaid
    </Badge>
  );
}

function statusAriaText(status: PaymentStatus, employee: EmployeeDistribution): string {
  if (status === 'paid') return 'paid';
  if (status === 'partial') {
    return `partially paid, ${formatCurrencyFromCents(employee.paidCents)} of ${formatCurrencyFromCents(
      employee.earnedCents,
    )}`;
  }
  return 'unpaid';
}

function formatSharePct(pct: number): string {
  return `${pct.toFixed(1)}%`;
}

function formatHours(hours: number): string {
  return `${hours.toFixed(1)}h`;
}

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
