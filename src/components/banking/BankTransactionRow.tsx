import { useState } from "react";
import { BankTransaction, useCategorizeTransaction, useExcludeTransaction } from "@/hooks/useBankTransactions";
import { TableCell, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Check, Edit, XCircle, ArrowLeftRight, FileText, Split, CheckCircle2, Building2 } from "lucide-react";
import { TransactionDetailSheet } from "./TransactionDetailSheet";
import { SplitTransactionDialog } from "./SplitTransactionDialog";
import { ChartAccount } from "@/hooks/useChartOfAccounts";
import { useRestaurantContext } from "@/contexts/RestaurantContext";
import { useReconcileTransaction, useUnreconcileTransaction } from "@/hooks/useBankReconciliation";
import { useDateFormat } from "@/hooks/useDateFormat";

interface BankTransactionRowProps {
  transaction: BankTransaction;
  status: 'for_review' | 'categorized' | 'excluded';
  accounts: ChartAccount[];
}

export function BankTransactionRow({ transaction, status, accounts }: BankTransactionRowProps) {
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
      <TableRow className="hover:bg-muted/50">
        <TableCell className="font-medium">
          {formatTransactionDate(transaction.transaction_date, 'MMM dd, yyyy')}
        </TableCell>
        
        <TableCell>
          <div className="flex flex-col">
            <span className="font-medium">{transaction.description}</span>
            <div className="flex gap-2 mt-1">
              {transaction.is_transfer && (
                <Badge variant="secondary" className="w-fit">
                  <ArrowLeftRight className="h-3 w-3 mr-1" />
                  Transfer
                </Badge>
              )}
              {transaction.is_split && (
                <Badge variant="secondary" className="w-fit bg-blue-100 dark:bg-blue-950 text-blue-800 dark:text-blue-200">
                  <Split className="h-3 w-3 mr-1" />
                  Split
                </Badge>
              )}
            </div>
          </div>
        </TableCell>

        <TableCell className="hidden md:table-cell">
          <div className="flex flex-col gap-1">
            <span>{transaction.normalized_payee || transaction.merchant_name || '—'}</span>
            {transaction.supplier && (
              <Badge variant="secondary" className="w-fit bg-primary/10 text-primary">
                <Building2 className="h-3 w-3 mr-1" />
                {transaction.supplier.name}
              </Badge>
            )}
          </div>
        </TableCell>

        <TableCell className="text-right">
          <div className="flex items-center justify-end gap-2">
            <span className={isNegative ? "text-destructive" : "text-success"}>
              {isNegative ? '-' : '+'}{formattedAmount}
            </span>
            {transaction.is_reconciled && (
              <CheckCircle2 className="h-4 w-4 text-success" />
            )}
          </div>
        </TableCell>

        {status === 'for_review' && (
          <TableCell className="hidden lg:table-cell">
            {suggestedCategory ? (
              <div className="flex items-center gap-2">
                <Badge variant="outline">{suggestedCategory.account_name}</Badge>
                {transaction.match_confidence && transaction.match_confidence > 0.8 && (
                  <Badge variant="secondary" className="text-xs">
                    {Math.round(transaction.match_confidence * 100)}%
                  </Badge>
                )}
              </div>
            ) : (
              <span className="text-muted-foreground text-sm">No suggestion</span>
            )}
          </TableCell>
        )}

        {status === 'categorized' && (
          <TableCell className="hidden lg:table-cell">
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
          </TableCell>
        )}

        {status === 'excluded' && (
          <TableCell className="hidden lg:table-cell">
            <span className="text-sm text-muted-foreground">
              {transaction.excluded_reason || 'Excluded'}
            </span>
          </TableCell>
        )}

        <TableCell className="text-right">
          <div className="flex items-center justify-end gap-1 flex-wrap">
            {status === 'for_review' && (
              <>
                {transaction.suggested_category_id && (
                  <Button
                    size="sm"
                    variant="default"
                    onClick={handleQuickAccept}
                    disabled={categorize.isPending}
                    className="whitespace-nowrap"
                  >
                    <Check className="h-4 w-4 md:mr-1" />
                    <span className="hidden md:inline">Accept</span>
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setIsSplitOpen(true)}
                  title="Split transaction"
                  className="whitespace-nowrap"
                >
                  <Split className="h-4 w-4 md:mr-1" />
                  <span className="hidden md:inline">Split</span>
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setIsDetailOpen(true)}
                  className="whitespace-nowrap"
                >
                  <Edit className="h-4 w-4 md:mr-1" />
                  <span className="hidden md:inline">Edit</span>
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleExclude}
                  disabled={exclude.isPending}
                  className="whitespace-nowrap text-destructive hover:text-destructive"
                >
                  <XCircle className="h-4 w-4 md:mr-1" />
                  <span className="hidden md:inline">Exclude</span>
                </Button>
              </>
            )}
            {status === 'categorized' && (
              <>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setIsDetailOpen(true)}
                  className="whitespace-nowrap"
                >
                  <FileText className="h-4 w-4 md:mr-1" />
                  <span className="hidden md:inline">View</span>
                </Button>
                {transaction.is_reconciled ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => unreconcile.mutate({ transactionId: transaction.id })}
                    disabled={unreconcile.isPending}
                    title="Unreconcile"
                  >
                    <CheckCircle2 className="h-4 w-4 text-success" />
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => reconcile.mutate({ transactionId: transaction.id })}
                    disabled={reconcile.isPending}
                    title="Mark as reconciled"
                  >
                    <CheckCircle2 className="h-4 w-4" />
                  </Button>
                )}
              </>
            )}
          </div>
        </TableCell>
      </TableRow>

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
