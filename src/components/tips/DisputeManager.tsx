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
    <Card className="rounded-xl border-amber-500/30 bg-amber-500/5">
      <CardHeader className="pb-3">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-amber-500/10 flex items-center justify-center">
            <AlertCircle className="h-5 w-5 text-amber-600" />
          </div>
          <div>
            <CardTitle className="text-[17px] font-semibold text-foreground">Tip Review Requests</CardTitle>
            <CardDescription className="text-[13px]">
              {openDisputes.length} employee{openDisputes.length !== 1 ? 's have' : ' has'} flagged issue{openDisputes.length !== 1 ? 's' : ''}
            </CardDescription>
          </div>
        </div>
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
        <div className="p-4 rounded-xl border border-border/40 bg-background hover:border-border transition-colors cursor-pointer">
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
      <DialogContent className="max-w-lg p-0 gap-0 border-border/40">
        <DialogHeader className="px-6 pt-6 pb-4 border-b border-border/40">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-amber-500/10 flex items-center justify-center">
              <AlertCircle className="h-5 w-5 text-amber-600" />
            </div>
            <div>
              <DialogTitle className="text-[17px] font-semibold text-foreground">Tip review requested</DialogTitle>
              <DialogDescription className="text-[13px]">
                {dispute.employee?.name} reported an issue with their tips
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>
        <div className="px-6 py-5 space-y-4">
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
        <div className="flex gap-2 px-6 py-4 border-t border-border/40">
          <Button
            onClick={handleResolve}
            disabled={isLoading}
            className="flex-1 gap-2 h-9 rounded-lg bg-foreground text-background hover:bg-foreground/90 text-[13px] font-medium"
          >
            <Check className="h-4 w-4" />
            Mark resolved
          </Button>
          <Button
            onClick={handleDismiss}
            disabled={isLoading}
            variant="outline"
            className="flex-1 gap-2 h-9 rounded-lg text-[13px] font-medium"
          >
            <X className="h-4 w-4" />
            Dismiss
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
