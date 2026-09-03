import { useEffect, useState } from 'react';
import * as SelectPrimitive from '@radix-ui/react-select';
import { Check, Settings2, X } from 'lucide-react';
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
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { useCreateDepositMatchRule, useUpdateDepositMatchRule } from '@/hooks/useDepositMatch';
import {
  bankLabel,
  cardTenderListKey,
  DEPOSIT_MATCH_SOURCE_DEFAULTS,
  ruleDefaultsNote,
  sourceDescriptorLabel,
  suggestedBankForSource,
} from '@/lib/depositMatchUi';
import type { DepositMatchBank, DepositMatchRule } from '@/types/depositMatch';

/**
 * A `SelectItem` for one bank option. Built on `SelectPrimitive.Item`
 * directly (not the shared `SelectItem`) because the shadcn item mirrors
 * its children into the closed trigger via `ItemText` — a `Suggested`
 * badge placed there would leak into the trigger. Here `ItemText` holds
 * only the plain label, and the badge is a decorative sibling.
 */
function BankSelectItem({ bank, suggested }: { bank: DepositMatchBank; suggested: boolean }) {
  return (
    <SelectPrimitive.Item
      value={bank.connected_bank_id}
      className="relative flex w-full cursor-default select-none items-center justify-between gap-2 rounded-sm py-1.5 pl-8 pr-2 text-sm outline-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 focus:bg-accent focus:text-accent-foreground"
    >
      <span className="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
        <SelectPrimitive.ItemIndicator>
          <Check className="h-4 w-4" />
        </SelectPrimitive.ItemIndicator>
      </span>
      <SelectPrimitive.ItemText>{bankLabel(bank)}</SelectPrimitive.ItemText>
      {suggested && (
        <span aria-hidden="true" className="text-[11px] px-1.5 py-0.5 rounded-md bg-muted text-foreground">
          Suggested
        </span>
      )}
    </SelectPrimitive.Item>
  );
}

interface SetupDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  restaurantId: string | null | undefined;
  banks: DepositMatchBank[];
  /** Rule being edited, or null to create a new one. */
  rule: DepositMatchRule | null;
  /**
   * The id of the rule the caller intends to edit, or null to create a new
   * one. This is the source of truth for edit intent — NOT `Boolean(rule)`.
   * `rule` can be null while `ruleId` is set (the fetch is still loading, or
   * it failed), and treating that as "create" would silently insert a
   * duplicate row instead of updating the one the user opened (found in
   * review, coderabbitai).
   */
  ruleId?: string | null;
  /** True while the edit target's rule row is still loading. */
  isLoadingRule?: boolean;
  /** True when the edit target's rule row failed to load. */
  ruleLoadError?: boolean;
  /** Called after a create or update commits, so the page can force a refresh. */
  onSaved?: () => void;
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
  source_config: Record<string, unknown>;
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
      source_config: rule.source_config,
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
    active: defaults.active,
    source_config: defaults.source_config,
  };
}

/** Reads a card tender list editor's list values out of `source_config`. */
function tenderListValues(sourceConfig: Record<string, unknown>, key: string): string[] {
  const raw = sourceConfig[key];
  return Array.isArray(raw) ? raw.filter((value): value is string => typeof value === 'string') : [];
}

/**
 * Creates or edits a `deposit_match_rules` row. Prefilling a source's
 * defaults marks the non-measured ones "Suggested values — check them
 * against your bank" (design: only `focus` and `toast` come from measured
 * production behavior).
 */
export function SetupDialog({
  open,
  onOpenChange,
  restaurantId,
  banks,
  rule,
  ruleId = null,
  isLoadingRule,
  ruleLoadError,
  onSaved,
}: SetupDialogProps) {
  const [form, setForm] = useState<FormState>(() => initialFormState(rule));
  const [tenderInput, setTenderInput] = useState('');
  const createMutation = useCreateDepositMatchRule();
  const updateMutation = useUpdateDepositMatchRule(restaurantId);
  const isEdit = Boolean(ruleId);
  const isPending = createMutation.isPending || updateMutation.isPending;

  useEffect(() => {
    if (open) {
      setForm(initialFormState(rule));
      setTenderInput('');
    }
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
      active: defaults ? defaults.active : prev.active,
      source_config: defaults ? defaults.source_config : prev.source_config,
    }));
    setTenderInput('');
  };

  const suggestedBank = suggestedBankForSource(banks, form.pos_source);
  const showSuggestionPanel = Boolean(suggestedBank) && suggestedBank!.connected_bank_id !== form.connected_bank_id;

  const tenderKey = cardTenderListKey(form.pos_source);
  const tenderValues = tenderKey ? tenderListValues(form.source_config, tenderKey) : [];

  const addTenderValue = () => {
    const value = tenderInput.trim();
    if (!tenderKey || !value || tenderValues.includes(value)) return;
    setForm((prev) => ({
      ...prev,
      source_config: { ...prev.source_config, [tenderKey]: [...tenderValues, value] },
    }));
    setTenderInput('');
  };

  const removeTenderValue = (value: string) => {
    if (!tenderKey) return;
    setForm((prev) => ({
      ...prev,
      source_config: { ...prev.source_config, [tenderKey]: tenderValues.filter((v) => v !== value) },
    }));
  };

  const handleSubmit = () => {
    if (!restaurantId) return;
    // Edit intent with no loaded rule (a failed or still-loading fetch)
    // must never fall through to create — that would insert a duplicate
    // instead of updating the row the user opened.
    if (isEdit && !rule) return;
    if (DEPOSIT_MATCH_SOURCE_DEFAULTS[form.pos_source]?.unsupported) {
      toast.error('This source has no normalized card-tender rows yet. You cannot save a rule for it.');
      return;
    }
    if (!form.connected_bank_id) {
      toast.error('Pick the bank that receives this deposit.');
      return;
    }

    // Fields shared by create and update. `restaurant_id` is NOT here: it
    // belongs only on the create payload. `DepositMatchRuleUpdate` omits it
    // by type (a rule's restaurant never changes after create), but that
    // guard only fires against an object literal — spreading one shared
    // `const` into both calls would let it ride along into every update
    // silently, past the type check.
    const ruleFields = {
      pos_source: form.pos_source,
      rail: 'card' as const,
      connected_bank_id: form.connected_bank_id,
      settlement: form.settlement,
      lag_days_min: Number(form.lag_days_min),
      lag_days_max: Number(form.lag_days_max),
      fee_pct_min: Number(form.fee_pct_min),
      fee_pct_max: Number(form.fee_pct_max),
      source_config: form.source_config,
      active: form.active,
    };

    const onSettled = {
      onSuccess: () => {
        toast.success(isEdit ? 'You updated the rule.' : 'You added the rule.');
        onOpenChange(false);
        onSaved?.();
      },
      onError: (error: Error) => {
        toast.error(`The save did not work: ${error.message}`);
      },
    };

    if (isEdit && rule) {
      updateMutation.mutate({ id: rule.id, update: ruleFields }, onSettled);
    } else {
      createMutation.mutate({ restaurant_id: restaurantId, ...ruleFields }, onSettled);
    }
  };

  const note = ruleDefaultsNote(form.pos_source);
  const unsupported = DEPOSIT_MATCH_SOURCE_DEFAULTS[form.pos_source]?.unsupported;

  let submitLabel: string;
  if (isPending) {
    submitLabel = 'Saving…';
  } else if (isEdit) {
    submitLabel = 'Save changes';
  } else {
    submitLabel = 'Add rule';
  }

  if (isLoadingRule) {
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
                  Edit deposit-match rule
                </DialogTitle>
                <DialogDescription className="text-[13px] text-muted-foreground mt-0.5">
                  The rule is loading.
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>
          <div className="px-6 py-5 space-y-4">
            <Skeleton className="h-10 w-full rounded-lg" />
            <Skeleton className="h-10 w-full rounded-lg" />
            <Skeleton className="h-24 w-full rounded-lg" />
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  if (isEdit && (ruleLoadError || !rule)) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-2xl p-0 gap-0 border-border/40">
          <DialogHeader className="px-6 pt-6 pb-4 border-b border-border/40">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-xl bg-muted/50 flex items-center justify-center">
                <Settings2 className="h-5 w-5 text-foreground" aria-hidden="true" />
              </div>
              <div>
                <DialogTitle className="text-[17px] font-semibold text-foreground">
                  Edit deposit-match rule
                </DialogTitle>
                <DialogDescription className="text-[13px] text-muted-foreground mt-0.5">
                  The rule did not load.
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>
          <div className="px-6 py-5 space-y-4">
            <p className="text-[13px] text-muted-foreground">
              Close this dialog and open the rule again from its card.
            </p>
          </div>
          <DialogFooter className="px-6 py-4 border-t border-border/40">
            <Button
              className="h-9 px-4 rounded-lg text-[13px] font-medium text-muted-foreground hover:text-foreground"
              onClick={() => onOpenChange(false)}
            >
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

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
                <Label htmlFor="deposit_match_pos_source" className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider">
                  POS source
                </Label>
                <Select
                  value={form.pos_source}
                  onValueChange={applySourceDefaults}
                  disabled={isEdit}
                >
                  <SelectTrigger id="deposit_match_pos_source" className="h-10 text-[14px] bg-muted/30 border-border/40 rounded-lg">
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
                <Label htmlFor="deposit_match_bank" className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider">
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
                    <SelectTrigger id="deposit_match_bank" className="h-10 text-[14px] bg-muted/30 border-border/40 rounded-lg">
                      <SelectValue placeholder="Pick a bank" />
                    </SelectTrigger>
                    <SelectContent>
                      {banks.map((bank) => (
                        <BankSelectItem
                          key={bank.connected_bank_id}
                          bank={bank}
                          suggested={suggestedBank?.connected_bank_id === bank.connected_bank_id}
                        />
                      ))}
                    </SelectContent>
                  </Select>
                )}
                {showSuggestionPanel && (
                  <output className="flex items-center justify-between gap-3 p-2.5 rounded-lg bg-amber-500/10 border border-amber-500/20">
                    <p className="text-[13px] text-amber-700 dark:text-amber-400">
                      We see {sourceDescriptorLabel(form.pos_source)} deposits in {bankLabel(suggestedBank!)}.
                    </p>
                    <Button
                      type="button"
                      onClick={() =>
                        setForm((prev) => ({ ...prev, connected_bank_id: suggestedBank!.connected_bank_id }))
                      }
                      className="h-8 px-3 rounded-lg text-[13px] font-medium text-amber-700 dark:text-amber-400 hover:text-amber-800 dark:hover:text-amber-300"
                    >
                      Use this bank
                    </Button>
                  </output>
                )}
              </div>
              <div className="flex items-center justify-between rounded-lg border border-border/40 bg-background p-3">
                <div className="space-y-0.5">
                  <Label htmlFor="deposit_match_active" className="text-[14px] font-medium text-foreground cursor-pointer">
                    Active
                  </Label>
                  <p className="text-[13px] text-muted-foreground">
                    An inactive rule skips the refresh. Its items show as incomplete.
                  </p>
                </div>
                <Switch
                  id="deposit_match_active"
                  checked={form.active}
                  onCheckedChange={(checked) => setForm((prev) => ({ ...prev, active: checked }))}
                  className="data-[state=checked]:bg-foreground"
                  aria-label="Turn this deposit-match rule on or off"
                />
              </div>
            </div>
          </div>

          {tenderKey && (
            <div className="rounded-xl border border-border/40 bg-muted/30 overflow-hidden">
              <div className="px-4 py-3 border-b border-border/40 bg-muted/50">
                <h3 className="text-[13px] font-semibold text-foreground">Card tenders</h3>
              </div>
              <div className="p-4 space-y-3">
                <p className="text-[13px] text-muted-foreground">
                  The engine sums only these values. An empty list stops the rule with an error.
                </p>
                <div className="flex flex-wrap gap-2">
                  {tenderValues.length === 0 ? (
                    <p className="text-[13px] text-muted-foreground">No values yet. Add at least one below.</p>
                  ) : (
                    tenderValues.map((value) => (
                      <span
                        key={value}
                        className="inline-flex items-center gap-1 text-[13px] px-2.5 py-1 rounded-md bg-muted text-foreground"
                      >
                        {value}
                        <button
                          type="button"
                          onClick={() => removeTenderValue(value)}
                          aria-label={`Remove ${value}`}
                          className="text-muted-foreground hover:text-foreground"
                        >
                          <X className="h-3 w-3" aria-hidden="true" />
                        </button>
                      </span>
                    ))
                  )}
                </div>
                <div className="flex gap-2">
                  <Input
                    value={tenderInput}
                    onChange={(event) => setTenderInput(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault();
                        addTenderValue();
                      }
                    }}
                    placeholder="Add a value"
                    aria-label="New card tender value"
                    className="h-10 text-[14px] bg-muted/30 border-border/40 rounded-lg"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={addTenderValue}
                    className="h-10 px-4 rounded-lg text-[13px] font-medium text-muted-foreground hover:text-foreground"
                  >
                    Add
                  </Button>
                </div>
              </div>
            </div>
          )}

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
                  <Label htmlFor="deposit_match_lag_min" className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider">
                    Lag days, min
                  </Label>
                  <Input
                    id="deposit_match_lag_min"
                    type="number"
                    value={form.lag_days_min}
                    onChange={(event) => setForm((prev) => ({ ...prev, lag_days_min: event.target.value }))}
                    className="h-10 text-[14px] bg-muted/30 border-border/40 rounded-lg"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="deposit_match_lag_max" className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider">
                    Lag days, max
                  </Label>
                  <Input
                    id="deposit_match_lag_max"
                    type="number"
                    value={form.lag_days_max}
                    onChange={(event) => setForm((prev) => ({ ...prev, lag_days_max: event.target.value }))}
                    className="h-10 text-[14px] bg-muted/30 border-border/40 rounded-lg"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="deposit_match_fee_min" className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider">
                    Fee %, min
                  </Label>
                  <Input
                    id="deposit_match_fee_min"
                    type="number"
                    step="0.1"
                    value={form.fee_pct_min}
                    onChange={(event) => setForm((prev) => ({ ...prev, fee_pct_min: event.target.value }))}
                    className="h-10 text-[14px] bg-muted/30 border-border/40 rounded-lg"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="deposit_match_fee_max" className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider">
                    Fee %, max
                  </Label>
                  <Input
                    id="deposit_match_fee_max"
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
            disabled={isPending || unsupported}
          >
            {submitLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
