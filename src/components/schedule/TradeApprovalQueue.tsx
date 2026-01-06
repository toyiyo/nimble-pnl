import { useState } from 'react';
import { format } from 'date-fns';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  useShiftTrades,
  useApproveShiftTrade,
  useRejectShiftTrade,
  ShiftTrade,
} from '@/hooks/useShiftTrades';
import { useRestaurantContext } from '@/contexts/RestaurantContext';
import {
  CheckCircle,
  XCircle,
  Clock,
  Calendar,
  ArrowRight,
  Loader2,
  AlertCircle,
  FileText,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Skeleton } from '@/components/ui/skeleton';

type ActionType = 'approve' | 'reject' | null;

export const TradeApprovalQueue = () => {
  const { selectedRestaurant } = useRestaurantContext();
  const restaurantId = selectedRestaurant?.restaurant_id || null;
  const { trades, loading } = useShiftTrades(
    restaurantId,
    'pending_approval',
    null // Don't filter by employee - show all trades
  );
  const { mutate: approveTrade, isPending: isApproving } = useApproveShiftTrade();
  const { mutate: rejectTrade, isPending: isRejecting } = useRejectShiftTrade();

  const [selectedTrade, setSelectedTrade] = useState<ShiftTrade | null>(null);
  const [actionType, setActionType] = useState<ActionType>(null);
  const [managerNote, setManagerNote] = useState('');

  const handleAction = (trade: ShiftTrade, action: 'approve' | 'reject') => {
    setSelectedTrade(trade);
    setActionType(action);
    setManagerNote('');
  };

  const handleConfirm = () => {
    if (!selectedTrade || !actionType) return;

    const payload = {
      tradeId: selectedTrade.id,
      managerNote: managerNote || undefined,
    };

    if (actionType === 'approve') {
      approveTrade(payload, {
        onSuccess: () => {
          setSelectedTrade(null);
          setActionType(null);
          setManagerNote('');
        },
      });
    } else {
      rejectTrade(payload, {
        onSuccess: () => {
          setSelectedTrade(null);
          setActionType(null);
          setManagerNote('');
        },
      });
    }
  };

  const handleCancel = () => {
    setSelectedTrade(null);
    setActionType(null);
    setManagerNote('');
  };

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-12 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header Card */}
      <Card className="border-amber-200 bg-gradient-to-br from-amber-50 via-orange-50 to-transparent dark:border-amber-800 dark:from-amber-950/20 dark:via-orange-950/20">
        <CardHeader>
          <div className="flex items-center gap-3">
            <Clock className="h-6 w-6 text-amber-600 dark:text-amber-400" />
            <div>
              <CardTitle className="text-2xl text-amber-900 dark:text-amber-100">
                Pending Trade Requests
              </CardTitle>
              <CardDescription className="text-amber-700 dark:text-amber-300">
                Review and approve shift trades between employees
              </CardDescription>
            </div>
          </div>
        </CardHeader>
      </Card>

      {/* Trade Requests */}
      {trades.length === 0 ? (
        <Card className="bg-gradient-to-br from-muted/50 to-transparent">
          <CardContent className="py-12 text-center">
            <CheckCircle className="mx-auto mb-4 h-12 w-12 text-muted-foreground" />
            <h3 className="mb-2 text-lg font-semibold">All caught up!</h3>
            <p className="text-muted-foreground">No pending trade requests to review.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {trades.map((trade) => (
            <TradeRequestCard
              key={trade.id}
              trade={trade}
              onApprove={() => handleAction(trade, 'approve')}
              onReject={() => handleAction(trade, 'reject')}
              disabled={isApproving || isRejecting}
            />
          ))}
        </div>
      )}

      {/* Approval/Rejection Dialog */}
      <Dialog open={!!selectedTrade && !!actionType} onOpenChange={(open) => !open && handleCancel()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {actionType === 'approve' ? (
                <>
                  <CheckCircle className="h-5 w-5 text-green-600" />
                  Approve Trade Request
                </>
              ) : (
                <>
                  <XCircle className="h-5 w-5 text-red-600" />
                  Reject Trade Request
                </>
              )}
            </DialogTitle>
            <DialogDescription>
              {actionType === 'approve'
                ? 'This will transfer the shift to the accepting employee.'
                : 'This will decline the trade request and keep the original assignment.'}
            </DialogDescription>
          </DialogHeader>

          {selectedTrade && (
            <div className="space-y-4">
              {/* Trade Summary */}
              <div className="rounded-lg border border-border bg-muted/20 p-4">
                <h4 className="mb-3 text-sm font-semibold text-muted-foreground">Trade Summary</h4>
                <div className="flex items-center gap-2">
                  <div className="flex-1 text-center">
                    <p className="text-xs text-muted-foreground">From</p>
                    <p className="font-medium">{selectedTrade.offered_by?.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {selectedTrade.offered_by?.position}
                    </p>
                  </div>
                  <ArrowRight className="h-5 w-5 text-muted-foreground" />
                  <div className="flex-1 text-center">
                    <p className="text-xs text-muted-foreground">To</p>
                    <p className="font-medium">{selectedTrade.accepted_by?.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {selectedTrade.accepted_by?.position}
                    </p>
                  </div>
                </div>
                <div className="mt-3 space-y-1 border-t border-border pt-3 text-sm">
                  <p>
                    <span className="font-medium">Date:</span>{' '}
                    {selectedTrade.offered_shift &&
                      format(new Date(selectedTrade.offered_shift.start_time), 'EEEE, MMMM d')}
                  </p>
                  <p>
                    <span className="font-medium">Time:</span>{' '}
                    {selectedTrade.offered_shift &&
                      `${format(new Date(selectedTrade.offered_shift.start_time), 'h:mm a')} - ${format(new Date(selectedTrade.offered_shift.end_time), 'h:mm a')}`}
                  </p>
                  <p>
                    <span className="font-medium">Position:</span>{' '}
                    {selectedTrade.offered_shift?.position}
                  </p>
                </div>
              </div>

              {/* Employee Reason */}
              {selectedTrade.reason && (
                <div className="rounded-lg bg-blue-50 p-4 dark:bg-blue-950/20">
                  <p className="mb-1 text-sm font-medium text-blue-900 dark:text-blue-100">
                    Employee Reason:
                  </p>
                  <p className="text-sm text-blue-700 dark:text-blue-300">
                    {selectedTrade.reason}
                  </p>
                </div>
              )}

              {/* Manager Note */}
              <div className="space-y-2">
                <Label htmlFor="manager-note" className="text-sm font-medium">
                  Add Note{' '}
                  <span className="text-muted-foreground">
                    ({actionType === 'reject' ? 'Recommended' : 'Optional'})
                  </span>
                </Label>
                <Textarea
                  id="manager-note"
                  placeholder={
                    actionType === 'approve'
                      ? 'Optional note about this approval...'
                      : 'Explain why this trade is being rejected...'
                  }
                  value={managerNote}
                  onChange={(e) => setManagerNote(e.target.value)}
                  rows={3}
                  className="resize-none"
                />
              </div>

              {actionType === 'approve' && (
                <div className="flex items-start gap-2 rounded-lg bg-green-50 p-3 dark:bg-green-950/20">
                  <AlertCircle className="mt-0.5 h-4 w-4 text-green-600 dark:text-green-400" />
                  <p className="text-xs text-green-700 dark:text-green-300">
                    Both employees will be notified via email of your decision.
                  </p>
                </div>
              )}
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={handleCancel} disabled={isApproving || isRejecting}>
              Cancel
            </Button>
            <Button
              onClick={handleConfirm}
              disabled={isApproving || isRejecting}
              variant={actionType === 'approve' ? 'default' : 'destructive'}
            >
              {isApproving || isRejecting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Processing...
                </>
              ) : actionType === 'approve' ? (
                <>
                  <CheckCircle className="mr-2 h-4 w-4" />
                  Approve
                </>
              ) : (
                <>
                  <XCircle className="mr-2 h-4 w-4" />
                  Reject
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

// Individual Trade Request Card
interface TradeRequestCardProps {
  trade: ShiftTrade;
  onApprove: () => void;
  onReject: () => void;
  disabled: boolean;
}

const TradeRequestCard = ({ trade, onApprove, onReject, disabled }: TradeRequestCardProps) => {
  if (!trade.offered_shift || !trade.offered_by || !trade.accepted_by) {
    return null;
  }

  const shiftStart = new Date(trade.offered_shift.start_time);
  const shiftEnd = new Date(trade.offered_shift.end_time);

  return (
    <Card data-testid="pending-trade" className="border-amber-200 dark:border-amber-800">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between">
          <div>
            <CardTitle className="text-lg">{trade.offered_shift.position}</CardTitle>
            <CardDescription className="mt-1">
              {format(shiftStart, 'EEEE, MMMM d, yyyy')}
            </CardDescription>
          </div>
          <Badge className="bg-amber-500">Pending</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Time */}
        <div className="flex items-center gap-2 text-sm">
          <Clock className="h-4 w-4 text-muted-foreground" />
          <span>
            {format(shiftStart, 'h:mm a')} - {format(shiftEnd, 'h:mm a')}
          </span>
        </div>

        {/* Trade Flow */}
        <div className="flex items-center gap-3 rounded-lg bg-muted/50 p-3">
          <div className="flex-1 text-center">
            <p className="text-xs text-muted-foreground">From</p>
            <p className="font-medium">{trade.offered_by.name}</p>
            <p className="text-xs text-muted-foreground">{trade.offered_by.position}</p>
          </div>
          <ArrowRight className="h-5 w-5 text-muted-foreground" />
          <div className="flex-1 text-center">
            <p className="text-xs text-muted-foreground">To</p>
            <p className="font-medium">{trade.accepted_by.name}</p>
            <p className="text-xs text-muted-foreground">{trade.accepted_by.position}</p>
          </div>
        </div>

        {/* Reason */}
        {trade.reason && (
          <div className="flex items-start gap-2 rounded-md bg-blue-50 p-3 dark:bg-blue-950/20">
            <FileText className="mt-0.5 h-4 w-4 text-blue-600 dark:text-blue-400" />
            <div className="flex-1">
              <p className="text-xs font-medium text-blue-900 dark:text-blue-100">Reason:</p>
              <p className="mt-1 text-sm text-blue-700 dark:text-blue-300">{trade.reason}</p>
            </div>
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex gap-2">
          <Button
            onClick={onReject}
            disabled={disabled}
            variant="outline"
            className="flex-1 border-red-200 text-red-600 hover:bg-red-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-950/20"
          >
            <XCircle className="mr-2 h-4 w-4" />
            Reject
          </Button>
          <Button onClick={onApprove} disabled={disabled} className="flex-1">
            <CheckCircle className="mr-2 h-4 w-4" />
            Approve
          </Button>
        </div>
      </CardContent>
    </Card>
  );
};
