import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

import { Printer, FileDown, FileSpreadsheet } from 'lucide-react';

import { generatePlannerPDF, downloadPlannerCSV, formatWeekRange } from '@/utils/plannerExport';

import type { Shift, ShiftTemplate } from '@/types/scheduling';

interface PlannerExportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  shifts: Shift[];
  templates: ShiftTemplate[];
  weekDays: string[];
  restaurantName?: string;
}

export function PlannerExportDialog({
  open,
  onOpenChange,
  shifts,
  templates,
  weekDays,
  restaurantName,
}: Readonly<PlannerExportDialogProps>) {
  const activeShifts = shifts.filter((s) => s.status !== 'cancelled');

  const handleDownloadPDF = () => {
    generatePlannerPDF({ shifts, templates, weekDays, restaurantName });
    onOpenChange(false);
  };

  const handleDownloadCSV = () => {
    const startDate = weekDays[0] || 'unknown';
    const endDate = weekDays[weekDays.length - 1] || 'unknown';
    downloadPlannerCSV({ shifts, templates, weekDays, restaurantName }, `planner_${startDate}_to_${endDate}.csv`);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[80vh] overflow-y-auto p-0 gap-0 border-border/40">
        {/* Header with icon box */}
        <DialogHeader className="px-6 pt-6 pb-4 border-b border-border/40">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-muted/50 flex items-center justify-center">
              <Printer className="h-5 w-5 text-foreground" />
            </div>
            <div>
              <DialogTitle className="text-[17px] font-semibold text-foreground">
                Export Planner
              </DialogTitle>
              <p className="text-[13px] text-muted-foreground mt-0.5">
                {formatWeekRange(weekDays, 'short')} &middot; {activeShifts.length} shift{activeShifts.length !== 1 ? 's' : ''}
              </p>
            </div>
          </div>
        </DialogHeader>

        {/* Content: two buttons */}
        <div className="px-6 py-5 space-y-3">
          <button
            type="button"
            onClick={handleDownloadPDF}
            className="w-full flex items-center gap-4 p-4 rounded-xl border border-border/40 bg-background hover:border-border transition-colors text-left"
            aria-label="Download PDF"
          >
            <div className="h-10 w-10 rounded-xl bg-muted/50 flex items-center justify-center shrink-0">
              <FileDown className="h-5 w-5 text-foreground" />
            </div>
            <div>
              <p className="text-[14px] font-medium text-foreground">Download PDF</p>
              <p className="text-[13px] text-muted-foreground mt-0.5">
                Landscape layout, ready to print or share
              </p>
            </div>
          </button>

          <button
            type="button"
            onClick={handleDownloadCSV}
            className="w-full flex items-center gap-4 p-4 rounded-xl border border-border/40 bg-background hover:border-border transition-colors text-left"
            aria-label="Download CSV"
          >
            <div className="h-10 w-10 rounded-xl bg-muted/50 flex items-center justify-center shrink-0">
              <FileSpreadsheet className="h-5 w-5 text-foreground" />
            </div>
            <div>
              <p className="text-[14px] font-medium text-foreground">Download CSV</p>
              <p className="text-[13px] text-muted-foreground mt-0.5">
                Spreadsheet format for Excel or Google Sheets
              </p>
            </div>
          </button>
        </div>

        {/* Footer */}
        <DialogFooter className="px-6 pb-5 pt-0">
          <Button
            variant="ghost"
            className="h-9 px-4 rounded-lg text-[13px] font-medium text-muted-foreground hover:text-foreground w-full"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
