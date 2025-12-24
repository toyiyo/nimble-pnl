import { useState } from 'react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { AlertTriangle, Unplug, Loader2, Trash2, Database } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { cn } from '@/lib/utils';

interface DisconnectBankDialogProps {
  bankName: string;
  bankIds: string | string[];
  onDisconnect: (bankId: string, deleteData: boolean) => Promise<void>;
  children?: React.ReactNode;
}

export const DisconnectBankDialog = ({
  bankName,
  bankIds,
  onDisconnect,
  children,
}: DisconnectBankDialogProps) => {
  const [isOpen, setIsOpen] = useState(false);
  const [deleteData, setDeleteData] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [isDisconnecting, setIsDisconnecting] = useState(false);

  const handleDisconnect = async () => {
    setIsDisconnecting(true);
    try {
      const ids = Array.isArray(bankIds) ? bankIds : [bankIds];
      for (const id of ids) {
        await onDisconnect(id, deleteData);
      }
      setIsOpen(false);
      // Reset state
      setDeleteData(false);
      setConfirmDelete(false);
    } catch (error) {
      console.error('Error disconnecting bank:', error);
    } finally {
      setIsDisconnecting(false);
    }
  };

  const handleOpenChange = (open: boolean) => {
    if (!isDisconnecting) {
      setIsOpen(open);
      if (!open) {
        // Reset state when dialog closes
        setDeleteData(false);
        setConfirmDelete(false);
      }
    }
  };

  const canProceed = deleteData ? confirmDelete : true;

  return (
    <AlertDialog open={isOpen} onOpenChange={handleOpenChange}>
      <AlertDialogTrigger asChild>
        {children || (
          <Button variant="destructive" size="sm">
            <Unplug className="mr-2 h-4 w-4" />
            Disconnect Bank
          </Button>
        )}
      </AlertDialogTrigger>
      <AlertDialogContent className="max-w-2xl max-h-[90vh] flex flex-col">
        <AlertDialogHeader className="flex-shrink-0">
          <AlertDialogTitle className="flex items-center gap-2 text-xl">
            <Unplug className="h-5 w-5 text-destructive" />
            Disconnect {bankName}?
          </AlertDialogTitle>
        </AlertDialogHeader>
        <div className="overflow-y-auto flex-1 px-6 -mx-6">
          <AlertDialogDescription className="text-base space-y-4 pt-4">
            <p>
              This will stop automatic transaction updates from your bank account. 
              You can always reconnect later if needed.
            </p>

            {/* Delete Data Option */}
            <div className="space-y-4 pt-2">
              <div className="flex items-start space-x-3 p-4 rounded-lg border bg-card">
                <Checkbox
                  id="deleteData"
                  checked={deleteData}
                  onCheckedChange={(checked) => {
                    setDeleteData(checked as boolean);
                    if (!checked) {
                      setConfirmDelete(false);
                    }
                  }}
                  className="mt-1"
                />
                <div className="flex-1 space-y-2">
                  <Label
                    htmlFor="deleteData"
                    className="text-base font-semibold cursor-pointer flex items-center gap-2"
                  >
                    <Trash2 className="h-4 w-4" />
                    Delete all transaction data
                  </Label>
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    Remove all imported transactions, journal entries, and categorizations 
                    associated with this bank account from your system.
                  </p>
                </div>
              </div>

              {/* Warning Alert when delete is selected */}
              {deleteData && (
                <Alert variant="destructive" className="border-2">
                  <AlertTriangle className="h-5 w-5" />
                  <AlertDescription className="space-y-3 ml-1">
                    <div className="font-semibold text-base">
                      ⚠️ WARNING: This action cannot be undone
                    </div>
                    <div className="space-y-2 text-sm">
                      <p>Deleting this data will permanently remove:</p>
                      <ul className="list-disc list-inside space-y-1 ml-2">
                        <li>All bank transactions imported from {bankName}</li>
                        <li>Associated journal entries and accounting records</li>
                        <li>Transaction categorizations and splits</li>
                        <li>Account balance history</li>
                      </ul>
                      <div className="pt-2 border-t border-destructive/20 mt-3">
                        <p className="font-semibold">This will affect:</p>
                        <ul className="list-disc list-inside space-y-1 ml-2 mt-1">
                          <li>Financial statements (Income Statement, Balance Sheet)</li>
                          <li>Profit & Loss reports</li>
                          <li>Cash flow analysis</li>
                          <li>Historical financial data and reconciliations</li>
                        </ul>
                      </div>
                    </div>

                    {/* Confirmation checkbox */}
                    <div className="flex items-start space-x-3 p-3 rounded-md bg-background/50 mt-4">
                      <Checkbox
                        id="confirmDelete"
                        checked={confirmDelete}
                        onCheckedChange={(checked) => setConfirmDelete(checked as boolean)}
                        className="mt-1 border-destructive data-[state=checked]:bg-destructive"
                      />
                      <Label
                        htmlFor="confirmDelete"
                        className="text-sm font-medium cursor-pointer leading-relaxed"
                      >
                        I understand that this will permanently delete all transaction 
                        data and affect my financial reports. This action cannot be reversed.
                      </Label>
                    </div>
                  </AlertDescription>
                </Alert>
              )}

              {/* Keep data info */}
              {!deleteData && (
                <Alert className="border-emerald-500/50 bg-emerald-500/5">
                  <Database className="h-4 w-4 text-emerald-600" />
                  <AlertDescription className="text-sm ml-1">
                    <span className="font-semibold text-emerald-700 dark:text-emerald-400">
                      Transaction history will be preserved.
                    </span>
                    <p className="mt-1 text-muted-foreground">
                      All your imported transactions and financial records will remain 
                      intact in the system. Only the automatic sync will stop.
                    </p>
                  </AlertDescription>
                </Alert>
              )}
            </div>
          </AlertDialogDescription>
        </div>
        <AlertDialogFooter className="gap-2 sm:gap-2 flex-shrink-0">
          <AlertDialogCancel disabled={isDisconnecting}>
            Cancel
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={handleDisconnect}
            disabled={isDisconnecting || !canProceed}
            className={cn(
              deleteData
                ? "bg-destructive hover:bg-destructive/90"
                : "bg-amber-500 hover:bg-amber-600 text-white"
            )}
          >
            {isDisconnecting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Disconnecting...
              </>
            ) : (
              <>
                <Unplug className="mr-2 h-4 w-4" />
                {deleteData ? 'Disconnect & Delete Data' : 'Disconnect Bank'}
              </>
            )}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};
