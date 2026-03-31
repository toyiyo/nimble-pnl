import { useState, useMemo, useEffect, useCallback } from 'react';

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Input } from '@/components/ui/input';

import { Copy, AlertTriangle, Save, Trash2, Layers } from 'lucide-react';

import { supabase } from '@/integrations/supabase/client';
import { useSchedulePlanTemplates } from '@/hooks/useSchedulePlanTemplates';
import { getMondayOfWeek, getWeekEnd } from '@/hooks/useShiftPlanner';

import type { Shift, SchedulePlanTemplate } from '@/types/scheduling';

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

type TabId = 'copy' | 'templates';
type MergeMode = 'replace' | 'merge';

const MAX_TEMPLATES = 5;

function formatRange(start: Date, end: Date): string {
  const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' };
  return `${start.toLocaleDateString('en-US', opts)} – ${end.toLocaleDateString('en-US', opts)}`;
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function checkIsPastWeek(monday: Date | null): boolean {
  if (!monday) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return getWeekEnd(monday) < today;
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
  // --- Tab state ---
  const [activeTab, setActiveTab] = useState<TabId>('copy');

  // --- Copy tab state (existing) ---
  const [selectedDate, setSelectedDate] = useState<Date | undefined>();
  const [targetShiftCount, setTargetShiftCount] = useState<number | null>(null);

  // --- Template tab state ---
  const [templateSelectedDate, setTemplateSelectedDate] = useState<Date | undefined>();
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);
  const [mergeMode, setMergeMode] = useState<MergeMode>('replace');
  const [deletingTemplateId, setDeletingTemplateId] = useState<string | null>(null);

  // --- Save as template state ---
  const [showSaveForm, setShowSaveForm] = useState(false);
  const [templateName, setTemplateName] = useState('');

  // --- Hook ---
  const {
    templates,
    isLoading: templatesLoading,
    saveTemplate,
    applyTemplate,
    deleteTemplate,
  } = useSchedulePlanTemplates(restaurantId);

  // --- Derived values (copy tab) ---
  const targetMonday = useMemo(
    () => (selectedDate ? getMondayOfWeek(selectedDate) : null),
    [selectedDate],
  );

  const targetEnd = targetMonday ? getWeekEnd(targetMonday) : null;

  const activeShiftCount = useMemo(
    () => shifts.filter((s) => s.status !== 'cancelled').length,
    [shifts],
  );

  const isSameWeek = targetMonday?.getTime() === sourceWeekStart.getTime();
  const isPastWeek = checkIsPastWeek(targetMonday);

  // --- Derived values (template tab) ---
  const templateTargetMonday = useMemo(
    () => (templateSelectedDate ? getMondayOfWeek(templateSelectedDate) : null),
    [templateSelectedDate],
  );

  const templateTargetEnd = templateTargetMonday ? getWeekEnd(templateTargetMonday) : null;
  const isTemplatePastWeek = checkIsPastWeek(templateTargetMonday);

  const selectedTemplate = useMemo(
    () => templates.find((t) => t.id === selectedTemplateId) ?? null,
    [templates, selectedTemplateId],
  );

  const canApplyTemplate = selectedTemplate && templateTargetMonday && !isTemplatePastWeek;

  const atTemplateLimit = templates.length >= MAX_TEMPLATES;
  const canSaveTemplate = activeShiftCount > 0 && !atTemplateLimit;

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

  const handleConfirm = useCallback(() => {
    if (!targetMonday) return;
    onConfirm(targetMonday);
  }, [targetMonday, onConfirm]);

  const handleOpenChange = useCallback((nextOpen: boolean) => {
    if (!nextOpen) {
      setSelectedDate(undefined);
      setTargetShiftCount(null);
      setActiveTab('copy');
      setSelectedTemplateId(null);
      setTemplateSelectedDate(undefined);
      setMergeMode('replace');
      setDeletingTemplateId(null);
      setShowSaveForm(false);
      setTemplateName('');
    }
    onOpenChange(nextOpen);
  }, [onOpenChange]);

  // --- Save template ---
  const handleSaveTemplate = useCallback(() => {
    const trimmed = templateName.trim();
    if (!trimmed) return;
    saveTemplate.mutate(
      { name: trimmed, shifts, weekStart: sourceWeekStart },
      {
        onSuccess: () => {
          setShowSaveForm(false);
          setTemplateName('');
          setActiveTab('templates');
        },
      },
    );
  }, [templateName, shifts, sourceWeekStart, saveTemplate]);

  // --- Apply template ---
  const handleApplyTemplate = useCallback(() => {
    if (!selectedTemplate || !templateTargetMonday) return;
    applyTemplate.mutate(
      { template: selectedTemplate, targetMonday: templateTargetMonday, mergeMode },
      {
        onSuccess: () => {
          handleOpenChange(false);
        },
      },
    );
  }, [selectedTemplate, templateTargetMonday, mergeMode, applyTemplate, handleOpenChange]);

  // --- Delete template ---
  const handleDeleteTemplate = useCallback((templateId: string) => {
    deleteTemplate.mutate(templateId, {
      onSuccess: () => {
        setDeletingTemplateId(null);
        if (selectedTemplateId === templateId) {
          setSelectedTemplateId(null);
        }
      },
    });
  }, [deleteTemplate, selectedTemplateId]);

  // --- Template row click ---
  const handleTemplateClick = useCallback((templateId: string) => {
    setSelectedTemplateId((prev) => (prev === templateId ? null : templateId));
    setDeletingTemplateId(null);
  }, []);

  const handleTemplateKeyDown = useCallback((e: React.KeyboardEvent, templateId: string) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      handleTemplateClick(templateId);
    }
  }, [handleTemplateClick]);

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
                Copy Schedule
              </DialogTitle>
              <p className="text-[13px] text-muted-foreground mt-0.5">
                {formatRange(sourceWeekStart, sourceWeekEnd)}
              </p>
            </div>
          </div>
        </DialogHeader>

        {/* Save as Template (shared between tabs) */}
        <div className="px-6 pt-4">
          {!showSaveForm ? (
            <button
              type="button"
              onClick={() => setShowSaveForm(true)}
              disabled={!canSaveTemplate || saveTemplate.isPending}
              className="w-full flex items-center justify-center gap-2 p-3 rounded-lg border border-dashed border-border/60 text-[13px] font-medium text-muted-foreground hover:text-foreground hover:border-border transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              aria-label="Save current week as template"
            >
              <Save className="h-4 w-4" />
              Save current week as template
            </button>
          ) : (
            <div className="flex items-center gap-2 p-3 rounded-lg border border-border/40 bg-muted/30">
              <Input
                value={templateName}
                onChange={(e) => setTemplateName(e.target.value)}
                placeholder="Template name"
                className="h-9 text-[14px] bg-background border-border/40 rounded-lg flex-1"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleSaveTemplate();
                  if (e.key === 'Escape') {
                    setShowSaveForm(false);
                    setTemplateName('');
                  }
                }}
                aria-label="Template name"
              />
              <Button
                size="sm"
                className="h-9 px-3 rounded-lg bg-foreground text-background hover:bg-foreground/90 text-[13px] font-medium"
                onClick={handleSaveTemplate}
                disabled={!templateName.trim() || saveTemplate.isPending}
              >
                {saveTemplate.isPending ? 'Saving...' : 'Save'}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-9 px-3 rounded-lg text-[13px] font-medium text-muted-foreground hover:text-foreground"
                onClick={() => {
                  setShowSaveForm(false);
                  setTemplateName('');
                }}
                disabled={saveTemplate.isPending}
              >
                Cancel
              </Button>
            </div>
          )}
          {atTemplateLimit && !showSaveForm && (
            <p className="text-[11px] text-muted-foreground mt-1.5">
              Maximum {MAX_TEMPLATES} templates reached. Delete one to save a new template.
            </p>
          )}
        </div>

        {/* Apple-style underline tabs */}
        <div className="px-6 pt-3 border-b border-border/40" role="tablist" aria-label="Schedule options">
          <button
            role="tab"
            aria-selected={activeTab === 'copy'}
            aria-controls="panel-copy"
            onClick={() => setActiveTab('copy')}
            className={`relative px-0 py-3 mr-6 text-[14px] font-medium transition-colors ${
              activeTab === 'copy' ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            Copy from Week
            {activeTab === 'copy' && (
              <div className="absolute bottom-0 left-0 right-0 h-[2px] bg-foreground" />
            )}
          </button>
          <button
            role="tab"
            aria-selected={activeTab === 'templates'}
            aria-controls="panel-templates"
            onClick={() => setActiveTab('templates')}
            className={`relative px-0 py-3 mr-6 text-[14px] font-medium transition-colors ${
              activeTab === 'templates' ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            Templates
            {templates.length > 0 && (
              <span className="text-[11px] px-1.5 py-0.5 rounded-md bg-muted ml-1.5">
                {templates.length}
              </span>
            )}
            {activeTab === 'templates' && (
              <div className="absolute bottom-0 left-0 right-0 h-[2px] bg-foreground" />
            )}
          </button>
        </div>

        {/* ===== Copy from Week tab ===== */}
        {activeTab === 'copy' && (
          <div id="panel-copy" role="tabpanel" aria-labelledby="tab-copy">
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

            {/* Footer (copy tab) */}
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
          </div>
        )}

        {/* ===== Templates tab ===== */}
        {activeTab === 'templates' && (
          <div id="panel-templates" role="tabpanel" aria-labelledby="tab-templates">
            <div className="px-6 py-5 space-y-4">
              {/* Template list */}
              {templatesLoading ? (
                <div className="flex items-center justify-center py-8">
                  <p className="text-[13px] text-muted-foreground">Loading templates...</p>
                </div>
              ) : templates.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-8 gap-3">
                  <div className="h-12 w-12 rounded-xl bg-muted/50 flex items-center justify-center">
                    <Layers className="h-6 w-6 text-muted-foreground" />
                  </div>
                  <p className="text-[13px] text-muted-foreground">No saved templates yet</p>
                </div>
              ) : (
                <div className="space-y-2">
                  <p className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider">
                    Saved templates
                  </p>
                  {templates.map((tmpl) => (
                    <div key={tmpl.id}>
                      {deletingTemplateId === tmpl.id ? (
                        /* Delete confirmation inline */
                        <div className="flex items-center justify-between p-3 rounded-xl border border-destructive/30 bg-destructive/5">
                          <p className="text-[13px] text-destructive">Delete this template?</p>
                          <div className="flex gap-2">
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 px-3 rounded-lg text-[12px] font-medium text-destructive hover:text-destructive/80"
                              onClick={() => handleDeleteTemplate(tmpl.id)}
                              disabled={deleteTemplate.isPending}
                            >
                              Delete
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 px-3 rounded-lg text-[12px] font-medium text-muted-foreground hover:text-foreground"
                              onClick={() => setDeletingTemplateId(null)}
                              disabled={deleteTemplate.isPending}
                            >
                              Keep
                            </Button>
                          </div>
                        </div>
                      ) : (
                        /* Template row */
                        <div
                          role="button"
                          tabIndex={0}
                          onClick={() => handleTemplateClick(tmpl.id)}
                          onKeyDown={(e) => handleTemplateKeyDown(e, tmpl.id)}
                          className={`group flex items-center justify-between p-3 rounded-xl border transition-colors cursor-pointer ${
                            selectedTemplateId === tmpl.id
                              ? 'border-foreground/30 bg-muted/50'
                              : 'border-border/40 bg-background hover:border-border'
                          }`}
                        >
                          <div className="min-w-0 flex-1">
                            <p className="text-[14px] font-medium text-foreground truncate">
                              {tmpl.name}
                            </p>
                            <p className="text-[12px] text-muted-foreground mt-0.5">
                              {tmpl.shift_count} {tmpl.shift_count === 1 ? 'shift' : 'shifts'} · {formatDate(tmpl.created_at)}
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setDeletingTemplateId(tmpl.id);
                            }}
                            className="opacity-0 group-hover:opacity-100 transition-opacity p-1.5 rounded-lg hover:bg-destructive/10"
                            aria-label={`Delete template ${tmpl.name}`}
                          >
                            <Trash2 className="h-4 w-4 text-muted-foreground hover:text-destructive" />
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* Apply options (only when a template is selected) */}
              {selectedTemplate && (
                <div className="space-y-4 pt-2">
                  {/* Target week picker */}
                  <div>
                    <p className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider mb-3">
                      Apply to week
                    </p>
                    <div className="flex justify-center">
                      <Calendar
                        mode="single"
                        selected={templateSelectedDate}
                        onSelect={setTemplateSelectedDate}
                        className="rounded-lg border border-border/40"
                      />
                    </div>
                  </div>

                  {templateTargetMonday && templateTargetEnd && (
                    <div className="flex items-center justify-between p-3 rounded-lg bg-muted/30 border border-border/40">
                      <span className="text-[13px] text-muted-foreground">Target week</span>
                      <span className="text-[13px] font-medium text-foreground">
                        {formatRange(templateTargetMonday, templateTargetEnd)}
                      </span>
                    </div>
                  )}

                  {isTemplatePastWeek && templateTargetMonday && (
                    <div className="flex items-center gap-2 p-2.5 rounded-lg bg-destructive/10 border border-destructive/20">
                      <AlertTriangle className="h-4 w-4 text-destructive shrink-0" />
                      <p className="text-[12px] text-destructive">Cannot apply to a past week.</p>
                    </div>
                  )}

                  {/* Merge mode */}
                  <div>
                    <p className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider mb-2">
                      Mode
                    </p>
                    <div className="space-y-2">
                      <label className="flex items-center gap-3 p-3 rounded-lg border border-border/40 cursor-pointer hover:border-border transition-colors">
                        <input
                          type="radio"
                          name="mergeMode"
                          value="replace"
                          checked={mergeMode === 'replace'}
                          onChange={() => setMergeMode('replace')}
                          className="accent-foreground"
                        />
                        <div>
                          <p className="text-[14px] font-medium text-foreground">Replace existing</p>
                          <p className="text-[12px] text-muted-foreground">Remove all unlocked shifts in the target week first</p>
                        </div>
                      </label>
                      <label className="flex items-center gap-3 p-3 rounded-lg border border-border/40 cursor-pointer hover:border-border transition-colors">
                        <input
                          type="radio"
                          name="mergeMode"
                          value="merge"
                          checked={mergeMode === 'merge'}
                          onChange={() => setMergeMode('merge')}
                          className="accent-foreground"
                        />
                        <div>
                          <p className="text-[14px] font-medium text-foreground">Merge with existing</p>
                          <p className="text-[12px] text-muted-foreground">Add template shifts alongside existing ones</p>
                        </div>
                      </label>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Footer (templates tab) */}
            <div className="px-6 py-4 border-t border-border/40 flex justify-end gap-2">
              <Button
                variant="ghost"
                size="sm"
                className="h-9 px-4 rounded-lg text-[13px] font-medium text-muted-foreground hover:text-foreground"
                onClick={() => handleOpenChange(false)}
                disabled={applyTemplate.isPending}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                className="h-9 px-4 rounded-lg bg-foreground text-background hover:bg-foreground/90 text-[13px] font-medium"
                onClick={handleApplyTemplate}
                disabled={!canApplyTemplate || applyTemplate.isPending}
                aria-label="Apply selected template"
              >
                {applyTemplate.isPending
                  ? 'Applying...'
                  : `Apply ${selectedTemplate ? selectedTemplate.name : 'Template'}`}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
