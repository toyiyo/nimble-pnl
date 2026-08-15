import { useState, useEffect, useMemo } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Shift, RecurrencePattern, RecurrenceType, ConflictCheck } from '@/types/scheduling';
import { formatConflictLine } from '@/lib/conflictFormatUtils';
import { useCreateShift, useUpdateShift, useUpdateShiftSeries } from '@/hooks/useShifts';
import { RecurringActionScope } from '@/utils/recurringShiftHelpers';
import { useEmployees } from '@/hooks/useEmployees';
import { useCheckConflicts } from '@/hooks/useConflictDetection';
import { format, getDay } from 'date-fns';
import { formatLocalDateInTz, formatLocalHHMMInTz, wallClockToInstant } from '@/lib/shiftInterval';
import { CustomRecurrenceDialog } from '@/components/CustomRecurrenceDialog';
import { getRecurrencePresetsForDate, getRecurrenceDescription } from '@/utils/recurrenceUtils';
import { AlertTriangle, Repeat } from 'lucide-react';
import { GuardShiftChangeOptions } from '@/hooks/usePublishedShiftGuard';

interface ShiftDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  shift?: Shift & { _editScope?: RecurringActionScope };
  restaurantId: string;
  timezone?: string; // Restaurant timezone for formatting availability times
  defaultDate?: Date;
  defaultEmployee?: DefaultEmployee;
  /**
   * Gate for a save that touches a published shift. The edit path always
   * routes through it — a create can never target a locked shift. Provided
   * once per page by `usePublishedShiftGuard`.
   */
  guardShiftChange: (options: GuardShiftChangeOptions) => void | Promise<void>;
}

export interface DefaultEmployee {
  id: string;
  name: string;
  position: string | null;
}

const POSITIONS = [
  'Server',
  'Cook',
  'Bartender',
  'Host',
  'Manager',
  'Dishwasher',
  'Chef',
  'Busser',
  'Other',
];

function getSubmitLabel(isSaving: boolean, isEditing: boolean): string {
  if (isSaving) return 'Saving...';
  if (isEditing) return 'Update Shift';
  return 'Create Shift';
}

export function ShiftDialog({ open, onOpenChange, shift, restaurantId, timezone = 'UTC', defaultDate, defaultEmployee, guardShiftChange }: ShiftDialogProps) {
  const [employeeId, setEmployeeId] = useState('');
  const [startDate, setStartDate] = useState('');
  const [startTime, setStartTime] = useState('');
  const [endDate, setEndDate] = useState('');
  const [endTime, setEndTime] = useState('');
  const [breakDuration, setBreakDuration] = useState('30');
  const [position, setPosition] = useState('Server');
  const [status, setStatus] = useState<'scheduled' | 'confirmed' | 'completed' | 'cancelled'>('scheduled');
  const [notes, setNotes] = useState('');
  const [recurrenceType, setRecurrenceType] = useState<RecurrenceType | 'none'>('none');
  const [recurrencePattern, setRecurrencePattern] = useState<RecurrencePattern | null>(null);
  const [customRecurrenceOpen, setCustomRecurrenceOpen] = useState(false);

  const { employees } = useEmployees(restaurantId);
  const createShift = useCreateShift({ tz: timezone });
  const updateShift = useUpdateShift();
  const updateShiftSeries = useUpdateShiftSeries();

  // Get the edit scope if editing a recurring shift
  const editScope = shift?._editScope;

  // Check for time-off and availability conflicts when employee and shift times are selected
  // This provides real-time feedback before the user submits the form
  const conflictParams = useMemo(() => {
    if (!employeeId || !startDate || !startTime || !endDate || !endTime) {
      return null;
    }

    try {
      const startDateTime = wallClockToInstant(startDate, startTime, timezone);
      const endDateTime = wallClockToInstant(endDate, endTime, timezone);

      if (endDateTime <= startDateTime) {
        return null;
      }

      return {
        employeeId,
        restaurantId,
        startTime: startDateTime.toISOString(),
        endTime: endDateTime.toISOString(),
      };
    } catch {
      // Malformed date/time/timezone input (e.g. mid-typing in the date fields) —
      // no conflict check rather than a render crash. See design §5.5.
      return null;
    }
  }, [employeeId, restaurantId, startDate, startTime, endDate, endTime, timezone]);

  const { conflicts, hasConflicts } = useCheckConflicts(conflictParams);

  useEffect(() => {
    if (shift) {
      const start = new Date(shift.start_time);
      const end = new Date(shift.end_time);

      setEmployeeId(shift.employee_id);
      setStartDate(formatLocalDateInTz(start, timezone));
      setStartTime(formatLocalHHMMInTz(shift.start_time, timezone));
      setEndDate(formatLocalDateInTz(end, timezone));
      setEndTime(formatLocalHHMMInTz(shift.end_time, timezone));
      setBreakDuration(shift.break_duration.toString());
      setPosition(shift.position);
      setStatus(shift.status);
      setNotes(shift.notes || '');
    } else {
      resetForm();
      if (defaultDate) {
        const dateStr = format(defaultDate, 'yyyy-MM-dd');
        setStartDate(dateStr);
        setEndDate(dateStr);
      }
      if (defaultEmployee) {
        setEmployeeId(defaultEmployee.id);
        if (defaultEmployee.position && POSITIONS.includes(defaultEmployee.position)) {
          setPosition(defaultEmployee.position);
        }
      }
    }
  }, [shift, defaultDate, defaultEmployee, open, timezone]);

  const resetForm = () => {
    setEmployeeId('');
    setStartDate('');
    setStartTime('09:00');
    setEndDate('');
    setEndTime('17:00');
    setBreakDuration('30');
    setPosition('Server');
    setStatus('scheduled');
    setNotes('');
    setRecurrenceType('none');
    setRecurrencePattern(null);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    // Validate employee selection
    if (!employeeId) {
      alert('Please select an employee');
      return;
    }

    // Validate and parse break duration
    const parsedBreak = parseInt(breakDuration, 10);
    if (Number.isNaN(parsedBreak) || parsedBreak < 0) {
      alert('Please enter a valid break duration (0 or greater)');
      return;
    }

    let startDateTime: Date;
    let endDateTime: Date;
    try {
      startDateTime = wallClockToInstant(startDate, startTime, timezone);
      endDateTime = wallClockToInstant(endDate, endTime, timezone);
    } catch {
      alert('Please enter a valid date, time, and restaurant timezone');
      return;
    }

    if (endDateTime <= startDateTime) {
      alert('End time must be after start time');
      return;
    }

    const shiftData = {
      restaurant_id: restaurantId,
      employee_id: employeeId,
      start_time: startDateTime.toISOString(),
      end_time: endDateTime.toISOString(),
      break_duration: parsedBreak,
      position,
      status,
      notes: notes || undefined,
      recurrence_pattern: recurrencePattern,
      is_recurring: recurrencePattern !== null,
      is_published: false,
      locked: false,
    };

    if (shift) {
      const employeeName = employees.find((emp) => emp.id === shift.employee_id)?.name ?? '';
      const isReassignment = employeeId !== shift.employee_id;
      const secondEmployeeName = isReassignment
        ? employees.find((emp) => emp.id === employeeId)?.name
        : undefined;

      guardShiftChange({
        shiftId: shift.id,
        employeeName,
        secondEmployeeName,
        // Awaited, not fire-and-forget `.mutate()` — `usePublishedShiftGuard`
        // looks up the change-log row right after `run` resolves, and that
        // row only exists once this UPDATE (and its trigger) have committed.
        run: async ({ allowPublished }) => {
          // If we have an edit scope (from recurring action dialog), use series update
          if (editScope && editScope !== 'this') {
            await updateShiftSeries.mutateAsync({
              shift,
              scope: editScope,
              updates: shiftData,
              restaurantId,
              allowPublished,
            });
          } else {
            await updateShift.mutateAsync({ id: shift.id, ...shiftData, allowPublished });
          }
          onOpenChange(false);
          resetForm();
        },
      });
    } else {
      createShift.mutate(shiftData as any, {
        onSuccess: () => {
          onOpenChange(false);
          resetForm();
        },
      });
    }
  };

  const handleRecurrenceChange = (value: string) => {
    if (value === 'Does not repeat') {
      setRecurrenceType('none');
      setRecurrencePattern(null);
    } else if (value === 'Custom...') {
      setRecurrenceType('custom');
      setCustomRecurrenceOpen(true);
    } else {
      // Find preset pattern from current date's presets
      const currentDate = startDate ? new Date(startDate) : new Date();
      const presets = getRecurrencePresetsForDate(currentDate);
      const preset = presets.find(p => p.label === value);
      
      if (preset && preset.pattern) {
        setRecurrenceType(preset.value as RecurrenceType);
        setRecurrencePattern(preset.pattern as RecurrencePattern);
      }
    }
  };

  const handleCustomRecurrenceSave = (pattern: RecurrencePattern) => {
    setRecurrencePattern(pattern);
    setRecurrenceType(pattern.type);
  };

  // Generate recurrence presets based on selected date
  const recurrencePresets = useMemo(() => {
    const currentDate = startDate ? new Date(startDate) : new Date();
    return getRecurrencePresetsForDate(currentDate);
  }, [startDate]);

  const activeEmployees = employees.filter((emp) => emp.is_active);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {shift ? 'Edit Shift' : 'Create New Shift'}
            {editScope && editScope !== 'this' && (
              <span className="inline-flex items-center gap-1 text-xs font-normal bg-primary/10 text-primary px-2 py-0.5 rounded-full">
                <Repeat className="h-3 w-3" />
                {editScope === 'following' ? 'This & following' : 'All in series'}
              </span>
            )}
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="employee">
                Employee <span className="text-destructive">*</span>
              </Label>
              <Select value={employeeId} onValueChange={setEmployeeId} required disabled={!!defaultEmployee && !shift}>
                <SelectTrigger id="employee" aria-label="Select employee">
                  <SelectValue placeholder="Select employee" />
                </SelectTrigger>
                <SelectContent>
                  {activeEmployees.map((emp) => (
                    <SelectItem key={emp.id} value={emp.id}>
                      {emp.name} - {emp.position}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="position">
                Position <span className="text-destructive">*</span>
              </Label>
              <Select value={position} onValueChange={setPosition} required>
                <SelectTrigger id="position" aria-label="Select position">
                  <SelectValue placeholder="Select position" />
                </SelectTrigger>
                <SelectContent>
                  {POSITIONS.map((pos) => (
                    <SelectItem key={pos} value={pos}>
                      {pos}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="startDate">
                  Start Date <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="startDate"
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  required
                  aria-label="Shift start date"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="startTime">
                  Start Time <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="startTime"
                  type="time"
                  value={startTime}
                  onChange={(e) => setStartTime(e.target.value)}
                  required
                  aria-label="Shift start time"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="endDate">
                  End Date <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="endDate"
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  required
                  aria-label="Shift end date"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="endTime">
                  End Time <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="endTime"
                  type="time"
                  value={endTime}
                  onChange={(e) => setEndTime(e.target.value)}
                  required
                  aria-label="Shift end time"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="breakDuration">Break Duration (minutes)</Label>
                <Input
                  id="breakDuration"
                  type="number"
                  min="0"
                  step="15"
                  value={breakDuration}
                  onChange={(e) => setBreakDuration(e.target.value)}
                  aria-label="Break duration in minutes"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="status">Status</Label>
                <Select value={status} onValueChange={(value) => setStatus(value as typeof status)}>
                  <SelectTrigger id="status" aria-label="Shift status">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="scheduled">Scheduled</SelectItem>
                    <SelectItem value="confirmed">Confirmed</SelectItem>
                    <SelectItem value="completed">Completed</SelectItem>
                    <SelectItem value="cancelled">Cancelled</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Conflict Warnings */}
            {hasConflicts && (
              <div className="space-y-2">
                <p className="text-[13px] font-semibold text-foreground">Scheduling conflicts detected:</p>
                {conflicts.map((conflict) => {
                  const conflictKey = conflict.time_off_id
                    ? `timeoff-${conflict.time_off_id}`
                    : `${conflict.conflict_type}-${conflict.message}`;
                  return (
                    <div key={conflictKey} className="flex items-start gap-2 p-2.5 rounded-lg bg-amber-500/10 border border-amber-500/20">
                      <AlertTriangle className="h-3.5 w-3.5 text-amber-500 mt-0.5 shrink-0" />
                      <p className="text-[13px] text-foreground">{formatConflictLine(conflict, timezone)}</p>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Recurrence Selection - Only show for new shifts */}
            {!shift && (
              <div className="space-y-2">
                <Label htmlFor="recurrence">Repeat</Label>
                <Select 
                  value={recurrencePattern ? getRecurrenceDescription(recurrencePattern) : 'Does not repeat'} 
                  onValueChange={handleRecurrenceChange}
                >
                  <SelectTrigger id="recurrence" aria-label="Repeat pattern">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {recurrencePresets.map((preset) => (
                      <SelectItem key={preset.label} value={preset.label}>
                        {preset.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {recurrencePattern && (
                  <p className="text-sm text-muted-foreground">
                    {getRecurrenceDescription(recurrencePattern)}
                  </p>
                )}
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="notes">Notes</Label>
              <Textarea
                id="notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Additional information about this shift..."
                rows={3}
                aria-label="Shift notes"
              />
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={createShift.isPending || updateShift.isPending || updateShiftSeries.isPending}
            >
              {getSubmitLabel(
                createShift.isPending || updateShift.isPending || updateShiftSeries.isPending,
                !!shift,
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>

      {/* Custom Recurrence Dialog */}
      <CustomRecurrenceDialog
        open={customRecurrenceOpen}
        onOpenChange={setCustomRecurrenceOpen}
        onSave={handleCustomRecurrenceSave}
        initialPattern={recurrencePattern || undefined}
        startDate={startDate ? new Date(startDate) : new Date()}
      />
    </Dialog>
  );
}
