import { useState, useCallback, useMemo } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';

import { Plus, Star, Settings, Trash2, CalendarDays } from 'lucide-react';

import {
  useWeekTemplates,
  useCreateWeekTemplate,
  useSetActiveTemplate,
  useWeekTemplateSlots,
  useRemoveTemplateSlot,
} from '@/hooks/useWeekTemplates';
import { useShiftDefinitions } from '@/hooks/useShiftDefinitions';
import { useEmployeePositions } from '@/hooks/useEmployeePositions';

import { WeekTemplateSlot } from '@/types/scheduling';

import { cn } from '@/lib/utils';

import { AddSlotDialog } from './AddSlotDialog';
import { ShiftDefinitionsManager } from './ShiftDefinitionsManager';

// ---------------------------------------------------------------------------
// Constants & helpers
// ---------------------------------------------------------------------------

// Column order: Mon(1), Tue(2), Wed(3), Thu(4), Fri(5), Sat(6), Sun(0)
const COLUMN_DAYS = [1, 2, 3, 4, 5, 6, 0] as const;
const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function formatTime(time: string): string {
  const [h, m] = time.split(':').map(Number);
  const period = h >= 12 ? 'PM' : 'AM';
  const hour12 = h % 12 || 12;
  return `${hour12}:${String(m).padStart(2, '0')} ${period}`;
}

/** Calculate hours between two HH:MM times (supports overnight). */
function hoursForSlot(start: string, end: string, breakMin: number): number {
  const [sh, sm] = start.split(':').map(Number);
  const [eh, em] = end.split(':').map(Number);
  let diff = eh * 60 + em - (sh * 60 + sm);
  if (diff <= 0) diff += 24 * 60; // overnight
  return Math.max(0, (diff - breakMin) / 60);
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface WeekTemplateBuilderProps {
  restaurantId: string;
  onGenerateSchedule: (templateId: string, weekStartDate: string) => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function WeekTemplateBuilder({
  restaurantId,
  onGenerateSchedule,
}: WeekTemplateBuilderProps) {
  // Data hooks
  const { templates, isLoading: templatesLoading } = useWeekTemplates(restaurantId);
  const { definitions } = useShiftDefinitions(restaurantId);
  const { positions } = useEmployeePositions(restaurantId);

  // Selected template
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>('');

  // Resolve selected template (prefer explicit selection, fall back to active)
  const resolvedTemplateId = useMemo(() => {
    if (selectedTemplateId && templates.find((t) => t.id === selectedTemplateId)) {
      return selectedTemplateId;
    }
    const active = templates.find((t) => t.is_active);
    return active?.id ?? templates[0]?.id ?? '';
  }, [selectedTemplateId, templates]);

  // Sync selection when resolved changes
  const handleTemplateChange = useCallback((val: string) => {
    setSelectedTemplateId(val);
  }, []);

  // Slots for current template
  const { slots, isLoading: slotsLoading } = useWeekTemplateSlots(resolvedTemplateId || null);

  // Mutations
  const createTemplateMutation = useCreateWeekTemplate();
  const setActiveMutation = useSetActiveTemplate();
  const removeSlotMutation = useRemoveTemplateSlot();

  // UI state
  const [newTemplateDialogOpen, setNewTemplateDialogOpen] = useState(false);
  const [newTemplateName, setNewTemplateName] = useState('');
  const [definitionsManagerOpen, setDefinitionsManagerOpen] = useState(false);
  const [addSlotDay, setAddSlotDay] = useState<number | null>(null);
  const [weekStartDate, setWeekStartDate] = useState(() => {
    // Default to next Monday
    const now = new Date();
    const day = now.getDay();
    const daysUntilMonday = day === 0 ? 1 : day === 1 ? 0 : 8 - day;
    const nextMon = new Date(now);
    nextMon.setDate(now.getDate() + daysUntilMonday);
    return nextMon.toISOString().slice(0, 10);
  });

  // Group slots by day
  const slotsByDay = useMemo(() => {
    const map = new Map<number, WeekTemplateSlot[]>();
    for (const day of [0, 1, 2, 3, 4, 5, 6]) {
      map.set(day, []);
    }
    for (const slot of slots) {
      const arr = map.get(slot.day_of_week) ?? [];
      arr.push(slot);
      map.set(slot.day_of_week, arr);
    }
    return map;
  }, [slots]);

  // Compute total hours per day column
  const dayHours = useMemo(() => {
    const hours = new Map<number, number>();
    for (const [day, daySlots] of slotsByDay) {
      let total = 0;
      for (const slot of daySlots) {
        const st = slot.shift_template;
        if (st) {
          total += hoursForSlot(st.start_time, st.end_time, st.break_duration) * slot.headcount;
        }
      }
      hours.set(day, Math.round(total * 10) / 10);
    }
    return hours;
  }, [slotsByDay]);

  // Create new template
  const handleCreateTemplate = useCallback(() => {
    if (!newTemplateName.trim()) return;
    createTemplateMutation.mutate(
      {
        restaurant_id: restaurantId,
        name: newTemplateName.trim(),
        is_active: templates.length === 0,
      },
      {
        onSuccess: (data) => {
          setSelectedTemplateId(data.id);
          setNewTemplateName('');
          setNewTemplateDialogOpen(false);
        },
      },
    );
  }, [newTemplateName, restaurantId, templates.length, createTemplateMutation]);

  // Set active template
  const handleSetActive = useCallback(() => {
    if (!resolvedTemplateId) return;
    setActiveMutation.mutate({ id: resolvedTemplateId, restaurantId });
  }, [resolvedTemplateId, restaurantId, setActiveMutation]);

  // Remove a slot
  const handleRemoveSlot = useCallback(
    (slotId: string) => {
      if (!resolvedTemplateId) return;
      removeSlotMutation.mutate({ id: slotId, weekTemplateId: resolvedTemplateId });
    },
    [resolvedTemplateId, removeSlotMutation],
  );

  // Generate schedule
  const handleGenerate = useCallback(() => {
    if (!resolvedTemplateId || !weekStartDate) return;
    onGenerateSchedule(resolvedTemplateId, weekStartDate);
  }, [resolvedTemplateId, weekStartDate, onGenerateSchedule]);

  const currentTemplate = templates.find((t) => t.id === resolvedTemplateId);
  const isActive = currentTemplate?.is_active ?? false;
  const isLoading = templatesLoading || slotsLoading;

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  if (templatesLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-full rounded-lg" />
        <div className="grid grid-cols-7 gap-2">
          {Array.from({ length: 7 }).map((_, i) => (
            <Skeleton key={i} className="h-48 rounded-xl" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* ── Top bar ─────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2">
        {/* Template selector */}
        {templates.length > 0 ? (
          <Select value={resolvedTemplateId} onValueChange={handleTemplateChange}>
            <SelectTrigger className="h-9 w-48 text-[14px] bg-muted/30 border-border/40 rounded-lg">
              <SelectValue placeholder="Select template" />
            </SelectTrigger>
            <SelectContent>
              {templates.map((t) => (
                <SelectItem key={t.id} value={t.id}>
                  {t.name}
                  {t.is_active ? ' (active)' : ''}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <p className="text-[14px] text-muted-foreground">No templates yet</p>
        )}

        {/* New template */}
        <Button
          variant="ghost"
          onClick={() => setNewTemplateDialogOpen(true)}
          className="h-9 px-3 rounded-lg text-[13px] font-medium text-muted-foreground hover:text-foreground"
        >
          <Plus className="h-4 w-4 mr-1" />
          New Template
        </Button>

        {/* Set active */}
        {resolvedTemplateId && !isActive && (
          <Button
            variant="ghost"
            onClick={handleSetActive}
            disabled={setActiveMutation.isPending}
            aria-label="Set as active template"
            className="h-9 px-3 rounded-lg text-[13px] font-medium text-muted-foreground hover:text-foreground"
          >
            <Star className="h-4 w-4 mr-1" />
            Set Active
          </Button>
        )}
        {resolvedTemplateId && isActive && (
          <span className="inline-flex items-center gap-1 text-[13px] text-muted-foreground">
            <Star className="h-4 w-4 fill-foreground text-foreground" />
            Active
          </span>
        )}

        {/* Definitions manager */}
        <Button
          variant="ghost"
          onClick={() => setDefinitionsManagerOpen(true)}
          aria-label="Manage shift definitions"
          className="h-9 px-3 rounded-lg text-[13px] font-medium text-muted-foreground hover:text-foreground ml-auto"
        >
          <Settings className="h-4 w-4 mr-1" />
          Definitions
        </Button>
      </div>

      {/* ── 7-column grid ───────────────────────────────────────────────── */}
      {resolvedTemplateId ? (
        <>
          {isLoading ? (
            <div className="grid grid-cols-7 gap-2">
              {Array.from({ length: 7 }).map((_, i) => (
                <Skeleton key={i} className="h-48 rounded-xl" />
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-7 gap-2">
              {COLUMN_DAYS.map((dayOfWeek) => {
                const daySlots = slotsByDay.get(dayOfWeek) ?? [];
                const totalHours = dayHours.get(dayOfWeek) ?? 0;

                return (
                  <div
                    key={dayOfWeek}
                    className="flex flex-col rounded-xl border border-border/40 bg-muted/10 overflow-hidden"
                  >
                    {/* Column header */}
                    <div className="flex items-center justify-between px-3 py-2 border-b border-border/40 bg-muted/30">
                      <span className="text-[13px] font-semibold text-foreground">
                        {DAY_SHORT[dayOfWeek]}
                      </span>
                      {totalHours > 0 && (
                        <span className="text-[11px] px-1.5 py-0.5 rounded-md bg-muted">
                          {totalHours}h
                        </span>
                      )}
                    </div>

                    {/* Slot cards */}
                    <div className="flex-1 p-2 space-y-1.5 min-h-[120px]">
                      {daySlots.map((slot) => {
                        const st = slot.shift_template;
                        if (!st) return null;
                        const slotPosition = slot.position || st.position || 'Any';
                        return (
                          <div
                            key={slot.id}
                            className="group relative rounded-lg border border-border/40 bg-background p-2 text-left"
                            style={{ borderLeftWidth: 3, borderLeftColor: st.color || '#3b82f6' }}
                          >
                            <p className="text-[12px] font-medium text-foreground leading-tight truncate">
                              {st.name}
                            </p>
                            <p className="text-[11px] text-muted-foreground">
                              {formatTime(st.start_time)} &ndash; {formatTime(st.end_time)}
                            </p>
                            <div className="flex items-center gap-1 mt-1">
                              <span className="text-[10px] px-1 py-0.5 rounded bg-muted text-muted-foreground">
                                {slotPosition}
                              </span>
                              {slot.headcount > 1 && (
                                <span className="text-[10px] px-1 py-0.5 rounded bg-muted text-muted-foreground">
                                  x{slot.headcount}
                                </span>
                              )}
                            </div>
                            {/* Delete on hover */}
                            <button
                              onClick={() => handleRemoveSlot(slot.id)}
                              aria-label={`Remove ${st.name} from ${DAY_SHORT[dayOfWeek]}`}
                              className="absolute top-1.5 right-1.5 opacity-0 group-hover:opacity-100 p-1 rounded text-destructive hover:text-destructive/80 transition-all"
                            >
                              <Trash2 className="h-3 w-3" />
                            </button>
                          </div>
                        );
                      })}
                    </div>

                    {/* Add slot button */}
                    <button
                      onClick={() => setAddSlotDay(dayOfWeek)}
                      aria-label={`Add slot to ${DAY_SHORT[dayOfWeek]}`}
                      className="flex items-center justify-center gap-1 py-2 border-t border-border/40 text-[12px] font-medium text-muted-foreground hover:text-foreground hover:bg-muted/30 transition-colors"
                    >
                      <Plus className="h-3 w-3" />
                      Add
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          {/* ── Bottom section: date picker + generate ────────────────────── */}
          <div className="flex flex-wrap items-end gap-4 pt-2 border-t border-border/40">
            <div className="space-y-1.5">
              <Label
                htmlFor="week-start-date"
                className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider"
              >
                Week Start Date (Monday)
              </Label>
              <Input
                id="week-start-date"
                type="date"
                value={weekStartDate}
                onChange={(e) => setWeekStartDate(e.target.value)}
                className="h-10 text-[14px] bg-muted/30 border-border/40 rounded-lg focus-visible:ring-1 focus-visible:ring-border w-44"
              />
            </div>
            <Button
              onClick={handleGenerate}
              disabled={!resolvedTemplateId || !weekStartDate || slots.length === 0}
              className="h-10 px-5 rounded-lg bg-foreground text-background hover:bg-foreground/90 text-[13px] font-medium"
            >
              <CalendarDays className="h-4 w-4 mr-1.5" />
              Generate Schedule
            </Button>
          </div>
        </>
      ) : (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="h-12 w-12 rounded-xl bg-muted/50 flex items-center justify-center mb-3">
            <CalendarDays className="h-6 w-6 text-muted-foreground" />
          </div>
          <p className="text-[14px] font-medium text-foreground">No template selected</p>
          <p className="text-[13px] text-muted-foreground mt-1">
            Create a week template to start building your schedule.
          </p>
        </div>
      )}

      {/* ── Dialogs / sheets ──────────────────────────────────────────── */}

      {/* Add slot dialog */}
      {addSlotDay !== null && resolvedTemplateId && (
        <AddSlotDialog
          open={addSlotDay !== null}
          onOpenChange={(v) => !v && setAddSlotDay(null)}
          dayOfWeek={addSlotDay}
          weekTemplateId={resolvedTemplateId}
          definitions={definitions}
          positions={positions}
        />
      )}

      {/* Shift definitions manager sheet */}
      <ShiftDefinitionsManager
        open={definitionsManagerOpen}
        onOpenChange={setDefinitionsManagerOpen}
        restaurantId={restaurantId}
      />

      {/* New template name dialog */}
      <Dialog open={newTemplateDialogOpen} onOpenChange={setNewTemplateDialogOpen}>
        <DialogContent className="max-w-sm p-0 gap-0 border-border/40">
          <DialogHeader className="px-6 pt-6 pb-4 border-b border-border/40">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-xl bg-muted/50 flex items-center justify-center">
                <CalendarDays className="h-5 w-5 text-foreground" />
              </div>
              <DialogTitle className="text-[17px] font-semibold text-foreground">
                New Week Template
              </DialogTitle>
            </div>
          </DialogHeader>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleCreateTemplate();
            }}
            className="px-6 py-5 space-y-4"
          >
            <div className="space-y-1.5">
              <Label
                htmlFor="new-template-name"
                className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider"
              >
                Template Name
              </Label>
              <Input
                id="new-template-name"
                value={newTemplateName}
                onChange={(e) => setNewTemplateName(e.target.value)}
                placeholder="e.g. Default Week"
                autoFocus
                required
                className="h-10 text-[14px] bg-muted/30 border-border/40 rounded-lg focus-visible:ring-1 focus-visible:ring-border"
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="ghost"
                onClick={() => setNewTemplateDialogOpen(false)}
                className="h-9 px-4 rounded-lg text-[13px] font-medium text-muted-foreground hover:text-foreground"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={createTemplateMutation.isPending || !newTemplateName.trim()}
                className="h-9 px-4 rounded-lg bg-foreground text-background hover:bg-foreground/90 text-[13px] font-medium"
              >
                {createTemplateMutation.isPending ? 'Creating...' : 'Create'}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
