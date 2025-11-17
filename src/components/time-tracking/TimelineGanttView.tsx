import { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { WorkSession } from '@/utils/timePunchProcessing';
import { format, startOfDay, endOfDay, differenceInMinutes } from 'date-fns';
import { AlertCircle, Clock } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';

interface TimelineGanttViewProps {
  sessions: WorkSession[];
  loading?: boolean;
  date: Date;
}

interface EmployeeTimeline {
  employee_id: string;
  employee_name: string;
  sessions: WorkSession[];
  total_hours: number;
  has_anomalies: boolean;
}

export const TimelineGanttView = ({ sessions, loading, date }: TimelineGanttViewProps) => {
  // Group sessions by employee
  const employeeTimelines = useMemo(() => {
    const timelines = new Map<string, EmployeeTimeline>();

    sessions.forEach(session => {
      const existing = timelines.get(session.employee_id);
      
      if (existing) {
        existing.sessions.push(session);
        existing.total_hours += session.worked_minutes / 60;
        existing.has_anomalies = existing.has_anomalies || session.has_anomalies;
      } else {
        timelines.set(session.employee_id, {
          employee_id: session.employee_id,
          employee_name: session.employee_name,
          sessions: [session],
          total_hours: session.worked_minutes / 60,
          has_anomalies: session.has_anomalies,
        });
      }
    });

    return Array.from(timelines.values()).sort((a, b) => 
      a.employee_name.localeCompare(b.employee_name)
    );
  }, [sessions]);

  // Calculate timeline dimensions (6 AM to 11 PM = 17 hours)
  const timelineStart = new Date(date);
  timelineStart.setHours(6, 0, 0, 0);
  const timelineEnd = new Date(date);
  timelineEnd.setHours(23, 0, 0, 0);
  const totalMinutes = differenceInMinutes(timelineEnd, timelineStart);

  const getBarPosition = (time: Date) => {
    const minutes = differenceInMinutes(time, timelineStart);
    return Math.max(0, Math.min(100, (minutes / totalMinutes) * 100));
  };

  const getBarWidth = (start: Date, end: Date) => {
    const duration = differenceInMinutes(end, start);
    return Math.max(1, (duration / totalMinutes) * 100);
  };

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Timeline View</CardTitle>
        </CardHeader>
        <CardContent>
          <Skeleton className="h-96 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (employeeTimelines.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Timeline View</CardTitle>
        </CardHeader>
        <CardContent className="py-12 text-center">
          <Clock className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
          <p className="text-muted-foreground">No sessions found for this date</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>Horizontal Timeline - Gantt View</CardTitle>
            <CardDescription>
              Visual timeline of employee work sessions for {format(date, 'MMMM d, yyyy')}
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Time ruler */}
        <div className="flex items-center text-xs text-muted-foreground border-b pb-2">
          <div className="w-40"></div>
          <div className="flex-1 flex justify-between px-2">
            {Array.from({ length: 18 }, (_, i) => (
              <div key={i} className="text-center w-0">
                {i + 6 < 12 ? `${i + 6}a` : i + 6 === 12 ? '12p' : `${i - 6}p`}
              </div>
            ))}
          </div>
          <div className="w-32 text-right">Total Hours</div>
        </div>

        {/* Employee timelines */}
        <TooltipProvider>
          <div className="space-y-4">
            {employeeTimelines.map((timeline) => (
              <div key={timeline.employee_id} className="space-y-2">
                {/* Employee name and total */}
                <div className="flex items-center">
                  <div className="w-40 flex items-center gap-2">
                    <span className="font-medium text-sm truncate">{timeline.employee_name}</span>
                    {timeline.has_anomalies && (
                      <Tooltip>
                        <TooltipTrigger>
                          <AlertCircle className="h-4 w-4 text-yellow-500" />
                        </TooltipTrigger>
                        <TooltipContent>
                          <p>This employee has anomalies in their punches</p>
                        </TooltipContent>
                      </Tooltip>
                    )}
                  </div>

                  {/* Timeline bar container */}
                  <div className="flex-1 relative h-10 bg-muted rounded-lg overflow-visible">
                    {timeline.sessions.map((session, idx) => (
                      <Tooltip key={idx}>
                        <TooltipTrigger asChild>
                          <div
                            className={cn(
                              "absolute top-1 h-8 rounded transition-all cursor-pointer",
                              session.is_complete
                                ? "bg-gradient-to-r from-primary to-accent"
                                : "bg-gradient-to-r from-yellow-400 to-orange-400",
                              session.has_anomalies && "border-2 border-yellow-500"
                            )}
                            style={{
                              left: `${getBarPosition(session.clock_in)}%`,
                              width: session.clock_out
                                ? `${getBarWidth(session.clock_in, session.clock_out)}%`
                                : '2%',
                            }}
                          >
                            {/* Break indicators */}
                            {session.breaks.map((breakPeriod, breakIdx) => {
                              if (!breakPeriod.break_end) return null;
                              const breakStart = getBarPosition(breakPeriod.break_start);
                              const sessionStart = getBarPosition(session.clock_in);
                              const relativeStart = breakStart - sessionStart;
                              const sessionWidth = session.clock_out 
                                ? getBarWidth(session.clock_in, session.clock_out)
                                : 2;
                              const breakWidth = getBarWidth(breakPeriod.break_start, breakPeriod.break_end);
                              const relativeBreakWidth = (breakWidth / sessionWidth) * 100;
                              const relativeBreakStart = (relativeStart / sessionWidth) * 100;
                              
                              return (
                                <div
                                  key={breakIdx}
                                  className="absolute top-0 bottom-0 bg-white/40 border-x border-white/60"
                                  style={{
                                    left: `${relativeBreakStart}%`,
                                    width: `${relativeBreakWidth}%`,
                                  }}
                                />
                              );
                            })}
                          </div>
                        </TooltipTrigger>
                        <TooltipContent className="max-w-xs">
                          <div className="space-y-1 text-sm">
                            <div className="font-medium">
                              {format(session.clock_in, 'h:mm a')} -{' '}
                              {session.clock_out ? format(session.clock_out, 'h:mm a') : 'In Progress'}
                            </div>
                            <div className="text-xs">
                              Worked: {(session.worked_minutes / 60).toFixed(2)}h
                            </div>
                            {session.break_minutes > 0 && (
                              <div className="text-xs">
                                Breaks: {(session.break_minutes / 60).toFixed(2)}h
                              </div>
                            )}
                            {session.has_anomalies && (
                              <div className="text-xs text-yellow-500 mt-2">
                                ⚠️ {session.anomalies.join(', ')}
                              </div>
                            )}
                          </div>
                        </TooltipContent>
                      </Tooltip>
                    ))}
                  </div>

                  {/* Total hours */}
                  <div className="w-32 text-right">
                    <Badge variant="outline" className="font-mono">
                      {timeline.total_hours.toFixed(2)}h
                    </Badge>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </TooltipProvider>

        {/* Legend */}
        <div className="flex items-center gap-6 text-xs text-muted-foreground pt-4 border-t">
          <div className="flex items-center gap-2">
            <div className="w-8 h-3 rounded bg-gradient-to-r from-primary to-accent" />
            <span>Work session</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-8 h-3 rounded bg-white/40 border border-white/60" />
            <span>Break time</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-8 h-3 rounded bg-gradient-to-r from-yellow-400 to-orange-400" />
            <span>Incomplete session</span>
          </div>
          <div className="flex items-center gap-2">
            <AlertCircle className="h-4 w-4 text-yellow-500" />
            <span>Has anomalies</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};
