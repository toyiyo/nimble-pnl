import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { KeyRound } from 'lucide-react';
import { format } from 'date-fns';
import { Employee } from '@/types/scheduling';
import { EmployeePinWithEmployee } from '@/hooks/useKioskPins';

interface EmployeePinsCardProps {
  employees: Employee[];
  pinLookup: Map<string, EmployeePinWithEmployee>;
  pinsLoading: boolean;
  isPinSaving: boolean;
  onSetPin: (employee: Employee) => void;
  onAutoGenerate: () => void;
}

export function EmployeePinsCard({
  employees,
  pinLookup,
  pinsLoading,
  isPinSaving,
  onSetPin,
  onAutoGenerate,
}: EmployeePinsCardProps) {
  const pinsSet = pinLookup.size;
  const missing = employees.filter((emp) => !pinLookup.get(emp.id)).length;

  return (
    <Card>
      <CardHeader className="pb-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-primary/10">
              <KeyRound className="h-5 w-5 text-primary" />
            </div>
            <div>
              <CardTitle className="text-lg">Employee PINs</CardTitle>
              <CardDescription>
                {pinsSet} employee{pinsSet !== 1 ? 's' : ''} have a PIN
              </CardDescription>
            </div>
          </div>
          {missing > 0 && (
            <Button size="sm" variant="outline" onClick={onAutoGenerate} disabled={pinsLoading || isPinSaving}>
              Generate {missing} missing
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {pinsLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-14 w-full" />
            <Skeleton className="h-14 w-full" />
          </div>
        ) : employees.length === 0 ? (
          <p className="text-sm text-muted-foreground">Add employees to start assigning PINs.</p>
        ) : (
          <div className="space-y-2 max-h-80 overflow-y-auto">
            {employees.map((emp) => {
              const pinRecord = pinLookup.get(emp.id);
              return (
                <div
                  key={emp.id}
                  className="flex items-center justify-between p-3 rounded-lg border bg-card hover:bg-muted/30 transition-colors"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="min-w-0">
                      <div className="font-medium truncate">{emp.name}</div>
                      <div className="text-xs text-muted-foreground truncate">{emp.position}</div>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      {pinRecord ? (
                        <Badge variant="outline" className="bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/20">
                          PIN set
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20">
                          Not set
                        </Badge>
                      )}
                      {pinRecord?.force_reset && (
                        <Badge variant="outline" className="bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/20 text-xs">
                          Reset
                        </Badge>
                      )}
                    </div>
                  </div>
                  <Button size="sm" variant="ghost" onClick={() => onSetPin(emp)} disabled={isPinSaving}>
                    {pinRecord ? 'Reset' : 'Set'}
                  </Button>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
