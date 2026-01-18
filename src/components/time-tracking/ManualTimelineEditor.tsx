import { useState, useCallback, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Label } from '@/components/ui/label';
import { Plus, Check, AlertCircle, ChevronDown, ChevronUp, Clock, Coffee, MessageSquare } from 'lucide-react';
import { format, startOfDay, addHours, differenceInMinutes, isSameDay } from 'date-fns';
import { cn } from '@/lib/utils';
import { parseTimeRange, snapToInterval, formatDuration } from '@/lib/timeUtils';
import { useCreateTimePunch, useUpdateTimePunch, useDeleteTimePunch } from '@/hooks/useTimePunches';
import { useToast } from '@/hooks/use-toast';
import { TimePunch } from '@/types/timeTracking';
import { Employee } from '@/types/scheduling';

interface TimeBlock {
  id: string; // Unique ID for UI, maps to punch pair
  startTime: Date;
  endTime: Date;
  breakMinutes?: number; // Optional break duration
  notes?: string; // Optional notes
  clockInPunchId?: string;
  clockOutPunchId?: string;
  hasClockInTime?: boolean;
  hasClockOutTime?: boolean;
  isNew?: boolean; // Track if this is unsaved
  isSaving?: boolean;
  isImported?: boolean;
  importSource?: string;
}

interface EmployeeDay {
  employee: Employee;
  date: Date;
  blocks: TimeBlock[];
  totalHours: number;
  hasWarning: boolean;
  warningText?: string;
  expanded: boolean;
}

interface ManualTimelineEditorProps {
  employees: Employee[];
  date: Date;
  existingPunches: TimePunch[];
  loading: boolean;
  restaurantId: string;
}

const HOURS_START = 0; // Midnight (12am)
const HOURS_END = 24; // Midnight (12am next day)
const TOTAL_HOURS = HOURS_END - HOURS_START;

const getImportSource = (punch: TimePunch | undefined) => {
  if (!punch?.device_info) return null;
  if (!punch.device_info.startsWith('import:')) return null;
  return punch.device_info.replace('import:', '').trim() || 'Uploaded';
};

export const ManualTimelineEditor = ({ 
  employees, 
  date, 
  existingPunches, 
  loading,
  restaurantId 
}: ManualTimelineEditorProps) => {
  const { toast } = useToast();
  const createPunch = useCreateTimePunch();
  const updatePunch = useUpdateTimePunch();
  const deletePunch = useDeleteTimePunch();
  
  const [employeeDays, setEmployeeDays] = useState<Map<string, EmployeeDay>>(new Map());
  const [dragState, setDragState] = useState<{
    employeeId: string;
    blockId: string;
    mode: 'create' | 'adjust-start' | 'adjust-end' | null;
    startX: number;
    timelineRect: DOMRect;
  } | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [dragLabel, setDragLabel] = useState<{
    text: string;
    x: number;
    y: number;
  } | null>(null);
  const [saveTimeout, setSaveTimeout] = useState<NodeJS.Timeout | null>(null);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);

  // Initialize employee days from existing punches
  useEffect(() => {
    const dayMap = new Map<string, EmployeeDay>();
    
    employees.forEach(employee => {
      const employeePunches = existingPunches.filter(
        p => p.employee_id === employee.id && isSameDay(new Date(p.punch_time), date)
      );
      
      // Group punches into clock_in/clock_out pairs
      const blocks: TimeBlock[] = [];
      const sortedPunches = [...employeePunches].sort(
        (a, b) => new Date(a.punch_time).getTime() - new Date(b.punch_time).getTime()
      );
      
      for (let i = 0; i < sortedPunches.length; i++) {
        const punch = sortedPunches[i];
        if (punch.punch_type === 'clock_in') {
          const nextPunch = sortedPunches[i + 1];
          if (nextPunch?.punch_type === 'clock_out') {
            const importSource = getImportSource(punch) || getImportSource(nextPunch);
            blocks.push({
              id: `${punch.id}-${nextPunch.id}`,
              startTime: new Date(punch.punch_time),
              endTime: new Date(nextPunch.punch_time),
              clockInPunchId: punch.id,
              clockOutPunchId: nextPunch.id,
              notes: punch.notes || nextPunch.notes,
              hasClockInTime: true,
              hasClockOutTime: true,
              isImported: Boolean(importSource),
              importSource: importSource || undefined,
            });
            i++; // Skip the clock_out - required for loop control
          }
        }
      }
      
      const totalHours = blocks.reduce((sum, block) => 
        sum + getBlockDurationMinutes(block) / 60, 0
      );
      
      const hasWarning = totalHours > 12;
      const warningText = hasWarning ? 'Over 12 hours' : undefined;
      
      dayMap.set(employee.id, {
        employee,
        date,
        blocks,
        totalHours,
        hasWarning,
        warningText,
        expanded: false,
      });
    });
    
    setEmployeeDays(dayMap);
  }, [employees, existingPunches, date]);

  // Calculate position from time
  const getPositionFromTime = (time: Date): number => {
    const hour = time.getHours() + time.getMinutes() / 60;
    const relativeHour = hour - HOURS_START;
    return (relativeHour / TOTAL_HOURS) * 100;
  };

  // Calculate time from position
const getTimeFromPosition = (positionPercent: number): Date => {
  const relativeHour = (positionPercent / 100) * TOTAL_HOURS;
  const hour = HOURS_START + relativeHour;
  const result = addHours(startOfDay(date), hour);
  return snapToInterval(result);
};

const getBlockDurationMinutes = (block: TimeBlock) => {
  if (!block.hasClockInTime || !block.hasClockOutTime) {
    return 0;
  }
  const diffMinutes = differenceInMinutes(block.endTime, block.startTime);
  const adjusted = diffMinutes - (block.breakMinutes || 0);
  return Math.max(adjusted, 0);
};

  // Handle drag to create or adjust (Pointer Events API for snappy feel)
  const handlePointerDown = useCallback((
    e: React.PointerEvent<HTMLDivElement>, 
    employeeId: string, 
    blockId?: string,
    edge?: 'start' | 'end'
  ) => {
    e.preventDefault();
    const target = e.currentTarget;
    target.setPointerCapture(e.pointerId); // Capture pointer for smooth tracking
    
    const rect = target.getBoundingClientRect();
    const x = e.clientX - rect.left;
    
    setIsDragging(true);
    
    if (blockId && edge) {
      setDragState({
        employeeId,
        blockId,
        mode: edge === 'start' ? 'adjust-start' : 'adjust-end',
        startX: x,
        timelineRect: rect,
      });
    } else {
      // Create new block
      const newBlockId = `new-${Date.now()}`;
      const time = getTimeFromPosition((x / rect.width) * 100);
      
      setEmployeeDays(prev => {
        const updated = new Map(prev);
        const employeeDay = updated.get(employeeId);
        if (employeeDay) {
          employeeDay.blocks.push({
            id: newBlockId,
            startTime: time,
            endTime: time,
            isNew: true,
            hasClockInTime: true,
            hasClockOutTime: true,
          });
          updated.set(employeeId, { ...employeeDay });
        }
        return updated;
      });
      
      setDragState({
        employeeId,
        blockId: newBlockId,
        mode: 'create',
        startX: x,
        timelineRect: rect,
      });
    }
  }, [date]);

  const handlePointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragState) return;
    
    const rect = dragState.timelineRect; // Use cached rect for performance
    const x = e.clientX - rect.left;
    const positionPercent = Math.max(0, Math.min(100, (x / rect.width) * 100));
    const time = getTimeFromPosition(positionPercent);
    
    // Update drag label with snap feedback
    setDragLabel({
      text: format(time, 'h:mm a'),
      x: e.clientX,
      y: e.clientY - 40,
    });
    
    // Direct state update for instant feedback (no debouncing during drag)
    setEmployeeDays(prev => {
      const updated = new Map(prev);
      const employeeDay = updated.get(dragState.employeeId);
      if (!employeeDay) return prev;
      
      const blockIndex = employeeDay.blocks.findIndex(b => b.id === dragState.blockId);
      if (blockIndex === -1) return prev;
      
      const block = { ...employeeDay.blocks[blockIndex] };
      
      if (dragState.mode === 'create' || dragState.mode === 'adjust-end') {
        block.endTime = time;
      } else if (dragState.mode === 'adjust-start') {
        block.startTime = time;
      }
      
      // Ensure start < end
      if (block.startTime >= block.endTime) {
        return prev;
      }
      
      employeeDay.blocks[blockIndex] = block;
      employeeDay.totalHours = employeeDay.blocks.reduce((sum, b) => 
        sum + getBlockDurationMinutes(b) / 60, 0
      );
      employeeDay.hasWarning = employeeDay.totalHours > 12;
      
      updated.set(dragState.employeeId, { ...employeeDay });
      return updated;
    });
  }, [dragState, date]);

  const handlePointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragState) return;
    
    e.currentTarget.releasePointerCapture(e.pointerId);
    
    // Trigger auto-save after drag complete
    triggerAutoSave(dragState.employeeId, dragState.blockId);
    setDragState(null);
    setIsDragging(false);
    setDragLabel(null);
  }, [dragState]);

  // Helper: Update block saving state
  const updateBlockSavingState = useCallback((employeeId: string, blockId: string, isSaving: boolean) => {
    setEmployeeDays(prev => {
      const updated = new Map(prev);
      const day = updated.get(employeeId);
      if (!day) return prev;
      
      const blockIndex = day.blocks.findIndex(b => b.id === blockId);
      if (blockIndex === -1) return prev;
      
      day.blocks[blockIndex] = { ...day.blocks[blockIndex], isSaving };
      updated.set(employeeId, { ...day });
      return updated;
    });
  }, []);

  // Helper: Update block after successful save
  const updateBlockAfterSave = useCallback((
    employeeId: string,
    blockId: string,
    updates: {
      clockInPunchId?: string;
      clockOutPunchId?: string;
    }
  ) => {
    setEmployeeDays(prev => {
      const updated = new Map(prev);
      const day = updated.get(employeeId);
      if (!day) return prev;
      
      const blockIndex = day.blocks.findIndex(b => b.id === blockId);
      if (blockIndex === -1) return prev;
      
      const patchedBlock = {
        ...day.blocks[blockIndex],
        isNew: false,
        isSaving: false,
      };
      if (updates.clockInPunchId) {
        patchedBlock.clockInPunchId = updates.clockInPunchId;
      }
      if (updates.clockOutPunchId) {
        patchedBlock.clockOutPunchId = updates.clockOutPunchId;
      }
      day.blocks[blockIndex] = patchedBlock;
      updated.set(employeeId, { ...day });
      return updated;
    });
  }, []);

  // Helper: Perform save operation
  const performSave = useCallback(async (employeeId: string, blockId: string, block: TimeBlock) => {
    try {
      let createdClockIn: TimePunch | null = null;
      let createdClockOut: TimePunch | null = null;

      if (block.hasClockInTime) {
        if (block.clockInPunchId) {
          await updatePunch.mutateAsync({
            id: block.clockInPunchId,
            punch_time: block.startTime.toISOString(),
          });
        } else {
          createdClockIn = await createPunch.mutateAsync({
            restaurant_id: restaurantId,
            employee_id: employeeId,
            punch_type: 'clock_in',
            punch_time: block.startTime.toISOString(),
            notes: 'Manual entry by manager',
          });
        }
      }

      if (block.hasClockOutTime) {
        if (block.clockOutPunchId) {
          await updatePunch.mutateAsync({
            id: block.clockOutPunchId,
            punch_time: block.endTime.toISOString(),
          });
        } else {
          createdClockOut = await createPunch.mutateAsync({
            restaurant_id: restaurantId,
            employee_id: employeeId,
            punch_type: 'clock_out',
            punch_time: block.endTime.toISOString(),
            notes: 'Manual entry by manager',
          });
        }
      }

      if (createdClockIn || createdClockOut) {
        updateBlockAfterSave(employeeId, blockId, {
          ...(createdClockIn && { clockInPunchId: createdClockIn.id }),
          ...(createdClockOut && { clockOutPunchId: createdClockOut.id }),
        });
      } else {
        updateBlockSavingState(employeeId, blockId, false);
      }

      setLastSaved(new Date());
      setTimeout(() => setLastSaved(null), 2000);
    } catch (error) {
      if (import.meta.env.DEV) {
        console.error('Failed to save time block:', error);
      }
      toast({
        title: 'Failed to save',
        description: 'Could not save time entry. Please try again.',
        variant: 'destructive',
      });
      updateBlockSavingState(employeeId, blockId, false);
    }
  }, [createPunch, updatePunch, restaurantId, toast, updateBlockSavingState, updateBlockAfterSave]);

  // Auto-save with debounce
  const triggerAutoSave = useCallback((employeeId: string, blockId: string) => {
    if (saveTimeout) {
      clearTimeout(saveTimeout);
    }
    
    const timeout = setTimeout(async () => {
      const employeeDay = employeeDays.get(employeeId);
      if (!employeeDay) return;
      
      const block = employeeDay.blocks.find(b => b.id === blockId);
      if (!block) return;
      
      // Mark as saving
      updateBlockSavingState(employeeId, blockId, true);
      
      // Perform async save
      await performSave(employeeId, blockId, block);
    }, 500);
    
    setSaveTimeout(timeout);
  }, [saveTimeout, employeeDays, updateBlockSavingState, performSave]);

  // Toggle employee expansion
  const toggleExpanded = useCallback((employeeId: string) => {
    setEmployeeDays(prev => {
      const updated = new Map(prev);
      const day = updated.get(employeeId);
      if (day) {
        updated.set(employeeId, { ...day, expanded: !day.expanded });
      }
      return updated;
    });
  }, []);

  // Delete block
  const handleDeleteBlock = useCallback(async (employeeId: string, blockId: string) => {
    const employeeDay = employeeDays.get(employeeId);
    if (!employeeDay) return;
    
    const block = employeeDay.blocks.find(b => b.id === blockId);
    if (!block) return;
    
    try {
      // Delete punches if they exist
      if (block.clockInPunchId) {
        await deletePunch.mutateAsync({
          id: block.clockInPunchId,
          restaurantId,
          employeeId,
        });
      }
      if (block.clockOutPunchId) {
        await deletePunch.mutateAsync({
          id: block.clockOutPunchId,
          restaurantId,
          employeeId,
        });
      }
      
      // Remove block from UI
      setEmployeeDays(prev => {
        const updated = new Map(prev);
        const day = updated.get(employeeId);
        if (day) {
          day.blocks = day.blocks.filter(b => b.id !== blockId);
        day.totalHours = day.blocks.reduce((sum, b) => 
          sum + getBlockDurationMinutes(b) / 60, 0
        );
          day.hasWarning = day.totalHours > 12;
          updated.set(employeeId, { ...day });
        }
        return updated;
      });
    } catch (error) {
      if (import.meta.env.DEV) {
        console.error('Failed to delete block:', error);
      }
      toast({
        title: 'Failed to delete',
        description: 'Could not delete time entry.',
        variant: 'destructive',
      });
    }
  }, [employeeDays, deletePunch, restaurantId, toast]);

  // Add time block from form inputs
  const handleAddTimeBlock = useCallback((employeeId: string) => {
    const startInput = document.getElementById(`start-time-${employeeId}`) as HTMLInputElement;
    const endInput = document.getElementById(`end-time-${employeeId}`) as HTMLInputElement;
    const breakInput = document.getElementById(`break-${employeeId}`) as HTMLInputElement;
    const notesInput = document.getElementById(`notes-${employeeId}`) as HTMLInputElement;

    const startValue = startInput.value.trim();
    const endValue = endInput.value.trim();
    const hasStart = Boolean(startValue);
    const hasEnd = Boolean(endValue);

    if (!hasStart && !hasEnd) {
      toast({
        title: 'Missing time',
        description: 'Enter either a start or end time.',
        variant: 'destructive',
      });
      return;
    }

    const parseTimeValue = (value: string) => {
      const [hour, minute] = value.split(':').map(Number);
      if (Number.isNaN(hour) || Number.isNaN(minute)) return null;
      const result = new Date(date);
      result.setHours(hour, minute, 0, 0);
      return result;
    };

    const startTime = hasStart ? parseTimeValue(startValue) : null;
    const endTime = hasEnd ? parseTimeValue(endValue) : null;

    if (hasStart && !startTime) {
      toast({
        title: 'Invalid start time',
        description: 'Please enter a valid start time.',
        variant: 'destructive',
      });
      return;
    }
    if (hasEnd && !endTime) {
      toast({
        title: 'Invalid end time',
        description: 'Please enter a valid end time.',
        variant: 'destructive',
      });
      return;
    }

    if (
      hasStart
      && hasEnd
      && startTime
      && endTime
      && startTime >= endTime
    ) {
      toast({
        title: 'Invalid range',
        description: 'End time must be after start time.',
        variant: 'destructive',
      });
      return;
    }

    const finalStart = startTime ?? endTime ?? new Date(date);
    const finalEnd = endTime ?? startTime ?? new Date(date);

    const breakMinutes = Number.parseInt(breakInput.value, 10);
    const normalizedBreak = Number.isNaN(breakMinutes) ? 0 : Math.max(breakMinutes, 0);

    const newBlockId = `new-${Date.now()}`;
    setEmployeeDays(prev => {
      const updated = new Map(prev);
      const day = updated.get(employeeId);
      if (day) {
        day.blocks.push({
          id: newBlockId,
          startTime: finalStart,
          endTime: finalEnd,
          breakMinutes: normalizedBreak,
          notes: notesInput.value || undefined,
          isNew: true,
          hasClockInTime: hasStart,
          hasClockOutTime: hasEnd,
        });
        day.totalHours = day.blocks.reduce((sum, b) => 
          sum + getBlockDurationMinutes(b) / 60, 0
        );
        day.hasWarning = day.totalHours > 12;
        updated.set(employeeId, { ...day });
      }
      return updated;
    });

    triggerAutoSave(employeeId, newBlockId);

    // Clear inputs
    startInput.value = '';
    endInput.value = '';
    breakInput.value = '0';
    notesInput.value = '';
  }, [date, toast, triggerAutoSave]);

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Manual Time Entry</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {Array.from({ length: 5 }, (_, i) => (
            <Skeleton key={`skeleton-${i}`} className="h-16 w-full" />
          ))}
        </CardContent>
      </Card>
    );
  }

  if (employees.length === 0) {
    return (
      <Card>
        <CardContent className="py-12 text-center">
          <p className="text-muted-foreground">No employees to display</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>Manual Time Entry</CardTitle>
            <p className="text-sm text-muted-foreground mt-1">
              Drag across rows to mark when people worked
            </p>
          </div>
          {lastSaved && (
            <Badge variant="outline" className="bg-green-500/10 text-green-700 border-green-500/20">
              <Check className="h-3 w-3 mr-1" />
              Saved
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        {/* Time axis header */}
        <div className="flex items-center mb-2">
          <div className="w-48 flex-shrink-0"></div>
          <div className="flex-1 flex justify-between text-xs text-muted-foreground px-2">
            {Array.from({ length: 13 }, (_, i) => {
              const hour = i * 2; // 0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24
              // Format hour for display
              let displayHour: string;
              if (hour === 0) {
                displayHour = '12a';
              } else if (hour === 12) {
                displayHour = '12p';
              } else if (hour > 12) {
                displayHour = `${hour - 12}p`;
              } else {
                displayHour = `${hour}a`;
              }
              return (
                <span key={hour}>
                  {displayHour}
                </span>
              );
            })}
          </div>
          <div className="w-32 flex-shrink-0"></div>
        </div>

        {/* Employee rows */}
        {Array.from(employeeDays.values()).map((employeeDay) => (
          <div key={employeeDay.employee.id} className="border rounded-lg overflow-hidden">
            {/* Timeline row */}
            <div className="flex items-center hover:bg-accent/50 transition-colors">
              {/* Employee name with avatar */}
              <button
                onClick={() => toggleExpanded(employeeDay.employee.id)}
                className="w-48 flex-shrink-0 p-3 text-left hover:bg-accent"
              >
                <div className="flex items-center gap-3">
                  <span className="relative flex shrink-0 overflow-hidden rounded-full h-8 w-8 border-2 border-background shadow-sm">
                    <span className="flex h-full w-full items-center justify-center rounded-full bg-primary/10 text-primary font-semibold text-xs">
                      {employeeDay.employee.name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)}
                    </span>
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-sm text-foreground truncate">{employeeDay.employee.name}</p>
                    <p className="text-xs text-muted-foreground truncate">{employeeDay.employee.position || 'Staff'}</p>
                  </div>
                  {employeeDay.expanded ? (
                    <ChevronUp className="h-4 w-4 flex-shrink-0" />
                  ) : (
                    <ChevronDown className="h-4 w-4 flex-shrink-0" />
                  )}
                </div>
              </button>
              
              {/* Timeline */}
              <div 
                className="flex-1 relative h-12 bg-muted/30 cursor-crosshair touch-none select-none"
                onPointerDown={(e) => handlePointerDown(e, employeeDay.employee.id)}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                onPointerCancel={handlePointerUp}
              >
                {/* Hour grid lines */}
                {Array.from({ length: TOTAL_HOURS }, (_, i) => (
                  <div
                    key={i}
                    className="absolute top-0 bottom-0 border-l border-border/30"
                    style={{ left: `${(i / TOTAL_HOURS) * 100}%` }}
                  />
                ))}
                
                {/* Time blocks */}
                {employeeDay.blocks.map((block) => {
                  const startPos = getPositionFromTime(block.startTime);
                  const endPos = getPositionFromTime(block.endTime);
                  const width = endPos - startPos;
                  
                  return (
                    <div
                      key={block.id}
                      className={cn(
                        "absolute top-1 bottom-1 rounded-md flex items-center justify-center px-2 text-xs font-medium text-primary-foreground touch-none select-none",
                        !isDragging && "transition-all duration-150", // Only transition when NOT dragging
                        block.isSaving 
                          ? "bg-primary/50 animate-pulse" 
                          : block.isImported
                          ? "bg-primary/60 hover:bg-primary/70 border border-primary/30"
                          : "bg-primary hover:bg-primary/90"
                      )}
                      style={{
                        left: `${startPos}%`,
                        width: `${width}%`,
                      }}
                    >
                      {/* Time label inside block */}
                      {width > 8 && (
                        <span className="truncate pointer-events-none">
                          {format(block.startTime, 'HH:mm')} - {format(block.endTime, 'HH:mm')}
                        </span>
                      )}
                      
                      {/* Drag handles */}
                      <div
                        className="absolute left-0 top-0 bottom-0 w-2 cursor-ew-resize hover:bg-primary-foreground/20 z-10"
                        onPointerDown={(e) => {
                          e.stopPropagation();
                          handlePointerDown(e, employeeDay.employee.id, block.id, 'start');
                        }}
                      />
                      <div
                        className="absolute right-0 top-0 bottom-0 w-2 cursor-ew-resize hover:bg-primary-foreground/20 z-10"
                        onPointerDown={(e) => {
                          e.stopPropagation();
                          handlePointerDown(e, employeeDay.employee.id, block.id, 'end');
                        }}
                      />
                    </div>
                  );
                })}
              </div>
              
              {/* Hours total and status */}
              <div className="w-32 flex-shrink-0 p-3 text-right">
                <div className="font-medium">
                  {formatDuration(Math.round(employeeDay.totalHours * 60))}
                </div>
                {employeeDay.hasWarning && (
                  <Badge variant="outline" className="bg-yellow-500/10 text-yellow-700 border-yellow-500/20 text-xs">
                    <AlertCircle className="h-3 w-3 mr-1" />
                    {employeeDay.warningText}
                  </Badge>
                )}
                {employeeDay.totalHours > 0 && !employeeDay.hasWarning && (
                  <Check className="h-4 w-4 text-green-600 inline-block" />
                )}
              </div>
            </div>
            
            {/* Expanded inline editor */}
            {employeeDay.expanded && (
              <div className="px-4 pb-4 pt-0 border-t border-border/50">
                <div className="pt-4 grid grid-cols-4 gap-4">
                  {/* Start Time */}
                  <div className="space-y-1.5">
                    <Label className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                      <Clock className="h-3 w-3" />
                      Start Time
                    </Label>
                    <Input
                      id={`start-time-${employeeDay.employee.id}`}
                      type="time"
                      className="h-9 text-sm"
                    />
                  </div>
                  
                  {/* End Time */}
                  <div className="space-y-1.5">
                    <Label className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                      <Clock className="h-3 w-3" />
                      End Time
                    </Label>
                    <Input
                      id={`end-time-${employeeDay.employee.id}`}
                      type="time"
                      className="h-9 text-sm"
                    />
                  </div>
                  
                  {/* Break */}
                  <div className="space-y-1.5">
                    <Label className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                      <Coffee className="h-3 w-3" />
                      Break (mins)
                    </Label>
                    <Input
                      id={`break-${employeeDay.employee.id}`}
                      type="number"
                      min="0"
                      max="120"
                      defaultValue="0"
                      className="h-9 text-sm"
                    />
                  </div>
                  
                  {/* Notes */}
                  <div className="space-y-1.5">
                    <Label className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                      <MessageSquare className="h-3 w-3" />
                      Notes
                    </Label>
                    <Input
                      id={`notes-${employeeDay.employee.id}`}
                      type="text"
                      placeholder="Optional note..."
                      className="h-9 text-sm"
                    />
                  </div>
                </div>
                
                {/* Add Button */}
                <div className="mt-4">
                  <Button
                    size="sm"
                    className="w-full"
                    onClick={() => handleAddTimeBlock(employeeDay.employee.id)}
                  >
                    <Plus className="h-4 w-4 mr-2" />
                    Add Time Block
                  </Button>
                </div>
                
                {/* Block list */}
                {employeeDay.blocks.length > 0 && (
                  <div className="space-y-2 mt-4">
                    <Label className="text-sm">Time blocks</Label>
                    {employeeDay.blocks.map((block) => {
                      const workMinutes = getBlockDurationMinutes(block);
                      return (
                        <div
                          key={block.id}
                          className="flex items-start justify-between p-3 rounded-md border bg-background"
                        >
                          <div className="space-y-1 flex-1">
                            <div className="flex items-center gap-3">
                              <span className="text-sm font-medium">
                                {format(block.startTime, 'h:mm a')}
                              </span>
                              <span className="text-muted-foreground">→</span>
                              <span className="text-sm font-medium">
                                {format(block.endTime, 'h:mm a')}
                              </span>
                              <span className="text-xs text-muted-foreground">
                                ({formatDuration(workMinutes)})
                              </span>
                              {block.isImported && (
                                <>
                                  <Badge variant="outline" className="text-xs bg-muted/40 border-muted-foreground/30">
                                    Imported
                                  </Badge>
                                  {block.importSource && (
                                    <Badge variant="outline" className="text-xs bg-muted/40 border-muted-foreground/30">
                                      {block.importSource}
                                    </Badge>
                                  )}
                                </>
                              )}
                            </div>
                            {Boolean(block.breakMinutes && block.breakMinutes > 0) && (
                              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                                <Coffee className="h-3 w-3" />
                                Break: {block.breakMinutes} mins
                              </div>
                            )}
                            {block.notes && (
                              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                                <MessageSquare className="h-3 w-3" />
                                {block.notes}
                              </div>
                            )}
                          </div>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => handleDeleteBlock(employeeDay.employee.id, block.id)}
                          >
                            Delete
                          </Button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
        
        {/* Footer summary */}
        <div className="mt-4 p-4 rounded-lg border bg-muted/20">
          <div className="flex items-center justify-between">
            <div className="text-sm text-muted-foreground">
              Total hours for {format(date, 'MMM d, yyyy')}
            </div>
            <div className="text-xl font-bold">
              {formatDuration(
                Math.round(
                  Array.from(employeeDays.values())
                    .reduce((sum, day) => sum + day.totalHours, 0) * 60
                )
              )}
            </div>
          </div>
        </div>
      </CardContent>
      
      {/* Floating drag label for snap feedback */}
      {dragLabel && (
        <div
          className="fixed z-50 pointer-events-none"
          style={{
            left: `${dragLabel.x}px`,
            top: `${dragLabel.y}px`,
            transform: 'translateX(-50%)',
          }}
        >
          <div className="bg-primary text-primary-foreground px-3 py-1.5 rounded-md shadow-lg text-sm font-medium border-2 border-primary-foreground/20">
            {dragLabel.text}
          </div>
        </div>
      )}
    </Card>
  );
};
