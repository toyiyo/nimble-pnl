import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { DollarSign, TrendingUp, TrendingDown, Activity } from "lucide-react";

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

interface TodaysPulseWidgetProps {
  todaySales: number;
  todayFoodCost: number;
  todayLaborCost: number;
  availableCash: number;
  estimatedProfit: number;
  lastUpdated?: string;
}

export function TodaysPulseWidget({
  todaySales,
  todayFoodCost,
  todayLaborCost,
  availableCash,
  estimatedProfit,
  lastUpdated,
}: TodaysPulseWidgetProps) {
  const foodCostPct = todaySales > 0 ? (todayFoodCost / todaySales) * 100 : 0;
  const laborCostPct = todaySales > 0 ? (todayLaborCost / todaySales) * 100 : 0;
  const profitMargin = todaySales > 0 ? (estimatedProfit / todaySales) * 100 : 0;

  const getStatusColor = (pct: number, type: "food" | "labor") => {
    const threshold = type === "food" ? 32 : 30;
    if (pct > threshold + 3) return "text-destructive";
    if (pct > threshold) return "text-orange-500";
    return "text-green-600";
  };

  return (
    <Card className="bg-gradient-to-br from-primary/5 via-accent/5 to-transparent border-primary/10">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg flex items-center gap-2">
            <Activity className="h-5 w-5 text-primary" />
            Today's Pulse
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
          {/* Sales Today */}
          <div className="space-y-1">
            <p className="text-sm text-muted-foreground">Sales</p>
            <p className="text-2xl font-bold">{formatCurrency(todaySales)}</p>
          </div>

          {/* Food Cost */}
          <div className="space-y-1">
            <p className="text-sm text-muted-foreground">Food Cost</p>
            <p className={`text-2xl font-bold ${getStatusColor(foodCostPct, "food")}`}>
              {foodCostPct.toFixed(1)}%
            </p>
          </div>

          {/* Labor Cost */}
          <div className="space-y-1">
            <p className="text-sm text-muted-foreground">Labor</p>
            <p className={`text-2xl font-bold ${getStatusColor(laborCostPct, "labor")}`}>
              {laborCostPct.toFixed(1)}%
            </p>
          </div>

          {/* Cash Available */}
          <div className="space-y-1">
            <p className="text-sm text-muted-foreground">Cash</p>
            <p className="text-2xl font-bold flex items-center gap-1">
              <DollarSign className="h-4 w-4" />
              {formatCurrency(availableCash, true)}
            </p>
          </div>

          {/* Estimated Profit */}
          <div className="space-y-1">
            <p className="text-sm text-muted-foreground">Est. Profit</p>
            <p
              className={`text-2xl font-bold flex items-center gap-1 ${
                estimatedProfit >= 0 ? "text-green-600" : "text-destructive"
              }`}
            >
              {estimatedProfit >= 0 ? (
                <TrendingUp className="h-4 w-4" />
              ) : (
                <TrendingDown className="h-4 w-4" />
              )}
              {formatCurrency(estimatedProfit, true)}
            </p>
          </div>
        </div>

        {/* Profit Margin Badge */}
        <div className="mt-3 pt-3 border-t">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Profit Margin:</span>
            <Badge
              variant={profitMargin >= 15 ? "default" : profitMargin >= 10 ? "secondary" : "destructive"}
              className="font-semibold"
            >
              {profitMargin.toFixed(1)}%
            </Badge>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
