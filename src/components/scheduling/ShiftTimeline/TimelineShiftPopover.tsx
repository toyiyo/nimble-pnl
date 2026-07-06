import { useCallback, useEffect, useMemo, useState } from 'react';

import {
  Popover,
  PopoverAnchor,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Lock, AlertTriangle } from 'lucide-react';

import { minutesToCompact, isoToLocalMinutes } from '@/lib/shiftCoverage';
import { calculateShiftHours } from '@/lib/scheduleRoster';
import { minutesToIso } from '@/lib/shiftTimeMath';
import { AvailabilityConflictDialog } from '@/components/scheduling/ShiftPlanner/AvailabilityConflictDialog';
import { TimelineShiftEditor, type TimelineShiftEditorValues } from './TimelineShiftEditor';

import type { Shift, Employee, ConflictCheck } from '@/types/scheduling';
import type { ValidationIssue } from '@/lib/shiftValidator';
import type { ValidationResult } from '@/lib/shiftValidator';
import type {
  UpdateTimeOutcome,
  CreateAtTimeOutcome,
  CreateAtTimeInput,
} from '@/hooks/useValidatedShiftMutations';

/** Minimal shape needed to anchor the Radix popper to an arbitrary rect. */
interface VirtualAnchor {
  getBoundingClientRect: () => DOMRect;
}

/** Prefilled draft for the paint-to-create quick-add flow — mutually exclusive with `activeShift`. */
export interface TimelineCreateDraft {
  values: TimelineShiftEditorValues;
  laneContext: { position?: string | null; area?: string | null };
  /** The calendar date (YYYY-MM-DD) the draft's times are relative to. */
  businessDate: string;
}

interface TimelineShiftPopoverProps {
  /** The currently active shift to show, or null when none is selected. */
  readonly activeShift: Shift | null;
  /** Prefilled create-mode draft (paint-to-create quick-add), or null/absent when not in create mode. */
  readonly createDraft?: TimelineCreateDraft | null;
  /** Restaurant IANA timezone for displaying local times. */
  readonly tz: string;
  /** The calendar date string (YYYY-MM-DD) of the selected day. */
  readonly dateStr: string;
  /** All employees for the restaurant, forwarded to TimelineShiftEditor. */
  readonly employees: Employee[];
  /** Restaurant ID, forwarded to TimelineShiftEditor's conflict checks. */
  readonly restaurantId: string;
  /** All shifts for the day, used for local overlap/rest-gap warnings while editing. */
  readonly dayShifts: Shift[];
  /** Called when the popover is closed or dismissed. */
  readonly onClose: () => void;
  /** Validate a time-change; returns pending issues instead of throwing. */
  readonly validateAndUpdateTime: (input: {
    shift: Shift;
    startIso: string;
    endIso: string;
    businessDate: string;
  }) => Promise<UpdateTimeOutcome>;
  /** Force-apply a time change after the user confirms the conflict dialog. */
  readonly forceUpdateTime: (input: {
    shift: Shift;
    startIso: string;
    endIso: string;
    businessDate: string;
  }) => Promise<boolean>;
  /** Validate a create-at-time (quick-add) request; returns pending issues instead of throwing. */
  readonly validateAndCreateAtTime?: (input: CreateAtTimeInput) => Promise<CreateAtTimeOutcome>;
  /** Force-apply a create-at-time request after the user confirms the conflict dialog. */
  readonly forceCreateAtTime?: (input: CreateAtTimeInput) => Promise<boolean>;
  /** Delete a shift by id (immediate — the confirm gate lives in this component for published shifts). */
  readonly deleteShift: (shiftId: string) => void;
  /** Surfaced validation errors (e.g. a thrown lock/interval error) from the pipeline hook. */
  readonly validationResult: ValidationResult | null;
  /** Clears `validationResult` — called when the popover closes or edit mode is cancelled. */
  readonly clearValidation: () => void;
  /**
   * Virtual anchor rect for the interacted element (bar / ghost / gap segment).
   * When absent, the popover falls back to the invisible zero-size trigger.
   */
  readonly anchorRect?: DOMRect | null;
  /** The scrollable plot container, used as the Radix collision boundary. */
  readonly collisionBoundary?: Element | null;
}

/** Parse "HH:MM" into minutes-since-midnight. */
function timeToMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
}

/** Format minutes-since-midnight (may be >= 1440 for overnight) as 24h "HH:MM" for TimeInput. */
function minutesToHHMM(min: number): string {
  const norm = ((min % 1440) + 1440) % 1440;
  const h = Math.floor(norm / 60);
  const m = norm % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** Build the initial editor values from a shift + the day's timezone. */
function shiftToEditorValues(shift: Shift, dateStr: string, tz: string): TimelineShiftEditorValues {
  const startMin = isoToLocalMinutes(shift.start_time, dateStr, tz);
  let endMin = isoToLocalMinutes(shift.end_time, dateStr, tz);
  if (endMin <= startMin) endMin += 1440;

  return {
    employeeId: shift.employee_id,
    startTime: minutesToHHMM(startMin),
    endTime: minutesToHHMM(endMin),
    breakDuration: String(shift.break_duration ?? 0),
    notes: shift.notes ?? '',
  };
}

/**
 * A single shadcn Popover that shows the details of the active shift (view mode) and,
 * on Edit, swaps in `TimelineShiftEditor` for a full edit form (edit mode).
 *
 * Per the CLAUDE.md single-dialog pattern, this is ONE instance rendered at the
 * container level (ShiftTimelineTab), controlled by `activeShift` state.  Each
 * shift bar sets the active shift via `onSelect`; this component opens/closes
 * based on whether `activeShift` is non-null.
 *
 * Anchoring: bound to the interacted element's rect (`anchorRect`) via Radix
 * `PopoverAnchor`'s `virtualRef`; falls back to the legacy zero-size trigger
 * when no rect is supplied yet (e.g. tests, or before B3 wires rect capture).
 * `modal={false}` so it never traps focus or blocks the page; the scrollable
 * plot region is passed as `collisionBoundary` so positioning stays correct
 * inside `overflow-x-auto`.
 *
 * Conflict-dialog stacking: when Save surfaces pending issues, this component
 * stays mounted and open (still in edit mode) behind `AvailabilityConflictDialog`.
 * Escape/outside-click on the popover is suppressed while the conflict dialog is
 * open (Radix Dialog owns its own Escape handling and is topmost); confirming
 * calls `forceUpdateTime` and then closes the popover, cancelling returns to the
 * edit form without closing anything.
 */
export function TimelineShiftPopover({
  activeShift,
  createDraft,
  tz,
  dateStr,
  employees,
  restaurantId,
  dayShifts,
  onClose,
  validateAndUpdateTime,
  forceUpdateTime,
  validateAndCreateAtTime,
  forceCreateAtTime,
  deleteShift,
  validationResult,
  clearValidation,
  anchorRect,
  collisionBoundary,
}: TimelineShiftPopoverProps) {
  const [mode, setMode] = useState<'view' | 'edit'>('view');
  const [editValues, setEditValues] = useState<TimelineShiftEditorValues | null>(null);
  const [createValues, setCreateValues] = useState<TimelineShiftEditorValues | null>(
    createDraft?.values ?? null,
  );
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [pendingIssues, setPendingIssues] = useState<{
    conflicts: ConflictCheck[];
    warnings: ValidationIssue[];
  } | null>(null);
  const [saving, setSaving] = useState(false);

  const virtualAnchorRef = useMemo<{ current: VirtualAnchor | null }>(
    () => ({
      current: anchorRect
        ? { getBoundingClientRect: () => anchorRect }
        : null,
    }),
    [anchorRect],
  );

  const resetLocalState = useCallback(() => {
    setMode('view');
    setEditValues(null);
    setShowDeleteConfirm(false);
    setPendingIssues(null);
    setSaving(false);
    clearValidation();
  }, [clearValidation]);

  const handleClose = useCallback(() => {
    resetLocalState();
    onClose();
  }, [resetLocalState, onClose]);

  // Re-seed create-mode local state whenever the caller stages a fresh draft
  // (a new paint gesture) — keeps the form controlled by `createValues` alone
  // once mounted, so an in-progress create form isn't left dangling if a new
  // draft replaces the old one while the popover is open.
  useEffect(() => {
    setCreateValues(createDraft?.values ?? null);
    setPendingIssues(null);
     
  }, [createDraft]);

  const isCreateMode = !activeShift && Boolean(createDraft);

  if (!activeShift && !createDraft) return null;

  if (isCreateMode) {
    return (
      <TimelineCreatePopoverContent
        createDraft={createDraft as TimelineCreateDraft}
        createValues={createValues}
        onChangeValues={setCreateValues}
        tz={tz}
        employees={employees}
        restaurantId={restaurantId}
        dayShifts={dayShifts}
        anchorRect={anchorRect ?? null}
        collisionBoundary={collisionBoundary}
        virtualAnchorRef={virtualAnchorRef}
        validateAndCreateAtTime={validateAndCreateAtTime}
        forceCreateAtTime={forceCreateAtTime}
        pendingIssues={pendingIssues}
        setPendingIssues={setPendingIssues}
        saving={saving}
        setSaving={setSaving}
        onClose={handleClose}
      />
    );
  }

  if (!activeShift) return null;

  const leftMin = isoToLocalMinutes(activeShift.start_time, dateStr, tz);
  let endMin = isoToLocalMinutes(activeShift.end_time, dateStr, tz);
  if (endMin <= leftMin) endMin += 1440;

  const startLabel = minutesToCompact(leftMin);
  const endLabel = minutesToCompact(endMin % 1440);
  const hours = calculateShiftHours(activeShift).toFixed(1);

  const statusLabel =
    activeShift.status.charAt(0).toUpperCase() + activeShift.status.slice(1);

  const isLocked = activeShift.locked;
  const isRecurring = Boolean(activeShift.is_recurring);

  const handleEditClick = () => {
    setEditValues(shiftToEditorValues(activeShift, dateStr, tz));
    setMode('edit');
  };

  const handleCancelEdit = () => {
    setMode('view');
    setEditValues(null);
    clearValidation();
  };

  const handleDeleteClick = () => {
    if (activeShift.is_published) {
      setShowDeleteConfirm(true);
    } else {
      deleteShift(activeShift.id);
      handleClose();
    }
  };

  const handleConfirmDelete = (event: React.MouseEvent<HTMLButtonElement>) => {
    // AlertDialogAction is Radix's Dialog.Close: without preventDefault it
    // closes the dialog synchronously on click, before the mutation resolves.
    event.preventDefault();
    deleteShift(activeShift.id);
    setShowDeleteConfirm(false);
    handleClose();
  };

  const handleSave = async () => {
    if (!editValues) return;

    const startMin = timeToMinutes(editValues.startTime);
    let endMinValue = timeToMinutes(editValues.endTime);
    if (endMinValue <= startMin) endMinValue += 1440;

    const startIso = minutesToIso(dateStr, startMin, tz);
    const endIso = minutesToIso(dateStr, endMinValue, tz);

    setSaving(true);
    try {
      const outcome = await validateAndUpdateTime({
        shift: activeShift,
        startIso,
        endIso,
        businessDate: dateStr,
      });

      if (outcome.updated) {
        handleClose();
        return;
      }

      if (outcome.pendingConflicts?.length || outcome.pendingWarnings?.length) {
        setPendingIssues({
          conflicts: outcome.pendingConflicts ?? [],
          warnings: outcome.pendingWarnings ?? [],
        });
      }
    } finally {
      setSaving(false);
    }
  };

  const handleConfirmConflicts = async () => {
    if (!editValues) return;

    const startMin = timeToMinutes(editValues.startTime);
    let endMinValue = timeToMinutes(editValues.endTime);
    if (endMinValue <= startMin) endMinValue += 1440;

    const startIso = minutesToIso(dateStr, startMin, tz);
    const endIso = minutesToIso(dateStr, endMinValue, tz);

    setSaving(true);
    try {
      const ok = await forceUpdateTime({
        shift: activeShift,
        startIso,
        endIso,
        businessDate: dateStr,
      });

      if (ok) {
        setPendingIssues(null);
        handleClose();
      }
    } finally {
      setSaving(false);
    }
  };

  const handleCancelConflicts = () => {
    setPendingIssues(null);
  };

  const conflictDialogOpen = pendingIssues !== null;
  const conflictDialogData = pendingIssues
    ? {
        employeeName:
          employees.find((e) => e.id === editValues?.employeeId)?.name ?? 'This employee',
        conflicts: pendingIssues.conflicts,
        warnings: pendingIssues.warnings,
      }
    : null;

  return (
    <>
      <Popover
        open
        modal={false}
        onOpenChange={(open) => {
          // Suppress outside-click/Escape dismissal while a stacked dialog (the
          // conflict dialog or the published-delete confirm) is on top — the
          // popover only closes via handleClose (Save success, confirm-delete,
          // or the caller's own onClose). Without this guard, the stacked
          // dialog's portal/overlay registers as an "outside interaction" and
          // Radix would close (and reset) the popover out from under it.
          if (!open && !conflictDialogOpen && !showDeleteConfirm) handleClose();
        }}
      >
        {anchorRect ? (
          <PopoverAnchor virtualRef={virtualAnchorRef as unknown as React.RefObject<VirtualAnchor>} />
        ) : (
          // Zero-size invisible trigger fallback so Radix always has an anchor,
          // even before a caller supplies a virtual anchor rect.
          <PopoverTrigger asChild>
            <span className="sr-only" />
          </PopoverTrigger>
        )}

        <PopoverContent
          className="w-72 p-0 gap-0 border-border/40"
          align="center"
          sideOffset={8}
          collisionBoundary={collisionBoundary ?? undefined}
        >
          {mode === 'view' ? (
            <>
              {/* Header */}
              <div className="px-4 pt-4 pb-3 border-b border-border/40">
                <div className="flex items-center gap-2">
                  <p className="text-[14px] font-semibold text-foreground truncate">
                    {activeShift.position}
                  </p>
                  {isLocked && (
                    <Lock
                      className="h-3.5 w-3.5 text-muted-foreground shrink-0"
                      aria-label="Locked shift"
                    />
                  )}
                </div>
                <p className="text-[12px] text-muted-foreground mt-0.5">
                  {startLabel} – {endLabel} · {hours}h
                </p>
              </div>

              {/* Details */}
              <div className="px-4 py-3 space-y-2">
                {activeShift.notes && (
                  <Row label="Notes" value={activeShift.notes} />
                )}
                <Row label="Status" value={statusLabel} />
                <Row label="Hours" value={`${hours}h`} />
              </div>

              {isRecurring && (
                <div className="mx-4 mb-3 flex items-start gap-2 p-2.5 rounded-lg bg-muted/50 border border-border/40">
                  <p className="text-[12px] text-muted-foreground">
                    Changes apply to this shift only
                  </p>
                </div>
              )}

              {/* Footer actions */}
              <div className="px-4 py-3 border-t border-border/40 flex items-center justify-end gap-2">
                <Button
                  variant="ghost"
                  disabled={isLocked}
                  onClick={handleDeleteClick}
                  className="h-9 px-4 rounded-lg text-[13px] font-medium text-destructive hover:text-destructive/80"
                >
                  Delete
                </Button>
                <Button
                  disabled={isLocked}
                  onClick={handleEditClick}
                  className="h-9 px-4 rounded-lg bg-foreground text-background hover:bg-foreground/90 text-[13px] font-medium"
                >
                  Edit
                </Button>
              </div>
            </>
          ) : (
            <>
              <div className="px-4 pt-4 pb-3 border-b border-border/40">
                <p className="text-[14px] font-semibold text-foreground">Edit shift</p>
                {isRecurring && (
                  <p className="text-[12px] text-muted-foreground mt-0.5">
                    Changes apply to this shift only
                  </p>
                )}
              </div>

              <div className="px-4 py-4">
                {editValues && (
                  <TimelineShiftEditor
                    mode="edit"
                    shift={activeShift}
                    employees={employees}
                    restaurantId={restaurantId}
                    dateStr={dateStr}
                    tz={tz}
                    existingShifts={dayShifts}
                    values={editValues}
                    onChange={setEditValues}
                  />
                )}

                {validationResult?.errors && validationResult.errors.length > 0 && (
                  <div className="mt-3 flex items-start gap-2 p-2.5 rounded-lg bg-destructive/10 border border-destructive/20">
                    <AlertTriangle className="h-3.5 w-3.5 text-destructive mt-0.5 shrink-0" />
                    <p className="text-[13px] text-foreground">
                      {validationResult.errors[0].message}
                    </p>
                  </div>
                )}
              </div>

              <div className="px-4 py-3 border-t border-border/40 flex items-center justify-end gap-2">
                <Button
                  variant="ghost"
                  onClick={handleCancelEdit}
                  disabled={saving}
                  className="h-9 px-4 rounded-lg text-[13px] font-medium text-muted-foreground hover:text-foreground"
                >
                  Cancel
                </Button>
                <Button
                  onClick={handleSave}
                  disabled={saving}
                  className="h-9 px-4 rounded-lg bg-foreground text-background hover:bg-foreground/90 text-[13px] font-medium"
                >
                  Save
                </Button>
              </div>
            </>
          )}
        </PopoverContent>
      </Popover>

      {/* Conflict-dialog stacking: rendered while this popover is still mounted
          and open, so Save issues never close the underlying edit form. */}
      <AvailabilityConflictDialog
        open={conflictDialogOpen}
        data={conflictDialogData}
        timezone={tz}
        onConfirm={handleConfirmConflicts}
        onCancel={handleCancelConflicts}
      />

      {/* Published-shift delete confirm — event.preventDefault() in
          handleConfirmDelete keeps the dialog open until the mutation is
          dispatched, matching DeleteRecipeDialog's convention. */}
      <AlertDialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete shift</AlertDialogTitle>
            <AlertDialogDescription>
              This shift has already been published and the employee may have seen it.
              Are you sure you want to delete it?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete shift
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function Row({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider">
        {label}
      </span>
      <span className="text-[13px] text-foreground">{value}</span>
    </div>
  );
}

interface TimelineCreatePopoverContentProps {
  readonly createDraft: TimelineCreateDraft;
  readonly createValues: TimelineShiftEditorValues | null;
  readonly onChangeValues: (values: TimelineShiftEditorValues) => void;
  readonly tz: string;
  readonly employees: Employee[];
  readonly restaurantId: string;
  readonly dayShifts: Shift[];
  readonly anchorRect: DOMRect | null;
  readonly collisionBoundary?: Element | null;
  readonly virtualAnchorRef: { current: VirtualAnchor | null };
  readonly validateAndCreateAtTime?: (input: CreateAtTimeInput) => Promise<CreateAtTimeOutcome>;
  readonly forceCreateAtTime?: (input: CreateAtTimeInput) => Promise<boolean>;
  readonly pendingIssues: { conflicts: ConflictCheck[]; warnings: ValidationIssue[] } | null;
  readonly setPendingIssues: (
    issues: { conflicts: ConflictCheck[]; warnings: ValidationIssue[] } | null,
  ) => void;
  readonly saving: boolean;
  readonly setSaving: (saving: boolean) => void;
  readonly onClose: () => void;
}

/**
 * Create-mode variant of the single Timeline popover instance (Stage C3). Rendered by
 * `TimelineShiftPopover` when `createDraft` is present and `activeShift` is null — mutually
 * exclusive with the view/edit branch, so only one `Popover` is ever mounted.
 *
 * Resolves the shift's `position` at commit time: the lane's own position (position-grouped
 * lane) wins; otherwise falls back to the selected employee's `position` (area-grouped lane,
 * where a shift's area is derived from its employee rather than stored directly).
 */
function TimelineCreatePopoverContent({
  createDraft,
  createValues,
  onChangeValues,
  tz,
  employees,
  restaurantId,
  dayShifts,
  anchorRect,
  collisionBoundary,
  virtualAnchorRef,
  validateAndCreateAtTime,
  forceCreateAtTime,
  pendingIssues,
  setPendingIssues,
  saving,
  setSaving,
  onClose,
}: TimelineCreatePopoverContentProps) {
  const { businessDate, laneContext } = createDraft;

  const resolvePosition = useCallback(
    (values: TimelineShiftEditorValues): string => {
      if (laneContext.position) return laneContext.position;
      const employee = employees.find((e) => e.id === values.employeeId);
      return employee?.position ?? '';
    },
    [laneContext.position, employees],
  );

  const buildIso = useCallback(
    (values: TimelineShiftEditorValues) => {
      const startMin = timeToMinutes(values.startTime);
      let endMinValue = timeToMinutes(values.endTime);
      if (endMinValue <= startMin) endMinValue += 1440;

      return {
        startIso: minutesToIso(businessDate, startMin, tz),
        endIso: minutesToIso(businessDate, endMinValue, tz),
      };
    },
    [businessDate, tz],
  );

  const buildCreateInput = useCallback(
    (values: TimelineShiftEditorValues): CreateAtTimeInput => {
      const { startIso, endIso } = buildIso(values);
      return {
        employeeId: values.employeeId,
        startIso,
        endIso,
        businessDate,
        position: resolvePosition(values),
        breakDuration: Number(values.breakDuration) || 0,
        notes: values.notes,
      };
    },
    [buildIso, businessDate, resolvePosition],
  );

  const handleAdd = async () => {
    if (!createValues || !validateAndCreateAtTime) return;

    setSaving(true);
    try {
      const outcome = await validateAndCreateAtTime(buildCreateInput(createValues));

      if (outcome.created) {
        onClose();
        return;
      }

      if (outcome.pendingConflicts?.length || outcome.pendingWarnings?.length) {
        setPendingIssues({
          conflicts: outcome.pendingConflicts ?? [],
          warnings: outcome.pendingWarnings ?? [],
        });
      }
    } finally {
      setSaving(false);
    }
  };

  const handleConfirmConflicts = async () => {
    if (!createValues || !forceCreateAtTime) return;

    setSaving(true);
    try {
      const ok = await forceCreateAtTime(buildCreateInput(createValues));

      if (ok) {
        setPendingIssues(null);
        onClose();
      }
    } finally {
      setSaving(false);
    }
  };

  const handleCancelConflicts = () => {
    setPendingIssues(null);
  };

  const conflictDialogOpen = pendingIssues !== null;
  const conflictDialogData = pendingIssues
    ? {
        employeeName:
          employees.find((e) => e.id === createValues?.employeeId)?.name ?? 'This employee',
        conflicts: pendingIssues.conflicts,
        warnings: pendingIssues.warnings,
      }
    : null;

  const subtitle = laneContext.position || laneContext.area || null;

  return (
    <>
      <Popover
        open
        modal={false}
        onOpenChange={(open) => {
          if (!open && !conflictDialogOpen) onClose();
        }}
      >
        {anchorRect ? (
          <PopoverAnchor virtualRef={virtualAnchorRef as unknown as React.RefObject<VirtualAnchor>} />
        ) : (
          <PopoverTrigger asChild>
            <span className="sr-only" />
          </PopoverTrigger>
        )}

        <PopoverContent
          className="w-72 p-0 gap-0 border-border/40"
          align="center"
          sideOffset={8}
          collisionBoundary={collisionBoundary ?? undefined}
        >
          <div className="px-4 pt-4 pb-3 border-b border-border/40">
            <p className="text-[14px] font-semibold text-foreground">New shift</p>
            {subtitle && (
              <p className="text-[12px] text-muted-foreground mt-0.5">{subtitle}</p>
            )}
          </div>

          <div className="px-4 py-4">
            {createValues && (
              <TimelineShiftEditor
                mode="create"
                shift={null}
                employees={employees}
                restaurantId={restaurantId}
                dateStr={businessDate}
                tz={tz}
                existingShifts={dayShifts}
                values={createValues}
                onChange={onChangeValues}
                laneContext={laneContext}
              />
            )}
          </div>

          <div className="px-4 py-3 border-t border-border/40 flex items-center justify-end gap-2">
            <Button
              variant="ghost"
              onClick={onClose}
              disabled={saving}
              className="h-9 px-4 rounded-lg text-[13px] font-medium text-muted-foreground hover:text-foreground"
            >
              Cancel
            </Button>
            <Button
              onClick={handleAdd}
              disabled={saving || !createValues?.employeeId}
              className="h-9 px-4 rounded-lg bg-foreground text-background hover:bg-foreground/90 text-[13px] font-medium"
            >
              Add shift
            </Button>
          </div>
        </PopoverContent>
      </Popover>

      <AvailabilityConflictDialog
        open={conflictDialogOpen}
        data={conflictDialogData}
        timezone={tz}
        onConfirm={handleConfirmConflicts}
        onCancel={handleCancelConflicts}
      />
    </>
  );
}
