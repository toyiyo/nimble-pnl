import { format } from 'date-fns';

import type { PayrollPeriod } from '@/utils/payrollCalculations';
import { exportPayrollToCSV } from '@/utils/payrollCalculations';
import { buildGustoCSV } from '@/utils/payrollGustoExport';

/** A selectable payroll export format (internal or a payroll provider). */
export interface PayrollExportFormat {
  id: 'internal' | 'gusto';
  /** Menu label shown in the Export dropdown. */
  label: string;
  /** Serialize a payroll period to CSV text for this format. */
  build: (period: PayrollPeriod) => string;
  /** Download filename for a given period date range. */
  filename: (start: Date, end: Date) => string;
}

/** Shared so the internal and provider filenames can't drift in date formatting. */
function formatDateRange(start: Date, end: Date): string {
  return `${format(start, 'yyyy-MM-dd')}_to_${format(end, 'yyyy-MM-dd')}`;
}

export const PAYROLL_EXPORT_FORMATS: readonly PayrollExportFormat[] = [
  {
    id: 'internal',
    label: 'Standard CSV',
    build: exportPayrollToCSV,
    filename: (start, end) => `payroll_${formatDateRange(start, end)}.csv`,
  },
  {
    id: 'gusto',
    label: 'Gusto CSV',
    build: buildGustoCSV,
    filename: (start, end) => `payroll_gusto_${formatDateRange(start, end)}.csv`,
  },
];
