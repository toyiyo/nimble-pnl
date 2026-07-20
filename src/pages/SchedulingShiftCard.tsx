import { useCallback, useMemo } from 'react';
import { format, parseISO } from 'date-fns';
import * as dateFnsTz from 'date-fns-tz';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { useRestaurantContext } from '@/contexts/RestaurantContext';
import { useCheckConflicts } from '@/hooks/useConflictDetection';
import { cn } from '@/lib/utils';
import { AlertTriangle, Check, Clock, Edit, Trash2 } from 'lucide-react';
import type { ConflictCheck, Shift } from '@/types/scheduling';

/**
 * `ShiftCard` and its small helpers, extracted from `Scheduling.tsx` so both
 * the desktop grid and `WeekScheduleMobile` (Task 8) can import it without a
 * circular dependency between `Scheduling.tsx` and
 * `components/scheduling/WeekScheduleMobile.tsx`.
 */

export const getShiftStatusClass = (status: Shift['status'], hasConflicts: boolean) => {
  if (hasConflicts) {
    return 'border-l-warning bg-warning/5 hover:bg-warning/10';
  }
  if (status === 'confirmed') {
    return 'border-l-success';
  }
  if (status === 'cancelled') {
    return 'border-l-destructive opacity-60';
  }
  return 'border-l-primary/50';
};

const statusToBadgeVariant = (status: Shift['status']): 'default' | 'destructive' | 'outline' => {
  if (status === 'confirmed') return 'default';
  if (status === 'cancelled') return 'destructive';
  return 'outline';
};

export type ShiftCardProps = {
  shift: Shift;
  onEdit: (shift: Shift) => void;
  onDelete: (shift: Shift) => void;
  isSelected?: boolean;
  selectionMode?: boolean;
  onToggleSelect?: (shiftId: string) => void;
};

const buildConflictKey = (conflict: ConflictCheck) =>
  conflict.time_off_id ? `timeoff-${conflict.time_off_id}` : `${conflict.conflict_type}-${conflict.message}`;

export const ShiftCard = ({ shift, onEdit, onDelete, isSelected, selectionMode: cardSelectionMode, onToggleSelect }: ShiftCardProps) => {
  const { selectedRestaurant } = useRestaurantContext();
  const restaurantTimezone = selectedRestaurant?.restaurant?.timezone || 'UTC';
  const { fromZonedTime } = dateFnsTz;

  const formatToUTC = useCallback((isoString: string) => {
    const date = new Date(isoString);
    const converter = fromZonedTime ?? ((value: Date) => value);
    const utcDate = converter(date, restaurantTimezone);
    const pad = (n: number) => n.toString().padStart(2, '0');
    return `${utcDate.getUTCFullYear()}-${pad(utcDate.getUTCMonth() + 1)}-${pad(utcDate.getUTCDate())} ${pad(utcDate.getUTCHours())}:${pad(utcDate.getUTCMinutes())}:${pad(utcDate.getUTCSeconds())}`;
  }, [fromZonedTime, restaurantTimezone]);

  const conflictParams = useMemo(() => ({
    employeeId: shift.employee_id,
    restaurantId: shift.restaurant_id,
    startTime: formatToUTC(shift.start_time),
    endTime: formatToUTC(shift.end_time),
  }), [shift, restaurantTimezone, formatToUTC]);

  const { conflicts, hasConflicts } = useCheckConflicts(conflictParams);

  // Calculate shift duration for visual indicator
  const shiftStart = parseISO(shift.start_time);
  const shiftEnd = parseISO(shift.end_time);
  const durationHours = (shiftEnd.getTime() - shiftStart.getTime()) / (1000 * 60 * 60);
  const shiftStatusClass = getShiftStatusClass(shift.status, hasConflicts);

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <div
            data-testid="shift-card"
            role="button"
            tabIndex={0}
            className={cn(
              "group relative rounded-lg border-l-4 transition-all duration-200 cursor-pointer",
              "hover:shadow-md hover:scale-[1.02] hover:-translate-y-0.5",
              "bg-gradient-to-r from-card to-card/80",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              shiftStatusClass,
              isSelected && "ring-2 ring-primary bg-primary/10"
            )}
            onClick={() => {
              if (cardSelectionMode && onToggleSelect) {
                onToggleSelect(shift.id);
              } else {
                onEdit(shift);
              }
            }}
            onKeyDown={(e) => {
              // Ignore keydowns that bubbled up from a focused descendant
              // (e.g. the Edit/Delete icon buttons) so activating those
              // controls via keyboard doesn't also trigger the card's own
              // edit/select behavior instead of the button's own handler.
              if (e.target !== e.currentTarget) return;
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                if (cardSelectionMode && onToggleSelect) {
                  onToggleSelect(shift.id);
                } else {
                  onEdit(shift);
                }
              }
            }}
          >
            {/* Selection checkbox indicator */}
            {cardSelectionMode && (
              <div className={cn(
                "absolute top-1 right-1 z-10 h-5 w-5 rounded-full border-2 flex items-center justify-center transition-colors",
                isSelected
                  ? "bg-primary border-primary"
                  : "bg-background/80 border-muted-foreground/40"
              )}>
                {isSelected && <Check className="h-3 w-3 text-primary-foreground" />}
              </div>
            )}

            {/* Time block header */}
            <div className={cn(
              "px-2.5 py-1.5 border-b border-border/50",
              hasConflicts && "bg-warning/10"
            )}>
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold tracking-tight text-foreground">
                  {format(shiftStart, 'h:mm')}
                  <span className="text-muted-foreground font-normal">
                    {format(shiftStart, 'a').toLowerCase()}
                  </span>
                </span>
                {hasConflicts && (
                  <AlertTriangle className="h-3 w-3 text-warning animate-pulse" />
                )}
              </div>
              <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
                <Clock className="h-2.5 w-2.5" />
                <span>{durationHours.toFixed(1)}h</span>
                <span className="mx-0.5">·</span>
                <span>until {format(shiftEnd, 'h:mma').toLowerCase()}</span>
              </div>
            </div>

            {/* Position & Status */}
            <div className="px-2.5 py-2 space-y-1.5">
              <div className="text-xs font-medium text-foreground/90 truncate">
                {shift.position}
              </div>
              <Badge
                variant={statusToBadgeVariant(shift.status)}
                className={cn(
                  "text-[10px] h-5 font-medium",
                  shift.status === 'confirmed' && "bg-success/15 text-success border-success/30 hover:bg-success/20"
                )}
              >
                {shift.status}
              </Badge>
            </div>

            {/* Hover actions (hidden in selection mode) */}
            <div className={cn(
              "absolute top-1 right-1 opacity-0 group-hover:opacity-100 transition-all duration-200 flex gap-0.5",
              cardSelectionMode && "hidden"
            )}>
              <Button
                size="icon"
                variant="ghost"
                className="h-6 w-6 bg-background/80 backdrop-blur-sm hover:bg-background shadow-sm"
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
                className="h-6 w-6 bg-background/80 backdrop-blur-sm hover:bg-destructive/10 hover:text-destructive shadow-sm"
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
        </TooltipTrigger>
        {hasConflicts && (
          <TooltipContent side="top" className="max-w-xs bg-warning/95 text-warning-foreground border-warning">
            <div className="space-y-1">
              <p className="font-semibold text-xs flex items-center gap-1">
                <AlertTriangle className="h-3 w-3" />
                Scheduling Conflicts
              </p>
              {conflicts.map((conflict) => (
                <p key={buildConflictKey(conflict)} className="text-xs opacity-90">• {conflict.message}</p>
              ))}
            </div>
          </TooltipContent>
        )}
      </Tooltip>
    </TooltipProvider>
  );
};
