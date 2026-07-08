import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ChevronDown, Download } from 'lucide-react';

import { useToast } from '@/hooks/use-toast';

import type { PayrollPeriod } from '@/utils/payrollCalculations';
import type { PayrollExportFormat } from '@/utils/payrollExportFormats';
import { PAYROLL_EXPORT_FORMATS } from '@/utils/payrollExportFormats';

interface PayrollExportMenuProps {
  /** The ordered/grouped period to export, or null while loading/empty. */
  readonly period: PayrollPeriod | null;
  readonly start: Date;
  readonly end: Date;
  readonly disabled?: boolean;
}

/**
 * "Export ▾" dropdown offering each registered payroll export format.
 * Mirrors the export-picker precedent in src/pages/Inventory.tsx.
 */
export function PayrollExportMenu({ period, start, end, disabled }: PayrollExportMenuProps) {
  const { toast } = useToast();

  const handleExport = (exportFormat: PayrollExportFormat) => {
    if (!period) {
      toast({ title: 'Nothing to export', description: 'There is no payroll data for this period yet.', variant: 'destructive' });
      return;
    }
    let csv: string;
    try {
      csv = exportFormat.build(period);
    } catch (err) {
      console.error('Payroll export failed', err);
      toast({ title: 'Export failed', description: 'Could not build the export file. Please try again.', variant: 'destructive' });
      return;
    }
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = exportFormat.filename(start, end);
    a.click();
    // Revoke after a tick so the browser can schedule the download first.
    setTimeout(() => window.URL.revokeObjectURL(url), 100);
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button disabled={disabled}>
          <Download className="h-4 w-4 mr-2" aria-hidden="true" />
          Export
          <ChevronDown className="h-4 w-4 ml-2" aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="bg-background z-50">
        {PAYROLL_EXPORT_FORMATS.map((exportFormat) => (
          <DropdownMenuItem
            key={exportFormat.id}
            className="cursor-pointer"
            onClick={() => handleExport(exportFormat)}
          >
            {exportFormat.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
