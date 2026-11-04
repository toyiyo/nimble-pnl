import { useState } from 'react';
import { Calendar } from 'lucide-react';
import { DateRangePicker } from '@/components/ui/date-range-picker';
import { customPeriodLabel, presetPeriod, PRESET_PERIOD_TYPES } from '@/lib/periodUrlState';

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

  // presetPeriod is shared with the URL codec, so a decoded link matches a tab click.
  const periods: Period[] = PRESET_PERIOD_TYPES.map((type) => presetPeriod(type, today));

  const handlePeriodSelect = (period: Period) => {
    onPeriodChange(period);
    setShowDatePicker(false);
  };

  const handleCustomDateRange = (range: { from: Date; to: Date } | undefined) => {
    if (range?.from && range?.to) {
      onPeriodChange({
        type: 'custom',
        from: range.from,
        to: range.to,
        label: customPeriodLabel(range.from, range.to),
      });
      setShowDatePicker(false);
    }
  };

  const getDayCount = () => {
    const from = selectedPeriod.from;
    const to = selectedPeriod.to;

    if (to < from) return 0;

    const fromUTC = Date.UTC(from.getFullYear(), from.getMonth(), from.getDate());
    const toUTC = Date.UTC(to.getFullYear(), to.getMonth(), to.getDate());

    const diffDays = Math.floor((toUTC - fromUTC) / (1000 * 60 * 60 * 24));
    return diffDays + 1;
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-[17px] font-semibold text-foreground">Performance Period</h2>
        <span className="text-[12px] text-muted-foreground">
          {getDayCount()} {getDayCount() === 1 ? 'day' : 'days'}
        </span>
      </div>

      {/* Apple-style underline tabs */}
      <div className="flex items-center gap-0 border-b border-border/40 overflow-x-auto">
        {periods.map((period) => (
          <button
            key={period.type}
            onClick={() => handlePeriodSelect(period)}
            className={`relative px-3 py-2.5 text-[13px] font-medium transition-colors whitespace-nowrap ${
              selectedPeriod.type === period.type
                ? 'text-foreground'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {period.label}
            {selectedPeriod.type === period.type && (
              <div className="absolute bottom-0 left-0 right-0 h-[2px] bg-foreground" />
            )}
          </button>
        ))}

        {showDatePicker ? (
          <div className="flex items-center gap-2 px-3">
            <DateRangePicker
              from={selectedPeriod.type === 'custom' ? selectedPeriod.from : undefined}
              to={selectedPeriod.type === 'custom' ? selectedPeriod.to : undefined}
              onSelect={handleCustomDateRange}
            />
            <button
              onClick={() => setShowDatePicker(false)}
              className="text-[13px] text-muted-foreground hover:text-foreground transition-colors"
            >
              Cancel
            </button>
          </div>
        ) : (
          <button
            onClick={() => setShowDatePicker(true)}
            className={`relative px-3 py-2.5 text-[13px] font-medium transition-colors whitespace-nowrap flex items-center gap-1.5 ${
              selectedPeriod.type === 'custom'
                ? 'text-foreground'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <Calendar className="h-3.5 w-3.5" aria-hidden="true" />
            Custom
            {selectedPeriod.type === 'custom' && (
              <div className="absolute bottom-0 left-0 right-0 h-[2px] bg-foreground" />
            )}
          </button>
        )}
      </div>
    </div>
  );
}
