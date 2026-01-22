import { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { formatCurrencyFromCents } from '@/utils/tipPooling';
import { format, eachDayOfInterval, isSameDay, isToday } from 'date-fns';
import { Plus, Check, FileText, Lock } from 'lucide-react';
import type { TipSplitWithItems } from '@/hooks/useTipSplits';
import { cn } from '@/lib/utils';

interface TipPeriodTimelineProps {
  startDate: Date;
  endDate: Date;
  splits: TipSplitWithItems[] | undefined;
  onDayClick: (date: Date) => void;
  isLoading: boolean;
}

interface DayData {
  date: Date;
  split: TipSplitWithItems | null;
  status: 'empty' | 'draft' | 'approved' | 'archived';
  totalCents: number;
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
}: TipPeriodTimelineProps) {
  const days = useMemo((): DayData[] => {
    const interval = eachDayOfInterval({ start: startDate, end: endDate });

    return interval.map(date => {
      const dateStr = format(date, 'yyyy-MM-dd');
      const split = splits?.find(s => s.split_date === dateStr) || null;

      return {
        date,
        split,
        status: split ? (split.status as 'draft' | 'approved' | 'archived') : 'empty',
        totalCents: split?.total_amount || 0,
      };
    });
  }, [startDate, endDate, splits]);

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
              <button
                key={day.date.toISOString()}
                onClick={() => onDayClick(day.date)}
                className={cn(
                  'flex flex-col items-center p-3 rounded-lg border transition-colors',
                  'focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2',
                  getStatusStyles(day.status, currentDay)
                )}
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
              </button>
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
        </div>
      </CardContent>
    </Card>
  );
}
