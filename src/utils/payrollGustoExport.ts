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
