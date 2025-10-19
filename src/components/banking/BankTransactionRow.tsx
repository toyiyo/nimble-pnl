import { useState } from "react";
import { format } from "date-fns";
import { BankTransaction, useCategorizeTransaction, useExcludeTransaction } from "@/hooks/useBankTransactions";
import { TableCell, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Check, Edit, XCircle, ArrowLeftRight, FileText } from "lucide-react";
import { TransactionDetailSheet } from "./TransactionDetailSheet";
import { useChartOfAccounts } from "@/hooks/useChartOfAccounts";
import { useRestaurantContext } from "@/contexts/RestaurantContext";

interface BankTransactionRowProps {
  transaction: BankTransaction;
  status: 'for_review' | 'categorized' | 'excluded';
}

export function BankTransactionRow({ transaction, status }: BankTransactionRowProps) {
  const [isDetailOpen, setIsDetailOpen] = useState(false);
  const { selectedRestaurant } = useRestaurantContext();
  const categorize = useCategorizeTransaction();
  const exclude = useExcludeTransaction();
  const { accounts } = useChartOfAccounts(selectedRestaurant?.restaurant_id || '');

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
          {format(new Date(transaction.transaction_date), 'MMM dd, yyyy')}
        </TableCell>
        
        <TableCell>
          <div className="flex flex-col">
            <span className="font-medium">{transaction.description}</span>
            {transaction.is_transfer && (
              <Badge variant="secondary" className="mt-1 w-fit">
                <ArrowLeftRight className="h-3 w-3 mr-1" />
                Transfer
              </Badge>
            )}
          </div>
        </TableCell>

        <TableCell>
          {transaction.normalized_payee || transaction.merchant_name || '—'}
        </TableCell>

        <TableCell className="text-right">
          <span className={isNegative ? "text-destructive" : "text-green-600"}>
            {isNegative ? '-' : '+'}{formattedAmount}
          </span>
        </TableCell>

        {status === 'for_review' && (
          <TableCell>
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
          <TableCell>
            {currentCategory ? (
              <Badge variant="secondary">{currentCategory.account_name}</Badge>
            ) : (
              <span className="text-muted-foreground text-sm">—</span>
            )}
          </TableCell>
        )}

        {status === 'excluded' && (
          <TableCell>
            <span className="text-sm text-muted-foreground">
              {transaction.excluded_reason || 'Excluded'}
            </span>
          </TableCell>
        )}

        <TableCell className="text-right">
          <div className="flex items-center justify-end gap-2">
            {status === 'for_review' && (
              <>
                {transaction.suggested_category_id && (
                  <Button
                    size="sm"
                    variant="default"
                    onClick={handleQuickAccept}
                    disabled={categorize.isPending}
                  >
                    <Check className="h-4 w-4 mr-1" />
                    Accept
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setIsDetailOpen(true)}
                >
                  <Edit className="h-4 w-4 mr-1" />
                  Edit
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={handleExclude}
                  disabled={exclude.isPending}
                >
                  <XCircle className="h-4 w-4" />
                </Button>
              </>
            )}
            {status === 'categorized' && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => setIsDetailOpen(true)}
              >
                <FileText className="h-4 w-4 mr-1" />
                View
              </Button>
            )}
          </div>
        </TableCell>
      </TableRow>

      <TransactionDetailSheet
        transaction={transaction}
        isOpen={isDetailOpen}
        onClose={() => setIsDetailOpen(false)}
      />
    </>
  );
}
