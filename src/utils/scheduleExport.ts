import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { format, eachDayOfInterval, isSameDay, parseISO } from "date-fns";
import type { Shift, Employee } from "@/types/scheduling";

export interface ScheduleExportOptions {
  shifts: Shift[];
  employees: Employee[];
  weekStart: Date;
  weekEnd: Date;
  restaurantName?: string;
  includePositions?: boolean;
  includeHoursSummary?: boolean;
  positionFilter?: string;
}

/**
 * Formats time in kitchen-friendly compact format
 * Examples: "6A-2P", "4P-CL", "11A-7P"
 */
const formatKitchenTime = (startTime: string, endTime: string): string => {
  const start = parseISO(startTime);
  const end = parseISO(endTime);
  
  const formatHour = (date: Date): string => {
    const hours = date.getHours();
    const minutes = date.getMinutes();
    const period = hours >= 12 ? "P" : "A";
    const displayHour = hours % 12 || 12;
    
    if (minutes === 0) {
      return `${displayHour}${period}`;
    }
    return `${displayHour}:${minutes.toString().padStart(2, "0")}${period}`;
  };
  
  // Check if end time is midnight or later (close)
  const endHours = end.getHours();
  const isClose = endHours === 0 || (endHours >= 23 && end.getMinutes() >= 30);
  
  const startStr = formatHour(start);
  const endStr = isClose ? "CL" : formatHour(end);
  
  return `${startStr}-${endStr}`;
};

/**
 * Calculate shift hours (excluding break)
 */
const calculateShiftHours = (shift: Shift): number => {
  const start = new Date(shift.start_time);
  const end = new Date(shift.end_time);
  const totalMinutes = (end.getTime() - start.getTime()) / (1000 * 60);
  const netMinutes = Math.max(totalMinutes - shift.break_duration, 0);
  return netMinutes / 60;
};

/**
 * Generates a print-optimized PDF of the weekly schedule
 */
export const generateSchedulePDF = (options: ScheduleExportOptions): void => {
  const {
    shifts,
    employees,
    weekStart,
    weekEnd,
    restaurantName = "Restaurant",
    includePositions = true,
    includeHoursSummary = false,
    positionFilter,
  } = options;

  // Get days of the week
  const weekDays = eachDayOfInterval({ start: weekStart, end: weekEnd });

  // Filter shifts by position if needed
  const filteredShifts = positionFilter && positionFilter !== "all"
    ? shifts.filter(s => {
        const emp = employees.find(e => e.id === s.employee_id);
        return emp?.position === positionFilter;
      })
    : shifts;

  // Get employees with shifts this week
  const shiftEmployeeIds = new Set(filteredShifts.map(s => s.employee_id));
  const employeesWithShifts = employees
    .filter(emp => shiftEmployeeIds.has(emp.id))
    .sort((a, b) => a.name.localeCompare(b.name));

  // Create PDF in landscape orientation
  const doc = new jsPDF({
    orientation: "landscape",
    unit: "pt",
    format: "letter",
  });

  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 40;

  // Header
  doc.setFontSize(18);
  doc.setFont("helvetica", "bold");
  doc.text(restaurantName.toUpperCase(), pageWidth / 2, margin, { align: "center" });

  // Week range subtitle
  doc.setFontSize(12);
  doc.setFont("helvetica", "normal");
  const weekRange = `Week of ${format(weekStart, "MMMM d")} - ${format(weekEnd, "MMMM d, yyyy")}`;
  doc.text(weekRange, pageWidth / 2, margin + 20, { align: "center" });

  // Position filter indicator
  if (positionFilter && positionFilter !== "all") {
    doc.setFontSize(10);
    doc.setTextColor(100);
    doc.text(`Filtered: ${positionFilter}`, pageWidth / 2, margin + 35, { align: "center" });
    doc.setTextColor(0);
  }

  // Build table data
  const tableHeaders = [
    { content: "", styles: { halign: "left" as const, fontStyle: "bold" as const } },
    ...weekDays.map(day => ({
      content: `${format(day, "EEE")}\n${format(day, "MMM d")}`,
      styles: { halign: "center" as const, fontStyle: "bold" as const },
    })),
  ];

  // Add hours column if requested
  if (includeHoursSummary) {
    tableHeaders.push({
      content: "Hours",
      styles: { halign: "center" as const, fontStyle: "bold" as const },
    });
  }

  const tableBody: any[][] = [];

  employeesWithShifts.forEach(employee => {
    const row: any[] = [];
    
    // Employee name (and position if enabled)
    const nameCell = includePositions
      ? `${employee.name}\n${employee.position}`
      : employee.name;
    row.push({
      content: nameCell,
      styles: { 
        halign: "left" as const, 
        fontStyle: "bold" as const,
        cellPadding: { top: 8, bottom: 8, left: 6, right: 6 },
      },
    });

    let totalHours = 0;

    // Add shift for each day
    weekDays.forEach(day => {
      const dayShifts = filteredShifts.filter(
        s => s.employee_id === employee.id && isSameDay(parseISO(s.start_time), day)
      );

      if (dayShifts.length === 0) {
        row.push({
          content: "OFF",
          styles: { 
            halign: "center" as const, 
            textColor: [150, 150, 150],
            fontStyle: "italic" as const,
          },
        });
      } else {
        const shiftTexts = dayShifts.map(s => formatKitchenTime(s.start_time, s.end_time));
        const hours = dayShifts.reduce((sum, s) => sum + calculateShiftHours(s), 0);
        totalHours += hours;
        
        row.push({
          content: shiftTexts.join("\n"),
          styles: { halign: "center" as const, fontStyle: "bold" as const },
        });
      }
    });

    // Add hours total if requested
    if (includeHoursSummary) {
      row.push({
        content: totalHours > 0 ? totalHours.toFixed(1) : "-",
        styles: { halign: "center" as const },
      });
    }

    tableBody.push(row);
  });

  // Generate table
  autoTable(doc, {
    startY: positionFilter && positionFilter !== "all" ? margin + 50 : margin + 40,
    head: [tableHeaders],
    body: tableBody,
    theme: "grid",
    styles: {
      fontSize: 10,
      cellPadding: 6,
      lineColor: [200, 200, 200],
      lineWidth: 0.5,
    },
    headStyles: {
      fillColor: [240, 240, 240],
      textColor: [0, 0, 0],
      fontSize: 9,
    },
    columnStyles: {
      0: { cellWidth: 100 }, // Employee column
    },
    margin: { left: margin, right: margin },
  });

  // Footer with summary
  const finalY = (doc as any).lastAutoTable?.finalY || pageHeight - 60;
  
  // Summary line
  const totalStaff = employeesWithShifts.length;
  const totalHours = filteredShifts.reduce((sum, s) => sum + calculateShiftHours(s), 0);
  const summaryText = `Total: ${totalHours.toFixed(1)} hrs | ${totalStaff} staff`;
  
  doc.setFontSize(9);
  doc.setTextColor(100);
  doc.text(
    `Generated ${format(new Date(), "MMM d, yyyy 'at' h:mm a")}`,
    margin,
    Math.min(finalY + 30, pageHeight - 30)
  );
  doc.text(
    summaryText,
    pageWidth - margin,
    Math.min(finalY + 30, pageHeight - 30),
    { align: "right" }
  );

  // Save the PDF
  const fileName = `schedule_${format(weekStart, "yyyy-MM-dd")}_to_${format(weekEnd, "yyyy-MM-dd")}.pdf`;
  doc.save(fileName);
};

/**
 * Generates a standardized filename for schedule exports
 */
export const generateScheduleFilename = (weekStart: Date, weekEnd: Date, suffix?: string): string => {
  const startStr = format(weekStart, "yyyy-MM-dd");
  const endStr = format(weekEnd, "yyyy-MM-dd");
  const suffixPart = suffix ? `_${suffix}` : "";
  return `schedule_${startStr}_to_${endStr}${suffixPart}`;
};
