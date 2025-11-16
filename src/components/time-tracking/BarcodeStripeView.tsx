import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { WorkSession } from '@/utils/timePunchProcessing';
import { differenceInMinutes, format } from 'date-fns';
import { cn } from '@/lib/utils';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';

interface BarcodeStripeViewProps {
  sessions: WorkSession[];
  loading?: boolean;
  date: Date;
}

interface EmployeeStripe {
  employee_id: string;
  employee_name: string;
  sessions: WorkSession[];
  total_hours: number;
}

export const BarcodeStripeView = ({ sessions, loading, date }: BarcodeStripeViewProps) => {
  // Group sessions by employee
  const employeeStripes = sessions.reduce((acc, session) => {
    const existing = acc.find(s => s.employee_id === session.employee_id);
    
    if (existing) {
      existing.sessions.push(session);
      existing.total_hours += session.worked_minutes / 60;
    } else {
      acc.push({
        employee_id: session.employee_id,
        employee_name: session.employee_name,
        sessions: [session],
        total_hours: session.worked_minutes / 60,
      });
    }
    
    return acc;
  }, [] as EmployeeStripe[]).sort((a, b) => 
    a.employee_name.localeCompare(b.employee_name)
  );

  // Timeline from 6 AM to 11 PM
  const timelineStart = new Date(date);
  timelineStart.setHours(6, 0, 0, 0);
  const timelineEnd = new Date(date);
  timelineEnd.setHours(23, 0, 0, 0);
  const totalMinutes = differenceInMinutes(timelineEnd, timelineStart);

  // Create a stripe pattern for an employee
  const createStripe = (employeeSessions: WorkSession[]) => {
    // Create array representing each 15-minute block
    const blocks = Array(Math.ceil(totalMinutes / 15)).fill(0);
    
    employeeSessions.forEach(session => {
      if (!session.clock_out) return;
      
      const sessionStart = differenceInMinutes(session.clock_in, timelineStart);
      const sessionEnd = differenceInMinutes(session.clock_out, timelineStart);
      
      const startBlock = Math.max(0, Math.floor(sessionStart / 15));
      const endBlock = Math.min(blocks.length - 1, Math.floor(sessionEnd / 15));
      
      // Mark work blocks
      for (let i = startBlock; i <= endBlock; i++) {
        blocks[i] = 1; // Work
      }
      
      // Mark break blocks
      session.breaks.forEach(breakPeriod => {
        if (!breakPeriod.break_end) return;
        
        const breakStart = differenceInMinutes(breakPeriod.break_start, timelineStart);
        const breakEnd = differenceInMinutes(breakPeriod.break_end, timelineStart);
        
        const breakStartBlock = Math.max(0, Math.floor(breakStart / 15));
        const breakEndBlock = Math.min(blocks.length - 1, Math.floor(breakEnd / 15));
        
        for (let i = breakStartBlock; i <= breakEndBlock; i++) {
          blocks[i] = 2; // Break
        }
      });
    });
    
    return blocks;
  };

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Barcode Stripe View</CardTitle>
        </CardHeader>
        <CardContent>
          <Skeleton className="h-64 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (employeeStripes.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Barcode Stripe View</CardTitle>
        </CardHeader>
        <CardContent className="py-12 text-center">
          <p className="text-muted-foreground">No sessions found for this date</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Barcode Stripe View - Compact Timeline</CardTitle>
        <CardDescription>
          Black bars = work, gray = breaks/off-time • {format(date, 'MMMM d, yyyy')}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <TooltipProvider>
          {employeeStripes.map((stripe) => {
            const stripePattern = createStripe(stripe.sessions);
            
            return (
              <div key={stripe.employee_id} className="flex items-center gap-3">
                <div className="w-32 text-sm font-medium truncate">
                  {stripe.employee_name}
                </div>
                
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div className="flex-1 h-8 border rounded flex overflow-hidden cursor-pointer hover:shadow-md transition-shadow">
                      {stripePattern.map((block, idx) => (
                        <div
                          key={idx}
                          className={cn(
                            "flex-1 transition-colors",
                            block === 1 && "bg-foreground",
                            block === 2 && "bg-foreground/30",
                            block === 0 && "bg-background"
                          )}
                        />
                      ))}
                    </div>
                  </TooltipTrigger>
                  <TooltipContent>
                    <div className="space-y-1 text-sm">
                      <div className="font-medium">{stripe.employee_name}</div>
                      <div>Total: {stripe.total_hours.toFixed(2)}h</div>
                      <div className="text-xs text-muted-foreground">
                        {stripe.sessions.length} session(s)
                      </div>
                    </div>
                  </TooltipContent>
                </Tooltip>
                
                <Badge variant="outline" className="w-20 justify-center font-mono text-xs">
                  {stripe.total_hours.toFixed(1)}h
                </Badge>
              </div>
            );
          })}
        </TooltipProvider>

        {/* Legend */}
        <div className="flex items-center gap-6 text-xs text-muted-foreground pt-4 border-t">
          <div className="flex items-center gap-2">
            <div className="w-8 h-3 bg-foreground border" />
            <span>Work time</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-8 h-3 bg-foreground/30 border" />
            <span>Break time</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-8 h-3 bg-background border" />
            <span>Off time</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};
