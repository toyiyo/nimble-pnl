import { useCallback, useEffect, useMemo, useState } from 'react';
import { format, parseISO } from 'date-fns';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Banknote, AlertTriangle, Trash2 } from 'lucide-react';
import { formatCurrencyFromCents } from '@/utils/tipPooling';
import type { TipSplitWithItems } from '@/hooks/useTipSplits';
import type {
  TipPayoutWithEmployee,
  CreatePayoutsInput,
} from '@/hooks/useTipPayouts';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PayoutEntry {
  employeeId: string;
  employeeName: string;
  allocatedCents: number;
  payoutCents: number;
  enabled: boolean;
  existingPayoutId: string | null;
}

export interface TipPayoutSheetProps {
  open: boolean;
  onClose: () => void;
  split: TipSplitWithItems;
  existingPayouts: TipPayoutWithEmployee[];
  onConfirm: (input: CreatePayoutsInput) => Promise<void>;
  onDeletePayout: (payoutId: string) => Promise<void>;
  isSubmitting: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildInitialEntries(
  split: TipSplitWithItems,
  existingPayouts: TipPayoutWithEmployee[],
): PayoutEntry[] {
  const payoutByEmployee = new Map(
    existingPayouts.map((p) => [p.employee_id, p]),
  );

  return split.items
    .filter((item) => item.amount > 0)
    .map((item) => {
      const existing = payoutByEmployee.get(item.employee_id);

      return {
        employeeId: item.employee_id,
        employeeName: item.employee?.name ?? 'Unknown',
        allocatedCents: item.amount,
        payoutCents: existing ? existing.amount : item.amount,
        enabled: existing ? true : existingPayouts.length === 0,
        existingPayoutId: existing?.id ?? null,
      };
    })
    .sort((a, b) => a.employeeName.localeCompare(b.employeeName));
}

function centsToDollars(cents: number): string {
  return (cents / 100).toFixed(2);
}

function dollarsToCents(value: string): number {
  const parsed = parseFloat(value);
  if (isNaN(parsed)) return 0;
  return Math.round(parsed * 100);
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function TipPayoutSheet({
  open,
  onClose,
  split,
  existingPayouts,
  onConfirm,
  onDeletePayout,
  isSubmitting,
}: TipPayoutSheetProps) {
  const [entries, setEntries] = useState<PayoutEntry[]>([]);
  // Track raw input strings so we don't reformat while typing
  const [rawInputs, setRawInputs] = useState<Record<string, string>>({});

  // Re-initialise entries when the sheet opens or the split/payouts change
  useEffect(() => {
    if (open) {
      setEntries(buildInitialEntries(split, existingPayouts));
      setRawInputs({});
    }
  }, [open, split, existingPayouts]);

  // ------ Derived values ---------------------------------------------------

  const totalPayoutCents = useMemo(
    () =>
      entries.reduce(
        (sum, e) => sum + (e.enabled ? e.payoutCents : 0),
        0,
      ),
    [entries],
  );

  const hasOverpayWarning = useMemo(
    () => entries.some((e) => e.enabled && e.payoutCents > e.allocatedCents),
    [entries],
  );

  const allEnabled = useMemo(
    () => entries.length > 0 && entries.every((e) => e.enabled),
    [entries],
  );

  // ------ Handlers ---------------------------------------------------------

  const toggleEmployee = useCallback((employeeId: string) => {
    setEntries((prev) =>
      prev.map((e) =>
        e.employeeId === employeeId ? { ...e, enabled: !e.enabled } : e,
      ),
    );
  }, []);

  const handlePayoutInputChange = useCallback(
    (employeeId: string, rawValue: string) => {
      setRawInputs((prev) => ({ ...prev, [employeeId]: rawValue }));
      const cents = dollarsToCents(rawValue);
      setEntries((prev) =>
        prev.map((e) =>
          e.employeeId === employeeId ? { ...e, payoutCents: cents } : e,
        ),
      );
    },
    [],
  );

  const handlePayoutInputBlur = useCallback(
    (employeeId: string) => {
      // On blur, clear raw input so it falls back to the formatted value
      setRawInputs((prev) => {
        const next = { ...prev };
        delete next[employeeId];
        return next;
      });
    },
    [],
  );

  const toggleAll = useCallback(() => {
    const newEnabled = !allEnabled;
    setEntries((prev) => prev.map((e) => ({ ...e, enabled: newEnabled })));
  }, [allEnabled]);

  const handleDeletePayout = useCallback(
    async (payoutId: string, employeeId: string) => {
      try {
        await onDeletePayout(payoutId);
        setEntries((prev) =>
          prev.map((e) =>
            e.employeeId === employeeId
              ? { ...e, existingPayoutId: null, enabled: false }
              : e,
          ),
        );
      } catch (err) {
        console.error('Failed to delete payout:', err);
      }
    },
    [onDeletePayout],
  );

  const handleConfirm = useCallback(async () => {
    const payoutEntries = entries
      .filter((e) => e.enabled && e.payoutCents > 0)
      .map((e) => ({
        employee_id: e.employeeId,
        amount: e.payoutCents,
      }));

    if (payoutEntries.length === 0) return;

    const input: CreatePayoutsInput = {
      tip_split_id: split.id,
      payout_date: split.split_date,
      payouts: payoutEntries,
    };

    try {
      await onConfirm(input);
      onClose();
    } catch (err) {
      console.error('Failed to confirm payouts:', err);
    }
  }, [entries, split.id, split.split_date, onConfirm, onClose]);

  // ------ Render -----------------------------------------------------------

  const formattedDate = format(parseISO(split.split_date), 'EEE, MMM d');

  return (
    <Sheet open={open} onOpenChange={(v) => !v && onClose()}>
      <SheetContent
        side="right"
        className="max-w-md w-full p-0 flex flex-col gap-0"
        hideCloseButton
      >
        {/* ------- Header ------- */}
        <SheetHeader className="px-6 pt-6 pb-4 border-b border-border/40 flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-muted/50 flex items-center justify-center">
              <Banknote className="h-5 w-5 text-foreground" />
            </div>
            <div>
              <SheetTitle className="text-[17px] font-semibold text-foreground">
                {existingPayouts.length > 0 ? 'Edit Tip Payouts' : 'Record Tip Payouts'}
              </SheetTitle>
              <SheetDescription className="text-[13px] text-muted-foreground mt-0.5">
                {formattedDate} &middot; {formatCurrencyFromCents(split.total_amount)} total
              </SheetDescription>
            </div>
          </div>
        </SheetHeader>

        {/* ------- Body ------- */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
          {/* Select All / Deselect All */}
          <div className="flex items-center justify-between">
            <span className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider">
              Employees
            </span>
            <button
              type="button"
              onClick={toggleAll}
              className="text-[13px] font-medium text-muted-foreground hover:text-foreground transition-colors"
            >
              {allEnabled ? 'Deselect All' : 'Select All'}
            </button>
          </div>

          {/* Employee rows */}
          <div className="space-y-2">
            {entries.map((entry) => (
              <div
                key={entry.employeeId}
                className="group rounded-xl border border-border/40 bg-background p-4 space-y-3"
              >
                {/* Top row: switch + name + trash */}
                <div className="flex items-center gap-3">
                  <Switch
                    checked={entry.enabled}
                    onCheckedChange={() => toggleEmployee(entry.employeeId)}
                    className="data-[state=checked]:bg-foreground"
                    aria-label={`Toggle payout for ${entry.employeeName}`}
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-[14px] font-medium text-foreground truncate">
                      {entry.employeeName}
                    </p>
                    <p className="text-[13px] text-muted-foreground">
                      Allocated: {formatCurrencyFromCents(entry.allocatedCents)}
                    </p>
                  </div>
                  {entry.existingPayoutId && (
                    <button
                      type="button"
                      onClick={() =>
                        handleDeletePayout(
                          entry.existingPayoutId!,
                          entry.employeeId,
                        )
                      }
                      className="text-destructive hover:text-destructive/80 transition-colors p-1"
                      aria-label={`Delete existing payout for ${entry.employeeName}`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </div>

                {/* Cash Paid input (when enabled) */}
                {entry.enabled && (
                  <div className="space-y-1.5 pl-10">
                    <label
                      htmlFor={`payout-${entry.employeeId}`}
                      className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider"
                    >
                      Cash Paid
                    </label>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[14px] text-muted-foreground">
                        $
                      </span>
                      <Input
                        id={`payout-${entry.employeeId}`}
                        type="number"
                        min={0}
                        step={0.01}
                        value={rawInputs[entry.employeeId] ?? centsToDollars(entry.payoutCents)}
                        onChange={(e) =>
                          handlePayoutInputChange(entry.employeeId, e.target.value)
                        }
                        onBlur={() => handlePayoutInputBlur(entry.employeeId)}
                        className="h-10 text-[14px] bg-muted/30 border-border/40 rounded-lg focus-visible:ring-1 focus-visible:ring-border pl-7"
                        aria-label={`Cash paid to ${entry.employeeName}`}
                      />
                    </div>
                    {entry.payoutCents > entry.allocatedCents && (
                      <p className="text-[12px] text-amber-600 dark:text-amber-400 flex items-center gap-1">
                        <AlertTriangle className="h-3 w-3" />
                        Exceeds allocation by{' '}
                        {formatCurrencyFromCents(
                          entry.payoutCents - entry.allocatedCents,
                        )}
                      </p>
                    )}
                  </div>
                )}
              </div>
            ))}

            {entries.length === 0 && (
              <p className="text-[13px] text-muted-foreground text-center py-8">
                No employees with tip allocations for this day.
              </p>
            )}
          </div>
        </div>

        {/* ------- Footer ------- */}
        <div className="flex-shrink-0 border-t border-border/40 px-6 py-4 space-y-3">
          {/* Total */}
          <div className="flex items-center justify-between">
            <span className="text-[14px] font-medium text-foreground">
              Total Payout
            </span>
            <span className="text-[17px] font-semibold text-foreground">
              {formatCurrencyFromCents(totalPayoutCents)}
            </span>
          </div>

          {/* Overpay warning banner */}
          {hasOverpayWarning && (
            <div className="flex items-center gap-2 p-2.5 rounded-lg bg-amber-500/10 border border-amber-500/20">
              <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400 flex-shrink-0" />
              <p className="text-[13px] text-amber-600 dark:text-amber-400">
                One or more payouts exceed their allocation.
              </p>
            </div>
          )}

          {/* Action buttons */}
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="ghost"
              onClick={onClose}
              className="h-9 px-4 rounded-lg text-[13px] font-medium text-muted-foreground hover:text-foreground flex-1"
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={handleConfirm}
              disabled={isSubmitting || totalPayoutCents === 0}
              className="h-9 px-4 rounded-lg bg-foreground text-background hover:bg-foreground/90 text-[13px] font-medium flex-1"
            >
              {isSubmitting ? 'Saving...' : 'Confirm'}
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
