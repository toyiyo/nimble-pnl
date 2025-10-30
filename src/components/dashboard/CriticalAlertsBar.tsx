import { AlertTriangle, TrendingDown, Package, DollarSign } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { useNavigate } from "react-router-dom";

interface CriticalAlert {
  id: string;
  type: "cash" | "cost" | "inventory" | "operations";
  severity: "critical" | "warning";
  title: string;
  description: string;
  action?: {
    label: string;
    path: string;
  };
}

interface CriticalAlertsBarProps {
  alerts: CriticalAlert[];
}

export function CriticalAlertsBar({ alerts }: CriticalAlertsBarProps) {
  const navigate = useNavigate();

  if (!alerts.length) return null;

  const getAlertIcon = (type: string) => {
    switch (type) {
      case "cash":
        return DollarSign;
      case "cost":
        return TrendingDown;
      case "inventory":
        return Package;
      default:
        return AlertTriangle;
    }
  };

  return (
    <div className="space-y-2">
      {alerts.map((alert) => {
        const Icon = getAlertIcon(alert.type);
        return (
          <Alert
            key={alert.id}
            variant={alert.severity === "critical" ? "destructive" : "default"}
            className={
              alert.severity === "critical"
                ? "border-destructive/50 bg-destructive/10"
                : "border-orange-500/50 bg-orange-500/10"
            }
          >
            <Icon className="h-4 w-4" aria-hidden="true" />
            <AlertDescription className="flex items-center justify-between gap-4">
              <div className="flex-1">
                <span className="font-semibold">{alert.title}</span>
                <span className="text-muted-foreground ml-2">{alert.description}</span>
              </div>
              {alert.action && (
                <button
                  onClick={() => navigate(alert.action!.path)}
                  className="text-sm font-medium hover:underline whitespace-nowrap"
                  aria-label={alert.action!.label}
                >
                  {alert.action.label} →
                </button>
              )}
            </AlertDescription>
          </Alert>
        );
      })}
    </div>
  );
}
