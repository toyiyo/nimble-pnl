import { useState } from 'react';
import { Clock, Calendar, FileText, Loader2, ArrowLeftRight } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

interface AdjustOvertimeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  employeeName: string;
  employeeId: string;
  regularHours: number;
  overtimeHours: number;
  periodStart: string; // YYYY-MM-DD
  periodEnd: string;   // YYYY-MM-DD
  onSubmit: (data: {
    employeeId: string;
    punchDate: string;
    adjustmentType: 'regular_to_overtime' | 'overtime_to_regular';
    hours: number;
    reason: string;
  }) => void;
  isSubmitting?: boolean;
}

export function AdjustOvertimeDialog({
  open,
  onOpenChange,
  employeeName,
  employeeId,
  regularHours,
  overtimeHours,
  periodStart,
  periodEnd,
  onSubmit,
  isSubmitting = false,
}: AdjustOvertimeDialogProps) {
  const [adjustmentType, setAdjustmentType] = useState<'regular_to_overtime' | 'overtime_to_regular'>('regular_to_overtime');
  const [hours, setHours] = useState('');
  const [punchDate, setPunchDate] = useState(periodStart);
  const [reason, setReason] = useState('');
  const [errors, setErrors] = useState<{ hours?: string; punchDate?: string }>({});

  const maxHours = adjustmentType === 'regular_to_overtime' ? regularHours : overtimeHours;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const newErrors: { hours?: string; punchDate?: string } = {};

    const hoursValue = Number.parseFloat(hours);
    if (!hours || Number.isNaN(hoursValue) || hoursValue <= 0) {
      newErrors.hours = 'Enter a valid number of hours';
    } else if (hoursValue > maxHours) {
      newErrors.hours = `Cannot exceed ${maxHours.toFixed(2)} available hours`;
    }

    if (!punchDate) {
      newErrors.punchDate = 'Select a date';
    } else if (punchDate < periodStart || punchDate > periodEnd) {
      newErrors.punchDate = 'Date must be within the pay period';
    }

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }

    onSubmit({
      employeeId,
      punchDate,
      adjustmentType,
      hours: hoursValue,
      reason: reason || '',
    });

    resetForm();
  };

  const resetForm = () => {
    setAdjustmentType('regular_to_overtime');
    setHours('');
    setPunchDate(periodStart);
    setReason('');
    setErrors({});
  };

  const handleClose = () => {
    if (!isSubmitting) {
      resetForm();
      onOpenChange(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-md max-h-[80vh] overflow-y-auto p-0 gap-0 border-border/40">
        <DialogHeader className="px-6 pt-6 pb-4 border-b border-border/40">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-muted/50 flex items-center justify-center">
              <ArrowLeftRight className="h-5 w-5 text-foreground" />
            </div>
            <div>
              <DialogTitle className="text-[17px] font-semibold text-foreground">Adjust Overtime</DialogTitle>
              <p className="text-[13px] text-muted-foreground mt-0.5">
                Reclassify hours for <span className="font-medium text-foreground">{employeeName}</span>
              </p>
            </div>
          </div>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
          {/* Direction */}
          <div className="space-y-2">
            <Label className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider">
              Adjustment Type
            </Label>
            <Select
              value={adjustmentType}
              onValueChange={(v) => setAdjustmentType(v as 'regular_to_overtime' | 'overtime_to_regular')}
            >
              <SelectTrigger className="h-10 text-[14px] bg-muted/30 border-border/40 rounded-lg">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="regular_to_overtime">Regular → Overtime</SelectItem>
                <SelectItem value="overtime_to_regular">Overtime → Regular</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Hours */}
          <div className="space-y-2">
            <Label htmlFor="adjust-hours" className="flex items-center gap-2 text-[12px] font-medium text-muted-foreground uppercase tracking-wider">
              <Clock className="h-3.5 w-3.5" />
              Hours (max {maxHours.toFixed(2)})
            </Label>
            <Input
              id="adjust-hours"
              type="number"
              step="0.25"
              min="0.25"
              max={maxHours}
              value={hours}
              onChange={(e) => {
                setHours(e.target.value);
                setErrors((prev) => ({ ...prev, hours: undefined }));
              }}
              placeholder="0.00"
              className="h-10 text-[14px] bg-muted/30 border-border/40 rounded-lg"
              aria-invalid={!!errors.hours}
              aria-label="Hours to adjust"
            />
            {errors.hours && (
              <p className="text-[13px] text-destructive">{errors.hours}</p>
            )}
          </div>

          {/* Date */}
          <div className="space-y-2">
            <Label htmlFor="adjust-date" className="flex items-center gap-2 text-[12px] font-medium text-muted-foreground uppercase tracking-wider">
              <Calendar className="h-3.5 w-3.5" />
              Date
            </Label>
            <Input
              id="adjust-date"
              type="date"
              min={periodStart}
              max={periodEnd}
              value={punchDate}
              onChange={(e) => {
                setPunchDate(e.target.value);
                setErrors((prev) => ({ ...prev, punchDate: undefined }));
              }}
              className="h-10 text-[14px] bg-muted/30 border-border/40 rounded-lg"
              aria-invalid={!!errors.punchDate}
              aria-label="Adjustment date"
            />
            {errors.punchDate && (
              <p className="text-[13px] text-destructive">{errors.punchDate}</p>
            )}
          </div>

          {/* Reason */}
          <div className="space-y-2">
            <Label htmlFor="adjust-reason" className="flex items-center gap-2 text-[12px] font-medium text-muted-foreground uppercase tracking-wider">
              <FileText className="h-3.5 w-3.5" />
              Reason (optional)
            </Label>
            <Textarea
              id="adjust-reason"
              placeholder="e.g., Manager-approved schedule change..."
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={2}
              className="text-[14px] bg-muted/30 border-border/40 rounded-lg"
              aria-label="Reason for adjustment"
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={handleClose}
              disabled={isSubmitting}
              className="h-9 rounded-lg text-[13px]"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={isSubmitting}
              className="h-9 px-4 rounded-lg bg-foreground text-background hover:bg-foreground/90 text-[13px] font-medium"
              aria-label="Apply overtime adjustment"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Saving...
                </>
              ) : (
                'Apply Adjustment'
              )}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
