import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Shift } from '@/types/scheduling';
import { useCreateShiftOffer } from '@/hooks/useShiftOffers';
import { format } from 'date-fns';
import { Calendar, Clock } from 'lucide-react';

interface ShiftOfferDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  shift: Shift;
  employeeId: string;
  restaurantId: string;
}

export const ShiftOfferDialog = ({
  open,
  onOpenChange,
  shift,
  employeeId,
  restaurantId,
}: ShiftOfferDialogProps) => {
  const [reason, setReason] = useState('');
  const [isPartial, setIsPartial] = useState(false);
  const [loading, setLoading] = useState(false);
  
  const createShiftOffer = useCreateShiftOffer();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      await createShiftOffer.mutateAsync({
        restaurant_id: restaurantId,
        shift_id: shift.id,
        offering_employee_id: employeeId,
        reason: reason || undefined,
        is_partial: isPartial,
        // For now, partial shifts require manual time entry - can be enhanced later
        partial_start_time: undefined,
        partial_end_time: undefined,
      });
      
      onOpenChange(false);
      setReason('');
      setIsPartial(false);
    } catch (error) {
      console.error('Error creating shift offer:', error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle className="text-2xl bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
            Offer Shift for Trade
          </DialogTitle>
          <DialogDescription>
            Post this shift to the marketplace for other employees to claim.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Shift Details */}
          <div className="bg-gradient-to-br from-muted/50 to-transparent rounded-lg p-4 space-y-2">
            <div className="flex items-center gap-2 text-sm">
              <Calendar className="h-4 w-4 text-primary" />
              <span className="font-medium">
                {format(new Date(shift.start_time), 'EEEE, MMMM d, yyyy')}
              </span>
            </div>
            <div className="flex items-center gap-2 text-sm">
              <Clock className="h-4 w-4 text-primary" />
              <span>
                {format(new Date(shift.start_time), 'h:mm a')} - {format(new Date(shift.end_time), 'h:mm a')}
              </span>
            </div>
            <div className="text-sm text-muted-foreground">
              Position: {shift.position}
            </div>
          </div>

          {/* Reason */}
          <div className="space-y-2">
            <Label htmlFor="reason">Reason (Optional)</Label>
            <Textarea
              id="reason"
              placeholder="Why are you offering this shift?"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
            />
          </div>

          {/* Partial Shift Option */}
          <div className="flex items-center space-x-2">
            <Checkbox
              id="partial"
              checked={isPartial}
              onCheckedChange={(checked) => setIsPartial(checked as boolean)}
            />
            <Label
              htmlFor="partial"
              className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
            >
              Allow partial shift trade (claim part of the shift)
            </Label>
          </div>

          {/* Action Buttons */}
          <div className="flex gap-3 justify-end">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={loading}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={loading}
              className="bg-gradient-to-r from-primary to-accent"
            >
              {loading ? 'Posting...' : 'Post to Marketplace'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
};
