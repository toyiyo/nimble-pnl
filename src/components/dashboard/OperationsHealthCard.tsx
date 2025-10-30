import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CheckCircle, AlertTriangle, XCircle, TrendingUp, Package, MapPin } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useNavigate } from "react-router-dom";

interface HealthMetric {
  label: string;
  status: "good" | "warning" | "critical";
  value: string;
  action?: {
    label: string;
    path: string;
  };
}

interface OperationsHealthCardProps {
  primeCost: number;
  primeCostTarget: number;
  lowInventoryCount: number;
  unmappedPOSCount: number;
  uncategorizedTransactions: number;
}

export function OperationsHealthCard({
  primeCost,
  primeCostTarget,
  lowInventoryCount,
  unmappedPOSCount,
  uncategorizedTransactions,
}: OperationsHealthCardProps) {
  const navigate = useNavigate();

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "good":
        return <CheckCircle className="h-4 w-4 text-green-600" />;
      case "warning":
        return <AlertTriangle className="h-4 w-4 text-orange-500" />;
      case "critical":
        return <XCircle className="h-4 w-4 text-destructive" />;
    }
  };

  const getPrimeCostStatus = (): "good" | "warning" | "critical" => {
    if (primeCost <= primeCostTarget) return "good";
    if (primeCost <= primeCostTarget + 3) return "warning";
    return "critical";
  };

  const metrics: HealthMetric[] = [
    {
      label: "Prime Cost",
      status: getPrimeCostStatus(),
      value: `${primeCost.toFixed(1)}% (Target: ${primeCostTarget}%)`,
      action: { label: "View Details", path: "/reports" },
    },
    {
      label: "Low Inventory Items",
      status: lowInventoryCount > 10 ? "critical" : lowInventoryCount > 5 ? "warning" : "good",
      value: `${lowInventoryCount} items`,
      action: lowInventoryCount > 0 ? { label: "Review", path: "/inventory" } : undefined,
    },
    {
      label: "Unmapped POS Items",
      status: unmappedPOSCount > 20 ? "critical" : unmappedPOSCount > 10 ? "warning" : "good",
      value: `${unmappedPOSCount} items`,
      action: unmappedPOSCount > 0 ? { label: "Map Items", path: "/pos-sales" } : undefined,
    },
    {
      label: "Uncategorized Transactions",
      status:
        uncategorizedTransactions > 50 ? "critical" : uncategorizedTransactions > 20 ? "warning" : "good",
      value: `${uncategorizedTransactions} pending`,
      action:
        uncategorizedTransactions > 0 ? { label: "Categorize", path: "/banking" } : undefined,
    },
  ];

  const overallStatus = metrics.some((m) => m.status === "critical")
    ? "critical"
    : metrics.some((m) => m.status === "warning")
    ? "warning"
    : "good";

  return (
    <Card className="bg-gradient-to-br from-primary/5 via-accent/5 to-transparent border-primary/10">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-xl flex items-center gap-2">
              <TrendingUp className="h-5 w-5 text-primary" />
              Operations Health
            </CardTitle>
            <CardDescription>Key metrics & action items</CardDescription>
          </div>
          <Badge
            variant={
              overallStatus === "good" ? "default" : overallStatus === "warning" ? "secondary" : "destructive"
            }
            className="text-xs"
          >
            {overallStatus === "good" ? "All Good" : overallStatus === "warning" ? "Needs Attention" : "Action Required"}
          </Badge>
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {metrics.map((metric, index) => (
            <div
              key={index}
              className="flex items-center justify-between p-3 rounded-lg bg-background/50 border"
            >
              <div className="flex items-center gap-3 flex-1">
                {getStatusIcon(metric.status)}
                <div>
                  <p className="font-medium text-sm">{metric.label}</p>
                  <p className="text-xs text-muted-foreground">{metric.value}</p>
                </div>
              </div>
              {metric.action && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => navigate(metric.action!.path)}
                  className="text-xs"
                >
                  {metric.action.label} →
                </Button>
              )}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
