import { useEffect, useState } from 'react';

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
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';

import { Info, Shield } from 'lucide-react';

import { useStaffingSettings } from '@/hooks/useStaffingSettings';
import { useInvalidateShiftProtection } from '@/hooks/useShiftProtection';
import { useToast } from '@/hooks/use-toast';

import type { ProtectionMode } from '@/lib/shiftProtection';

interface ShiftProtectionSettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  restaurantId: string;
}

interface DraftRules {
  trade_deadline_mode: ProtectionMode;
  trade_deadline_hours: number;
  trade_auto_expire: boolean;
  timeoff_notice_mode: ProtectionMode;
  timeoff_notice_days: number;
  timeoff_sameday_mode: ProtectionMode;
  timeoff_sameday_limit: number;
  coverage_floor_mode: ProtectionMode;
}

const MODE_OPTIONS: { value: ProtectionMode; label: string }[] = [
  { value: 'off', label: 'Off' },
  { value: 'warn', label: 'Warn' },
  { value: 'block', label: 'Block' },
];

function ModePicker({
  id,
  value,
  onChange,
}: Readonly<{ id: string; value: ProtectionMode; onChange: (mode: ProtectionMode) => void }>) {
  return (
    <RadioGroup
      value={value}
      onValueChange={(mode: ProtectionMode) => onChange(mode)}
      className="flex items-center gap-3"
      aria-label={`Rule mode for ${id}`}
    >
      {MODE_OPTIONS.map((option) => (
        <div key={option.value} className="flex items-center gap-1.5">
          <RadioGroupItem value={option.value} id={`${id}-${option.value}`} />
          <Label htmlFor={`${id}-${option.value}`} className="text-[13px] font-medium cursor-pointer">
            {option.label}
          </Label>
        </div>
      ))}
    </RadioGroup>
  );
}

function RuleRow({
  title,
  description,
  children,
}: Readonly<{ title: string; description: string; children: React.ReactNode }>) {
  return (
    <div className="px-4 py-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4 border-b border-border/40 last:border-b-0">
      <div className="min-w-0">
        <div className="text-[14px] font-medium text-foreground">{title}</div>
        <div className="text-[13px] text-muted-foreground mt-0.5">{description}</div>
      </div>
      <div className="flex items-center gap-3 shrink-0">{children}</div>
    </div>
  );
}

/**
 * Off/Warn/Block rules for shift trades and time off. Reads and writes
 * staffing_settings; a save also invalidates the shift-protection query
 * so the warning panels never show stale rules.
 */
export const ShiftProtectionSettingsDialog = ({
  open,
  onOpenChange,
  restaurantId,
}: ShiftProtectionSettingsDialogProps) => {
  const { effectiveSettings, isLoading, updateSettings, isSaving } =
    useStaffingSettings(restaurantId);
  const invalidateShiftProtection = useInvalidateShiftProtection();
  const { toast } = useToast();

  const [draft, setDraft] = useState<DraftRules | null>(null);

  // Seed the draft when the dialog opens (and when the row arrives).
  useEffect(() => {
    if (!open || isLoading) return;
    setDraft({
      trade_deadline_mode: effectiveSettings.trade_deadline_mode,
      trade_deadline_hours: effectiveSettings.trade_deadline_hours,
      trade_auto_expire: effectiveSettings.trade_auto_expire,
      timeoff_notice_mode: effectiveSettings.timeoff_notice_mode,
      timeoff_notice_days: effectiveSettings.timeoff_notice_days,
      timeoff_sameday_mode: effectiveSettings.timeoff_sameday_mode,
      timeoff_sameday_limit: effectiveSettings.timeoff_sameday_limit,
      coverage_floor_mode: effectiveSettings.coverage_floor_mode,
    });
    // Re-seed only on open; a background refetch must not clobber edits.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, isLoading]);

  const numbersValid =
    !!draft &&
    Number.isInteger(draft.trade_deadline_hours) && draft.trade_deadline_hours > 0 &&
    Number.isInteger(draft.timeoff_notice_days) && draft.timeoff_notice_days > 0 &&
    Number.isInteger(draft.timeoff_sameday_limit) && draft.timeoff_sameday_limit > 0;

  const handleSave = async () => {
    if (!draft || !numbersValid) return;
    try {
      await updateSettings(draft);
      invalidateShiftProtection(restaurantId);
      toast({
        title: 'Shift protection saved',
        description: 'The rules apply to new requests now.',
      });
      onOpenChange(false);
    } catch (error) {
      toast({
        title: 'Error saving the rules',
        description: error instanceof Error ? error.message : 'Save failed',
        variant: 'destructive',
      });
    }
  };

  const setField = <K extends keyof DraftRules>(key: K, value: DraftRules[K]) =>
    setDraft((prev) => (prev ? { ...prev, [key]: value } : prev));

  const numberInput = (
    id: string,
    value: number,
    onChange: (n: number) => void,
    unit: string
  ) => (
    <div className="flex items-center gap-1.5">
      <Input
        id={id}
        type="number"
        min={1}
        value={Number.isNaN(value) ? '' : value}
        onChange={(e) => onChange(parseInt(e.target.value, 10))}
        className="h-9 w-16 text-[14px] bg-muted/30 border-border/40 rounded-lg text-center"
        aria-label={`${unit} value`}
      />
      <span className="text-[12px] text-muted-foreground">{unit}</span>
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto p-0 gap-0 border-border/40">
        <DialogHeader className="px-6 pt-6 pb-4 border-b border-border/40">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-muted/50 flex items-center justify-center">
              <Shield className="h-5 w-5 text-foreground" />
            </div>
            <div>
              <DialogTitle className="text-[17px] font-semibold text-foreground">
                Shift Protection
              </DialogTitle>
              <DialogDescription className="text-[13px] text-muted-foreground mt-0.5">
                Warn employees or block requests when coverage is at risk.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="px-6 py-5 space-y-5">
          {isLoading || !draft ? (
            <div className="space-y-3">
              <Skeleton className="h-16 w-full rounded-xl" />
              <Skeleton className="h-16 w-full rounded-xl" />
              <Skeleton className="h-16 w-full rounded-xl" />
            </div>
          ) : (
            <>
              <div className="rounded-xl border border-border/40 bg-muted/30 overflow-hidden">
                <div className="px-4 py-3 border-b border-border/40 bg-muted/50">
                  <h3 className="text-[13px] font-semibold text-foreground">Shift Trades</h3>
                </div>
                <RuleRow
                  title="Trade deadline"
                  description="Applies to trades posted or accepted inside the window before a shift starts."
                >
                  {numberInput('trade-deadline-hours', draft.trade_deadline_hours, (n) => setField('trade_deadline_hours', n), 'hours')}
                  <ModePicker id="trade-deadline" value={draft.trade_deadline_mode} onChange={(m) => setField('trade_deadline_mode', m)} />
                </RuleRow>
                <RuleRow
                  title="Auto-expire unaccepted trades"
                  description="Cancel an open trade when the shift starts. The employee keeps the shift."
                >
                  <Switch
                    checked={draft.trade_auto_expire}
                    onCheckedChange={(checked) => setField('trade_auto_expire', checked)}
                    className="data-[state=checked]:bg-foreground"
                    aria-label="Auto-expire unaccepted trades"
                  />
                </RuleRow>
              </div>

              <div className="rounded-xl border border-border/40 bg-muted/30 overflow-hidden">
                <div className="px-4 py-3 border-b border-border/40 bg-muted/50">
                  <h3 className="text-[13px] font-semibold text-foreground">Time Off</h3>
                </div>
                <RuleRow
                  title="Minimum notice"
                  description="Applies to requests that start inside the notice period."
                >
                  {numberInput('timeoff-notice-days', draft.timeoff_notice_days, (n) => setField('timeoff_notice_days', n), 'days')}
                  <ModePicker id="timeoff-notice" value={draft.timeoff_notice_mode} onChange={(m) => setField('timeoff_notice_mode', m)} />
                </RuleRow>
                <RuleRow
                  title="Coverage floor"
                  description="Applies when an approval drops a day below the template staff count."
                >
                  <ModePicker id="coverage-floor" value={draft.coverage_floor_mode} onChange={(m) => setField('coverage_floor_mode', m)} />
                </RuleRow>
                <RuleRow
                  title="Same-day limit"
                  description="Applies past this many approved requests per day, per position."
                >
                  {numberInput('timeoff-sameday-limit', draft.timeoff_sameday_limit, (n) => setField('timeoff_sameday_limit', n), 'requests')}
                  <ModePicker id="timeoff-sameday" value={draft.timeoff_sameday_mode} onChange={(m) => setField('timeoff_sameday_mode', m)} />
                </RuleRow>
              </div>

              <div className="flex items-start gap-2.5 p-3 rounded-lg bg-info/5 border border-info/20">
                <Info className="h-4 w-4 text-info shrink-0 mt-0.5" aria-hidden="true" />
                <p className="text-[13px] text-foreground leading-relaxed">
                  <span className="font-semibold">Warn</span> shows the rule and lets the request
                  through — you see the same flag in the approval queue.{' '}
                  <span className="font-semibold">Block</span> stops the employee request; managers
                  can still submit one on their behalf.
                </p>
              </div>

              {!numbersValid && (
                <p className="text-[13px] text-destructive" role="alert">
                  Every threshold needs a whole number above zero.
                </p>
              )}

              <div className="flex justify-end gap-2">
                <Button
                  type="button"
                  variant="outline"
                  className="h-9 px-4 rounded-lg text-[13px] font-medium"
                  onClick={() => onOpenChange(false)}
                  disabled={isSaving}
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  className="h-9 px-4 rounded-lg bg-foreground text-background hover:bg-foreground/90 text-[13px] font-medium"
                  onClick={handleSave}
                  disabled={!numbersValid || isSaving}
                >
                  {isSaving ? 'Saving…' : 'Save Settings'}
                </Button>
              </div>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};
