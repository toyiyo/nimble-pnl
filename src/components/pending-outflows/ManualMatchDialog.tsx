import { useState, useMemo, useCallback, useRef, memo } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Search, Calendar, DollarSign } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { useBankTransactionsWithRelations, BankTransaction } from '@/hooks/useBankTransactions';
import { usePendingOutflowMutations } from '@/hooks/usePendingOutflows';
import { format } from 'date-fns';
import { PendingOutflow } from '@/types/pending-outflows';

// Pre-computed display values for each transaction row
interface MatchRowDisplayValues {
  formattedAmount: string;
  formattedDate: string;
  displayName: string;
  description: string | null;
  institutionName: string | null;
  isCategorized: boolean;
}

// Props for the memoized row
interface MatchRowProps {
  transaction: BankTransaction;
  displayValues: MatchRowDisplayValues;
  isSelected: boolean;
  onSelect: (id: string) => void;
}

// Memoized row component — NO hooks, just render
const MemoizedMatchRow = memo(function MemoizedMatchRow({
  transaction,
  displayValues,
  isSelected,
  onSelect,
}: MatchRowProps) {
  return (
    <button
      onClick={() => onSelect(transaction.id)}
      className={`w-full p-3 sm:p-4 rounded-lg border text-left transition-all hover:border-primary/50 ${
        isSelected
          ? 'border-primary bg-primary/5'
          : 'border-border bg-card'
      }`}
    >
      <div className="flex gap-3 sm:gap-4 w-full">
        {/* Left: Amount */}
        <div className="flex items-center gap-1 shrink-0">
          <DollarSign className="h-4 w-4 text-muted-foreground shrink-0" />
          <span className="font-semibold text-foreground text-base whitespace-nowrap">
            {displayValues.formattedAmount}
          </span>
        </div>

        {/* Right: Transaction details */}
        <div className="flex-1 min-w-0 flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <span className="font-medium text-foreground text-sm sm:text-base truncate">
              {displayValues.displayName}
            </span>
            {displayValues.isCategorized && (
              <span className="text-[11px] px-1.5 py-0.5 rounded-md bg-muted text-muted-foreground shrink-0">
                Categorized
              </span>
            )}
          </div>
          {displayValues.description && (
            <div className="text-xs sm:text-sm text-muted-foreground truncate">
              {displayValues.description}
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2 sm:gap-4 text-xs text-muted-foreground">
            <span className="flex items-center gap-1 whitespace-nowrap shrink-0">
              <Calendar className="h-3 w-3 shrink-0" />
              <span>{displayValues.formattedDate}</span>
            </span>
            {displayValues.institutionName && (
              <span className="truncate min-w-0">
                {displayValues.institutionName}
              </span>
            )}
          </div>
        </div>
      </div>
    </button>
  );
}, (prev, next) => {
  return (
    prev.transaction.id === next.transaction.id &&
    prev.isSelected === next.isSelected &&
    prev.displayValues === next.displayValues
  );
});

interface ManualMatchDialogProps {
  isOpen: boolean;
  onClose: () => void;
  pendingOutflow: PendingOutflow;
  restaurantId: string;
}

export const ManualMatchDialog = ({
  isOpen,
  onClose,
  pendingOutflow,
  restaurantId
}: ManualMatchDialogProps) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedTransactionId, setSelectedTransactionId] = useState<string | null>(null);
  const parentRef = useRef<HTMLDivElement>(null);
  // Force re-render when scroll container mounts in dialog portal.
  // The virtualizer reads parentRef.current via getScrollElement, but the
  // dialog content only enters the DOM when open={true}. Without this,
  // the virtualizer sees null and produces 0 virtual items on first open.
  const [, setScrollMounted] = useState(false);
  const scrollRef = useCallback((node: HTMLDivElement | null) => {
    parentRef.current = node;
    setScrollMounted(!!node);
  }, []);

  const { data: transactions, isLoading } = useBankTransactionsWithRelations(restaurantId);
  const { confirmMatch } = usePendingOutflowMutations();

  // Filter to negative transactions only (no is_categorized filter) with enhanced search
  const availableTransactions = useMemo(() => {
    if (!transactions) return [];

    const searchLower = searchTerm.toLowerCase().trim();

    return transactions
      .filter(t => {
        // Only filter out credits/inflows
        if (t.amount >= 0) return false;

        if (!searchLower) return true;

        // Search by merchant name, description, payee
        const textMatch =
          t.merchant_name?.toLowerCase().includes(searchLower) ||
          t.description?.toLowerCase().includes(searchLower) ||
          t.normalized_payee?.toLowerCase().includes(searchLower);

        // Search by amount (support formats like "100", "100.50", "$100")
        const amountStr = Math.abs(t.amount).toFixed(2);
        const amountMatch = amountStr.includes(searchLower.replace('$', ''));

        // Search by date (support formats like "2024", "Jan", "January", "01/15")
        const dateStr = format(new Date(t.transaction_date), 'MMM d, yyyy').toLowerCase();
        const dateISOStr = format(new Date(t.transaction_date), 'yyyy-MM-dd');
        const dateMatch = dateStr.includes(searchLower) || dateISOStr.includes(searchLower);

        return textMatch || amountMatch || dateMatch;
      })
      .sort((a, b) => new Date(b.transaction_date).getTime() - new Date(a.transaction_date).getTime());
  }, [transactions, searchTerm]);

  // Pre-compute display values for all filtered transactions
  const displayValuesMap = useMemo(() => {
    const map = new Map<string, MatchRowDisplayValues>();
    const currencyFormatter = new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    });

    for (const txn of availableTransactions) {
      map.set(txn.id, {
        formattedAmount: currencyFormatter.format(Math.abs(txn.amount)),
        formattedDate: format(new Date(txn.transaction_date), 'MMM d, yyyy'),
        displayName: txn.merchant_name || txn.description,
        description: txn.merchant_name && txn.description ? txn.description : null,
        institutionName: txn.connected_bank?.institution_name ?? null,
        isCategorized: txn.is_categorized,
      });
    }
    return map;
  }, [availableTransactions]);

  // Virtual list setup
  const virtualizer = useVirtualizer({
    count: availableTransactions.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 72,
    overscan: 10,
  });

  // Stable callback for row selection
  const handleSelect = useCallback((id: string) => {
    setSelectedTransactionId(id);
  }, []);

  const handleConfirm = async () => {
    if (!selectedTransactionId) return;

    await confirmMatch.mutateAsync({
      pendingOutflowId: pendingOutflow.id,
      bankTransactionId: selectedTransactionId
    });

    onClose();
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD'
    }).format(Math.abs(amount));
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-3xl h-[90vh] w-[95vw] sm:w-full p-0 flex flex-col gap-0">
        <DialogHeader className="px-4 sm:px-6 pt-4 sm:pt-6 pb-4 shrink-0">
          <DialogTitle className="text-lg sm:text-xl">Manual Match Transaction</DialogTitle>
          <DialogDescription className="text-sm break-words">
            Match with: <strong className="break-words">{pendingOutflow.vendor_name}</strong> - {formatCurrency(pendingOutflow.amount)}
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 min-h-0 flex flex-col px-4 sm:px-6 gap-4">
          {/* Enhanced Search */}
          <div className="shrink-0">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search by payee, description, date, or amount..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10"
                aria-label="Search transactions"
              />
            </div>
            <div className="text-xs text-muted-foreground mt-1 px-1">
              Try: payee name, date (e.g., "Jan 15"), or amount (e.g., "100.50")
            </div>
          </div>

          {/* Virtualized Transaction List — concrete height so virtualizer can compute visible items */}
          <div
            ref={scrollRef}
            className="border rounded-lg overflow-auto"
            style={{ height: 'calc(90vh - 230px)' }}
          >
            {isLoading ? (
              <div className="text-center text-muted-foreground py-8 text-sm">Loading transactions...</div>
            ) : availableTransactions.length === 0 ? (
              <div className="text-center text-muted-foreground py-8 text-sm">
                {searchTerm ? 'No transactions match your search' : 'No transactions found'}
              </div>
            ) : (
              <div
                style={{
                  height: `${virtualizer.getTotalSize()}px`,
                  width: '100%',
                  position: 'relative',
                }}
              >
                {virtualizer.getVirtualItems().map((virtualRow) => {
                  const transaction = availableTransactions[virtualRow.index];
                  if (!transaction) return null;

                  const displayValues = displayValuesMap.get(transaction.id);
                  if (!displayValues) return null;

                  return (
                    <div
                      key={transaction.id}
                      data-index={virtualRow.index}
                      ref={virtualizer.measureElement}
                      style={{
                        position: 'absolute',
                        top: 0,
                        left: 0,
                        width: '100%',
                        transform: `translateY(${virtualRow.start}px)`,
                        padding: '4px 8px',
                      }}
                    >
                      <MemoizedMatchRow
                        transaction={transaction}
                        displayValues={displayValues}
                        isSelected={selectedTransactionId === transaction.id}
                        onSelect={handleSelect}
                      />
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Actions */}
        <div className="flex flex-col-reverse sm:flex-row items-stretch sm:items-center justify-between gap-2 px-4 sm:px-6 py-4 border-t shrink-0">
          <Button variant="outline" onClick={onClose} className="w-full sm:w-auto">
            Cancel
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={!selectedTransactionId || confirmMatch.isPending}
            className="w-full sm:w-auto"
          >
            {confirmMatch.isPending ? 'Confirming...' : 'Confirm Match'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};
