import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { WorkSession } from '@/utils/timePunchProcessing';
import { format } from 'date-fns';
import { AlertCircle, Clock, Coffee, CheckCircle } from 'lucide-react';
import { cn } from '@/lib/utils';

interface EmployeeCardViewProps {
  sessions: WorkSession[];
  loading?: boolean;
  date: Date;
}

interface EmployeeSummary {
  employee_id: string;
  employee_name: string;
  sessions: WorkSession[];
  total_hours: number;
  break_hours: number;
  session_count: number;
  has_anomalies: boolean;
  anomalies: string[];
}

export const EmployeeCardView = ({ sessions, loading, date }: EmployeeCardViewProps) => {
  // Group sessions by employee and create summaries
  const employeeSummaries = sessions.reduce((acc, session) => {
    const existing = acc.find(s => s.employee_id === session.employee_id);
    
    if (existing) {
      existing.sessions.push(session);
      existing.total_hours += session.worked_minutes / 60;
      existing.break_hours += session.break_minutes / 60;
      existing.session_count++;
      if (session.has_anomalies) {
        existing.has_anomalies = true;
        existing.anomalies.push(...session.anomalies);
      }
    } else {
      acc.push({
        employee_id: session.employee_id,
        employee_name: session.employee_name,
        sessions: [session],
        total_hours: session.worked_minutes / 60,
        break_hours: session.break_minutes / 60,
        session_count: 1,
        has_anomalies: session.has_anomalies,
        anomalies: session.has_anomalies ? [...session.anomalies] : [],
      });
    }
    
    return acc;
  }, [] as EmployeeSummary[]).sort((a, b) => 
    a.employee_name.localeCompare(b.employee_name)
  );

  if (loading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-48" />
        ))}
      </div>
    );
  }

  if (employeeSummaries.length === 0) {
    return (
      <Card>
        <CardContent className="py-12 text-center">
          <Clock className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
          <p className="text-muted-foreground">No employee sessions found for this date</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      {employeeSummaries.map((summary) => {
        const firstSession = summary.sessions[0];
        const lastSession = summary.sessions[summary.sessions.length - 1];
        const earliestIn = firstSession?.clock_in;
        const latestOut = lastSession?.clock_out;

        return (
          <Card 
            key={summary.employee_id}
            className={cn(
              "transition-all hover:shadow-lg",
              summary.has_anomalies && "border-yellow-500/50"
            )}
          >
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-lg">{summary.employee_name}</CardTitle>
                {summary.has_anomalies ? (
                  <Badge variant="outline" className="bg-yellow-500/10 text-yellow-700 border-yellow-500/20">
                    <AlertCircle className="h-3 w-3 mr-1" />
                    Issues
                  </Badge>
                ) : (
                  <Badge variant="outline" className="bg-green-500/10 text-green-700 border-green-500/20">
                    <CheckCircle className="h-3 w-3 mr-1" />
                    Clean
                  </Badge>
                )}
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              {/* Shift time */}
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Shift:</span>
                <span className="font-medium">
                  {earliestIn && format(earliestIn, 'h:mm a')} →{' '}
                  {latestOut ? format(latestOut, 'h:mm a') : 'In Progress'}
                </span>
              </div>

              {/* Total hours */}
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground text-sm">Total:</span>
                <Badge className="bg-gradient-to-r from-primary to-accent text-white font-mono text-base">
                  {summary.total_hours.toFixed(2)}h
                </Badge>
              </div>

              {/* Breaks */}
              {summary.break_hours > 0 && (
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground flex items-center gap-1">
                    <Coffee className="h-3 w-3" />
                    Breaks:
                  </span>
                  <span className="font-medium">{summary.break_hours.toFixed(2)}h</span>
                </div>
              )}

              {/* Sessions */}
              {summary.session_count > 1 && (
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Sessions:</span>
                  <span className="font-medium">{summary.session_count}</span>
                </div>
              )}

              {/* Anomalies */}
              {summary.has_anomalies && (
                <div className="pt-2 border-t space-y-1">
                  <div className="text-xs font-medium text-yellow-700">Anomalies:</div>
                  {Array.from(new Set(summary.anomalies)).slice(0, 2).map((anomaly, idx) => (
                    <div key={idx} className="text-xs text-yellow-600 flex items-start gap-1">
                      <span>⚠️</span>
                      <span>{anomaly}</span>
                    </div>
                  ))}
                  {summary.anomalies.length > 2 && (
                    <div className="text-xs text-muted-foreground">
                      +{summary.anomalies.length - 2} more
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
};
