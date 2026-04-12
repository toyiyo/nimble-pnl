import { useState, useMemo } from 'react';

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';

import { Sparkles, Lock, AlertTriangle, CheckCircle2, Info } from 'lucide-react';

import type { Shift, ShiftTemplate, EmployeeAvailability } from '@/types/scheduling';
import { computeScheduleWarnings } from '@/lib/scheduleWarnings';
import type { GenerateScheduleResponse } from '@/hooks/useGenerateSchedule';

interface Employee {
  id: string;
  name: string;
  position: string;
}

type DialogPhase = 'config' | 'generating' | 'results';

interface GenerateScheduleDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  employees: Employee[];
  existingShifts: Shift[];
  weekStart: Date;
  weekEnd: Date;
  isGenerating: boolean;
  onGenerate: (excludedEmployeeIds: string[], lockedShiftIds: string[]) => void;
  templates: ShiftTemplate[];
  availability: EmployeeAvailability[];
  generationResult: GenerateScheduleResponse | null;
  generationError: Error | null;
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
  templates,
  availability,
  generationResult,
  generationError,
}: Readonly<GenerateScheduleDialogProps>) {
  // employees to exclude — empty means all included
  const [excludedIds, setExcludedIds] = useState<Set<string>>(new Set());
  // shifts to lock — empty means none locked
  const [lockedIds, setLockedIds] = useState<Set<string>>(new Set());

  // Derive phase from props
  const phase: DialogPhase = generationResult || generationError
    ? 'results'
    : isGenerating
      ? 'generating'
      : 'config';

  const sortedEmployees = useMemo(
    () => [...employees].sort((a, b) => a.name.localeCompare(b.name)),
    [employees],
  );

  // Filter out cancelled and already-locked shifts for the lock section
  const lockableShifts = useMemo(
    () => existingShifts.filter((s) => s.status !== 'cancelled' && !s.locked),
    [existingShifts],
  );

  // Pre-flight warnings
  const includedEmployees = useMemo(
    () => sortedEmployees.filter((e) => !excludedIds.has(e.id)),
    [sortedEmployees, excludedIds],
  );

  const warnings = useMemo(
    () => computeScheduleWarnings(includedEmployees, templates, availability),
    [includedEmployees, templates, availability],
  );

  const warningGroups = useMemo(() => {
    const groups = new Map<string, { label: string; items: typeof warnings }>();
    const typeLabels: Record<string, string> = {
      no_availability: 'No availability set',
      limited_availability: 'Limited availability',
      position_mismatch: 'No matching templates',
      no_time_overlap: 'No time overlap with templates',
    };
    for (const w of warnings) {
      const group = groups.get(w.type) ?? { label: typeLabels[w.type] ?? w.type, items: [] };
      group.items.push(w);
      groups.set(w.type, group);
    }
    return groups;
  }, [warnings]);

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

  // Header varies by phase and result state
  const hasShifts = generationResult && generationResult.shifts.length > 0;
  const header = (() => {
    if (phase !== 'results') {
      return {
        icon: <Sparkles className="h-5 w-5 text-violet-500" />,
        iconBg: 'bg-violet-500/10',
        title: 'Generate Schedule',
        subtitle: `AI will create shifts for ${formatDateRange(weekStart, weekEnd)}`,
      };
    }
    if (generationError) {
      return {
        icon: <Info className="h-5 w-5 text-amber-500" />,
        iconBg: 'bg-amber-500/10',
        title: 'Something Went Wrong',
        subtitle: 'The AI schedule generation failed',
      };
    }
    if (hasShifts) {
      return {
        icon: <CheckCircle2 className="h-5 w-5 text-green-500" />,
        iconBg: 'bg-green-500/10',
        title: 'Schedule Generated',
        subtitle: `${generationResult.shifts.length} shifts for ${formatDateRange(weekStart, weekEnd)}`,
      };
    }
    return {
      icon: <Info className="h-5 w-5 text-amber-500" />,
      iconBg: 'bg-amber-500/10',
      title: 'No Shifts Scheduled',
      subtitle: `No shifts could be created for ${formatDateRange(weekStart, weekEnd)}`,
    };
  })();

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto p-0 gap-0 border-border/40">
        {/* Header */}
        <DialogHeader className="px-6 pt-6 pb-4 border-b border-border/40">
          <div className="flex items-center gap-3">
            <div className={`h-10 w-10 rounded-xl ${header.iconBg} flex items-center justify-center`}>
              {header.icon}
            </div>
            <div>
              <DialogTitle className="text-[17px] font-semibold text-foreground">
                {header.title}
              </DialogTitle>
              <p className="text-[13px] text-muted-foreground mt-0.5">
                {header.subtitle}
              </p>
            </div>
          </div>
        </DialogHeader>

        {/* Config phase content */}
        {phase === 'config' && (
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

            {/* Section 3 — Pre-flight warnings */}
            {warningGroups.size > 0 && (
              <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 overflow-hidden">
                <div className="px-4 py-3 border-b border-amber-500/20 bg-amber-500/10">
                  <p className="text-[13px] font-semibold text-foreground">Scheduling Readiness</p>
                </div>
                <div className="p-4 space-y-3">
                  {Array.from(warningGroups.entries()).map(([type, group]) => (
                    <div key={type} className="space-y-1">
                      <div className="flex items-center gap-1.5">
                        <AlertTriangle className="h-3.5 w-3.5 text-amber-500 shrink-0" />
                        <span className="text-[13px] font-medium text-amber-600 dark:text-amber-400">
                          {group.items.length} {group.items.length === 1 ? 'employee' : 'employees'} — {group.label}
                        </span>
                      </div>
                      <div className="ml-5 space-y-0.5">
                        {group.items.map((w) => (
                          <p key={w.employeeId} className="text-[13px] text-muted-foreground">
                            <span className="font-medium text-foreground">{w.employeeName}</span>
                            {' — '}
                            {w.detail}
                          </p>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Generating phase content */}
        {phase === 'generating' && (
          <div className="px-6 py-10 flex flex-col items-center gap-3">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-muted-foreground/20 border-t-foreground" />
            <p className="text-[14px] text-muted-foreground">Generating schedule...</p>
          </div>
        )}

        {/* Results phase content */}
        {phase === 'results' && (
          <div className="px-6 py-5 space-y-4">
            {generationError ? (
              /* Error state */
              <div className="rounded-xl border border-destructive/20 bg-destructive/5 p-4">
                <p className="text-[14px] text-foreground font-medium">Generation failed</p>
                <p className="text-[13px] text-muted-foreground mt-1">
                  {generationError.message || 'An unexpected error occurred. Try again or build the schedule manually.'}
                </p>
              </div>
            ) : hasShifts ? (
              /* Success with shifts */
              <div className="space-y-4">
                <div className="rounded-xl border border-green-500/20 bg-green-500/5 p-4">
                  <p className="text-[14px] text-foreground font-medium">
                    {generationResult.shifts.length} shifts created — review and publish when ready.
                  </p>
                  {generationResult.metadata.budget_variance_pct > 0 && (
                    <p className="text-[13px] text-amber-600 dark:text-amber-400 mt-1">
                      Estimated cost is {generationResult.metadata.budget_variance_pct.toFixed(0)}% over budget.
                    </p>
                  )}
                  {generationResult.metadata.total_dropped > 0 && (
                    <p className="text-[13px] text-muted-foreground mt-1">
                      {generationResult.metadata.total_dropped} suggestions were filtered out.
                    </p>
                  )}
                </div>
                {generationResult.metadata.dropped_reasons.length > 0 && (
                  <div className="rounded-xl border border-border/40 bg-muted/30 p-4">
                    <p className="text-[13px] font-medium text-foreground mb-2">Dropped suggestions</p>
                    <ul className="space-y-1">
                      {generationResult.metadata.dropped_reasons.map((reason, i) => (
                        <li key={i} className="text-[13px] text-muted-foreground">
                          {reason}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                <p className="text-[12px] text-muted-foreground">
                  Model: {generationResult.metadata.model_used}
                </p>
              </div>
            ) : generationResult ? (
              /* Success but zero shifts */
              <div className="space-y-4">
                {generationResult.metadata.notes && (
                  <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4">
                    <p className="text-[14px] text-foreground font-medium">AI notes</p>
                    <p className="text-[13px] text-muted-foreground mt-1">
                      {generationResult.metadata.notes}
                    </p>
                  </div>
                )}
                {generationResult.metadata.dropped_reasons.length > 0 && (
                  <div className="rounded-xl border border-border/40 bg-muted/30 p-4">
                    <p className="text-[13px] font-medium text-foreground mb-2">Reasons</p>
                    <ul className="space-y-1">
                      {generationResult.metadata.dropped_reasons.map((reason, i) => (
                        <li key={i} className="text-[13px] text-muted-foreground">
                          {reason}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                <p className="text-[12px] text-muted-foreground">
                  Model: {generationResult.metadata.model_used}
                </p>
              </div>
            ) : null}
          </div>
        )}

        {/* Footer */}
        {phase === 'config' && (
          <div className="px-6 py-4 border-t border-border/40 flex justify-end gap-2">
            <Button
              variant="ghost"
              size="sm"
              className="h-9 px-4 rounded-lg text-[13px] font-medium text-muted-foreground hover:text-foreground"
              onClick={() => handleOpenChange(false)}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              className="h-9 px-4 rounded-lg bg-foreground text-background hover:bg-foreground/90 text-[13px] font-medium flex items-center gap-1.5"
              onClick={handleGenerate}
              aria-label="Generate schedule with AI"
            >
              <Sparkles className="h-4 w-4" />
              Generate
            </Button>
          </div>
        )}

        {phase === 'results' && (
          <div className="px-6 py-4 border-t border-border/40 flex justify-end gap-2">
            {(generationError || (generationResult && !hasShifts)) && (
              <Button
                variant="ghost"
                size="sm"
                className="h-9 px-4 rounded-lg text-[13px] font-medium text-muted-foreground hover:text-foreground"
                onClick={() => onOpenChange(true)}
                aria-label="Try generating again"
              >
                Try Again
              </Button>
            )}
            <Button
              size="sm"
              className="h-9 px-4 rounded-lg bg-foreground text-background hover:bg-foreground/90 text-[13px] font-medium"
              onClick={() => handleOpenChange(false)}
              aria-label="Close generation results"
            >
              {hasShifts ? 'Done' : 'Close'}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
