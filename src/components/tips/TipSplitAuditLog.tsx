import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { format } from 'date-fns';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { AlertCircle, History } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

interface AuditEntry {
  id: string;
  tip_split_id: string;
  action: 'created' | 'approved' | 'reopened' | 'modified' | 'archived' | 'deleted';
  changed_by: string | null;
  changed_at: string;
  changes: Record<string, { old: unknown; new: unknown }> | null;
  reason: string | null;
}

interface User {
  email: string;
}

interface AuditEntryWithUser extends AuditEntry {
  user?: User;
}

interface TipSplitAuditLogProps {
  splitId: string;
}

/**
 * Display audit trail for a tip split
 * Shows who created, approved, reopened, or modified the split
 */
export const TipSplitAuditLog = ({ splitId }: TipSplitAuditLogProps) => {
  const { data: auditLog, isLoading, error } = useQuery<AuditEntryWithUser[]>({
    queryKey: ['tip-split-audit', splitId],
    queryFn: async () => {
      // @ts-expect-error - tip_split_audit table not yet in generated types
      const { data, error } = await supabase.from('tip_split_audit').select('*').eq('tip_split_id', splitId).order('changed_at', { ascending: false });

      if (error) throw error;

      // Fetch user emails for each entry
      const userIds = [...new Set((data as unknown as AuditEntry[])?.map(e => e.changed_by).filter(Boolean))] as string[];
      
      if (userIds.length > 0) {
        const { data: users } = await supabase
          .from('profiles')
          .select('id, email')
          .in('id', userIds);

        // Map emails to audit entries
        return (data as unknown as AuditEntry[])?.map(entry => ({
          ...entry,
          user: users?.find(u => u.id === entry.changed_by) as User | undefined,
        })) || [];
      }

      return (data as unknown as AuditEntry[]) || [];
    },
    enabled: !!splitId,
    staleTime: 30000,
  });

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
                    {entry.user?.email || 'System'}
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
