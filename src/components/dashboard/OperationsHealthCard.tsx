import { useNavigate } from "react-router-dom";
import { CheckCircle, AlertTriangle } from "lucide-react";

interface ChecklistItem {
  text: string;
  status: "good" | "warning";
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

  const getPrimeCostStatus = (): "good" | "warning" => {
    return primeCost <= primeCostTarget ? "good" : "warning";
  };

  const items: ChecklistItem[] = [
    {
      text: `Prime Cost ${primeCost <= primeCostTarget ? 'within target' : 'above target'} (${primeCost.toFixed(1)}%)`,
      status: getPrimeCostStatus(),
      action: { label: "View Details", path: "/reports" },
    },
    {
      text: unmappedPOSCount > 0 ? `${unmappedPOSCount} POS items need mapping` : "All POS items mapped",
      status: unmappedPOSCount > 0 ? "warning" : "good",
      action: unmappedPOSCount > 0 ? { label: "Map Items", path: "/pos-sales" } : undefined,
    },
    {
      text: uncategorizedTransactions > 0 ? `${uncategorizedTransactions} uncategorized transactions` : "All transactions categorized",
      status: uncategorizedTransactions > 0 ? "warning" : "good",
      action: uncategorizedTransactions > 0 ? { label: "Categorize", path: "/banking" } : undefined,
    },
    {
      text: lowInventoryCount > 0 ? `${lowInventoryCount} items low on inventory` : "Inventory looks good",
      status: lowInventoryCount > 0 ? "warning" : "good",
      action: lowInventoryCount > 0 ? { label: "Review", path: "/inventory" } : undefined,
    },
  ];

  const hasWarnings = items.some(item => item.status === "warning");

  return (
    <div className="rounded-xl border border-border/40 bg-background overflow-hidden">
      <div className="px-5 py-3 border-b border-border/40">
        <h3 className="text-[14px] font-medium text-foreground">Restaurant Health</h3>
        <p className="text-[12px] text-muted-foreground mt-0.5">Keep these accurate for reliable reports</p>
      </div>
      <div className="divide-y divide-border/40">
        {items.map((item, index) => (
          <div
            key={index}
            className="flex items-center justify-between px-5 py-3"
          >
            <div className="flex items-center gap-3 flex-1 min-w-0">
              {item.status === "good" ? (
                <CheckCircle className="h-4 w-4 text-green-600 shrink-0" />
              ) : (
                <AlertTriangle className="h-4 w-4 text-orange-500 shrink-0" />
              )}
              <p className="text-[14px] text-foreground truncate">{item.text}</p>
            </div>
            {item.action && (
              <button
                onClick={() => navigate(item.action!.path)}
                className="text-[13px] font-medium text-foreground hover:text-foreground/70 transition-colors shrink-0 ml-3"
              >
                {item.action.label} →
              </button>
            )}
          </div>
        ))}
      </div>
      {hasWarnings && (
        <div className="px-5 py-2.5 border-t border-border/40 bg-muted/50">
          <p className="text-[12px] text-muted-foreground">
            Fix these to keep costs and reports accurate
          </p>
        </div>
      )}
    </div>
  );
}
