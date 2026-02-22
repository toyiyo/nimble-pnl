import type { Shift } from '@/types/scheduling';
import type { ParsedShift } from '@/utils/slingCsvParser';

export interface PreviewShift extends ParsedShift {
  employeeId: string | null;
  status: 'ready' | 'duplicate' | 'published' | 'skipped';
  existingShiftId?: string;
}

export interface ShiftImportPreviewResult {
  shifts: PreviewShift[];
  summary: {
    totalShifts: number;
    totalHours: number;
    readyCount: number;
    duplicateCount: number;
    publishedCount: number;
    skippedCount: number;
    newEmployeesCount: number;
  };
}

function getWeekMonday(dateStr: string): string {
  const date = new Date(dateStr);
  const day = date.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  const monday = new Date(date);
  monday.setDate(monday.getDate() + diff);
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${monday.getFullYear()}-${pad(monday.getMonth() + 1)}-${pad(monday.getDate())}`;
}

function shiftsOverlap(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
  return aStart < bEnd && bStart < aEnd;
}

function hoursBetween(start: string, end: string): number {
  const ms = new Date(end).getTime() - new Date(start).getTime();
  return Math.max(0, ms / (1000 * 60 * 60));
}

export function buildShiftImportPreview({
  parsedShifts,
  employeeMap,
  existingShifts,
  publishedWeeks,
  newEmployeesCount = 0,
}: {
  parsedShifts: ParsedShift[];
  employeeMap: Record<string, string>;
  existingShifts: Shift[];
  publishedWeeks: string[];
  newEmployeesCount?: number;
}): ShiftImportPreviewResult {
  const publishedSet = new Set(publishedWeeks);
  let readyCount = 0;
  let duplicateCount = 0;
  let publishedCount = 0;
  let skippedCount = 0;
  let totalHours = 0;

  const shifts: PreviewShift[] = parsedShifts.map(parsed => {
    const employeeId = employeeMap[parsed.employeeName] || null;

    // Guard against zero or negative duration shifts (start >= end)
    if (parsed.startTime >= parsed.endTime) {
      skippedCount++;
      return { ...parsed, employeeId, status: 'skipped' as const };
    }

    if (!employeeId) {
      skippedCount++;
      return { ...parsed, employeeId, status: 'skipped' as const };
    }

    const weekMonday = getWeekMonday(parsed.startTime);
    if (publishedSet.has(weekMonday)) {
      publishedCount++;
      return { ...parsed, employeeId, status: 'published' as const };
    }

    const existingForEmployee = existingShifts.filter(s => s.employee_id === employeeId);
    const overlapping = existingForEmployee.find(existing =>
      shiftsOverlap(parsed.startTime, parsed.endTime, existing.start_time, existing.end_time)
    );

    if (overlapping) {
      duplicateCount++;
      return { ...parsed, employeeId, status: 'duplicate' as const, existingShiftId: overlapping.id };
    }

    readyCount++;
    totalHours += hoursBetween(parsed.startTime, parsed.endTime);
    return { ...parsed, employeeId, status: 'ready' as const };
  });

  return {
    shifts,
    summary: {
      totalShifts: parsedShifts.length,
      totalHours: Math.round(totalHours * 10) / 10,
      readyCount,
      duplicateCount,
      publishedCount,
      skippedCount,
      newEmployeesCount,
    },
  };
}
