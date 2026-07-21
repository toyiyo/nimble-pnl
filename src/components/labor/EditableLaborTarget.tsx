import { useCallback, useEffect, useRef, useState } from 'react';

import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

import { useToast } from '@/hooks/use-toast';

interface EditableLaborTargetProps {
  /** Current `target_labor_pct` (source of truth from `useLaborPnlAnalytics`). */
  targetPct: number;
  /** Dirty-checked write, e.g. `useLaborPnlAnalytics`'s `updateTarget`. */
  onCommit: (newTargetPct: number) => Promise<void>;
  disabled?: boolean;
}

/**
 * Editable target-% control (design §7): labeled number input, commit on
 * blur *or* Enter. Guards its own dirty check against `committedRef` — not
 * just relying on the hook-level check `useLaborPnlAnalytics.updateTarget`
 * already does — so an Enter-then-blur sequence never calls `onCommit`
 * twice, even against a bare mock in tests. Optimistically updates the
 * displayed value on commit; reverts + shows an error toast if the write
 * rejects (e.g. `updateSettings` failing).
 */
export function EditableLaborTarget({
  targetPct,
  onCommit,
  disabled,
}: Readonly<EditableLaborTargetProps>) {
  const { toast } = useToast();
  const [value, setValue] = useState(String(targetPct));
  const committedRef = useRef(targetPct);

  // Re-sync the displayed value when the source of truth changes externally
  // (initial load, or a refetch after another surface edits the setting).
  useEffect(() => {
    committedRef.current = targetPct;
    setValue(String(targetPct));
  }, [targetPct]);

  const commit = useCallback(async () => {
    const trimmed = value.trim();
    const parsed = Number(trimmed);
    if (trimmed === '' || !Number.isFinite(parsed)) {
      // Invalid entry — revert to the last committed value rather than
      // writing garbage.
      setValue(String(committedRef.current));
      return;
    }
    // Clamp to a sane [1, 100] labor-% range before committing: the input's
    // min/max are only advisory (they don't stop a typed -5 / 0 / 500), and a
    // garbage target would corrupt every balance-state threshold and the
    // chart's target ReferenceLine downstream.
    const clamped = Math.min(100, Math.max(1, parsed));
    if (clamped === committedRef.current) return; // dirty check: no-op when unchanged

    const previous = committedRef.current;
    committedRef.current = clamped; // optimistic
    setValue(String(clamped));
    try {
      await onCommit(clamped);
    } catch {
      committedRef.current = previous;
      setValue(String(previous));
      toast({ title: 'Failed to save labor target', variant: 'destructive' });
    }
  }, [value, onCommit, toast]);

  return (
    <div className="flex flex-col gap-1">
      <Label
        htmlFor="labor-target-input"
        className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider"
      >
        Labor Target
      </Label>
      <div className="flex items-center gap-1">
        <Input
          id="labor-target-input"
          type="number"
          min={1}
          max={100}
          value={value}
          disabled={disabled}
          onChange={(e) => setValue(e.target.value)}
          onBlur={() => {
            void commit();
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              void commit();
            }
          }}
          aria-label="Target labor cost percentage"
          className="h-8 w-20 text-[13px] bg-muted/30 border-border/40 rounded-lg focus-visible:ring-1 focus-visible:ring-border"
        />
        <span className="text-[13px] text-muted-foreground">%</span>
      </div>
    </div>
  );
}
