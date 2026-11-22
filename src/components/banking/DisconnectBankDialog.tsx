import { useState } from 'react';

import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';

import { AlertTriangle, Trash2, Database } from 'lucide-react';

import { DisconnectIntegrationDialog } from '@/components/integrations/DisconnectIntegrationDialog';
import { useRestaurantContext } from '@/contexts/RestaurantContext';
import type { DisconnectBankOptions } from '@/hooks/useStripeFinancialConnections';
import { notifyIntegrationDisconnect } from '@/lib/integrationDisconnect';

interface DisconnectBankDialogProps {
  bankName: string;
  bankIds: string | string[];
  onDisconnect: (
    bankId: string,
    deleteData: boolean,
    opts?: DisconnectBankOptions,
  ) => Promise<{ eventId: string | null }>;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export const DisconnectBankDialog = ({
  bankName,
  bankIds,
  onDisconnect,
  open,
  onOpenChange,
}: DisconnectBankDialogProps) => {
  const { selectedRestaurant } = useRestaurantContext();
  const [deleteData, setDeleteData] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const resetState = () => {
    setDeleteData(false);
    setConfirmDelete(false);
  };

  const handleOpenChange = (next: boolean) => {
    onOpenChange(next);
    if (!next) resetState();
  };

  const handleConfirm = async ({
    reason,
    reasonText,
  }: {
    reason: DisconnectBankOptions['reason'] | null;
    reasonText: string | null;
  }) => {
    const ids = Array.isArray(bankIds) ? bankIds : [bankIds];
    let recorded = false;
    // A failed call throws and stops the loop.
    for (const id of ids) {
      const result = await onDisconnect(id, deleteData, {
        reason,
        reasonText,
        recordEvent: !recorded,
      });
      if (!recorded && result?.eventId) {
        recorded = true;
        void notifyIntegrationDisconnect(result.eventId);
      }
    }
  };

  const canProceed = deleteData ? confirmDelete : true;

  const extra = (
    <div className="space-y-4">
      <div className="flex items-start space-x-3 p-4 rounded-xl border border-border/40 bg-background">
        <Checkbox
          id="deleteData"
          checked={deleteData}
          onCheckedChange={(checked) => {
            setDeleteData(checked === true);
            if (checked !== true) setConfirmDelete(false);
          }}
          className="mt-1"
        />
        <div className="flex-1 space-y-2">
          <Label
            htmlFor="deleteData"
            className="text-[14px] font-semibold cursor-pointer flex items-center gap-2"
          >
            <Trash2 className="h-4 w-4" aria-hidden="true" />
            Delete all transaction data
          </Label>
          <p className="text-[13px] text-muted-foreground leading-relaxed">
            Remove all imported transactions, journal entries, and categorizations
            associated with this bank account from your system.
          </p>
        </div>
      </div>

      {deleteData && (
        <Alert variant="destructive" className="border-2">
          <AlertTriangle className="h-5 w-5" aria-hidden="true" />
          <AlertDescription className="space-y-3 ml-1">
            <div className="font-semibold text-base">
              WARNING: This action cannot be undone
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
            <div className="flex items-start space-x-3 p-3 rounded-md bg-background/50 mt-4">
              <Checkbox
                id="confirmDelete"
                checked={confirmDelete}
                onCheckedChange={(checked) => setConfirmDelete(checked === true)}
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

      {!deleteData && (
        <Alert className="border-emerald-500/50 bg-emerald-500/5">
          <Database className="h-4 w-4 text-emerald-600" aria-hidden="true" />
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
  );

  return (
    <DisconnectIntegrationDialog
      open={open}
      onOpenChange={handleOpenChange}
      integrationName={bankName}
      restaurantName={selectedRestaurant?.restaurant?.name ?? ''}
      kind="bank"
      onConfirm={handleConfirm}
      extraConfirmContent={extra}
      confirmDisabled={!canProceed}
      confirmLabel={deleteData ? 'Disconnect and delete data' : 'Disconnect anyway'}
    />
  );
};
