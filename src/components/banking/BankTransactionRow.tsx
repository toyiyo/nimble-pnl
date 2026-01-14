import { useState, useMemo } from "react";
import { BankTransaction, useCategorizeTransaction, useExcludeTransaction } from "@/hooks/useBankTransactions";
import { TableCell, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Check, Edit, XCircle, FileText, Split, CheckCircle2, MoreVertical, Sparkles, Settings2 } from "lucide-react";
import { TransactionDetailSheet } from "./TransactionDetailSheet";
import { SplitTransactionDialog } from "./SplitTransactionDialog";
import { BankAccountInfo } from "./BankAccountInfo";
import { TransactionBadges } from "./TransactionBadges";
import { ChartAccount } from "@/hooks/useChartOfAccounts";
import { useRestaurantContext } from "@/contexts/RestaurantContext";
import { useReconcileTransaction, useUnreconcileTransaction } from "@/hooks/useBankReconciliation";
import { useDateFormat } from "@/hooks/useDateFormat";
import { AIConfidenceBadge } from "./AIConfidenceBadge";
import { EnhancedCategoryRulesDialog } from "./EnhancedCategoryRulesDialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { isMultiSelectKey } from "@/utils/bulkEditUtils";

interface BankTransactionRowProps {
  transaction: BankTransaction;
  status: 'for_review' | 'categorized' | 'excluded';
  accounts: ChartAccount[];
  // Bulk selection props (optional)
  isSelectionMode?: boolean;
  isSelected?: boolean;
  onSelectionToggle?: (id: string, event: React.MouseEvent) => void;
}

export function BankTransactionRow({ 
  transaction, 
  status, 
  accounts,
  isSelectionMode = false,
  isSelected = false,
  onSelectionToggle,
}: BankTransactionRowProps) {
  const [isDetailOpen, setIsDetailOpen] = useState(false);
  const [isSplitOpen, setIsSplitOpen] = useState(false);
  const [showRulesDialog, setShowRulesDialog] = useState(false);
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

  // Find the correct account by matching stripe_financial_account_id with raw_data.account
  const transactionAccount = useMemo(() => {
    const stripeAccountId = (transaction as BankTransaction & { raw_data?: { account?: string } }).raw_data?.account;
    return transaction.connected_bank?.bank_account_balances?.find(
      bal => bal.stripe_financial_account_id === stripeAccountId
    );
  }, [transaction]);

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

  const handleCreateRule = () => {
    setShowRulesDialog(true);
  };

  const getPrefilledRuleData = () => {
    const merchantName = transaction.merchant_name || transaction.normalized_payee;
    const description = transaction.description?.trim() || '';
    const isExpense = transaction.amount < 0;
    const amount = Math.abs(transaction.amount);
    
    // Check if description is too generic to use as pattern
    const genericTerms = ['withdrawal', 'deposit', 'payment', 'transfer', 'debit', 'credit', 'ach', 'wire'];
    const isGenericDescription = genericTerms.some(term => 
      description.toLowerCase() === term.toLowerCase()
    );
    
    // Use merchant name if available and specific (length >= 3)
    const hasSpecificMerchant = merchantName && merchantName.length >= 3 && 
      !genericTerms.some(term => merchantName.toLowerCase() === term.toLowerCase());
    
    // For recurring amounts (like salaries), suggest amount range
    const isLikelyRecurring = amount > 0 && amount >= 100 && Number.isInteger(amount * 100);
    const shouldSuggestAmountRange = isLikelyRecurring && !hasSpecificMerchant;
    
    return {
      ruleName: hasSpecificMerchant 
        ? `Auto-categorize ${merchantName.substring(0, 30)}${merchantName.length > 30 ? '...' : ''}`
        : 'Transaction categorization rule',
      appliesTo: 'bank_transactions' as const,
      // Only use merchant name if it's specific, not generic description
      descriptionPattern: hasSpecificMerchant ? merchantName : '',
      descriptionMatchType: 'contains' as const,
      supplierId: transaction.supplier?.id || '',
      transactionType: (isExpense ? 'debit' : 'credit') as 'debit' | 'credit',
      categoryId: transaction.category_id || transaction.suggested_category_id || '',
      priority: '5',
      autoApply: true,
      // Suggest amount range for recurring payments (±5% tolerance)
      minAmount: shouldSuggestAmountRange ? (amount * 0.95).toFixed(2) : '',
      maxAmount: shouldSuggestAmountRange ? (amount * 1.05).toFixed(2) : '',
    };
  };

  const handleRowClick = (event: React.MouseEvent) => {
    if (isSelectionMode && onSelectionToggle) {
      onSelectionToggle(transaction.id, event);
    }
  };

  return (
    <>
      <TableRow 
        data-testid="bank-transaction-row"
        className={`
          ${hasSuggestion ? 'bg-amber-50 dark:bg-amber-950/30 hover:bg-amber-100 dark:hover:bg-amber-950/40 border-l-4 border-l-amber-500 dark:border-l-amber-600' : 'hover:bg-muted/50'}
          ${isSelected ? 'bg-primary/10 border-l-4 border-l-primary' : ''}
          ${isSelectionMode ? 'cursor-pointer' : ''}
        `}
        onClick={handleRowClick}
      >
        {/* Checkbox column (only in selection mode) */}
        {isSelectionMode && (
          <TableCell className="w-[50px]" onClick={(e) => e.stopPropagation()}>
            <Checkbox
              checked={isSelected}
              onCheckedChange={() => onSelectionToggle?.(transaction.id, {} as React.MouseEvent)}
              aria-label={`Select transaction ${transaction.description}`}
            />
          </TableCell>
        )}

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
            accountMask={transactionAccount?.account_mask}
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
              <Badge 
                variant="outline"
                className="bg-slate-100 dark:bg-slate-700 text-slate-900 dark:text-slate-50 border-slate-300 dark:border-slate-600 hover:bg-slate-200 dark:hover:bg-slate-600"
              >
                {currentCategory.account_name}
              </Badge>
            ) : suggestedCategory ? (
              <div className="flex items-center gap-2 flex-wrap">
                <Badge 
                  variant="outline"
                  className="bg-amber-100 dark:bg-amber-900 text-amber-900 dark:text-amber-50 border-amber-400 dark:border-amber-600 hover:bg-amber-200 dark:hover:bg-amber-800"
                >
                  <Sparkles className="h-3 w-3 mr-1" />
                  {suggestedCategory.account_name}
                </Badge>
                {transaction.ai_confidence && (
                  <AIConfidenceBadge 
                    confidence={transaction.ai_confidence}
                    reasoning={transaction.ai_reasoning}
                  />
                )}
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
              <Badge 
                variant="outline"
                className="bg-slate-100 dark:bg-slate-700 text-slate-900 dark:text-slate-50 border-slate-300 dark:border-slate-600 hover:bg-slate-200 dark:hover:bg-slate-600"
              >
                {currentCategory.account_name}
              </Badge>
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
                  <DropdownMenuItem onClick={handleCreateRule}>
                    <Settings2 className="h-4 w-4 mr-2" />
                    Create Rule
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

      <EnhancedCategoryRulesDialog
        open={showRulesDialog}
        onOpenChange={setShowRulesDialog}
        defaultTab="bank"
        prefilledRule={getPrefilledRuleData()}
      />
    </>
  );
}
