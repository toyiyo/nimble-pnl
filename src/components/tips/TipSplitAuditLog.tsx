import { format } from 'date-fns';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { AlertCircle, History } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useTipSplitAuditLog } from '@/hooks/useTipSplitAuditLog';

interface TipSplitAuditLogProps {
  splitId: string;
}

/**
 * Display audit trail for a tip split
 * Shows who created, approved, reopened, or modified the split
 */
export const TipSplitAuditLog = ({ splitId }: TipSplitAuditLogProps) => {
  const { data: auditLog, isLoading, error } = useTipSplitAuditLog(splitId);

  if (isLoading) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-8 w-full" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center gap-2 text-sm text-destructive">
        <AlertCircle className="h-4 w-4" />
        <span>Failed to load audit trail</span>
      </div>
    );
  }

  if (!auditLog || auditLog.length === 0) {
    return (
      <div className="text-sm text-muted-foreground">
        No audit history available
      </div>
    );
  }

  // Action badge colors
  const getActionVariant = (action: string): 'default' | 'outline' | 'secondary' | 'destructive' => {
    switch (action) {
      case 'created': return 'outline';
      case 'approved': return 'default';
      case 'reopened': return 'secondary';
      case 'modified': return 'secondary';
      case 'deleted': return 'destructive';
      default: return 'outline';
    }
  };

  return (
    <Card className="bg-gradient-to-br from-muted/30 to-transparent">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2">
          <History className="h-4 w-4" />
          Audit Trail
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {auditLog.map(entry => (
            <div key={entry.id} className="flex items-start gap-3 text-sm border-l-2 border-muted pl-3 py-1">
              <Badge variant={getActionVariant(entry.action)} className="mt-0.5">
                {entry.action}
              </Badge>
              <div className="flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium">
                    {entry.user?.full_name || entry.user?.email || 'System'}
                  </span>
                  <span className="text-muted-foreground">
                    {format(new Date(entry.changed_at), 'MMM d, h:mm a')}
                  </span>
                </div>
                {entry.reason && (
                  <p className="text-muted-foreground mt-1 text-xs italic">
                    {entry.reason}
                  </p>
                )}
                {entry.changes && (
                  <div className="mt-1 text-xs text-muted-foreground">
                    {Object.entries(entry.changes).map(([field, change]) => {
                      const changeObj = change as { old: unknown; new: unknown };
                      return (
                        <div key={field}>
                          {field}: {JSON.stringify(changeObj.old)} → {JSON.stringify(changeObj.new)}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
};
