import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { useState } from 'react';
import { format } from 'date-fns';
import { useTipDisputes, type TipDisputeWithDetails } from '@/hooks/useTipDisputes';
import { AlertCircle, Check, X } from 'lucide-react';
import { formatCurrencyFromCents } from '@/utils/tipPooling';

interface DisputeManagerProps {
  restaurantId: string;
}

/**
 * DisputeManager - Part 4 of Apple-style UX
 * Manager view of employee disputes
 */
export function DisputeManager({ restaurantId }: DisputeManagerProps) {
  const { openDisputes, resolveDispute, dismissDispute, isResolving, isDismissing } = useTipDisputes(restaurantId, 'open');

  if (!openDisputes.length) {
    return null;
  }

  return (
    <Card className="border-amber-500/30 bg-amber-500/5">
      <CardHeader>
        <div className="flex items-center gap-2">
          <AlertCircle className="h-5 w-5 text-amber-600" />
          <CardTitle>Tip Review Requests</CardTitle>
        </div>
        <CardDescription>
          {openDisputes.length} employee{openDisputes.length !== 1 ? 's have' : ' has'} flagged issue{openDisputes.length !== 1 ? 's' : ''}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {openDisputes.map((dispute) => (
          <DisputeCard
            key={dispute.id}
            dispute={dispute}
            onResolve={resolveDispute}
            onDismiss={dismissDispute}
            isLoading={isResolving || isDismissing}
          />
        ))}
      </CardContent>
    </Card>
  );
}

function DisputeCard({
  dispute,
  onResolve,
  onDismiss,
  isLoading,
}: {
  dispute: TipDisputeWithDetails;
  onResolve: (params: { disputeId: string; notes?: string }) => void;
  onDismiss: (params: { disputeId: string; notes?: string }) => void;
  isLoading: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [notes, setNotes] = useState('');

  const getDisputeTypeLabel = () => {
    switch (dispute.dispute_type) {
      case 'missing_hours':
        return 'Missing hours';
      case 'wrong_role':
        return 'Wrong role';
      default:
        return 'Other';
    }
  };

  const handleResolve = () => {
    onResolve({ disputeId: dispute.id, notes });
    setOpen(false);
    setNotes('');
  };

  const handleDismiss = () => {
    onDismiss({ disputeId: dispute.id, notes });
    setOpen(false);
    setNotes('');
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <div className="p-4 rounded-lg border bg-background hover:bg-muted/50 transition-colors cursor-pointer">
          <div className="flex items-start justify-between">
            <div className="space-y-1">
              <p className="font-medium">{dispute.employee?.name}</p>
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Badge variant="outline" className="text-amber-600">
                  {getDisputeTypeLabel()}
                </Badge>
                {dispute.tip_split && (
                  <span>
                    • {format(new Date(dispute.tip_split.split_date + 'T12:00:00'), 'MMM d')}
                  </span>
                )}
              </div>
              {dispute.message && (
                <p className="text-sm text-muted-foreground mt-2">{dispute.message}</p>
              )}
            </div>
            <AlertCircle className="h-5 w-5 text-amber-600 flex-shrink-0" />
          </div>
        </div>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Tip review requested</DialogTitle>
          <DialogDescription>
            {dispute.employee?.name} reported an issue with their tips
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <p className="text-sm font-medium">Issue type:</p>
            <Badge variant="outline" className="text-amber-600">
              {getDisputeTypeLabel()}
            </Badge>
          </div>

          {dispute.tip_split && (
            <div className="space-y-2">
              <p className="text-sm font-medium">Date:</p>
              <p className="text-sm text-muted-foreground">
                {format(new Date(dispute.tip_split.split_date + 'T12:00:00'), 'EEEE, MMMM d, yyyy')}
              </p>
            </div>
          )}

          {dispute.message && (
            <div className="space-y-2">
              <p className="text-sm font-medium">Employee notes:</p>
              <p className="text-sm text-muted-foreground p-3 rounded-lg bg-muted">
                {dispute.message}
              </p>
            </div>
          )}

          <div className="space-y-2">
            <p className="text-sm font-medium">Resolution notes (optional):</p>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Add any notes about how this was resolved..."
              rows={3}
            />
          </div>
        </div>
        <div className="flex gap-2">
          <Button
            onClick={handleResolve}
            disabled={isLoading}
            className="flex-1 gap-2"
          >
            <Check className="h-4 w-4" />
            Mark resolved
          </Button>
          <Button
            onClick={handleDismiss}
            disabled={isLoading}
            variant="outline"
            className="flex-1 gap-2"
          >
            <X className="h-4 w-4" />
            Dismiss
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
