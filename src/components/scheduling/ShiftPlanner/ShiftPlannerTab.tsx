import { useState, useCallback, useMemo } from 'react';

import { Skeleton } from '@/components/ui/skeleton';

import { AlertCircle, AlertTriangle } from 'lucide-react';

import { useShiftPlanner } from '@/hooks/useShiftPlanner';

import type { Shift } from '@/types/scheduling';

import { PlannerHeader } from './PlannerHeader';
import { WeeklyGrid } from './WeeklyGrid';
import { ShiftQuickCreate } from './ShiftQuickCreate';

interface ShiftPlannerTabProps {
  restaurantId: string;
  onShiftClick: (shift: Shift) => void;
}

interface QuickCreateTarget {
  employeeId: string;
  employeeName: string;
  day: string;
}

export function ShiftPlannerTab({
  restaurantId,
  onShiftClick,
}: ShiftPlannerTabProps) {
  const {
    weekStart,
    weekEnd,
    weekDays,
    goToNextWeek,
    goToPrevWeek,
    goToToday,
    employees,
    gridData,
    isLoading,
    validateAndCreate,
    validateAndReassign,
    validationResult,
    clearValidation,
    totalHours,
  } = useShiftPlanner(restaurantId);

  const [quickCreateOpen, setQuickCreateOpen] = useState(false);
  const [quickCreateTarget, setQuickCreateTarget] =
    useState<QuickCreateTarget | null>(null);

  // Derive unique positions from employees
  const positions = useMemo(() => {
    const posSet = new Set<string>();
    for (const emp of employees) {
      if (emp.position) posSet.add(emp.position);
    }
    return Array.from(posSet).sort();
  }, [employees]);

  const handleCellClick = useCallback(
    (employeeId: string, day: string) => {
      const employee = employees.find((e) => e.id === employeeId);
      setQuickCreateTarget({
        employeeId,
        employeeName: employee?.name ?? 'Open Shift',
        day,
      });
      setQuickCreateOpen(true);
      clearValidation();
    },
    [employees, clearValidation],
  );

  const handleQuickCreate = useCallback(
    async (data: {
      employeeId: string;
      day: string;
      startTime: string;
      endTime: string;
      position: string;
    }) => {
      const success = await validateAndCreate({
        employeeId: data.employeeId,
        date: data.day,
        startTime: data.startTime,
        endTime: data.endTime,
        position: data.position,
      });

      if (success) {
        setQuickCreateOpen(false);
        setQuickCreateTarget(null);
      }
    },
    [validateAndCreate],
  );

  const handleShiftReassign = useCallback(
    async (shiftId: string, newEmployeeId: string) => {
      // Find the shift from gridData
      let targetShift: Shift | undefined;
      for (const [, days] of gridData) {
        for (const [, shifts] of days) {
          const found = shifts.find((s) => s.id === shiftId);
          if (found) {
            targetShift = found;
            break;
          }
        }
        if (targetShift) break;
      }

      if (!targetShift) return;

      await validateAndReassign({
        shift: targetShift,
        newEmployeeId,
      });
    },
    [gridData, validateAndReassign],
  );

  // Loading state
  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-8 w-24" />
        </div>
        <Skeleton className="h-[400px] w-full rounded-xl" />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <PlannerHeader
        weekStart={weekStart}
        weekEnd={weekEnd}
        totalHours={totalHours}
        onPrevWeek={goToPrevWeek}
        onNextWeek={goToNextWeek}
        onToday={goToToday}
      />

      {/* Validation alerts */}
      {validationResult && !validationResult.valid && (
        <div className="flex items-start gap-2 p-3 rounded-lg bg-destructive/10 border border-destructive/20">
          <AlertCircle className="h-4 w-4 text-destructive mt-0.5 shrink-0" />
          <div className="space-y-1">
            {validationResult.errors.map((err, i) => (
              <p key={i} className="text-[13px] text-destructive">
                {err.message}
              </p>
            ))}
          </div>
        </div>
      )}

      {validationResult?.warnings && validationResult.warnings.length > 0 && (
        <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-500/10 border border-amber-500/20">
          <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" />
          <div className="space-y-1">
            {validationResult.warnings.map((warn, i) => (
              <p
                key={i}
                className="text-[13px] text-amber-700 dark:text-amber-300"
              >
                {warn.message}
              </p>
            ))}
          </div>
        </div>
      )}

      {/* Grid */}
      <WeeklyGrid
        weekDays={weekDays}
        employees={employees}
        gridData={gridData}
        onShiftClick={onShiftClick}
        onCellClick={handleCellClick}
        onShiftReassign={handleShiftReassign}
      />

      {/* Quick create dialog */}
      {quickCreateTarget && (
        <ShiftQuickCreate
          open={quickCreateOpen}
          onOpenChange={(open) => {
            setQuickCreateOpen(open);
            if (!open) {
              setQuickCreateTarget(null);
              clearValidation();
            }
          }}
          employeeId={quickCreateTarget.employeeId}
          employeeName={quickCreateTarget.employeeName}
          day={quickCreateTarget.day}
          positions={positions}
          onSubmit={handleQuickCreate}
        />
      )}
    </div>
  );
}
