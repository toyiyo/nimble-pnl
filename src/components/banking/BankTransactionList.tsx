import { useRef, useState, useCallback, useMemo } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { BankTransaction, useCategorizeTransaction, useDeleteTransaction } from "@/hooks/useBankTransactions";
import { MemoizedTransactionRow, TransactionDisplayValues } from "./MemoizedTransactionRow";
import { BankTransactionCard } from "./BankTransactionCard";
import { TransactionDialogs } from "./TransactionDialogs";
import { Checkbox } from "@/components/ui/checkbox";
import { ChartAccount } from "@/hooks/useChartOfAccounts";
import { useIsMobile } from "@/hooks/use-mobile";
import { useReconcileTransaction, useUnreconcileTransaction } from "@/hooks/useBankReconciliation";
import { useRestaurantContext } from "@/contexts/RestaurantContext";
import { useDateFormat } from "@/hooks/useDateFormat";

interface BankTransactionListProps {
  transactions: BankTransaction[];
  status: 'for_review' | 'categorized' | 'excluded';
  accounts: ChartAccount[];
  // Bulk selection props (optional)
  isSelectionMode?: boolean;
  selectedIds?: Set<string>;
  onSelectionToggle?: (id: string, event: React.MouseEvent) => void;
  onSelectAll?: () => void;
  onClearSelection?: () => void;
}

// Column widths for consistent layout (matches MemoizedTransactionRow)
const COLUMN_WIDTHS = {
  checkbox: 'w-[50px]',
  date: 'w-[110px]',
  description: 'flex-1 min-w-[180px]',
  payee: 'w-[120px] hidden md:block',
  bankAccount: 'w-[140px] hidden lg:block',
  amount: 'w-[100px] text-right',
  category: 'w-[140px] hidden lg:block',
  reason: 'w-[120px] hidden lg:block',
  actions: 'w-[60px] text-right',
};

// Dialog types for single dialog instance pattern
type DialogType = 'detail' | 'split' | 'delete' | 'rules' | null;

// Pre-compute rule data for a transaction
function getPrefilledRuleData(transaction: BankTransaction) {
  const merchantName = transaction.merchant_name || transaction.normalized_payee;
  const description = transaction.description?.trim() || '';
  const isExpense = transaction.amount < 0;
  const amount = Math.abs(transaction.amount);

  const genericTerms = ['withdrawal', 'deposit', 'payment', 'transfer', 'debit', 'credit', 'ach', 'wire'];
  const hasSpecificMerchant = merchantName && merchantName.length >= 3 &&
    !genericTerms.some(term => merchantName.toLowerCase() === term.toLowerCase());
  const isLikelyRecurring = amount > 0 && amount >= 100 && Number.isInteger(amount * 100);
  const shouldSuggestAmountRange = isLikelyRecurring && !hasSpecificMerchant;

  return {
    ruleName: hasSpecificMerchant
      ? `Auto-categorize ${merchantName.substring(0, 30)}${merchantName.length > 30 ? '...' : ''}`
      : 'Transaction categorization rule',
    appliesTo: 'bank_transactions' as const,
    descriptionPattern: hasSpecificMerchant ? merchantName : '',
    descriptionMatchType: 'contains' as const,
    supplierId: transaction.supplier?.id || '',
    transactionType: (isExpense ? 'debit' : 'credit') as 'debit' | 'credit',
    categoryId: transaction.category_id || transaction.suggested_category_id || '',
    priority: '5',
    autoApply: true,
    minAmount: shouldSuggestAmountRange ? (amount * 0.95).toFixed(2) : '',
    maxAmount: shouldSuggestAmountRange ? (amount * 1.05).toFixed(2) : '',
  };
}

export function BankTransactionList({
  transactions,
  status,
  accounts,
  isSelectionMode = false,
  selectedIds = new Set(),
  onSelectionToggle,
  onSelectAll,
  onClearSelection,
}: BankTransactionListProps) {
  const isMobile = useIsMobile();
  const parentRef = useRef<HTMLDivElement>(null);
  const { selectedRestaurant } = useRestaurantContext();
  const { formatTransactionDate } = useDateFormat();

  // Single dialog instance - managed at list level
  const [activeTransaction, setActiveTransaction] = useState<BankTransaction | null>(null);
  const [dialogType, setDialogType] = useState<DialogType>(null);

  // Mutations hoisted to list level (shared across all rows)
  const categorize = useCategorizeTransaction();
  const deleteTransaction = useDeleteTransaction();
  const reconcile = useReconcileTransaction();
  const unreconcile = useUnreconcileTransaction();

  const allSelected = transactions.length > 0 && transactions.every(t => selectedIds.has(t.id));
  const someSelected = transactions.some(t => selectedIds.has(t.id)) && !allSelected;

  // Virtual list setup
  const virtualizer = useVirtualizer({
    count: transactions.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 56,
    overscan: 10,
  });

  // Pre-compute display values for all transactions (memoized)
  const displayValuesMap = useMemo(() => {
    const map = new Map<string, TransactionDisplayValues>();
    const currencyFormatter = new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    });

    for (const txn of transactions) {
      const suggestedCategory = accounts?.find(a => a.id === txn.suggested_category_id);
      const currentCategory = accounts?.find(a => a.id === txn.category_id);

      map.set(txn.id, {
        isNegative: txn.amount < 0,
        formattedAmount: currencyFormatter.format(Math.abs(txn.amount)),
        formattedDate: formatTransactionDate(txn.transaction_date, 'MMM dd, yyyy'),
        suggestedCategoryName: suggestedCategory?.account_name,
        currentCategoryName: currentCategory?.account_name,
        hasSuggestion: !txn.is_categorized && !!suggestedCategory,
      });
    }
    return map;
  }, [transactions, accounts, formatTransactionDate]);

  // Stable callbacks for row actions
  const handleSelectAll = useCallback(() => {
    if (allSelected && onClearSelection) {
      onClearSelection();
    } else if (onSelectAll) {
      onSelectAll();
    }
  }, [allSelected, onClearSelection, onSelectAll]);

  const handleSelectionToggle = useCallback((id: string, event: React.MouseEvent) => {
    onSelectionToggle?.(id, event);
  }, [onSelectionToggle]);

  const handleQuickAccept = useCallback((transactionId: string, categoryId: string) => {
    categorize.mutate({ transactionId, categoryId });
  }, [categorize]);

  const handleOpenDetail = useCallback((transaction: BankTransaction) => {
    setActiveTransaction(transaction);
    setDialogType('detail');
  }, []);

  const handleOpenSplit = useCallback((transaction: BankTransaction) => {
    setActiveTransaction(transaction);
    setDialogType('split');
  }, []);

  const handleOpenDelete = useCallback((transaction: BankTransaction) => {
    setActiveTransaction(transaction);
    setDialogType('delete');
  }, []);

  const handleCreateRule = useCallback((transaction: BankTransaction) => {
    setActiveTransaction(transaction);
    setDialogType('rules');
  }, []);

  const handleReconcile = useCallback((transactionId: string) => {
    reconcile.mutate({ transactionId });
  }, [reconcile]);

  const handleUnreconcile = useCallback((transactionId: string) => {
    unreconcile.mutate({ transactionId });
  }, [unreconcile]);

  const handleCloseDialog = useCallback(() => {
    setDialogType(null);
    setActiveTransaction(null);
  }, []);

  const handleDeleteConfirm = useCallback(() => {
    if (!activeTransaction || !selectedRestaurant?.restaurant_id) return;
    deleteTransaction.mutate({
      transactionId: activeTransaction.id,
      restaurantId: selectedRestaurant.restaurant_id,
    }, {
      onSettled: handleCloseDialog,
    });
  }, [activeTransaction, selectedRestaurant?.restaurant_id, deleteTransaction, handleCloseDialog]);

  // Mobile card view - not virtualized
  if (isMobile) {
    return (
      <div className="space-y-3 px-4">
        {transactions.map((transaction) => (
          <BankTransactionCard
            key={transaction.id}
            transaction={transaction}
            status={status}
            accounts={accounts}
          />
        ))}
      </div>
    );
  }

  // Desktop virtualized view
  return (
    <>
      <div className="w-full overflow-hidden">
        {/* Header row - fixed, not virtualized */}
        <div className="flex items-center gap-2 px-4 py-3 border-b bg-muted/50 font-medium text-sm text-muted-foreground">
          {isSelectionMode && (
            <div className={COLUMN_WIDTHS.checkbox}>
              <Checkbox
                checked={someSelected ? "indeterminate" : allSelected}
                onCheckedChange={handleSelectAll}
                aria-label="Select all transactions"
              />
            </div>
          )}
          <div className={COLUMN_WIDTHS.date}>Date</div>
          <div className={COLUMN_WIDTHS.description}>Description</div>
          <div className={COLUMN_WIDTHS.payee}>Payee</div>
          <div className={COLUMN_WIDTHS.bankAccount}>Bank Account</div>
          <div className={COLUMN_WIDTHS.amount}>Amount</div>
          {status === 'for_review' && <div className={COLUMN_WIDTHS.category}>Category</div>}
          {status === 'categorized' && <div className={COLUMN_WIDTHS.category}>Category</div>}
          {status === 'excluded' && <div className={COLUMN_WIDTHS.reason}>Reason</div>}
          <div className={COLUMN_WIDTHS.actions}>Actions</div>
        </div>

        {/* Virtualized rows container */}
        <div
          ref={parentRef}
          className="h-[600px] overflow-auto"
        >
          <div
            style={{
              height: `${virtualizer.getTotalSize()}px`,
              width: '100%',
              position: 'relative',
            }}
          >
            {virtualizer.getVirtualItems().map((virtualRow) => {
              const transaction = transactions[virtualRow.index];
              if (!transaction) return null;

              const displayValues = displayValuesMap.get(transaction.id);
              if (!displayValues) return null;

              return (
                <div
                  key={virtualRow.index}
                  data-index={virtualRow.index}
                  ref={virtualizer.measureElement}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    transform: `translateY(${virtualRow.start}px)`,
                  }}
                >
                  <MemoizedTransactionRow
                    transaction={transaction}
                    status={status}
                    displayValues={displayValues}
                    isSelectionMode={isSelectionMode}
                    isSelected={selectedIds.has(transaction.id)}
                    isCategorizing={categorize.isPending}
                    onSelectionToggle={handleSelectionToggle}
                    onQuickAccept={handleQuickAccept}
                    onOpenDetail={handleOpenDetail}
                    onOpenSplit={handleOpenSplit}
                    onOpenDelete={handleOpenDelete}
                    onCreateRule={handleCreateRule}
                    onReconcile={handleReconcile}
                    onUnreconcile={handleUnreconcile}
                  />
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Single dialog instance for the entire list */}
      {activeTransaction && (
        <TransactionDialogs
          transaction={activeTransaction}
          isDetailOpen={dialogType === 'detail'}
          onDetailClose={handleCloseDialog}
          isSplitOpen={dialogType === 'split'}
          onSplitClose={handleCloseDialog}
          showRulesDialog={dialogType === 'rules'}
          onRulesDialogChange={(open) => !open && handleCloseDialog()}
          prefilledRule={dialogType === 'rules' ? getPrefilledRuleData(activeTransaction) : undefined}
          showDeleteConfirm={dialogType === 'delete'}
          onDeleteConfirmChange={(open) => !open && handleCloseDialog()}
          onDeleteConfirm={handleDeleteConfirm}
          isDeleting={deleteTransaction.isPending}
        />
      )}
    </>
  );
}
