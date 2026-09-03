import { useEffect, useState } from 'react';
import { Settings2 } from 'lucide-react';
import { toast } from 'sonner';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useCreateDepositMatchRule, useUpdateDepositMatchRule } from '@/hooks/useDepositMatch';
import { DEPOSIT_MATCH_SOURCE_DEFAULTS, ruleDefaultsNote } from '@/lib/depositMatchUi';
import type { DepositMatchBank, DepositMatchRule } from '@/types/depositMatch';

interface SetupDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  restaurantId: string | null | undefined;
  banks: DepositMatchBank[];
  /** Rule being edited, or null to create a new one. */
  rule: DepositMatchRule | null;
}

interface FormState {
  pos_source: string;
  connected_bank_id: string;
  settlement: 'gross' | 'net';
  lag_days_min: string;
  lag_days_max: string;
  fee_pct_min: string;
  fee_pct_max: string;
  active: boolean;
}

const SOURCE_OPTIONS = Object.entries(DEPOSIT_MATCH_SOURCE_DEFAULTS);

function initialFormState(rule: DepositMatchRule | null): FormState {
  if (rule) {
    return {
      pos_source: rule.pos_source,
      connected_bank_id: rule.connected_bank_id,
      settlement: rule.settlement,
      lag_days_min: String(rule.lag_days_min),
      lag_days_max: String(rule.lag_days_max),
      fee_pct_min: String(rule.fee_pct_min),
      fee_pct_max: String(rule.fee_pct_max),
      active: rule.active,
    };
  }
  const first = SOURCE_OPTIONS[0];
  const defaults = first[1];
  return {
    pos_source: first[0],
    connected_bank_id: '',
    settlement: defaults.settlement,
    lag_days_min: String(defaults.lag_days_min),
    lag_days_max: String(defaults.lag_days_max),
    fee_pct_min: String(defaults.fee_pct_min),
    fee_pct_max: String(defaults.fee_pct_max),
    active: true,
  };
}

/**
 * Creates or edits a `deposit_match_rules` row. Prefilling a source's
 * defaults marks the non-measured ones "Suggested values — check them
 * against your bank" (design: only `focus` and `toast` come from measured
 * production behavior).
 */
export function SetupDialog({ open, onOpenChange, restaurantId, banks, rule }: SetupDialogProps) {
  const [form, setForm] = useState<FormState>(() => initialFormState(rule));
  const createMutation = useCreateDepositMatchRule();
  const updateMutation = useUpdateDepositMatchRule(restaurantId);
  const isEdit = Boolean(rule);
  const isPending = createMutation.isPending || updateMutation.isPending;

  useEffect(() => {
    if (open) setForm(initialFormState(rule));
  }, [open, rule]);

  const applySourceDefaults = (pos_source: string) => {
    const defaults = DEPOSIT_MATCH_SOURCE_DEFAULTS[pos_source];
    setForm((prev) => ({
      ...prev,
      pos_source,
      settlement: defaults?.settlement ?? prev.settlement,
      lag_days_min: defaults ? String(defaults.lag_days_min) : prev.lag_days_min,
      lag_days_max: defaults ? String(defaults.lag_days_max) : prev.lag_days_max,
      fee_pct_min: defaults ? String(defaults.fee_pct_min) : prev.fee_pct_min,
      fee_pct_max: defaults ? String(defaults.fee_pct_max) : prev.fee_pct_max,
    }));
  };

  const handleSubmit = () => {
    if (!restaurantId) return;
    if (!form.connected_bank_id) {
      toast.error('Pick the bank that receives this deposit.');
      return;
    }

    const payload = {
      restaurant_id: restaurantId,
      pos_source: form.pos_source,
      rail: 'card' as const,
      connected_bank_id: form.connected_bank_id,
      settlement: form.settlement,
      lag_days_min: Number(form.lag_days_min),
      lag_days_max: Number(form.lag_days_max),
      fee_pct_min: Number(form.fee_pct_min),
      fee_pct_max: Number(form.fee_pct_max),
      source_config: DEPOSIT_MATCH_SOURCE_DEFAULTS[form.pos_source]?.source_config ?? {},
      active: form.active,
    };

    const onSettled = {
      onSuccess: () => {
        toast.success(isEdit ? 'You updated the rule.' : 'You added the rule.');
        onOpenChange(false);
      },
      onError: (error: Error) => {
        toast.error(`The save did not work: ${error.message}`);
      },
    };

    if (isEdit && rule) {
      updateMutation.mutate({ id: rule.id, update: payload }, onSettled);
    } else {
      createMutation.mutate(payload, onSettled);
    }
  };

  const note = ruleDefaultsNote(form.pos_source);
  const unsupported = DEPOSIT_MATCH_SOURCE_DEFAULTS[form.pos_source]?.unsupported;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto p-0 gap-0 border-border/40">
        <DialogHeader className="px-6 pt-6 pb-4 border-b border-border/40">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-muted/50 flex items-center justify-center">
              <Settings2 className="h-5 w-5 text-foreground" aria-hidden="true" />
            </div>
            <div>
              <DialogTitle className="text-[17px] font-semibold text-foreground">
                {isEdit ? 'Edit deposit-match rule' : 'Add deposit-match rule'}
              </DialogTitle>
              <DialogDescription className="text-[13px] text-muted-foreground mt-0.5">
                Tell the engine how this POS source deposits into your bank.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>
        <div className="px-6 py-5 space-y-5">
          <div className="rounded-xl border border-border/40 bg-muted/30 overflow-hidden">
            <div className="px-4 py-3 border-b border-border/40 bg-muted/50">
              <h3 className="text-[13px] font-semibold text-foreground">Source and bank</h3>
            </div>
            <div className="p-4 space-y-4">
              <div className="space-y-1.5">
                <Label className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider">
                  POS source
                </Label>
                <Select
                  value={form.pos_source}
                  onValueChange={applySourceDefaults}
                  disabled={isEdit}
                >
                  <SelectTrigger className="h-10 text-[14px] bg-muted/30 border-border/40 rounded-lg">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {SOURCE_OPTIONS.map(([source]) => (
                      <SelectItem key={source} value={source}>
                        {source}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {unsupported && (
                  <p className="text-[12px] text-muted-foreground">
                    This source has no normalized card-tender rows yet. It stays unsupported until an adapter ships.
                  </p>
                )}
              </div>
              <div className="space-y-1.5">
                <Label className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider">
                  Bank account
                </Label>
                {banks.length === 0 ? (
                  <p className="text-[13px] text-muted-foreground">
                    Connect a bank on the Banking page first.
                  </p>
                ) : (
                  <Select
                    value={form.connected_bank_id}
                    onValueChange={(value) => setForm((prev) => ({ ...prev, connected_bank_id: value }))}
                  >
                    <SelectTrigger className="h-10 text-[14px] bg-muted/30 border-border/40 rounded-lg">
                      <SelectValue placeholder="Pick a bank" />
                    </SelectTrigger>
                    <SelectContent>
                      {banks.map((bank) => (
                        <SelectItem key={bank.connected_bank_id} value={bank.connected_bank_id}>
                          {bank.institution_name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-border/40 bg-muted/30 overflow-hidden">
            <div className="px-4 py-3 border-b border-border/40 bg-muted/50">
              <h3 className="text-[13px] font-semibold text-foreground">Settlement</h3>
            </div>
            <div className="p-4 space-y-4">
              {note && (
                <p className="text-[12px] text-amber-700 dark:text-amber-400">{note}</p>
              )}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider">
                    Lag days, min
                  </Label>
                  <Input
                    type="number"
                    value={form.lag_days_min}
                    onChange={(event) => setForm((prev) => ({ ...prev, lag_days_min: event.target.value }))}
                    className="h-10 text-[14px] bg-muted/30 border-border/40 rounded-lg"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider">
                    Lag days, max
                  </Label>
                  <Input
                    type="number"
                    value={form.lag_days_max}
                    onChange={(event) => setForm((prev) => ({ ...prev, lag_days_max: event.target.value }))}
                    className="h-10 text-[14px] bg-muted/30 border-border/40 rounded-lg"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider">
                    Fee %, min
                  </Label>
                  <Input
                    type="number"
                    step="0.1"
                    value={form.fee_pct_min}
                    onChange={(event) => setForm((prev) => ({ ...prev, fee_pct_min: event.target.value }))}
                    className="h-10 text-[14px] bg-muted/30 border-border/40 rounded-lg"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider">
                    Fee %, max
                  </Label>
                  <Input
                    type="number"
                    step="0.1"
                    value={form.fee_pct_max}
                    onChange={(event) => setForm((prev) => ({ ...prev, fee_pct_max: event.target.value }))}
                    className="h-10 text-[14px] bg-muted/30 border-border/40 rounded-lg"
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
        <DialogFooter className="px-6 pb-6">
          <Button
            variant="ghost"
            className="h-9 px-4 rounded-lg text-[13px] font-medium text-muted-foreground hover:text-foreground"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            className="h-9 px-4 rounded-lg bg-foreground text-background hover:bg-foreground/90 text-[13px] font-medium"
            onClick={handleSubmit}
            disabled={isPending}
          >
            {isPending ? 'Saving…' : isEdit ? 'Save changes' : 'Add rule'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
