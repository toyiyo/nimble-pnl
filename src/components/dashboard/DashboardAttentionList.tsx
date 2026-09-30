import { useNavigate } from "react-router-dom";

import { Skeleton } from "@/components/ui/skeleton";

import { AlertTriangle, TrendingDown, Package, DollarSign } from "lucide-react";

import type { CriticalAlert } from "@/types/dashboard";

interface DashboardAttentionListProps {
  alerts: CriticalAlert[];
  isLoading?: boolean;
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

export function DashboardAttentionList({ alerts, isLoading = false }: Readonly<DashboardAttentionListProps>) {
  const navigate = useNavigate();

  return (
    <div className="rounded-xl border border-border/40 bg-background">
      {isLoading && (
        <div data-testid="attention-skeleton" className="p-4 space-y-2">
          <Skeleton className="h-5 w-full" />
          <Skeleton className="h-5 w-2/3" />
        </div>
      )}
      {!isLoading && alerts.length === 0 && (
        <div className="px-4 py-6 text-[13px] text-muted-foreground text-center">
          Nothing needs your attention.
        </div>
      )}
      {!isLoading && alerts.length > 0 && (
        <ul className="divide-y divide-border/40">
          {alerts.map((alert) => {
            const Icon = getAlertIcon(alert.type);
            const isCritical = alert.severity === "critical";
            return (
              <li key={alert.id} className="flex items-center gap-3 px-4 py-3">
                <Icon
                  className={`h-4 w-4 shrink-0 ${isCritical ? "text-destructive" : "text-muted-foreground"}`}
                  aria-hidden="true"
                />
                <div className="flex-1 min-w-0">
                  <span className="text-[14px] font-medium text-foreground">{alert.title}</span>
                  <span className="text-[13px] text-muted-foreground ml-2">{alert.description}</span>
                </div>
                {alert.action && (
                  <button
                    onClick={() => navigate(alert.action!.path)}
                    className="inline-flex min-h-6 items-center text-[13px] font-medium text-foreground hover:text-foreground/70 transition-colors whitespace-nowrap shrink-0 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
