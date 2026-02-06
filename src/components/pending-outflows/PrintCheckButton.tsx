import { useState } from 'react';

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

import { Printer, FileText, Loader2 } from 'lucide-react';

import { useRestaurantContext } from '@/contexts/RestaurantContext';
import { useCheckSettings } from '@/hooks/useCheckSettings';
import { useCheckAuditLog } from '@/hooks/useCheckAuditLog';
import { usePendingOutflowMutations } from '@/hooks/usePendingOutflows';
import {
  generateCheckPDF,
  generateCheckFilename,
  numberToWords,
} from '@/utils/checkPrinting';
import { formatCurrency } from '@/utils/pdfExport';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

import type { PendingOutflow } from '@/types/pending-outflows';

interface PrintCheckButtonProps {
  expense: PendingOutflow;
}

export function PrintCheckButton({ expense }: PrintCheckButtonProps) {
  const { selectedRestaurant } = useRestaurantContext();
  const { settings } = useCheckSettings();
  const { logCheckAction } = useCheckAuditLog();
  const { updatePendingOutflow } = usePendingOutflowMutations();

  const [open, setOpen] = useState(false);
  const [memo, setMemo] = useState(expense.notes ?? '');
  const [isPrinting, setIsPrinting] = useState(false);

  // Don't show if settings aren't configured
  if (!settings) return null;

  const handlePrint = async () => {
    if (!settings || !selectedRestaurant) return;

    setIsPrinting(true);
    try {
      // Claim one check number
      const { data: startNumber, error: rpcError } = await supabase.rpc(
        'claim_check_numbers',
        { p_restaurant_id: selectedRestaurant.restaurant_id, p_count: 1 },
      );
      if (rpcError) throw rpcError;
      if (typeof startNumber !== 'number') throw new Error('Failed to claim check number');

      const checkNumber = startNumber;

      // Update the existing pending outflow with check info BEFORE generating PDF
      await updatePendingOutflow.mutateAsync({
        id: expense.id,
        input: {
          payment_method: 'check',
          reference_number: String(checkNumber),
          notes: memo.trim() || expense.notes,
        },
      });

      // Audit log
      await logCheckAction.mutateAsync({
        check_number: checkNumber,
        payee_name: expense.vendor_name,
        amount: expense.amount,
        issue_date: expense.issue_date,
        memo: memo.trim() || null,
        action: 'printed',
        pending_outflow_id: expense.id,
      });

      // Generate & save PDF after records are committed
      const pdf = generateCheckPDF(settings, [
        {
          checkNumber,
          payeeName: expense.vendor_name,
          amount: expense.amount,
          issueDate: expense.issue_date,
          memo: memo.trim() || undefined,
        },
      ]);
      const filename = generateCheckFilename(selectedRestaurant.restaurant.name, [checkNumber]);
      pdf.save(filename);

      toast.success(`Check #${checkNumber} printed`);
      setOpen(false);
    } catch (err) {
      console.error('Print check error:', err);
      toast.error(err instanceof Error ? err.message : 'Failed to print check');
    } finally {
      setIsPrinting(false);
    }
  };

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={(e) => {
          e.stopPropagation();
          setOpen(true);
        }}
        className="h-8 px-2 rounded-lg text-[13px] font-medium"
        aria-label={`Print check for ${expense.vendor_name}`}
      >
        <Printer className="h-3.5 w-3.5 mr-1" />
        Print
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md p-0 gap-0 border-border/40">
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
                <span className="text-[14px] font-medium text-foreground">{expense.vendor_name}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[13px] text-muted-foreground">Amount</span>
                <div className="text-right">
                  <p className="text-[17px] font-semibold text-foreground">
                    {formatCurrency(expense.amount)}
                  </p>
                  <p className="text-[11px] text-muted-foreground">{numberToWords(expense.amount)}</p>
                </div>
              </div>
            </div>

            {/* Memo */}
            <div className="space-y-2">
              <Label className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider">
                Memo (optional)
              </Label>
              <Input
                value={memo}
                onChange={(e) => setMemo(e.target.value)}
                placeholder="Purpose of payment"
                className="h-10 text-[14px] bg-muted/30 border-border/40 rounded-lg focus-visible:ring-1 focus-visible:ring-border"
              />
            </div>
          </div>

          {/* Footer */}
          <div className="px-6 py-4 border-t border-border/40 flex justify-end gap-2">
            <Button
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={isPrinting}
              className="h-9 px-4 rounded-lg text-[13px] font-medium text-muted-foreground hover:text-foreground"
            >
              Cancel
            </Button>
            <Button
              onClick={handlePrint}
              disabled={isPrinting}
              className="h-9 px-4 rounded-lg bg-foreground text-background hover:bg-foreground/90 text-[13px] font-medium"
            >
              {isPrinting ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Printer className="mr-2 h-4 w-4" />
              )}
              Print Check
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
