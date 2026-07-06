import { useMemo } from 'react';

import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { TimeInput } from '@/components/scheduling/TimeInput';
import { AlertTriangle } from 'lucide-react';

import { useCheckConflicts } from '@/hooks/useConflictDetection';
import { validateShift } from '@/lib/shiftValidator';
import { ShiftInterval } from '@/lib/shiftInterval';
import { minutesToIso, resolveOvernightMinutes } from '@/lib/shiftTimeMath';
import { rankEmployeesForShift } from '@/lib/employeeRanking';
import { formatConflictLine } from '@/lib/conflictFormatUtils';

import type { Employee, Shift } from '@/types/scheduling';

export interface TimelineShiftEditorValues {
  employeeId: string;
  startTime: string; // "HH:MM"
  endTime: string; // "HH:MM"
  breakDuration: string; // minutes, as a string for controlled <Input>
  notes: string;
}

export interface TimelineShiftEditorProps {
  /** 'edit' when editing an existing shift, 'create' for the quick-add flow. */
  readonly mode: 'edit' | 'create';
  /** The shift being edited, or null in create mode. Used for lane/position context and overlap exclusion. */
  readonly shift: Shift | null;
  readonly employees: Employee[];
  readonly restaurantId: string;
  /** Calendar date (YYYY-MM-DD) the shift belongs to, for conflict-check ISO construction. */
  readonly dateStr: string;
  /** Restaurant IANA timezone. */
  readonly tz: string;
  /** All shifts for the day (or wider window), used for local overlap/rest-gap warnings. */
  readonly existingShifts: Shift[];
  readonly values: TimelineShiftEditorValues;
  readonly onChange: (values: TimelineShiftEditorValues) => void;
  /** Optional lane context (position/area) to bias employee ranking in create mode. */
  readonly laneContext?: { position?: string | null; area?: string | null };
}

/**
 * Shared edit/create form for a single shift, rendered inside `TimelineShiftPopover`.
 * Pure controlled form: all state lives in the parent (`values` + `onChange`).
 *
 * Live advisory: reactive `useCheckConflicts` (server-side time-off/availability RPCs)
 * for the currently selected employee + times, plus local `validateShift` warnings
 * (overlap, clopen rest-gap, duration) computed from `existingShifts`. Both surface
 * as amber chips using the shared `AvailabilityConflictDialog` classes. All dynamic
 * advisory text is coalesced into a single `aria-live="polite"` region so a picker
 * interaction never produces multiple disjoint announcements.
 */
export function TimelineShiftEditor({
  mode,
  shift,
  employees,
  restaurantId,
  dateStr,
  tz,
  existingShifts,
  values,
  onChange,
  laneContext,
}: TimelineShiftEditorProps) {
  const activeEmployees = useMemo(
    () => employees.filter((emp) => emp.is_active),
    [employees],
  );

  const rankingContext = useMemo(
    () => ({
      position: laneContext?.position ?? shift?.position ?? null,
      area: laneContext?.area ?? null,
    }),
    [laneContext?.position, laneContext?.area, shift?.position],
  );

  const rankedEmployees = useMemo(
    () => rankEmployeesForShift(activeEmployees, rankingContext),
    [activeEmployees, rankingContext],
  );

  // Restaurant-local minutes-since-midnight for start/end, resolving overnight
  // shifts (end <= start) by rolling the end minutes past 1440 — the same
  // convention `minutesToIso` expects.
  const minutes = useMemo(() => {
    if (!values.startTime || !values.endTime) return null;
    return resolveOvernightMinutes(values.startTime, values.endTime);
  }, [values.startTime, values.endTime]);

  // ---------------------------------------------------------------------------
  // Live advisory: server-side conflicts (reactive, DI-free — same pattern as
  // ShiftDialog) for the currently selected employee + proposed times. ISO
  // instants are always built via minutesToIso (fromZonedTime), never a
  // host-local `new Date(...)` reconstruction, so a host TZ different from the
  // restaurant TZ can't silently shift the checked window.
  // ---------------------------------------------------------------------------
  const conflictParams = useMemo(() => {
    if (!values.employeeId || !minutes) return null;

    const startIso = minutesToIso(dateStr, minutes.startMin, tz);
    const endIso = minutesToIso(dateStr, minutes.endMin, tz);

    return {
      employeeId: values.employeeId,
      restaurantId,
      startTime: startIso,
      endTime: endIso,
    };
  }, [values.employeeId, minutes, dateStr, tz, restaurantId]);

  const { conflicts } = useCheckConflicts(conflictParams);

  // ---------------------------------------------------------------------------
  // Live advisory: local business-rule warnings (overlap, clopen rest-gap,
  // duration) via the shared validateShift, excluding the shift being edited.
  // ---------------------------------------------------------------------------
  const localWarnings = useMemo(() => {
    if (!values.employeeId || !minutes) return [];

    try {
      const startIso = minutesToIso(dateStr, minutes.startMin, tz);
      const endIso = minutesToIso(dateStr, minutes.endMin, tz);
      const interval = ShiftInterval.fromTimestamps(startIso, endIso, dateStr);
      const { warnings } = validateShift(
        { employeeId: values.employeeId, interval },
        existingShifts,
        { excludeShiftId: shift?.id },
      );
      return warnings;
    } catch {
      return [];
    }
  }, [values.employeeId, minutes, dateStr, tz, existingShifts, shift?.id]);

  const advisoryMessages = useMemo(() => {
    const conflictMessages = conflicts.map((c) => formatConflictLine(c, tz));
    const warningMessages = localWarnings.map((w) => w.message);
    return [...conflictMessages, ...warningMessages];
  }, [conflicts, localWarnings, tz]);

  const update = (patch: Partial<TimelineShiftEditorValues>) => {
    onChange({ ...values, ...patch });
  };

  return (
    <div className="space-y-4" data-mode={mode}>
      <div className="space-y-2">
        <Label htmlFor="timeline-editor-employee">
          Employee <span className="text-destructive">*</span>
        </Label>
        <Select
          value={values.employeeId}
          onValueChange={(value) => update({ employeeId: value })}
        >
          <SelectTrigger id="timeline-editor-employee" aria-label="Select employee">
            <SelectValue placeholder="Select employee" />
          </SelectTrigger>
          <SelectContent>
            {rankedEmployees.map((emp) => (
              <SelectItem key={emp.id} value={emp.id}>
                {emp.name} - {emp.position}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <TimeInput
          id="timeline-editor-start-time"
          label="Start Time"
          value={values.startTime}
          onChange={(value) => update({ startTime: value })}
        />
        <TimeInput
          id="timeline-editor-end-time"
          label="End Time"
          value={values.endTime}
          onChange={(value) => update({ endTime: value })}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="timeline-editor-break">Break (minutes)</Label>
        <Input
          id="timeline-editor-break"
          type="number"
          min="0"
          step="15"
          value={values.breakDuration}
          onChange={(e) => update({ breakDuration: e.target.value })}
          aria-label="Break duration in minutes"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="timeline-editor-notes">Notes</Label>
        <Textarea
          id="timeline-editor-notes"
          value={values.notes}
          onChange={(e) => update({ notes: e.target.value })}
          placeholder="Additional information about this shift..."
          rows={2}
          aria-label="Shift notes"
        />
      </div>

      {/* Single coalesced aria-live region: composes the "on shift" badge (owned
          by the caller, e.g. quick-add), async RPC conflicts, and local warnings
          into one announcement so a picker interaction never fires more than
          one live-region update. */}
      <div aria-live="polite" className="space-y-2">
        {advisoryMessages.map((message, index) => (
          <div
            key={`${index}-${message}`}
            className="flex items-start gap-2 p-2.5 rounded-lg bg-amber-500/10 border border-amber-500/20"
          >
            <AlertTriangle className="h-3.5 w-3.5 text-amber-500 mt-0.5 shrink-0" />
            <p className="text-[13px] text-foreground">{message}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
