import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Calendar } from 'lucide-react';
import { DateRangePicker } from '@/components/ui/date-range-picker';
import { Badge } from '@/components/ui/badge';
import { startOfWeek, endOfDay, startOfMonth, startOfQuarter, subDays, format } from 'date-fns';

export type PeriodType = 'today' | 'week' | 'month' | 'quarter' | 'last30' | 'last90' | 'custom';

export interface Period {
  type: PeriodType;
  from: Date;
  to: Date;
  label: string;
}

interface PeriodSelectorProps {
  selectedPeriod: Period;
  onPeriodChange: (period: Period) => void;
}

export function PeriodSelector({ selectedPeriod, onPeriodChange }: PeriodSelectorProps) {
  const [showDatePicker, setShowDatePicker] = useState(false);

  const today = new Date();
  const endToday = endOfDay(today);

  const periods: Array<{ type: PeriodType; label: string; from: Date; to: Date }> = [
    { type: 'today', label: 'Today', from: today, to: endToday },
    { type: 'week', label: 'This Week', from: startOfWeek(today, { weekStartsOn: 1 }), to: endToday },
    { type: 'month', label: 'This Month', from: startOfMonth(today), to: endToday },
    { type: 'quarter', label: 'This Quarter', from: startOfQuarter(today), to: endToday },
    { type: 'last30', label: 'Last 30 Days', from: subDays(today, 30), to: endToday },
    { type: 'last90', label: 'Last 90 Days', from: subDays(today, 90), to: endToday },
  ];

  const handlePeriodSelect = (period: typeof periods[0]) => {
    onPeriodChange({
      type: period.type,
      from: period.from,
      to: period.to,
      label: period.label,
    });
    setShowDatePicker(false);
  };

  const handleCustomDateRange = (range: { from: Date; to: Date } | undefined) => {
    if (range?.from && range?.to) {
      onPeriodChange({
        type: 'custom',
        from: range.from,
        to: range.to,
        label: `${format(range.from, 'MMM d')} - ${format(range.to, 'MMM d, yyyy')}`,
      });
      setShowDatePicker(false);
    }
  };

  const getDayCount = () => {
    const diffTime = Math.abs(selectedPeriod.to.getTime() - selectedPeriod.from.getTime());
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    return diffDays + 1;
  };

  return (
    <div className="space-y-4 p-6 rounded-2xl bg-gradient-to-br from-primary/5 via-accent/5 to-transparent border border-border/50 animate-fade-in">
      <div className="flex items-center gap-2 mb-3">
        <div className="h-1 w-8 bg-gradient-to-r from-primary to-primary/50 rounded-full" />
        <h2 className="text-lg font-semibold">Performance Period</h2>
      </div>
      
      <div className="flex flex-wrap gap-2">
        {periods.map((period) => (
          <Button
            key={period.type}
            variant={selectedPeriod.type === period.type ? 'default' : 'outline'}
            size="sm"
            onClick={() => handlePeriodSelect(period)}
            className="transition-all"
          >
            {period.label}
          </Button>
        ))}
        
        {showDatePicker ? (
          <div className="flex items-center gap-2">
            <DateRangePicker
              from={selectedPeriod.type === 'custom' ? selectedPeriod.from : undefined}
              to={selectedPeriod.type === 'custom' ? selectedPeriod.to : undefined}
              onSelect={handleCustomDateRange}
            />
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowDatePicker(false)}
            >
              Cancel
            </Button>
          </div>
        ) : (
          <Button
            variant={selectedPeriod.type === 'custom' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setShowDatePicker(true)}
            className="transition-all"
          >
            <Calendar className="h-4 w-4 mr-2" aria-hidden="true" />
            Custom Range
          </Button>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3 text-sm">
        <Badge variant="secondary" className="gap-2 px-3 py-1.5">
          <Calendar className="h-3.5 w-3.5" aria-hidden="true" />
          {selectedPeriod.label}
        </Badge>
        <span className="text-muted-foreground">
          {getDayCount()} {getDayCount() === 1 ? 'day' : 'days'}
        </span>
      </div>
    </div>
  );
}
