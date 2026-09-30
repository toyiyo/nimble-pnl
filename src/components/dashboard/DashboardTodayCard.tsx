import { Link } from "react-router-dom";

import { Skeleton } from "@/components/ui/skeleton";

import { formatRunway } from "@/lib/formatRunway";
import { buildBreakEvenHeadline } from "@/lib/breakEvenHeadline";
import { formatWholeDollarAmount, formatCompactDollarAmount } from "@/lib/formatWholeDollarAmount";

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
}: DashboardTodayCardProps) {
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

  const headlineColorByTone: Record<typeof headline.tone, string> = {
    positive: 'text-foreground',
    negative: 'text-destructive',
    neutral: 'text-muted-foreground',
  };
  const headlineColor = headlineColorByTone[headline.tone];

  return (
    <div className="rounded-xl border border-border/40 bg-background overflow-hidden">
      <div className="px-5 py-4 space-y-3">
        {breakEvenLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-6 w-2/3" />
            <Skeleton className="h-2 w-full" />
          </div>
        ) : breakEvenError ? (
          <p className="text-[14px] text-muted-foreground">
            Break-even is not available right now.
          </p>
        ) : (
          <>
            <p className={`text-[22px] font-semibold ${headlineColor}`}>
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
            <div
              role="progressbar"
              aria-valuenow={headline.progressPercent}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label="Progress to today's break-even"
              className="h-2 w-full rounded-full bg-muted overflow-hidden"
            >
              <div
                className="h-full rounded-full bg-foreground"
                style={{ width: `${headline.progressPercent}%` }}
              />
            </div>
          </>
        )}

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
          <dt className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider">
            Cash in bank
          </dt>
          <dd className="text-[17px] font-semibold text-foreground mt-1">
            {formatCompactDollarAmount(availableCash)}
          </dd>
        </div>
        <div className="bg-background p-4">
          <dt className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider">
            Runway
          </dt>
          <dd className="text-[17px] font-semibold text-foreground mt-1">
            {formatRunway(cashRunway)}d
          </dd>
        </div>
        <div className="bg-background p-4">
          <dt className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider">
            Prime cost
          </dt>
          <dd className="text-[17px] font-semibold text-foreground mt-1">
            {primeCostPercentage.toFixed(1)}%
          </dd>
        </div>
        <div className="bg-background p-4">
          <dt className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider">
            Month to date
          </dt>
          <dd className="text-[17px] font-semibold text-foreground mt-1">
            {formatWholeDollarAmount(monthToDateSales)}
          </dd>
        </div>
      </dl>
    </div>
  );
}
