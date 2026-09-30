import { Link } from "react-router-dom";

import { Skeleton } from "@/components/ui/skeleton";

import { formatRunway } from "@/lib/formatRunway";
import { buildBreakEvenHeadline } from "@/lib/breakEvenHeadline";
import type { BreakEvenHeadline, BreakEvenHeadlineTone } from "@/lib/breakEvenHeadline";
import { formatWholeDollarAmount } from "@/lib/formatWholeDollarAmount";

interface BreakEvenStatusData {
  dailyBreakEven: number;
  todayStatus: 'above' | 'at' | 'below';
  todayDelta: number;
  daysAbove: number;
  daysBelow: number;
  historyDays: number;
}

interface DashboardTodayCardProps {
  todaySales: number;
  profitMargin: number;
  availableCash: number;
  cashRunway: number;
  todayFoodCost: number;
  todayLaborCost: number;
  monthToDateSales: number;
  primeCostPercentage: number;
  breakEvenData?: BreakEvenStatusData | null;
  breakEvenLoading?: boolean;
  breakEvenError?: boolean;
  cashLoading?: boolean;
  runwayLoading?: boolean;
}

// The day is still open, so a shortfall is not final. Show it in the
// normal text color, not in red.
const HEADLINE_COLOR_BY_TONE: Record<BreakEvenHeadlineTone, string> = {
  positive: 'text-foreground',
  negative: 'text-foreground',
  neutral: 'text-muted-foreground',
};

const KPI_LABEL_CLASS = "text-[12px] font-medium text-muted-foreground uppercase tracking-wider";
const KPI_VALUE_CLASS = "text-[17px] font-semibold text-foreground mt-1";

interface KpiValueProps {
  readonly isLoading: boolean;
  readonly isError?: boolean;
  readonly children: React.ReactNode;
}

function KpiValue({ isLoading, isError = false, children }: KpiValueProps) {
  if (isLoading) {
    return (
      <dd>
        <Skeleton className="h-[17px] w-16 mt-1" />
      </dd>
    );
  }
  if (isError) {
    return <dd className="text-[17px] font-semibold text-muted-foreground mt-1">—</dd>;
  }
  return <dd className={KPI_VALUE_CLASS}>{children}</dd>;
}

interface HeadlineProps {
  readonly headline: BreakEvenHeadline;
  readonly isLoading: boolean;
  readonly isError: boolean;
}

function Headline({ headline, isLoading, isError }: HeadlineProps) {
  if (isLoading) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-6 w-2/3" />
        <Skeleton className="h-2 w-full" />
      </div>
    );
  }
  if (isError) {
    return (
      <p className="text-[14px] text-muted-foreground">
        Break-even is not available right now.
      </p>
    );
  }
  return (
    <>
      <p className={`text-[22px] font-semibold ${HEADLINE_COLOR_BY_TONE[headline.tone]}`}>
        {headline.sentence}
        {headline.tone === 'neutral' && !headline.hasTarget && (
          <>
            {' '}
            <Link
              to="/budget"
              className="text-[14px] font-medium underline underline-offset-2"
            >
              Set operating costs
            </Link>
          </>
        )}
      </p>
      <progress
        value={headline.progressPercent}
        max={100}
        aria-label="Progress to today's break-even"
        className="block h-2 w-full appearance-none overflow-hidden rounded-full bg-muted [&::-webkit-progress-bar]:bg-muted [&::-webkit-progress-value]:rounded-full [&::-webkit-progress-value]:bg-foreground [&::-moz-progress-bar]:rounded-full [&::-moz-progress-bar]:bg-foreground"
      />
    </>
  );
}

export function DashboardTodayCard({
  todaySales,
  profitMargin,
  availableCash,
  cashRunway,
  todayFoodCost,
  todayLaborCost,
  monthToDateSales,
  primeCostPercentage,
  breakEvenData,
  breakEvenLoading = false,
  breakEvenError = false,
  cashLoading = false,
  runwayLoading = false,
}: Readonly<DashboardTodayCardProps>) {
  const headline = buildBreakEvenHeadline(
    breakEvenData
      ? {
          todayStatus: breakEvenData.todayStatus,
          todayDelta: breakEvenData.todayDelta,
          dailyBreakEven: breakEvenData.dailyBreakEven,
          todaySales,
        }
      : null
  );

  return (
    <div className="rounded-xl border border-border/40 bg-background overflow-hidden">
      <div className="px-5 py-4 space-y-3">
        <Headline headline={headline} isLoading={breakEvenLoading} isError={breakEvenError} />

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 pt-1">
          <div>
            <p className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider">
              Sales today
            </p>
            <p className="text-[18px] font-semibold text-foreground mt-1">
              {formatWholeDollarAmount(todaySales)}
            </p>
          </div>
          <div>
            <p className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider">
              Profit margin
            </p>
            <p className="text-[18px] font-semibold text-foreground mt-1">
              {profitMargin.toFixed(1)}%
            </p>
          </div>
          <div>
            <p className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider">
              Food cost
            </p>
            <p className="text-[18px] font-semibold text-foreground mt-1">
              {formatWholeDollarAmount(todayFoodCost)}
            </p>
          </div>
          <div>
            <p className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider">
              Labor cost
            </p>
            <p className="text-[18px] font-semibold text-foreground mt-1">
              {formatWholeDollarAmount(todayLaborCost)}
            </p>
          </div>
        </div>

        {!breakEvenLoading && !breakEvenError && breakEvenData && (
          <p className="text-[12px] text-muted-foreground pt-1">
            Last {breakEvenData.historyDays}d:{' '}
            <span className="font-medium text-foreground">{breakEvenData.daysAbove}</span> above ·{' '}
            <span className="font-medium text-destructive">{breakEvenData.daysBelow}</span> below
          </p>
        )}
      </div>

      <dl className="grid grid-cols-2 md:grid-cols-4 gap-px bg-border/40 border-t border-border/40">
        <div className="bg-background p-4">
          <dt className={KPI_LABEL_CLASS}>Cash in bank</dt>
          <KpiValue isLoading={cashLoading}>{formatWholeDollarAmount(availableCash)}</KpiValue>
        </div>
        <div className="bg-background p-4">
          <dt className={KPI_LABEL_CLASS}>Runway</dt>
          <KpiValue isLoading={runwayLoading}>{formatRunway(cashRunway)}d</KpiValue>
        </div>
        <div className="bg-background p-4">
          <dt className={KPI_LABEL_CLASS}>Prime cost</dt>
          <KpiValue isLoading={false}>{primeCostPercentage.toFixed(1)}%</KpiValue>
        </div>
        <div className="bg-background p-4">
          <dt className={KPI_LABEL_CLASS}>Month to date</dt>
          <KpiValue isLoading={breakEvenLoading} isError={breakEvenError}>
            {formatWholeDollarAmount(monthToDateSales)}
          </KpiValue>
        </div>
      </dl>
    </div>
  );
}
