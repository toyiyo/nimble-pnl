import type { EmployeePayroll, PayrollPeriod } from '@/utils/payrollCalculations';

/**
 * Gusto timesheet-import column headers, in the exact order Gusto expects.
 * Pinned by test — do not reorder or rename without a matching Gusto template.
 */
export const GUSTO_CSV_HEADERS = [
  'last_name',
  'first_name',
  'title',
  'gusto_employee_id',
  'regular_hours',
  'overtime_hours',
  'double_overtime_hours',
  'missed_break_hours',
  'owners_draw',
  'bonus',
  'commission',
  'paycheck_tips',
  'cash_tips',
  'correction_payment',
  'reimbursement',
  'personal_note',
] as const;

/**
 * Split our single `employeeName` ("First Last") into Gusto's separate
 * last_name / first_name columns. Heuristic: the last whitespace-delimited
 * token is the last name; everything before it is the first name. A lone token
 * is treated as a first name (Gusto still name-matches). Empty → two blanks.
 */
export function splitEmployeeName(full: string): { firstName: string; lastName: string } {
  const tokens = (full ?? '').trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return { firstName: '', lastName: '' };
  if (tokens.length === 1) return { firstName: tokens[0], lastName: '' };
  return {
    firstName: tokens.slice(0, -1).join(' '),
    lastName: tokens[tokens.length - 1],
  };
}

/**
 * Escape a free-text CSV cell, Gusto-safe: RFC-4180 quote/double-quote and
 * neutralize a leading `= + - @` (formula injection) with a leading `'`.
 * Mirrors the internal export's `escapeCsvCell` (always quotes) but is
 * duplicated locally so this module has no coupling to
 * `payrollCalculations.ts` formatting.
 */
function escapeGustoCsvCell(value: string | null | undefined): string {
  const raw = value ?? '';
  const noNewlines = raw.replace(/\r?\n/g, ' ');
  const escapedQuotes = noNewlines.replace(/"/g, '""');
  const neutralized = /^[=+\-@]/.test(escapedQuotes) ? `'${escapedQuotes}` : escapedQuotes;
  return `"${neutralized}"`;
}

/** Format cents as a plain dollar string with 2 decimals; zero → blank. */
function formatGustoMoney(cents: number): string {
  if (!cents) return '';
  return (cents / 100).toFixed(2);
}

/** Format decimal hours to up to 2 decimals; zero → blank. */
function formatGustoHours(hours: number): string {
  if (!hours) return '';
  return hours.toFixed(2);
}

/**
 * Build the Gusto timesheet-import CSV for a payroll period: header + exactly
 * one row per employee (no TOTAL row, no trailing blank line). See
 * docs/superpowers/specs/2026-07-07-payroll-provider-export-design.md for the
 * full column mapping and tips rationale.
 */
export function buildGustoCSV(period: PayrollPeriod): string {
  const rows = period.employees.map((ep: EmployeePayroll) => {
    const { firstName, lastName } = splitEmployeeName(ep.employeeName);
    return [
      escapeGustoCsvCell(lastName),
      escapeGustoCsvCell(firstName),
      escapeGustoCsvCell(ep.position),
      '', // gusto_employee_id — no mapping; Gusto name-matches
      formatGustoHours(ep.regularHours),
      formatGustoHours(ep.overtimeHours),
      formatGustoHours(ep.doubleTimeHours),
      '', // missed_break_hours — not tracked
      '', // owners_draw — not tracked
      '', // bonus — not tracked
      '', // commission — not tracked
      formatGustoMoney(ep.tipsOwed),
      formatGustoMoney(ep.tipsPaidOut),
      '', // correction_payment — not tracked
      '', // reimbursement — not tracked
      '', // personal_note — not tracked
    ].join(',');
  });

  return [GUSTO_CSV_HEADERS.join(','), ...rows].join('\n');
}
