import { useState, useMemo } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useRestaurantContext } from '@/contexts/RestaurantContext';
import { useCurrentEmployee } from '@/hooks/useCurrentEmployee';
import { useTimePunches } from '@/hooks/useTimePunches';
import {
  Clock,
  Calendar,
  ChevronLeft,
  ChevronRight,
  AlertCircle,
  LogIn,
  LogOut,
  Coffee,
  PlayCircle,
  FileText,
} from 'lucide-react';
import {
  format,
  startOfWeek,
  endOfWeek,
  subWeeks,
  addWeeks,
  eachDayOfInterval,
  isSameDay,
  parseISO,
} from 'date-fns';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { TimePunch } from '@/types/timeTracking';

type PeriodType = 'current_week' | 'last_week' | 'custom';

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

const formatHours = (hours: number) => {
  const h = Math.floor(hours);
  const m = Math.round((hours - h) * 60);
  return `${h}h ${m}m`;
};

const getPunchIcon = (punchType: string) => {
  switch (punchType) {
    case 'clock_in':
      return <LogIn className="h-4 w-4 text-green-600" />;
    case 'clock_out':
      return <LogOut className="h-4 w-4 text-red-600" />;
    case 'break_start':
      return <Coffee className="h-4 w-4 text-yellow-600" />;
    case 'break_end':
      return <PlayCircle className="h-4 w-4 text-blue-600" />;
    default:
      return <Clock className="h-4 w-4" />;
  }
};

const EmployeeTimecard = () => {
  const { selectedRestaurant } = useRestaurantContext();
  const restaurantId = selectedRestaurant?.restaurant_id || null;

  const [periodType, setPeriodType] = useState<PeriodType>('current_week');
  const [currentWeekStart, setCurrentWeekStart] = useState(
    startOfWeek(new Date(), { weekStartsOn: 0 })
  );

  const { currentEmployee, loading: employeeLoading } = useCurrentEmployee(restaurantId);

  // Get date range based on period type
  const getDateRange = () => {
    const today = new Date();
    switch (periodType) {
      case 'current_week':
        return {
          start: startOfWeek(today, { weekStartsOn: 0 }),
          end: endOfWeek(today, { weekStartsOn: 0 }),
        };
      case 'last_week': {
        const lastWeek = subWeeks(today, 1);
        return {
          start: startOfWeek(lastWeek, { weekStartsOn: 0 }),
          end: endOfWeek(lastWeek, { weekStartsOn: 0 }),
        };
      }
      case 'custom':
        return {
          start: currentWeekStart,
          end: endOfWeek(currentWeekStart, { weekStartsOn: 0 }),
        };
      default:
        return {
          start: startOfWeek(today, { weekStartsOn: 0 }),
          end: endOfWeek(today, { weekStartsOn: 0 }),
        };
    }
  };

  const { start, end } = getDateRange();
  const weekDays = eachDayOfInterval({ start, end });

  const { punches, loading: punchesLoading } = useTimePunches(
    restaurantId,
    currentEmployee?.id,
    start
  );

  // Filter punches to the current period
  const periodPunches = useMemo(() => {
    return punches.filter((punch) => {
      const punchDate = new Date(punch.punch_time);
      return punchDate >= start && punchDate <= end;
    });
  }, [punches, start, end]);

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

  const handlePreviousWeek = () => {
    setCurrentWeekStart(subWeeks(currentWeekStart, 1));
    setPeriodType('custom');
  };

  const handleNextWeek = () => {
    setCurrentWeekStart(addWeeks(currentWeekStart, 1));
    setPeriodType('custom');
  };

  const handleToday = () => {
    setCurrentWeekStart(startOfWeek(new Date(), { weekStartsOn: 0 }));
    setPeriodType('current_week');
  };

  if (!restaurantId) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <p className="text-muted-foreground">Please select a restaurant.</p>
      </div>
    );
  }

  if (employeeLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!currentEmployee) {
    return (
      <Card className="bg-gradient-to-br from-destructive/5 via-destructive/5 to-transparent border-destructive/10">
        <CardHeader>
          <div className="flex items-center gap-3">
            <AlertCircle className="h-6 w-6 text-destructive" />
            <div>
              <CardTitle className="text-2xl">Access Required</CardTitle>
              <CardDescription>
                Your account is not linked to an employee record.
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground">
            Please contact your manager to link your account to your employee profile.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <Card className="bg-gradient-to-br from-primary/5 via-accent/5 to-transparent border-primary/10">
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-primary/10">
              <FileText className="h-6 w-6 text-primary" />
            </div>
            <div>
              <CardTitle className="text-2xl bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
                My Timecard
              </CardTitle>
              <CardDescription>
                {currentEmployee.name} • {currentEmployee.position}
              </CardDescription>
            </div>
          </div>
        </CardHeader>
      </Card>

      {/* Period Selector */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex items-center gap-4 flex-wrap">
            <div className="flex items-center gap-2">
              <Calendar className="h-5 w-5 text-muted-foreground" />
              <span className="font-medium">Period:</span>
            </div>
            <Select
              value={periodType}
              onValueChange={(value) => setPeriodType(value as PeriodType)}
            >
              <SelectTrigger className="w-[180px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="current_week">Current Week</SelectItem>
                <SelectItem value="last_week">Last Week</SelectItem>
                <SelectItem value="custom">Custom Week</SelectItem>
              </SelectContent>
            </Select>

            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={handlePreviousWeek}
                aria-label="Previous week"
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button variant="outline" size="sm" onClick={handleToday}>
                Today
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handleNextWeek}
                aria-label="Next week"
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>

            <Badge variant="outline" className="px-3 py-1">
              {format(start, 'MMM d')} - {format(end, 'MMM d, yyyy')}
            </Badge>
          </div>
        </CardContent>
      </Card>

      {/* Weekly Summary */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center gap-2">
              <Clock className="h-4 w-4" />
              Net Hours
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatHours(weeklyTotals.netHours)}</div>
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
