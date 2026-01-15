import { useMemo } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { usePendingOutflows } from "@/hooks/usePendingOutflows";
import { PendingOutflowCard } from "./PendingOutflowCard";
import { Plus, Wallet, AlertCircle } from "lucide-react";
import { formatCurrency } from "@/utils/pdfExport";
import type { PendingOutflowStatus } from "@/types/pending-outflows";

interface PendingOutflowsListProps {
  onAddClick: () => void;
  statusFilter?: PendingOutflowStatus | 'all';
}

export function PendingOutflowsList({ onAddClick, statusFilter = 'all' }: PendingOutflowsListProps) {
  const { data: pendingOutflows, isLoading, error } = usePendingOutflows();

  const filteredOutflows = useMemo(() => {
    if (!pendingOutflows) return [];
    
    if (statusFilter === 'all') {
      return pendingOutflows;
    }
    
    return pendingOutflows.filter(outflow => outflow.status === statusFilter);
  }, [pendingOutflows, statusFilter]);

  const totalPending = useMemo(() => {
    if (!pendingOutflows) return 0;
    
    return pendingOutflows
      .filter(outflow => ['pending', 'stale_30', 'stale_60', 'stale_90'].includes(outflow.status))
      .reduce((sum, outflow) => sum + outflow.amount, 0);
  }, [pendingOutflows]);

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-4 w-64" />
        </CardHeader>
        <CardContent className="space-y-3">
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card className="border-destructive">
        <CardContent className="py-8 text-center">
          <AlertCircle className="h-12 w-12 mx-auto text-destructive mb-4" />
          <h3 className="text-lg font-semibold mb-2">Failed to load expenses</h3>
          <p className="text-muted-foreground">{error instanceof Error ? error.message : 'Unknown error'}</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="bg-gradient-to-br from-primary/5 via-accent/5 to-transparent border-primary/10">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Wallet className="h-6 w-6 text-primary" />
            <div>
              <CardTitle className="text-2xl bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
                Uncommitted Expenses
              </CardTitle>
              <CardDescription>
                Checks and payments issued but not yet cleared in the bank
              </CardDescription>
            </div>
          </div>
          <div className="flex flex-col items-end gap-1">
            <Button onClick={onAddClick} size="sm">
              <Plus className="h-4 w-4 mr-2" />
              Add expense
            </Button>
            <span className="text-xs text-muted-foreground">Upload invoice</span>
          </div>
        </div>
        
        {totalPending > 0 && (
          <div className="flex items-center gap-2 pt-2">
            <span className="text-sm text-muted-foreground">Total Uncommitted:</span>
            <Badge className="bg-gradient-to-r from-orange-500 to-red-600 text-lg px-3 py-1">
              {formatCurrency(totalPending)}
            </Badge>
          </div>
        )}
      </CardHeader>

      <CardContent>
        {!filteredOutflows || filteredOutflows.length === 0 ? (
          <Card className="bg-gradient-to-br from-muted/50 to-transparent">
            <CardContent className="py-12 text-center">
              <Wallet className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
              <h3 className="text-lg font-semibold mb-2">No uncommitted expenses</h3>
              <p className="text-muted-foreground mb-4">
                {statusFilter === 'all' 
                  ? 'No uncommitted expenses recorded yet. Add one to track checks or ACH payments that haven\'t cleared.'
                  : `No ${statusFilter} expenses found.`}
              </p>
              <Button onClick={onAddClick}>
                <Plus className="h-4 w-4 mr-2" />
                Add expense
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {filteredOutflows.map((outflow) => (
              <PendingOutflowCard key={outflow.id} outflow={outflow} />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
