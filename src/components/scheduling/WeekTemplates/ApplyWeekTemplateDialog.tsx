import { useEffect, useMemo, useState } from 'react';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

import { CalendarPlus, CheckCircle2 } from 'lucide-react';

import { getMondayOfWeek } from '@/hooks/useShiftPlanner';

import type { ApplyTemplateResult, SchedulePlanTemplate } from '@/types/scheduling';

import { TemplateApplyFields, type TemplateMergeMode } from '@/components/scheduling/TemplateApplyFields';
import { isPastWeek } from '@/lib/schedulePlanTemplates';

interface ApplyWeekTemplateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  template: SchedulePlanTemplate;
  onApply: (targetMonday: Date, mergeMode: TemplateMergeMode) => Promise<ApplyTemplateResult>;
  isPending: boolean;
  onViewWeek: (monday: Date) => void;
}

function describeResult(r: ApplyTemplateResult): string {
  const parts = [`${r.inserted_count} ${r.inserted_count === 1 ? 'shift' : 'shifts'} created`];
  if (r.deleted_count > 0) parts.push(`${r.deleted_count} replaced`);
  if (r.skipped_count > 0) parts.push(`${r.skipped_count} skipped`);
  return `${parts.join(', ')}.`;
}

export function ApplyWeekTemplateDialog({
  open,
  onOpenChange,
  template,
  onApply,
  isPending,
  onViewWeek,
}: Readonly<ApplyWeekTemplateDialogProps>) {
  const [selectedDate, setSelectedDate] = useState<Date | undefined>();
  const [mergeMode, setMergeMode] = useState<TemplateMergeMode>('replace');
  const [result, setResult] = useState<{ monday: Date; data: ApplyTemplateResult } | null>(null);

  useEffect(() => {
    if (open) {
      setSelectedDate(undefined);
      setMergeMode('replace');
      setResult(null);
    }
  }, [open]);

  const targetMonday = useMemo(() => (selectedDate ? getMondayOfWeek(selectedDate) : null), [selectedDate]);
  const past = isPastWeek(targetMonday);
  const canApply = !!targetMonday && !past && !isPending;

  const handleApply = async () => {
    if (!targetMonday) return;
    try {
      const data = await onApply(targetMonday, mergeMode);
      setResult({ monday: targetMonday, data });
    } catch {
      // The hook shows the error toast. Keep the dialog open so the user can retry.
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm max-h-[85vh] overflow-y-auto p-0 gap-0 border-border/40">
        <DialogHeader className="px-6 pt-6 pb-4 border-b border-border/40">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-muted/50 flex items-center justify-center">
              <CalendarPlus className="h-5 w-5 text-foreground" />
            </div>
            <div className="min-w-0">
              <DialogTitle className="text-[17px] font-semibold text-foreground">Apply template</DialogTitle>
              <DialogDescription className="text-[13px] text-muted-foreground mt-0.5 truncate">
                {template.name}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="px-6 py-5">
          {result ? (
            <div role="status" className="flex items-start gap-3 p-3 rounded-lg bg-muted/30 border border-border/40">
              <CheckCircle2 className="h-5 w-5 text-foreground shrink-0 mt-0.5" />
              <div>
                <p className="text-[14px] font-medium text-foreground">Template applied</p>
                <p className="text-[13px] text-muted-foreground">{describeResult(result.data)}</p>
              </div>
            </div>
          ) : (
            <TemplateApplyFields
              selectedDate={selectedDate}
              onSelectDate={setSelectedDate}
              targetMonday={targetMonday}
              isPastWeek={past}
              mergeMode={mergeMode}
              onMergeModeChange={setMergeMode}
              radioName="weekTemplateMergeMode"
            />
          )}
        </div>

        <DialogFooter className="sticky bottom-0 bg-background border-t border-border/40 px-6 py-4 gap-2">
          <Button
            type="button"
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={isPending}
            className="h-9 px-4 rounded-lg text-[13px] font-medium text-muted-foreground hover:text-foreground"
          >
            {result ? 'Close' : 'Cancel'}
          </Button>
          {result ? (
            <Button
              type="button"
              onClick={() => onViewWeek(result.monday)}
              className="h-9 px-4 rounded-lg bg-foreground text-background hover:bg-foreground/90 text-[13px] font-medium"
            >
              View week
            </Button>
          ) : (
            <Button
              type="button"
              onClick={handleApply}
              disabled={!canApply}
              className="h-9 px-4 rounded-lg bg-foreground text-background hover:bg-foreground/90 text-[13px] font-medium"
            >
              {isPending ? 'Applying…' : 'Apply'}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
