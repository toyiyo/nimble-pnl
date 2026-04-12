import { useState, useCallback, useMemo } from 'react';

import { templateAppliesToDay } from '@/hooks/useShiftTemplates';

import type { ShiftTemplate, Shift } from '@/types/scheduling';

import { cn } from '@/lib/utils';
import { groupTemplatesByArea } from '@/lib/templateAreaGrouping';

import { TemplateRowHeader } from './TemplateRowHeader';
import { ShiftCell } from './ShiftCell';
import { AreaSectionHeader } from './AreaSectionHeader';

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
  onDeleteTemplate: (templateId: string) => void;
  onAddTemplate: () => void;
  highlightCellId?: string | null;
  /** Mobile tap-to-assign */
  onMobileCellTap?: (templateId: string, day: string) => void;
  hasMobileSelection?: boolean;
  areaFilter?: string | null;
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
                      onDelete={onDeleteTemplate}
                    />
                  </div>
                  {weekDays.map((day) => {
                    const isActiveDay = templateAppliesToDay(template, day);
                    const shifts = gridData.get(template.id)?.get(day) ?? [];
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
                        />
                      </div>
                    );
                  })}
                </div>
              ))}
          </div>
        ))}
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
