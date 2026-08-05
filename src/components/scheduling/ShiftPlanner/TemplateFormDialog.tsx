import { useState, useEffect, useCallback } from 'react';

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

import { Clock } from 'lucide-react';

import { useTemplateHoursLedger } from '@/hooks/useTemplateHoursLedger';

import type { ShiftTemplate } from '@/types/scheduling';

import { AreaCombobox } from '@/components/AreaCombobox';
import { TemplateHoursImpact } from '@/components/scheduling/ShiftPlanner/TemplateHoursImpact';
import { buildSaveButtonLabel } from '@/lib/scheduling/hoursChangeCopy';
import { cn } from '@/lib/utils';

const DAY_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'] as const;

interface TemplateFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  template?: ShiftTemplate;
  onSubmit: (data: {
    name: string;
    start_time: string;
    end_time: string;
    position: string;
    area?: string | null;
    days: number[];
    break_duration: number;
    capacity: number;
    cascade: boolean;
    driftedShiftIds: string[];
    notify: boolean;
    /** What the dialog promised on the save button, e.g. "Save & update 3 shifts". 0 when not cascading. */
    promisedCount: number;
  }) => Promise<void>;
  positions: string[];
  restaurantId: string | null;
  /** Already resolved through safeTz by the planner — never the browser's. */
  restaurantTimezone: string;
}

export function TemplateFormDialog({
  open,
  onOpenChange,
  template,
  onSubmit,
  positions,
  restaurantId,
  restaurantTimezone,
}: Readonly<TemplateFormDialogProps>) {
  const isEdit = !!template;

  const [name, setName] = useState('');
  const [startTime, setStartTime] = useState('09:00');
  const [endTime, setEndTime] = useState('17:00');
  const [position, setPosition] = useState('');
  const [days, setDays] = useState<number[]>([]);
  const [breakDuration, setBreakDuration] = useState(0);
  const [capacity, setCapacity] = useState(1);
  const [area, setArea] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Pre-fill form when template changes or dialog opens
  useEffect(() => {
    if (template) {
      setName(template.name);
      setStartTime(template.start_time.substring(0, 5));
      setEndTime(template.end_time.substring(0, 5));
      setPosition(template.position);
      setDays([...template.days]);
      setBreakDuration(template.break_duration);
      setCapacity(template.capacity ?? 1);
      setArea(template?.area ?? '');
    } else {
      setName('');
      setStartTime('09:00');
      setEndTime('17:00');
      setPosition('');
      setDays([]);
      setBreakDuration(0);
      setCapacity(1);
      setArea('');
    }
    setIsSubmitting(false);
    setSelectedDriftIds(new Set());
    setNotify(true);
  }, [template, open]);

  const toggleDay = (day: number) => {
    setDays((prev) =>
      prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day].sort((a, b) => a - b)
    );
  };

  const isValid = name.trim().length > 0 && position.trim().length > 0 && days.length > 0 && startTime !== endTime;

  const [selectedDriftIds, setSelectedDriftIds] = useState<Set<string>>(new Set());
  const [notify, setNotify] = useState(true);

  const {
    impact,
    buckets,
    ledger,
    debouncedStart,
    debouncedEnd,
    affectedCount,
    publishedCount,
    hoursChanged,
    showCascadeChoice,
  } = useTemplateHoursLedger(restaurantId, template, startTime, endTime, restaurantTimezone, selectedDriftIds);

  const toggleDrift = useCallback((shiftId: string) => {
    setSelectedDriftIds((prev) => {
      const next = new Set(prev);
      if (next.has(shiftId)) next.delete(shiftId); else next.add(shiftId);
      return next;
    });
  }, []);

  const submitWith = async (cascade: boolean) => {
    if (!isValid || isSubmitting) return;

    // Filtered against the live drift bucket, not the raw checkbox set: a
    // refetch can drop a row out of buckets.drifted (deleted, newly locked,
    // crossed into the past) without pruning selectedDriftIds to match. The
    // RPC re-validates every opted-in id server-side regardless — this is
    // about the client not promising promisedCount for one set of ids while
    // sending a different set.
    const driftedShiftIds = cascade
      ? [...selectedDriftIds].filter((id) => buckets?.drifted.some((d) => d.shiftId === id))
      : [];

    setIsSubmitting(true);
    try {
      await onSubmit({
        name: name.trim(),
        start_time: startTime,
        end_time: endTime,
        position: position.trim(),
        area: area.trim() || null,
        days,
        break_duration: breakDuration,
        capacity,
        cascade,
        driftedShiftIds,
        notify: cascade && notify,
        promisedCount: cascade ? affectedCount : 0,
      });
      onOpenChange(false);
    } catch {
      // Error handled by the mutation's onError toast. The dialog stays open
      // so the manager's input is not lost.
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    // Enter in a text field submits the form; the safe default is the
    // cascading save when one is on offer, matching the primary button.
    await submitWith(showCascadeChoice);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto p-0 gap-0 border-border/40">
        <DialogHeader className="px-6 pt-6 pb-4 border-b border-border/40">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-muted/50 flex items-center justify-center">
              <Clock className="h-5 w-5 text-foreground" />
            </div>
            <div>
              <DialogTitle className="text-[17px] font-semibold text-foreground">
                {isEdit ? 'Edit Shift Template' : 'Add Shift Template'}
              </DialogTitle>
              {/* DialogDescription, not a plain <p> — Radix only wires
                  aria-describedby off this component. */}
              <DialogDescription className="text-[13px] text-muted-foreground mt-0.5">
                {isEdit ? 'Update template details' : 'Define a recurring shift pattern'}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-5">
          {/* Template Name */}
          <div className="space-y-1.5">
            <Label
              htmlFor="template-name"
              className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider"
            >
              Template Name
            </Label>
            <Input
              id="template-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., Morning Weekdays"
              className="h-10 text-[14px] bg-muted/30 border-border/40 rounded-lg focus-visible:ring-1 focus-visible:ring-border"
            />
          </div>

          {/* Time Range */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label
                htmlFor="start-time"
                className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider"
              >
                Start Time
              </Label>
              <Input
                id="start-time"
                type="time"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                className="h-10 text-[14px] bg-muted/30 border-border/40 rounded-lg focus-visible:ring-1 focus-visible:ring-border"
              />
            </div>
            <div className="space-y-1.5">
              <Label
                htmlFor="end-time"
                className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider"
              >
                End Time
              </Label>
              <Input
                id="end-time"
                type="time"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                className="h-10 text-[14px] bg-muted/30 border-border/40 rounded-lg focus-visible:ring-1 focus-visible:ring-border"
              />
            </div>
          </div>

          {/* Adjacent to the control that causes it, so cause and effect are
              visible together. Only on edit, and only once the hours actually
              differ from what is stored. */}
          {isEdit && hoursChanged && template && (
            <TemplateHoursImpact
              ledger={ledger}
              drifted={buckets?.drifted ?? []}
              selectedDriftIds={selectedDriftIds}
              onToggleDrift={toggleDrift}
              publishedCount={publishedCount}
              notify={notify}
              onNotifyChange={setNotify}
              isLoading={impact.isLoading}
              error={impact.error}
              oldStart={template.start_time.substring(0, 5)}
              oldEnd={template.end_time.substring(0, 5)}
              newStart={debouncedStart}
              newEnd={debouncedEnd}
            />
          )}

          {/* Position */}
          <div className="space-y-1.5">
            <Label
              htmlFor="position"
              className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider"
            >
              Position
            </Label>
            <Input
              id="position"
              value={position}
              onChange={(e) => setPosition(e.target.value)}
              placeholder="e.g., Server"
              list="position-suggestions"
              className="h-10 text-[14px] bg-muted/30 border-border/40 rounded-lg focus-visible:ring-1 focus-visible:ring-border"
            />
            {positions.length > 0 && (
              <datalist id="position-suggestions">
                {positions.map((p) => (
                  <option key={p} value={p} />
                ))}
              </datalist>
            )}
          </div>

          {/* Area (optional) */}
          <div className="space-y-1.5">
            <Label id="template-area-label" className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider">
              Area
            </Label>
            <AreaCombobox
              restaurantId={restaurantId}
              value={area}
              onValueChange={setArea}
              placeholder="Select area (optional)..."
            />
          </div>

          {/* Days */}
          <div className="space-y-1.5">
            <Label className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider">
              Days
            </Label>
            <div className="flex gap-2">
              {DAY_LABELS.map((label, index) => (
                <button
                  key={['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][index]}
                  type="button"
                  aria-label={
                    ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][index]
                  }
                  aria-pressed={days.includes(index)}
                  onClick={() => toggleDay(index)}
                  className={cn(
                    'h-9 w-9 rounded-lg text-[13px] font-medium transition-colors',
                    days.includes(index)
                      ? 'bg-foreground text-background'
                      : 'bg-muted/30 text-muted-foreground hover:bg-muted/50'
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
            {days.length === 0 && (
              <p className="text-[12px] text-destructive">Select at least one day</p>
            )}
          </div>

          {/* Break Duration */}
          <div className="space-y-1.5">
            <Label
              htmlFor="break-duration"
              className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider"
            >
              Break Duration (minutes)
            </Label>
            <Input
              id="break-duration"
              type="number"
              min={0}
              value={breakDuration}
              onChange={(e) => setBreakDuration(Math.max(0, Number.parseInt(e.target.value, 10) || 0))}
              className="h-10 text-[14px] bg-muted/30 border-border/40 rounded-lg focus-visible:ring-1 focus-visible:ring-border"
            />
          </div>

          {/* Staff Needed */}
          <div className="space-y-1.5">
            <Label
              htmlFor="capacity"
              className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider"
            >
              Staff Needed
            </Label>
            <Input
              id="capacity"
              type="number"
              min={1}
              value={capacity}
              onChange={(e) => setCapacity(Math.max(1, Number.parseInt(e.target.value, 10) || 1))}
              className="h-10 text-[14px] bg-muted/30 border-border/40 rounded-lg focus-visible:ring-1 focus-visible:ring-border"
            />
            <p className="text-[13px] text-muted-foreground">
              How many employees are needed for this shift
            </p>
          </div>
        </form>

        {/* Sticky, matching DeleteTemplateDialog:245. Without this, the ledger
            plus seven form fields pushes Save off-screen inside a
            max-h-[80vh] dialog on a 375x667 viewport. */}
        <DialogFooter className="sticky bottom-0 bg-background border-t border-border/40 px-6 py-4 gap-2">
          <Button
            type="button"
            variant="ghost"
            onClick={() => onOpenChange(false)}
            className="h-9 px-4 rounded-lg text-[13px] font-medium text-muted-foreground hover:text-foreground"
          >
            Cancel
          </Button>

          {showCascadeChoice && (
            <Button
              type="button"
              variant="outline"
              disabled={!isValid || isSubmitting}
              onClick={() => { void submitWith(false); }}
              className="h-9 px-4 rounded-lg text-[13px] font-medium"
            >
              Template only
            </Button>
          )}

          <Button
            type="button"
            // While the impact query resolves, the single button renders
            // disabled rather than showing a label that is about to change
            // under the pointer.
            disabled={!isValid || isSubmitting || (isEdit && hoursChanged && impact.isLoading)}
            onClick={() => { void submitWith(showCascadeChoice); }}
            className="h-9 px-4 rounded-lg bg-foreground text-background hover:bg-foreground/90 text-[13px] font-medium"
          >
            {buildSaveButtonLabel({ isSubmitting, showCascadeChoice, affectedCount, isEdit })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
