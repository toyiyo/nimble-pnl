import { memo } from 'react';

import { useDraggable } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';

import { cn } from '@/lib/utils';

interface Employee {
  id: string;
  name: string;
  position: string | null;
}

export interface EmployeeSidebarProps {
  employees: Employee[];
}

interface DraggableEmployeeProps {
  employee: Employee;
}

const DraggableEmployee = memo(
  function DraggableEmployee({ employee }: DraggableEmployeeProps) {
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
        {...listeners}
        {...attributes}
        className={cn(
          'rounded-lg border border-border/40 px-3 py-2 cursor-grab active:cursor-grabbing',
          'bg-background hover:bg-muted/30 transition-colors',
          isDragging && 'opacity-40',
        )}
      >
        <p className="text-[13px] font-medium text-foreground truncate">
          {employee.name}
        </p>
        {employee.position && (
          <p className="text-[11px] text-muted-foreground truncate">
            {employee.position}
          </p>
        )}
      </div>
    );
  },
  (prev, next) => prev.employee.id === next.employee.id,
);

export function EmployeeSidebar({ employees }: EmployeeSidebarProps) {
  return (
    <div className="w-[200px] border-l border-border/40 bg-background p-3 overflow-y-auto">
      <h3 className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider mb-3">
        Employees
      </h3>
      <div className="space-y-2">
        {employees.map((employee) => (
          <DraggableEmployee key={employee.id} employee={employee} />
        ))}
      </div>
    </div>
  );
}
