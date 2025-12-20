import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Textarea } from '@/components/ui/textarea';
import { AlertCircle, Flag } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useTipDisputes } from '@/hooks/useTipDisputes';

interface EmployeeDisputeButtonProps {
  tipSplitId: string;
  employeeId: string;
  restaurantId: string;
}

type DisputeType = 
  | 'missing_hours'
  | 'incorrect_amount'
  | 'wrong_date'
  | 'missing_tips'
  | 'other';

const DISPUTE_TYPES: Array<{ value: DisputeType; label: string; description: string }> = [
  {
    value: 'missing_hours',
    label: 'Missing hours',
    description: 'I worked more hours than shown',
  },
  {
    value: 'incorrect_amount',
    label: 'Incorrect amount',
    description: 'The tip amount doesn\'t look right',
  },
  {
    value: 'wrong_date',
    label: 'Wrong date',
    description: 'This tip is for a different day',
  },
  {
    value: 'missing_tips',
    label: 'Missing tips',
    description: 'I\'m not seeing all my tips',
  },
  {
    value: 'other',
    label: 'Something else',
    description: 'Other issue',
  },
];

export const EmployeeDisputeButton = ({
  tipSplitId,
  employeeId,
  restaurantId,
}: EmployeeDisputeButtonProps) => {
  const [open, setOpen] = useState(false);
  const [disputeType, setDisputeType] = useState<DisputeType>('missing_hours');
  const [message, setMessage] = useState('');
  const { toast } = useToast();
  const { createDispute, isCreating } = useTipDisputes(restaurantId);

  const handleSubmit = async () => {
    if (!disputeType) {
      toast({
        title: 'Please select an issue type',
        variant: 'destructive',
      });
      return;
    }

    try {
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
              title: 'Review request sent',
              description: 'Your manager will review this and get back to you.',
            });
            setOpen(false);
            setMessage('');
            setDisputeType('missing_hours');
          },
          onError: (error) => {
            console.error('Error submitting dispute:', error);
            toast({
              title: 'Error',
              description: 'Failed to submit review request. Please try again.',
              variant: 'destructive',
            });
          },
        }
      );
    } catch (error) {
      console.error('Error submitting dispute:', error);
      toast({
        title: 'Error',
        description: 'Failed to submit review request. Please try again.',
        variant: 'destructive',
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2">
          <Flag className="h-4 w-4" />
          Something doesn't look right
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <AlertCircle className="h-5 w-5 text-amber-500" />
            <DialogTitle>Request a review</DialogTitle>
          </div>
          <DialogDescription>
            Let your manager know if something doesn't look right with your tips.
            They'll review it and respond.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-3">
            <Label>What's the issue?</Label>
            <RadioGroup value={disputeType} onValueChange={(val) => setDisputeType(val as DisputeType)}>
              {DISPUTE_TYPES.map((type) => (
                <div key={type.value} className="flex items-start space-x-3">
                  <RadioGroupItem value={type.value} id={type.value} className="mt-1" />
                  <Label htmlFor={type.value} className="cursor-pointer flex-1">
                    <div className="font-medium">{type.label}</div>
                    <div className="text-sm text-muted-foreground">{type.description}</div>
                  </Label>
                </div>
              ))}
            </RadioGroup>
          </div>

          <div className="space-y-2">
            <Label htmlFor="message">Additional details (optional)</Label>
            <Textarea
              id="message"
              placeholder="E.g., 'I worked 8 hours on Tuesday but only see 5 hours credited'"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={3}
              aria-label="Dispute message details"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={isCreating}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={isCreating}>
            {isCreating ? 'Sending...' : 'Send request'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
