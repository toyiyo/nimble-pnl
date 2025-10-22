import { useState } from "react";
import { BankTransaction, useCategorizeTransaction, useExcludeTransaction } from "@/hooks/useBankTransactions";
import { TableCell, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Check, Edit, XCircle, FileText, Split, CheckCircle2, MoreVertical, Sparkles } from "lucide-react";
import { TransactionDetailSheet } from "./TransactionDetailSheet";
import { SplitTransactionDialog } from "./SplitTransactionDialog";
import { BankAccountInfo } from "./BankAccountInfo";
import { TransactionBadges } from "./TransactionBadges";
import { ChartAccount } from "@/hooks/useChartOfAccounts";
import { useRestaurantContext } from "@/contexts/RestaurantContext";
import { useReconcileTransaction, useUnreconcileTransaction } from "@/hooks/useBankReconciliation";
import { useDateFormat } from "@/hooks/useDateFormat";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

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
      <TableRow className={`hover:bg-muted/50 ${hasSuggestion ? 'bg-amber-50/50 dark:bg-amber-950/20 border-l-4 border-l-amber-500' : ''}`}>
        <TableCell className="font-medium">
          {formatTransactionDate(transaction.transaction_date, 'MMM dd, yyyy')}
        </TableCell>
        
        <TableCell>
          <div className="flex flex-col">
            <span className="font-medium">{transaction.description}</span>
            <TransactionBadges
              isTransfer={transaction.is_transfer}
              isSplit={transaction.is_split}
              className="mt-1"
            />
          </div>
        </TableCell>

        <TableCell className="hidden md:table-cell">
          <div className="flex flex-col gap-1">
            <span>{transaction.normalized_payee || transaction.merchant_name || '—'}</span>
            {transaction.supplier && (
              <TransactionBadges supplierName={transaction.supplier.name} />
            )}
          </div>
        </TableCell>

        <TableCell className="hidden lg:table-cell">
          <BankAccountInfo
            institutionName={transaction.connected_bank?.institution_name}
            accountMask={transaction.connected_bank?.bank_account_balances?.[0]?.account_mask}
            showIcon={false}
            layout="stacked"
          />
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
            {transaction.is_categorized && currentCategory ? (
              <Badge variant="secondary">{currentCategory.account_name}</Badge>
            ) : suggestedCategory ? (
              <div className="flex items-center gap-2">
                <Badge className="bg-amber-100 dark:bg-amber-950 text-amber-900 dark:text-amber-100 border-amber-500">
                  <Sparkles className="h-3 w-3 mr-1" />
                  {suggestedCategory.account_name}
                </Badge>
              </div>
            ) : (
              <span className="text-muted-foreground text-sm">Uncategorized</span>
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
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="ghost" className="h-8 w-8 p-0">
                <MoreVertical className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48 bg-background z-50">
              {status === 'for_review' && (
                <>
                  {transaction.suggested_category_id && (
                    <DropdownMenuItem
                      onClick={handleQuickAccept}
                      disabled={categorize.isPending}
                    >
                      <Check className="h-4 w-4 mr-2" />
                      Accept Suggestion
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuItem onClick={() => setIsDetailOpen(true)}>
                    <Edit className="h-4 w-4 mr-2" />
                    Edit
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setIsSplitOpen(true)}>
                    <Split className="h-4 w-4 mr-2" />
                    Split Transaction
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={handleExclude}
                    disabled={exclude.isPending}
                    className="text-destructive focus:text-destructive"
                  >
                    <XCircle className="h-4 w-4 mr-2" />
                    Exclude
                  </DropdownMenuItem>
                </>
              )}
              {status === 'categorized' && (
                <>
                  <DropdownMenuItem onClick={() => setIsDetailOpen(true)}>
                    <FileText className="h-4 w-4 mr-2" />
                    View Details
                  </DropdownMenuItem>
                  {transaction.is_reconciled ? (
                    <DropdownMenuItem
                      onClick={() => unreconcile.mutate({ transactionId: transaction.id })}
                      disabled={unreconcile.isPending}
                    >
                      <CheckCircle2 className="h-4 w-4 mr-2 text-success" />
                      Unreconcile
                    </DropdownMenuItem>
                  ) : (
                    <DropdownMenuItem
                      onClick={() => reconcile.mutate({ transactionId: transaction.id })}
                      disabled={reconcile.isPending}
                    >
                      <CheckCircle2 className="h-4 w-4 mr-2" />
                      Mark as Reconciled
                    </DropdownMenuItem>
                  )}
                </>
              )}
              {status === 'excluded' && (
                <DropdownMenuItem onClick={() => setIsDetailOpen(true)}>
                  <FileText className="h-4 w-4 mr-2" />
                  View Details
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
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
