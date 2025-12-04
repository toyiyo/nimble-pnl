import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Calendar, ChevronLeft, ChevronRight } from 'lucide-react';
import { format } from 'date-fns';

export type PeriodType = 'current_week' | 'last_week' | 'last_2_weeks' | 'custom';

interface PeriodSelectorProps {
  periodType: PeriodType;
  onPeriodTypeChange: (value: PeriodType) => void;
  startDate: Date;
  endDate: Date;
  onPrevious: () => void;
  onNext: () => void;
  onToday: () => void;
  /** Label shown before the dropdown, defaults to "Period:" */
  label?: string;
  /** Whether to show the "Last 2 Weeks" option */
  showLast2Weeks?: boolean;
}

/**
 * Reusable period/week selector with navigation buttons
 */
export const PeriodSelector = ({
  periodType,
  onPeriodTypeChange,
  startDate,
  endDate,
  onPrevious,
  onNext,
  onToday,
  label = 'Period:',
  showLast2Weeks = false,
}: PeriodSelectorProps) => {
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="flex items-center gap-4 flex-wrap">
          <div className="flex items-center gap-2">
            <Calendar className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
            <span className="font-medium">{label}</span>
          </div>
          <Select
            value={periodType}
            onValueChange={(value) => onPeriodTypeChange(value as PeriodType)}
          >
            <SelectTrigger className="w-[180px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="current_week">Current Week</SelectItem>
              <SelectItem value="last_week">Last Week</SelectItem>
              {showLast2Weeks && (
                <SelectItem value="last_2_weeks">Last 2 Weeks</SelectItem>
              )}
              <SelectItem value="custom">Custom {showLast2Weeks ? 'Period' : 'Week'}</SelectItem>
            </SelectContent>
          </Select>

          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={onPrevious}
              aria-label="Previous period"
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button variant="outline" size="sm" onClick={onToday}>
              Today
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={onNext}
              aria-label="Next period"
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>

          <Badge variant="outline" className="px-3 py-1">
            {format(startDate, 'MMM d')} - {format(endDate, 'MMM d, yyyy')}
          </Badge>
        </div>
      </CardContent>
    </Card>
  );
};
