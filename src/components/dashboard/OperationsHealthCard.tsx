import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useNavigate } from "react-router-dom";

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
    <Card className="bg-gradient-to-br from-primary/5 via-accent/5 to-transparent border-primary/10">
      <CardHeader>
        <CardTitle className="text-xl flex items-center gap-2">
          ⚙️ Restaurant Health
        </CardTitle>
        <CardDescription>Keep these accurate for reliable reports</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {items.map((item, index) => (
            <div
              key={index}
              className="flex items-center justify-between p-3 rounded-lg bg-background/50 border"
            >
              <div className="flex items-center gap-3 flex-1">
                <span className="text-lg">
                  {item.status === "good" ? "✅" : "⚠️"}
                </span>
                <p className="text-sm">{item.text}</p>
              </div>
              {item.action && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => navigate(item.action!.path)}
                  className="text-xs shrink-0"
                >
                  {item.action.label} →
                </Button>
              )}
            </div>
          ))}
        </div>
        {hasWarnings && (
          <div className="mt-4 pt-4 border-t border-border/50">
            <p className="text-xs text-muted-foreground flex items-center gap-2">
              🧩 Fix these to keep costs and reports accurate
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
