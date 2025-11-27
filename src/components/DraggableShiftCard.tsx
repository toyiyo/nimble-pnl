import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Shift } from '@/types/scheduling';
import { format, parseISO } from 'date-fns';
import { Edit, Trash2, GripVertical } from 'lucide-react';
import { cn } from '@/lib/utils';

interface DraggableShiftCardProps {
  shift: Shift;
  onEdit: (shift: Shift) => void;
  onDelete: (shift: Shift) => void;
  isSelected?: boolean;
  onSelect?: (shift: Shift, isMultiSelect: boolean) => void;
}

export const DraggableShiftCard = ({ 
  shift, 
  onEdit, 
  onDelete,
  isSelected = false,
  onSelect,
}: DraggableShiftCardProps) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ 
    id: shift.id,
    data: {
      shift,
      employeeId: shift.employee_id,
      date: format(parseISO(shift.start_time), 'yyyy-MM-dd'),
    }
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const handleClick = (e: React.MouseEvent) => {
    if (onSelect) {
      const isMultiSelect = e.ctrlKey || e.metaKey;
      onSelect(shift, isMultiSelect);
    } else {
      onEdit(shift);
    }
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        "group relative p-2 rounded border bg-card hover:bg-accent/50 transition-colors cursor-pointer",
        isSelected && "ring-2 ring-primary bg-primary/10",
        isDragging && "shadow-lg ring-2 ring-primary"
      )}
      onClick={handleClick}
    >
      {/* Drag Handle */}
      <div
        {...attributes}
        {...listeners}
        className="absolute left-1 top-1 cursor-grab active:cursor-grabbing opacity-0 group-hover:opacity-100 transition-opacity"
      >
        <GripVertical className="h-4 w-4 text-muted-foreground" />
      </div>

      <div className="text-xs font-medium pl-5">
        {format(parseISO(shift.start_time), 'h:mm a')} -{' '}
        {format(parseISO(shift.end_time), 'h:mm a')}
      </div>
      <div className="text-xs text-muted-foreground pl-5">{shift.position}</div>
      <Badge
        variant={
          shift.status === 'confirmed'
            ? 'default'
            : shift.status === 'cancelled'
            ? 'destructive'
            : 'outline'
        }
        className="mt-1 text-xs ml-5"
      >
        {shift.status}
      </Badge>
      <div className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 transition-opacity flex gap-1">
        <Button
          size="icon"
          variant="ghost"
          className="h-6 w-6"
          onClick={(e) => {
            e.stopPropagation();
            onEdit(shift);
          }}
          aria-label="Edit shift"
        >
          <Edit className="h-3 w-3" />
        </Button>
        <Button
          size="icon"
          variant="ghost"
          className="h-6 w-6"
          onClick={(e) => {
            e.stopPropagation();
            onDelete(shift);
          }}
          aria-label="Delete shift"
        >
          <Trash2 className="h-3 w-3" />
        </Button>
      </div>
    </div>
  );
};
