import { AlertTriangle, TrendingDown, Package, DollarSign } from "lucide-react";
import { useNavigate } from "react-router-dom";

import type { CriticalAlert } from "@/types/dashboard";

interface DashboardAttentionListProps {
  alerts: CriticalAlert[];
}

function getAlertIcon(type: CriticalAlert["type"]) {
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
}

export function DashboardAttentionList({ alerts }: DashboardAttentionListProps) {
  const navigate = useNavigate();

  return (
    <div className="rounded-xl border border-border/40 bg-background">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-border/40">
        <h3 className="text-[13px] font-semibold text-foreground">Attention</h3>
        <span className="text-[11px] px-1.5 py-0.5 rounded-md bg-muted text-muted-foreground">
          {alerts.length}
        </span>
      </div>
      {alerts.length === 0 ? (
        <div className="px-4 py-6 text-[13px] text-muted-foreground text-center">
          Nothing needs your attention.
        </div>
      ) : (
        <ul className="divide-y divide-border/40">
          {alerts.map((alert) => {
            const Icon = getAlertIcon(alert.type);
            const isCritical = alert.severity === "critical";
            return (
              <li key={alert.id} className="flex items-center gap-3 px-4 py-3">
                <Icon
                  className={`h-4 w-4 shrink-0 ${isCritical ? "text-destructive" : "text-orange-500"}`}
                  aria-hidden="true"
                />
                <div className="flex-1 min-w-0">
                  <span className="text-[14px] font-medium text-foreground">{alert.title}</span>
                  <span className="text-[13px] text-muted-foreground ml-2">{alert.description}</span>
                </div>
                {alert.action && (
                  <button
                    onClick={() => navigate(alert.action!.path)}
                    className="text-[13px] font-medium text-foreground hover:text-foreground/70 transition-colors whitespace-nowrap shrink-0"
                    aria-label={alert.action.label}
                  >
                    {alert.action.label} →
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
