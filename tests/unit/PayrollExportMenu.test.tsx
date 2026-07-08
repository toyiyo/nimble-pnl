import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { PayrollExportMenu } from '@/components/payroll/PayrollExportMenu';
import { GUSTO_CSV_HEADERS } from '@/utils/payrollGustoExport';
import type { EmployeePayroll, PayrollPeriod } from '@/utils/payrollCalculations';

function employee(overrides: Partial<EmployeePayroll> = {}): EmployeePayroll {
  return {
    employeeId: 'e1', employeeName: 'Oscar Estrada', position: 'Server', area: null,
    compensationType: 'hourly', hourlyRate: 1000, regularHours: 2.23, overtimeHours: 0,
    doubleTimeHours: 0, doubleTimePay: 0, dailyOvertimeHours: 0, weeklyOvertimeHours: 0,
    regularPay: 2227, overtimePay: 0, salaryPay: 0, contractorPay: 0, dailyRatePay: 0,
    manualPayments: [], manualPaymentsTotal: 0, grossPay: 2227, totalTips: 0,
    tipsPaidOut: 0, tipsOwed: 0, totalPay: 2227, ...overrides,
  };
}

function period(): PayrollPeriod {
  return {
    startDate: new Date(2026, 5, 8), endDate: new Date(2026, 5, 14),
    employees: [employee()], totalRegularHours: 2.23, totalOvertimeHours: 0,
    totalDoubleTimeHours: 0, totalGrossPay: 2227, totalTips: 0, totalTipsPaidOut: 0,
    totalTipsOwed: 0,
  };
}

/** Capture the downloaded blob + filename by stubbing URL + anchor.click. */
function stubDownload() {
  let blob: Blob | undefined;
  let download = '';
  vi.spyOn(URL, 'createObjectURL').mockImplementation((b) => { blob = b as Blob; return 'blob:mock'; });
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    download = this.download;
  });
  return { getBlob: () => blob, getDownload: () => download };
}

afterEach(() => vi.restoreAllMocks());

/** jsdom's Blob has no .text(); read via the arrayBuffer() polyfill in tests/setup.ts. */
async function readBlobText(blob: Blob): Promise<string> {
  const buffer = await blob.arrayBuffer();
  return new TextDecoder().decode(buffer);
}

describe('PayrollExportMenu', () => {
  it('exports the Gusto format with the gusto filename and header', async () => {
    const dl = stubDownload();
    const user = userEvent.setup();
    render(<PayrollExportMenu period={period()} start={new Date(2026, 5, 8)} end={new Date(2026, 5, 14)} />);

    await user.click(screen.getByRole('button', { name: /export/i }));
    await user.click(await screen.findByText('Gusto CSV'));

    expect(dl.getDownload()).toBe('payroll_gusto_2026-06-08_to_2026-06-14.csv');
    const text = await readBlobText(dl.getBlob()!);
    expect(text.split('\n')[0]).toBe(GUSTO_CSV_HEADERS.join(','));
  });

  it('exports the Standard format with the standard filename and header', async () => {
    const dl = stubDownload();
    const user = userEvent.setup();
    render(<PayrollExportMenu period={period()} start={new Date(2026, 5, 8)} end={new Date(2026, 5, 14)} />);

    await user.click(screen.getByRole('button', { name: /export/i }));
    await user.click(await screen.findByText('Standard CSV'));

    expect(dl.getDownload()).toBe('payroll_2026-06-08_to_2026-06-14.csv');
    const text = await readBlobText(dl.getBlob()!);
    expect(text.split('\n')[0]).toContain('Employee Name');
  });

  it('disables the trigger when there are no employees to export', () => {
    render(<PayrollExportMenu period={null} start={new Date(2026, 5, 8)} end={new Date(2026, 5, 14)} disabled />);
    expect(screen.getByRole('button', { name: /export/i })).toBeDisabled();
  });
});
