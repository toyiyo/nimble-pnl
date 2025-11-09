import { Card, CardContent } from "@/components/ui/card";
import { TrendingUp, DollarSign, Package, AlertCircle, Clock } from "lucide-react";
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
  passThroughAmount: number;
  collectedAtPOS: number;
  uniqueItems: number;
  unmappedCount: number;
  lastSyncTime?: string;
}

export const POSSalesDashboard = ({
  totalSales,
  totalRevenue,
  passThroughAmount,
  collectedAtPOS,
  uniqueItems,
  unmappedCount,
  lastSyncTime,
}: POSSalesDashboardProps) => {
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
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {metrics.map((metric, index) => (
          <Card
            key={index}
            className={`bg-gradient-to-br ${metric.gradient} border-none shadow-sm hover:shadow-md transition-all duration-300 hover:scale-105 animate-fade-in`}
            style={{ animationDelay: `${index * 100}ms` }}
          >
            <CardContent className="p-6">
              <div className="flex items-start justify-between">
                <div className="space-y-2">
                  <p className="text-sm font-medium text-muted-foreground">{metric.label}</p>
                  <p className="text-2xl font-bold tracking-tight">{metric.value}</p>
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
      
      {lastSyncTime && (
        <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
          <Clock className="h-3 w-3" />
          <span>Last synced: {format(new Date(lastSyncTime), "MMM d, yyyy 'at' h:mm a")}</span>
        </div>
      )}
    </div>
  );
};
