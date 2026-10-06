import { memo, useCallback, useMemo, useRef, useState } from 'react';

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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

import { AlertTriangle, ArrowLeft, CalendarPlus, Copy, MoreHorizontal, Plus, Trash2, UserPlus, X } from 'lucide-react';

import type { DraftShift, DraftShiftInput, Employee, TemplateDraft } from '@/types/scheduling';

import { TemplateShiftDialog } from '@/components/scheduling/WeekTemplates/TemplateShiftDialog';
import {
  DAY_LABELS,
  DAY_NAMES,
  addEmployeeRow,
  addShifts,
  buildGrid,
  dayTotals,
  employeeHours,
  findOverlap,
  formatHours,
  formatShortTime,
  removeEmployeeRow,
  removeShift,
  updateShift,
} from '@/lib/weekTemplateDraft';
import { cn } from '@/lib/utils';

const DEFAULT_INPUT: Omit<DraftShiftInput, 'position'> = {
  start_time: '09:00:00',
  end_time: '17:00:00',
  break_duration: 30,
  notes: null,
};

type DialogState =
  | { mode: 'add'; employeeId: string; day: number }
  | { mode: 'edit'; employeeId: string; day: number; shift: DraftShift }
  | null;

interface RowInfo {
  id: string;
  name: string;
  position: string;
  inactive: boolean;
}

interface EditorRowProps {
  row: RowInfo;
  cells: DraftShift[][];
  hours: number;
  onAdd: (employeeId: string, day: number) => void;
  onEdit: (shift: DraftShift) => void;
  onRemove: (employeeId: string) => void;
}

function sameCells(a: DraftShift[][], b: DraftShift[][]): boolean {
  return a.every((cell, i) => cell.length === b[i].length && cell.every((s, j) => s === b[i][j]));
}

const EditorRow = memo(
  function EditorRow({ row, cells, hours, onAdd, onEdit, onRemove }: EditorRowProps) {
    return (
      <tr className="group border-b border-border/40 last:border-b-0">
        <th
          scope="row"
          className="sticky left-0 z-10 w-32 min-w-[8rem] bg-background px-3 py-2 text-left align-top font-normal"
        >
          <div className="flex items-start justify-between gap-1">
            <div className="min-w-0">
              <p className="text-[14px] font-medium text-foreground truncate">{row.name}</p>
              <p className="text-[12px] text-muted-foreground truncate">
                {row.inactive ? (
                  <span className="text-[11px] px-1.5 py-0.5 rounded-md bg-amber-500/10 text-amber-700 dark:text-amber-400">
                    Inactive
                  </span>
                ) : (
                  row.position
                )}
              </p>
            </div>
            <button
              type="button"
              onClick={() => onRemove(row.id)}
              aria-label={`Remove ${row.name} from template`}
              className="h-7 w-7 shrink-0 rounded-md flex items-center justify-center text-muted-foreground hover:text-destructive transition-colors lg:opacity-0 lg:group-hover:opacity-100 focus-visible:opacity-100"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </th>
        {cells.map((cell, day) => (
          <td key={DAY_LABELS[day]} className="min-w-[76px] px-1 py-2 align-top">
            <div className="flex flex-col gap-1">
              {cell.map((shift) => {
                const overnight = shift.end_time <= shift.start_time;
                const label = `${formatShortTime(shift.start_time)} to ${formatShortTime(shift.end_time)}`;
                return (
                  <button
                    key={shift.key}
                    type="button"
                    onClick={() => onEdit(shift)}
                    aria-label={`Edit shift: ${row.name}, ${DAY_NAMES[day]}, ${label}`}
                    className="text-left rounded-lg border border-border/40 bg-muted/30 hover:border-border px-2 py-1.5 transition-colors"
                  >
                    <span className="block text-[12px] font-medium text-foreground tabular-nums whitespace-nowrap">
                      {formatShortTime(shift.start_time)}–{formatShortTime(shift.end_time)}
                      {overnight && <span aria-hidden="true"> →</span>}
                    </span>
                    <span className="block text-[11px] text-muted-foreground truncate">{shift.position}</span>
                  </button>
                );
              })}
              <button
                type="button"
                onClick={() => onAdd(row.id, day)}
                aria-label={`Add shift for ${row.name} on ${DAY_NAMES[day]}`}
                className="h-7 rounded-lg border border-dashed border-border/60 text-muted-foreground hover:text-foreground hover:border-border flex items-center justify-center transition-colors lg:opacity-0 lg:group-hover:opacity-100 focus-visible:opacity-100"
              >
                <Plus className="h-3.5 w-3.5" />
              </button>
            </div>
          </td>
        ))}
        <td className="w-14 px-3 py-2 align-top text-right text-[13px] font-medium text-foreground tabular-nums">
          {formatHours(hours)}
        </td>
      </tr>
    );
  },
  (prev, next) =>
    prev.row.id === next.row.id &&
    prev.row.name === next.row.name &&
    prev.row.position === next.row.position &&
    prev.row.inactive === next.row.inactive &&
    prev.hours === next.hours &&
    prev.onAdd === next.onAdd &&
    prev.onEdit === next.onEdit &&
    prev.onRemove === next.onRemove &&
    sameCells(prev.cells, next.cells),
);

interface WeekTemplateEditorProps {
  draft: TemplateDraft;
  onDraftChange: (next: TemplateDraft) => void;
  /** Active employees of the restaurant. */
  employees: Employee[];
  employeesLoading: boolean;
  employeesError: boolean;
  onRetryEmployees: () => void;
  isDirty: boolean;
  isSaving: boolean;
  /** The server copy changed while this draft has unsaved changes. */
  changedElsewhere: boolean;
  onSave: () => void;
  onDiscard: () => void;
  onApply: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  /** Mobile only: go back to the template list. */
  onBack?: () => void;
}

export function WeekTemplateEditor({
  draft,
  onDraftChange,
  employees,
  employeesLoading,
  employeesError,
  onRetryEmployees,
  isDirty,
  isSaving,
  changedElsewhere,
  onSave,
  onDiscard,
  onApply,
  onDuplicate,
  onDelete,
  onBack,
}: Readonly<WeekTemplateEditorProps>) {
  const [dialog, setDialog] = useState<DialogState>(null);
  const [pendingRemoveId, setPendingRemoveId] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);

  const employeeById = useMemo(() => new Map(employees.map((e) => [e.id, e])), [employees]);

  const storedNames = useMemo(() => {
    const m = new Map<string, string>();
    for (const s of draft.shifts) if (!m.has(s.employee_id)) m.set(s.employee_id, s.employee_name);
    return m;
  }, [draft.shifts]);

  const rows: RowInfo[] = useMemo(
    () =>
      draft.rowEmployeeIds.map((id) => {
        const e = employeeById.get(id);
        return {
          id,
          name: e?.name ?? storedNames.get(id) ?? 'Unknown employee',
          position: e?.position ?? '',
          // Only claim "inactive" once the employee list has loaded.
          inactive: !e && !employeesLoading && !employeesError,
        };
      }),
    [draft.rowEmployeeIds, employeeById, storedNames, employeesLoading, employeesError],
  );
  const rowById = useMemo(() => new Map(rows.map((r) => [r.id, r])), [rows]);

  const grid = useMemo(() => buildGrid(draft), [draft]);
  const totals = useMemo(() => dayTotals(draft), [draft]);
  const hoursByEmployee = useMemo(() => employeeHours(draft), [draft]);
  const totalHours = useMemo(() => totals.reduce((sum, t) => sum + t.hours, 0), [totals]);

  const availableEmployees = useMemo(
    () => employees.filter((e) => !draft.rowEmployeeIds.includes(e.id)).sort((a, b) => a.name.localeCompare(b.name)),
    [employees, draft.rowEmployeeIds],
  );

  const handleAdd = useCallback((employeeId: string, day: number) => setDialog({ mode: 'add', employeeId, day }), []);
  const handleEdit = useCallback(
    (shift: DraftShift) => setDialog({ mode: 'edit', employeeId: shift.employee_id, day: shift.day_offset, shift }),
    [],
  );
  // A ref keeps handleRemove stable, so memoized rows do not render again on each edit.
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const handleRemove = useCallback(
    (employeeId: string) => {
      const current = draftRef.current;
      if (current.shifts.some((s) => s.employee_id === employeeId)) {
        setPendingRemoveId(employeeId);
      } else {
        onDraftChange(removeEmployeeRow(current, employeeId));
      }
    },
    [onDraftChange],
  );

  const dialogRow = dialog ? rowById.get(dialog.employeeId) : undefined;
  const dialogInitial: DraftShiftInput = useMemo(() => {
    if (!dialog) return { ...DEFAULT_INPUT, position: '' };
    if (dialog.mode === 'edit') {
      const { start_time, end_time, break_duration, position, notes } = dialog.shift;
      return { start_time, end_time, break_duration, position, notes };
    }
    return { ...DEFAULT_INPUT, position: employeeById.get(dialog.employeeId)?.position ?? '' };
  }, [dialog, employeeById]);

  const findOverlapDays = useCallback(
    (days: number[], start: string, end: string) => {
      if (!dialog) return [];
      const ignoreKey = dialog.mode === 'edit' ? dialog.shift.key : undefined;
      return days.filter((d) => findOverlap(draft, dialog.employeeId, d, start, end, ignoreKey) !== null);
    },
    [dialog, draft],
  );

  const handleDialogSubmit = (input: DraftShiftInput, days: number[]) => {
    if (!dialog || !dialogRow) return;
    if (dialog.mode === 'edit') {
      onDraftChange(updateShift(draft, dialog.shift.key, input));
    } else {
      onDraftChange(addShifts(draft, dialog.employeeId, dialogRow.name, input, days));
    }
    setDialog(null);
  };

  const handleDialogDelete = () => {
    if (dialog?.mode !== 'edit') return;
    onDraftChange(removeShift(draft, dialog.shift.key));
    setDialog(null);
  };

  const pendingRemoveRow = pendingRemoveId ? rowById.get(pendingRemoveId) : undefined;
  const hasShifts = draft.shifts.length > 0;
  const nameValid = draft.name.trim().length > 0;
  const canSave = hasShifts && nameValid && isDirty && !isSaving;
  const canApply = !!draft.id && !isDirty && !isSaving;

  let saveHint: string | null = null;
  if (!hasShifts) saveHint = 'Add at least one shift';
  else if (!nameValid) saveHint = 'Enter a template name';

  return (
    <section aria-label="Template editor" className="rounded-xl border border-border/40 bg-background min-w-0">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-b border-border/40">
        <div className="flex items-center gap-2 min-w-0 flex-[1_1_14rem]">
          {onBack && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={onBack}
              aria-label="Back to templates"
              className="h-9 w-9 rounded-lg lg:hidden"
            >
              <ArrowLeft className="h-4 w-4" />
            </Button>
          )}
          <Input
            aria-label="Template name"
            value={draft.name}
            maxLength={100}
            onChange={(e) => onDraftChange({ ...draft, name: e.target.value })}
            className="h-9 min-w-0 max-w-[280px] text-[15px] font-semibold bg-transparent border-transparent hover:border-border/40 focus-visible:border-border/40 focus-visible:ring-1 focus-visible:ring-border rounded-lg px-2"
          />
          {isDirty && (
            <span className="inline-flex items-center gap-1.5 text-[12px] font-medium text-amber-700 dark:text-amber-400 whitespace-nowrap">
              <span className="h-1.5 w-1.5 rounded-full bg-amber-500" aria-hidden="true" />
              Unsaved changes
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {isDirty && (
            <Button
              type="button"
              variant="ghost"
              onClick={onDiscard}
              disabled={isSaving}
              className="h-9 px-3 rounded-lg text-[13px] font-medium text-muted-foreground hover:text-foreground"
            >
              Discard
            </Button>
          )}
          <Button
            type="button"
            onClick={onSave}
            disabled={!canSave}
            className="h-9 px-4 rounded-lg bg-foreground text-background hover:bg-foreground/90 text-[13px] font-medium"
          >
            {isSaving ? 'Saving…' : 'Save'}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={onApply}
            disabled={!canApply}
            aria-label="Apply to week"
            className="h-9 px-3 rounded-lg text-[13px] font-medium border-border/40 hover:bg-muted/50 hover:text-foreground"
          >
            <CalendarPlus className="h-4 w-4 mr-1.5" />
            Apply to week…
          </Button>
          {draft.id && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label="Template actions"
                  className="h-9 w-9 rounded-lg"
                >
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={onDuplicate} disabled={isDirty}>
                  <Copy className="h-4 w-4 mr-2" />
                  Duplicate
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={onDelete} className="text-destructive focus:text-destructive">
                  <Trash2 className="h-4 w-4 mr-2" />
                  Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
        {(saveHint || (draft.id && isDirty)) && (
          <p className="basis-full text-[12px] text-muted-foreground">
            {saveHint ?? 'Save changes before you apply'}
          </p>
        )}
      </div>

      {changedElsewhere && (
        <div
          role="status"
          className="mx-4 mt-3 flex items-start gap-2 p-2.5 rounded-lg bg-amber-500/10 border border-amber-500/20 text-[13px] text-amber-700 dark:text-amber-400"
        >
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
          <span>This template changed in another session. Save will fail. Discard to load the new version.</span>
        </div>
      )}

      {/* Grid */}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] border-collapse">
          <thead>
            <tr className="border-b border-border/40">
              <th
                scope="col"
                className="sticky left-0 z-10 w-32 bg-background px-3 py-2.5 text-left text-[12px] font-medium text-muted-foreground uppercase tracking-wider"
              >
                Employee
              </th>
              {DAY_LABELS.map((label, day) => (
                <th
                  key={label}
                  scope="col"
                  className="px-1 py-2.5 text-left text-[12px] font-medium text-muted-foreground uppercase tracking-wider"
                >
                  <abbr title={DAY_NAMES[day]} className="no-underline">{label}</abbr>
                </th>
              ))}
              <th
                scope="col"
                className="w-14 px-3 py-2.5 text-right text-[12px] font-medium text-muted-foreground uppercase tracking-wider"
              >
                Hours
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={9} className="px-4 py-10 text-center text-[13px] text-muted-foreground">
                  Add an employee to start the template.
                </td>
              </tr>
            )}
            {rows.map((row) => (
              <EditorRow
                key={row.id}
                row={row}
                cells={grid.get(row.id) ?? []}
                hours={hoursByEmployee.get(row.id) ?? 0}
                onAdd={handleAdd}
                onEdit={handleEdit}
                onRemove={handleRemove}
              />
            ))}
          </tbody>
          {rows.length > 0 && (
            <tfoot>
              <tr className="border-t border-border/40 bg-muted/30">
                <th
                  scope="row"
                  className="sticky left-0 z-10 bg-muted px-3 py-2 text-left text-[12px] font-medium text-muted-foreground uppercase tracking-wider"
                >
                  Total
                </th>
                {totals.map((t, day) => (
                  <td key={DAY_LABELS[day]} className="px-1 py-2 text-[12px] text-muted-foreground tabular-nums whitespace-nowrap">
                    {t.count > 0 ? `${t.count} · ${formatHours(t.hours)}` : '—'}
                  </td>
                ))}
                <td className="px-3 py-2 text-right text-[13px] font-semibold text-foreground tabular-nums">
                  {formatHours(totalHours)}
                </td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      {/* Add employee */}
      <div className="px-4 py-3 border-t border-border/40">
        {employeesError ? (
          <div className="flex items-center gap-2 text-[13px] text-destructive">
            <span>Could not load employees.</span>
            <Button type="button" variant="ghost" onClick={onRetryEmployees} className="h-8 px-2 text-[13px]">
              Retry
            </Button>
          </div>
        ) : (
          <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
            <PopoverTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                disabled={employeesLoading || availableEmployees.length === 0}
                className="h-9 px-3 rounded-lg text-[13px] font-medium text-muted-foreground hover:text-foreground"
              >
                <UserPlus className="h-4 w-4 mr-1.5" />
                {employeesLoading ? 'Loading employees…' : 'Add employee'}
              </Button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-64 p-1 max-h-72 overflow-y-auto">
              <ul aria-label="Employees">
                {availableEmployees.map((e) => (
                  <li key={e.id}>
                    <button
                      type="button"
                      aria-label={`Add ${e.name} to template`}
                      onClick={() => {
                        onDraftChange(addEmployeeRow(draft, e.id));
                        setPickerOpen(false);
                      }}
                      className="w-full text-left px-2.5 py-2 rounded-md hover:bg-muted/50 focus-visible:bg-muted/50 outline-none"
                    >
                      <span className="block text-[14px] text-foreground">{e.name}</span>
                      <span className="block text-[12px] text-muted-foreground">{e.position}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </PopoverContent>
          </Popover>
        )}
      </div>

      {dialog && dialogRow && (
        <TemplateShiftDialog
          open
          onOpenChange={(open) => !open && setDialog(null)}
          mode={dialog.mode}
          employeeName={dialogRow.name}
          initial={dialogInitial}
          initialDay={dialog.day}
          findOverlapDays={findOverlapDays}
          onSubmit={handleDialogSubmit}
          onDelete={handleDialogDelete}
        />
      )}

      <AlertDialog open={!!pendingRemoveRow} onOpenChange={(open) => !open && setPendingRemoveId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="text-[17px] font-semibold">
              Remove {pendingRemoveRow?.name}?
            </AlertDialogTitle>
            <AlertDialogDescription className="text-[13px]">
              This deletes their shifts from this template. Live schedules do not change.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="h-9 rounded-lg text-[13px]">Cancel</AlertDialogCancel>
            <AlertDialogAction
              className={cn('h-9 rounded-lg text-[13px] bg-destructive text-destructive-foreground hover:bg-destructive/90')}
              onClick={() => {
                if (pendingRemoveId) onDraftChange(removeEmployeeRow(draft, pendingRemoveId));
                setPendingRemoveId(null);
              }}
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
