import { useDroppable } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { Button } from '@/components/ui/button';
import { Shift } from '@/types/scheduling';
import { Plus } from 'lucide-react';
import { DraggableShiftCard } from './DraggableShiftCard';
import { cn } from '@/lib/utils';

interface DroppableScheduleCellProps {
  employeeId: string;
  date: Date;
  shifts: Shift[];
  onAddShift: (date: Date) => void;
  onEditShift: (shift: Shift) => void;
  onDeleteShift: (shift: Shift) => void;
  selectedShifts: Set<string>;
  onSelectShift: (shift: Shift, isMultiSelect: boolean) => void;
}

export const DroppableScheduleCell = ({
  employeeId,
  date,
  shifts,
  onAddShift,
  onEditShift,
  onDeleteShift,
  selectedShifts,
  onSelectShift,
}: DroppableScheduleCellProps) => {
  const dropId = `${employeeId}-${date.toISOString()}`;
  const { setNodeRef, isOver } = useDroppable({
    id: dropId,
    data: {
      employeeId,
      date: date.toISOString(),
    },
  });

  const shiftIds = shifts.map(shift => shift.id);

  return (
    <td className="p-2 align-top">
      <div
        ref={setNodeRef}
        className={cn(
          "min-h-[80px] rounded transition-colors",
          isOver && "bg-primary/10 ring-2 ring-primary"
        )}
      >
        <SortableContext items={shiftIds} strategy={verticalListSortingStrategy}>
          <div className="space-y-1">
            {shifts.map((shift) => (
              <DraggableShiftCard
                key={shift.id}
                shift={shift}
                onEdit={onEditShift}
                onDelete={onDeleteShift}
                isSelected={selectedShifts.has(shift.id)}
                onSelect={onSelectShift}
              />
            ))}
            <Button
              variant="outline"
              size="sm"
              className="w-full text-xs"
              onClick={() => onAddShift(date)}
            >
              <Plus className="h-3 w-3 mr-1" />
              Add
            </Button>
          </div>
        </SortableContext>
      </div>
    </td>
  );
};
