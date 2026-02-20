import { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { formatCurrencyFromCents } from '@/utils/tipPooling';
import { format, eachDayOfInterval, isToday } from 'date-fns';
import { Plus, Check, FileText, Lock, Banknote } from 'lucide-react';
import type { TipSplitWithItems } from '@/hooks/useTipSplits';
import type { TipPayoutWithEmployee } from '@/hooks/useTipPayouts';
import { cn } from '@/lib/utils';

interface TipPeriodTimelineProps {
  startDate: Date;
  endDate: Date;
  splits: TipSplitWithItems[] | undefined;
  onDayClick: (date: Date) => void;
  isLoading: boolean;
  payouts?: TipPayoutWithEmployee[];
  onRecordPayout?: (split: TipSplitWithItems) => void;
}

interface DayData {
  date: Date;
  split: TipSplitWithItems | null;
  status: 'empty' | 'draft' | 'approved' | 'archived';
  totalCents: number;
  payoutStatus: 'none' | 'partial' | 'full';
  payoutTotalCents: number;
}

/**
 * TipPeriodTimeline - Horizontal calendar strip showing period days
 * Each day is a clickable cell showing amount and status
 */
export function TipPeriodTimeline({
  startDate,
  endDate,
  splits,
  onDayClick,
  isLoading,
  payouts,
  onRecordPayout,
}: TipPeriodTimelineProps) {
  const days = useMemo((): DayData[] => {
    const interval = eachDayOfInterval({ start: startDate, end: endDate });

    return interval.map(date => {
      const dateStr = format(date, 'yyyy-MM-dd');
      const split = splits?.find(s => s.split_date === dateStr) || null;
      const totalCents = split?.total_amount || 0;

      // Compute payout status for this day
      let payoutStatus: DayData['payoutStatus'] = 'none';
      let payoutTotalCents = 0;

      if (split && payouts) {
        const dayPayouts = payouts.filter(p => p.tip_split_id === split.id);
        payoutTotalCents = dayPayouts.reduce((sum, p) => sum + p.amount, 0);

        if (payoutTotalCents > 0) {
          payoutStatus = payoutTotalCents >= totalCents ? 'full' : 'partial';
        }
      }

      return {
        date,
        split,
        status: split ? (split.status as 'draft' | 'approved' | 'archived') : 'empty',
        totalCents,
        payoutStatus,
        payoutTotalCents,
      };
    });
  }, [startDate, endDate, splits, payouts]);

  const getStatusStyles = (status: DayData['status'], isCurrentDay: boolean) => {
    const base = isCurrentDay
      ? 'ring-2 ring-primary ring-offset-2'
      : '';

    switch (status) {
      case 'approved':
        return cn(base, 'bg-green-500/10 border-green-500/30 hover:bg-green-500/20');
      case 'archived':
        return cn(base, 'bg-muted border-muted-foreground/20 hover:bg-muted/80');
      case 'draft':
        return cn(base, 'bg-yellow-500/10 border-yellow-500/30 hover:bg-yellow-500/20');
      default:
        return cn(base, 'bg-background border-dashed hover:bg-muted/50');
    }
  };

  const getStatusIcon = (status: DayData['status']) => {
    switch (status) {
      case 'approved':
        return <Check className="h-3 w-3 text-green-600" />;
      case 'archived':
        return <Lock className="h-3 w-3 text-muted-foreground" />;
      case 'draft':
        return <FileText className="h-3 w-3 text-yellow-600" />;
      default:
        return <Plus className="h-3 w-3 text-muted-foreground" />;
    }
  };

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Period Timeline</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-7 gap-2">
            {Array.from({ length: 7 }).map((_, i) => (
              <Skeleton key={i} className="h-24" />
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-lg">Period Timeline</CardTitle>
        <p className="text-sm text-muted-foreground">
          Click a day to enter or edit tips
        </p>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-7 gap-2">
          {days.map((day) => {
            const currentDay = isToday(day.date);

            return (
              <div
                key={day.date.toISOString()}
                className={cn(
                  'flex flex-col items-center p-3 rounded-lg border transition-colors',
                  getStatusStyles(day.status, currentDay)
                )}
              >
                {/* Clickable day content */}
                <button
                  type="button"
                  onClick={() => onDayClick(day.date)}
                  className="flex flex-col items-center w-full focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 rounded-md"
                  aria-label={`${format(day.date, 'EEEE, MMMM d')} - ${
                    day.status === 'empty'
                      ? 'No tips entered'
                      : `${formatCurrencyFromCents(day.totalCents)} (${day.status})`
                  }`}
                >
                  {/* Day name */}
                  <span className="text-xs text-muted-foreground font-medium">
                    {format(day.date, 'EEE')}
                  </span>

                  {/* Date */}
                  <span className={cn(
                    'text-lg font-semibold',
                    currentDay && 'text-primary'
                  )}>
                    {format(day.date, 'd')}
                  </span>

                  {/* Status indicator */}
                  <div className="flex items-center gap-1 mt-1">
                    {getStatusIcon(day.status)}
                  </div>

                  {/* Amount or empty state */}
                  {day.status !== 'empty' ? (
                    <Badge
                      variant="outline"
                      className={cn(
                        'mt-2 text-xs',
                        day.status === 'approved' && 'border-green-500/50 text-green-700',
                        day.status === 'archived' && 'border-muted-foreground/50 text-muted-foreground',
                        day.status === 'draft' && 'border-yellow-500/50 text-yellow-700'
                      )}
                    >
                      {formatCurrencyFromCents(day.totalCents)}
                    </Badge>
                  ) : (
                    <span className="mt-2 text-xs text-muted-foreground">
                      Add tips
                    </span>
                  )}

                  {/* Payout status badges */}
                  {(day.status === 'approved' || day.status === 'archived') && (
                    <>
                      {day.payoutStatus === 'full' && (
                        <Badge className="mt-1 text-[10px] bg-emerald-500/20 text-emerald-700 border-emerald-500/30 hover:bg-emerald-500/20">
                          Paid
                        </Badge>
                      )}
                      {day.payoutStatus === 'partial' && (
                        <Badge className="mt-1 text-[10px] bg-amber-500/20 text-amber-700 border-amber-500/30 hover:bg-amber-500/20">
                          Partial
                        </Badge>
                      )}
                    </>
                  )}
                </button>

                {/* Pay out action — sibling button, not nested */}
                {(day.status === 'approved' || day.status === 'archived') &&
                  onRecordPayout && day.split && day.payoutStatus !== 'full' && (
                  <button
                    type="button"
                    onClick={() => onRecordPayout(day.split!)}
                    className="mt-1 flex items-center gap-0.5 text-[10px] font-medium text-muted-foreground hover:text-foreground transition-colors"
                    aria-label={`Record payout for ${format(day.date, 'MMMM d')}`}
                  >
                    <Banknote className="h-3 w-3" />
                    Pay out
                  </button>
                )}
              </div>
            );
          })}
        </div>

        {/* Legend */}
        <div className="flex flex-wrap gap-4 mt-4 pt-4 border-t">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <div className="w-3 h-3 rounded border border-dashed bg-background" />
            <span>No entry</span>
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <div className="w-3 h-3 rounded bg-yellow-500/20 border border-yellow-500/30" />
            <span>Draft</span>
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <div className="w-3 h-3 rounded bg-green-500/20 border border-green-500/30" />
            <span>Approved</span>
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <div className="w-3 h-3 rounded bg-muted border border-muted-foreground/20" />
            <span>Locked</span>
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <div className="w-3 h-3 rounded bg-emerald-500/20 border border-emerald-500/30" />
            <span>Paid Out</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
