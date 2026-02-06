import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Skeleton } from "@/components/ui/skeleton";
import { Info, Target, TrendingUp, CheckCircle, AlertTriangle, Minus } from "lucide-react";
import { Link } from "react-router-dom";

const formatCurrency = (value: number, abbreviated = false) => {
  if (abbreviated && Math.abs(value) >= 1000) {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      notation: "compact",
      maximumFractionDigits: 1,
    }).format(value);
  }
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
};

interface BreakEvenStatusData {
  dailyBreakEven: number;
  todayStatus: 'above' | 'at' | 'below';
  todayDelta: number;
  daysAbove: number;
  daysBelow: number;
  historyDays: number;
}

interface OwnerSnapshotWidgetProps {
  todaySales: number;
  profitMargin: number;
  availableCash: number;
  cashRunway: number;
  todayFoodCost: number;
  todayLaborCost: number;
  lastUpdated?: string;
  breakEvenData?: BreakEvenStatusData | null;
  breakEvenLoading?: boolean;
}

export function OwnerSnapshotWidget({
  todaySales,
  profitMargin,
  availableCash,
  cashRunway,
  todayFoodCost,
  todayLaborCost,
  lastUpdated,
  breakEvenData,
  breakEvenLoading = false,
}: OwnerSnapshotWidgetProps) {
  const primeCost = todaySales > 0 ? ((todayFoodCost + todayLaborCost) / todaySales) * 100 : 0;

  const getProfitMarginColor = (pct: number) => {
    if (pct < 10) return "text-destructive";
    if (pct < 15) return "text-orange-500";
    return "text-green-600";
  };

  const getPrimeCostColor = (pct: number) => {
    if (pct > 68) return "text-destructive";
    if (pct > 65) return "text-orange-500";
    return "text-green-600";
  };

  const getRunwayColor = (days: number) => {
    if (days < 30) return "text-destructive";
    if (days < 60) return "text-orange-500";
    return "text-green-600";
  };

  const formatRunway = (days: number) => {
    if (days > 365) return "365+";
    return Math.floor(days).toString();
  };

  const getBreakEvenStatusDisplay = (status: 'above' | 'at' | 'below') => {
    switch (status) {
      case 'above':
        return {
          icon: CheckCircle,
          label: 'Above',
          color: 'text-green-600',
          bgColor: 'bg-green-500/10',
        };
      case 'at':
        return {
          icon: Minus,
          label: 'At break-even',
          color: 'text-orange-500',
          bgColor: 'bg-orange-500/10',
        };
      case 'below':
        return {
          icon: AlertTriangle,
          label: 'Below',
          color: 'text-destructive',
          bgColor: 'bg-destructive/10',
        };
    }
  };

  return (
    <TooltipProvider>
      <div className="rounded-xl border border-border/40 bg-background overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-border/40">
          <h3 className="text-[14px] font-medium text-foreground">Today's Snapshot</h3>
          {lastUpdated && (
            <span className="text-[11px] px-1.5 py-0.5 rounded-md bg-muted text-muted-foreground font-medium">
              {lastUpdated}
            </span>
          )}
        </div>

        {/* Core Metrics Row */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-px bg-border/40">
          {/* Revenue Today */}
          <div className="bg-background p-4">
            <p className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider">Revenue</p>
            <p className="text-[20px] font-semibold text-foreground mt-1">{formatCurrency(todaySales)}</p>
          </div>

          {/* Profit Margin */}
          <div className="bg-background p-4">
            <div className="flex items-center gap-1">
              <p className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider">Margin</p>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button type="button" className="inline-flex" aria-label="Margin info">
                    <Info className="h-3 w-3 text-muted-foreground cursor-help" />
                  </button>
                </TooltipTrigger>
                <TooltipContent>
                  <p className="max-w-xs">Net profit as % of revenue. Target: 15%+</p>
                </TooltipContent>
              </Tooltip>
            </div>
            <p className={`text-[20px] font-semibold mt-1 ${getProfitMarginColor(profitMargin)}`}>
              {profitMargin.toFixed(1)}%
            </p>
          </div>

          {/* Available Cash */}
          <div className="bg-background p-4">
            <p className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider">Cash</p>
            <p className="text-[20px] font-semibold text-foreground mt-1">
              {formatCurrency(availableCash, true)}
            </p>
          </div>

          {/* Cash Runway */}
          <div className="bg-background p-4">
            <div className="flex items-center gap-1">
              <p className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider">Runway</p>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button type="button" className="inline-flex" aria-label="Runway info">
                    <Info className="h-3 w-3 text-muted-foreground cursor-help" />
                  </button>
                </TooltipTrigger>
                <TooltipContent>
                  <p className="max-w-xs">Days of cash at current burn rate. Target: 60+ days</p>
                </TooltipContent>
              </Tooltip>
            </div>
            <p className={`text-[20px] font-semibold mt-1 ${getRunwayColor(cashRunway)}`}>
              {formatRunway(cashRunway)}d
            </p>
          </div>

          {/* Prime Cost */}
          <div className="bg-background p-4">
            <div className="flex items-center gap-1">
              <p className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider">Prime Cost</p>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button type="button" className="inline-flex" aria-label="Prime cost info">
                    <Info className="h-3 w-3 text-muted-foreground cursor-help" />
                  </button>
                </TooltipTrigger>
                <TooltipContent>
                  <p className="max-w-xs">Food + Labor costs. Healthy range: 60-65% of sales</p>
                </TooltipContent>
              </Tooltip>
            </div>
            <p className={`text-[20px] font-semibold mt-1 ${getPrimeCostColor(primeCost)}`}>
              {primeCost.toFixed(1)}%
            </p>
          </div>
        </div>

        {/* Break-Even Status Section */}
        <div className="px-5 py-3 border-t border-border/40">
          {breakEvenLoading ? (
            <div className="flex items-center gap-4">
              <Skeleton className="h-8 w-32" />
              <Skeleton className="h-8 w-40" />
            </div>
          ) : !breakEvenData || breakEvenData.dailyBreakEven === 0 ? (
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Target className="h-4 w-4 text-muted-foreground" />
                <span className="text-[13px] text-muted-foreground">Set up daily costs for break-even analysis</span>
              </div>
              <Link
                to="/budget"
                className="text-[13px] font-medium text-foreground hover:text-foreground/70 transition-colors"
              >
                Configure →
              </Link>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-4">
              <div className="flex items-center gap-2 text-[13px] text-muted-foreground">
                <Target className="h-3.5 w-3.5" />
                <span>Break-even: {formatCurrency(breakEvenData.dailyBreakEven)}/day</span>
              </div>

              {(() => {
                const statusDisplay = getBreakEvenStatusDisplay(breakEvenData.todayStatus);
                const StatusIcon = statusDisplay.icon;
                return (
                  <div className={`flex items-center gap-1.5 px-2 py-1 rounded-lg ${statusDisplay.bgColor}`}>
                    <StatusIcon className={`h-3.5 w-3.5 ${statusDisplay.color}`} />
                    <span className={`text-[13px] font-medium ${statusDisplay.color}`}>
                      {breakEvenData.todayDelta >= 0 ? '+' : ''}{formatCurrency(breakEvenData.todayDelta)}
                    </span>
                  </div>
                );
              })()}

              <span className="text-[12px] text-muted-foreground">
                Last {breakEvenData.historyDays}d: <span className="font-medium text-green-600">{breakEvenData.daysAbove}</span> above · <span className="font-medium text-destructive">{breakEvenData.daysBelow}</span> below
              </span>

              <Link
                to="/budget"
                className="ml-auto text-[13px] font-medium text-foreground hover:text-foreground/70 transition-colors flex items-center gap-1"
              >
                Details
                <TrendingUp className="h-3 w-3" />
              </Link>
            </div>
          )}
        </div>
      </div>
    </TooltipProvider>
  );
}
