import { useCallback, useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';

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
import { Skeleton } from '@/components/ui/skeleton';

import { useEmployees } from '@/hooks/useEmployees';
import { MAX_SCHEDULE_PLAN_TEMPLATES, useSchedulePlanTemplates } from '@/hooks/useSchedulePlanTemplates';

import type { SchedulePlanTemplate, TemplateDraft } from '@/types/scheduling';

import { ApplyWeekTemplateDialog } from '@/components/scheduling/WeekTemplates/ApplyWeekTemplateDialog';
import { WeekTemplateEditor } from '@/components/scheduling/WeekTemplates/WeekTemplateEditor';
import { WeekTemplateList } from '@/components/scheduling/WeekTemplates/WeekTemplateList';
import type { TemplateMergeMode } from '@/components/scheduling/TemplateApplyFields';
import { draftFromTemplate, emptyDraft, isDraftDirty, toSnapshot } from '@/lib/weekTemplateDraft';
import { cn } from '@/lib/utils';

interface WeekTemplatesTabProps {
  restaurantId: string;
  /** Reports unsaved changes so the page can guard a tab change. */
  onDirtyChange: (dirty: boolean) => void;
  /** Opens the Schedule tab on the given week. */
  onViewWeek: (monday: Date) => void;
}

/**
 * True when the server copy is newer than the version the draft started from.
 * After our own save the list can still hold the older copy until it refetches,
 * so an older or equal server copy never counts as a change.
 */
function isNewer(server: string, base: string): boolean {
  return Date.parse(server) > Date.parse(base);
}

type PendingAction = { run: () => void } | null;

export function WeekTemplatesTab({ restaurantId, onDirtyChange, onViewWeek }: Readonly<WeekTemplatesTabProps>) {
  const queryClient = useQueryClient();
  const {
    templates,
    isLoading,
    error,
    createTemplate,
    updateTemplate,
    applyTemplate,
    deleteTemplate,
  } = useSchedulePlanTemplates(restaurantId);
  const { employees, loading: employeesLoading, error: employeesError } = useEmployees(restaurantId);

  /** Template id, 'new' for an unsaved draft, or null. */
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<TemplateDraft | null>(null);
  /** The saved version the draft compares against. null for a new draft. */
  const [baseline, setBaseline] = useState<SchedulePlanTemplate | null>(null);
  const [mobileView, setMobileView] = useState<'list' | 'editor'>('list');
  const [pendingAction, setPendingAction] = useState<PendingAction>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [applyOpen, setApplyOpen] = useState(false);

  const isDirty = draft ? isDraftDirty(draft, baseline) : false;

  const serverTemplate = useMemo(
    () => (selectedId && selectedId !== 'new' ? templates.find((t) => t.id === selectedId) ?? null : null),
    [templates, selectedId],
  );
  const changedElsewhere =
    isDirty && !!serverTemplate && !!baseline && isNewer(serverTemplate.updated_at, baseline.updated_at);

  const loadTemplate = useCallback((t: SchedulePlanTemplate) => {
    setSelectedId(t.id);
    setBaseline(t);
    setDraft(draftFromTemplate(t));
  }, []);

  // Select the first template once the list loads.
  useEffect(() => {
    if (selectedId === null && templates.length > 0) loadTemplate(templates[0]);
  }, [selectedId, templates, loadTemplate]);

  // The server copy changed in another session. A clean draft takes the new version. A dirty draft keeps the user's edits
  // and shows the changed-elsewhere notice instead.
  useEffect(() => {
    if (!serverTemplate || !baseline || isDirty) return;
    if (isNewer(serverTemplate.updated_at, baseline.updated_at)) loadTemplate(serverTemplate);
  }, [serverTemplate, baseline, isDirty, loadTemplate]);

  useEffect(() => {
    onDirtyChange(isDirty);
  }, [isDirty, onDirtyChange]);

  // Clear the page-level flag when the tab unmounts.
  useEffect(() => () => onDirtyChange(false), [onDirtyChange]);

  useEffect(() => {
    if (!isDirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [isDirty]);

  const guard = useCallback(
    (run: () => void) => {
      if (isDirty) setPendingAction({ run });
      else run();
    },
    [isDirty],
  );

  const nameById = useMemo(() => new Map(employees.map((e) => [e.id, e.name])), [employees]);

  const handleSelect = (id: string) => {
    if (id === selectedId) {
      setMobileView('editor');
      return;
    }
    guard(() => {
      const t = templates.find((x) => x.id === id);
      if (t) loadTemplate(t);
      setMobileView('editor');
    });
  };

  const handleNew = () =>
    guard(() => {
      setSelectedId('new');
      setBaseline(null);
      setDraft(emptyDraft());
      setMobileView('editor');
    });

  const baselineFromSave = (d: TemplateDraft, id: string, updatedAt: string, name: string): SchedulePlanTemplate => {
    const shifts = toSnapshot(d, nameById);
    return {
      id,
      restaurant_id: restaurantId,
      name,
      shifts,
      shift_count: shifts.length,
      created_at: baseline?.created_at ?? updatedAt,
      updated_at: updatedAt,
    };
  };

  const handleSave = async () => {
    if (!draft) return;
    const name = draft.name.trim();
    const shifts = toSnapshot(draft, nameById);
    try {
      const saved =
        draft.id && draft.updatedAt
          ? await updateTemplate.mutateAsync({ id: draft.id, name, shifts, expectedUpdatedAt: draft.updatedAt })
          : await createTemplate.mutateAsync({ name, shifts });
      const next = baselineFromSave({ ...draft, name: saved.name }, saved.id, saved.updated_at, saved.name);
      setSelectedId(saved.id);
      setBaseline(next);
      setDraft({ ...draft, id: saved.id, name: saved.name, updatedAt: saved.updated_at });
    } catch {
      // The hook shows the error toast. Keep the draft.
    }
  };

  const handleDiscard = () => {
    if (baseline) {
      // Prefer the newest server copy, so Discard also clears the changed-elsewhere notice.
      loadTemplate(serverTemplate ?? baseline);
      return;
    }
    setDraft(null);
    setSelectedId(null);
    setMobileView('list');
  };

  const handleDuplicate = async () => {
    if (!draft || !baseline) return;
    const name = `${baseline.name} (copy)`.slice(0, 100);
    const shifts = toSnapshot(draft, nameById);
    try {
      const saved = await createTemplate.mutateAsync({ name, shifts });
      const copy = baselineFromSave(draft, saved.id, saved.updated_at, saved.name);
      loadTemplate(copy);
    } catch {
      // Toast from the hook.
    }
  };

  const handleDelete = () => {
    if (!draft?.id) return;
    deleteTemplate.mutate(draft.id, {
      onSuccess: () => {
        setConfirmDelete(false);
        const rest = templates.filter((t) => t.id !== draft.id);
        if (rest.length > 0) loadTemplate(rest[0]);
        else {
          setSelectedId(null);
          setDraft(null);
          setBaseline(null);
        }
        setMobileView('list');
      },
    });
  };

  const handleApply = (targetMonday: Date, mergeMode: TemplateMergeMode) => {
    if (!baseline) return Promise.reject(new Error('Save the template first'));
    return applyTemplate.mutateAsync({ template: baseline, targetMonday, mergeMode });
  };

  const retryTemplates = () => queryClient.invalidateQueries({ queryKey: ['schedule-plan-templates', restaurantId] });
  const retryEmployees = () => queryClient.invalidateQueries({ queryKey: ['employees', restaurantId] });

  const showEditor = !!draft;

  return (
    <div className="grid gap-4 lg:grid-cols-[260px_minmax(0,1fr)] items-start">
      <div className={cn(mobileView === 'editor' && showEditor && 'hidden lg:block')}>
        <WeekTemplateList
          templates={templates}
          selectedId={selectedId}
          newDraftName={selectedId === 'new' && draft ? draft.name || 'Untitled template' : null}
          isLoading={isLoading}
          hasError={!!error}
          onRetry={retryTemplates}
          onSelect={handleSelect}
          onNew={handleNew}
          maxTemplates={MAX_SCHEDULE_PLAN_TEMPLATES}
        />
      </div>

      <div className={cn('min-w-0', mobileView === 'list' && 'hidden lg:block')}>
        {isLoading ? (
          <Skeleton className="h-80 w-full rounded-xl" />
        ) : showEditor ? (
          <WeekTemplateEditor
            draft={draft}
            onDraftChange={setDraft}
            employees={employees}
            employeesLoading={employeesLoading}
            employeesError={!!employeesError}
            onRetryEmployees={retryEmployees}
            isDirty={isDirty}
            isSaving={createTemplate.isPending || updateTemplate.isPending}
            changedElsewhere={changedElsewhere}
            onSave={handleSave}
            onDiscard={handleDiscard}
            onApply={() => setApplyOpen(true)}
            onDuplicate={handleDuplicate}
            onDelete={() => setConfirmDelete(true)}
            onBack={() => setMobileView('list')}
          />
        ) : (
          <div className="hidden lg:flex h-80 items-center justify-center rounded-xl border border-dashed border-border/60 text-[13px] text-muted-foreground">
            Select a template, or create a new one.
          </div>
        )}
      </div>

      {baseline && (
        <ApplyWeekTemplateDialog
          open={applyOpen}
          onOpenChange={setApplyOpen}
          template={baseline}
          onApply={handleApply}
          isPending={applyTemplate.isPending}
          onViewWeek={(monday) => {
            setApplyOpen(false);
            onViewWeek(monday);
          }}
        />
      )}

      <AlertDialog open={!!pendingAction} onOpenChange={(open) => !open && setPendingAction(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="text-[17px] font-semibold">Discard unsaved changes?</AlertDialogTitle>
            <AlertDialogDescription className="text-[13px]">
              Your changes to “{draft?.name}” are not saved.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="h-9 rounded-lg text-[13px]">Keep editing</AlertDialogCancel>
            <AlertDialogAction
              className="h-9 rounded-lg text-[13px] bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                const action = pendingAction;
                setPendingAction(null);
                action?.run();
              }}
            >
              Discard changes
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="text-[17px] font-semibold">Delete “{draft?.name}”?</AlertDialogTitle>
            <AlertDialogDescription className="text-[13px]">
              This deletes the template. Shifts that you already applied stay on the schedule.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="h-9 rounded-lg text-[13px]" disabled={deleteTemplate.isPending}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              className="h-9 rounded-lg text-[13px] bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={deleteTemplate.isPending}
              onClick={(e) => {
                e.preventDefault();
                handleDelete();
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
