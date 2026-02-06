import { AlertTriangle, TrendingDown, Package, DollarSign } from "lucide-react";
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
        const isCritical = alert.severity === "critical";
        return (
          <div
            key={alert.id}
            className={`flex items-center gap-3 px-4 py-3 rounded-xl border transition-colors ${
              isCritical
                ? "border-destructive/30 bg-destructive/5"
                : "border-orange-500/30 bg-orange-500/5"
            }`}
          >
            <Icon className={`h-4 w-4 shrink-0 ${isCritical ? 'text-destructive' : 'text-orange-500'}`} aria-hidden="true" />
            <div className="flex-1 min-w-0">
              <span className="text-[14px] font-medium text-foreground">{alert.title}</span>
              <span className="text-[13px] text-muted-foreground ml-2">{alert.description}</span>
            </div>
            {alert.action && (
              <button
                onClick={() => navigate(alert.action!.path)}
                className="text-[13px] font-medium text-foreground hover:text-foreground/70 transition-colors whitespace-nowrap shrink-0"
                aria-label={alert.action!.label}
              >
                {alert.action.label} →
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
