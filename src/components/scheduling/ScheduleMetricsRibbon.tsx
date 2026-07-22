import { useState, type ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { Calendar, Users, Clock, DollarSign, AlertTriangle, ChevronDown, ChevronUp, TrendingUp } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

import { LaborCostBreakdown } from '@/components/scheduling/LaborCostBreakdown';
import { LaborBudgetIndicator } from '@/components/scheduling/LaborBudgetIndicator';

import type { LaborCostSummary } from '@/hooks/useEmployeeLaborCosts';
import type { ScheduledLaborCostBreakdown } from '@/hooks/useScheduledLaborCosts';
import type { LaborBudgetData } from '@/hooks/useScheduleLaborBudget';

import { cn } from '@/lib/utils';

interface ScheduleMetricsRibbonProps {
  activeEmployeeCount: number;
  totalScheduledHours: number;
  laborCostBreakdown: ScheduledLaborCostBreakdown;
  laborCostSummary: LaborCostSummary;
  laborBudgetData: LaborBudgetData;
  shiftCount: number;
  scheduledEmployeeCount: number;
  isLoading: boolean;
  error?: boolean;
  onEditEmployee: (employeeId: string) => void;
}

interface MetricPillProps {
  icon: LucideIcon;
  value: string;
  unit: string;
  tone?: string;
  children?: ReactNode;
}

function MetricPill({ icon: Icon, value, unit, tone = 'text-foreground', children }: MetricPillProps) {
  return (
    <span className="inline-flex items-center gap-1.5 h-7 pl-2 pr-2.5 rounded-full bg-muted/30 text-[13px]">
      <Icon className="h-3.5 w-3.5 text-muted-foreground" />
      <span className={cn('font-medium tabular-nums', tone)}>{value}</span>
      <span className="text-muted-foreground">{unit}</span>
      {children}
    </span>
  );
}

// Sticky offset couples to AppHeader (h-14 / 56px, sticky top-0 z-50 in
// src/components/AppHeader.tsx). If the header height changes, update top-14.
export function ScheduleMetricsRibbon({
  activeEmployeeCount,
  totalScheduledHours,
  laborCostBreakdown,
  laborCostSummary,
  laborBudgetData,
  shiftCount,
  scheduledEmployeeCount,
  isLoading,
  error = false,
  onEditEmployee,
}: ScheduleMetricsRibbonProps) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  // The panel is only actually shown when there's data to show. Derive one
  // flag so the button label/chevron, aria-expanded, and the panel never
  // disagree (e.g. if loading/error kicks in while the user had it open).
  const detailsExpanded = detailsOpen && !isLoading && !error;

  const isDanger =
    laborCostSummary.isAverageHigh ||
    (laborBudgetData.hasBudget && laborBudgetData.tier === 'danger');
  const isWarning = laborBudgetData.hasBudget && laborBudgetData.tier === 'warning';
  let laborTone = 'text-foreground';
  if (isDanger) {
    laborTone = 'text-destructive';
  } else if (isWarning) {
    laborTone = 'text-warning';
  }

  // Warning affordance copy — covers the combined case, then a high hourly
  // rate, then over-budget (danger) vs nearing-budget (warning). The combined
  // case matters most: a high rate must not mask an over-budget total.
  const overBudget = laborBudgetData.hasBudget && laborBudgetData.tier === 'danger';
  let warningLabel = 'Labor nearing budget warning';
  let warningMessage = 'Scheduled labor is nearing its budget. Open Details to review.';
  if (laborCostSummary.isAverageHigh && overBudget) {
    warningLabel = 'High average rate and over budget warning';
    warningMessage = 'Average hourly rate is unusually high and scheduled labor is over budget. Check employee rates, then open Details to review.';
  } else if (laborCostSummary.isAverageHigh) {
    warningLabel = 'High average rate warning';
    warningMessage = 'Average hourly rate is unusually high. Check for data-entry errors in employee rates.';
  } else if (overBudget) {
    warningLabel = 'Labor over budget warning';
    warningMessage = 'Scheduled labor is over budget. Open Details to review.';
  }

  type BreakdownRow = { key: string; label: string; dot: string; value: string };
  const breakdownRows: BreakdownRow[] = [
    {
      key: 'hourly',
      label: 'Hourly',
      dot: 'bg-primary/60',
      value: `$${laborCostBreakdown.hourly.cost.toLocaleString(undefined, { maximumFractionDigits: 0 })} (${laborCostBreakdown.hourly.hours.toFixed(0)}h)`,
    },
    laborCostBreakdown.salary.cost > 0 && {
      key: 'salary',
      label: 'Salary',
      dot: 'bg-accent/60',
      value: `$${laborCostBreakdown.salary.cost.toLocaleString(undefined, { maximumFractionDigits: 0 })}`,
    },
    laborCostBreakdown.contractor.cost > 0 && {
      key: 'contractor',
      label: 'Contractors',
      dot: 'bg-warning/60',
      value: `$${laborCostBreakdown.contractor.cost.toLocaleString(undefined, { maximumFractionDigits: 0 })}`,
    },
    laborCostBreakdown.daily_rate.cost > 0 && {
      key: 'daily_rate',
      label: 'Daily Rate',
      dot: 'bg-info/60',
      value: `$${laborCostBreakdown.daily_rate.cost.toLocaleString(undefined, { maximumFractionDigits: 0 })}`,
    },
  ].filter((row): row is BreakdownRow => Boolean(row));

  let metricsContent: ReactNode;
  if (error) {
    metricsContent = (
      <p role="alert" className="text-[13px] text-muted-foreground">
        Couldn't load metrics
      </p>
    );
  } else if (isLoading) {
    metricsContent = (
      <div className="flex items-center gap-2" role="status" aria-live="polite" aria-label="Loading metrics">
        <Skeleton className="h-7 w-24 rounded-full" />
        <Skeleton className="h-7 w-24 rounded-full" />
        <Skeleton className="h-7 w-28 rounded-full" />
      </div>
    );
  } else {
    metricsContent = (
      <div className="flex flex-wrap items-center gap-2">
        <MetricPill icon={Users} value={String(activeEmployeeCount)} unit="staff" />
        <MetricPill icon={Clock} value={totalScheduledHours.toFixed(1)} unit="hrs" />
        <MetricPill
          icon={DollarSign}
          value={`$${laborCostBreakdown.total.toLocaleString(undefined, { maximumFractionDigits: 0 })}`}
          unit="labor cost"
          tone={laborTone}
        >
          {(isDanger || isWarning) && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    className="inline-flex pointer-events-auto"
                    aria-label={warningLabel}
                  >
                    <AlertTriangle
                      className={cn('h-3.5 w-3.5', isDanger ? 'text-destructive' : 'text-warning')}
                      aria-hidden="true"
                    />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="max-w-xs">
                  <p className="text-xs">{warningMessage}</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
        </MetricPill>
        {laborCostBreakdown.hourly.hours > 0 && (
          <span className="inline-flex items-center gap-1 text-[12px] text-muted-foreground">
            <TrendingUp className="h-3 w-3" />
            ${laborCostSummary.averageHourlyRate.toFixed(2)}/hr avg
          </span>
        )}
      </div>
    );
  }

  return (
    // `pointer-events-none` on the sticky wrapper is deliberate: because the
    // ribbon pins over content that scrolls beneath it (the tabs/toolbar sit
    // directly below), an opaque sticky box would otherwise intercept clicks
    // meant for those elements once they scroll under it. We re-enable
    // `pointer-events-auto` on the ribbon's own interactive controls only, so
    // clicks pass through the ribbon's empty area to whatever is behind it.
    <div className="sticky top-14 z-30 -mx-4 px-4 bg-background border-b border-border/40 pointer-events-none">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 py-2.5">
        {/* Title group — folds the old hero header in, keeps the page's <h1> */}
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="h-8 w-8 rounded-lg bg-muted/50 flex items-center justify-center shrink-0">
            <Calendar className="h-4 w-4 text-foreground" />
          </div>
          <div className="min-w-0">
            <h1 className="text-[14px] font-semibold text-foreground leading-tight truncate">Staff schedule</h1>
            <p className="text-[12px] text-muted-foreground leading-tight">
              {shiftCount} {shiftCount === 1 ? 'shift' : 'shifts'} · {scheduledEmployeeCount} staff
            </p>
          </div>
        </div>

        {/* Hero metric pills — on mobile these drop to their own row (order-last
            + w-full) so the title and Details toggle stay together on row 1;
            inline with the title on sm+. */}
        <div className="order-last w-full sm:order-none sm:w-auto">
          {metricsContent}
        </div>

        {/* Details disclosure */}
        <Button
          variant="ghost"
          size="sm"
          disabled={isLoading || error}
          onClick={() => setDetailsOpen((open) => !open)}
          aria-expanded={detailsExpanded}
          aria-controls="ribbon-details"
          className="ml-auto h-8 px-2.5 text-[13px] font-medium text-muted-foreground hover:text-foreground transition-colors pointer-events-auto"
        >
          {detailsExpanded ? 'Hide' : 'Details'}
          {detailsExpanded ? <ChevronUp className="h-4 w-4 ml-1" /> : <ChevronDown className="h-4 w-4 ml-1" />}
        </Button>
      </div>

      {/* Collapsible detail — `group` enables LaborCostBreakdown's hover-to-edit */}
      {detailsExpanded && (
        <div id="ribbon-details" className="group grid gap-3 pb-4 pt-1 sm:grid-cols-2 pointer-events-auto">
          <div className="rounded-xl border border-border/40 bg-muted/30 p-3 space-y-2">
            {breakdownRows.map((row) => (
              <div key={row.key} className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground flex items-center gap-1.5">
                  <span className={cn('w-2 h-2 rounded-full', row.dot)} />
                  {row.label}
                </span>
                <span className="font-medium tabular-nums">{row.value}</span>
              </div>
            ))}
            {laborCostBreakdown.hourly.hours > 0 && (
              <div className="flex items-center justify-between text-xs pt-2 border-t border-border/40">
                <span className="text-muted-foreground">Avg Rate</span>
                <span className={cn('font-medium tabular-nums', laborCostSummary.isAverageHigh && 'text-destructive')}>
                  ${laborCostSummary.averageHourlyRate.toFixed(2)}/hr
                </span>
              </div>
            )}
            <LaborBudgetIndicator budgetData={laborBudgetData} />
          </div>

          <div className="rounded-xl border border-border/40 bg-muted/30 p-3">
            {laborCostSummary.employeeCosts.length > 0 ? (
              <LaborCostBreakdown
                employeeCosts={laborCostSummary.employeeCosts}
                onEditEmployee={onEditEmployee}
                maxItems={3}
                showViewAll={false}
              />
            ) : (
              <p className="text-xs text-muted-foreground">No labor costs yet for this week.</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
