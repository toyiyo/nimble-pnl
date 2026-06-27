import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { format, eachDayOfInterval, isSameDay, parseISO } from "date-fns";
import type { Shift, Employee } from "@/types/scheduling";
import { groupEmployees, type GroupByMode } from "@/lib/scheduleGrouping";
import { calculateShiftHours, buildRoster, type RosterSortBy } from "@/lib/scheduleRoster";

// Re-exported for backward compatibility; canonical home is @/lib/scheduleRoster.
export { calculateShiftHours };

export interface ScheduleExportOptions {
  shifts: Shift[];
  employees: Employee[];
  weekStart: Date;
  weekEnd: Date;
  restaurantName?: string;
  includePositions?: boolean;
  includeHoursSummary?: boolean;
  positionFilter?: string;
  areaFilter?: string;
  groupBy?: GroupByMode;
  selectedEmployeeIds?: Set<string>;
}

/**
 * Formats time in kitchen-friendly compact format
 * Examples: "6A-2P", "4P-CL", "11A-7P"
 */
export const formatKitchenTime = (startTime: string, endTime: string): string => {
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
    areaFilter,
    groupBy = 'none',
    selectedEmployeeIds,
  } = options;

  // Get days of the week
  const weekDays = eachDayOfInterval({ start: weekStart, end: weekEnd });

  /** Returns the filter value when active, null when "all" or absent. */
  const active = (f?: string) => (f && f !== "all" ? f : null);
  const activePosition = active(positionFilter);
  const activeArea = active(areaFilter);

  // Filter shifts by position and/or area if needed (AND semantics)
  const filteredShifts = (activePosition || activeArea)
    ? shifts.filter(s => {
        const emp = employees.find(e => e.id === s.employee_id);
        if (!emp) return false;
        if (activePosition && emp.position !== activePosition) return false;
        if (activeArea && emp.area !== activeArea) return false;
        return true;
      })
    : shifts;

  // Get employees with shifts this week
  const shiftEmployeeIds = new Set(filteredShifts.map(s => s.employee_id));
  const employeesWithShifts = employees
    .filter(emp => shiftEmployeeIds.has(emp.id))
    .filter(emp => !selectedEmployeeIds || selectedEmployeeIds.has(emp.id))
    .sort((a, b) => a.name.localeCompare(b.name));

  // Group employees
  const groups = groupEmployees(employeesWithShifts, groupBy);

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

  // Filter/grouping indicators
  let subtitleY = margin + 35;
  const filterParts = [active(areaFilter), active(positionFilter)].filter(Boolean) as string[];
  if (filterParts.length > 0) {
    doc.setFontSize(10);
    doc.setTextColor(100);
    doc.text(`Filtered: ${filterParts.join(" · ")}`, pageWidth / 2, subtitleY, { align: "center" });
    subtitleY += 14;
  }
  if (groupBy !== 'none') {
    doc.setFontSize(10);
    doc.setTextColor(100);
    doc.text(`Grouped by: ${groupBy === 'area' ? 'Area' : 'Position'}`, pageWidth / 2, subtitleY, { align: "center" });
    subtitleY += 14;
  }
  doc.setTextColor(0);

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
  const colCount = weekDays.length + 1 + (includeHoursSummary ? 1 : 0);

  /** Build a single employee row for the PDF table. */
  const buildEmployeeRow = (employee: Employee): any[] => {
    const row: any[] = [];

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

    for (const day of weekDays) {
      const dayShifts = filteredShifts.filter(
        s => s.employee_id === employee.id && isSameDay(parseISO(s.start_time), day)
      );

      if (dayShifts.length === 0) {
        row.push({
          content: "OFF",
          styles: { halign: "center" as const, textColor: [150, 150, 150], fontStyle: "italic" as const },
        });
      } else {
        const shiftTexts = dayShifts.map(s => formatKitchenTime(s.start_time, s.end_time));
        totalHours += dayShifts.reduce((sum, s) => sum + calculateShiftHours(s), 0);
        row.push({
          content: shiftTexts.join("\n"),
          styles: { halign: "center" as const, fontStyle: "bold" as const },
        });
      }
    }

    if (includeHoursSummary) {
      row.push({
        content: totalHours > 0 ? totalHours.toFixed(1) : "-",
        styles: { halign: "center" as const },
      });
    }

    return row;
  };

  for (const group of groups) {
    if (groupBy !== 'none' && group.label) {
      tableBody.push([{
        content: `${group.label} (${group.employees.length})`,
        colSpan: colCount,
        styles: {
          halign: "left" as const,
          fontStyle: "bold" as const,
          fillColor: [230, 230, 230],
          textColor: [50, 50, 50],
          fontSize: 10,
          cellPadding: { top: 6, bottom: 6, left: 6, right: 6 },
        },
      }]);
    }

    for (const employee of group.employees) {
      tableBody.push(buildEmployeeRow(employee));
    }
  }

  // Generate table
  autoTable(doc, {
    startY: subtitleY > margin + 35 ? subtitleY + 5 : margin + 40,
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

export interface RosterExportOptions {
  shifts: Shift[];
  employees: Employee[];
  days: Date[];
  weekStart: Date;
  weekEnd: Date;
  restaurantName?: string;
  sortBy?: RosterSortBy;
  groupBy?: GroupByMode;
  areaFilter?: string;
  positionFilter?: string;
  selectedEmployeeIds?: Set<string>;
  includePositions?: boolean;
  includeHoursSummary?: boolean;
}

/**
 * Generates a per-day roster PDF: one table per day, each listing the day's
 * shifts sorted by start time / name / hours, with area (or position)
 * sub-sections. Portrait orientation (a narrow, tall list).
 */
export const generateRosterPDF = (options: RosterExportOptions): void => {
  const {
    shifts,
    employees,
    days,
    weekStart,
    weekEnd,
    restaurantName = "Restaurant",
    sortBy = "startTime",
    groupBy = "none",
    areaFilter,
    positionFilter,
    selectedEmployeeIds,
    includePositions = true,
    includeHoursSummary = false,
  } = options;

  const active = (f?: string) => (f && f !== "all" ? f : null);
  const activeArea = active(areaFilter);
  const activePosition = active(positionFilter);

  // Pre-filter by area / position / selected employees (same semantics as the grid).
  const filteredShifts = shifts.filter(s => {
    const emp = employees.find(e => e.id === s.employee_id);
    if (!emp) return false;
    if (activeArea && emp.area !== activeArea) return false;
    if (activePosition && emp.position !== activePosition) return false;
    if (selectedEmployeeIds && !selectedEmployeeIds.has(emp.id)) return false;
    return true;
  });

  const rosterDays = buildRoster(filteredShifts, employees, days, sortBy, groupBy);

  const doc = new jsPDF({ orientation: "portrait", unit: "pt", format: "letter" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 40;

  // Title + week range
  doc.setFontSize(18);
  doc.setFont("helvetica", "bold");
  doc.text(restaurantName.toUpperCase(), pageWidth / 2, margin, { align: "center" });
  doc.setFontSize(12);
  doc.setFont("helvetica", "normal");
  doc.text(
    `Week of ${format(weekStart, "MMMM d")} - ${format(weekEnd, "MMMM d, yyyy")}`,
    pageWidth / 2,
    margin + 20,
    { align: "center" },
  );

  // Subtitles: active filters + sort indicator
  let subtitleY = margin + 35;
  const filterParts = [activeArea, activePosition].filter(Boolean) as string[];
  if (filterParts.length > 0) {
    doc.setFontSize(10);
    doc.setTextColor(100);
    doc.text(`Filtered: ${filterParts.join(" · ")}`, pageWidth / 2, subtitleY, { align: "center" });
    subtitleY += 14;
  }
  const sortLabel = sortBy === "name" ? "Name" : sortBy === "hours" ? "Hours" : "Start time";
  doc.setFontSize(10);
  doc.setTextColor(100);
  doc.text(`Sorted by: ${sortLabel}`, pageWidth / 2, subtitleY, { align: "center" });
  subtitleY += 14;
  doc.setTextColor(0);

  // Columns
  const columns = ["Time", "Employee"];
  if (includePositions) columns.push("Position");
  if (includeHoursSummary) columns.push("Hours");
  const colCount = columns.length;

  let cursorY = subtitleY + 5;

  for (const rosterDay of rosterDays) {
    const dayHeader = `${format(rosterDay.day, "EEEE · MMM d")}${
      rosterDay.totalStaff > 0
        ? `      ${rosterDay.totalStaff} staff · ${rosterDay.totalHours.toFixed(1)} hrs`
        : ""
    }`;

    const body: any[][] = [];

    if (rosterDay.totalStaff === 0) {
      body.push([{
        content: "No one scheduled",
        colSpan: colCount,
        styles: { halign: "center" as const, textColor: [150, 150, 150], fontStyle: "italic" as const },
      }]);
    } else {
      for (const section of rosterDay.sections) {
        if (groupBy !== "none" && section.label) {
          body.push([{
            content: `${section.label} (${section.rows.length})`,
            colSpan: colCount,
            styles: {
              halign: "left" as const,
              fontStyle: "bold" as const,
              fillColor: [230, 230, 230],
              textColor: [50, 50, 50],
              fontSize: 10,
            },
          }]);
        }
        for (const row of section.rows) {
          const cells: any[] = [
            formatKitchenTime(row.shift.start_time, row.shift.end_time),
            row.employee.name,
          ];
          if (includePositions) cells.push(row.shift.position || row.employee.position || "");
          if (includeHoursSummary) cells.push(row.hours.toFixed(1));
          body.push(cells);
        }
      }
    }

    autoTable(doc, {
      startY: cursorY,
      head: [
        [{
          content: dayHeader,
          colSpan: colCount,
          styles: {
            halign: "left" as const,
            fontStyle: "bold" as const,
            fillColor: [220, 220, 220],
            textColor: [20, 20, 20],
            fontSize: 11,
          },
        }],
        columns.map(c => ({ content: c, styles: { fontStyle: "bold" as const } })),
      ],
      body,
      theme: "grid",
      styles: { fontSize: 10, cellPadding: 5, lineColor: [200, 200, 200], lineWidth: 0.5 },
      headStyles: { fillColor: [240, 240, 240], textColor: [0, 0, 0], fontSize: 9 },
      columnStyles: { 0: { cellWidth: 80 } },
      margin: { left: margin, right: margin },
    });

    cursorY = ((doc as any).lastAutoTable?.finalY ?? cursorY) + 18;
  }

  // Footer — placed just below the last table, clamped to the page (mirrors generateSchedulePDF)
  const footerY = (doc as any).lastAutoTable?.finalY ?? cursorY;
  doc.setFontSize(9);
  doc.setTextColor(100);
  doc.text(
    `Generated ${format(new Date(), "MMM d, yyyy 'at' h:mm a")}`,
    margin,
    Math.min(footerY + 18, pageHeight - 24),
  );

  const fileName =
    days.length === 1
      ? `roster_${format(days[0], "yyyy-MM-dd")}.pdf`
      : `roster_${format(weekStart, "yyyy-MM-dd")}_to_${format(weekEnd, "yyyy-MM-dd")}.pdf`;
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
