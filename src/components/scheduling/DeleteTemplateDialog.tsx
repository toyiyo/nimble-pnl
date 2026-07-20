import { useEffect, useState } from 'react';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';

import { AlertTriangle, RefreshCw, Trash2 } from 'lucide-react';

import { useTemplateDeletionImpact } from '@/hooks/useTemplateDeletionImpact';
import {
  buildTemplateLedger,
  deriveTemplateSeverity,
  type LedgerTone,
} from '@/lib/scheduling/deletionCopy';

import type { ShiftTemplate } from '@/types/scheduling';

export interface DeleteTemplateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  template: ShiftTemplate | null;
  restaurantId: string | null;
  /** Reversible alternative — parent computes keptShiftCount and calls hideMutation. */
  onHide: (template: ShiftTemplate) => void;
  onConfirmDelete: (input: { id: string; name: string; pendingClaimsCount: number }) => void;
  isHiding?: boolean;
  isDeleting?: boolean;
}

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function formatTemplateTime(time: string): string {
  const [h, m] = time.split(':').map(Number);
  const suffix = h >= 12 ? 'p' : 'a';
  const hour12 = h % 12 || 12;
  if (m === 0) return `${hour12}${suffix}`;
  return `${hour12}:${String(m).padStart(2, '0')}${suffix}`;
}

function formatTemplateDays(days: number[]): string {
  return [...days]
    .sort((a, b) => a - b)
    .map((d) => DAY_LABELS[d])
    .join(', ');
}

function templateSubtitle(template: ShiftTemplate): string {
  const time = `${formatTemplateTime(template.start_time)}-${formatTemplateTime(template.end_time)}`;
  return `${template.position} · ${time} · ${formatTemplateDays(template.days)}`;
}

const CHIP_TONE_CLASSES: Record<LedgerTone, string> = {
  destructive: 'bg-destructive/10 text-destructive',
  warning: 'bg-amber-500/10 text-amber-700 dark:text-amber-400',
  success: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
};

/**
 * Impact Ledger dialog for hard-deleting a shift template. See
 * docs/superpowers/specs/2026-07-20-impact-aware-deletion-design.md.
 *
 * Owns its own `useTemplateDeletionImpact` read (keyed on the open template)
 * so callers only need to hand over the template + the two mutation
 * callbacks; the ledger content, severity pill, and friction gating are all
 * derived here from the impact + the pure `deletionCopy` helpers.
 */
export function DeleteTemplateDialog({
  open,
  onOpenChange,
  template,
  restaurantId,
  onHide,
  onConfirmDelete,
  isHiding = false,
  isDeleting = false,
}: DeleteTemplateDialogProps) {
  const [ackChecked, setAckChecked] = useState(false);

  const impact = useTemplateDeletionImpact(
    restaurantId,
    open && template ? template.id : null,
  );

  // Reset the acknowledgment each time a different template is opened for
  // deletion — a stale "checked" state from a prior high-impact template
  // must never carry over and silently unlock Delete.
  useEffect(() => {
    setAckChecked(false);
  }, [template?.id, open]);

  if (!template) {
    return null;
  }

  const severity = deriveTemplateSeverity(impact);
  const ledger = buildTemplateLedger(impact, template.name);
  const isBusy = isDeleting || isHiding;
  const hasImpactError = !!impact.error;

  const deleteDisabled =
    isBusy || impact.isLoading || hasImpactError || (ledger.needsAck && !ackChecked);

  const handleDelete = () => {
    onConfirmDelete({
      id: template.id,
      name: template.name,
      pendingClaimsCount: impact.pendingClaims.count,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto p-0 gap-0 border-border/40">
        <DialogHeader className="px-6 pt-6 pb-4 border-b border-border/40">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-destructive/10 flex items-center justify-center shrink-0">
              <Trash2 className="h-5 w-5 text-destructive" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <DialogTitle className="text-[17px] font-semibold text-foreground">
                  Delete &quot;{template.name}&quot;?
                </DialogTitle>
                <span
                  className={`text-[11px] px-1.5 py-0.5 rounded-md font-medium shrink-0 ${
                    severity === 'high'
                      ? 'bg-destructive/10 text-destructive'
                      : 'bg-muted text-muted-foreground'
                  }`}
                >
                  {severity === 'high' ? 'High impact' : 'Low impact'}
                </span>
              </div>
              <DialogDescription className="text-[13px] text-muted-foreground mt-0.5">
                {templateSubtitle(template)}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="px-6 py-5 space-y-5">
          {/* Summary chips */}
          <div className="flex flex-wrap gap-2">
            {ledger.chips.map((chip) => (
              <span
                key={chip.key}
                className={`text-[11px] px-1.5 py-0.5 rounded-md font-medium ${CHIP_TONE_CLASSES[chip.tone]}`}
              >
                {chip.label}
              </span>
            ))}
          </div>

          {impact.isLoading && (
            <p className="text-[13px] text-muted-foreground">Checking impact…</p>
          )}

          {hasImpactError && (
            <div className="flex items-center justify-between gap-3 p-2.5 rounded-lg bg-destructive/10 border border-destructive/20">
              <p className="text-[13px] text-destructive">
                Couldn&apos;t check what this delete would affect.
              </p>
              <Button
                variant="outline"
                size="sm"
                className="h-8 shrink-0"
                onClick={() => impact.refetch()}
              >
                <RefreshCw className="h-3.5 w-3.5 mr-1.5" /> Retry
              </Button>
            </div>
          )}

          {/* Removed panel */}
          {ledger.removed.length > 0 && (
            <div className="rounded-xl border border-destructive/20 bg-destructive/10 p-4 space-y-1.5">
              <h3 className="text-[13px] font-semibold text-destructive">Removed</h3>
              <ul className="space-y-1">
                {ledger.removed.map((line) => (
                  <li key={line.key} className="text-[13px] text-destructive">
                    {line.text}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Kept panel */}
          {ledger.kept.length > 0 && (
            <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-4 space-y-1.5">
              <h3 className="text-[13px] font-semibold text-emerald-700 dark:text-emerald-400">
                Kept
              </h3>
              <ul className="space-y-1">
                {ledger.kept.map((line) => (
                  <li
                    key={line.key}
                    className="text-[13px] text-emerald-700 dark:text-emerald-400"
                  >
                    {line.text}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Safe alternative callout */}
          <div className="flex items-start gap-2 p-2.5 rounded-lg bg-muted/50 border border-border/40">
            <p className="text-[13px] text-muted-foreground">
              Hide it instead — stops new open shifts, keeps every shift &amp; claim. Restore
              anytime.
            </p>
          </div>

          {/* Acknowledgment checkbox — only when there is something irreversible to accept */}
          {ledger.needsAck && (
            <div className="flex items-start gap-2 p-2.5 rounded-lg bg-destructive/10 border border-destructive/20">
              <Checkbox
                id="delete-template-ack"
                checked={ackChecked}
                onCheckedChange={(checked) => setAckChecked(checked === true)}
                className="mt-0.5"
              />
              <Label
                htmlFor="delete-template-ack"
                className="text-[13px] text-destructive font-normal cursor-pointer"
              >
                {ledger.ackLabel}
              </Label>
            </div>
          )}
        </div>

        <DialogFooter className="sticky bottom-0 bg-background border-t border-border/40 px-6 py-4 gap-2">
          <Button
            variant="ghost"
            className="h-9 px-4 rounded-lg text-[13px] font-medium text-muted-foreground hover:text-foreground"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            variant="outline"
            disabled={isBusy}
            className="h-9 px-4 rounded-lg text-[13px] font-medium"
            onClick={() => onHide(template)}
          >
            {isHiding ? 'Hiding…' : 'Hide template'}
          </Button>
          <Button
            variant="destructive"
            disabled={deleteDisabled}
            className="h-9 px-4 rounded-lg text-[13px] font-medium"
            onClick={handleDelete}
          >
            {isDeleting ? 'Deleting…' : 'Delete template'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
