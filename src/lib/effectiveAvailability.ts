import { EmployeeAvailability, AvailabilityException } from '@/types/scheduling';

export interface EffectiveSlot {
  isAvailable: boolean;
  startTime: string | null;
  endTime: string | null;
  reason?: string;
  sourceRecord: EmployeeAvailability | AvailabilityException;
}

export interface EffectiveAvailability {
  type: 'recurring' | 'exception' | 'not-set';
  slots: EffectiveSlot[];
}

function getWeekDates(weekStart: Date): Map<string, number> {
  const dates = new Map<string, number>();
  for (let i = 0; i < 7; i++) {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + i);
    const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    dates.set(dateStr, d.getDay());
  }
  return dates;
}

export function computeEffectiveAvailability(
  availability: EmployeeAvailability[],
  exceptions: AvailabilityException[],
  weekStart: Date,
  employeeIds: string[],
): Map<string, Map<number, EffectiveAvailability>> {
  const weekDates = getWeekDates(weekStart);
  const result = new Map<string, Map<number, EffectiveAvailability>>();

  // Index exceptions by "empId:dateStr" — only those within the displayed week
  const exceptionsByEmpDate = new Map<string, AvailabilityException[]>();
  for (const exc of exceptions) {
    if (!weekDates.has(exc.date)) continue;
    const key = `${exc.employee_id}:${exc.date}`;
    const existing = exceptionsByEmpDate.get(key) ?? [];
    existing.push(exc);
    exceptionsByEmpDate.set(key, existing);
  }

  // Index recurring availability by "empId:dayOfWeek"
  const recurringByEmpDay = new Map<string, EmployeeAvailability[]>();
  for (const avail of availability) {
    const key = `${avail.employee_id}:${avail.day_of_week}`;
    const existing = recurringByEmpDay.get(key) ?? [];
    existing.push(avail);
    recurringByEmpDay.set(key, existing);
  }

  // Build reverse map: day_of_week → dateStr (only one date per DOW in a week)
  const dowToDate = new Map<number, string>();
  for (const [dateStr, dow] of weekDates) {
    dowToDate.set(dow, dateStr);
  }

  for (const empId of employeeIds) {
    const empMap = new Map<number, EffectiveAvailability>();

    for (let dow = 0; dow < 7; dow++) {
      const dateStr = dowToDate.get(dow);

      // Check exceptions first (they override recurring)
      if (dateStr) {
        const excKey = `${empId}:${dateStr}`;
        const dayExceptions = exceptionsByEmpDate.get(excKey);
        if (dayExceptions && dayExceptions.length > 0) {
          empMap.set(dow, {
            type: 'exception',
            slots: dayExceptions.map((exc) => ({
              isAvailable: exc.is_available,
              startTime: exc.start_time ?? null,
              endTime: exc.end_time ?? null,
              reason: exc.reason || undefined,
              sourceRecord: exc,
            })),
          });
          continue;
        }
      }

      // Fall back to recurring availability
      const recurKey = `${empId}:${dow}`;
      const recurring = recurringByEmpDay.get(recurKey);
      if (recurring && recurring.length > 0) {
        empMap.set(dow, {
          type: 'recurring',
          slots: recurring.map((avail) => ({
            isAvailable: avail.is_available,
            startTime: avail.start_time,
            endTime: avail.end_time,
            sourceRecord: avail,
          })),
        });
        continue;
      }

      // No data for this day
      empMap.set(dow, { type: 'not-set', slots: [] });
    }

    result.set(empId, empMap);
  }

  return result;
}
