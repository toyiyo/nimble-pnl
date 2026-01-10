import { useState, useMemo, useCallback, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Label } from '@/components/ui/label';
import { Plus, Check, AlertCircle, ChevronDown, ChevronUp } from 'lucide-react';
import { format, startOfDay, addHours, differenceInMinutes, setHours, setMinutes, isSameDay } from 'date-fns';
import { cn } from '@/lib/utils';
import { useCreateTimePunch, useUpdateTimePunch, useDeleteTimePunch } from '@/hooks/useTimePunches';
import { useToast } from '@/hooks/use-toast';
import { TimePunch } from '@/types/timeTracking';
import { Employee } from '@/types/scheduling';

interface TimeBlock {
  id: string; // Unique ID for UI, maps to punch pair
  startTime: Date;
  endTime: Date;
  clockInPunchId?: string;
  clockOutPunchId?: string;
  isNew?: boolean; // Track if this is unsaved
  isSaving?: boolean;
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

const HOURS_START = 6; // 6am
const HOURS_END = 24; // 12am (midnight)
const TOTAL_HOURS = HOURS_END - HOURS_START;
const SNAP_MINUTES = 5;

// Helper to round time to nearest snap interval
const snapToInterval = (date: Date): Date => {
  const minutes = date.getMinutes();
  const remainder = minutes % SNAP_MINUTES;
  const snappedMinutes = remainder < SNAP_MINUTES / 2 
    ? minutes - remainder 
    : minutes + (SNAP_MINUTES - remainder);
  return setMinutes(date, snappedMinutes);
};

// Helper to parse flexible time input (9-530, 9a-5:30p, 09:00-17:30)
const parseTimeRange = (input: string, date: Date): { start: Date; end: Date } | null => {
  // Remove whitespace
  input = input.trim().replace(/\s+/g, '');
  
  // Pattern: 9-530, 9-5, 9:00-17:30, 9a-5p, 9am-5:30pm
  const rangeMatch = input.match(/^(\d{1,2}):?(\d{2})?([ap]m?)?[-–](\d{1,2}):?(\d{2})?([ap]m?)?$/i);
  
  if (!rangeMatch) return null;
  
  const [, startHour, startMin = '00', startPeriod, endHour, endMin = '00', endPeriod] = rangeMatch;
  
  let startH = parseInt(startHour);
  let endH = parseInt(endHour);
  
  // Handle AM/PM
  if (startPeriod) {
    if (startPeriod.toLowerCase().startsWith('p') && startH < 12) startH += 12;
    if (startPeriod.toLowerCase().startsWith('a') && startH === 12) startH = 0;
  }
  if (endPeriod) {
    if (endPeriod.toLowerCase().startsWith('p') && endH < 12) endH += 12;
    if (endPeriod.toLowerCase().startsWith('a') && endH === 12) endH = 0;
  }
  
  const start = setMinutes(setHours(startOfDay(date), startH), parseInt(startMin));
  const end = setMinutes(setHours(startOfDay(date), endH), parseInt(endMin));
  
  if (start >= end) return null; // Invalid range
  
  return { start: snapToInterval(start), end: snapToInterval(end) };
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
          if (nextPunch && nextPunch.punch_type === 'clock_out') {
            blocks.push({
              id: `${punch.id}-${nextPunch.id}`,
              startTime: new Date(punch.punch_time),
              endTime: new Date(nextPunch.punch_time),
              clockInPunchId: punch.id,
              clockOutPunchId: nextPunch.id,
            });
            i++; // Skip the clock_out
          }
        }
      }
      
      const totalHours = blocks.reduce((sum, block) => 
        sum + differenceInMinutes(block.endTime, block.startTime) / 60, 0
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

  // Handle drag to create or adjust
  const handleMouseDown = useCallback((
    e: React.MouseEvent<HTMLDivElement>, 
    employeeId: string, 
    blockId?: string,
    edge?: 'start' | 'end'
  ) => {
    e.preventDefault();
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    
    if (blockId && edge) {
      setDragState({
        employeeId,
        blockId,
        mode: edge === 'start' ? 'adjust-start' : 'adjust-end',
        startX: x,
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
      });
    }
  }, [date]);

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!dragState) return;
    
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const positionPercent = (x / rect.width) * 100;
    const time = getTimeFromPosition(positionPercent);
    
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
        sum + differenceInMinutes(b.endTime, b.startTime) / 60, 0
      );
      employeeDay.hasWarning = employeeDay.totalHours > 12;
      
      updated.set(dragState.employeeId, { ...employeeDay });
      return updated;
    });
  }, [dragState, date]);

  const handleMouseUp = useCallback(() => {
    if (!dragState) return;
    
    // Trigger auto-save after drag complete
    triggerAutoSave(dragState.employeeId, dragState.blockId);
    setDragState(null);
  }, [dragState]);

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
      
      try {
        // Mark as saving
        setEmployeeDays(prev => {
          const updated = new Map(prev);
          const day = updated.get(employeeId);
          if (day) {
            const blockIndex = day.blocks.findIndex(b => b.id === blockId);
            if (blockIndex !== -1) {
              day.blocks[blockIndex] = { ...day.blocks[blockIndex], isSaving: true };
              updated.set(employeeId, { ...day });
            }
          }
          return updated;
        });

        if (block.isNew || !block.clockInPunchId) {
          // Create new punch pair
          const clockInResult = await createPunch.mutateAsync({
            restaurant_id: restaurantId,
            employee_id: employeeId,
            punch_type: 'clock_in',
            punch_time: block.startTime.toISOString(),
            notes: 'Manual entry by manager',
          });
          
          const clockOutResult = await createPunch.mutateAsync({
            restaurant_id: restaurantId,
            employee_id: employeeId,
            punch_type: 'clock_out',
            punch_time: block.endTime.toISOString(),
            notes: 'Manual entry by manager',
          });
          
          // Update block with IDs
          setEmployeeDays(prev => {
            const updated = new Map(prev);
            const day = updated.get(employeeId);
            if (day) {
              const blockIndex = day.blocks.findIndex(b => b.id === blockId);
              if (blockIndex !== -1) {
                day.blocks[blockIndex] = {
                  ...day.blocks[blockIndex],
                  clockInPunchId: clockInResult.id,
                  clockOutPunchId: clockOutResult.id,
                  isNew: false,
                  isSaving: false,
                };
                updated.set(employeeId, { ...day });
              }
            }
            return updated;
          });
        } else {
          // Update existing punches
          if (block.clockInPunchId) {
            await updatePunch.mutateAsync({
              id: block.clockInPunchId,
              punch_time: block.startTime.toISOString(),
            });
          }
          if (block.clockOutPunchId) {
            await updatePunch.mutateAsync({
              id: block.clockOutPunchId,
              punch_time: block.endTime.toISOString(),
            });
          }
          
          // Remove saving state
          setEmployeeDays(prev => {
            const updated = new Map(prev);
            const day = updated.get(employeeId);
            if (day) {
              const blockIndex = day.blocks.findIndex(b => b.id === blockId);
              if (blockIndex !== -1) {
                day.blocks[blockIndex] = { ...day.blocks[blockIndex], isSaving: false };
                updated.set(employeeId, { ...day });
              }
            }
            return updated;
          });
        }
        
        setLastSaved(new Date());
        setTimeout(() => setLastSaved(null), 2000);
      } catch (error) {
        console.error('Failed to save time block:', error);
        toast({
          title: 'Failed to save',
          description: 'Could not save time entry. Please try again.',
          variant: 'destructive',
        });
      }
    }, 500);
    
    setSaveTimeout(timeout);
  }, [employeeDays, createPunch, updatePunch, restaurantId, toast, saveTimeout]);

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

  // Handle inline time input
  const handleInlineTimeInput = useCallback((employeeId: string, input: string) => {
    const employeeDay = employeeDays.get(employeeId);
    if (!employeeDay) return;
    
    const parsed = parseTimeRange(input, date);
    if (!parsed) {
      toast({
        title: 'Invalid format',
        description: 'Try: 9-530, 9a-5:30p, or 09:00-17:30',
        variant: 'destructive',
      });
      return;
    }
    
    const newBlockId = `new-${Date.now()}`;
    setEmployeeDays(prev => {
      const updated = new Map(prev);
      const day = updated.get(employeeId);
      if (day) {
        day.blocks.push({
          id: newBlockId,
          startTime: parsed.start,
          endTime: parsed.end,
          isNew: true,
        });
        day.totalHours = day.blocks.reduce((sum, b) => 
          sum + differenceInMinutes(b.endTime, b.startTime) / 60, 0
        );
        day.hasWarning = day.totalHours > 12;
        updated.set(employeeId, { ...day });
      }
      return updated;
    });
    
    triggerAutoSave(employeeId, newBlockId);
  }, [employeeDays, date, toast, triggerAutoSave]);

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
            sum + differenceInMinutes(b.endTime, b.startTime) / 60, 0
          );
          day.hasWarning = day.totalHours > 12;
          updated.set(employeeId, { ...day });
        }
        return updated;
      });
    } catch (error) {
      console.error('Failed to delete block:', error);
      toast({
        title: 'Failed to delete',
        description: 'Could not delete time entry.',
        variant: 'destructive',
      });
    }
  }, [employeeDays, deletePunch, restaurantId, toast]);

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Manual Time Entry</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {[...Array(5)].map((_, i) => (
            <Skeleton key={i} className="h-16 w-full" />
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
            {Array.from({ length: TOTAL_HOURS / 2 }, (_, i) => {
              const hour = HOURS_START + i * 2;
              return (
                <span key={hour}>
                  {hour === 12 ? '12p' : hour > 12 ? `${hour - 12}p` : `${hour}a`}
                </span>
              );
            })}
          </div>
          <div className="w-24 flex-shrink-0"></div>
        </div>

        {/* Employee rows */}
        {Array.from(employeeDays.values()).map((employeeDay) => (
          <div key={employeeDay.employee.id} className="border rounded-lg overflow-hidden">
            {/* Timeline row */}
            <div className="flex items-center hover:bg-accent/50 transition-colors">
              {/* Employee name */}
              <button
                onClick={() => toggleExpanded(employeeDay.employee.id)}
                className="w-48 flex-shrink-0 p-3 text-left flex items-center gap-2 hover:bg-accent"
              >
                <span className="font-medium">{employeeDay.employee.name}</span>
                {employeeDay.expanded ? (
                  <ChevronUp className="h-4 w-4" />
                ) : (
                  <ChevronDown className="h-4 w-4" />
                )}
              </button>
              
              {/* Timeline */}
              <div 
                className="flex-1 relative h-12 bg-muted/30 cursor-crosshair"
                onMouseDown={(e) => handleMouseDown(e, employeeDay.employee.id)}
                onMouseMove={handleMouseMove}
                onMouseUp={handleMouseUp}
                onMouseLeave={handleMouseUp}
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
                        "absolute top-1 bottom-1 rounded-md transition-all",
                        block.isSaving 
                          ? "bg-primary/50 animate-pulse" 
                          : "bg-primary hover:bg-primary/90"
                      )}
                      style={{
                        left: `${startPos}%`,
                        width: `${width}%`,
                      }}
                    >
                      {/* Drag handles */}
                      <div
                        className="absolute left-0 top-0 bottom-0 w-2 cursor-ew-resize hover:bg-primary-foreground/20"
                        onMouseDown={(e) => {
                          e.stopPropagation();
                          handleMouseDown(e, employeeDay.employee.id, block.id, 'start');
                        }}
                      />
                      <div
                        className="absolute right-0 top-0 bottom-0 w-2 cursor-ew-resize hover:bg-primary-foreground/20"
                        onMouseDown={(e) => {
                          e.stopPropagation();
                          handleMouseDown(e, employeeDay.employee.id, block.id, 'end');
                        }}
                      />
                    </div>
                  );
                })}
              </div>
              
              {/* Hours total and status */}
              <div className="w-24 flex-shrink-0 p-3 text-right">
                <div className="font-medium">
                  {employeeDay.totalHours.toFixed(1)}h
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
              <div className="p-4 bg-muted/30 border-t space-y-3">
                <div>
                  <Label className="text-sm">Add time block</Label>
                  <div className="flex gap-2 mt-1">
                    <Input
                      placeholder="e.g., 9-530, 9a-5:30p"
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          handleInlineTimeInput(employeeDay.employee.id, e.currentTarget.value);
                          e.currentTarget.value = '';
                        }
                      }}
                      className="flex-1"
                    />
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={(e) => {
                        const input = e.currentTarget.previousElementSibling as HTMLInputElement;
                        handleInlineTimeInput(employeeDay.employee.id, input.value);
                        input.value = '';
                      }}
                    >
                      <Plus className="h-4 w-4 mr-1" />
                      Add
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    Formats: 9-530, 9a-5:30p, 09:00-17:30
                  </p>
                </div>
                
                {/* Block list */}
                {employeeDay.blocks.length > 0 && (
                  <div className="space-y-2">
                    <Label className="text-sm">Time blocks</Label>
                    {employeeDay.blocks.map((block) => (
                      <div
                        key={block.id}
                        className="flex items-center justify-between p-2 rounded-md border bg-background"
                      >
                        <div className="flex items-center gap-3">
                          <span className="text-sm font-medium">
                            {format(block.startTime, 'h:mm a')}
                          </span>
                          <span className="text-muted-foreground">→</span>
                          <span className="text-sm font-medium">
                            {format(block.endTime, 'h:mm a')}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            ({(differenceInMinutes(block.endTime, block.startTime) / 60).toFixed(1)}h)
                          </span>
                        </div>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => handleDeleteBlock(employeeDay.employee.id, block.id)}
                        >
                          Delete
                        </Button>
                      </div>
                    ))}
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
              {Array.from(employeeDays.values())
                .reduce((sum, day) => sum + day.totalHours, 0)
                .toFixed(1)}h
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};
