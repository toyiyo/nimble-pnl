import { BulkCategorizePanel } from '../bulk-edit/BulkCategorizePanel';

interface BulkCategorizeTransactionsPanelProps {
  readonly isOpen: boolean;
  readonly onClose: () => void;
  readonly selectedCount: number;
  readonly onApply: (categoryId: string, overrideExisting: boolean) => void;
  readonly isApplying?: boolean;
}

/**
 * Side panel for bulk categorizing bank transactions
 * Wraps the shared BulkCategorizePanel with transaction-specific configuration
 */
export function BulkCategorizeTransactionsPanel({
  isOpen,
  onClose,
  selectedCount,
  onApply,
  isApplying = false,
}: BulkCategorizeTransactionsPanelProps) {
  return (
    <BulkCategorizePanel
      isOpen={isOpen}
      onClose={onClose}
      selectedCount={selectedCount}
      onApply={onApply}
      isApplying={isApplying}
      itemType="transaction"
    />
  );
}
