import { useState } from "react";
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
import { Printer, FileDown, Calendar } from "lucide-react";
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

  const weekDays = eachDayOfInterval({ start: weekStart, end: weekEnd });

  // Filter shifts for preview
  const filteredShifts = positionFilter && positionFilter !== "all"
    ? shifts.filter(s => {
        const emp = employees.find(e => e.id === s.employee_id);
        return emp?.position === positionFilter;
      })
    : shifts;

  const shiftEmployeeIds = new Set(filteredShifts.map(s => s.employee_id));
  const employeesWithShifts = employees
    .filter(emp => shiftEmployeeIds.has(emp.id))
    .sort((a, b) => a.name.localeCompare(b.name))
    .slice(0, 4); // Preview only shows first 4

  const getShiftDisplay = (employeeId: string, day: Date): string => {
    const dayShifts = filteredShifts.filter(
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
    });
    onOpenChange(false);
  };

  const totalStaff = new Set(filteredShifts.map(s => s.employee_id)).size;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
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
                {employeesWithShifts.map(emp => (
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
                {totalStaff > 4 && (
                  <tr>
                    <td colSpan={8} className="text-center p-2 text-muted-foreground italic">
                      ... and {totalStaff - 4} more employees
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-between mt-3 pt-2 border-t border-border text-xs text-muted-foreground">
            <span>Generated {format(new Date(), "MMM d, yyyy")}</span>
            <span>{totalStaff} staff scheduled</span>
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
          <Button onClick={handleExport} className="gap-2">
            <FileDown className="h-4 w-4" />
            Download PDF
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
