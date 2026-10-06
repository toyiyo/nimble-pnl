import { useMemo, useState } from 'react';

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

import type { DraftShiftInput } from '@/types/scheduling';

import { DAY_LABELS, DAY_NAMES, MAX_BREAK_MINUTES } from '@/lib/weekTemplateDraft';
import { cn } from '@/lib/utils';

const INPUT_CLASS =
  'h-10 text-[14px] bg-muted/30 border-border/40 rounded-lg focus-visible:ring-1 focus-visible:ring-border';
const LABEL_CLASS = 'text-[12px] font-medium text-muted-foreground uppercase tracking-wider';
const FORM_ID = 'template-shift-form';

interface TemplateShiftDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: 'add' | 'edit';
  employeeName: string;
  initial: DraftShiftInput;
  /** Monday-first day (0 = Mon). Preselected in add mode; the shift's day in edit mode. */
  initialDay: number;
  /** Returns the days (of those given) where the employee already has an overlapping shift. */
  findOverlapDays: (days: number[], start: string, end: string) => number[];
  onSubmit: (input: DraftShiftInput, days: number[]) => void;
  onDelete?: () => void;
  /**
   * The control that opened the dialog. Radix returns focus only to a
   * DialogTrigger, and this dialog has none, so focus goes back here on close.
   */
  returnFocusTo?: HTMLElement | null;
}

const toHHMM = (time: string) => time.slice(0, 5);

/**
 * Add or edit one template shift. The parent mounts one instance per cell or
 * shift (with a `key`), so the useState initial values below are the reset.
 */
export function TemplateShiftDialog({
  open,
  onOpenChange,
  mode,
  employeeName,
  initial,
  initialDay,
  findOverlapDays,
  onSubmit,
  onDelete,
  returnFocusTo,
}: Readonly<TemplateShiftDialogProps>) {
  const [start, setStart] = useState(toHHMM(initial.start_time));
  const [end, setEnd] = useState(toHHMM(initial.end_time));
  const [breakMinutes, setBreakMinutes] = useState(String(initial.break_duration));
  const [position, setPosition] = useState(initial.position);
  const [notes, setNotes] = useState(initial.notes ?? '');
  const [days, setDays] = useState<number[]>([initialDay]);

  const isEdit = mode === 'edit';
  const breakValue = Number(breakMinutes);
  const breakValid = breakMinutes !== '' && Number.isInteger(breakValue) && breakValue >= 0 && breakValue <= MAX_BREAK_MINUTES;
  const timesPresent = start !== '' && end !== '';
  const sameTimes = timesPresent && start === end;

  const overlapDays = useMemo(
    () => (timesPresent && !sameTimes && days.length > 0 ? findOverlapDays(days, start, end) : []),
    [timesPresent, sameTimes, days, start, end, findOverlapDays],
  );

  const isValid =
    timesPresent &&
    !sameTimes &&
    breakValid &&
    position.trim().length > 0 &&
    days.length > 0 &&
    overlapDays.length === 0;

  const toggleDay = (day: number) =>
    setDays((prev) => (prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day].sort((a, b) => a - b)));

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!isValid) return;
    onSubmit(
      {
        start_time: start,
        end_time: end,
        break_duration: breakValue,
        position: position.trim(),
        notes: notes.trim() ? notes.trim() : null,
      },
      days,
    );
  };

  const errorId = 'template-shift-error';
  let error: string | null = null;
  if (sameTimes) error = 'Start and end must differ';
  else if (overlapDays.length > 0)
    error = `${employeeName} already has a shift at this time on ${overlapDays.map((d) => DAY_NAMES[d]).join(', ')}`;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-md max-h-[85vh] overflow-y-auto p-0 gap-0 border-border/40"
        onCloseAutoFocus={(e) => {
          if (returnFocusTo?.isConnected) {
            e.preventDefault();
            returnFocusTo.focus();
          }
        }}
      >
        <DialogHeader className="px-6 pt-6 pb-4 border-b border-border/40">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-muted/50 flex items-center justify-center">
              <Clock className="h-5 w-5 text-foreground" />
            </div>
            <div>
              <DialogTitle className="text-[17px] font-semibold text-foreground">
                {isEdit ? 'Edit shift' : 'Add shift'}
              </DialogTitle>
              <DialogDescription className="text-[13px] text-muted-foreground mt-0.5">
                {isEdit ? `${employeeName} · ${DAY_NAMES[initialDay]}` : employeeName}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <form id={FORM_ID} onSubmit={handleSubmit} className="px-6 py-5 space-y-5">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="template-shift-start" className={LABEL_CLASS}>Start</Label>
              <Input
                id="template-shift-start"
                type="time"
                value={start}
                onChange={(e) => setStart(e.target.value)}
                aria-describedby={error ? errorId : undefined}
                aria-invalid={!!error}
                className={INPUT_CLASS}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="template-shift-end" className={LABEL_CLASS}>End</Label>
              <Input
                id="template-shift-end"
                type="time"
                value={end}
                onChange={(e) => setEnd(e.target.value)}
                aria-describedby={error ? errorId : undefined}
                aria-invalid={!!error}
                className={INPUT_CLASS}
              />
            </div>
          </div>
          {timesPresent && !sameTimes && end < start && (
            <p className="text-[12px] text-muted-foreground -mt-3">Ends the next day.</p>
          )}
          {error && (
            <p id={errorId} role="alert" className="text-[12px] text-destructive -mt-3">
              {error}
            </p>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="template-shift-break" className={LABEL_CLASS}>Break (min)</Label>
              <Input
                id="template-shift-break"
                type="number"
                inputMode="numeric"
                min={0}
                max={MAX_BREAK_MINUTES}
                step={5}
                value={breakMinutes}
                onChange={(e) => setBreakMinutes(e.target.value)}
                aria-invalid={!breakValid}
                className={INPUT_CLASS}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="template-shift-position" className={LABEL_CLASS}>Position</Label>
              <Input
                id="template-shift-position"
                value={position}
                maxLength={100}
                onChange={(e) => setPosition(e.target.value)}
                className={INPUT_CLASS}
              />
            </div>
          </div>

          {!isEdit && (
            <div className="space-y-1.5">
              <span className={LABEL_CLASS}>Days</span>
              <div className="flex flex-wrap gap-2" role="group" aria-label="Days">
                {DAY_LABELS.map((label, day) => (
                  <button
                    key={label}
                    type="button"
                    aria-label={DAY_NAMES[day]}
                    aria-pressed={days.includes(day)}
                    onClick={() => toggleDay(day)}
                    className={cn(
                      'h-9 min-w-[44px] px-2 rounded-lg text-[13px] font-medium transition-colors',
                      days.includes(day)
                        ? 'bg-foreground text-background'
                        : 'bg-muted/30 text-muted-foreground hover:bg-muted/50',
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {days.length === 0 && <p className="text-[12px] text-destructive">Select at least one day</p>}
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="template-shift-notes" className={LABEL_CLASS}>Notes</Label>
            <Input
              id="template-shift-notes"
              value={notes}
              maxLength={500}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Optional"
              className={INPUT_CLASS}
            />
          </div>
        </form>

        <DialogFooter className="sticky bottom-0 bg-background border-t border-border/40 px-6 py-4 gap-2 sm:justify-between">
          {isEdit && onDelete ? (
            <Button
              type="button"
              variant="ghost"
              onClick={onDelete}
              className="h-9 px-4 rounded-lg text-[13px] font-medium text-destructive hover:text-destructive/80"
            >
              Delete shift
            </Button>
          ) : (
            <span aria-hidden="true" />
          )}
          <div className="flex gap-2 justify-end">
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              className="h-9 px-4 rounded-lg text-[13px] font-medium text-muted-foreground hover:text-foreground"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              form={FORM_ID}
              disabled={!isValid}
              className="h-9 px-4 rounded-lg bg-foreground text-background hover:bg-foreground/90 text-[13px] font-medium"
            >
              {isEdit ? 'Save shift' : 'Add shift'}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
