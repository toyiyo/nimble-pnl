import { memo, useState, useMemo } from 'react';

import { useDraggable } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';

import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

import { Search } from 'lucide-react';

import type { Shift } from '@/types/scheduling';

import { computeHoursPerEmployee } from '@/hooks/useShiftPlanner';

import { cn } from '@/lib/utils';

// ---------------------------------------------------------------------------
// Pure helpers (exported for testing)
// ---------------------------------------------------------------------------

interface Employee {
  id: string;
  name: string;
  position: string | null;
  area?: string;
}

export function filterEmployees(
  employees: Employee[],
  search: string,
  area: string,
  role: string,
): Employee[] {
  const q = search.toLowerCase();
  return employees.filter((e) => {
    if (q && !e.name.toLowerCase().includes(q)) return false;
    if (area !== 'all' && e.area !== area) return false;
    if (role !== 'all' && e.position !== role) return false;
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
          <p className="text-[11px] text-muted-foreground truncate">
            {employee.position}
          </p>
        )}
      </div>
    );
  },
  (prev, next) =>
    prev.employee.id === next.employee.id &&
    prev.employee.name === next.employee.name &&
    prev.employee.position === next.employee.position &&
    prev.shiftCount === next.shiftCount &&
    prev.hours === next.hours &&
    prev.onSelect === next.onSelect,
);

// ---------------------------------------------------------------------------
// EmployeeSidebar
// ---------------------------------------------------------------------------

export function EmployeeSidebar({ employees, shifts, className, onEmployeeSelect }: Readonly<EmployeeSidebarProps>) {
  const [search, setSearch] = useState('');
  const [area, setArea] = useState('all');
  const [role, setRole] = useState('all');

  // Derive unique areas for the filter dropdown
  const areas = useMemo(() => {
    const set = new Set<string>();
    for (const e of employees) {
      if (e.area) set.add(e.area);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [employees]);

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

  const filtered = useMemo(
    () => filterEmployees(employees, search, area, role),
    [employees, search, area, role],
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
