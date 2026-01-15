import { useState } from 'react';
import { BulkActionPanel } from './BulkActionPanel';
import { SearchableAccountSelector } from '../banking/SearchableAccountSelector';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { formatBulkCount } from '@/utils/bulkEditUtils';

interface BulkCategorizePanelProps {
  readonly isOpen: boolean;
  readonly onClose: () => void;
  readonly selectedCount: number;
  readonly onApply: (categoryId: string, overrideExisting: boolean) => void;
  readonly isApplying?: boolean;
  readonly itemType: 'transaction' | 'sale';
  readonly accountTypes: Array<'asset' | 'liability' | 'equity' | 'revenue' | 'expense'>;
  readonly helpText?: string;
}

/**
 * Shared side panel for bulk categorizing items (transactions or sales)
 * Follows Notion's property edit pattern
 * Used by both BulkCategorizeTransactionsPanel and BulkCategorizePosSalesPanel
 */
export function BulkCategorizePanel({
  isOpen,
  onClose,
  selectedCount,
  onApply,
  isApplying = false,
  itemType,
  accountTypes,
  helpText,
}: BulkCategorizePanelProps) {
  const [categoryId, setCategoryId] = useState('');
  const [overrideExisting, setOverrideExisting] = useState(false);

  const handleApply = () => {
    if (categoryId) {
      onApply(categoryId, overrideExisting);
    }
  };

  const handleClose = () => {
    setCategoryId('');
    setOverrideExisting(false);
    onClose();
  };

  // Generate preview
  const previewContent = categoryId && (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-sm">
        <span className="text-muted-foreground">Category</span>
        <span className="font-medium">Will be updated</span>
      </div>
      <div className="flex items-center justify-between text-sm">
        <span className="text-muted-foreground">Affected items</span>
        <Badge variant="secondary">{selectedCount}</Badge>
      </div>
      {overrideExisting && (
        <div className="text-xs text-amber-600 dark:text-amber-400 flex items-start gap-2">
          <span className="font-medium">⚠️</span>
          <span>Existing categories will be overwritten</span>
        </div>
      )}
    </div>
  );

  const pluralItemType = itemType === 'transaction' ? 'transactions' : 'sales';
  const singularItemType = itemType;

  return (
    <BulkActionPanel
      isOpen={isOpen}
      onClose={handleClose}
      title={`Categorize ${formatBulkCount(selectedCount, singularItemType)}`}
      onApply={handleApply}
      applyLabel={`Apply to ${selectedCount} ${selectedCount === 1 ? singularItemType : pluralItemType}`}
      isApplying={isApplying}
      previewContent={previewContent}
    >
      <div className="space-y-6">
        {/* Category selector */}
        <div className="space-y-2">
          <Label htmlFor="category-select">
            Chart of Accounts Category
          </Label>
          <SearchableAccountSelector
            value={categoryId}
            onValueChange={setCategoryId}
            placeholder="Select category..."
            filterByTypes={accountTypes}
          />
          <p className="text-xs text-muted-foreground">
            {helpText || `Choose the accounting category for these ${pluralItemType}`}
          </p>
        </div>

        {/* Override toggle */}
        <div className="flex items-center justify-between space-x-2 rounded-lg border p-4">
          <div className="space-y-0.5">
            <Label htmlFor="override-existing" className="text-sm font-medium">
              Override existing categories
            </Label>
            <p className="text-xs text-muted-foreground">
              Apply to all selected {pluralItemType}, even those already categorized
            </p>
          </div>
          <Switch
            id="override-existing"
            checked={overrideExisting}
            onCheckedChange={setOverrideExisting}
          />
        </div>
      </div>
    </BulkActionPanel>
  );
}
