import { useState, useMemo } from 'react';

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';

import { Sparkles, Lock } from 'lucide-react';

import type { Shift } from '@/types/scheduling';

interface Employee {
  id: string;
  name: string;
  position: string;
}

interface GenerateScheduleDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  employees: Employee[];
  existingShifts: Shift[];
  weekStart: Date;
  weekEnd: Date;
  isGenerating: boolean;
  onGenerate: (excludedEmployeeIds: string[], lockedShiftIds: string[]) => void;
}

function formatDateRange(start: Date, end: Date): string {
  const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' };
  return `${start.toLocaleDateString('en-US', opts)} \u2013 ${end.toLocaleDateString('en-US', opts)}`;
}

function formatShiftTime(isoString: string): string {
  const d = new Date(isoString);
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true }).toLowerCase();
}

function formatShiftDay(isoString: string): string {
  const d = new Date(isoString);
  return d.toLocaleDateString('en-US', { weekday: 'short' });
}

export function GenerateScheduleDialog({
  open,
  onOpenChange,
  employees,
  existingShifts,
  weekStart,
  weekEnd,
  isGenerating,
  onGenerate,
}: Readonly<GenerateScheduleDialogProps>) {
  // employees to exclude — empty means all included
  const [excludedIds, setExcludedIds] = useState<Set<string>>(new Set());
  // shifts to lock — empty means none locked
  const [lockedIds, setLockedIds] = useState<Set<string>>(new Set());

  const sortedEmployees = useMemo(
    () => [...employees].sort((a, b) => a.name.localeCompare(b.name)),
    [employees],
  );

  // Filter out cancelled and already-locked shifts for the lock section
  const lockableShifts = useMemo(
    () => existingShifts.filter((s) => s.status !== 'cancelled' && !s.locked),
    [existingShifts],
  );

  function toggleEmployee(id: string) {
    setExcludedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  function toggleLock(id: string) {
    setLockedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  function handleGenerate() {
    onGenerate(Array.from(excludedIds), Array.from(lockedIds));
  }

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen) {
      setExcludedIds(new Set());
      setLockedIds(new Set());
    }
    onOpenChange(nextOpen);
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto p-0 gap-0 border-border/40">
        {/* Header */}
        <DialogHeader className="px-6 pt-6 pb-4 border-b border-border/40">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-violet-500/10 flex items-center justify-center">
              <Sparkles className="h-5 w-5 text-violet-500" />
            </div>
            <div>
              <DialogTitle className="text-[17px] font-semibold text-foreground">
                Generate Schedule
              </DialogTitle>
              <p className="text-[13px] text-muted-foreground mt-0.5">
                AI will create shifts for {formatDateRange(weekStart, weekEnd)}
              </p>
            </div>
          </div>
        </DialogHeader>

        {/* Content */}
        <div className="px-6 py-5 space-y-5">
          {/* Section 1 — Employees */}
          <div className="rounded-xl border border-border/40 bg-muted/30 overflow-hidden">
            <div className="px-4 py-3 border-b border-border/40 bg-muted/50 flex items-center justify-between">
              <p className="text-[13px] font-semibold text-foreground">Employees</p>
              <p className="text-[12px] text-muted-foreground">Uncheck to exclude from schedule</p>
            </div>
            <div className="p-3 space-y-1 max-h-[200px] overflow-y-auto">
              {sortedEmployees.length === 0 ? (
                <p className="text-[13px] text-muted-foreground py-2 text-center">No active employees</p>
              ) : (
                sortedEmployees.map((employee) => {
                  const included = !excludedIds.has(employee.id);
                  return (
                    <label
                      key={employee.id}
                      htmlFor={`employee-${employee.id}`}
                      className="flex items-center gap-3 px-2 py-2 rounded-lg cursor-pointer hover:bg-muted/50 transition-colors"
                    >
                      <Checkbox
                        id={`employee-${employee.id}`}
                        checked={included}
                        onCheckedChange={() => toggleEmployee(employee.id)}
                        className="shrink-0"
                        aria-label={`Include ${employee.name}`}
                      />
                      <div className="min-w-0 flex-1">
                        <span className="text-[14px] font-medium text-foreground">{employee.name}</span>
                        <span className="text-[12px] text-muted-foreground ml-2">{employee.position}</span>
                      </div>
                    </label>
                  );
                })
              )}
            </div>
          </div>

          {/* Section 2 — Existing Shifts (only if there are lockable shifts) */}
          {lockableShifts.length > 0 && (
            <div className="rounded-xl border border-border/40 bg-muted/30 overflow-hidden">
              <div className="px-4 py-3 border-b border-border/40 bg-muted/50 flex items-center justify-between">
                <p className="text-[13px] font-semibold text-foreground">Existing Shifts</p>
                <p className="text-[12px] text-muted-foreground">Lock shifts you want to keep as-is</p>
              </div>
              <div className="p-3 space-y-1 max-h-[200px] overflow-y-auto">
                {lockableShifts.map((shift) => {
                  const isLocked = lockedIds.has(shift.id);
                  const employeeName = shift.employee?.name ?? 'Unknown';
                  return (
                    <label
                      key={shift.id}
                      htmlFor={`shift-${shift.id}`}
                      className="flex items-center gap-3 px-2 py-2 rounded-lg cursor-pointer hover:bg-muted/50 transition-colors"
                    >
                      <Checkbox
                        id={`shift-${shift.id}`}
                        checked={isLocked}
                        onCheckedChange={() => toggleLock(shift.id)}
                        className="shrink-0"
                        aria-label={`Lock shift for ${employeeName}`}
                      />
                      {isLocked && <Lock className="h-3.5 w-3.5 text-muted-foreground shrink-0" />}
                      <div className="min-w-0 flex-1">
                        <span className="text-[14px] font-medium text-foreground">{employeeName}</span>
                        <span className="text-[12px] text-muted-foreground ml-2">
                          {formatShiftDay(shift.start_time)} {formatShiftTime(shift.start_time)}
                        </span>
                      </div>
                    </label>
                  );
                })}
              </div>
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
            disabled={isGenerating}
          >
            Cancel
          </Button>
          <Button
            size="sm"
            className="h-9 px-4 rounded-lg bg-foreground text-background hover:bg-foreground/90 text-[13px] font-medium flex items-center gap-1.5"
            onClick={handleGenerate}
            disabled={isGenerating}
            aria-label="Generate schedule with AI"
          >
            <Sparkles className="h-4 w-4" />
            {isGenerating ? 'Generating...' : 'Generate'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
