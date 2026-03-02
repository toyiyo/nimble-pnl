import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

import { formatLocalTime } from '@/hooks/useShiftPlanner';
import { templateAppliesToDay } from '@/hooks/useShiftTemplates';

import type { Shift, ShiftTemplate } from '@/types/scheduling';

// ---------------------------------------------------------------------------
// Public interface
// ---------------------------------------------------------------------------

export interface PlannerExportOptions {
  shifts: Shift[];
  templates: ShiftTemplate[];
  weekDays: string[];
  restaurantName?: string;
}

export interface ExportRow {
  employee: string;
  shift: string;
  day: string;
  date: string;
  start: string;
  end: string;
  position: string;
  break: string;
}

// ---------------------------------------------------------------------------
// Pure helpers (exported for testing)
// ---------------------------------------------------------------------------

/**
 * Convert an ISO timestamp string to compact 12-hour format.
 * Examples: "9AM", "5PM", "9:30AM", "12PM", "12AM"
 */
export function formatTime12(isoStr: string): string {
  const d = new Date(isoStr);
  const hours = d.getHours();
  const minutes = d.getMinutes();
  const period = hours >= 12 ? 'PM' : 'AM';
  const displayHour = hours % 12 || 12;

  if (minutes === 0) {
    return `${displayHour}${period}`;
  }
  return `${displayHour}:${minutes.toString().padStart(2, '0')}${period}`;
}

/**
 * Convert a YYYY-MM-DD date string to short day name ("Mon", "Tue", etc.).
 * Uses noon anchor to avoid timezone edge-case issues.
 */
export function getDayName(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00');
  return d.toLocaleDateString('en-US', { weekday: 'short' });
}

/**
 * Escape a CSV cell per RFC 4180.
 * Cells containing commas, double quotes, or newlines are wrapped in double quotes.
 * Inner double quotes are doubled.
 */
export function escapeCSVCell(value: string): string {
  if (!value) return value;
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/**
 * Find the first template that matches a shift by comparing local times,
 * position, and the day-of-week.
 */
export function findTemplateForShift(
  shift: Shift,
  templates: ShiftTemplate[],
): ShiftTemplate | undefined {
  const shiftStart = formatLocalTime(shift.start_time);
  const shiftEnd = formatLocalTime(shift.end_time);
  const dayOfWeek = new Date(shift.start_time).getDay();

  return templates.find(
    (t) =>
      t.start_time === shiftStart &&
      t.end_time === shiftEnd &&
      t.position === shift.position &&
      t.days.includes(dayOfWeek),
  );
}

/**
 * Build export rows from shifts, sorted by date then employee name.
 * Cancelled shifts are excluded.
 */
export function buildExportRows(
  shifts: Shift[],
  templates: ShiftTemplate[],
  weekDays: string[],
): ExportRow[] {
  const weekDaySet = new Set(weekDays);

  const rows: ExportRow[] = [];

  for (const shift of shifts) {
    if (shift.status === 'cancelled') continue;

    const startDate = new Date(shift.start_time);
    const y = startDate.getFullYear();
    const m = String(startDate.getMonth() + 1).padStart(2, '0');
    const day = String(startDate.getDate()).padStart(2, '0');
    const dateStr = `${y}-${m}-${day}`;

    if (!weekDaySet.has(dateStr)) continue;

    const template = findTemplateForShift(shift, templates);

    rows.push({
      employee: shift.employee?.name || 'Unassigned',
      shift: template?.name || '\u2014', // em-dash for unmatched
      day: getDayName(dateStr),
      date: dateStr,
      start: formatTime12(shift.start_time),
      end: formatTime12(shift.end_time),
      position: shift.position,
      break: `${shift.break_duration} min`,
    });
  }

  // Sort by date, then by employee name
  rows.sort((a, b) => {
    const dateCmp = a.date.localeCompare(b.date);
    if (dateCmp !== 0) return dateCmp;
    return a.employee.localeCompare(b.employee);
  });

  return rows;
}

// ---------------------------------------------------------------------------
// CSV generation
// ---------------------------------------------------------------------------

const CSV_HEADER = 'Employee,Shift,Day,Date,Start,End,Position,Break';

/**
 * Generate a CSV string for the planner view.
 * Header: Employee,Shift,Day,Date,Start,End,Position,Break
 */
export function generatePlannerCSV(options: PlannerExportOptions): string {
  const rows = buildExportRows(options.shifts, options.templates, options.weekDays);

  const lines = [CSV_HEADER];
  for (const row of rows) {
    lines.push(
      [
        escapeCSVCell(row.employee),
        escapeCSVCell(row.shift),
        escapeCSVCell(row.day),
        escapeCSVCell(row.date),
        escapeCSVCell(row.start),
        escapeCSVCell(row.end),
        escapeCSVCell(row.position),
        escapeCSVCell(row.break),
      ].join(','),
    );
  }

  return lines.join('\n');
}

/**
 * Trigger a browser download of a CSV file.
 */
export function downloadCSV(csv: string, filename: string): void {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

// ---------------------------------------------------------------------------
// PDF generation
// ---------------------------------------------------------------------------

/**
 * Format a week range string like "March 2 - March 8, 2026".
 */
function formatWeekRange(weekDays: string[]): string {
  if (weekDays.length === 0) return '';
  const first = new Date(weekDays[0] + 'T12:00:00');
  const last = new Date(weekDays[weekDays.length - 1] + 'T12:00:00');

  const startStr = first.toLocaleDateString('en-US', { month: 'long', day: 'numeric' });
  const endStr = last.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  return `${startStr} \u2013 ${endStr}`;
}

/**
 * Generate a landscape PDF of the planner view and trigger download.
 * Uses jsPDF + jspdf-autotable.
 */
export function generatePlannerPDF(options: PlannerExportOptions): void {
  const {
    shifts,
    templates,
    weekDays,
    restaurantName = 'Restaurant',
  } = options;

  const rows = buildExportRows(shifts, templates, weekDays);

  // Create PDF in landscape orientation
  const doc = new jsPDF({
    orientation: 'landscape',
    unit: 'pt',
    format: 'letter',
  });

  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 40;

  // Header: restaurant name
  doc.setFontSize(18);
  doc.setFont('helvetica', 'bold');
  doc.text(restaurantName.toUpperCase(), pageWidth / 2, margin, { align: 'center' });

  // Subtitle: week range
  doc.setFontSize(12);
  doc.setFont('helvetica', 'normal');
  const weekRange = `Week of ${formatWeekRange(weekDays)}`;
  doc.text(weekRange, pageWidth / 2, margin + 20, { align: 'center' });

  // Build table data
  const tableHeaders = [
    'Employee',
    'Shift',
    'Day',
    'Date',
    'Start',
    'End',
    'Position',
    'Break',
  ];

  const tableBody = rows.map((row) => [
    row.employee,
    row.shift,
    row.day,
    row.date,
    row.start,
    row.end,
    row.position,
    row.break,
  ]);

  // Generate table
  autoTable(doc, {
    startY: margin + 40,
    head: [tableHeaders],
    body: tableBody,
    theme: 'grid',
    styles: {
      fontSize: 9,
      cellPadding: 5,
      lineColor: [200, 200, 200],
      lineWidth: 0.5,
    },
    headStyles: {
      fillColor: [240, 240, 240],
      textColor: [0, 0, 0],
      fontSize: 9,
      fontStyle: 'bold',
    },
    margin: { left: margin, right: margin },
  });

  // Footer
  const pageHeight = doc.internal.pageSize.getHeight();
  const finalY = (doc as any).lastAutoTable?.finalY || pageHeight - 60;

  doc.setFontSize(9);
  doc.setTextColor(100);
  const now = new Date();
  const generatedStr = now.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
  doc.text(
    `Generated ${generatedStr}`,
    margin,
    Math.min(finalY + 30, pageHeight - 30),
  );

  const summaryText = `${rows.length} shifts`;
  doc.text(
    summaryText,
    pageWidth - margin,
    Math.min(finalY + 30, pageHeight - 30),
    { align: 'right' },
  );

  // Save
  const startDate = weekDays[0] || 'unknown';
  const endDate = weekDays[weekDays.length - 1] || 'unknown';
  const fileName = `planner_${startDate}_to_${endDate}.pdf`;
  doc.save(fileName);
}
