import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { ScrollArea } from '@/components/ui/scroll-area';
import { 
  Clock, 
  Plus, 
  Edit, 
  Trash2, 
  Lock, 
  Unlock 
} from 'lucide-react';
import { format } from 'date-fns';
import { ScheduleChangeLog, ChangeType } from '@/types/scheduling';

type ShiftSnapshot = {
  start_time?: string | null;
  end_time?: string | null;
  position?: string | null;
};

interface ChangeLogDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  changeLogs: ScheduleChangeLog[];
  loading: boolean;
}

const getChangeIcon = (type: ChangeType) => {
  switch (type) {
    case 'created':
      return <Plus className="h-4 w-4" />;
    case 'updated':
      return <Edit className="h-4 w-4" />;
    case 'deleted':
      return <Trash2 className="h-4 w-4" />;
    case 'unpublished':
      return <Unlock className="h-4 w-4" />;
    default:
      return <Clock className="h-4 w-4" />;
  }
};

const getChangeBadgeVariant = (type: ChangeType): 'default' | 'destructive' | 'outline' => {
  switch (type) {
    case 'created':
      return 'default';
    case 'updated':
      return 'outline';
    case 'deleted':
      return 'destructive';
    case 'unpublished':
      return 'outline';
    default:
      return 'outline';
  }
};

const renderShiftSnapshot = (
  snapshot: ShiftSnapshot | null | undefined,
  label: string,
  accentClass: string
) => {
  if (!snapshot) return null;

  return (
    <div className={`mt-2 p-3 rounded text-xs ${accentClass}`}>
      <strong>{label}</strong>
      <div className="mt-1 space-y-1">
        {snapshot.start_time && (
          <div>Start: {format(new Date(snapshot.start_time), 'PPp')}</div>
        )}
        {snapshot.end_time && (
          <div>End: {format(new Date(snapshot.end_time), 'PPp')}</div>
        )}
        {snapshot.position && (
          <div>Position: {snapshot.position}</div>
        )}
      </div>
    </div>
  );
};

export const ChangeLogDialog = ({
  open,
  onOpenChange,
  changeLogs,
  loading,
}: ChangeLogDialogProps) => {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Clock className="h-5 w-5 text-primary" />
            Schedule Change History
          </DialogTitle>
          <DialogDescription>
            View all changes made to published schedules
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="max-h-[500px] pr-4">
          {loading ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <Card key={i}>
                  <CardContent className="p-4">
                    <Skeleton className="h-4 w-full mb-2" />
                    <Skeleton className="h-3 w-3/4" />
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : changeLogs.length === 0 ? (
            <Card className="bg-gradient-to-br from-muted/50 to-transparent">
              <CardContent className="py-12 text-center">
                <Lock className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                <h3 className="text-lg font-semibold mb-2">No Changes Yet</h3>
                <p className="text-muted-foreground text-sm">
                  Changes to published schedules will appear here.
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {changeLogs.map((log) => (
                <Card key={log.id} className="border-l-4 border-l-primary">
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1 space-y-2">
                        <div className="flex items-center gap-2">
                          <Badge variant={getChangeBadgeVariant(log.change_type)}>
                            {getChangeIcon(log.change_type)}
                            <span className="ml-1 capitalize">{log.change_type}</span>
                          </Badge>
                          {log.employee && (
                            <span className="text-sm font-medium">
                              {log.employee.name}
                            </span>
                          )}
                        </div>

                        <div className="text-xs text-muted-foreground flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          {format(new Date(log.changed_at), 'PPpp')}
                        </div>

                        {log.reason && (
                          <div className="text-sm text-muted-foreground italic">
                            Reason: {log.reason}
                          </div>
                        )}

                        {/* Show formatted before/after data */}
                        {log.change_type === 'updated' && log.before_data && log.after_data && (
                          <div className="mt-2 p-3 bg-muted/50 rounded text-xs space-y-2">
                            <div className="grid grid-cols-2 gap-2">
                              {renderShiftSnapshot(log.before_data, 'Before:', 'text-red-700 dark:text-red-400')}
                              {renderShiftSnapshot(log.after_data, 'After:', 'text-green-700 dark:text-green-400')}
                            </div>
                          </div>
                        )}

                        {log.change_type === 'deleted' &&
                          renderShiftSnapshot(
                            log.before_data,
                            'Deleted shift:',
                            'bg-red-50 dark:bg-red-950/20 text-red-700 dark:text-red-400'
                          )}

                        {log.change_type === 'created' &&
                          renderShiftSnapshot(
                            log.after_data,
                            'New shift:',
                            'bg-green-50 dark:bg-green-950/20 text-green-700 dark:text-green-400'
                          )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
};
