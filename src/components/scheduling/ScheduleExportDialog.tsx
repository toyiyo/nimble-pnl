import { useState, useEffect, useMemo, useCallback } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Printer, FileDown } from "lucide-react";
import { format, eachDayOfInterval, isSameDay, parseISO } from "date-fns";
import { generateSchedulePDF } from "@/utils/scheduleExport";
import type { Shift, Employee } from "@/types/scheduling";

interface ScheduleExportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  shifts: Shift[];
  employees: Employee[];
  weekStart: Date;
  weekEnd: Date;
  restaurantName?: string;
  positionFilter?: string;
}

export const ScheduleExportDialog = ({
  open,
  onOpenChange,
  shifts,
  employees,
  weekStart,
  weekEnd,
  restaurantName = "Restaurant",
  positionFilter,
}: ScheduleExportDialogProps) => {
  const [includePositions, setIncludePositions] = useState(true);
  const [includeHoursSummary, setIncludeHoursSummary] = useState(false);
  const [selectedEmployeeIds, setSelectedEmployeeIds] = useState<Set<string>>(new Set());

  const weekDays = eachDayOfInterval({ start: weekStart, end: weekEnd });

  // Filter shifts by position
  const positionFilteredShifts = useMemo(() =>
    positionFilter && positionFilter !== "all"
      ? shifts.filter(s => {
          const emp = employees.find(e => e.id === s.employee_id);
          return emp?.position === positionFilter;
        })
      : shifts,
    [shifts, employees, positionFilter]
  );

  // All employees who have shifts (after position filter)
  const allEmployeesWithShifts = useMemo(() => {
    const ids = new Set(positionFilteredShifts.map(s => s.employee_id));
    return employees
      .filter(emp => ids.has(emp.id))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [positionFilteredShifts, employees]);

  // Initialize selection to all employees when dialog opens or list changes
  useEffect(() => {
    if (open) {
      setSelectedEmployeeIds(new Set(allEmployeesWithShifts.map(e => e.id)));
    }
  }, [open, allEmployeesWithShifts]);

  const toggleEmployee = useCallback((empId: string) => {
    setSelectedEmployeeIds(prev => {
      const next = new Set(prev);
      if (next.has(empId)) {
        next.delete(empId);
      } else {
        next.add(empId);
      }
      return next;
    });
  }, []);

  const selectAll = useCallback(() => {
    setSelectedEmployeeIds(new Set(allEmployeesWithShifts.map(e => e.id)));
  }, [allEmployeesWithShifts]);

  const deselectAll = useCallback(() => {
    setSelectedEmployeeIds(new Set());
  }, []);

  // Preview: only selected employees, capped at 4
  const previewEmployees = useMemo(() =>
    allEmployeesWithShifts
      .filter(emp => selectedEmployeeIds.has(emp.id))
      .slice(0, 4),
    [allEmployeesWithShifts, selectedEmployeeIds]
  );

  const selectedCount = selectedEmployeeIds.size;
  const totalAvailable = allEmployeesWithShifts.length;

  const getShiftDisplay = (employeeId: string, day: Date): string => {
    const dayShifts = positionFilteredShifts.filter(
      s => s.employee_id === employeeId && isSameDay(parseISO(s.start_time), day)
    );
    if (dayShifts.length === 0) return "OFF";

    return dayShifts.map(s => {
      const start = parseISO(s.start_time);
      const end = parseISO(s.end_time);
      const formatHour = (d: Date) => {
        const h = d.getHours() % 12 || 12;
        const p = d.getHours() >= 12 ? "P" : "A";
        return `${h}${p}`;
      };
      const endH = end.getHours();
      const isClose = endH === 0 || endH >= 23;
      return `${formatHour(start)}-${isClose ? "CL" : formatHour(end)}`;
    }).join(", ");
  };

  const handleExport = () => {
    generateSchedulePDF({
      shifts,
      employees,
      weekStart,
      weekEnd,
      restaurantName,
      includePositions,
      includeHoursSummary,
      positionFilter,
      selectedEmployeeIds,
    });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Printer className="h-5 w-5 text-primary" />
            Print Schedule
          </DialogTitle>
          <DialogDescription>
            Export a kitchen-friendly schedule for display or manager reference.
          </DialogDescription>
        </DialogHeader>

        {/* Preview */}
        <div className="border rounded-lg p-4 bg-muted/30">
          <div className="text-center mb-3">
            <div className="font-bold text-sm">{restaurantName.toUpperCase()}</div>
            <div className="text-xs text-muted-foreground">
              Week of {format(weekStart, "MMM d")} - {format(weekEnd, "MMM d, yyyy")}
            </div>
            {positionFilter && positionFilter !== "all" && (
              <div className="text-xs text-muted-foreground mt-1">
                Filtered: {positionFilter}
              </div>
            )}
          </div>

          {/* Mini preview table */}
          <div className="overflow-x-auto">
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left p-1.5 font-medium w-20"></th>
                  {weekDays.map(day => (
                    <th key={day.toISOString()} className="text-center p-1.5 font-medium">
                      <div>{format(day, "EEE")}</div>
                      <div className="text-muted-foreground font-normal">{format(day, "d")}</div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {previewEmployees.map(emp => (
                  <tr key={emp.id} className="border-b border-border/50">
                    <td className="p-1.5">
                      <div className="font-medium truncate max-w-[80px]">{emp.name.split(" ")[0]}</div>
                      {includePositions && (
                        <div className="text-muted-foreground text-[10px] truncate">{emp.position}</div>
                      )}
                    </td>
                    {weekDays.map(day => {
                      const display = getShiftDisplay(emp.id, day);
                      const isOff = display === "OFF";
                      return (
                        <td
                          key={day.toISOString()}
                          className={`text-center p-1.5 ${isOff ? "text-muted-foreground italic" : "font-medium"}`}
                        >
                          {display}
                        </td>
                      );
                    })}
                  </tr>
                ))}
                {selectedCount === 0 && (
                  <tr>
                    <td colSpan={8} className="text-center p-4 text-muted-foreground italic">
                      No employees selected
                    </td>
                  </tr>
                )}
                {selectedCount > 4 && (
                  <tr>
                    <td colSpan={8} className="text-center p-2 text-muted-foreground italic">
                      ... and {selectedCount - 4} more employees
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-between mt-3 pt-2 border-t border-border text-xs text-muted-foreground">
            <span>Generated {format(new Date(), "MMM d, yyyy")}</span>
            <span>{selectedCount} staff scheduled</span>
          </div>
        </div>

        {/* Employee Selection */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <span className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider">
              Select Employees
            </span>
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-[12px]"
                onClick={selectAll}
                disabled={selectedCount === totalAvailable}
                aria-label="Select all employees"
              >
                Select All
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-[12px]"
                onClick={deselectAll}
                disabled={selectedCount === 0}
                aria-label="Deselect all employees"
              >
                Deselect All
              </Button>
              <span className="text-[11px] px-1.5 py-0.5 rounded-md bg-muted text-muted-foreground">
                {selectedCount} of {totalAvailable}
              </span>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-1.5 max-h-[160px] overflow-y-auto rounded-lg border border-border/40 p-2">
            {allEmployeesWithShifts.map(emp => (
              <div key={emp.id} className="flex items-center space-x-2 py-1 px-1 rounded hover:bg-muted/50">
                <Checkbox
                  id={`emp-${emp.id}`}
                  checked={selectedEmployeeIds.has(emp.id)}
                  onCheckedChange={() => toggleEmployee(emp.id)}
                  aria-label={`Include ${emp.name}`}
                />
                <Label
                  htmlFor={`emp-${emp.id}`}
                  className="text-[13px] cursor-pointer truncate"
                >
                  {emp.name}
                </Label>
              </div>
            ))}
          </div>
        </div>

        {/* Options */}
        <div className="space-y-3">
          <div className="flex items-center space-x-2">
            <Checkbox
              id="include-positions"
              checked={includePositions}
              onCheckedChange={(checked) => setIncludePositions(checked === true)}
            />
            <Label htmlFor="include-positions" className="text-sm cursor-pointer">
              Include position labels
            </Label>
          </div>
          <div className="flex items-center space-x-2">
            <Checkbox
              id="include-hours"
              checked={includeHoursSummary}
              onCheckedChange={(checked) => setIncludeHoursSummary(checked === true)}
            />
            <Label htmlFor="include-hours" className="text-sm cursor-pointer">
              Include hours summary per employee
            </Label>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleExport} className="gap-2" disabled={selectedCount === 0}>
            <FileDown className="h-4 w-4" />
            Download PDF
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
