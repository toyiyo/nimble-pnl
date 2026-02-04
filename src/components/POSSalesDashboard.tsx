import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { TrendingUp, DollarSign, Package, AlertCircle, Clock, TrendingDown } from "lucide-react";
import { format } from "date-fns";

interface DashboardMetric {
  label: string;
  value: string | number;
  icon: React.ReactNode;
  trend?: string;
  gradient: string;
}

interface POSSalesDashboardProps {
  totalSales: number;
  totalRevenue: number;
  discounts: number;
  passThroughAmount: number;
  collectedAtPOS: number;
  uniqueItems: number;
  unmappedCount: number;
  lastSyncTime?: string;
  contextCueVisible: boolean;
  cuePinned: boolean;
  onToggleCuePin: () => void;
  contextDescription: string;
  highlightToken: number;
  filtersActive: boolean;
  isLoading?: boolean;
}

// Skeleton gradients for loading state (matching real metrics)
const skeletonGradients = [
  "from-blue-500/10 to-cyan-500/10",
  "from-green-500/10 to-emerald-500/10",
  "from-red-500/10 to-rose-500/10",
  "from-amber-500/10 to-orange-500/10",
  "from-purple-500/10 to-pink-500/10",
];

export const POSSalesDashboard = ({
  totalSales,
  totalRevenue,
  discounts,
  passThroughAmount,
  collectedAtPOS,
  uniqueItems,
  unmappedCount,
  lastSyncTime,
  contextCueVisible,
  cuePinned,
  onToggleCuePin,
  contextDescription,
  highlightToken,
  filtersActive,
  isLoading = false,
}: POSSalesDashboardProps) => {
  const [valueWashActive, setValueWashActive] = useState(false);
  const showFilteredContext = filtersActive || contextCueVisible || cuePinned;

  useEffect(() => {
    if (!highlightToken) return;
    setValueWashActive(true);
    const timeout = setTimeout(() => setValueWashActive(false), 600);
    return () => clearTimeout(timeout);
  }, [highlightToken]);

  const metrics: DashboardMetric[] = [
    {
      label: "Collected at POS",
      value: `$${collectedAtPOS.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
      icon: <DollarSign className="h-5 w-5" />,
      gradient: "from-blue-500/10 to-cyan-500/10",
    },
    {
      label: "Revenue",
      value: `$${totalRevenue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
      icon: <TrendingUp className="h-5 w-5" />,
      gradient: "from-green-500/10 to-emerald-500/10",
    },
    {
      label: "Discounts",
      value: `$${discounts.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
      icon: <TrendingDown className="h-5 w-5" />,
      gradient: "from-red-500/10 to-rose-500/10",
    },
    {
      label: "Pass-Through Items",
      value: `$${passThroughAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
      icon: <AlertCircle className="h-5 w-5" />,
      gradient: "from-amber-500/10 to-orange-500/10",
    },
    {
      label: "Unique Items",
      value: uniqueItems.toLocaleString(),
      icon: <Package className="h-5 w-5" />,
      gradient: "from-purple-500/10 to-pink-500/10",
    },
  ];

  return (
    <div className="space-y-4">
      <div className="relative">
        <button
          type="button"
          aria-pressed={cuePinned}
          onClick={onToggleCuePin}
          className={`absolute right-0 -top-3 z-10 px-3 py-1.5 rounded-full border border-border/60 text-sm font-medium tracking-tight shadow-sm transition-all duration-500 ${
            showFilteredContext ? "opacity-100 translate-y-0" : "opacity-0 -translate-y-1 pointer-events-none"
          } ${cuePinned ? "bg-background/80 text-foreground/80" : "bg-muted/70 text-muted-foreground"}`}
        >
          <span className="block">Showing current view only</span>
        </button>

        <div
          className={`grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4 transition-all duration-300 ${
            showFilteredContext ? "mt-6" : "mt-0"
          }`}
        >
        {isLoading
          ? skeletonGradients.map((gradient, index) => (
              <Card
                key={index}
                className={`bg-gradient-to-br ${gradient} border-none shadow-sm animate-fade-in`}
                style={{ animationDelay: `${index * 50}ms` }}
              >
                <CardContent className="p-6">
                  <div className="flex items-start justify-between">
                    <div className="space-y-2">
                      <Skeleton className="h-4 w-24 bg-muted-foreground/20" />
                      <Skeleton className="h-8 w-32 bg-muted-foreground/20" />
                    </div>
                    <Skeleton className="h-10 w-10 rounded-lg bg-muted-foreground/20" />
                  </div>
                </CardContent>
              </Card>
            ))
          : metrics.map((metric, index) => (
              <Card
                key={index}
                className={`bg-gradient-to-br ${metric.gradient} border-none shadow-sm hover:shadow-md transition-all duration-300 hover:scale-105 animate-fade-in ${
                  contextCueVisible ? "shadow-lg translate-y-1" : ""
                }`}
                style={{ animationDelay: `${index * 100}ms` }}
              >
                <CardContent className="p-6">
                  <div className="flex items-start justify-between">
                    <div className="space-y-2">
                      <p className="text-sm font-medium text-muted-foreground">{metric.label}</p>
                      {showFilteredContext && (
                        <p className="text-[11px] font-light text-muted-foreground/80">Filtered totals</p>
                      )}
                      <p
                        className={`text-2xl font-bold tracking-tight ${
                          valueWashActive ? "cue-value-wash" : ""
                        }`}
                      >
                        {metric.value}
                      </p>
                      {metric.trend && (
                        <p className="text-xs text-muted-foreground">{metric.trend}</p>
                      )}
                    </div>
                    <div className="rounded-lg bg-background/50 p-2.5">
                      {metric.icon}
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
        </div>
      </div>
      {cuePinned && (
        <div className="flex items-center justify-end text-xs text-muted-foreground/80">
          {contextDescription}
        </div>
      )}
      
      {lastSyncTime && (
        <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
          <Clock className="h-3 w-3" />
          <span>Last synced: {format(new Date(lastSyncTime), "MMM d, yyyy 'at' h:mm a")}</span>
        </div>
      )}
    </div>
  );
};
