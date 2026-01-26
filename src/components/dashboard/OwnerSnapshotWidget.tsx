import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Skeleton } from "@/components/ui/skeleton";
import { DollarSign, Gauge, Info, Target, TrendingUp, TrendingDown, CheckCircle, AlertTriangle, Minus } from "lucide-react";
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

  const getBreakEvenStatusDisplay = (status: 'above' | 'at' | 'below', delta: number) => {
    switch (status) {
      case 'above':
        return {
          icon: CheckCircle,
          label: 'Above',
          color: 'text-green-600',
          bgColor: 'bg-green-500/10',
          borderColor: 'border-green-500/20',
        };
      case 'at':
        return {
          icon: Minus,
          label: 'At',
          color: 'text-orange-500',
          bgColor: 'bg-orange-500/10',
          borderColor: 'border-orange-500/20',
        };
      case 'below':
        return {
          icon: AlertTriangle,
          label: 'Below',
          color: 'text-destructive',
          bgColor: 'bg-destructive/10',
          borderColor: 'border-destructive/20',
        };
    }
  };

  return (
    <TooltipProvider>
      <Card className="bg-gradient-to-br from-primary/5 via-accent/5 to-transparent border-primary/10">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-lg flex items-center gap-2">
              <Gauge className="h-5 w-5 text-primary" />
              Owner Snapshot
            </CardTitle>
            {lastUpdated && (
              <Badge variant="outline" className="text-xs">
                Updated {lastUpdated}
              </Badge>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Core Metrics Row */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            {/* Revenue Collected Today */}
            <div className="space-y-1">
              <p className="text-sm text-muted-foreground">Revenue Today</p>
              <p className="text-2xl font-bold">{formatCurrency(todaySales)}</p>
            </div>

            {/* Current Profit Margin */}
            <div className="space-y-1">
              <div className="flex items-center gap-1">
                <p className="text-sm text-muted-foreground">Profit Margin</p>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Info className="h-3 w-3 text-muted-foreground cursor-help" />
                  </TooltipTrigger>
                  <TooltipContent>
                    <p className="max-w-xs">Net profit as % of revenue. Target: 15%+</p>
                  </TooltipContent>
                </Tooltip>
              </div>
              <p className={`text-2xl font-bold ${getProfitMarginColor(profitMargin)}`}>
                {profitMargin.toFixed(1)}%
              </p>
            </div>

            {/* Available Cash */}
            <div className="space-y-1">
              <p className="text-sm text-muted-foreground">Available Cash</p>
              <p className="text-2xl font-bold flex items-center gap-1">
                <DollarSign className="h-4 w-4" />
                {formatCurrency(availableCash, true)}
              </p>
            </div>

            {/* Cash Runway */}
            <div className="space-y-1">
              <div className="flex items-center gap-1">
                <p className="text-sm text-muted-foreground">Runway</p>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Info className="h-3 w-3 text-muted-foreground cursor-help" />
                  </TooltipTrigger>
                  <TooltipContent>
                    <p className="max-w-xs">Days of cash at current burn rate. Target: 60+ days</p>
                  </TooltipContent>
                </Tooltip>
              </div>
              <p className={`text-2xl font-bold ${getRunwayColor(cashRunway)}`}>
                {formatRunway(cashRunway)} days
              </p>
            </div>

            {/* Prime Cost */}
            <div className="space-y-1">
              <div className="flex items-center gap-1">
                <p className="text-sm text-muted-foreground">Prime Cost</p>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Info className="h-3 w-3 text-muted-foreground cursor-help" />
                  </TooltipTrigger>
                  <TooltipContent>
                    <p className="max-w-xs">Food + Labor costs. Healthy range: 60–65% of sales</p>
                  </TooltipContent>
                </Tooltip>
              </div>
              <p className={`text-2xl font-bold ${getPrimeCostColor(primeCost)}`}>
                {primeCost.toFixed(1)}%
              </p>
            </div>
          </div>

          {/* Break-Even Status Section */}
          <div className="pt-3 border-t border-border/50">
            <div className="flex items-center gap-2 mb-3">
              <Target className="h-4 w-4 text-primary" />
              <span className="text-sm font-medium text-muted-foreground">Break-Even Status</span>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Info className="h-3 w-3 text-muted-foreground cursor-help" />
                </TooltipTrigger>
                <TooltipContent>
                  <p className="max-w-xs">Are today's sales covering your daily operating costs?</p>
                </TooltipContent>
              </Tooltip>
            </div>
            
            {breakEvenLoading ? (
              <div className="flex items-center gap-4">
                <Skeleton className="h-12 w-32" />
                <Skeleton className="h-12 w-40" />
                <Skeleton className="h-8 w-24" />
              </div>
            ) : !breakEvenData || breakEvenData.dailyBreakEven === 0 ? (
              <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/50 border border-border/50">
                <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center">
                  <Target className="h-4 w-4 text-primary" />
                </div>
                <div className="flex-1">
                  <p className="text-sm font-medium">Set up your daily costs to see break-even analysis</p>
                  <p className="text-xs text-muted-foreground">Know if today's sales are covering your costs</p>
                </div>
                <Link 
                  to="/budget" 
                  className="text-sm font-medium text-primary hover:underline"
                >
                  Configure Budget →
                </Link>
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-4">
                {/* Daily Target */}
                <div className="space-y-0.5">
                  <p className="text-xs text-muted-foreground">Daily Target</p>
                  <p className="text-lg font-semibold">{formatCurrency(breakEvenData.dailyBreakEven)}/day</p>
                </div>
                
                {/* Today's Status */}
                {(() => {
                  const statusDisplay = getBreakEvenStatusDisplay(breakEvenData.todayStatus, breakEvenData.todayDelta);
                  const StatusIcon = statusDisplay.icon;
                  return (
                    <div className={`flex items-center gap-2 px-3 py-2 rounded-lg ${statusDisplay.bgColor} border ${statusDisplay.borderColor}`}>
                      <StatusIcon className={`h-4 w-4 ${statusDisplay.color}`} />
                      <div className="flex items-baseline gap-1.5">
                        <span className={`text-sm font-medium ${statusDisplay.color}`}>
                          {statusDisplay.label}
                        </span>
                        <span className={`text-lg font-bold ${statusDisplay.color}`}>
                          {breakEvenData.todayDelta >= 0 ? '+' : ''}{formatCurrency(breakEvenData.todayDelta)}
                        </span>
                      </div>
                    </div>
                  );
                })()}
                
                {/* Historical Summary */}
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <span>Last {breakEvenData.historyDays} days:</span>
                  <span className="font-medium text-green-600">{breakEvenData.daysAbove} above</span>
                  <span>•</span>
                  <span className="font-medium text-destructive">{breakEvenData.daysBelow} below</span>
                </div>
                
                {/* Link to full details */}
                <Link 
                  to="/budget" 
                  className="ml-auto text-sm font-medium text-primary hover:underline flex items-center gap-1"
                >
                  View Details
                  <TrendingUp className="h-3 w-3" />
                </Link>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </TooltipProvider>
  );
}
