import { useState } from "react";
import { BankTransaction, useCategorizeTransaction, useExcludeTransaction } from "@/hooks/useBankTransactions";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Check, Edit, XCircle, FileText, Split, CheckCircle2, Sparkles } from "lucide-react";
import { TransactionDetailSheet } from "./TransactionDetailSheet";
import { SplitTransactionDialog } from "./SplitTransactionDialog";
import { BankAccountInfo } from "./BankAccountInfo";
import { TransactionBadges } from "./TransactionBadges";
import { ChartAccount } from "@/hooks/useChartOfAccounts";
import { useRestaurantContext } from "@/contexts/RestaurantContext";
import { useReconcileTransaction, useUnreconcileTransaction } from "@/hooks/useBankReconciliation";
import { useDateFormat } from "@/hooks/useDateFormat";

interface BankTransactionCardProps {
  transaction: BankTransaction;
  status: 'for_review' | 'categorized' | 'excluded';
  accounts: ChartAccount[];
}

export function BankTransactionCard({ transaction, status, accounts }: BankTransactionCardProps) {
  const [isDetailOpen, setIsDetailOpen] = useState(false);
  const [isSplitOpen, setIsSplitOpen] = useState(false);
  const { selectedRestaurant } = useRestaurantContext();
  const categorize = useCategorizeTransaction();
  const exclude = useExcludeTransaction();
  const reconcile = useReconcileTransaction();
  const unreconcile = useUnreconcileTransaction();
  const { formatTransactionDate } = useDateFormat();

  const isNegative = transaction.amount < 0;
  const formattedAmount = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(Math.abs(transaction.amount));

  const suggestedCategory = accounts?.find(a => a.id === transaction.suggested_category_id);
  const currentCategory = accounts?.find(a => a.id === transaction.category_id);
  const hasSuggestion = !transaction.is_categorized && suggestedCategory;

  const handleQuickAccept = () => {
    if (transaction.suggested_category_id) {
      categorize.mutate({
        transactionId: transaction.id,
        categoryId: transaction.suggested_category_id,
      });
    }
  };

  const handleExclude = () => {
    exclude.mutate({
      transactionId: transaction.id,
      reason: 'Excluded by user',
    });
  };

  return (
    <>
      <Card className={`${hasSuggestion ? 'border-amber-500 dark:border-amber-600 border-2 bg-amber-50/50 dark:bg-amber-950/20' : ''}`}>
        <CardContent className="p-4">
          {/* Header with date and amount */}
          <div className="flex justify-between items-start mb-3">
            <div className="flex-1">
              <div className="text-sm text-muted-foreground mb-1">
                {formatTransactionDate(transaction.transaction_date, 'MMM dd, yyyy')}
              </div>
              <div className="font-semibold text-base">
                {transaction.description}
              </div>
            </div>
            <div className="text-right ml-4">
              <div className={`text-lg font-bold ${isNegative ? "text-destructive" : "text-success"}`}>
                {isNegative ? '-' : '+'}{formattedAmount}
              </div>
            </div>
          </div>

          {/* Payee and Bank Info */}
          <div className="space-y-2 mb-3">
            <div className="flex items-center gap-2 text-sm">
              <span className="text-muted-foreground">Payee:</span>
              <span className="font-medium">{transaction.normalized_payee || transaction.merchant_name || '—'}</span>
            </div>
            
            <div className="flex items-center gap-2 text-sm">
              <span className="text-muted-foreground">Bank:</span>
              <BankAccountInfo
                institutionName={transaction.connected_bank?.institution_name}
                accountMask={transaction.connected_bank?.bank_account_balances?.[0]?.account_mask}
                showIcon={false}
              />
            </div>
          </div>

          {/* Transaction Badges */}
          <TransactionBadges
            isTransfer={transaction.is_transfer}
            isSplit={transaction.is_split}
            supplierName={transaction.supplier?.name}
            className="mb-3"
          />

          {/* AI Suggestion Section - Prominent */}
          {hasSuggestion && (
            <div className="bg-amber-100 dark:bg-amber-950/50 border-2 border-amber-500 dark:border-amber-600 rounded-lg p-3 mb-3">
              <div className="flex items-start gap-2 mb-2">
                <Sparkles className="h-5 w-5 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
                <div className="flex-1">
                  <div className="font-semibold text-amber-900 dark:text-amber-100 text-sm mb-1">
                    AI Suggestion - Needs Review
                  </div>
                  <div className="text-sm text-amber-800 dark:text-amber-200">
                    Suggested category: <span className="font-semibold">{suggestedCategory.account_name}</span>
                  </div>
                </div>
              </div>
              <Button
                onClick={handleQuickAccept}
                disabled={categorize.isPending}
                size="sm"
                className="w-full bg-amber-600 hover:bg-amber-700 text-white"
              >
                <Check className="h-4 w-4 mr-2" />
                Accept AI Suggestion
              </Button>
            </div>
          )}

          {/* Current Category Display */}
          {status === 'for_review' && transaction.is_categorized && currentCategory && (
            <div className="mb-3">
              <div className="text-xs text-muted-foreground mb-1">Category</div>
              <Badge variant="secondary">{currentCategory.account_name}</Badge>
            </div>
          )}

          {status === 'categorized' && (
            <div className="mb-3">
              <div className="text-xs text-muted-foreground mb-1">Category</div>
              {transaction.is_split ? (
                <Badge variant="secondary" className="bg-blue-100 dark:bg-blue-950 text-blue-800 dark:text-blue-200">
                  <Split className="h-3 w-3 mr-1" />
                  Split across categories
                </Badge>
              ) : currentCategory ? (
                <Badge variant="secondary">{currentCategory.account_name}</Badge>
              ) : (
                <span className="text-muted-foreground text-sm">—</span>
              )}
            </div>
          )}

          {status === 'excluded' && (
            <div className="mb-3">
              <div className="text-xs text-muted-foreground mb-1">Reason</div>
              <span className="text-sm">{transaction.excluded_reason || 'Excluded'}</span>
            </div>
          )}

          {/* Action Buttons */}
          <div className="flex flex-wrap gap-2">
            {status === 'for_review' && (
              <>
                {!hasSuggestion && (
                  <Button
                    onClick={() => setIsDetailOpen(true)}
                    size="sm"
                    variant="outline"
                    className="flex-1"
                  >
                    <Edit className="h-4 w-4 mr-2" />
                    Edit
                  </Button>
                )}
                {hasSuggestion && (
                  <Button
                    onClick={() => setIsDetailOpen(true)}
                    size="sm"
                    variant="outline"
                    className="flex-1"
                  >
                    <Edit className="h-4 w-4 mr-2" />
                    Edit Category
                  </Button>
                )}
                <Button
                  onClick={() => setIsSplitOpen(true)}
                  size="sm"
                  variant="outline"
                  className="flex-1"
                >
                  <Split className="h-4 w-4 mr-2" />
                  Split
                </Button>
                <Button
                  onClick={handleExclude}
                  disabled={exclude.isPending}
                  size="sm"
                  variant="outline"
                  className="flex-1 text-destructive hover:bg-destructive/10"
                >
                  <XCircle className="h-4 w-4 mr-2" />
                  Exclude
                </Button>
              </>
            )}
            {status === 'categorized' && (
              <>
                <Button
                  onClick={() => setIsDetailOpen(true)}
                  size="sm"
                  variant="outline"
                  className="flex-1"
                >
                  <FileText className="h-4 w-4 mr-2" />
                  View Details
                </Button>
                {transaction.is_reconciled ? (
                  <Button
                    onClick={() => unreconcile.mutate({ transactionId: transaction.id })}
                    disabled={unreconcile.isPending}
                    size="sm"
                    variant="outline"
                    className="flex-1"
                  >
                    <CheckCircle2 className="h-4 w-4 mr-2" />
                    Unreconcile
                  </Button>
                ) : (
                  <Button
                    onClick={() => reconcile.mutate({ transactionId: transaction.id })}
                    disabled={reconcile.isPending}
                    size="sm"
                    variant="outline"
                    className="flex-1"
                  >
                    <CheckCircle2 className="h-4 w-4 mr-2" />
                    Reconcile
                  </Button>
                )}
              </>
            )}
            {status === 'excluded' && (
              <Button
                onClick={() => setIsDetailOpen(true)}
                size="sm"
                variant="outline"
                className="w-full"
              >
                <FileText className="h-4 w-4 mr-2" />
                View Details
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      <TransactionDetailSheet
        transaction={transaction}
        isOpen={isDetailOpen}
        onClose={() => setIsDetailOpen(false)}
      />

      <SplitTransactionDialog
        transaction={transaction}
        isOpen={isSplitOpen}
        onClose={() => setIsSplitOpen(false)}
      />
    </>
  );
}
