import { useState, useMemo, useRef, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { useRestaurantContext } from '@/contexts/RestaurantContext';
import { useCurrentEmployee } from '@/hooks/useCurrentEmployee';
import { useMyShifts } from '@/hooks/useShifts';
import { useWeekScheduleStatus } from '@/hooks/useSchedulePublish';
import { TradeRequestDialog } from '@/components/schedule/TradeRequestDialog';
import { MyShiftTradesCard } from '@/components/schedule/MyShiftTradesCard';
import {
  EmployeePageHeader,
  NoRestaurantState,
  EmployeePageSkeleton,
  EmployeeNotLinkedState,
  EmployeeInfoAlert,
  ScheduleStatusBanner,
  ScheduleUpdatedPill,
  ShiftRow,
} from '@/components/employee';
import {
  Clock,
  ChevronLeft,
  ChevronRight,
  CalendarDays,
  ArrowLeftRight,
  AlertTriangle,
} from 'lucide-react';
import {
  format,
  startOfWeek,
  endOfWeek,
  subWeeks,
  addWeeks,
  eachDayOfInterval,
  differenceInMinutes,
} from 'date-fns';
import { WEEK_STARTS_ON } from '@/lib/dateConfig';
import { useRestaurantClock } from '@/hooks/useRestaurantClock';
import { toBusinessDay } from '@/lib/restaurantClock';
import { toDateOnlyString } from '@/lib/dateOnly';
import { formatLocalDate } from '@/lib/shiftInterval';
import {
  computeScheduleFingerprint,
  hasScheduleChangedSinceSeen,
  readSeenFingerprint,
  writeSeenFingerprint,
} from '@/lib/scheduleSeenFingerprint';
import { Shift } from '@/types/scheduling';

const EmployeeSchedule = () => {
  const { selectedRestaurant } = useRestaurantContext();
  const restaurantId = selectedRestaurant?.restaurant_id || null;

  const [currentWeekStart, setCurrentWeekStart] = useState(
    startOfWeek(new Date(), { weekStartsOn: WEEK_STARTS_ON })
  );
  const [tradeDialogOpen, setTradeDialogOpen] = useState(false);
  const pageHeaderRef = useRef<HTMLDivElement>(null);
  const [selectedShiftForTrade, setSelectedShiftForTrade] = useState<Shift | null>(null);

  const weekEnd = endOfWeek(currentWeekStart, { weekStartsOn: WEEK_STARTS_ON });
  const weekDays = eachDayOfInterval({ start: currentWeekStart, end: weekEnd });

  const { currentEmployee, loading: employeeLoading } = useCurrentEmployee(restaurantId);
  const {
    shifts: myShifts,
    loading: shiftsLoading,
    error: shiftsError,
    refetch: refetchShifts,
  } = useMyShifts(restaurantId, currentEmployee?.id ?? null, currentWeekStart, weekEnd);

  // The restaurant's clock, never the host browser's. Two questions on this
  // page are calendar-day questions -- "which day column does this shift belong
  // to" and "which day is today" -- and only the restaurant's calendar answers
  // them. An employee who opens the page from another zone (travel, a remote
  // manager, a phone that never left the last airport) otherwise reads a
  // different week than the one the restaurant published.
  const clock = useRestaurantClock();
  const restaurantTimezone = clock.tz;
  const restaurantToday = clock.today;

  // What this week actually IS, as opposed to what the rows look like: a week
  // that was announced and then pulled back is otherwise indistinguishable
  // from one nobody ever published.
  const {
    state,
    publication,
    loading: statusLoading,
    // `employeeLoading` too, not just `shiftsLoading`: `useMyShifts` stays
    // disabled until `employeeId` resolves, and a disabled query reports
    // `isLoading: false` — so `shiftsLoading` alone would race ahead of
    // `currentEmployee` instead of waiting for it.
  } = useWeekScheduleStatus(
    restaurantId,
    currentWeekStart,
    myShifts,
    shiftsLoading || employeeLoading
  );

  // "Has anything moved since I last looked?" There is no server-side read
  // tracking, so this compares a fingerprint of what the employee last saw.
  const fingerprint = useMemo(
    () =>
      computeScheduleFingerprint({
        publishedAt: publication?.published_at ?? null,
        shifts: myShifts,
      }),
    [publication?.published_at, myShifts]
  );

  const weekStartStr = formatLocalDate(currentWeekStart);
  const employeeId = currentEmployee?.id ?? null;

  const [seenFingerprint, setSeenFingerprint] = useState<string | null>(null);

  // Read on arrival, then immediately record the visit. Reading into state
  // first is what keeps the pill on screen for the whole visit -- writing
  // without it would mark the week seen and erase the pill in the same commit.
  //
  // Both loading flags gate this, not just `shiftsLoading`. The fingerprint
  // covers `published_at`, which arrives from a *different* query: writing
  // while that one is still in flight stores a fingerprint with a null
  // published_at, and the moment it resolves the effect re-fires, reads its own
  // stale write back, and shows "Updated since you last checked" on a week
  // where nothing changed.
  useEffect(() => {
    if (!restaurantId || !employeeId || shiftsLoading || statusLoading) return;
    setSeenFingerprint(readSeenFingerprint(restaurantId, employeeId, weekStartStr));
    writeSeenFingerprint(restaurantId, employeeId, weekStartStr, fingerprint);
  }, [restaurantId, employeeId, weekStartStr, fingerprint, shiftsLoading, statusLoading]);

  const scheduleChangedSinceSeen = hasScheduleChangedSinceSeen(seenFingerprint, fingerprint);

  // Group shifts by day
  const shiftsByDay = useMemo(() => {
    const grouped = new Map<string, Shift[]>();
    // `weekDays` are calendar days the user navigated to, held as host-local
    // midnight `Date`s -- `toDateOnlyString` reads their fields, it does not
    // convert an instant.
    weekDays.forEach((day) => {
      grouped.set(toDateOnlyString(day), []);
    });

    myShifts.forEach((shift) => {
      // `start_time` IS an instant, so it needs the restaurant's zone to name
      // a day. The old `format(parseISO(...))` read it in the viewer's zone:
      // a 9 p.m. shift seen from a zone one day ahead landed in the next day's
      // column, and on the week's last day it matched no column and vanished.
      const dayKey = toBusinessDay(shift.start_time, restaurantTimezone);
      if (grouped.has(dayKey)) {
        grouped.get(dayKey)!.push(shift);
      }
    });

    return grouped;
  }, [myShifts, weekDays, restaurantTimezone]);

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

  const allUpcomingAreDrafts =
    upcomingShifts.length > 0 && upcomingShifts.every((shift) => !shift.is_published);

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
      {/* Header — focusable anchor: MyShiftTradesCard returns focus here when a
          withdraw removes its last posted row (its own section header unmounts). */}
      <div
        ref={pageHeaderRef}
        tabIndex={-1}
        className="flex flex-col sm:flex-row gap-4 justify-between items-start sm:items-center outline-none"
      >
        <EmployeePageHeader
          icon={CalendarDays}
          title="My Schedule"
          subtitle={`${currentEmployee.name} • ${currentEmployee.position}`}
        />
        <Link to="/employee/shifts" className="w-full sm:w-auto">
          <Button className="w-full sm:w-auto bg-gradient-to-r from-primary to-accent hover:opacity-90">
            <ArrowLeftRight className="h-4 w-4 mr-2" />
            Browse Available Shifts
          </Button>
        </Link>
      </div>

      {/* One quiet "Published {date}" line, or nothing. Never a warning. */}
      <ScheduleStatusBanner
        state={state}
        publication={publication}
        timezone={restaurantTimezone}
      />

      {/* My shift trades — poster tracker + claimant status */}
      <MyShiftTradesCard
        restaurantId={restaurantId}
        employeeId={currentEmployee.id}
        fallbackFocusRef={pageHeaderRef}
      />

      {/* Upcoming Shifts. The green celebratory chrome is a claim that these
          are locked in, so it only survives while at least one of them is. */}
      {upcomingShifts.length > 0 && (
        <Card
          className={
            allUpcomingAreDrafts
              ? 'bg-muted/20 border-border/40'
              : 'bg-gradient-to-br from-green-500/5 to-green-600/5 border-green-500/20'
          }
        >
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Clock
                className={`h-5 w-5 ${allUpcomingAreDrafts ? 'text-muted-foreground' : 'text-green-600'}`}
              />
              {allUpcomingAreDrafts ? 'Upcoming (tentative)' : 'Upcoming Shifts'}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {upcomingShifts.map((shift) => (
                <ShiftRow key={shift.id} shift={shift} variant="upcoming" clock={clock} />
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Week Navigation */}
      <Card>
        <CardHeader>
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <CardTitle>Weekly Schedule</CardTitle>
              {scheduleChangedSinceSeen && <ScheduleUpdatedPill />}
            </div>
            <div className="flex flex-col sm:flex-row items-start sm:items-center gap-2">
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handlePreviousWeek}
                  aria-label="Previous week"
                  className="min-h-[44px] min-w-[44px]"
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <Button variant="outline" size="sm" onClick={handleToday} className="min-h-[44px]">
                  Today
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleNextWeek}
                  aria-label="Next week"
                  className="min-h-[44px] min-w-[44px]"
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
              <Badge variant="outline" className="px-3 py-1">
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
          ) : shiftsError ? (
            /* An empty grid on a failed load reads as "you are not working this
               week" -- the most costly possible misreading on this page. */
            <div className="flex flex-col items-center gap-3 py-8 text-center">
              <AlertTriangle className="h-6 w-6 text-destructive" />
              <div>
                <p className="text-[14px] font-medium text-foreground">
                  We couldn't load your schedule
                </p>
                <p className="text-[13px] text-muted-foreground">
                  This is a loading problem, not an empty week. Your shifts are still there.
                </p>
              </div>
              <Button variant="outline" size="sm" onClick={() => refetchShifts()} className="min-h-[44px]">
                Retry
              </Button>
            </div>
          ) : (
            <div className="space-y-3">
              {weekDays.map((day) => {
                const dayKey = toDateOnlyString(day);
                const dayShifts = shiftsByDay.get(dayKey) || [];
                const isDayToday = dayKey === restaurantToday;

                return (
                  <div
                    key={dayKey}
                    data-testid={`schedule-day-${dayKey}`}
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
                          <ShiftRow key={shift.id} shift={shift} onTrade={handleTradeShift} clock={clock} />
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
