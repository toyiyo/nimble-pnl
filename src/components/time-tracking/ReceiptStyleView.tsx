import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { WorkSession } from '@/utils/timePunchProcessing';
import { format } from 'date-fns';
import { Separator } from '@/components/ui/separator';
import { Coffee, AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ReceiptStyleViewProps {
  sessions: WorkSession[];
  loading?: boolean;
  employeeId?: string;
  employeeName?: string;
}

export const ReceiptStyleView = ({ sessions, loading, employeeId, employeeName }: ReceiptStyleViewProps) => {
  // Filter by employee if specified
  const filteredSessions = employeeId
    ? sessions.filter(s => s.employee_id === employeeId)
    : sessions;

  // Sort chronologically
  const sortedSessions = [...filteredSessions].sort((a, b) => 
    a.clock_in.getTime() - b.clock_in.getTime()
  );

  if (loading) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-32" />
        <Skeleton className="h-32" />
      </div>
    );
  }

  if (sortedSessions.length === 0) {
    return (
      <Card>
        <CardContent className="py-12 text-center">
          <p className="text-muted-foreground">No sessions to display</p>
        </CardContent>
      </Card>
    );
  }

  const totalHours = sortedSessions.reduce((sum, s) => sum + s.worked_minutes / 60, 0);
  const totalBreaks = sortedSessions.reduce((sum, s) => sum + s.break_minutes / 60, 0);

  return (
    <div className="space-y-4">
      {/* Header if employee name provided */}
      {employeeName && (
        <Card className="bg-gradient-to-br from-primary/5 to-accent/5">
          <CardHeader className="pb-3">
            <CardTitle className="text-xl">{employeeName}</CardTitle>
            <CardDescription>Daily timesheet</CardDescription>
          </CardHeader>
        </Card>
      )}

      {/* Session cards */}
      {sortedSessions.map((session, idx) => (
        <Card 
          key={session.sessionId}
          className={cn(
            "font-mono",
            session.has_anomalies && "border-yellow-500/50"
          )}
        >
          <CardContent className="pt-6 space-y-3">
            {/* Session number */}
            <div className="flex justify-between items-center text-sm text-muted-foreground">
              <span>Session {idx + 1}</span>
              {session.has_anomalies && (
                <Badge variant="outline" className="bg-yellow-500/10 text-yellow-700 border-yellow-500/20">
                  <AlertCircle className="h-3 w-3 mr-1" />
                  Issues
                </Badge>
              )}
            </div>

            <Separator />

            {/* Clock in */}
            <div className="flex justify-between items-center">
              <span className="text-sm text-muted-foreground">IN</span>
              <span className="font-semibold text-lg">
                {format(session.clock_in, 'h:mm a')}
              </span>
            </div>

            {/* Breaks */}
            {session.breaks.length > 0 && (
              <div className="space-y-2 pl-4 border-l-2 border-dashed border-muted">
                {session.breaks.map((breakPeriod, breakIdx) => (
                  <div key={breakIdx} className="space-y-1">
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Coffee className="h-3 w-3" />
                      <span>Break {breakIdx + 1}</span>
                    </div>
                    <div className="flex justify-between items-center text-sm">
                      <span className="text-muted-foreground">Start</span>
                      <span>{format(breakPeriod.break_start, 'h:mm a')}</span>
                    </div>
                    {breakPeriod.break_end && (
                      <div className="flex justify-between items-center text-sm">
                        <span className="text-muted-foreground">End</span>
                        <span>{format(breakPeriod.break_end, 'h:mm a')}</span>
                      </div>
                    )}
                    <div className="text-xs text-muted-foreground text-right">
                      {breakPeriod.duration_minutes} minutes
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Clock out */}
            <div className="flex justify-between items-center">
              <span className="text-sm text-muted-foreground">OUT</span>
              <span className="font-semibold text-lg">
                {session.clock_out ? format(session.clock_out, 'h:mm a') : '─ ─ : ─ ─'}
              </span>
            </div>

            <Separator />

            {/* Totals */}
            <div className="space-y-1 text-sm">
              {session.break_minutes > 0 && (
                <div className="flex justify-between text-muted-foreground">
                  <span>Break time</span>
                  <span>{(session.break_minutes / 60).toFixed(2)}h</span>
                </div>
              )}
              <div className="flex justify-between font-semibold">
                <span>Total worked</span>
                <span className="text-primary text-base">
                  {(session.worked_minutes / 60).toFixed(2)}h
                </span>
              </div>
            </div>

            {/* Anomalies */}
            {session.has_anomalies && (
              <div className="pt-2 border-t space-y-1">
                {session.anomalies.map((anomaly, anomalyIdx) => (
                  <div key={anomalyIdx} className="text-xs text-yellow-700 flex items-start gap-1">
                    <span>⚠️</span>
                    <span>{anomaly}</span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      ))}

      {/* Daily summary */}
      <Card className="bg-gradient-to-br from-primary/5 to-accent/5">
        <CardContent className="pt-6 space-y-2 font-mono">
          <div className="flex justify-between text-sm">
            <span>Sessions</span>
            <span className="font-semibold">{sortedSessions.length}</span>
          </div>
          {totalBreaks > 0 && (
            <div className="flex justify-between text-sm">
              <span>Total breaks</span>
              <span className="font-semibold">{totalBreaks.toFixed(2)}h</span>
            </div>
          )}
          <Separator />
          <div className="flex justify-between text-lg font-bold">
            <span>Daily Total</span>
            <span className="text-primary">{totalHours.toFixed(2)}h</span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};
