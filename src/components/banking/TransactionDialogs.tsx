import { BankTransaction } from '@/hooks/useBankTransactions';
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
import { TransactionDetailSheet } from './TransactionDetailSheet';
import { SplitTransactionDialog } from './SplitTransactionDialog';
import { EnhancedCategoryRulesDialog } from './EnhancedCategoryRulesDialog';
import type { PrefilledRuleData } from '@/hooks/useBankTransactionActions';

interface TransactionDialogsProps {
  transaction: BankTransaction;
  isDetailOpen: boolean;
  onDetailClose: () => void;
  isSplitOpen: boolean;
  onSplitClose: () => void;
  showRulesDialog: boolean;
  onRulesDialogChange: (open: boolean) => void;
  prefilledRule: PrefilledRuleData;
  showDeleteConfirm: boolean;
  onDeleteConfirmChange: (open: boolean) => void;
  onDeleteConfirm: () => void;
  isDeleting: boolean;
}

export function TransactionDialogs({
  transaction,
  isDetailOpen,
  onDetailClose,
  isSplitOpen,
  onSplitClose,
  showRulesDialog,
  onRulesDialogChange,
  prefilledRule,
  showDeleteConfirm,
  onDeleteConfirmChange,
  onDeleteConfirm,
  isDeleting,
}: TransactionDialogsProps) {
  return (
    <>
      <TransactionDetailSheet
        transaction={transaction}
        isOpen={isDetailOpen}
        onClose={onDetailClose}
      />

      <SplitTransactionDialog
        transaction={transaction}
        isOpen={isSplitOpen}
        onClose={onSplitClose}
      />

      <EnhancedCategoryRulesDialog
        open={showRulesDialog}
        onOpenChange={onRulesDialogChange}
        defaultTab="bank"
        prefilledRule={prefilledRule}
      />

      <AlertDialog open={showDeleteConfirm} onOpenChange={onDeleteConfirmChange}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this transaction?</AlertDialogTitle>
            <AlertDialogDescription className="space-y-2">
              <p>
                This will <strong>permanently delete</strong> this transaction from your records.
              </p>
              <p className="text-destructive font-medium">
                This action cannot be undone. The transaction can only be recovered by re-syncing from your bank.
              </p>
              <p className="text-muted-foreground text-sm">
                Use this when the transaction doesn't belong to this restaurant (e.g., from a shared bank account).
              </p>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={onDeleteConfirm}
              disabled={isDeleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isDeleting ? 'Deleting...' : 'Delete Permanently'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
