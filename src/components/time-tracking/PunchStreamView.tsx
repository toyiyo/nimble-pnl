import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { ProcessedPunch } from '@/utils/timePunchProcessing';
import { format } from 'date-fns';
import { AlertCircle, ArrowRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ScrollArea } from '@/components/ui/scroll-area';

interface PunchStreamViewProps {
  processedPunches: ProcessedPunch[];
  loading?: boolean;
  employeeId?: string;
}

export const PunchStreamView = ({ processedPunches, loading, employeeId }: PunchStreamViewProps) => {
  // Filter by employee if specified
  const filteredPunches = employeeId
    ? processedPunches.filter(p => p.employee_id === employeeId)
    : processedPunches;

  // Sort chronologically
  const sortedPunches = [...filteredPunches].sort((a, b) => 
    a.punch_time.getTime() - b.punch_time.getTime()
  );

  const getPunchTypeColor = (type: string) => {
    switch (type) {
      case 'clock_in':
        return 'bg-green-500/10 text-green-700 border-green-500/20';
      case 'clock_out':
        return 'bg-red-500/10 text-red-700 border-red-500/20';
      case 'break_start':
        return 'bg-yellow-500/10 text-yellow-700 border-yellow-500/20';
      case 'break_end':
        return 'bg-blue-500/10 text-blue-700 border-blue-500/20';
      default:
        return '';
    }
  };

  const getPunchTypeLabel = (type: string) => {
    return type.split('_').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
  };

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Punch Stream Timeline</CardTitle>
        </CardHeader>
        <CardContent>
          <Skeleton className="h-64 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (sortedPunches.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Punch Stream Timeline</CardTitle>
        </CardHeader>
        <CardContent className="py-12 text-center">
          <p className="text-muted-foreground">No punches to display</p>
        </CardContent>
      </Card>
    );
  }

  // Group punches by employee for better organization
  const punchesByEmployee = sortedPunches.reduce((acc, punch) => {
    const existing = acc.get(punch.employee_id) || [];
    existing.push(punch);
    acc.set(punch.employee_id, existing);
    return acc;
  }, new Map<string, ProcessedPunch[]>());

  return (
    <Card>
      <CardHeader>
        <CardTitle>Punch Stream Timeline - Debug View</CardTitle>
        <CardDescription>
          Chronological punch log with noise detection and anomaly warnings
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ScrollArea className="h-96">
          <div className="space-y-6">
            {Array.from(punchesByEmployee.entries()).map(([empId, punches]) => {
              const employeeName = punches[0]?.original_punch.employee?.name || 'Unknown';
              const noisePunches = punches.filter(p => p.is_noise);
              
              return (
                <div key={empId} className="space-y-2">
                  <div className="flex items-center justify-between sticky top-0 bg-background py-2 border-b">
                    <h3 className="font-semibold text-sm">{employeeName}</h3>
                    {noisePunches.length > 0 && (
                      <Badge variant="outline" className="bg-yellow-500/10 text-yellow-700 border-yellow-500/20">
                        <AlertCircle className="h-3 w-3 mr-1" />
                        {noisePunches.length} noise punch{noisePunches.length !== 1 ? 'es' : ''}
                      </Badge>
                    )}
                  </div>

                  {/* Timeline visualization */}
                  <div className="relative pl-4 space-y-3">
                    {/* Vertical line */}
                    <div className="absolute left-0 top-0 bottom-0 w-px bg-border" />
                    
                    {punches.map((punch, idx) => (
                      <div key={punch.id} className="relative">
                        {/* Dot on timeline */}
                        <div 
                          className={cn(
                            "absolute left-[-4px] top-1.5 w-2 h-2 rounded-full border-2 bg-background",
                            punch.is_noise ? "border-yellow-500" : "border-primary"
                          )}
                        />
                        
                        {/* Punch details */}
                        <div 
                          className={cn(
                            "ml-4 p-3 rounded-lg border transition-all",
                            punch.is_noise && "bg-yellow-500/5 border-yellow-500/20"
                          )}
                        >
                          <div className="flex items-center gap-3 flex-wrap">
                            <Badge 
                              variant="outline" 
                              className={cn(
                                getPunchTypeColor(punch.punch_type),
                                punch.is_noise && "opacity-60"
                              )}
                            >
                              {getPunchTypeLabel(punch.punch_type)}
                            </Badge>
                            
                            <span className="font-mono text-sm font-medium">
                              {format(punch.punch_time, 'h:mm:ss a')}
                            </span>

                            {punch.is_noise && (
                              <Badge variant="outline" className="bg-yellow-500/10 text-yellow-700 border-yellow-500/20">
                                <AlertCircle className="h-3 w-3 mr-1" />
                                Noise
                              </Badge>
                            )}

                            {/* Show time difference from previous punch */}
                            {idx > 0 && (
                              <span className="text-xs text-muted-foreground flex items-center gap-1">
                                <ArrowRight className="h-3 w-3" />
                                {(() => {
                                  const prevPunch = punches[idx - 1];
                                  const diffSeconds = (punch.punch_time.getTime() - prevPunch.punch_time.getTime()) / 1000;
                                  if (diffSeconds < 60) {
                                    return `${Math.round(diffSeconds)}s later`;
                                  } else if (diffSeconds < 3600) {
                                    return `${Math.round(diffSeconds / 60)}m later`;
                                  } else {
                                    return `${(diffSeconds / 3600).toFixed(1)}h later`;
                                  }
                                })()}
                              </span>
                            )}
                          </div>

                          {/* Noise reason */}
                          {punch.is_noise && punch.noise_reason && (
                            <div className="mt-2 text-xs text-yellow-700 flex items-start gap-1">
                              <span>⚠️</span>
                              <span>{punch.noise_reason}</span>
                            </div>
                          )}

                          {/* Notes if any */}
                          {punch.original_punch.notes && (
                            <div className="mt-2 text-xs text-muted-foreground">
                              Note: {punch.original_punch.notes}
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </ScrollArea>

        {/* Summary */}
        <div className="flex items-center gap-4 text-xs text-muted-foreground pt-4 border-t mt-4">
          <div>Total punches: {sortedPunches.length}</div>
          <div>Noise detected: {sortedPunches.filter(p => p.is_noise).length}</div>
          <div>Clean punches: {sortedPunches.filter(p => !p.is_noise).length}</div>
        </div>
      </CardContent>
    </Card>
  );
};
