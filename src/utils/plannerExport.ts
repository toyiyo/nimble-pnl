import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

import { templateAppliesToDay } from '@/hooks/useShiftTemplates';
import { formatLocalDate } from '@/lib/shiftInterval';
import { UNASSIGNED } from '@/lib/templateAreaGrouping';
import { findAreaAwareTemplate } from '@/lib/templateAreaMatch';
import { exportToCSV } from '@/utils/csvExport';

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

export interface GridRow {
  /** e.g. "Morning Server (9AM–5PM)" */
  shiftLabel: string;
  /** One entry per weekDay: employee names joined by "\n", "—" for inactive, "" for empty */
  cells: string[];
}

export interface GridExportData {
  dayHeaders: string[];
  rows: GridRow[];
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
 * Format a template time string (HH:MM:SS) to compact 12-hour.
 * Examples: "09:00:00" → "9AM", "17:30:00" → "5:30PM"
 */
export function formatTemplateTime(time: string): string {
  const [h, m] = time.split(':').map(Number);
  const period = h >= 12 ? 'PM' : 'AM';
  const hour12 = h % 12 || 12;
  if (m === 0) return `${hour12}${period}`;
  return `${hour12}:${String(m).padStart(2, '0')}${period}`;
}

/**
 * Find the template that matches a shift by comparing local times, position,
 * the day-of-week, and area compatibility. A template with an area only matches
 * an employee from the same area (or with no area); an exact same-area match is
 * preferred over an area-agnostic (null-area) template. Mirrors
 * `findMatchingTemplate` in useShiftPlanner.ts (via the shared
 * `templateAreaMatch` helpers) so the exported grid buckets shifts the same way
 * the on-screen planner does — a cross-area unlinked shift never borrows another
 * area's row.
 */
export function findTemplateForShift(
  shift: Shift,
  templates: ShiftTemplate[],
): ShiftTemplate | undefined {
  const startDate = new Date(shift.start_time);
  const pad = (n: number) => n.toString().padStart(2, '0');
  const shiftStart = `${pad(startDate.getHours())}:${pad(startDate.getMinutes())}:${pad(startDate.getSeconds())}`;
  const endDate = new Date(shift.end_time);
  const shiftEnd = `${pad(endDate.getHours())}:${pad(endDate.getMinutes())}:${pad(endDate.getSeconds())}`;
  const dayOfWeek = startDate.getDay();

  return findAreaAwareTemplate(templates, {
    shiftStart,
    shiftEnd,
    position: shift.position,
    dayOfWeek,
    employeeArea: shift.employee?.area ?? null,
  });
}

/**
 * Build grid-oriented export data mirroring the planner view:
 * one row per template, one column per day, cells contain employee names.
 */
export function buildGridExportData(
  shifts: Shift[],
  templates: ShiftTemplate[],
  weekDays: string[],
): GridExportData {
  const weekDaySet = new Set(weekDays);

  // Day headers: "Mon 3/2", "Tue 3/3", etc.
  const dayHeaders = weekDays.map((d) => {
    const date = new Date(d + 'T12:00:00');
    const name = getDayName(d);
    return `${name} ${date.getMonth() + 1}/${date.getDate()}`;
  });

  // Index non-cancelled shifts by templateId → day → employee names. Shifts
  // that don't resolve to a template go to an off-template bucket keyed by the
  // employee's home area, mirroring the grid's off-template lane so exports
  // never silently omit coverage.
  const shiftsByTemplate = new Map<string, Map<string, string[]>>();
  const offTemplateByArea = new Map<string, Map<string, string[]>>();
  const templateById = new Map(templates.map((t) => [t.id, t]));

  const pushName = (byDay: Map<string, string[]>, dateStr: string, name: string) => {
    const names = byDay.get(dateStr) ?? [];
    if (names.length === 0) byDay.set(dateStr, names);
    names.push(name);
  };

  for (const shift of shifts) {
    if (shift.status === 'cancelled') continue;
    const dateStr = formatLocalDate(new Date(shift.start_time));
    if (!weekDaySet.has(dateStr)) continue;

    // Prefer an explicit template link (set during planner assignment) exactly
    // like buildTemplateGridData: an assigned shift — including a deliberate
    // cross-area cover — stays under its linked template. Fall back to
    // area-aware time matching only for unlinked shifts. A link to an archived
    // template (not in the list) is treated as off-template, never re-matched
    // by time.
    const template = shift.shift_template_id
      ? templateById.get(shift.shift_template_id)
      : findTemplateForShift(shift, templates);
    const employeeName = shift.employee?.name || 'Unassigned';

    if (template) {
      const dayMap = shiftsByTemplate.get(template.id) ?? new Map<string, string[]>();
      shiftsByTemplate.set(template.id, dayMap);
      pushName(dayMap, dateStr, employeeName);
    } else {
      const area = shift.employee?.area || UNASSIGNED;
      const dayMap = offTemplateByArea.get(area) ?? new Map<string, string[]>();
      offTemplateByArea.set(area, dayMap);
      pushName(dayMap, dateStr, employeeName);
    }
  }

  const sortNames = (names: string[]) => names.sort((a, b) => a.localeCompare(b)).join('\n');

  // Build rows in template order
  const rows: GridRow[] = templates.map((template) => {
    const shiftLabel = `${template.name} (${formatTemplateTime(template.start_time)}\u2013${formatTemplateTime(template.end_time)})`;
    const dayMap = shiftsByTemplate.get(template.id);

    const cells = weekDays.map((day) => {
      if (!templateAppliesToDay(template, day)) return '\u2014'; // em-dash for inactive
      const names = dayMap?.get(day);
      if (!names || names.length === 0) return '';
      return sortNames(names);
    });

    return { shiftLabel, cells };
  });

  // Append one off-template row per area (sorted by area name for determinism)
  // so unmatched shifts are preserved in the export instead of being dropped.
  for (const area of [...offTemplateByArea.keys()].sort((a, b) => a.localeCompare(b))) {
    const dayMap = offTemplateByArea.get(area)!;
    const cells = weekDays.map((day) => {
      const names = dayMap.get(day);
      return names && names.length > 0 ? sortNames(names) : '';
    });
    rows.push({ shiftLabel: `Off-template \u00b7 ${area}`, cells });
  }

  return { dayHeaders, rows };
}

// ---------------------------------------------------------------------------
// CSV generation (grid layout: Shift column + day columns)
// ---------------------------------------------------------------------------

/**
 * Generate a grid-layout CSV string for the planner view.
 * Header: Shift, Mon 3/2, Tue 3/3, ...
 * Rows: one per template, cells contain employee names separated by " / ".
 */
export function generatePlannerCSV(options: PlannerExportOptions): string {
  const { dayHeaders, rows } = buildGridExportData(options.shifts, options.templates, options.weekDays);

  const header = ['Shift', ...dayHeaders].map(escapeCSVCell).join(',');
  const lines = [header];

  for (const row of rows) {
    const cellValues = row.cells.map((cell) =>
      escapeCSVCell(cell.replace(/\n/g, ' / ')),
    );
    lines.push([escapeCSVCell(row.shiftLabel), ...cellValues].join(','));
  }

  return lines.join('\n');
}

/**
 * Trigger a browser download of planner CSV data in grid layout.
 * Delegates to the shared exportToCSV utility for BOM support and SSR safety.
 */
export function downloadPlannerCSV(options: PlannerExportOptions, filename: string): void {
  const { dayHeaders, rows } = buildGridExportData(options.shifts, options.templates, options.weekDays);
  const headers = ['Shift', ...dayHeaders];
  const data = rows.map((row) => {
    const record: Record<string, string> = { Shift: row.shiftLabel };
    dayHeaders.forEach((dh, i) => {
      record[dh] = row.cells[i].replace(/\n/g, ' / ');
    });
    return record;
  });
  exportToCSV({ data, filename, headers });
}

// ---------------------------------------------------------------------------
// PDF generation
// ---------------------------------------------------------------------------

/**
 * Format a week range string.
 * 'long' → "March 2 – March 8, 2026"  (PDF subtitle)
 * 'short' → "Mar 2 – Mar 8"           (dialog subtitle)
 */
export function formatWeekRange(weekDays: string[], monthFormat: 'long' | 'short' = 'long'): string {
  if (weekDays.length === 0) return '';
  const first = new Date(weekDays[0] + 'T12:00:00');
  const last = new Date(weekDays[weekDays.length - 1] + 'T12:00:00');

  const startStr = first.toLocaleDateString('en-US', { month: monthFormat, day: 'numeric' });
  const endOpts: Intl.DateTimeFormatOptions = { month: monthFormat, day: 'numeric' };
  if (monthFormat === 'long') endOpts.year = 'numeric';
  const endStr = last.toLocaleDateString('en-US', endOpts);
  return `${startStr} \u2013 ${endStr}`;
}

/**
 * Generate a landscape PDF mirroring the planner grid view.
 * Columns: Shift | Mon | Tue | Wed | Thu | Fri | Sat | Sun
 * Rows: one per template, cells contain employee names.
 */
export function generatePlannerPDF(options: PlannerExportOptions): void {
  const {
    shifts,
    templates,
    weekDays,
    restaurantName = 'Restaurant',
  } = options;

  const { dayHeaders, rows } = buildGridExportData(shifts, templates, weekDays);

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

  // Grid table: Shift column + day columns
  const tableHeaders = ['Shift', ...dayHeaders];
  const tableBody = rows.map((row) => [row.shiftLabel, ...row.cells]);

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
      valign: 'top',
    },
    headStyles: {
      fillColor: [240, 240, 240],
      textColor: [0, 0, 0],
      fontSize: 9,
      fontStyle: 'bold',
      halign: 'center',
    },
    columnStyles: {
      0: { fontStyle: 'bold', cellWidth: 140 },
    },
    margin: { left: margin, right: margin },
  });

  // Footer
  const pageHeight = doc.internal.pageSize.getHeight();
  type JsPdfWithAutoTable = jsPDF & { lastAutoTable?: { finalY?: number } };
  const finalY = (doc as JsPdfWithAutoTable).lastAutoTable?.finalY ?? pageHeight - 60;

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

  const shiftCount = shifts.filter((s) => s.status !== 'cancelled').length;
  doc.text(
    `${shiftCount} shift${shiftCount !== 1 ? 's' : ''}`,
    pageWidth - margin,
    Math.min(finalY + 30, pageHeight - 30),
    { align: 'right' },
  );

  const startDate = weekDays[0] || 'unknown';
  const endDate = weekDays[weekDays.length - 1] || 'unknown';
  doc.save(`planner_${startDate}_to_${endDate}.pdf`);
}
