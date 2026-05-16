import { useMemo, useState } from 'react';
import { useRestaurantContext } from '@/contexts/RestaurantContext';
import { useCurrentEmployee } from '@/hooks/useTimePunches';
import { useEmployeePins, useUpsertEmployeePin } from '@/hooks/useKioskPins';
import { generateNumericPin, isSimpleSequence } from '@/utils/kiosk';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { KeyRound, Copy, Check, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatDistanceToNow } from 'date-fns';

const MIN_LENGTH = 4;

function EmployeePin() {
  const { selectedRestaurant } = useRestaurantContext();
  const restaurantId = selectedRestaurant?.restaurant_id || null;
  const { employee, loading: empLoading } = useCurrentEmployee(restaurantId);
  const { pins, loading: pinsLoading } = useEmployeePins(restaurantId);
  const upsertPin = useUpsertEmployeePin();

  const myPin = useMemo(
    () => pins.find((p) => p.employee_id === employee?.id) ?? null,
    [pins, employee?.id]
  );

  const [tab, setTab] = useState<'generate' | 'type'>('generate');
  const [revealed, setRevealed] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [typed, setTyped] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);

  const minLength = myPin?.min_length ?? MIN_LENGTH;
  const typedTooShort = typed.length > 0 && typed.length < minLength;
  const typedSimple = typed.length >= 3 && isSimpleSequence(typed);
  const confirmMismatch = confirm.length > 0 && confirm !== typed;
  const canSubmitTyped =
    typed.length >= minLength && !typedSimple && confirm === typed && !upsertPin.isPending;

  if (empLoading || pinsLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-7 w-32" />
        <Skeleton className="h-40 w-full rounded-xl" />
      </div>
    );
  }

  if (!restaurantId || !employee) {
    return (
      <div className="text-[13px] text-muted-foreground">
        Pick a restaurant from the switcher to manage your kiosk PIN.
      </div>
    );
  }

  const generate = async () => {
    setError(null);
    let candidate = generateNumericPin(minLength);
    let attempts = 0;
    while (isSimpleSequence(candidate) && attempts < 6) {
      candidate = generateNumericPin(minLength);
      attempts++;
    }
    try {
      const result = await upsertPin.mutateAsync({
        restaurant_id: restaurantId,
        employee_id: employee.id,
        pin: candidate,
        min_length: minLength,
        force_reset: false,
        actor: 'self',
      });
      setRevealed(result.pin);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save PIN.');
    }
  };

  const saveTyped = async () => {
    if (!canSubmitTyped) return;
    setError(null);
    try {
      const result = await upsertPin.mutateAsync({
        restaurant_id: restaurantId,
        employee_id: employee.id,
        pin: typed,
        min_length: minLength,
        force_reset: false,
        actor: 'self',
      });
      setRevealed(result.pin);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save PIN.');
    }
  };

  const copyRevealed = async () => {
    if (!revealed) return;
    try {
      await navigator.clipboard.writeText(revealed);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setError('Copy failed — write the PIN down before leaving this screen.');
    }
  };

  const lastUsedLabel = myPin?.last_used_at
    ? `Last used ${formatDistanceToNow(new Date(myPin.last_used_at), { addSuffix: true })}`
    : null;

  return (
    <div className="space-y-3">
      <div className="pt-2 pb-1">
        <h1 className="text-[20px] font-bold text-foreground">Kiosk PIN</h1>
      </div>

      <div className="rounded-xl border border-border/40 bg-background overflow-hidden">
        <div className="px-5 py-4 border-b border-border/40">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-muted/50 flex items-center justify-center">
              <KeyRound className="h-5 w-5 text-foreground" aria-hidden="true" />
            </div>
            <div>
              <div className="text-[17px] font-semibold text-foreground">Kiosk PIN</div>
              <div className="text-[13px] text-muted-foreground mt-0.5">
                Use this PIN on the kiosk to clock in
              </div>
            </div>
          </div>
        </div>

        <div className="px-5 py-4 border-b border-border/40">
          {myPin ? (
            myPin.force_reset ? (
              <span className="inline-flex items-center gap-2 text-[12px] font-medium px-2 py-1 rounded-md bg-amber-500/10 text-amber-700 dark:text-amber-400 border border-amber-500/20">
                Temporary PIN · Change it on the kiosk
              </span>
            ) : (
              <span className="inline-flex items-center gap-2 text-[12px] font-medium px-2 py-1 rounded-md bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-500/20">
                PIN set{lastUsedLabel ? ` · ${lastUsedLabel}` : ''}
              </span>
            )
          ) : (
            <span className="inline-flex items-center gap-2 text-[12px] font-medium px-2 py-1 rounded-md bg-muted text-muted-foreground">
              No PIN yet
            </span>
          )}
        </div>

        <div className="px-5 pt-3">
          <div className="flex items-center" role="tablist" aria-label="Choose how to set your PIN">
            {(['generate', 'type'] as const).map((t) => (
              <button
                key={t}
                role="tab"
                aria-selected={tab === t}
                onClick={() => {
                  setTab(t);
                  setRevealed(null);
                  setError(null);
                }}
                className={cn(
                  'relative px-0 py-3 mr-6 text-[14px] font-medium transition-colors',
                  tab === t ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'
                )}
              >
                {t === 'generate' ? 'Generate for me' : 'Type my own'}
                {tab === t && (
                  <div className="absolute bottom-0 left-0 right-0 h-[2px] bg-foreground" />
                )}
              </button>
            ))}
          </div>
        </div>

        <div className="px-5 py-5 space-y-4">
          {revealed ? (
            <div className="p-5 rounded-xl bg-emerald-500/10 border border-emerald-500/20">
              <div className="text-[12px] uppercase tracking-wider text-emerald-700 dark:text-emerald-400 font-medium">
                Your new PIN
              </div>
              <div className="flex items-center justify-between mt-2">
                <span className="text-[36px] font-mono tracking-[0.3em] text-foreground">
                  {revealed}
                </span>
                <Button size="sm" variant="outline" onClick={copyRevealed} aria-label="Copy PIN">
                  {copied ? <Check className="h-4 w-4 text-emerald-600" aria-hidden="true" /> : <Copy className="h-4 w-4" aria-hidden="true" />}
                  <span className="ml-1.5 text-[13px]">{copied ? 'Copied' : 'Copy'}</span>
                </Button>
              </div>
              <p className="text-[12px] text-muted-foreground mt-3">
                This is your only chance to see this number. We hash it for storage.
              </p>
            </div>
          ) : tab === 'generate' ? (
            <Button
              onClick={generate}
              disabled={upsertPin.isPending}
              className="w-full h-10 rounded-lg bg-foreground text-background hover:bg-foreground/90 text-[13px] font-medium"
            >
              {upsertPin.isPending ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" aria-hidden="true" />
              ) : null}
              Generate a new PIN
            </Button>
          ) : (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <label htmlFor="employee-pin-new" className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider">
                  New PIN ({minLength}–6 digits)
                </label>
                <Input
                  id="employee-pin-new"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={6}
                  value={typed}
                  onChange={(e) => setTyped(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  className="h-10 text-[16px] font-mono tracking-[0.3em] bg-muted/30 border-border/40 rounded-lg"
                />
                {typedTooShort && (
                  <p className="text-[12px] text-destructive">Must be at least {minLength} digits.</p>
                )}
                {typedSimple && (
                  <p className="text-[12px] text-amber-600">Avoid simple sequences like 1234.</p>
                )}
              </div>
              <div className="space-y-1.5">
                <label htmlFor="employee-pin-confirm" className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider">
                  Confirm PIN
                </label>
                <Input
                  id="employee-pin-confirm"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={6}
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  className="h-10 text-[16px] font-mono tracking-[0.3em] bg-muted/30 border-border/40 rounded-lg"
                />
                {confirmMismatch && (
                  <p className="text-[12px] text-destructive">PINs do not match.</p>
                )}
              </div>
              <Button
                onClick={saveTyped}
                disabled={!canSubmitTyped}
                className="w-full h-10 rounded-lg bg-foreground text-background hover:bg-foreground/90 text-[13px] font-medium"
              >
                {upsertPin.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" aria-hidden="true" /> : null}
                Save my PIN
              </Button>
            </div>
          )}

          {error && (
            <div className="p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-[13px] text-destructive" role="alert">
              {error}
            </div>
          )}

          <p className="text-[12px] text-muted-foreground">
            For security we never store readable PINs. If you forget yours, generate a new one here.
          </p>
        </div>
      </div>
    </div>
  );
}

export default EmployeePin;
