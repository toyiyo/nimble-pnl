import { useMemo } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { useRestaurantContext } from '@/contexts/RestaurantContext';
import { useCurrentEmployee } from '@/hooks/useCurrentEmployee';
import { useTimePunches } from '@/hooks/useTimePunches';
import { usePeriodNavigation } from '@/hooks/usePeriodNavigation';
import {
  EmployeePageHeader,
  NoRestaurantState,
  EmployeePageSkeleton,
  EmployeeNotLinkedState,
  EmployeeInfoAlert,
  PeriodSelector,
  PeriodType,
} from '@/components/employee';
import {
  Clock,
  LogIn,
  LogOut,
  Coffee,
  PlayCircle,
  FileText,
} from 'lucide-react';
import {
  format,
  eachDayOfInterval,
  isSameDay,
  parseISO,
} from 'date-fns';
import { businessDayPunchFetchRange } from '@/utils/punchWindow';
import { hoursByClockInDay, punchesByBusinessDay } from '@/utils/timecardHours';

const formatHoursMinutes = (hours: number) => {
  const h = Math.floor(hours);
  const m = Math.round((hours - h) * 60);
  return `${h}h ${m}m`;
};

const getPunchIcon = (punchType: string) => {
  switch (punchType) {
    case 'clock_in':
      return <LogIn className="h-4 w-4 text-green-600" aria-hidden="true" />;
    case 'clock_out':
      return <LogOut className="h-4 w-4 text-red-600" aria-hidden="true" />;
    case 'break_start':
      return <Coffee className="h-4 w-4 text-yellow-600" aria-hidden="true" />;
    case 'break_end':
      return <PlayCircle className="h-4 w-4 text-blue-600" aria-hidden="true" />;
    default:
      return <Clock className="h-4 w-4" aria-hidden="true" />;
  }
};

const EmployeeTimecard = () => {
  const { selectedRestaurant } = useRestaurantContext();
  const restaurantId = selectedRestaurant?.restaurant_id || null;

  const {
    periodType,
    setPeriodType,
    startDate,
    endDate,
    handlePreviousWeek,
    handleNextWeek,
    handleToday,
  } = usePeriodNavigation();

  const { currentEmployee, loading: employeeLoading } = useCurrentEmployee(restaurantId);

  const weekDays = eachDayOfInterval({ start: startDate, end: endDate });

  // Destructured to primitives so they can go into the dep arrays individually;
  // the config object is constructed inline and is a new reference every render.
  const tz = selectedRestaurant?.restaurant?.timezone;
  const cutoffHour = selectedRestaurant?.restaurant?.business_day_start_hour;

  // Fetch punches spanning the BUSINESS days [startDate, endDate] name, plus
  // ±18h so overnight shifts that straddle a boundary are paired whole.
  // hoursByClockInDay and punchesByBusinessDay then attribute each shift back
  // to a displayed day by clock-in business day.
  //
  // Anchored on the business-day boundary instants, not a fixed buffer around
  // the bounds: the bounds are day tokens in the VIEWER's zone while the
  // business day resolves in the RESTAURANT's, and the two can be 26 hours
  // apart. An 18h buffer stops short of the first or last business day for a
  // far-apart viewer, and the shift it misses does not reappear on the
  // neighbouring week either -- it just vanishes from the timecard.
  const { fetchStart, fetchEnd } = businessDayPunchFetchRange(
    startDate, endDate, { tz, cutoffHour },
  );
  const { punches, loading: punchesLoading } = useTimePunches(
    restaurantId,
    currentEmployee?.id,
    fetchStart,
    fetchEnd
  );

  // Group punches by the business day of the SHIFT they belong to, computed
  // from the BUFFERED punches. Both the window clip and the per-day bucketing
  // happen inside punchesByBusinessDay: it seeds only `weekDays`, so a shift
  // outside the displayed range is dropped there. Filtering by raw instant
  // first (as this used to) would discard the 1 AM punches of a shift that the
  // cutoff assigns to a day still on screen.
  const punchesByDay = useMemo(
    () => punchesByBusinessDay(punches, weekDays, { tz, cutoffHour }),
    [punches, weekDays, tz, cutoffHour]
  );

  // Hours attributed by clock-in business day, from the same buffered punches
  // so overnight shifts pair whole before being bucketed. Same framing as
  // punchesByDay above, so a row's punches and its hours always agree.
  const dayHours = useMemo(
    () => hoursByClockInDay(punches, weekDays, { tz, cutoffHour }),
    [punches, weekDays, tz, cutoffHour]
  );

  // Calculate weekly totals
  const weeklyTotals = useMemo(() => {
    let totalHours = 0;
    let breakHours = 0;
    let netHours = 0;

    dayHours.forEach((d) => {
      totalHours += d.totalHours;
      breakHours += d.breakHours;
      netHours += d.netHours;
    });

    // Calculate overtime (over 40 hours)
    const regularHours = Math.min(netHours, 40);
    const overtimeHours = Math.max(netHours - 40, 0);

    return { totalHours, breakHours, netHours, regularHours, overtimeHours };
  }, [dayHours]);

  if (!restaurantId) {
    return <NoRestaurantState />;
  }

  if (employeeLoading) {
    return <EmployeePageSkeleton />;
  }

  if (!currentEmployee) {
    return <EmployeeNotLinkedState />;
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <EmployeePageHeader
        icon={FileText}
        title="My Timecard"
        subtitle={`${currentEmployee.name} • ${currentEmployee.position}`}
      />

      {/* Period Selector */}
      <PeriodSelector
        periodType={periodType}
        onPeriodTypeChange={setPeriodType}
        startDate={startDate}
        endDate={endDate}
        onPrevious={handlePreviousWeek}
        onNext={handleNextWeek}
        onToday={handleToday}
      />

      {/* Weekly Summary */}
      <div className="grid gap-4 grid-cols-2 md:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center gap-2">
              <Clock className="h-4 w-4" aria-hidden="true" />
              Net Hours
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatHoursMinutes(weeklyTotals.netHours)}</div>
            <p className="text-xs text-muted-foreground">After breaks</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center gap-2">
              <Clock className="h-4 w-4" />
              Regular Hours
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatHoursMinutes(weeklyTotals.regularHours)}</div>
            <p className="text-xs text-muted-foreground">Up to 40 hrs/week</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center gap-2">
              <Clock className="h-4 w-4" />
              Overtime
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {weeklyTotals.overtimeHours > 0 ? (
                <span className="text-amber-600">{formatHoursMinutes(weeklyTotals.overtimeHours)}</span>
              ) : (
                '0h 0m'
              )}
            </div>
            <p className="text-xs text-muted-foreground">Over 40 hrs/week</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center gap-2">
              <Coffee className="h-4 w-4" />
              Break Time
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatHoursMinutes(weeklyTotals.breakHours)}</div>
            <p className="text-xs text-muted-foreground">Total breaks taken</p>
          </CardContent>
        </Card>
      </div>

      {/* Daily Breakdown */}
      <Card>
        <CardHeader>
          <CardTitle>Daily Breakdown</CardTitle>
          <CardDescription>Your time punches for each day</CardDescription>
        </CardHeader>
        <CardContent>
          {punchesLoading ? (
            <div className="space-y-4">
              {[...Array(7)].map((_, i) => (
                <Skeleton key={i} className="h-20 w-full" />
              ))}
            </div>
          ) : (
            <div className="space-y-4">
              {weekDays.map((day) => {
                const dayKey = format(day, 'yyyy-MM-dd');
                const dayPunches = punchesByDay.get(dayKey) || [];
                const dayStats = dayHours.get(dayKey) ?? { totalHours: 0, breakHours: 0, netHours: 0 };
                const isToday = isSameDay(day, new Date());

                return (
                  <div
                    key={dayKey}
                    className={`p-4 rounded-lg border ${
                      isToday ? 'bg-primary/5 border-primary/20' : 'bg-card'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{format(day, 'EEEE')}</span>
                        <span className="text-muted-foreground">{format(day, 'MMM d')}</span>
                        {isToday && (
                          <Badge variant="default" className="text-xs">
                            Today
                          </Badge>
                        )}
                      </div>
                      <div className="text-right">
                        <div className="font-medium">{formatHoursMinutes(dayStats.netHours)}</div>
                        {dayStats.breakHours > 0 && (
                          <div className="text-xs text-muted-foreground">
                            {formatHoursMinutes(dayStats.breakHours)} break
                          </div>
                        )}
                      </div>
                    </div>

                    {dayPunches.length === 0 ? (
                      <p className="text-sm text-muted-foreground">No punches recorded</p>
                    ) : (
                      <div className="flex flex-wrap gap-3">
                        {dayPunches
                          .sort(
                            (a, b) =>
                              new Date(a.punch_time).getTime() - new Date(b.punch_time).getTime()
                          )
                          .map((punch) => (
                            <div
                              key={punch.id}
                              className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-muted text-sm"
                            >
                              {getPunchIcon(punch.punch_type)}
                              <span>
                                {format(parseISO(punch.punch_time), 'h:mm a')}
                              </span>
                            </div>
                          ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Info Alert */}
      <EmployeeInfoAlert>
        <strong>Note:</strong> If you notice any discrepancies in your timecard, please contact
        your manager for corrections. Only approved punches are included in payroll.
      </EmployeeInfoAlert>
    </div>
  );
};

export default EmployeeTimecard;
