import { Card } from "@/components/ui/card";
import { useReconciliationBoundary } from "@/hooks/useBankReconciliation";
import { useBankTransactions } from "@/hooks/useBankTransactions";
import { format } from "date-fns";
import { CheckCircle2, XCircle, AlertCircle, TrendingUp } from "lucide-react";
import { Badge } from "@/components/ui/badge";

export function ReconciliationReport() {
  const { data: boundary } = useReconciliationBoundary();
  const { transactions: allTransactions = [] } = useBankTransactions(undefined, { autoLoadAll: true });

  if (!boundary) {
    return (
      <Card className="p-6">
        <div className="text-center text-muted-foreground">
          <AlertCircle className="h-12 w-12 mx-auto mb-4 opacity-50" />
          <p className="text-lg font-medium">No Reconciliation Boundary Set</p>
          <p className="text-sm mt-2">Set a starting date and opening balance to begin reconciliation</p>
        </div>
      </Card>
    );
  }

  const reconciledTransactions = allTransactions?.filter(t => t.is_reconciled) || [];
  const unreconciledTransactions = allTransactions?.filter(t => !t.is_reconciled && t.is_categorized) || [];
  
  const reconciledTotal = reconciledTransactions.reduce((sum, t) => sum + Number(t.amount), 0);
  const unreconciledTotal = unreconciledTransactions.reduce((sum, t) => sum + Number(t.amount), 0);
  
  const currentBalance = boundary.opening_balance + reconciledTotal;
  const projectedBalance = currentBalance + unreconciledTotal;

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card className="p-4">
          <div className="flex items-center gap-2 mb-2">
            <CheckCircle2 className="h-4 w-4 text-green-600" />
            <span className="text-sm font-medium">Opening Balance</span>
          </div>
          <p className="text-2xl font-bold">${boundary.opening_balance.toFixed(2)}</p>
          <p className="text-xs text-muted-foreground mt-1">
            {format(new Date(boundary.balance_start_date), 'MMM dd, yyyy')}
          </p>
        </Card>

        <Card className="p-4">
          <div className="flex items-center gap-2 mb-2">
            <CheckCircle2 className="h-4 w-4 text-blue-600" />
            <span className="text-sm font-medium">Reconciled</span>
          </div>
          <p className="text-2xl font-bold">${currentBalance.toFixed(2)}</p>
          <p className="text-xs text-muted-foreground mt-1">
            {reconciledTransactions.length} transactions
          </p>
        </Card>

        <Card className="p-4">
          <div className="flex items-center gap-2 mb-2">
            <XCircle className="h-4 w-4 text-orange-600" />
            <span className="text-sm font-medium">Unreconciled</span>
          </div>
          <p className="text-2xl font-bold">${unreconciledTotal.toFixed(2)}</p>
          <p className="text-xs text-muted-foreground mt-1">
            {unreconciledTransactions.length} pending
          </p>
        </Card>

        <Card className="p-4">
          <div className="flex items-center gap-2 mb-2">
            <TrendingUp className="h-4 w-4 text-purple-600" />
            <span className="text-sm font-medium">Projected Balance</span>
          </div>
          <p className="text-2xl font-bold">${projectedBalance.toFixed(2)}</p>
          <p className="text-xs text-muted-foreground mt-1">
            Including pending
          </p>
        </Card>
      </div>

      {/* Running Balance Table */}
      <Card className="p-6">
        <h3 className="text-lg font-semibold mb-4">Reconciliation Details</h3>
        <div className="space-y-2">
          <div className="flex items-center justify-between py-2 border-b">
            <span className="text-sm font-medium">Starting Balance</span>
            <span className="text-sm font-mono">${boundary.opening_balance.toFixed(2)}</span>
          </div>
          
          {reconciledTransactions.length > 0 ? (
            <>
              <div className="flex items-center justify-between py-2">
                <span className="text-sm text-muted-foreground">
                  + Reconciled Transactions ({reconciledTransactions.length})
                </span>
                <span className="text-sm font-mono text-muted-foreground">
                  {reconciledTotal >= 0 ? '+' : ''}{reconciledTotal.toFixed(2)}
                </span>
              </div>
              <div className="flex items-center justify-between py-2 border-t font-semibold">
                <span className="text-sm">Current Reconciled Balance</span>
                <span className="text-sm font-mono">${currentBalance.toFixed(2)}</span>
              </div>
            </>
          ) : (
            <div className="py-4 text-center text-sm text-muted-foreground">
              No reconciled transactions yet
            </div>
          )}

          {unreconciledTransactions.length > 0 && (
            <>
              <div className="flex items-center justify-between py-2 mt-4">
                <span className="text-sm text-muted-foreground">
                  Pending Transactions ({unreconciledTransactions.length})
                </span>
                <span className="text-sm font-mono text-muted-foreground">
                  {unreconciledTotal >= 0 ? '+' : ''}{unreconciledTotal.toFixed(2)}
                </span>
              </div>
              <div className="flex items-center justify-between py-2 border-t">
                <span className="text-sm">Projected Balance (if all reconciled)</span>
                <span className="text-sm font-mono">${projectedBalance.toFixed(2)}</span>
              </div>
            </>
          )}
        </div>
      </Card>

      {/* Status Breakdown */}
      <Card className="p-6">
        <h3 className="text-lg font-semibold mb-4">Transaction Status</h3>
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Badge variant="default" className="bg-green-600">Reconciled</Badge>
              <span className="text-sm text-muted-foreground">
                Matched with bank statement
              </span>
            </div>
            <span className="font-mono text-sm">{reconciledTransactions.length}</span>
          </div>
          
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Badge variant="secondary">Unreconciled</Badge>
              <span className="text-sm text-muted-foreground">
                Awaiting reconciliation
              </span>
            </div>
            <span className="font-mono text-sm">{unreconciledTransactions.length}</span>
          </div>
          
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Badge variant="outline">Total</Badge>
              <span className="text-sm text-muted-foreground">
                All categorized transactions
              </span>
            </div>
            <span className="font-mono text-sm">{allTransactions?.filter(t => t.is_categorized).length || 0}</span>
          </div>
        </div>
      </Card>
    </div>
  );
}
