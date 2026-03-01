import { useState, useCallback, useMemo } from 'react';

import {
  DndContext,
  DragEndEvent,
  DragOverlay,
  DragStartEvent,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';

import type { Shift, Employee } from '@/types/scheduling';

import { formatLocalDate } from '@/lib/shiftInterval';
import { cn } from '@/lib/utils';

import { ShiftBlock } from './ShiftBlock';
import { EmptyCell } from './EmptyCell';

interface WeeklyGridProps {
  weekDays: string[];
  employees: Employee[];
  gridData: Map<string, Map<string, Shift[]>>;
  onShiftClick: (shift: Shift) => void;
  onCellClick: (employeeId: string, day: string) => void;
  onShiftReassign: (shiftId: string, newEmployeeId: string) => void;
}

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/**
 * Format day number from YYYY-MM-DD.
 */
function dayNumber(dateStr: string): string {
  const parts = dateStr.split('-');
  return String(parseInt(parts[2], 10));
}

export function WeeklyGrid({
  weekDays,
  employees,
  gridData,
  onShiftClick,
  onCellClick,
  onShiftReassign,
}: WeeklyGridProps) {
  const [activeShift, setActiveShift] = useState<Shift | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 },
    }),
  );

  const today = useMemo(() => formatLocalDate(new Date()), []);

  const handleDragStart = useCallback(
    (event: DragStartEvent) => {
      const shift = (event.active.data.current as { shift: Shift } | undefined)
        ?.shift;
      if (shift) setActiveShift(shift);
    },
    [],
  );

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      setActiveShift(null);

      const { active, over } = event;
      if (!over) return;

      const shiftId = active.id as string;
      const dropData = over.data.current as
        | { employeeId: string; day: string }
        | undefined;

      if (!dropData) return;

      onShiftReassign(shiftId, dropData.employeeId);
    },
    [onShiftReassign],
  );

  const handleDragCancel = useCallback(() => {
    setActiveShift(null);
  }, []);

  // Open shifts (unassigned)
  const openShifts = gridData.get('__open__');

  return (
    <DndContext
      sensors={sensors}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
    >
      <div className="rounded-xl border border-border/40 bg-background overflow-hidden">
        <div
          className="grid"
          style={{
            gridTemplateColumns: '160px repeat(7, 1fr)',
          }}
        >
          {/* Header row */}
          <div className="border-b border-border/40 bg-muted/30 px-3 py-2">
            <span className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider">
              Employee
            </span>
          </div>
          {weekDays.map((day, i) => (
            <div
              key={day}
              className={cn(
                'border-b border-l border-border/40 bg-muted/30 px-2 py-2 text-center',
                day === today && 'bg-foreground/5',
              )}
            >
              <div className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider">
                {DAY_LABELS[i]}
              </div>
              <div
                className={cn(
                  'text-[14px] font-medium mt-0.5',
                  day === today ? 'text-foreground' : 'text-muted-foreground',
                )}
              >
                {dayNumber(day)}
              </div>
            </div>
          ))}

          {/* Employee rows */}
          {employees.map((employee) => {
            const employeeDays = gridData.get(employee.id);

            return (
              <div key={employee.id} className="contents">
                {/* Employee name (sticky left) */}
                <div className="border-b border-border/40 px-3 py-2 flex items-start sticky left-0 bg-background z-10">
                  <div className="min-w-0">
                    <div className="text-[14px] font-medium text-foreground truncate">
                      {employee.name}
                    </div>
                    <div className="text-[12px] text-muted-foreground truncate">
                      {employee.position}
                    </div>
                  </div>
                </div>

                {/* Day cells */}
                {weekDays.map((day) => {
                  const shifts = employeeDays?.get(day) ?? [];

                  return (
                    <div
                      key={day}
                      className={cn(
                        'border-b border-l border-border/40 p-1 min-h-[64px]',
                        day === today && 'bg-foreground/5',
                      )}
                    >
                      {shifts.length > 0 ? (
                        <div className="space-y-1">
                          {shifts.map((shift) => (
                            <ShiftBlock
                              key={shift.id}
                              shift={shift}
                              onClick={onShiftClick}
                            />
                          ))}
                        </div>
                      ) : (
                        <EmptyCell
                          employeeId={employee.id}
                          employeeName={employee.name}
                          day={day}
                          onClickCreate={onCellClick}
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })}

          {/* Open shifts row */}
          <div className="contents">
            <div className="border-b border-border/40 px-3 py-2 flex items-start sticky left-0 bg-muted/20 z-10">
              <div className="text-[14px] font-medium text-muted-foreground italic">
                Open Shifts
              </div>
            </div>
            {weekDays.map((day) => {
              const shifts = openShifts?.get(day) ?? [];
              return (
                <div
                  key={day}
                  className={cn(
                    'border-b border-l border-border/40 p-1 min-h-[64px] bg-muted/20',
                    day === today && 'bg-foreground/5',
                  )}
                >
                  {shifts.length > 0 ? (
                    <div className="space-y-1">
                      {shifts.map((shift) => (
                        <ShiftBlock
                          key={shift.id}
                          shift={shift}
                          onClick={onShiftClick}
                        />
                      ))}
                    </div>
                  ) : (
                    <EmptyCell
                      employeeId="__open__"
                      employeeName="Open Shifts"
                      day={day}
                      onClickCreate={onCellClick}
                    />
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Drag overlay */}
      <DragOverlay>
        {activeShift ? (
          <div className="opacity-90 pointer-events-none">
            <ShiftBlock shift={activeShift} onClick={() => {}} />
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
