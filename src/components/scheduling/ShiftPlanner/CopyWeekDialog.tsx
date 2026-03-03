import { useState, useMemo, useEffect } from 'react';

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';

import { Copy, AlertTriangle } from 'lucide-react';

import { supabase } from '@/integrations/supabase/client';
import { getMondayOfWeek, getWeekEnd } from '@/hooks/useShiftPlanner';
import type { Shift } from '@/types/scheduling';

interface CopyWeekDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sourceWeekStart: Date;
  sourceWeekEnd: Date;
  shifts: Shift[];
  restaurantId: string | null;
  onConfirm: (targetMonday: Date) => void;
  isPending: boolean;
}

function formatRange(start: Date, end: Date): string {
  const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' };
  return `${start.toLocaleDateString('en-US', opts)} – ${end.toLocaleDateString('en-US', opts)}`;
}

export function CopyWeekDialog({
  open,
  onOpenChange,
  sourceWeekStart,
  sourceWeekEnd,
  shifts,
  restaurantId,
  onConfirm,
  isPending,
}: Readonly<CopyWeekDialogProps>) {
  const [selectedDate, setSelectedDate] = useState<Date | undefined>();
  const [targetShiftCount, setTargetShiftCount] = useState<number | null>(null);

  const targetMonday = useMemo(
    () => (selectedDate ? getMondayOfWeek(selectedDate) : null),
    [selectedDate],
  );

  const targetEnd = useMemo(
    () => (targetMonday ? getWeekEnd(targetMonday) : null),
    [targetMonday],
  );

  const activeShiftCount = useMemo(
    () => shifts.filter((s) => s.status !== 'cancelled').length,
    [shifts],
  );

  const isSameWeek = targetMonday?.getTime() === sourceWeekStart.getTime();

  const isPastWeek = useMemo(() => {
    if (!targetMonday) return false;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const targetSunday = getWeekEnd(targetMonday);
    return targetSunday < today;
  }, [targetMonday]);

  // Query existing shift count in target week when selection changes
  useEffect(() => {
    if (!targetMonday || !targetEnd || !restaurantId || isSameWeek || isPastWeek) {
      setTargetShiftCount(null);
      return;
    }

    let cancelled = false;

    (async () => {
      const { count, error } = await supabase
        .from('shifts')
        .select('id', { count: 'exact', head: true })
        .eq('restaurant_id', restaurantId)
        .eq('locked', false)
        .gte('start_time', targetMonday.toISOString())
        .lte('start_time', targetEnd.toISOString());

      if (!cancelled && !error) {
        setTargetShiftCount(count ?? 0);
      }
    })();

    return () => { cancelled = true; };
  }, [targetMonday, targetEnd, restaurantId, isSameWeek, isPastWeek]);

  const canConfirm = targetMonday && !isSameWeek && !isPastWeek && activeShiftCount > 0;

  const handleConfirm = () => {
    if (!targetMonday) return;
    onConfirm(targetMonday);
  };

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      setSelectedDate(undefined);
      setTargetShiftCount(null);
    }
    onOpenChange(nextOpen);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-sm max-h-[85vh] overflow-y-auto p-0 gap-0 border-border/40">
        {/* Header */}
        <DialogHeader className="px-6 pt-6 pb-4 border-b border-border/40">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-muted/50 flex items-center justify-center">
              <Copy className="h-5 w-5 text-foreground" />
            </div>
            <div>
              <DialogTitle className="text-[17px] font-semibold text-foreground">
                Copy Week
              </DialogTitle>
              <p className="text-[13px] text-muted-foreground mt-0.5">
                {formatRange(sourceWeekStart, sourceWeekEnd)}
              </p>
            </div>
          </div>
        </DialogHeader>

        {/* Body */}
        <div className="px-6 py-5 space-y-4">
          <div>
            <p className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider mb-3">
              Copy to
            </p>
            <div className="flex justify-center">
              <Calendar
                mode="single"
                selected={selectedDate}
                onSelect={setSelectedDate}
                className="rounded-lg border border-border/40"
              />
            </div>
          </div>

          {targetMonday && targetEnd && (
            <div className="space-y-2">
              <div className="flex items-center justify-between p-3 rounded-lg bg-muted/30 border border-border/40">
                <span className="text-[13px] text-muted-foreground">Target week</span>
                <span className="text-[13px] font-medium text-foreground">
                  {formatRange(targetMonday, targetEnd)}
                </span>
              </div>

              <div className="flex items-center justify-between p-3 rounded-lg bg-muted/30 border border-border/40">
                <span className="text-[13px] text-muted-foreground">Shifts to copy</span>
                <span className="text-[13px] font-medium text-foreground">
                  {activeShiftCount}
                </span>
              </div>

              {/* Warning: existing shifts will be deleted */}
              {!isSameWeek && !isPastWeek && targetShiftCount !== null && targetShiftCount > 0 && (
                <div className="flex items-start gap-2 p-2.5 rounded-lg bg-destructive/10 border border-destructive/20">
                  <AlertTriangle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
                  <p className="text-[12px] text-destructive">
                    {targetShiftCount} existing unlocked {targetShiftCount === 1 ? 'shift' : 'shifts'} in the target week will be permanently deleted and replaced.
                  </p>
                </div>
              )}

              {!isSameWeek && !isPastWeek && (targetShiftCount === null || targetShiftCount === 0) && (
                <p className="text-[12px] text-muted-foreground">
                  No existing shifts in the target week. Shifts will be created fresh.
                </p>
              )}

              {(isSameWeek || isPastWeek) && (
                <div className="flex items-center gap-2 p-2.5 rounded-lg bg-destructive/10 border border-destructive/20">
                  <AlertTriangle className="h-4 w-4 text-destructive shrink-0" />
                  <p className="text-[12px] text-destructive">
                    {isSameWeek ? 'Cannot copy to the same week.' : 'Cannot copy to a past week.'}
                  </p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-border/40 flex justify-end gap-2">
          <Button
            variant="ghost"
            size="sm"
            className="h-9 px-4 rounded-lg text-[13px] font-medium text-muted-foreground hover:text-foreground"
            onClick={() => handleOpenChange(false)}
            disabled={isPending}
          >
            Cancel
          </Button>
          <Button
            size="sm"
            className="h-9 px-4 rounded-lg bg-foreground text-background hover:bg-foreground/90 text-[13px] font-medium"
            onClick={handleConfirm}
            disabled={!canConfirm || isPending}
            aria-label="Confirm copy week"
          >
            {isPending ? 'Copying...' : `Copy ${activeShiftCount} ${activeShiftCount === 1 ? 'Shift' : 'Shifts'}`}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
