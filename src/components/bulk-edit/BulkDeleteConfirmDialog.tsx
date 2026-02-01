import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

interface BulkDeleteConfirmDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly selectedCount: number;
  readonly onConfirm: () => void;
  readonly isDeleting: boolean;
  readonly itemType?: 'transaction' | 'item';
}

/**
 * Shared confirmation dialog for bulk delete operations.
 * Used by Banking.tsx and Transactions.tsx for bulk transaction deletion.
 */
export function BulkDeleteConfirmDialog({
  open,
  onOpenChange,
  selectedCount,
  onConfirm,
  isDeleting,
  itemType = 'transaction',
}: BulkDeleteConfirmDialogProps): JSX.Element {
  const pluralItem = selectedCount !== 1 ? `${itemType}s` : itemType;

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            Delete {selectedCount} {pluralItem}?
          </AlertDialogTitle>
          <AlertDialogDescription className="space-y-2">
            <p>
              This will <strong>permanently delete</strong> the selected {pluralItem} from your records.
            </p>
            <p className="text-destructive font-medium">
              This action cannot be undone. The {pluralItem} can only be recovered by re-syncing from your bank.
            </p>
            <p className="text-muted-foreground text-sm">
              Use this when {pluralItem} don't belong to this restaurant (e.g., from a shared bank account).
            </p>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={onConfirm}
            disabled={isDeleting}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {isDeleting ? 'Deleting...' : 'Delete Permanently'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
