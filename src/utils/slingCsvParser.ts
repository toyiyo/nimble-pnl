export interface ParsedShift {
  employeeName: string;
  startTime: string;  // Local ISO without timezone: 2026-02-28T10:00:00.000
  endTime: string;
  position: string;
  location?: string;
  breakDuration?: number;
  notes?: string;
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const SECTION_HEADERS = new Set(['unassigned shifts', 'available shifts', 'scheduled shifts']);

// Regex to extract: "10:00 AM - 11:00 PM • 13h" line followed by "Server • San Antonio" line
const SHIFT_BLOCK_PATTERN = /(\d{1,2}:\d{2} [AP]M) - (\d{1,2}:\d{2} [AP]M) • \d+h(?: \d+min)?\n([^•\n]+?)• ([^\n]+)/g;

export function isSlingFormat(headers: string[], rows: Record<string, string>[]): boolean {
  const dateColumns = headers.slice(1).filter(h => DATE_PATTERN.test(h.trim()));
  if (dateColumns.length < 3) return false;
  return rows.some(row =>
    Object.values(row).some(cell =>
      typeof cell === 'string' && /\d{1,2}:\d{2}\s*[AP]M\s*-\s*\d{1,2}:\d{2}\s*[AP]M/.test(cell)
    )
  );
}

function parseTime12h(timeStr: string): { hours: number; minutes: number } {
  const match = /^(\d{1,2}):(\d{2})\s*(AM|PM)$/i.exec(timeStr.trim());
  if (!match) return { hours: 0, minutes: 0 };
  let hours = Number.parseInt(match[1], 10);
  const minutes = Number.parseInt(match[2], 10);
  const period = match[3].toUpperCase();
  if (period === 'PM' && hours !== 12) hours += 12;
  if (period === 'AM' && hours === 12) hours = 0;
  return { hours, minutes };
}

function buildLocalISO(dateStr: string, hours: number, minutes: number): string {
  const [year, month, day] = dateStr.split('-').map(Number);
  const d = new Date(year, month - 1, day, hours, minutes, 0, 0);
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:00.000`;
}

function addOneDay(dateStr: string): string {
  const [year, month, day] = dateStr.split('-').map(Number);
  const d = new Date(year, month - 1, day + 1);
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function parseSlingShiftCell(cell: string, dateStr: string): ParsedShift[] {
  if (!cell?.trim()) return [];

  const shifts: ParsedShift[] = [];
  let match: RegExpExecArray | null;
  const regex = new RegExp(SHIFT_BLOCK_PATTERN.source, 'g');

  while ((match = regex.exec(cell)) !== null) {
    const startTimeStr = match[1];
    const endTimeStr = match[2];
    const position = match[3].trim();
    const location = match[4].trim();

    const start = parseTime12h(startTimeStr);
    const end = parseTime12h(endTimeStr);

    const startISO = buildLocalISO(dateStr, start.hours, start.minutes);

    let endDateStr = dateStr;
    if (end.hours < start.hours || (end.hours === start.hours && end.minutes < start.minutes)) {
      endDateStr = addOneDay(dateStr);
    }
    const endISO = buildLocalISO(endDateStr, end.hours, end.minutes);

    shifts.push({
      employeeName: '',
      startTime: startISO,
      endTime: endISO,
      position,
      location,
    });
  }

  return shifts;
}

export function parseSlingCSV(headers: string[], rows: Record<string, string>[]): ParsedShift[] {
  const dateColumns = headers.slice(1).filter(h => DATE_PATTERN.test(h.trim()));
  const nameColumn = headers[0];
  const allShifts: ParsedShift[] = [];

  for (const row of rows) {
    const name = row[nameColumn]?.trim();
    if (!name) continue;
    if (SECTION_HEADERS.has(name.toLowerCase())) continue;

    const hasShifts = dateColumns.some(dateCol => {
      const cell = row[dateCol];
      return cell && /\d{1,2}:\d{2}\s*[AP]M/.test(cell);
    });
    if (!hasShifts) continue;

    for (const dateCol of dateColumns) {
      const cell = row[dateCol];
      if (!cell) continue;

      const shifts = parseSlingShiftCell(cell, dateCol.trim());
      for (const shift of shifts) {
        shift.employeeName = name;
        allShifts.push(shift);
      }
    }
  }

  return allShifts;
}
