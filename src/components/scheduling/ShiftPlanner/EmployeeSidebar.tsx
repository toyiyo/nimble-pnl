import { memo, useState, useMemo, useEffect } from 'react';

import { useDraggable } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';

import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

import { Search } from 'lucide-react';

import type { Shift } from '@/types/scheduling';

import { computeHoursPerEmployee } from '@/hooks/useShiftPlanner';

import { cn } from '@/lib/utils';

import { isMinor } from '@/lib/employeeUtils';

// ---------------------------------------------------------------------------
// Pure helpers (exported for testing)
// ---------------------------------------------------------------------------

interface Employee {
  id: string;
  name: string;
  position: string | null;
  area?: string;
  employment_type?: 'full_time' | 'part_time';
  date_of_birth?: string;
}

export function filterEmployees(
  employees: Employee[],
  search: string,
  area: string,
  role: string,
  employmentType: string = 'all',
): Employee[] {
  const q = search.toLowerCase();
  return employees.filter((e) => {
    if (q && !e.name.toLowerCase().includes(q)) return false;
    if (area !== 'all' && e.area !== area) return false;
    if (role !== 'all' && e.position !== role) return false;
    if (employmentType !== 'all' && e.employment_type !== employmentType) return false;
    return true;
  });
}

export function countShiftsForEmployee(shifts: Shift[], employeeId: string): number {
  let count = 0;
  for (const s of shifts) {
    if (s.employee_id === employeeId && s.status !== 'cancelled') count++;
  }
  return count;
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface EmployeeSidebarProps {
  employees: Employee[];
  shifts: Shift[];
  className?: string;
  /** Mobile tap-to-assign: called when an employee is tapped instead of dragged */
  onEmployeeSelect?: (employee: { id: string; name: string }) => void;
  /** Area filter from the planner's filter pills — syncs the sidebar's area dropdown */
  plannerAreaFilter?: string | null;
}

// ---------------------------------------------------------------------------
// DraggableEmployee (internal, memoized)
// ---------------------------------------------------------------------------

interface DraggableEmployeeProps {
  employee: Employee;
  shiftCount: number;
  hours: number;
  onSelect?: (employee: { id: string; name: string }) => void;
}

const DraggableEmployee = memo(
  function DraggableEmployee({ employee, shiftCount, hours, onSelect }: DraggableEmployeeProps) {
    const {
      attributes,
      listeners,
      setNodeRef,
      transform,
      isDragging,
    } = useDraggable({
      id: employee.id,
      data: { employee },
    });

    const style = transform
      ? { transform: CSS.Translate.toString(transform) }
      : undefined;

    return (
      <div
        ref={setNodeRef}
        style={style}
        {...(onSelect ? {} : { ...listeners, ...attributes })}
        onClick={onSelect ? () => onSelect({ id: employee.id, name: employee.name }) : undefined}
        className={cn(
          'rounded-lg border border-border/40 px-3 py-2',
          onSelect ? 'cursor-pointer' : 'cursor-grab active:cursor-grabbing',
          'bg-background hover:bg-muted/30 transition-colors',
          isDragging && 'opacity-40',
        )}
      >
        <div className="flex items-center justify-between gap-1">
          <p className="text-[13px] font-medium text-foreground truncate">
            {employee.name}
          </p>
          {shiftCount > 0 && (
            <span className="text-[11px] px-1.5 py-0.5 rounded-md bg-muted text-muted-foreground shrink-0">
              {shiftCount} · {hours}h
            </span>
          )}
        </div>
        {employee.position && (
          <div className="flex items-center gap-1">
            <p className="text-[11px] text-muted-foreground truncate">
              {employee.position}
            </p>
            {isMinor(employee.date_of_birth) && (
              <span className="text-[10px] px-1 py-0.5 rounded bg-amber-500/10 text-amber-600 font-medium shrink-0">
                Minor
              </span>
            )}
          </div>
        )}
      </div>
    );
  },
  (prev, next) =>
    prev.employee.id === next.employee.id &&
    prev.employee.name === next.employee.name &&
    prev.employee.position === next.employee.position &&
    prev.employee.date_of_birth === next.employee.date_of_birth &&
    prev.shiftCount === next.shiftCount &&
    prev.hours === next.hours &&
    prev.onSelect === next.onSelect,
);

// ---------------------------------------------------------------------------
// EmployeeSidebar
// ---------------------------------------------------------------------------

export function EmployeeSidebar({ employees, shifts, className, onEmployeeSelect, plannerAreaFilter }: Readonly<EmployeeSidebarProps>) {
  const [search, setSearch] = useState('');
  const [area, setArea] = useState('all');
  const [role, setRole] = useState('all');
  const [employmentType, setEmploymentType] = useState('all');
  const [showAllOverride, setShowAllOverride] = useState(false);

  // Derive unique areas for the filter dropdown
  const areas = useMemo(() => {
    const set = new Set<string>();
    for (const e of employees) {
      if (e.area) set.add(e.area);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [employees]);

  // Reset area filter when selected value is no longer available
  // Skip when planner is controlling the area (plannerAreaFilter may reference template areas not in employee list)
  useEffect(() => {
    if (plannerAreaFilter) return;
    if (area !== 'all' && !areas.includes(area)) {
      setArea('all');
    }
  }, [area, areas, plannerAreaFilter]);

  // Sync sidebar area from planner filter pills
  useEffect(() => {
    if (plannerAreaFilter) {
      setArea(plannerAreaFilter);
      setShowAllOverride(false);
    } else {
      setArea('all');
      setShowAllOverride(false);
    }
  }, [plannerAreaFilter]);

  // Derive unique roles for the filter dropdown
  const roles = useMemo(() => {
    const set = new Set<string>();
    for (const e of employees) {
      if (e.position) set.add(e.position);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [employees]);

  // Pre-compute shift counts and hours per employee
  const shiftCounts = useMemo(() => {
    const map = new Map<string, number>();
    for (const s of shifts) {
      if (s.status === 'cancelled' || !s.employee_id) continue;
      map.set(s.employee_id, (map.get(s.employee_id) ?? 0) + 1);
    }
    return map;
  }, [shifts]);

  const hoursPerEmployee = useMemo(() => computeHoursPerEmployee(shifts), [shifts]);

  const effectiveArea = showAllOverride ? 'all' : area;

  const filtered = useMemo(
    () => filterEmployees(employees, search, effectiveArea, role, employmentType),
    [employees, search, effectiveArea, role, employmentType],
  );

  return (
    <div className={cn("w-[200px] border-l border-border/40 bg-background flex flex-col", className)}>
      {/* Sticky header */}
      <div className="p-3 space-y-2 border-b border-border/40">
        <h3 className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider">
          Employees
        </h3>
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search..."
            className="h-8 pl-8 text-[13px] bg-muted/30 border-border/40 rounded-lg"
            aria-label="Search employees"
          />
        </div>
        {areas.length > 1 && (
          <Select value={area} onValueChange={setArea}>
            <SelectTrigger
              className="h-8 text-[13px] bg-muted/30 border-border/40 rounded-lg"
              aria-label="Filter by area"
            >
              <SelectValue placeholder="All areas" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All areas</SelectItem>
              {areas.map((a) => (
                <SelectItem key={a} value={a}>{a}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        {plannerAreaFilter && (
          <button
            type="button"
            onClick={() => setShowAllOverride((prev) => !prev)}
            className="w-full text-[12px] font-medium text-muted-foreground hover:text-foreground transition-colors py-1.5 px-2 rounded-lg hover:bg-muted/50"
            aria-label={showAllOverride ? `Show ${plannerAreaFilter} only` : 'Show all employees'}
          >
            {showAllOverride ? `Show ${plannerAreaFilter} only` : 'Show all employees'}
          </button>
        )}
        {roles.length > 1 && (
          <Select value={role} onValueChange={setRole}>
            <SelectTrigger
              className="h-8 text-[13px] bg-muted/30 border-border/40 rounded-lg"
              aria-label="Filter by role"
            >
              <SelectValue placeholder="All roles" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All roles</SelectItem>
              {roles.map((r) => (
                <SelectItem key={r} value={r}>{r}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <Select value={employmentType} onValueChange={setEmploymentType}>
          <SelectTrigger
            className="h-8 text-[13px] bg-muted/30 border-border/40 rounded-lg"
            aria-label="Filter by employment type"
          >
            <SelectValue placeholder="All types" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All types</SelectItem>
            <SelectItem value="full_time">Full-Time</SelectItem>
            <SelectItem value="part_time">Part-Time</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Scrollable employee list */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2" aria-live="polite">
        {filtered.length === 0 ? (
          <p className="text-[12px] text-muted-foreground text-center py-4">No matches</p>
        ) : (
          filtered.map((employee) => (
            <DraggableEmployee
              key={employee.id}
              employee={employee}
              shiftCount={shiftCounts.get(employee.id) ?? 0}
              hours={hoursPerEmployee.get(employee.id) ?? 0}
              onSelect={onEmployeeSelect}
            />
          ))
        )}
      </div>
    </div>
  );
}
