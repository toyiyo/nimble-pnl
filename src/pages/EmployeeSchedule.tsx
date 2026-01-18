import { useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { useRestaurantContext } from '@/contexts/RestaurantContext';
import { useCurrentEmployee } from '@/hooks/useCurrentEmployee';
import { useShifts } from '@/hooks/useShifts';
import { useShiftTrades } from '@/hooks/useShiftTrades';
import { TradeRequestDialog } from '@/components/schedule/TradeRequestDialog';
import {
  EmployeePageHeader,
  NoRestaurantState,
  EmployeePageSkeleton,
  EmployeeNotLinkedState,
  EmployeeInfoAlert,
} from '@/components/employee';
import {
  Calendar,
  Clock,
  ChevronLeft,
  ChevronRight,
  CalendarDays,
  MapPin,
  Coffee,
  CheckCircle,
  XCircle,
  ClockIcon,
  ArrowLeftRight,
} from 'lucide-react';
import {
  format,
  startOfWeek,
  endOfWeek,
  subWeeks,
  addWeeks,
  eachDayOfInterval,
  parseISO,
  isToday,
  isFuture,
  isPast,
  differenceInMinutes,
} from 'date-fns';
import { WEEK_STARTS_ON } from '@/lib/dateConfig';
import { Shift } from '@/types/scheduling';

const formatShiftDuration = (startTime: string, endTime: string, breakMinutes: number) => {
  const start = new Date(startTime);
  const end = new Date(endTime);
  const totalMinutes = differenceInMinutes(end, start);
  const netMinutes = totalMinutes - breakMinutes;
  const hours = Math.floor(netMinutes / 60);
  const minutes = netMinutes % 60;
  return `${hours}h ${minutes}m`;
};

const getShiftStatusBadge = (shift: Shift) => {
  const startTime = new Date(shift.start_time);
  const endTime = new Date(shift.end_time);
  const now = new Date();

  if (shift.status === 'cancelled') {
    return (
      <Badge variant="destructive" className="flex items-center gap-1">
        <XCircle className="h-3 w-3" />
        Cancelled
      </Badge>
    );
  }

  if (isPast(endTime)) {
    return (
      <Badge variant="outline" className="flex items-center gap-1 bg-muted">
        <CheckCircle className="h-3 w-3" />
        Completed
      </Badge>
    );
  }

  if (now >= startTime && now <= endTime) {
    return (
      <Badge className="flex items-center gap-1 bg-green-500">
        <ClockIcon className="h-3 w-3" />
        In Progress
      </Badge>
    );
  }

  if (isToday(startTime)) {
    return (
      <Badge variant="default" className="flex items-center gap-1">
        <Clock className="h-3 w-3" />
        Today
      </Badge>
    );
  }

  if (isFuture(startTime)) {
    return (
      <Badge variant="outline" className="flex items-center gap-1">
        <Calendar className="h-3 w-3" />
        Upcoming
      </Badge>
    );
  }

  return null;
};

const EmployeeSchedule = () => {
  const { selectedRestaurant } = useRestaurantContext();
  const restaurantId = selectedRestaurant?.restaurant_id || null;

  const [currentWeekStart, setCurrentWeekStart] = useState(
    startOfWeek(new Date(), { weekStartsOn: WEEK_STARTS_ON })
  );
  const [tradeDialogOpen, setTradeDialogOpen] = useState(false);
  const [selectedShiftForTrade, setSelectedShiftForTrade] = useState<Shift | null>(null);

  const weekEnd = endOfWeek(currentWeekStart, { weekStartsOn: WEEK_STARTS_ON });
  const weekDays = eachDayOfInterval({ start: currentWeekStart, end: weekEnd });

  const { currentEmployee, loading: employeeLoading } = useCurrentEmployee(restaurantId);
  const { shifts, loading: shiftsLoading } = useShifts(restaurantId, currentWeekStart, weekEnd);
  const { trades: pendingTrades, loading: tradesLoading } = useShiftTrades(
    restaurantId,
    'pending_approval',
    currentEmployee?.id || null
  );

  // Filter shifts to only show current employee's shifts
  const myShifts = useMemo(() => {
    if (!currentEmployee) return [];
    return shifts.filter((shift) => shift.employee_id === currentEmployee.id);
  }, [shifts, currentEmployee]);

  // Group shifts by day
  const shiftsByDay = useMemo(() => {
    const grouped = new Map<string, Shift[]>();
    weekDays.forEach((day) => {
      grouped.set(format(day, 'yyyy-MM-dd'), []);
    });

    myShifts.forEach((shift) => {
      const dayKey = format(parseISO(shift.start_time), 'yyyy-MM-dd');
      if (grouped.has(dayKey)) {
        grouped.get(dayKey)!.push(shift);
      }
    });

    return grouped;
  }, [myShifts, weekDays]);

  // Calculate weekly totals
  const weeklyStats = useMemo(() => {
    let totalHours = 0;
    let totalShifts = 0;

    myShifts.forEach((shift) => {
      if (shift.status !== 'cancelled') {
        const start = new Date(shift.start_time);
        const end = new Date(shift.end_time);
        const minutes = differenceInMinutes(end, start) - shift.break_duration;
        totalHours += minutes / 60;
        totalShifts++;
      }
    });

    return { totalHours, totalShifts };
  }, [myShifts]);

  // Get upcoming shifts (next 3 days)
  const upcomingShifts = useMemo(() => {
    const now = new Date();
    return myShifts
      .filter((shift) => {
        const startTime = new Date(shift.start_time);
        return startTime >= now && shift.status !== 'cancelled';
      })
      .sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime())
      .slice(0, 5);
  }, [myShifts]);

  const handlePreviousWeek = () => {
    setCurrentWeekStart(subWeeks(currentWeekStart, 1));
  };

  const handleNextWeek = () => {
    setCurrentWeekStart(addWeeks(currentWeekStart, 1));
  };

  const handleTradeShift = (shift: Shift) => {
    setSelectedShiftForTrade(shift);
    setTradeDialogOpen(true);
  };

  const handleToday = () => {
    setCurrentWeekStart(startOfWeek(new Date(), { weekStartsOn: WEEK_STARTS_ON }));
  };

  if (!restaurantId) {
    return <NoRestaurantState />;
  }

  if (employeeLoading) {
    return <EmployeePageSkeleton />;
  }

  if (!currentEmployee) {
    return <EmployeeNotLinkedState />;
  }

  const isLoading = shiftsLoading;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row gap-4 justify-between items-start sm:items-center">
        <EmployeePageHeader
          icon={CalendarDays}
          title="My Schedule"
          subtitle={`${currentEmployee.name} • ${currentEmployee.position}`}
        />
        <Link to="/employee/shifts">
          <Button className="bg-gradient-to-r from-primary to-accent hover:opacity-90">
            <ArrowLeftRight className="h-4 w-4 mr-2" />
            Browse Available Shifts
          </Button>
        </Link>
      </div>

      {/* Pending Trade Requests */}
      {!tradesLoading && pendingTrades && pendingTrades.length > 0 && (
        <Card className="bg-gradient-to-br from-yellow-500/5 to-orange-500/5 border-yellow-500/20">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ClockIcon className="h-5 w-5 text-yellow-600" />
              Pending Trade Requests
            </CardTitle>
            <CardDescription>
              These shifts are awaiting manager approval. They will appear in your schedule once approved.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {pendingTrades.map((trade) => (
                <div
                  key={trade.id}
                  className="flex items-center justify-between p-3 rounded-lg bg-background border border-yellow-500/20"
                >
                  <div className="flex items-center gap-4">
                    <div className="text-center">
                      <div className="text-sm font-medium text-muted-foreground">
                        {format(parseISO(trade.offered_shift.start_time), 'EEE')}
                      </div>
                      <div className="text-2xl font-bold">
                        {format(parseISO(trade.offered_shift.start_time), 'd')}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {format(parseISO(trade.offered_shift.start_time), 'MMM')}
                      </div>
                    </div>
                    <div>
                      <div className="font-medium">{trade.offered_shift.position}</div>
                      <div className="text-sm text-muted-foreground">
                        {format(parseISO(trade.offered_shift.start_time), 'h:mm a')} -{' '}
                        {format(parseISO(trade.offered_shift.end_time), 'h:mm a')}
                      </div>
                    </div>
                  </div>
                  <Badge className="bg-gradient-to-r from-yellow-500 to-orange-600 text-white">
                    <ClockIcon className="w-3 h-3 mr-1" />
                    Pending Approval
                  </Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Upcoming Shifts */}
      {upcomingShifts.length > 0 && (
        <Card className="bg-gradient-to-br from-green-500/5 to-green-600/5 border-green-500/20">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Clock className="h-5 w-5 text-green-600" />
              Upcoming Shifts
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {upcomingShifts.map((shift) => (
                <div
                  key={shift.id}
                  className="flex items-center justify-between p-3 rounded-lg bg-background border"
                >
                  <div className="flex items-center gap-4">
                    <div className="text-center">
                      <div className="text-sm font-medium text-muted-foreground">
                        {format(parseISO(shift.start_time), 'EEE')}
                      </div>
                      <div className="text-2xl font-bold">
                        {format(parseISO(shift.start_time), 'd')}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {format(parseISO(shift.start_time), 'MMM')}
                      </div>
                    </div>
                    <div>
                      <div className="font-medium">
                        {format(parseISO(shift.start_time), 'h:mm a')} -{' '}
                        {format(parseISO(shift.end_time), 'h:mm a')}
                      </div>
                      <div className="text-sm text-muted-foreground flex items-center gap-2">
                        <MapPin className="h-3 w-3" />
                        {shift.position}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    {shift.break_duration > 0 && (
                      <div className="flex items-center gap-1 text-sm text-muted-foreground">
                        <Coffee className="h-3 w-3" />
                        {shift.break_duration}m break
                      </div>
                    )}
                    {getShiftStatusBadge(shift)}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Week Navigation */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Weekly Schedule</CardTitle>
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
              <Badge variant="outline" className="px-3 py-1 ml-2">
                {format(currentWeekStart, 'MMM d')} - {format(weekEnd, 'MMM d, yyyy')}
              </Badge>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-4">
              {[...Array(7)].map((_, i) => (
                <Skeleton key={i} className="h-20 w-full" />
              ))}
            </div>
          ) : (
            <div className="space-y-3">
              {weekDays.map((day) => {
                const dayKey = format(day, 'yyyy-MM-dd');
                const dayShifts = shiftsByDay.get(dayKey) || [];
                const isDayToday = isToday(day);

                return (
                  <div
                    key={dayKey}
                    className={`p-4 rounded-lg border ${
                      isDayToday ? 'bg-primary/5 border-primary/20' : 'bg-card'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{format(day, 'EEEE')}</span>
                        <span className="text-muted-foreground">{format(day, 'MMM d')}</span>
                        {isDayToday && (
                          <Badge variant="default" className="text-xs">
                            Today
                          </Badge>
                        )}
                      </div>
                    </div>

                    {dayShifts.length === 0 ? (
                      <p className="text-sm text-muted-foreground">No shifts scheduled</p>
                    ) : (
                      <div className="space-y-2">
                        {dayShifts.map((shift) => (
                          <div
                            key={shift.id}
                            className={`flex items-center justify-between p-3 rounded-lg ${
                              shift.status === 'cancelled'
                                ? 'bg-destructive/10 line-through'
                                : 'bg-muted/50'
                            }`}
                          >
                            <div className="flex items-center gap-4">
                              <div>
                                <div className="font-medium">
                                  {format(parseISO(shift.start_time), 'h:mm a')} -{' '}
                                  {format(parseISO(shift.end_time), 'h:mm a')}
                                </div>
                                <div className="text-sm text-muted-foreground">
                                  {shift.position}
                                </div>
                              </div>
                            </div>
                            <div className="flex items-center gap-3">
                              <div className="text-sm text-muted-foreground">
                                {formatShiftDuration(
                                  shift.start_time,
                                  shift.end_time,
                                  shift.break_duration
                                )}
                              </div>
                              {shift.break_duration > 0 && (
                                <div className="flex items-center gap-1 text-xs text-muted-foreground">
                                  <Coffee className="h-3 w-3" />
                                  {shift.break_duration}m
                                </div>
                              )}
                              {getShiftStatusBadge(shift)}
                              {isFuture(parseISO(shift.start_time)) && shift.status !== 'cancelled' && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => handleTradeShift(shift)}
                                  className="ml-2"
                                >
                                  <ArrowLeftRight className="h-4 w-4 mr-1" />
                                  Trade
                                </Button>
                              )}
                            </div>
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

      {/* Weekly Summary */}
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center gap-2">
              <CalendarDays className="h-4 w-4" />
              Total Shifts
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{weeklyStats.totalShifts}</div>
            <p className="text-xs text-muted-foreground">This week</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center gap-2">
              <Clock className="h-4 w-4" />
              Scheduled Hours
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{weeklyStats.totalHours.toFixed(1)}</div>
            <p className="text-xs text-muted-foreground">Hours this week</p>
          </CardContent>
        </Card>
      </div>

      {/* Info Alert */}
      <EmployeeInfoAlert>
        <strong>Note:</strong> Your schedule may change. Check back regularly or enable
        notifications to stay updated. Contact your manager if you have any scheduling conflicts.
      </EmployeeInfoAlert>

      {/* Trade Request Dialog */}
      {selectedShiftForTrade && (
        <TradeRequestDialog
          open={tradeDialogOpen}
          onOpenChange={setTradeDialogOpen}
          shift={selectedShiftForTrade}
          restaurantId={restaurantId}
          currentEmployeeId={currentEmployee.id}
        />
      )}
    </div>
  );
};

export default EmployeeSchedule;
