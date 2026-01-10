import { useState, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Slider } from '@/components/ui/slider';
import { Label } from '@/components/ui/label';
import { Check, AlertCircle, Plus, Trash2 } from 'lucide-react';
import { format, startOfDay, setHours, setMinutes, differenceInMinutes } from 'date-fns';
import { cn } from '@/lib/utils';
import { formatHourToTime } from '@/lib/timeUtils';
import { useCreateTimePunch, useUpdateTimePunch, useDeleteTimePunch } from '@/hooks/useTimePunches';
import { useToast } from '@/hooks/use-toast';
import { Employee } from '@/types/scheduling';

interface TimeBlock {
  id: string;
  startHour: number; // 0-24 with decimals (e.g., 9.5 = 9:30)
  endHour: number;
  clockInPunchId?: string;
  clockOutPunchId?: string;
  isSaving?: boolean;
}

interface MobileTimeEntryProps {
  employees: Employee[];
  date: Date;
  restaurantId: string;
  onSave?: () => void;
}

const HOUR_MARKS = [6, 8, 10, 12, 14, 16, 18, 20, 22, 24];

export const MobileTimeEntry = ({ employees, date, restaurantId, onSave }: MobileTimeEntryProps) => {
  const { toast } = useToast();
  const createPunch = useCreateTimePunch();
  const updatePunch = useUpdateTimePunch();
  const deletePunch = useDeleteTimePunch();
  
  const [employeeBlocks, setEmployeeBlocks] = useState<Map<string, TimeBlock[]>>(new Map());
  const [expandedEmployee, setExpandedEmployee] = useState<string | null>(null);

  const calculateTotalHours = (blocks: TimeBlock[]): number => {
    return blocks.reduce((sum, block) => sum + (block.endHour - block.startHour), 0);
  };

  const addBlock = useCallback((employeeId: string) => {
    const newBlock: TimeBlock = {
      id: `new-${Date.now()}`,
      startHour: 9,
      endHour: 17,
    };
    
    setEmployeeBlocks(prev => {
      const updated = new Map(prev);
      const blocks = updated.get(employeeId) || [];
      updated.set(employeeId, [...blocks, newBlock]);
      return updated;
    });
  }, []);

  const updateBlock = useCallback((employeeId: string, blockId: string, startHour: number, endHour: number) => {
    setEmployeeBlocks(prev => {
      const updated = new Map(prev);
      const blocks = updated.get(employeeId) || [];
      const blockIndex = blocks.findIndex(b => b.id === blockId);
      
      if (blockIndex !== -1) {
        const updatedBlocks = [...blocks];
        updatedBlocks[blockIndex] = {
          ...updatedBlocks[blockIndex],
          startHour,
          endHour,
        };
        updated.set(employeeId, updatedBlocks);
      }
      
      return updated;
    });
  }, []);

  const saveBlock = useCallback(async (employeeId: string, block: TimeBlock) => {
    try {
      // Mark as saving
      setEmployeeBlocks(prev => {
        const updated = new Map(prev);
        const blocks = updated.get(employeeId) || [];
        const blockIndex = blocks.findIndex(b => b.id === block.id);
        if (blockIndex !== -1) {
          const updatedBlocks = [...blocks];
          updatedBlocks[blockIndex] = { ...updatedBlocks[blockIndex], isSaving: true };
          updated.set(employeeId, updatedBlocks);
        }
        return updated;
      });

      const startTime = setMinutes(
        setHours(startOfDay(date), Math.floor(block.startHour)),
        Math.round((block.startHour - Math.floor(block.startHour)) * 60)
      );
      
      const endTime = setMinutes(
        setHours(startOfDay(date), Math.floor(block.endHour)),
        Math.round((block.endHour - Math.floor(block.endHour)) * 60)
      );

      if (!block.clockInPunchId) {
        // Create new punches
        const clockInResult = await createPunch.mutateAsync({
          restaurant_id: restaurantId,
          employee_id: employeeId,
          punch_type: 'clock_in',
          punch_time: startTime.toISOString(),
          notes: 'Mobile manual entry',
        });
        
        const clockOutResult = await createPunch.mutateAsync({
          restaurant_id: restaurantId,
          employee_id: employeeId,
          punch_type: 'clock_out',
          punch_time: endTime.toISOString(),
          notes: 'Mobile manual entry',
        });
        
        // Update block with IDs
        setEmployeeBlocks(prev => {
          const updated = new Map(prev);
          const blocks = updated.get(employeeId) || [];
          const blockIndex = blocks.findIndex(b => b.id === block.id);
          if (blockIndex !== -1) {
            const updatedBlocks = [...blocks];
            updatedBlocks[blockIndex] = {
              ...updatedBlocks[blockIndex],
              clockInPunchId: clockInResult.id,
              clockOutPunchId: clockOutResult.id,
              isSaving: false,
            };
            updated.set(employeeId, updatedBlocks);
          }
          return updated;
        });
      } else {
        // Update existing punches
        if (block.clockInPunchId) {
          await updatePunch.mutateAsync({
            id: block.clockInPunchId,
            punch_time: startTime.toISOString(),
          });
        }
        if (block.clockOutPunchId) {
          await updatePunch.mutateAsync({
            id: block.clockOutPunchId,
            punch_time: endTime.toISOString(),
          });
        }
        
        // Remove saving state
        setEmployeeBlocks(prev => {
          const updated = new Map(prev);
          const blocks = updated.get(employeeId) || [];
          const blockIndex = blocks.findIndex(b => b.id === block.id);
          if (blockIndex !== -1) {
            const updatedBlocks = [...blocks];
            updatedBlocks[blockIndex] = { ...updatedBlocks[blockIndex], isSaving: false };
            updated.set(employeeId, updatedBlocks);
          }
          return updated;
        });
      }
      
      toast({
        title: 'Saved',
        description: 'Time entry saved successfully',
      });
      
      onSave?.();
    } catch (error) {
      if (import.meta.env.DEV) {
        console.error('Failed to save:', error);
      }
      toast({
        title: 'Failed to save',
        description: 'Could not save time entry',
        variant: 'destructive',
      });
    }
  }, [date, restaurantId, createPunch, updatePunch, toast, onSave]);

  const deleteBlock = useCallback(async (employeeId: string, blockId: string) => {
    const blocks = employeeBlocks.get(employeeId) || [];
    const block = blocks.find(b => b.id === blockId);
    if (!block) return;
    
    try {
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
      
      setEmployeeBlocks(prev => {
        const updated = new Map(prev);
        const currentBlocks = updated.get(employeeId) || [];
        updated.set(employeeId, currentBlocks.filter(b => b.id !== blockId));
        return updated;
      });
    } catch (error) {
      if (import.meta.env.DEV) {
        console.error('Failed to delete:', error);
      }
      toast({
        title: 'Failed to delete',
        description: 'Could not delete time entry',
        variant: 'destructive',
      });
    }
  }, [employeeBlocks, deletePunch, restaurantId, toast]);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Mobile Time Entry</CardTitle>
          <p className="text-sm text-muted-foreground">
            {format(date, 'EEEE, MMMM d, yyyy')}
          </p>
        </CardHeader>
      </Card>

      {employees.map((employee) => {
        const blocks = employeeBlocks.get(employee.id) || [];
        const totalHours = calculateTotalHours(blocks);
        const isExpanded = expandedEmployee === employee.id;
        const hasWarning = totalHours > 12;

        return (
          <Card key={employee.id} className="overflow-hidden">
            <button
              onClick={() => setExpandedEmployee(isExpanded ? null : employee.id)}
              className="w-full text-left"
            >
              <CardHeader className="cursor-pointer hover:bg-accent/50 transition-colors">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-medium">{employee.name}</div>
                    <div className="text-sm text-muted-foreground">{employee.position}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    {totalHours > 0 && (
                      <>
                        <span className="text-lg font-bold">{totalHours.toFixed(1)}h</span>
                        {hasWarning ? (
                          <Badge variant="outline" className="bg-yellow-500/10 text-yellow-700 border-yellow-500/20">
                            <AlertCircle className="h-3 w-3 mr-1" />
                            Over 12h
                          </Badge>
                        ) : (
                          <Check className="h-5 w-5 text-green-600" />
                        )}
                      </>
                    )}
                  </div>
                </div>
              </CardHeader>
            </button>

            {isExpanded && (
              <CardContent className="space-y-4 pt-4">
                {blocks.map((block) => (
                  <div
                    key={block.id}
                    className={cn(
                      "p-4 rounded-lg border space-y-4",
                      block.isSaving ? "bg-muted/50 animate-pulse" : "bg-background"
                    )}
                  >
                    <div className="flex items-center justify-between">
                      <Label className="text-sm font-medium">
                        {formatHourToTime(block.startHour)} - {formatHourToTime(block.endHour)}
                      </Label>
                      <div className="flex items-center gap-2">
                        <span className="text-sm text-muted-foreground">
                          {(block.endHour - block.startHour).toFixed(1)}h
                        </span>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => deleteBlock(employee.id, block.id)}
                          disabled={block.isSaving}
                          aria-label="Delete time block"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>

                    {/* Start time slider */}
                    <div className="space-y-2">
                      <Label className="text-xs text-muted-foreground">Start time</Label>
                      <Slider
                        min={6}
                        max={24}
                        step={0.25}
                        value={[block.startHour]}
                        onValueChange={([value]) => {
                          if (value < block.endHour) {
                            updateBlock(employee.id, block.id, value, block.endHour);
                          }
                        }}
                        onValueCommit={() => saveBlock(employee.id, block)}
                        className="touch-action-none"
                      />
                      <div className="flex justify-between text-xs text-muted-foreground">
                        {HOUR_MARKS.map(hour => (
                          <span key={hour}>{hour > 12 ? hour - 12 : hour}{hour >= 12 ? 'p' : 'a'}</span>
                        ))}
                      </div>
                    </div>

                    {/* End time slider */}
                    <div className="space-y-2">
                      <Label className="text-xs text-muted-foreground">End time</Label>
                      <Slider
                        min={6}
                        max={24}
                        step={0.25}
                        value={[block.endHour]}
                        onValueChange={([value]) => {
                          if (value > block.startHour) {
                            updateBlock(employee.id, block.id, block.startHour, value);
                          }
                        }}
                        onValueCommit={() => saveBlock(employee.id, block)}
                        className="touch-action-none"
                      />
                    </div>
                  </div>
                ))}

                <Button
                  variant="outline"
                  className="w-full"
                  onClick={() => addBlock(employee.id)}
                >
                  <Plus className="h-4 w-4 mr-2" />
                  Add time block
                </Button>
              </CardContent>
            )}
          </Card>
        );
      })}
    </div>
  );
};
