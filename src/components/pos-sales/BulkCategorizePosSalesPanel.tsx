import { BulkCategorizePanel } from '../bulk-edit/BulkCategorizePanel';

interface BulkCategorizePosSalesPanelProps {
  readonly isOpen: boolean;
  readonly onClose: () => void;
  readonly selectedCount: number;
  readonly onApply: (categoryId: string, overrideExisting: boolean) => void;
  readonly isApplying?: boolean;
}

/**
 * Side panel for bulk categorizing POS sales
 * Wraps the shared BulkCategorizePanel with POS-specific configuration
 */
export function BulkCategorizePosSalesPanel({
  isOpen,
  onClose,
  selectedCount,
  onApply,
  isApplying = false,
}: BulkCategorizePosSalesPanelProps) {
  return (
    <BulkCategorizePanel
      isOpen={isOpen}
      onClose={onClose}
      selectedCount={selectedCount}
      onApply={onApply}
      isApplying={isApplying}
      itemType="sale"
      accountTypes={['revenue', 'liability']}
      helpText="Choose the accounting category for these sales (typically revenue accounts)"
    />
  );
}
