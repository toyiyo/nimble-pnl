import { useRef, useState, useCallback, useMemo, memo } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Skeleton } from "@/components/ui/skeleton";

import { MoreVertical, RotateCcw, Trash2, Inbox } from "lucide-react";

import {
  useDeletedBankTransactions,
  useRestoreTransaction,
  usePermanentlyDeleteTombstone,
  type DeletedBankTransaction,
} from "@/hooks/useDeletedBankTransactions";
import { useDateFormat } from "@/hooks/useDateFormat";
import { useIsMobile } from "@/hooks/use-mobile";

interface DeletedTransactionsListProps {
  restaurantId: string | undefined;
}

interface DeletedRowDisplayValues {
  formattedDate: string;
  formattedDeletedAt: string;
  formattedAmount: string;
  isNegative: boolean;
}

// Column widths for consistent layout
const COLUMN_WIDTHS = {
  date: "w-[110px]",
  description: "flex-1 min-w-[180px]",
  merchant: "w-[160px] hidden md:block",
  amount: "w-[100px] text-right",
  deletedAt: "w-[120px] hidden lg:block",
  actions: "w-[60px] text-right",
};

// Memoized row component - NO hooks inside
const MemoizedDeletedRow = memo(
  function MemoizedDeletedRow({
    transaction,
    displayValues,
    onRestore,
    onPermanentDelete,
    isRestoring,
  }: {
    transaction: DeletedBankTransaction;
    displayValues: DeletedRowDisplayValues;
    onRestore: (transaction: DeletedBankTransaction) => void;
    onPermanentDelete: (transaction: DeletedBankTransaction) => void;
    isRestoring: boolean;
  }) {
    return (
      <div className="group flex items-center gap-2 px-4 py-3 border-b border-border/40 hover:bg-muted/30 transition-colors">
        {/* Date */}
        <div className={COLUMN_WIDTHS.date}>
          <span className="text-[14px] text-foreground">
            {displayValues.formattedDate}
          </span>
        </div>

        {/* Description */}
        <div className={COLUMN_WIDTHS.description}>
          <div className="truncate text-[14px] font-medium text-foreground">
            {transaction.description || "No description"}
          </div>
          <div className="text-[13px] text-muted-foreground md:hidden">
            {transaction.merchant_name || ""}
          </div>
          <div className="text-[13px] text-muted-foreground lg:hidden">
            Deleted {displayValues.formattedDeletedAt}
          </div>
        </div>

        {/* Merchant */}
        <div className={COLUMN_WIDTHS.merchant}>
          <span className="text-[13px] text-muted-foreground truncate block">
            {transaction.merchant_name || "--"}
          </span>
        </div>

        {/* Amount */}
        <div className={COLUMN_WIDTHS.amount}>
          <span
            className={`text-[14px] font-medium ${
              displayValues.isNegative
                ? "text-destructive"
                : "text-emerald-600 dark:text-emerald-400"
            }`}
          >
            {displayValues.isNegative ? "-" : "+"}
            {displayValues.formattedAmount}
          </span>
        </div>

        {/* Deleted At */}
        <div className={COLUMN_WIDTHS.deletedAt}>
          <span className="text-[13px] text-muted-foreground">
            {displayValues.formattedDeletedAt}
          </span>
        </div>

        {/* Actions */}
        <div className={COLUMN_WIDTHS.actions}>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 opacity-0 group-hover:opacity-100 transition-opacity"
                aria-label="Transaction actions"
                disabled={isRestoring}
              >
                <MoreVertical className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuItem
                onClick={() => onRestore(transaction)}
                className="text-[13px]"
              >
                <RotateCcw className="h-4 w-4 mr-2" />
                Restore
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => onPermanentDelete(transaction)}
                className="text-[13px] text-destructive focus:text-destructive"
              >
                <Trash2 className="h-4 w-4 mr-2" />
                Permanently Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    );
  },
  (prev, next) => {
    return (
      prev.transaction.id === next.transaction.id &&
      prev.displayValues === next.displayValues &&
      prev.isRestoring === next.isRestoring
    );
  }
);

// Mobile card for deleted transactions
function DeletedTransactionCard({
  transaction,
  displayValues,
  onRestore,
  onPermanentDelete,
  isRestoring,
}: {
  transaction: DeletedBankTransaction;
  displayValues: DeletedRowDisplayValues;
  onRestore: (transaction: DeletedBankTransaction) => void;
  onPermanentDelete: (transaction: DeletedBankTransaction) => void;
  isRestoring: boolean;
}) {
  return (
    <div className="group flex items-center justify-between p-4 rounded-xl border border-border/40 bg-background hover:border-border transition-colors">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-[13px] text-muted-foreground">
            {displayValues.formattedDate}
          </span>
          <span
            className={`text-[14px] font-medium ${
              displayValues.isNegative
                ? "text-destructive"
                : "text-emerald-600 dark:text-emerald-400"
            }`}
          >
            {displayValues.isNegative ? "-" : "+"}
            {displayValues.formattedAmount}
          </span>
        </div>
        <div className="truncate text-[14px] font-medium text-foreground mt-0.5">
          {transaction.description || "No description"}
        </div>
        {transaction.merchant_name && (
          <div className="text-[13px] text-muted-foreground">
            {transaction.merchant_name}
          </div>
        )}
        <div className="text-[13px] text-muted-foreground mt-1">
          Deleted {displayValues.formattedDeletedAt}
        </div>
      </div>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 shrink-0"
            aria-label="Transaction actions"
            disabled={isRestoring}
          >
            <MoreVertical className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48">
          <DropdownMenuItem
            onClick={() => onRestore(transaction)}
            className="text-[13px]"
          >
            <RotateCcw className="h-4 w-4 mr-2" />
            Restore
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => onPermanentDelete(transaction)}
            className="text-[13px] text-destructive focus:text-destructive"
          >
            <Trash2 className="h-4 w-4 mr-2" />
            Permanently Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

// Loading skeleton for deleted transactions list
function DeletedTransactionsSkeleton({ rowCount = 8 }: { rowCount?: number }) {
  return (
    <div className="w-full overflow-hidden">
      {/* Header skeleton */}
      <div className="flex items-center gap-2 px-4 py-3 border-b bg-muted/50">
        <Skeleton className="h-4 w-[110px]" />
        <Skeleton className="h-4 flex-1 min-w-[180px]" />
        <Skeleton className="h-4 w-[160px] hidden md:block" />
        <Skeleton className="h-4 w-[100px]" />
        <Skeleton className="h-4 w-[120px] hidden lg:block" />
        <Skeleton className="h-4 w-[60px]" />
      </div>
      {/* Row skeletons */}
      <div className="h-[600px]">
        {Array.from({ length: rowCount }, (_, i) => (
          <div
            key={`deleted-skeleton-${i}`}
            className="flex items-center gap-2 px-4 py-3 border-b"
          >
            <Skeleton className="h-4 w-[110px]" />
            <div className="flex-1 min-w-[180px] space-y-1">
              <Skeleton className="h-4 w-full max-w-[200px]" />
              <Skeleton className="h-3 w-16" />
            </div>
            <Skeleton className="h-4 w-[160px] hidden md:block" />
            <Skeleton className="h-4 w-[100px]" />
            <Skeleton className="h-4 w-[120px] hidden lg:block" />
            <Skeleton className="h-8 w-8 rounded" />
          </div>
        ))}
      </div>
    </div>
  );
}

export function DeletedTransactionsList({
  restaurantId,
}: DeletedTransactionsListProps) {
  const isMobile = useIsMobile();
  const parentRef = useRef<HTMLDivElement>(null);
  const { formatTransactionDate } = useDateFormat();

  const { data: transactions = [], isLoading, error } = useDeletedBankTransactions(restaurantId);
  const restoreMutation = useRestoreTransaction();
  const permanentDeleteMutation = usePermanentlyDeleteTombstone();

  // Single dialog instance for permanent delete confirmation
  const [confirmDeleteTransaction, setConfirmDeleteTransaction] =
    useState<DeletedBankTransaction | null>(null);

  // Virtual list setup
  const virtualizer = useVirtualizer({
    count: transactions.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 56,
    overscan: 10,
  });

  // Pre-compute display values
  const displayValuesMap = useMemo(() => {
    const map = new Map<string, DeletedRowDisplayValues>();
    const currencyFormatter = new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
    });

    for (const txn of transactions) {
      map.set(txn.id, {
        formattedDate: formatTransactionDate(
          txn.transaction_date,
          "MMM dd, yyyy"
        ),
        formattedDeletedAt: formatTransactionDate(txn.deleted_at, "MMM dd"),
        formattedAmount: currencyFormatter.format(Math.abs(txn.amount)),
        isNegative: txn.amount < 0,
      });
    }
    return map;
  }, [transactions, formatTransactionDate]);

  // Stable callbacks
  const handleRestore = useCallback(
    (transaction: DeletedBankTransaction) => {
      if (!restaurantId) return;
      restoreMutation.mutate({
        tombstoneId: transaction.id,
        restaurantId,
      });
    },
    [restaurantId, restoreMutation]
  );

  const handlePermanentDelete = useCallback(
    (transaction: DeletedBankTransaction) => {
      setConfirmDeleteTransaction(transaction);
    },
    []
  );

  const handleConfirmPermanentDelete = useCallback(() => {
    if (!confirmDeleteTransaction || !restaurantId) return;
    permanentDeleteMutation.mutate(
      {
        tombstoneId: confirmDeleteTransaction.id,
        restaurantId,
      },
      {
        onSettled: () => setConfirmDeleteTransaction(null),
      }
    );
  }, [confirmDeleteTransaction, restaurantId, permanentDeleteMutation]);

  // Loading state
  if (isLoading) {
    return <DeletedTransactionsSkeleton />;
  }

  // Error state
  if (error) {
    return (
      <div className="text-center py-12">
        <p className="text-[14px] text-destructive">
          Failed to load deleted transactions
        </p>
        <p className="text-[13px] text-muted-foreground mt-1">
          {error instanceof Error ? error.message : "An error occurred"}
        </p>
      </div>
    );
  }

  // Empty state
  if (transactions.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        <Inbox className="h-10 w-10 mx-auto mb-3 text-muted-foreground/50" />
        <p className="text-[14px] font-medium text-foreground">
          No deleted transactions
        </p>
        <p className="text-[13px] mt-1">
          Deleted transactions will appear here for review
        </p>
      </div>
    );
  }

  // Mobile card view
  if (isMobile) {
    return (
      <>
        <div className="space-y-3 px-4">
          {transactions.map((transaction) => {
            const displayValues = displayValuesMap.get(transaction.id);
            if (!displayValues) return null;
            return (
              <DeletedTransactionCard
                key={transaction.id}
                transaction={transaction}
                displayValues={displayValues}
                onRestore={handleRestore}
                onPermanentDelete={handlePermanentDelete}
                isRestoring={restoreMutation.isPending}
              />
            );
          })}
        </div>

        <AlertDialog
          open={!!confirmDeleteTransaction}
          onOpenChange={(open) => !open && setConfirmDeleteTransaction(null)}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle className="text-[17px] font-semibold text-foreground">
                Permanently delete this transaction?
              </AlertDialogTitle>
              <AlertDialogDescription className="text-[13px] text-muted-foreground">
                This will remove the deletion record. The transaction may be
                re-imported the next time your bank syncs or you upload a
                statement. This action cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel className="text-[13px]">
                Cancel
              </AlertDialogCancel>
              <AlertDialogAction
                onClick={handleConfirmPermanentDelete}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90 text-[13px]"
                disabled={permanentDeleteMutation.isPending}
              >
                {permanentDeleteMutation.isPending
                  ? "Deleting..."
                  : "Permanently Delete"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </>
    );
  }

  // Desktop virtualized view
  return (
    <>
      <div className="w-full overflow-hidden">
        {/* Header row */}
        <div className="flex items-center gap-2 px-4 py-3 border-b bg-muted/50 font-medium text-sm text-muted-foreground">
          <div className={COLUMN_WIDTHS.date}>Date</div>
          <div className={COLUMN_WIDTHS.description}>Description</div>
          <div className={COLUMN_WIDTHS.merchant}>Merchant</div>
          <div className={COLUMN_WIDTHS.amount}>Amount</div>
          <div className={COLUMN_WIDTHS.deletedAt}>Deleted</div>
          <div className={COLUMN_WIDTHS.actions}>Actions</div>
        </div>

        {/* Virtualized rows container */}
        <div ref={parentRef} className="h-[600px] overflow-auto">
          <div
            style={{
              height: `${virtualizer.getTotalSize()}px`,
              width: "100%",
              position: "relative",
            }}
          >
            {virtualizer.getVirtualItems().map((virtualRow) => {
              const transaction = transactions[virtualRow.index];
              if (!transaction) return null;

              const displayValues = displayValuesMap.get(transaction.id);
              if (!displayValues) return null;

              return (
                <div
                  key={transaction.id}
                  data-index={virtualRow.index}
                  ref={virtualizer.measureElement}
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: "100%",
                    transform: `translateY(${virtualRow.start}px)`,
                  }}
                >
                  <MemoizedDeletedRow
                    transaction={transaction}
                    displayValues={displayValues}
                    onRestore={handleRestore}
                    onPermanentDelete={handlePermanentDelete}
                    isRestoring={restoreMutation.isPending}
                  />
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Permanent delete confirmation dialog - single instance */}
      <AlertDialog
        open={!!confirmDeleteTransaction}
        onOpenChange={(open) => !open && setConfirmDeleteTransaction(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="text-[17px] font-semibold text-foreground">
              Permanently delete this transaction?
            </AlertDialogTitle>
            <AlertDialogDescription className="text-[13px] text-muted-foreground">
              This will remove the deletion record. The transaction may be
              re-imported the next time your bank syncs or you upload a
              statement. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="text-[13px]">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmPermanentDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90 text-[13px]"
              disabled={permanentDeleteMutation.isPending}
            >
              {permanentDeleteMutation.isPending
                ? "Deleting..."
                : "Permanently Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
