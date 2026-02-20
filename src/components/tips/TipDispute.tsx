import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { useTipDisputes } from '@/hooks/useTipDisputes';
import { AlertCircle } from 'lucide-react';
import { format } from 'date-fns';

type DisputeType = 'missing_hours' | 'incorrect_amount' | 'wrong_date' | 'missing_tips' | 'other';

interface TipDisputeProps {
  readonly restaurantId: string;
  readonly employeeId: string;
  readonly tipSplitId: string;
  readonly tipDate: string;
}

/**
 * TipDispute - Part 4 of Apple-style UX
 * "Something doesn't look right" button for employees
 */
export function TipDispute({ restaurantId, employeeId, tipSplitId, tipDate }: TipDisputeProps) {
  const [open, setOpen] = useState(false);
  const [disputeType, setDisputeType] = useState<DisputeType>('missing_hours');
  const [message, setMessage] = useState('');
  const { toast } = useToast();
  const { createDispute, isCreating } = useTipDisputes(restaurantId);

  const handleSubmit = () => {
    createDispute(
      {
        restaurant_id: restaurantId,
        employee_id: employeeId,
        tip_split_id: tipSplitId,
        dispute_type: disputeType,
        message: message,
      },
      {
        onSuccess: () => {
          toast({
            title: 'Issue reported',
            description: 'Your manager has been notified and will review this.',
          });
          setOpen(false);
          setMessage('');
          setDisputeType('missing_hours');
        },
        onError: (error) => {
          toast({
            title: 'Error submitting report',
            description: error.message,
            variant: 'destructive',
          });
        },
      }
    );
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2 text-amber-600 border-amber-600">
          <AlertCircle className="h-4 w-4" />
          Something doesn't look right
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md p-0 gap-0 border-border/40">
        <DialogHeader className="px-6 pt-6 pb-4 border-b border-border/40">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-amber-500/10 flex items-center justify-center">
              <AlertCircle className="h-5 w-5 text-amber-600" />
            </div>
            <div>
              <DialogTitle className="text-[17px] font-semibold text-foreground">Report an issue</DialogTitle>
              <DialogDescription className="text-[13px] mt-0.5">
                Tips for {format(new Date(tipDate), 'EEEE, MMM d, yyyy')}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>
        <div className="px-6 py-5 space-y-6">
          <div className="space-y-3">
            <Label>What seems wrong?</Label>
            <RadioGroup value={disputeType} onValueChange={(val) => setDisputeType(val as DisputeType)}>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="missing_hours" id="missing_hours" />
                <Label htmlFor="missing_hours" className="font-normal cursor-pointer">
                  Missing hours
                </Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="incorrect_amount" id="incorrect_amount" />
                <Label htmlFor="incorrect_amount" className="font-normal cursor-pointer">
                  Incorrect amount
                </Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="wrong_date" id="wrong_date" />
                <Label htmlFor="wrong_date" className="font-normal cursor-pointer">
                  Wrong date
                </Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="missing_tips" id="missing_tips" />
                <Label htmlFor="missing_tips" className="font-normal cursor-pointer">
                  Missing tips
                </Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="other" id="other" />
                <Label htmlFor="other" className="font-normal cursor-pointer">
                  Other
                </Label>
              </div>
            </RadioGroup>
          </div>

          <div className="space-y-2">
            <Label htmlFor="message">Additional details (optional)</Label>
            <Textarea
              id="message"
              placeholder="Add any details that might help..."
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={3}
            />
          </div>

          <p className="text-xs text-muted-foreground">
            Your manager will be notified and will review this issue.
          </p>
        </div>
        <div className="flex gap-2 px-6 py-4 border-t border-border/40">
          <Button
            onClick={handleSubmit}
            disabled={isCreating}
            className="flex-1 h-9 rounded-lg bg-foreground text-background hover:bg-foreground/90 text-[13px] font-medium"
          >
            {isCreating ? 'Submitting...' : 'Submit report'}
          </Button>
          <Button
            onClick={() => setOpen(false)}
            variant="outline"
            className="flex-1 h-9 rounded-lg text-[13px] font-medium"
          >
            Cancel
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
