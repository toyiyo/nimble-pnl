import { useEffect, useState } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { Clock } from "lucide-react";
import { format } from "date-fns";

interface DashboardMetric {
  label: string;
  value: string;
  subValue?: string;
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

const formatCurrency = (amount: number): string => {
  return amount.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
};

export const POSSalesDashboard = ({
  totalRevenue,
  discounts,
  passThroughAmount,
  collectedAtPOS,
  uniqueItems,
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
      label: "Collected",
      value: `$${formatCurrency(collectedAtPOS)}`,
    },
    {
      label: "Revenue",
      value: `$${formatCurrency(totalRevenue)}`,
    },
    {
      label: "Discounts",
      value: `$${formatCurrency(discounts)}`,
    },
    {
      label: "Pass-Through",
      value: `$${formatCurrency(passThroughAmount)}`,
    },
    {
      label: "Items",
      value: uniqueItems.toLocaleString(),
    },
  ];

  return (
    <div className="space-y-3">
      {/* Apple/Notion-style metrics row */}
      <div className="flex items-center gap-1">
        {/* Filtered context indicator */}
        {showFilteredContext && (
          <button
            type="button"
            aria-pressed={cuePinned}
            onClick={onToggleCuePin}
            className={`mr-2 px-2.5 py-1 text-[11px] font-medium rounded-md transition-colors ${
              cuePinned
                ? "bg-foreground/10 text-foreground"
                : "bg-muted text-muted-foreground hover:text-foreground"
            }`}
          >
            Filtered
          </button>
        )}

        {/* Metrics - clean inline style */}
        <div className="flex items-center gap-6 overflow-x-auto pb-1">
          {isLoading
            ? Array.from({ length: 5 }).map((_, index) => (
                <div key={`skeleton-metric-${index}`} className="flex items-baseline gap-2">
                  <Skeleton className="h-4 w-16" />
                  <Skeleton className="h-6 w-20" />
                </div>
              ))
            : metrics.map((metric) => (
                <div
                  key={metric.label}
                  className="flex items-baseline gap-2 shrink-0"
                >
                  <span className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider">
                    {metric.label}
                  </span>
                  <span
                    className={`text-[15px] font-semibold text-foreground tabular-nums transition-all ${
                      valueWashActive ? "text-primary" : ""
                    }`}
                  >
                    {metric.value}
                  </span>
                </div>
              ))}
        </div>

        {/* Sync time */}
        {lastSyncTime && (
          <div className="ml-auto flex items-center gap-1.5 text-[11px] text-muted-foreground shrink-0">
            <Clock className="h-3 w-3" />
            <span>Synced {format(new Date(lastSyncTime), "MMM d, h:mm a")}</span>
          </div>
        )}
      </div>

      {/* Context description when pinned */}
      {cuePinned && contextDescription && (
        <p className="text-[11px] text-muted-foreground">{contextDescription}</p>
      )}
    </div>
  );
};
