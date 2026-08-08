import { useState, useEffect } from 'react';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { SearchableAccountSelector } from '@/components/banking/SearchableAccountSelector';

import { Printer, FileText, Loader2 } from 'lucide-react';

import { useRestaurantContext } from '@/contexts/RestaurantContext';
import { useCheckBankAccounts } from '@/hooks/useCheckBankAccounts';
import { useCheckAuditLog } from '@/hooks/useCheckAuditLog';
import { usePendingOutflowMutations } from '@/hooks/usePendingOutflows';

import type { PendingOutflow } from '@/types/pending-outflows';
import type { CheckSettings } from '@/hooks/useCheckSettings';

import {
  generateCheckPDF,
  generateCheckPDFAsync,
  generateCheckFilename,
  buildPrintConfig,
  numberToWords,
} from '@/utils/checkPrinting';
import { formatCurrency } from '@/utils/pdfExport';
import { toast } from 'sonner';

interface PrintCheckDialogProps {
  settings: CheckSettings;
  expense: PendingOutflow | null;
  onOpenChange: (open: boolean) => void;
}

export function PrintCheckDialog({ settings, expense, onOpenChange }: PrintCheckDialogProps) {
  const { selectedRestaurant } = useRestaurantContext();
  const {
    accounts,
    defaultAccount,
    isLoading: accountsLoading,
    claimCheckNumbers: claimForAccount,
    fetchAccountSecrets,
  } = useCheckBankAccounts();
  const { logCheckAction } = useCheckAuditLog();
  const { updatePendingOutflow } = usePendingOutflowMutations();

  const [memo, setMemo] = useState('');
  const [isPrinting, setIsPrinting] = useState(false);
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null);

  const isOpen = expense !== null;

  const [wasOpen, setWasOpen] = useState(false);
  const [shownExpense, setShownExpense] = useState<PendingOutflow | null>(null);

  if (isOpen !== wasOpen) {
    setWasOpen(isOpen);
  }

  // Reset on each open, and when the user picks a different row.
  if (expense && (!wasOpen || expense.id !== shownExpense?.id)) {
    setShownExpense(expense);
    setMemo(expense.notes ?? '');
    setSelectedCategoryId(expense.category_id ?? null);
    setSelectedAccountId(defaultAccount?.id ?? null);
  }

  const displayExpense = expense ?? shownExpense;

  // Initialize account selection once per open cycle (late fill once accounts load)
  useEffect(() => {
    if (!isOpen) return;
    setSelectedAccountId((current) => current ?? defaultAccount?.id ?? null);
  }, [isOpen, defaultAccount?.id]);

  if (!displayExpense) return null;

  const handlePrint = async () => {
    if (!settings || !selectedRestaurant) return;

    const selectedAccount = accounts.find((a) => a.id === selectedAccountId) ?? defaultAccount;
    if (!selectedAccount) {
      toast.error('Please select a bank account');
      return;
    }

    setIsPrinting(true);
    try {
      // Fetch MICR secrets first so any failure aborts BEFORE we claim a check
      // number or write a "printed" audit row that wouldn't match a real PDF.
      let secrets: { routing_number: string; account_number: string } | null = null;
      if (selectedAccount.print_bank_info) {
        if (!selectedAccount.routing_number || !selectedAccount.account_number_last4) {
          toast.error('Bank info incomplete. Open Check Settings to add the routing and account numbers, or turn off "Print bank info" for this account.');
          return;
        }
        try {
          secrets = await fetchAccountSecrets(selectedAccount.id);
        } catch (e) {
          toast.error(e instanceof Error ? e.message : "Couldn't load bank info");
          return;
        }
        if (!secrets) {
          toast.error('Account number is missing. Re-enter it in Check Settings.');
          return;
        }
      }

      const checkNumber = await claimForAccount.mutateAsync({
        accountId: selectedAccount.id,
        count: 1,
      });

      await updatePendingOutflow.mutateAsync({
        id: displayExpense.id,
        input: {
          payment_method: 'check',
          reference_number: String(checkNumber),
          notes: memo.trim() || displayExpense.notes,
          check_bank_account_id: selectedAccount.id,
          category_id: selectedCategoryId,
        },
      });

      await logCheckAction.mutateAsync({
        check_number: checkNumber,
        payee_name: displayExpense.vendor_name,
        amount: displayExpense.amount,
        issue_date: displayExpense.issue_date,
        memo: memo.trim() || null,
        action: 'printed',
        pending_outflow_id: displayExpense.id,
        check_bank_account_id: selectedAccount.id,
      });

      const checks = [
        {
          checkNumber,
          payeeName: displayExpense.vendor_name,
          amount: displayExpense.amount,
          issueDate: displayExpense.issue_date,
          memo: memo.trim() || undefined,
        },
      ];
      const config = buildPrintConfig(settings, selectedAccount, secrets);
      const pdf = selectedAccount.print_bank_info
        ? await generateCheckPDFAsync(config, checks)
        : generateCheckPDF(config, checks);
      const filename = generateCheckFilename(selectedRestaurant.restaurant.name, [checkNumber]);
      pdf.save(filename);

      toast.success(`Check #${checkNumber} printed`);
      onOpenChange(false);
    } catch (err) {
      if (import.meta.env.DEV) {
        console.error('Print check error:', err);
      }
      toast.error(err instanceof Error ? err.message : 'Failed to print check');
    } finally {
      setIsPrinting(false);
    }
  };

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        // Ignore a close request (Escape, backdrop click, the built-in X
        // button) while a print is in flight. Only the footer buttons
        // check isPrinting on their own; without this guard the user can
        // still dismiss the dialog through those other paths, open a
        // different row, and then have the finishing print call the
        // shared onOpenChange(false) and close that new row's dialog.
        if (isPrinting) return;
        onOpenChange(open);
      }}
    >
      <DialogContent className="max-w-md max-h-[80vh] overflow-y-auto p-0 gap-0 border-border/40">
        <DialogHeader className="px-6 pt-6 pb-4 border-b border-border/40">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-muted/50 flex items-center justify-center">
              <FileText className="h-5 w-5 text-foreground" />
            </div>
            <div>
              <DialogTitle className="text-[17px] font-semibold text-foreground">
                Print Check
              </DialogTitle>
              <DialogDescription className="text-[13px] text-muted-foreground mt-0.5">
                Review details before printing
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="px-6 py-5 space-y-5">
          {/* Summary */}
          <div className="rounded-xl border border-border/40 bg-muted/30 p-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-[13px] text-muted-foreground">Pay to</span>
              <span className="text-[14px] font-medium text-foreground">{displayExpense.vendor_name}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[13px] text-muted-foreground">Amount</span>
              <div className="text-right">
                <p className="text-[17px] font-semibold text-foreground">
                  {formatCurrency(displayExpense.amount)}
                </p>
                <p className="text-[11px] text-muted-foreground">{numberToWords(displayExpense.amount)}</p>
              </div>
            </div>
          </div>

          {/* Bank account selector — only shown when multiple accounts exist */}
          {accounts.length > 1 && (
            <div className="space-y-2">
              <Label htmlFor="print-check-account" className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider">
                Bank Account
              </Label>
              <Select value={selectedAccountId ?? ''} onValueChange={setSelectedAccountId}>
                <SelectTrigger id="print-check-account" className="h-10 text-[14px] bg-muted/30 border-border/40 rounded-lg">
                  <SelectValue placeholder="Select account" />
                </SelectTrigger>
                <SelectContent>
                  {accounts.map((account) => (
                    <SelectItem key={account.id} value={account.id}>
                      {account.account_name}{account.bank_name ? ` (${account.bank_name})` : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Memo */}
          <div className="space-y-2">
            <Label htmlFor="print-check-memo" className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider">
              Memo (optional)
            </Label>
            <Input
              id="print-check-memo"
              value={memo}
              onChange={(e) => setMemo(e.target.value)}
              placeholder="Purpose of payment"
              className="h-10 text-[14px] bg-muted/30 border-border/40 rounded-lg focus-visible:ring-1 focus-visible:ring-border"
            />
          </div>

          {/* Category */}
          <div className="space-y-2">
            <Label htmlFor="print-check-category" className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider">
              Category (optional)
            </Label>
            <SearchableAccountSelector
              triggerId="print-check-category"
              value={selectedCategoryId ?? undefined}
              onValueChange={(v) => setSelectedCategoryId(v || null)}
              filterByTypes={['expense', 'cogs', 'asset']}
              placeholder="Pick a chart-of-accounts category"
              triggerAriaLabel="Category for this check"
            />
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-border/40 flex justify-end gap-2">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isPrinting}
            className="h-9 px-4 rounded-lg text-[13px] font-medium text-muted-foreground hover:text-foreground"
          >
            Cancel
          </Button>
          <Button
            onClick={handlePrint}
            disabled={isPrinting || accountsLoading}
            aria-busy={isPrinting || accountsLoading}
            className="h-9 px-4 rounded-lg bg-foreground text-background hover:bg-foreground/90 text-[13px] font-medium"
          >
            {isPrinting || accountsLoading ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Printer className="mr-2 h-4 w-4" />
            )}
            Print Check
          </Button>
        </div>

        {/* Name the active operation for a screen reader. */}
        <div role="status" aria-live="polite" className="sr-only">
          {isPrinting
            ? 'The check prints.'
            : accountsLoading
              ? 'The bank accounts load.'
              : ''}
        </div>
      </DialogContent>
    </Dialog>
  );
}
