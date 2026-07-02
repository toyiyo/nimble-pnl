import { useState, useMemo, useCallback } from 'react';

import { Skeleton } from '@/components/ui/skeleton';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';

import { CalendarOff } from 'lucide-react';

import { isoToLocalMinutes } from '@/lib/shiftCoverage';
import { useWeekStaffingSuggestions } from '@/hooks/useWeekStaffingSuggestions';
import { useTimelineModel } from './useTimelineModel';
import { CoverageCurve } from './CoverageCurve';
import { TimelineAxis } from './TimelineAxis';
import { TimelineLane } from './TimelineLane';
import { NowIndicator } from './NowIndicator';
import { CoverageGapList } from './CoverageGapList';
import { TimelineShiftPopover } from './TimelineShiftPopover';
import { formatDayLabel } from '@/lib/shiftInterval';

import type { Shift, Employee } from '@/types/scheduling';
import type { GroupByMode } from '@/lib/scheduleGrouping';

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
  const [selectedDay, setSelectedDay] = useState<string>(() => defaultDay(weekDays));
  const [groupBy, setGroupBy] = useState<GroupByMode>('area');
  const [activeShift, setActiveShift] = useState<Shift | null>(null);

  // ── Staffing recommendations ───────────────────────────────────────────────
  const { daySuggestions } = useWeekStaffingSuggestions(restaurantId, weekDays, null);

  const dayRecommendations = useMemo(() => {
    const result = daySuggestions.get(selectedDay);
    return result?.recommendations ?? [];
  }, [daySuggestions, selectedDay]);

  // ── Filter shifts to the selected day ─────────────────────────────────────
  const dayShifts = useMemo(() => filterToDay(shifts, selectedDay, tz), [shifts, selectedDay, tz]);

  // ── Timeline model (pure transform) ───────────────────────────────────────
  const model = useTimelineModel(dayShifts, employees, selectedDay, tz, groupBy, dayRecommendations);

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
  const handlePopoverClose = useCallback(() => setActiveShift(null), []);

  // ── Loading state ──────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="space-y-3" aria-busy="true" aria-label="Loading timeline">
        <div className="flex items-center gap-2">
          {Array.from({ length: 7 }).map((_, i) => (
            <Skeleton key={`day-skel-${i}`} className="h-8 w-16 rounded-lg" />
          ))}
        </div>
        <Skeleton className="h-20 w-full rounded-xl" />
        <Skeleton className="h-6 w-full rounded-lg" />
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={`lane-skel-${i}`} className="h-10 w-full rounded-xl" />
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

  // ── Empty state ────────────────────────────────────────────────────────────
  if (model.lanes.length === 0) {
    return (
      <div className="space-y-3">
        {controls}
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="h-10 w-10 rounded-xl bg-muted/50 flex items-center justify-center mb-3">
            <CalendarOff className="h-5 w-5 text-muted-foreground" />
          </div>
          <p className="text-[15px] font-medium text-foreground">No shifts scheduled</p>
          <p className="text-[13px] text-muted-foreground mt-1">
            Switch to Plan to add coverage.
          </p>
        </div>
      </div>
    );
  }

  // ── Data state — full timeline ─────────────────────────────────────────────
  return (
    <div className="space-y-3">
      {controls}

      {/* Horizontally-scrollable plot region */}
      <div className="overflow-x-auto rounded-xl border border-border/40">
        <div style={{ minWidth: `max(100%, ${plotMinWidth}px)` }}>

          {/* Coverage curve */}
          <div className="px-2 pt-2">
            <CoverageCurve
              window={model.window}
              coverage={model.coverage}
              demand={model.demand}
              gaps={model.gaps}
              minToPct={minToPct}
            />
          </div>

          {/* Hour axis */}
          <div className="relative pl-[120px]">
            <TimelineAxis window={model.window} minToPct={minToPct} />
          </div>

          {/* Lanes + NowIndicator overlay */}
          <div className="relative">
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
                onSelect={setActiveShift}
              />
            ))}
          </div>
        </div>
      </div>

      {/* Gap list (text alternative to color-based curve) */}
      <CoverageGapList gaps={model.gaps} />

      {/* Single popover instance per CLAUDE.md pattern */}
      <TimelineShiftPopover
        activeShift={activeShift}
        tz={tz}
        dateStr={selectedDay}
        onClose={handlePopoverClose}
      />
    </div>
  );
}
