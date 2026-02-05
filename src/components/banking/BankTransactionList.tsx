import { useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { BankTransaction } from "@/hooks/useBankTransactions";
import { BankTransactionRow } from "./BankTransactionRow";
import { BankTransactionCard } from "./BankTransactionCard";
import { Checkbox } from "@/components/ui/checkbox";
import { ChartAccount } from "@/hooks/useChartOfAccounts";
import { useIsMobile } from "@/hooks/use-mobile";

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

// Column widths for consistent layout (matches original table)
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

  const allSelected = transactions.length > 0 && transactions.every(t => selectedIds.has(t.id));
  const someSelected = transactions.some(t => selectedIds.has(t.id)) && !allSelected;

  // Virtual list setup - only renders visible items for performance
  // Using measureElement for dynamic row heights (handles variable content)
  const virtualizer = useVirtualizer({
    count: transactions.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 56, // Initial estimate; measureElement corrects it
    overscan: 10, // Render extra items above/below for smooth scrolling
  });

  const handleSelectAll = () => {
    if (allSelected && onClearSelection) {
      onClearSelection();
    } else if (onSelectAll) {
      onSelectAll();
    }
  };

  // Mobile card view - not virtualized (typically fewer visible items)
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
                <BankTransactionRow
                  transaction={transaction}
                  status={status}
                  accounts={accounts}
                  isSelectionMode={isSelectionMode}
                  isSelected={selectedIds.has(transaction.id)}
                  onSelectionToggle={onSelectionToggle}
                />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
