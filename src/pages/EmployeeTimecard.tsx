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
import { TimePunch } from '@/types/timeTracking';

// Calculate worked hours for a single day's punches
const calculateDayHours = (punches: TimePunch[]) => {
  let totalMinutes = 0;
  let breakMinutes = 0;
  let clockInTime: Date | null = null;
  let breakStartTime: Date | null = null;

  const sortedPunches = [...punches].sort(
    (a, b) => new Date(a.punch_time).getTime() - new Date(b.punch_time).getTime()
  );

  for (const punch of sortedPunches) {
    const punchTime = new Date(punch.punch_time);

    switch (punch.punch_type) {
      case 'clock_in':
        clockInTime = punchTime;
        break;
      case 'clock_out':
        if (clockInTime) {
          totalMinutes += (punchTime.getTime() - clockInTime.getTime()) / (1000 * 60);
          clockInTime = null;
        }
        break;
      case 'break_start':
        breakStartTime = punchTime;
        break;
      case 'break_end':
        if (breakStartTime) {
          breakMinutes += (punchTime.getTime() - breakStartTime.getTime()) / (1000 * 60);
          breakStartTime = null;
        }
        break;
    }
  }

  const netMinutes = Math.max(totalMinutes - breakMinutes, 0);
  return {
    totalHours: totalMinutes / 60,
    breakHours: breakMinutes / 60,
    netHours: netMinutes / 60,
  };
};

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

  const { punches, loading: punchesLoading } = useTimePunches(
    restaurantId,
    currentEmployee?.id,
    startDate
  );

  // Filter punches to the current period
  const periodPunches = useMemo(() => {
    return punches.filter((punch) => {
      const punchDate = new Date(punch.punch_time);
      return punchDate >= startDate && punchDate <= endDate;
    });
  }, [punches, startDate, endDate]);

  // Group punches by day
  const punchesByDay = useMemo(() => {
    const grouped = new Map<string, TimePunch[]>();
    weekDays.forEach((day) => {
      const dayKey = format(day, 'yyyy-MM-dd');
      grouped.set(dayKey, []);
    });

    periodPunches.forEach((punch) => {
      const punchDate = parseISO(punch.punch_time);
      const dayKey = format(punchDate, 'yyyy-MM-dd');
      if (grouped.has(dayKey)) {
        grouped.get(dayKey)!.push(punch);
      }
    });

    return grouped;
  }, [periodPunches, weekDays]);

  // Calculate weekly totals
  const weeklyTotals = useMemo(() => {
    let totalHours = 0;
    let breakHours = 0;
    let netHours = 0;

    punchesByDay.forEach((dayPunches) => {
      const dayStats = calculateDayHours(dayPunches);
      totalHours += dayStats.totalHours;
      breakHours += dayStats.breakHours;
      netHours += dayStats.netHours;
    });

    // Calculate overtime (over 40 hours)
    const regularHours = Math.min(netHours, 40);
    const overtimeHours = Math.max(netHours - 40, 0);

    return { totalHours, breakHours, netHours, regularHours, overtimeHours };
  }, [punchesByDay]);

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
      <div className="grid gap-4 md:grid-cols-4">
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
            <div className="text-2xl font-bold">{formatHours(weeklyTotals.regularHours)}</div>
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
                <span className="text-amber-600">{formatHours(weeklyTotals.overtimeHours)}</span>
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
            <div className="text-2xl font-bold">{formatHours(weeklyTotals.breakHours)}</div>
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
                const dayStats = calculateDayHours(dayPunches);
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
                        <div className="font-medium">{formatHours(dayStats.netHours)}</div>
                        {dayStats.breakHours > 0 && (
                          <div className="text-xs text-muted-foreground">
                            {formatHours(dayStats.breakHours)} break
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
      <Alert className="bg-primary/5 border-primary/20">
        <AlertCircle className="h-4 w-4 text-primary" />
        <AlertDescription>
          <strong>Note:</strong> If you notice any discrepancies in your timecard, please contact
          your manager for corrections. Only approved punches are included in payroll.
        </AlertDescription>
      </Alert>
    </div>
  );
};

export default EmployeeTimecard;
