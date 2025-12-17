import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
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
import { supabase } from '@/integrations/supabase/client';
import { AlertCircle } from 'lucide-react';
import { format } from 'date-fns';

type DisputeType = 'missing_hours' | 'wrong_role' | 'other';

interface TipDisputeProps {
  restaurantId: string;
  employeeId: string;
  tipSplitId: string;
  tipDate: string;
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
  const queryClient = useQueryClient();

  const { mutate: submitDispute, isPending } = useMutation({
    mutationFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const { error } = await supabase
        .from('tip_disputes')
        .insert({
          restaurant_id: restaurantId,
          employee_id: employeeId,
          tip_split_id: tipSplitId,
          dispute_type: disputeType,
          message: message || null,
          status: 'open',
        });

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tip-disputes'] });
      toast({
        title: 'Issue reported',
        description: 'Your manager has been notified and will review this.',
      });
      setOpen(false);
      setMessage('');
      setDisputeType('missing_hours');
    },
    onError: (error: Error) => {
      toast({
        title: 'Error submitting report',
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2 text-amber-600 border-amber-600">
          <AlertCircle className="h-4 w-4" />
          Something doesn't look right
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Report an issue</DialogTitle>
          <DialogDescription>
            Tips for {format(new Date(tipDate), 'EEEE, MMM d, yyyy')}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-6 py-4">
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
                <RadioGroupItem value="wrong_role" id="wrong_role" />
                <Label htmlFor="wrong_role" className="font-normal cursor-pointer">
                  Wrong role
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
        <div className="flex gap-2">
          <Button 
            onClick={() => submitDispute()} 
            disabled={isPending}
            className="flex-1"
          >
            {isPending ? 'Submitting...' : 'Submit report'}
          </Button>
          <Button 
            onClick={() => setOpen(false)} 
            variant="outline"
            className="flex-1"
          >
            Cancel
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
