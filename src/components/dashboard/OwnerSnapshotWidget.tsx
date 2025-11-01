import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { DollarSign, Gauge, Info } from "lucide-react";

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

interface OwnerSnapshotWidgetProps {
  todaySales: number;
  profitMargin: number;
  availableCash: number;
  cashRunway: number;
  todayFoodCost: number;
  todayLaborCost: number;
  lastUpdated?: string;
}

export function OwnerSnapshotWidget({
  todaySales,
  profitMargin,
  availableCash,
  cashRunway,
  todayFoodCost,
  todayLaborCost,
  lastUpdated,
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
        <CardContent>
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
        </CardContent>
      </Card>
    </TooltipProvider>
  );
}
