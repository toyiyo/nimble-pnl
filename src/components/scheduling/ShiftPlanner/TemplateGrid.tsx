import { useState, useCallback, useMemo, type ReactNode } from 'react';

import { templateAppliesToDay } from '@/hooks/useShiftTemplates';

import type { ShiftTemplate, Shift, SlotCoverage, CoveringEmployee } from '@/types/scheduling';
import type { AllocationStatus } from '@/lib/shiftAllocation';

import { cn } from '@/lib/utils';
import { groupTemplatesByArea } from '@/lib/templateAreaGrouping';

import { TemplateRowHeader } from './TemplateRowHeader';
import { ShiftCell } from './ShiftCell';
import { AreaSectionHeader } from './AreaSectionHeader';
import { OffTemplateRow } from './OffTemplateRow';

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const AREA_COLLAPSE_KEY = 'shift-planner-area-collapse';

function getDayLabel(dateStr: string): { name: string; number: number; isToday: boolean } {
  const [y, m, d] = dateStr.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  const today = new Date();
  const isToday = date.toDateString() === today.toDateString();
  return { name: DAY_LABELS[date.getDay()], number: d, isToday };
}

interface TemplateGridProps {
  weekDays: string[];
  templates: ShiftTemplate[];
  gridData: Map<string, Map<string, Shift[]>>;
  onRemoveShift: (shiftId: string) => void;
  onEditTemplate: (template: ShiftTemplate) => void;
  // TODO(task 7): rename to onHideTemplate/onRestoreTemplate + wire ghost rows
  // and the hidden-templates lane. Placeholder shim so the build stays green
  // between tasks (see progress.md Task 1 notes for the same pattern).
  onDeleteTemplate: (templateId: string) => void;
  onAddTemplate: () => void;
  highlightCellId?: string | null;
  /** Mobile tap-to-assign */
  onMobileCellTap?: (templateId: string, day: string) => void;
  hasMobileSelection?: boolean;
  areaFilter?: string | null;
  /** Optional row rendered immediately under the day headers (e.g., coverage strip). */
  coverageSlot?: ReactNode;
  allocationStatuses?: Map<string, AllocationStatus>;
  pickedEmployeeName?: string;
  /** Tab-level coverage map passed from ShiftPlannerTab (Task 8+). */
  coverageByTemplateDay?: Map<string, Map<string, SlotCoverage>>;
  /** Called when a cell's coverage indicator is clicked; lifted to tab level.
   *  rect is the bounding box of the indicator button (desktop Popover anchor). */
  onCoverageClick?: (templateId: string, day: string, rect?: DOMRect) => void;
  /** De-duped loaned-out ghosts keyed `${templateId}:${day}`. */
  ghostByCell?: Map<string, CoveringEmployee[]>;
  /** Unmatched shifts grouped by area → day (off-template lane). */
  offTemplateByArea?: Map<string, Map<string, Shift[]>>;
}

export function TemplateGrid({
  weekDays,
  templates,
  gridData,
  onRemoveShift,
  onEditTemplate,
  onDeleteTemplate,
  onAddTemplate,
  highlightCellId,
  onMobileCellTap,
  hasMobileSelection,
  areaFilter,
  coverageSlot,
  allocationStatuses,
  pickedEmployeeName,
  coverageByTemplateDay,
  onCoverageClick,
  ghostByCell,
  offTemplateByArea,
}: Readonly<TemplateGridProps>) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(() => {
    try {
      return JSON.parse(localStorage.getItem(AREA_COLLAPSE_KEY) || '{}');
    } catch {
      return {};
    }
  });

  const toggleCollapse = useCallback((area: string) => {
    setCollapsed((prev) => {
      const next = { ...prev, [area]: !prev[area] };
      localStorage.setItem(AREA_COLLAPSE_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  const groups = useMemo(() => groupTemplatesByArea(templates, areaFilter), [templates, areaFilter]);
  const showSectionHeaders = areaFilter === null && groups.length > 1;

  /**
   * Area keys in offTemplateByArea that have NO matching template group.
   * These shifts must be rendered in their own OffTemplateRow lanes so they
   * are not silently dropped when there is no active template for that area.
   */
  const orphanOffTemplateAreas = useMemo(() => {
    if (!offTemplateByArea) return [];
    const groupAreaSet = new Set(groups.map((g) => g.area));
    // When areaFilter is active, only consider that one area so we don't render
    // off-template lanes for other areas that are hidden by the filter.
    const candidateAreas = areaFilter
      ? (offTemplateByArea.has(areaFilter) ? [areaFilter] : [])
      : [...offTemplateByArea.keys()];
    return candidateAreas.filter((area) => !groupAreaSet.has(area));
  }, [offTemplateByArea, groups, areaFilter]);

  return (
    <div className="rounded-xl border border-border/40 overflow-x-auto">
      <div className="grid grid-cols-[56px_repeat(7,1fr)] md:grid-cols-[200px_repeat(7,1fr)] min-w-[560px] md:min-w-[1000px]">
        {/* Header row */}
        <div className="p-3 flex items-end">
          <span className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider">
            Shift
          </span>
        </div>
        {weekDays.map((day) => {
          const { name, number, isToday } = getDayLabel(day);
          return (
            <div
              key={day}
              className={cn(
                'text-center py-2 border-l border-border/40',
                isToday && 'bg-foreground/5',
              )}
            >
              <div className="text-[12px] font-medium text-muted-foreground">{name}</div>
              <div
                className={cn(
                  'text-[14px] font-semibold',
                  isToday ? 'text-foreground' : 'text-muted-foreground',
                )}
              >
                {number}
              </div>
            </div>
          );
        })}

        {coverageSlot && (
          <>
            <div className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider px-2 py-1 border-t border-border/40">
              Cover
            </div>
            {coverageSlot}
          </>
        )}

        {/* Template rows grouped by area */}
        {groups.map((group) => (
          <div key={group.area} className="contents">
            {showSectionHeaders && (
              <AreaSectionHeader
                area={group.area}
                templateCount={group.templates.length}
                isCollapsed={!!collapsed[group.area]}
                onToggle={() => toggleCollapse(group.area)}
                colSpan={8}
              />
            )}
            {(!showSectionHeaders || !collapsed[group.area]) &&
              group.templates.map((template) => (
                <div
                  key={template.id}
                  className="contents"
                >
                  <div className="group border-t border-border/40">
                    <TemplateRowHeader
                      template={template}
                      onEdit={onEditTemplate}
                      // TODO(task 7): pass real onHide/onRestore split by
                      // template.is_active; placeholder keeps build green.
                      onHide={(t) => onDeleteTemplate(t.id)}
                      onRestore={onDeleteTemplate}
                    />
                  </div>
                  {weekDays.map((day) => {
                    const isActiveDay = templateAppliesToDay(template, day);
                    const shifts = gridData.get(template.id)?.get(day) ?? [];
                    // Full weekday name for screen-reader aria-label (e.g. "Monday").
                    // Parsed as local midnight to avoid UTC-offset day shifts.
                    const [y, mo, d] = day.split('-').map(Number);
                    const fullDayLabel = new Date(y, mo - 1, d).toLocaleDateString('en-US', { weekday: 'long' });
                    return (
                      <div key={day} className="border-t border-l border-border/40">
                        <ShiftCell
                          templateId={template.id}
                          day={day}
                          isActiveDay={isActiveDay}
                          shifts={shifts}
                          capacity={template.capacity ?? 1}
                          onRemoveShift={onRemoveShift}
                          isHighlighted={highlightCellId === `${template.id}:${day}`}
                          onMobileTap={onMobileCellTap}
                          hasMobileSelection={hasMobileSelection}
                          allocationStatus={allocationStatuses?.get(`${template.id}:${day}`) ?? 'none'}
                          pickedEmployeeName={pickedEmployeeName}
                          coverage={coverageByTemplateDay?.get(template.id)?.get(day)}
                          onCoverageClick={onCoverageClick}
                          slotName={`${template.area ? template.area + ' ' : ''}${template.position}`}
                          dayLabel={fullDayLabel}
                          cellArea={template.area ?? null}
                          ghostLoanedOut={ghostByCell?.get(`${template.id}:${day}`)}
                        />
                      </div>
                    );
                  })}
                </div>
              ))}
            {(!showSectionHeaders || !collapsed[group.area]) &&
              !!offTemplateByArea?.get(group.area)?.size && (
                <OffTemplateRow
                  area={group.area}
                  weekDays={weekDays}
                  shiftsByDay={offTemplateByArea!.get(group.area)!}
                  onRemoveShift={onRemoveShift}
                />
              )}
          </div>
        ))}
        {/* Off-template lanes for areas that have no active template in this view. */}
        {orphanOffTemplateAreas.map((area) => {
          const offShifts = offTemplateByArea!.get(area)!;
          return offShifts.size > 0 ? (
            <OffTemplateRow
              key={`orphan-${area}`}
              area={area}
              weekDays={weekDays}
              shiftsByDay={offShifts}
              onRemoveShift={onRemoveShift}
            />
          ) : null;
        })}
      </div>

      {/* Add template button */}
      <button
        onClick={onAddTemplate}
        className="w-full py-3 text-[13px] font-medium text-muted-foreground hover:text-foreground hover:bg-muted/30 transition-colors rounded-b-xl border-t border-border/40"
        aria-label="Add shift template"
      >
        + Add Shift Template
      </button>
    </div>
  );
}
