import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ArrowRightLeft, CheckCircle, Loader2, UserPlus } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { useQueryClient } from '@tanstack/react-query';

interface LocalEmployee {
  id: string;
  name: string;
  email: string | null;
  gusto_employee_uuid: string | null;
}

interface GustoEmployeeMappingDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  restaurantId: string;
}

export const GustoEmployeeMappingDialog = ({
  open,
  onOpenChange,
  restaurantId,
}: GustoEmployeeMappingDialogProps) => {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [localEmployees, setLocalEmployees] = useState<LocalEmployee[]>([]);
  const [unmatchedLocalActions, setUnmatchedLocalActions] = useState<
    Map<string, 'push' | 'skip'>
  >(new Map());

  useEffect(() => {
    if (!open) return;
    fetchData();
  }, [open, restaurantId]);

  const fetchData = async () => {
    setLoading(true);
    try {
      await supabase.functions.invoke('gusto-pull-employees', {
        body: { restaurantId, syncMode: 'status_only' },
      });

      const { data: locals, error: localError } = await supabase
        .from('employees')
        .select('id, name, email, gusto_employee_uuid')
        .eq('restaurant_id', restaurantId)
        .eq('is_active', true);

      if (localError) throw localError;

      const unmatchedLocals = ((locals as unknown as LocalEmployee[]) || []).filter(
        (l) => !l.gusto_employee_uuid
      );

      setLocalEmployees(unmatchedLocals);

      const defaultActions = new Map<string, 'push' | 'skip'>();
      unmatchedLocals.forEach((l) => {
        defaultActions.set(l.id, 'push');
      });
      setUnmatchedLocalActions(defaultActions);
    } catch (err) {
      console.error('Failed to fetch mapping data:', err);
      toast({
        title: 'Error',
        description: 'Failed to load employee data for mapping',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const handleConfirm = async () => {
    setSaving(true);
    try {
      const employeeIdsToPush: string[] = [];

      for (const [localId, action] of unmatchedLocalActions) {
        if (action === 'push') {
          employeeIdsToPush.push(localId);
        }
      }

      if (employeeIdsToPush.length > 0) {
        await supabase.functions.invoke('gusto-sync-employees', {
          body: { restaurantId, employeeIds: employeeIdsToPush, selfOnboarding: true },
        });
      }

      await queryClient.invalidateQueries({ queryKey: ['employees'] });

      toast({
        title: 'Mapping Complete',
        description: `Pushed ${employeeIdsToPush.length} employee${employeeIdsToPush.length !== 1 ? 's' : ''} to Gusto`,
      });

      onOpenChange(false);
    } catch (err) {
      console.error('Mapping failed:', err);
      toast({
        title: 'Mapping Failed',
        description: 'Some employee mappings could not be completed',
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  const pushCount = Array.from(unmatchedLocalActions.values()).filter(
    (a) => a === 'push'
  ).length;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto p-0 gap-0 border-border/40">
        <DialogHeader className="px-6 pt-6 pb-4 border-b border-border/40">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-muted/50 flex items-center justify-center">
              <ArrowRightLeft className="h-5 w-5 text-foreground" />
            </div>
            <div>
              <DialogTitle className="text-[17px] font-semibold text-foreground">
                Map Employees to Gusto
              </DialogTitle>
              <p className="text-[13px] text-muted-foreground mt-0.5">
                Link your existing employees with their Gusto accounts
              </p>
            </div>
          </div>
        </DialogHeader>

        <div className="px-6 py-5 space-y-5">
          {loading ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-14 w-full rounded-lg" />
              ))}
            </div>
          ) : localEmployees.length === 0 ? (
            <div className="text-center py-8">
              <CheckCircle className="h-12 w-12 text-emerald-500 mx-auto mb-3" />
              <h3 className="text-[15px] font-semibold mb-1">All Employees Mapped</h3>
              <p className="text-[13px] text-muted-foreground">
                All your employees are already linked to Gusto.
              </p>
            </div>
          ) : (
            <div>
              <h3 className="text-[13px] font-semibold text-foreground mb-3 flex items-center gap-2">
                <UserPlus className="h-4 w-4 text-amber-500" />
                Unmatched Local Employees ({localEmployees.length})
              </h3>
              <div className="space-y-2">
                {localEmployees.map((emp) => {
                  const action = unmatchedLocalActions.get(emp.id) || 'push';
                  return (
                    <div
                      key={emp.id}
                      className="flex items-center justify-between p-3 rounded-lg border border-amber-200 bg-amber-50/50 dark:bg-amber-950/20 dark:border-amber-800"
                    >
                      <div>
                        <span className="text-[14px] font-medium">{emp.name}</span>
                        {emp.email && (
                          <span className="text-[13px] text-muted-foreground ml-2">
                            {emp.email}
                          </span>
                        )}
                        {!emp.email && (
                          <Badge
                            variant="outline"
                            className="ml-2 text-[11px] text-muted-foreground"
                          >
                            No email
                          </Badge>
                        )}
                      </div>
                      <Select
                        value={action}
                        onValueChange={(val) => {
                          setUnmatchedLocalActions((prev) => {
                            const next = new Map(prev);
                            next.set(emp.id, val as 'push' | 'skip');
                            return next;
                          });
                        }}
                      >
                        <SelectTrigger className="w-[160px] h-8 text-[13px]">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="push">Push to Gusto</SelectItem>
                          <SelectItem value="skip">Skip</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        <DialogFooter className="px-6 py-4 border-t border-border/40">
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            className="text-[13px]"
          >
            Cancel
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={saving || loading || pushCount === 0}
            className="h-9 px-4 rounded-lg bg-foreground text-background hover:bg-foreground/90 text-[13px] font-medium"
          >
            {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            {pushCount > 0 ? `Push ${pushCount} to Gusto` : 'Confirm Mapping'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
