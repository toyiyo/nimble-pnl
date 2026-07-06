import { useState, useMemo, useCallback, useRef } from 'react';

import { Skeleton } from '@/components/ui/skeleton';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';

import { CalendarOff } from 'lucide-react';

import { isoToLocalMinutes } from '@/lib/shiftCoverage';
import {
  summarizeCoverageHours,
  buildVerdict,
  summarizeAreaCoverage,
  mergeUnderStaffedRange,
} from '@/lib/coverageSummary';
import { useWeekStaffingSuggestions } from '@/hooks/useWeekStaffingSuggestions';
import { useValidatedShiftMutations } from '@/hooks/useValidatedShiftMutations';
import { useTimelineModel } from './useTimelineModel';
import { CoverageVerdict } from './CoverageVerdict';
import { CoverageChart } from './CoverageChart';
import { CoverageStatusStrip } from './CoverageStatusStrip';
import { CoverageDemandInfo } from './CoverageDemandInfo';
import { AreaCoverageStrips } from './AreaCoverageStrips';
import { TimelineAxis } from './TimelineAxis';
import { TimelineLane, type LanePaintContext } from './TimelineLane';
import { NowIndicator } from './NowIndicator';
import { TimelineShiftPopover, type TimelineCreateDraft } from './TimelineShiftPopover';
import { AvailabilityConflictDialog, type ConflictDialogData } from '@/components/scheduling/ShiftPlanner/AvailabilityConflictDialog';
import { formatDayLabel } from '@/lib/shiftInterval';
import { minutesToIso } from '@/lib/shiftTimeMath';

import type { Shift, Employee } from '@/types/scheduling';
import type { GroupByMode } from '@/lib/scheduleGrouping';
import { buildDraftShiftValues, mergeDraftShift, type PaintRange, type DragShiftDraft } from '@/lib/timelineDraft';
import type { ShiftMinuteRange } from '@/lib/timelineDragMath';

// ─── Types ────────────────────────────────────────────────────────────────────

interface ShiftTimelineTabProps {
  /** Shifts for the whole week — this component filters to the selected day. */
  readonly shifts: Shift[];
  /** All employees for the restaurant (used for group labels + joining). */
  readonly employees: Employee[];
  /** 7-element array of YYYY-MM-DD strings for the current week. */
  readonly weekDays: string[];
  /** Restaurant ID, forwarded to useWeekStaffingSuggestions. */
  readonly restaurantId: string;
  /** Restaurant IANA timezone (e.g. "America/Chicago"). */
  readonly tz: string;
  /** Forwarded from the parent's isLoading state. */
  readonly loading: boolean;
  /** Forwarded from the parent's error state; renders an inline message. */
  readonly error: Error | null;
}

/**
 * Single union state driving the ONE `TimelineShiftPopover` instance across every
 * entry point (edit via bar click; quick-add via paint/gap-click/keyboard "Add
 * shift" button). Mutually exclusive by construction — never two
 * popovers/overlays mounted at once.
 *
 * `create`'s `draft` + `laneContext` are produced either by `TimelineLane`'s paint
 * layer (C2, `laneContext` always present) or by the coverage strip's gap-click
 * (E, `laneContext` is `null` — no lane context: employee picker unfiltered,
 * position blank) and resolved into `TimelineShiftPopover`'s `createDraft` prop
 * via the `createDraft` memo below, which maps the lane's grouping key to
 * `position` or `area` depending on `groupBy` when a lane context is present.
 */
type ActiveOverlay =
  | { mode: 'edit'; shift: Shift; anchorRect: DOMRect | null }
  | {
      mode: 'create';
      draft: PaintRange;
      laneContext: LanePaintContext | null;
      anchorRect: DOMRect | null;
    }
  | null;

// ─── Constants ────────────────────────────────────────────────────────────────

/** Minimum pixels per hour for the plot width so bars are never illegibly narrow. */
const MIN_PX_PER_HOUR = 80;

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Returns today's YYYY-MM-DD string using the host local date (best-effort — the
 * planner header already determines the week with a similar host-date anchor, so
 * we match that convention here for the initial day selection only).
 */
function todayStr(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Pick the best default selected day: today if it falls within the week,
 * otherwise the first day of the week.
 */
function defaultDay(weekDays: string[]): string {
  const today = todayStr();
  return weekDays.includes(today) ? today : (weekDays[0] ?? today);
}

/**
 * Filter the week's shifts to those that start on `dayStr` in the restaurant's
 * local timezone. Uses `isoToLocalMinutes` so that late-evening shifts in
 * timezones west of UTC (e.g. 23:30 CDT stored as 04:30Z next day) are
 * correctly attributed to their local calendar day rather than silently dropped.
 *
 * A shift is included when its local start minute falls within [0, 1440) for
 * the given day (i.e. it starts on that calendar day in the restaurant's TZ).
 */
function filterToDay(shifts: Shift[], dayStr: string, tz: string): Shift[] {
  return shifts.filter((s) => {
    const startMin = isoToLocalMinutes(s.start_time, dayStr, tz);
    return startMin >= 0 && startMin < 1440;
  });
}

/** Lane context resolved for the `create` overlay's `TimelineCreateDraft`. */
interface ResolvedLaneContext {
  position: string | null;
  area: string | null;
}

/**
 * Resolve a lane's grouping key into `{ position, area }` for the `create`
 * overlay: `laneKey` maps to `position` when grouped by position, or `area`
 * when grouped by area (a shift's area is derived from its employee, never
 * stored directly). `laneKey === null` means no lane context at all
 * (gap-click entry point) — both resolve to null so the employee picker is
 * unfiltered and position starts blank.
 */
export function resolveLaneContext(laneKey: string | null, groupBy: GroupByMode): ResolvedLaneContext {
  if (laneKey === null) return { position: null, area: null };
  if (groupBy === 'position') return { position: laneKey, area: null };
  return { position: null, area: laneKey };
}

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * Container for the Timeline view.
 *
 * - Day selector: one button per weekday; defaults to today (or weekDays[0]).
 * - Group-by toggle: Area | Position (shadcn ToggleGroup type="single").
 * - Three-state rendering: loading → skeleton bands; error → inline message;
 *   empty → "No shifts scheduled" copy; data → full timeline.
 * - Layout: horizontally-scrollable plot whose inner width is
 *   `max(100%, span × MIN_PX_PER_HOUR)` so bars are readable on narrow screens.
 * - Single TimelineShiftPopover instance controlled by `activeShift` state.
 */
export function ShiftTimelineTab({
  shifts,
  employees,
  weekDays,
  restaurantId,
  tz,
  loading,
  error,
}: ShiftTimelineTabProps) {
  // ── Local state ────────────────────────────────────────────────────────────
  const [selectedDayState, setSelectedDay] = useState<string>(() => defaultDay(weekDays));
  // Derive the effective day so navigating to a different week (weekDays prop
  // changes) never leaves a stale date selected — fall back to the week's default
  // when the stored day is outside the current week.
  const selectedDay = weekDays.includes(selectedDayState) ? selectedDayState : defaultDay(weekDays);
  const [groupBy, setGroupBy] = useState<GroupByMode>('area');
  // Single union overlay state (design doc "Overlay state machine") — edit mode is
  // wired here; create mode's producer (paint/gap-click) lands in Stage C.
  const [activeOverlay, setActiveOverlay] = useState<ActiveOverlay>(null);
  const [coverageView, setCoverageView] = useState<'area' | 'delta'>('area');

  // ── Drag-move / edge-resize draft (Stage D2/D3) ───────────────────────────
  // The in-flight drafted range for a bar currently being dragged/resized, or
  // null when no drag is in progress. Merged into the model input below so
  // the coverage chart/verdict/status strip update live during the drag
  // (design doc §4 "Draft state"). Never written to React Query/localStorage —
  // plain React state, cleared on commit/cancel.
  const [dragDraft, setDragDraft] = useState<DragShiftDraft | null>(null);
  // Pending conflict/warning issues surfaced by a drag-commit release, shown
  // via the same AvailabilityConflictDialog the edit popover stacks (design
  // doc §4 "Commit path"). Cancel snaps back (clears the draft without
  // committing); confirm calls forceUpdateTime.
  const [dragConflict, setDragConflict] = useState<{
    shift: Shift;
    startIso: string;
    endIso: string;
    conflicts: ConflictDialogData['conflicts'];
    warnings: ConflictDialogData['warnings'];
  } | null>(null);

  // ── Staffing recommendations ───────────────────────────────────────────────
  const { daySuggestions, activeSettings } = useWeekStaffingSuggestions(restaurantId, weekDays, null);

  const dayRecommendations = useMemo(() => {
    const result = daySuggestions.get(selectedDay);
    return result?.recommendations ?? [];
  }, [daySuggestions, selectedDay]);

  // ── Filter shifts to the selected day ─────────────────────────────────────
  const dayShifts = useMemo(() => filterToDay(shifts, selectedDay, tz), [shifts, selectedDay, tz]);

  // ── Validated mutation pipeline — the single instance shared by the popover's
  // edit/delete flows. The timeline only uses the `*AtTime` create variants and
  // `validateAndUpdateTime`/`forceUpdateTime` for drag/edit — it has no reassign
  // UI, so `validateAndReassign`/`forceReassign`/`validateAndCreate`/`forceCreate`
  // are intentionally not destructured here.
  // Toasts on success/failure come from the underlying useShifts mutation hooks
  // (useCreateShift/useUpdateShift/useDeleteShift) — this component doesn't call
  // useToast directly.
  const {
    validateAndCreateAtTime,
    forceCreateAtTime,
    validateAndUpdateTime,
    forceUpdateTime,
    deleteShift,
    validationResult,
    clearValidation,
  } = useValidatedShiftMutations(restaurantId, dayShifts);

  // ── Live-drag merge (Stage D2) ─────────────────────────────────────────────
  // Replaces the dragged shift's committed start/end with the drafted minutes
  // so the model — and therefore the coverage chart/verdict/status strip —
  // reflects the in-flight drag on every rAF-throttled frame. Falls through
  // to `dayShifts` unchanged when no drag is in progress.
  const modelInputShifts = useMemo(
    () => mergeDraftShift(dayShifts, dragDraft, selectedDay, tz),
    [dayShifts, dragDraft, selectedDay, tz],
  );

  // ── Timeline model (pure transform) ───────────────────────────────────────
  const model = useTimelineModel(modelInputShifts, employees, selectedDay, tz, groupBy, dayRecommendations);

  // ── Hourly coverage summary + verdict (feeds the new coverage panel) ───────
  const targetSplh = activeSettings?.target_splh ?? null;
  const hourlySummary = useMemo(
    () => summarizeCoverageHours(model.coverage, model.demand, model.window, dayRecommendations),
    [model.coverage, model.demand, model.window, dayRecommendations],
  );
  const verdict = useMemo(() => buildVerdict(hourlySummary), [hourlySummary]);

  // ── Per-area coverage summary (only when grouped by area) ──────────────────
  const areaCoverage = useMemo(
    () =>
      groupBy === 'area'
        ? summarizeAreaCoverage(dayShifts, employees, selectedDay, tz, model.window)
        : [],
    [groupBy, dayShifts, employees, selectedDay, tz, model.window],
  );

  // ── Geometry helper ────────────────────────────────────────────────────────
  const minToPct = useCallback(
    (min: number) =>
      ((min - model.window.startMin) / (model.window.endMin - model.window.startMin)) * 100,
    [model.window.startMin, model.window.endMin],
  );

  // ── Plot width ─────────────────────────────────────────────────────────────
  const spanHours = (model.window.endMin - model.window.startMin) / 60;
  const plotMinWidth = spanHours * MIN_PX_PER_HOUR;

  // ── Callbacks ──────────────────────────────────────────────────────────────
  const handlePopoverClose = useCallback(() => setActiveOverlay(null), []);

  /**
   * Anchor-rect capture for edit mode: `TimelineBar`/`TimelineLane`'s `onSelect`
   * contract is `(shift) => void` (pinned by existing tests — see
   * tests/unit/timelineBarLabel.test.tsx / timelineComponents.test.tsx), so the
   * rect can't be threaded through that prop without a breaking signature change.
   * Instead, a click-capture listener on the lanes wrapper (below) runs in the
   * capture phase — BEFORE `TimelineBar`'s own onClick calls onSelect — and
   * stashes the clicked bar's rect in a ref that `handleSelectShift` reads
   * synchronously afterward. `closest('button')` finds the bar element (each bar
   * renders as a `<button>`); a click that reaches onSelect without a bar
   * ancestor shouldn't happen (only TimelineBar calls onSelect), but if it did,
   * the popover still opens, anchored on the legacy zero-size fallback trigger.
   */
  const pendingAnchorRectRef = useRef<DOMRect | null>(null);
  const handleLanesClickCapture = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    const barEl = (event.target as HTMLElement).closest('button');
    pendingAnchorRectRef.current = barEl ? barEl.getBoundingClientRect() : null;
  }, []);
  const handleSelectShift = useCallback((shift: Shift) => {
    setActiveOverlay({ mode: 'edit', shift, anchorRect: pendingAnchorRectRef.current });
  }, []);

  /**
   * Paint-to-create commit (C2): a lane's paint gesture (drag/click) or its
   * visually-hidden "Add shift" button committed a range. Stage the `create`
   * overlay with that range + lane context. No anchor rect is available from
   * the lane's plot region today — a future stage wires proper ghost-bar
   * anchoring; the popover falls back to its zero-size trigger until then.
   */
  const handlePaintCommit = useCallback((draft: PaintRange, laneContext: LanePaintContext) => {
    setActiveOverlay({ mode: 'create', draft, laneContext, anchorRect: null });
  }, []);

  /**
   * Gap-click commit (Stage E): a short (`delta < 0`) coverage-strip cell was
   * clicked. `mergeUnderStaffedRange` expands the clicked hour into the
   * contiguous understaffed run containing it (design doc §5 — adjacency is
   * computed within the single day-wide hourly status strip; the merged range
   * never crosses a covered/no-demand hour). Opens the same `create` overlay
   * as paint-to-create, but with `laneContext: null` — no lane context, so the
   * popover's employee picker is unfiltered and position starts blank. No
   * anchor rect is available from the strip cell today (same limitation as
   * paint-to-create); the popover falls back to its zero-size trigger.
   */
  const handleGapClick = useCallback(
    (startMin: number) => {
      const range = mergeUnderStaffedRange(hourlySummary, startMin);
      setActiveOverlay({ mode: 'create', draft: range, laneContext: null, anchorRect: null });
    },
    [hourlySummary],
  );

  /**
   * Live drag-draft update (Stage D2): `TimelineBar` calls this on every
   * rAF-throttled pointermove frame with the in-flight range, and once more
   * with `null` when the gesture ends/cancels. Feeds `modelInputShifts` above
   * so coverage recomputes live during the drag.
   */
  const handleBarDraftChange = useCallback((shiftId: string, range: ShiftMinuteRange | null) => {
    setDragDraft(range ? { shiftId, startMin: range.startMin, endMin: range.endMin } : null);
  }, []);

  /**
   * Drag/resize release (Stage D3): builds ISO instants via `minutesToIso`
   * and routes through the same `validateAndUpdateTime` pipeline the edit
   * popover's Save uses. On success the draft is cleared (the mutation's own
   * optimistic `setQueriesData` update means the bar never jumps waiting for
   * a refetch). On pending conflicts/warnings, the draft is KEPT (so the bar
   * stays at the drafted position while the dialog is open) and the shared
   * `AvailabilityConflictDialog` opens; cancel snaps back by clearing the
   * draft, confirm force-applies the same ISO instants.
   */
  const handleBarDragCommit = useCallback(
    async (shiftId: string, range: ShiftMinuteRange) => {
      const shift = dayShifts.find((s) => s.id === shiftId);
      if (!shift) {
        setDragDraft(null);
        return;
      }

      const startIso = minutesToIso(selectedDay, range.startMin, tz);
      const endIso = minutesToIso(selectedDay, range.endMin, tz);

      const outcome = await validateAndUpdateTime({
        shift,
        startIso,
        endIso,
        businessDate: selectedDay,
      });

      if (outcome.updated) {
        setDragDraft(null);
        return;
      }

      if (outcome.pendingConflicts?.length || outcome.pendingWarnings?.length) {
        setDragConflict({
          shift,
          startIso,
          endIso,
          conflicts: outcome.pendingConflicts ?? [],
          warnings: outcome.pendingWarnings ?? [],
        });
        return;
      }

      // Validation failed outright (e.g. a thrown lock/interval error) with no
      // pending issues to confirm — snap back rather than leave a dangling draft.
      setDragDraft(null);
    },
    [dayShifts, selectedDay, tz, validateAndUpdateTime],
  );

  const handleDragConflictCancel = useCallback(() => {
    setDragConflict(null);
    setDragDraft(null);
  }, []);

  const handleDragConflictConfirm = useCallback(async () => {
    if (!dragConflict) return;
    const { shift, startIso, endIso } = dragConflict;
    const ok = await forceUpdateTime({ shift, startIso, endIso, businessDate: selectedDay });
    if (ok) {
      setDragConflict(null);
      setDragDraft(null);
    }
  }, [dragConflict, forceUpdateTime, selectedDay]);

  const dragConflictData: ConflictDialogData | null = dragConflict
    ? {
        employeeName: employees.find((e) => e.id === dragConflict.shift.employee_id)?.name ?? 'This employee',
        conflicts: dragConflict.conflicts,
        warnings: dragConflict.warnings,
      }
    : null;

  /**
   * Resolve the `create` overlay into `TimelineShiftPopover`'s `createDraft`
   * prop: the lane's grouping key maps to `laneContext.position` when grouped
   * by position, or `laneContext.area` when grouped by area (a shift's area
   * is derived from its employee, never stored directly — see the design
   * doc's "Paint-to-create + quick-add popover" section). `buildDraftShiftValues`
   * derives the initial editor values (+ prefilled position) from the
   * committed minute range.
   *
   * Gap-click (Stage E) commits with `laneContext: null` — no lane, so both
   * `position` and `area` resolve to `null` (employee picker unfiltered,
   * position starts blank; `TimelineShiftEditor`/`TimelineCreatePopoverContent`
   * already treat `laneContext.position`/`.area` as optional/nullable).
   */
  const createDraft: TimelineCreateDraft | null = useMemo(() => {
    if (activeOverlay?.mode !== 'create') return null;

    const laneKey = activeOverlay.laneContext?.key ?? null;
    const resolvedLaneContext = resolveLaneContext(laneKey, groupBy);

    return {
      values: buildDraftShiftValues(activeOverlay.draft, { laneContext: resolvedLaneContext }),
      laneContext: resolvedLaneContext,
      businessDate: selectedDay,
    };
  }, [activeOverlay, groupBy, selectedDay]);

  // ── Loading state ──────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="space-y-3" aria-busy="true" aria-label="Loading timeline">
        <div className="flex items-center gap-2">
          {['s0','s1','s2','s3','s4','s5','s6'].map((k) => (
            <Skeleton key={k} className="h-8 w-16 rounded-lg" />
          ))}
        </div>
        <Skeleton className="h-20 w-full rounded-xl" />
        <Skeleton className="h-6 w-full rounded-lg" />
        {['l0','l1','l2'].map((k) => (
          <Skeleton key={k} className="h-10 w-full rounded-xl" />
        ))}
      </div>
    );
  }

  // ── Error state ────────────────────────────────────────────────────────────
  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <div className="h-10 w-10 rounded-xl bg-destructive/10 flex items-center justify-center mb-3">
          <CalendarOff className="h-5 w-5 text-destructive" />
        </div>
        <p className="text-[15px] font-medium text-foreground">Failed to load timeline</p>
        <p className="text-[13px] text-muted-foreground mt-1">{error.message}</p>
      </div>
    );
  }

  // ── Day selector + group-by controls ──────────────────────────────────────
  const controls = (
    <div className="flex flex-wrap items-center justify-between gap-3 pb-2 border-b border-border/40">
      {/* Day selector — fieldset/legend provides a semantic group for the day buttons */}
      <fieldset aria-label="Select day" className="flex items-center gap-1 overflow-x-auto pb-0.5 border-0 p-0 m-0">
        {weekDays.map((day) => (
          <button
            key={day}
            type="button"
            onClick={() => setSelectedDay(day)}
            aria-pressed={day === selectedDay}
            className={`
              shrink-0 px-3 h-8 rounded-lg text-[12px] font-medium transition-colors
              ${day === selectedDay
                ? 'bg-foreground text-background'
                : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
              }
            `}
          >
            {formatDayLabel(day).split(',')[0]}
          </button>
        ))}
      </fieldset>

      {/* Group-by toggle */}
      <ToggleGroup
        type="single"
        value={groupBy}
        onValueChange={(v) => { if (v === 'area' || v === 'position') setGroupBy(v); }}
        className="h-8"
        aria-label="Group shifts by"
      >
        <ToggleGroupItem value="area" className="h-8 px-3 text-[12px]">
          Area
        </ToggleGroupItem>
        <ToggleGroupItem value="position" className="h-8 px-3 text-[12px]">
          Position
        </ToggleGroupItem>
      </ToggleGroup>
    </div>
  );

  // ── Empty-lane sentinel: shown inside the data layout when no shifts exist ───
  // We do NOT bail out early here: even with zero lanes, the coverage panel must
  // render so managers can see demand shortfalls on a fully unstaffed day.
  // The empty state message is inlined below the coverage panel instead.
  const noShiftsMessage =
    model.lanes.length === 0 ? (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <div className="h-10 w-10 rounded-xl bg-muted/50 flex items-center justify-center mb-3">
          <CalendarOff className="h-5 w-5 text-muted-foreground" />
        </div>
        <p className="text-[15px] font-medium text-foreground">No shifts scheduled</p>
        <p className="text-[13px] text-muted-foreground mt-1">
          Switch to Plan to add coverage.
        </p>
      </div>
    ) : null;

  // ── Data state — full timeline ─────────────────────────────────────────────
  return (
    <div className="space-y-3">
      {controls}

      {/* Horizontally-scrollable plot region */}
      <div className="overflow-x-auto rounded-xl border border-border/40">
        <div style={{ minWidth: `max(100%, ${plotMinWidth}px)` }}>

          {/* Coverage panel — verdict → view toggle → chart → status strip.
              No horizontal padding here: the pl-[120px] children must start at
              the same left offset as TimelineAxis and shift lanes so the chart
              x-scale aligns with the axis ticks below. */}
          <div className="pt-3 pb-1 space-y-2 px-0">
            {/* Plain-language verdict + demand explainer */}
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <CoverageVerdict verdict={verdict} />
              <CoverageDemandInfo />
            </div>

            {/* View toggle: area chart vs diverging-bar chart */}
            <div className="flex items-center gap-2">
              <ToggleGroup
                type="single"
                value={coverageView}
                onValueChange={(v) => { if (v === 'area' || v === 'delta') setCoverageView(v); }}
                className="h-7"
                aria-label="Coverage chart view"
              >
                <ToggleGroupItem value="area" className="h-7 px-3 text-[12px]">
                  Chart
                </ToggleGroupItem>
                <ToggleGroupItem value="delta" className="h-7 px-3 text-[12px]">
                  +/−
                </ToggleGroupItem>
              </ToggleGroup>
            </div>

            {/* Coverage chart — offset to align with the axis ticks */}
            <div className="pl-[120px]">
              <CoverageChart
                hours={hourlySummary}
                view={coverageView}
                minToPct={minToPct}
                targetSplh={targetSplh}
              />
            </div>

            {/* Per-hour status strip */}
            <div className="pl-[120px]">
              <CoverageStatusStrip hours={hourlySummary} onGapClick={handleGapClick} />
            </div>

            {/* Per-area scheduled strips — only when grouped by area */}
            {groupBy === 'area' && (
              <div className="pl-[120px]">
                <AreaCoverageStrips areas={areaCoverage} />
              </div>
            )}
          </div>

          {/* Hour axis */}
          <div className="relative pl-[120px]">
            <TimelineAxis window={model.window} minToPct={minToPct} />
          </div>

          {/* Lanes + NowIndicator overlay, or empty-day message */}
          {noShiftsMessage ?? (
            <div className="relative" onClickCapture={handleLanesClickCapture}>
              {/* NowIndicator sits over the lanes plot region, offset for label column */}
              <div className="absolute top-0 bottom-0 left-[120px] right-0 pointer-events-none">
                <NowIndicator
                  dateStr={selectedDay}
                  tz={tz}
                  window={model.window}
                  minToPct={minToPct}
                />
              </div>

              {model.lanes.map((lane) => (
                <TimelineLane
                  key={lane.key}
                  lane={lane}
                  minToPct={minToPct}
                  window={model.window}
                  onSelect={handleSelectShift}
                  onPaintCommit={handlePaintCommit}
                  onBarDraftChange={handleBarDraftChange}
                  onBarDragCommit={handleBarDragCommit}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Single popover instance per CLAUDE.md pattern — driven entirely by the
          activeOverlay union so edit/create/null are mutually exclusive. */}
      <TimelineShiftPopover
        activeShift={activeOverlay?.mode === 'edit' ? activeOverlay.shift : null}
        createDraft={createDraft}
        anchorRect={activeOverlay?.anchorRect ?? null}
        tz={tz}
        dateStr={selectedDay}
        employees={employees}
        restaurantId={restaurantId}
        dayShifts={dayShifts}
        onClose={handlePopoverClose}
        validateAndUpdateTime={validateAndUpdateTime}
        forceUpdateTime={forceUpdateTime}
        validateAndCreateAtTime={validateAndCreateAtTime}
        forceCreateAtTime={forceCreateAtTime}
        deleteShift={deleteShift}
        validationResult={validationResult}
        clearValidation={clearValidation}
      />

      {/* Drag-commit conflict dialog (Stage D3) — the same AvailabilityConflictDialog
          the edit popover stacks, mounted separately here since a bar drag never
          opens the popover. Mutually exclusive with the popover's own instance in
          practice: dragging a bar doesn't set activeOverlay. */}
      <AvailabilityConflictDialog
        open={dragConflict !== null}
        data={dragConflictData}
        timezone={tz}
        onConfirm={handleDragConflictConfirm}
        onCancel={handleDragConflictCancel}
      />
    </div>
  );
}
