import { useState } from 'react';
import { format, formatDistanceToNow } from 'date-fns';
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
import { useMarketplaceTrades, useAcceptShiftTrade } from '@/hooks/useShiftTrades';
import { useCurrentEmployee } from '@/hooks/useCurrentEmployee';
import { useRestaurantContext } from '@/contexts/RestaurantContext';
import {
  Store,
  Clock,
  Calendar,
  AlertTriangle,
  Users,
  ArrowRightLeft,
  Loader2,
  Info,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Skeleton } from '@/components/ui/skeleton';

interface TradeWithConflict {
  id: string;
  offered_shift: {
    id: string;
    start_time: string;
    end_time: string;
    position: string;
    break_duration: number;
  };
  offered_by: {
    id: string;
    name: string;
    position: string;
  };
  reason: string | null;
  created_at: string;
  hasConflict?: boolean;
}

export const TradeMarketplace = () => {
  const { selectedRestaurant } = useRestaurantContext();
  const { employee } = useCurrentEmployee();
  const { trades, loading } = useMarketplaceTrades(
    selectedRestaurant?.id || null,
    employee?.id || null
  );
  const { mutate: acceptTrade, isPending: isAccepting } = useAcceptShiftTrade();

  const [selectedTrade, setSelectedTrade] = useState<TradeWithConflict | null>(null);
  const [confirmDialogOpen, setConfirmDialogOpen] = useState(false);

  const handleAcceptClick = (trade: TradeWithConflict) => {
    if (trade.hasConflict) {
      // Don't allow accepting if there's a conflict
      return;
    }
    setSelectedTrade(trade);
    setConfirmDialogOpen(true);
  };

  const handleConfirmAccept = () => {
    if (!selectedTrade || !employee?.id) return;

    acceptTrade(
      {
        tradeId: selectedTrade.id,
        acceptingEmployeeId: employee.id,
      },
      {
        onSuccess: () => {
          setConfirmDialogOpen(false);
          setSelectedTrade(null);
        },
      }
    );
  };

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-12 w-full" />
      </div>
    );
  }

  const availableTrades = trades.filter((t) => !t.hasConflict);
  const conflictTrades = trades.filter((t) => t.hasConflict);

  return (
    <div className="space-y-6">
      {/* Header Card */}
      <Card className="border-primary/10 bg-gradient-to-br from-primary/5 via-accent/5 to-transparent">
        <CardHeader>
          <div className="flex items-center gap-3">
            <Store className="h-6 w-6 text-primary transition-transform duration-300 group-hover:scale-110" />
            <div>
              <CardTitle className="bg-gradient-to-r from-primary to-accent bg-clip-text text-2xl text-transparent">
                Trade Marketplace
              </CardTitle>
              <CardDescription>Pick up available shifts from your coworkers</CardDescription>
            </div>
          </div>
        </CardHeader>
      </Card>

      {/* Info Banner */}
      {trades.length > 0 && (
        <div className="flex items-start gap-3 rounded-lg border border-blue-200 bg-blue-50 p-4 dark:border-blue-800 dark:bg-blue-950/30">
          <Info className="h-5 w-5 text-blue-600 dark:text-blue-400" />
          <div className="flex-1 text-sm">
            <p className="font-medium text-blue-900 dark:text-blue-100">
              How shift trading works
            </p>
            <p className="mt-1 text-blue-700 dark:text-blue-300">
              When you accept a shift, your request goes to management for approval. Once
              approved, the shift will be transferred to your schedule.
            </p>
          </div>
        </div>
      )}

      {/* Available Shifts */}
      {availableTrades.length === 0 && conflictTrades.length === 0 ? (
        <Card className="bg-gradient-to-br from-muted/50 to-transparent">
          <CardContent className="py-12 text-center">
            <Users className="mx-auto mb-4 h-12 w-12 text-muted-foreground" />
            <h3 className="mb-2 text-lg font-semibold">No shifts available</h3>
            <p className="text-muted-foreground">
              Check back later for shifts posted by your coworkers.
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Available (No Conflicts) */}
          {availableTrades.length > 0 && (
            <div className="space-y-3">
              <h3 className="text-lg font-semibold">Available Shifts</h3>
              <div className="grid gap-4 md:grid-cols-2">
                {availableTrades.map((trade) => (
                  <ShiftTradeCard
                    key={trade.id}
                    trade={trade}
                    onAccept={handleAcceptClick}
                    disabled={isAccepting}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Conflicts */}
          {conflictTrades.length > 0 && (
            <div className="space-y-3">
              <h3 className="flex items-center gap-2 text-lg font-semibold text-muted-foreground">
                <AlertTriangle className="h-5 w-5 text-amber-500" />
                Unavailable (Schedule Conflict)
              </h3>
              <div className="grid gap-4 md:grid-cols-2">
                {conflictTrades.map((trade) => (
                  <ShiftTradeCard
                    key={trade.id}
                    trade={trade}
                    onAccept={handleAcceptClick}
                    disabled={true}
                    showConflict={true}
                  />
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {/* Confirmation Dialog */}
      <Dialog open={confirmDialogOpen} onOpenChange={setConfirmDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Accept Shift Trade?</DialogTitle>
            <DialogDescription>
              Your request will be sent to management for approval.
            </DialogDescription>
          </DialogHeader>

          {selectedTrade && (
            <div className="space-y-4">
              <div className="rounded-lg border border-border bg-muted/20 p-4">
                <h4 className="mb-2 text-sm font-semibold text-muted-foreground">
                  Shift Details
                </h4>
                <div className="space-y-1 text-sm">
                  <p>
                    <span className="font-medium">Date:</span>{' '}
                    {format(new Date(selectedTrade.offered_shift.start_time), 'EEEE, MMMM d')}
                  </p>
                  <p>
                    <span className="font-medium">Time:</span>{' '}
                    {format(new Date(selectedTrade.offered_shift.start_time), 'h:mm a')} -{' '}
                    {format(new Date(selectedTrade.offered_shift.end_time), 'h:mm a')}
                  </p>
                  <p>
                    <span className="font-medium">Position:</span>{' '}
                    {selectedTrade.offered_shift.position}
                  </p>
                  <p>
                    <span className="font-medium">Posted by:</span>{' '}
                    {selectedTrade.offered_by.name}
                  </p>
                </div>
              </div>

              {selectedTrade.reason && (
                <div className="rounded-lg bg-amber-50 p-4 dark:bg-amber-950/20">
                  <p className="text-sm font-medium text-amber-900 dark:text-amber-100">
                    Reason:
                  </p>
                  <p className="mt-1 text-sm text-amber-700 dark:text-amber-300">
                    {selectedTrade.reason}
                  </p>
                </div>
              )}
            </div>
          )}

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setConfirmDialogOpen(false)}
              disabled={isAccepting}
            >
              Cancel
            </Button>
            <Button onClick={handleConfirmAccept} disabled={isAccepting}>
              {isAccepting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Sending...
                </>
              ) : (
                <>
                  <ArrowRightLeft className="mr-2 h-4 w-4" />
                  Accept Shift
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

// Individual Shift Trade Card Component
interface ShiftTradeCardProps {
  trade: TradeWithConflict;
  onAccept: (trade: TradeWithConflict) => void;
  disabled: boolean;
  showConflict?: boolean;
}

const ShiftTradeCard = ({ trade, onAccept, disabled, showConflict }: ShiftTradeCardProps) => {
  const shiftStart = new Date(trade.offered_shift.start_time);
  const shiftEnd = new Date(trade.offered_shift.end_time);
  const duration = (shiftEnd.getTime() - shiftStart.getTime()) / (1000 * 60 * 60);

  return (
    <Card
      data-testid="available-shift"
      className={cn(
        'transition-all hover:border-primary/50 hover:shadow-md',
        showConflict && 'opacity-60'
      )}
    >
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between">
          <div className="flex-1">
            <CardTitle className="text-lg">{trade.offered_shift.position}</CardTitle>
            <CardDescription className="mt-1 text-xs">
              Posted by {trade.offered_by.name} •{' '}
              {formatDistanceToNow(new Date(trade.created_at), { addSuffix: true })}
            </CardDescription>
          </div>
          {showConflict && (
            <Badge variant="destructive" className="ml-2">
              <AlertTriangle className="mr-1 h-3 w-3" />
              Conflict
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Date & Time */}
        <div className="flex items-center gap-2 text-sm">
          <Calendar className="h-4 w-4 text-muted-foreground" />
          <span className="font-medium">{format(shiftStart, 'EEE, MMM d')}</span>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <Clock className="h-4 w-4 text-muted-foreground" />
          <span>
            {format(shiftStart, 'h:mm a')} - {format(shiftEnd, 'h:mm a')}
          </span>
          <span className="text-muted-foreground">({duration.toFixed(1)}h)</span>
        </div>

        {/* Reason */}
        {trade.reason && (
          <div className="rounded-md bg-muted/50 p-2 text-xs text-muted-foreground">
            <span className="font-medium">Reason:</span> {trade.reason}
          </div>
        )}

        {/* Action Button */}
        <Button
          onClick={() => onAccept(trade)}
          disabled={disabled || showConflict}
          className="w-full"
          variant={showConflict ? 'outline' : 'default'}
        >
          {showConflict ? (
            <>
              <AlertTriangle className="mr-2 h-4 w-4" />
              Schedule Conflict
            </>
          ) : (
            <>
              <ArrowRightLeft className="mr-2 h-4 w-4" />
              Accept Shift
            </>
          )}
        </Button>
      </CardContent>
    </Card>
  );
};
