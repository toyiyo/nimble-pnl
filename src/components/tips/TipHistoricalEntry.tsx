import { useState } from 'react';
import { format, subDays } from 'date-fns';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Calendar, Info } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';

interface TipHistoricalEntryProps {
  onDateSelected: (date: Date) => void;
  currentDate: Date;
}

export const TipHistoricalEntry = ({ onDateSelected, currentDate }: TipHistoricalEntryProps) => {
  const [selectedDate, setSelectedDate] = useState(format(currentDate, 'yyyy-MM-dd'));
  const [showPicker, setShowPicker] = useState(false);

  const today = new Date();
  const maxPastDays = 30;
  const minDate = format(subDays(today, maxPastDays), 'yyyy-MM-dd');
  const maxDate = format(today, 'yyyy-MM-dd');

  const handleDateChange = (dateStr: string) => {
    setSelectedDate(dateStr);
    const parsedDate = new Date(dateStr + 'T12:00:00'); // Noon to avoid timezone issues
    onDateSelected(parsedDate);
    setShowPicker(false);
  };

  const isToday = selectedDate === format(today, 'yyyy-MM-dd');
  const isPast = selectedDate < format(today, 'yyyy-MM-dd');

  return (
    <Card className="bg-gradient-to-br from-primary/5 via-accent/5 to-transparent border-primary/10">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Calendar className="h-6 w-6 text-primary" />
            <div>
              <CardTitle>Tip Entry Date</CardTitle>
              <CardDescription>
                {isToday ? 'Entering for today' : 'Entering historical tips'}
              </CardDescription>
            </div>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowPicker(!showPicker)}
            aria-label="Change date"
          >
            {isToday ? 'Change date' : 'Today'}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="p-4 bg-background rounded-lg border">
          <p className="text-2xl font-bold">
            {format(new Date(selectedDate + 'T12:00:00'), 'EEEE, MMMM d, yyyy')}
          </p>
          {isPast && (
            <p className="text-sm text-amber-600 mt-1 flex items-center gap-1">
              <Info className="h-3 w-3" />
              Historical entry (past date)
            </p>
          )}
        </div>

        {showPicker && (
          <div className="space-y-3 pt-3 border-t">
            <Label htmlFor="date-picker">Select date</Label>
            <Input
              id="date-picker"
              type="date"
              value={selectedDate}
              onChange={(e) => handleDateChange(e.target.value)}
              min={minDate}
              max={maxDate}
              aria-label="Select tip entry date"
            />
            <Alert>
              <Info className="h-4 w-4" />
              <AlertDescription>
                You can enter tips for the past {maxPastDays} days. This is useful when you missed a daily entry.
              </AlertDescription>
            </Alert>
          </div>
        )}

        {isPast && !showPicker && (
          <Alert className="bg-amber-500/10 border-amber-500/20">
            <Info className="h-4 w-4 text-amber-600" />
            <AlertDescription className="text-amber-800">
              Tip split will be recorded for <strong>{format(new Date(selectedDate + 'T12:00:00'), 'MMM d, yyyy')}</strong>, 
              not today. Employees will see this in their historical tips.
            </AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  );
};
