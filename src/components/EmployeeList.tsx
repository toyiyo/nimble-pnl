import { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Users, UserX, UsersRound, Plus, RotateCcw, UserMinus, HelpCircle, Send } from 'lucide-react';
import { useEmployees, EmployeeStatusFilter } from '@/hooks/useEmployees';
import { useGustoConnection } from '@/hooks/useGustoConnection';
import { useGustoEmployeeSync } from '@/hooks/useGustoEmployeeSync';
import { Employee } from '@/types/scheduling';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface EmployeeListProps {
  restaurantId: string;
  onEmployeeEdit?: (employee: Employee) => void;
  onEmployeeDeactivate?: (employee: Employee) => void;
  onEmployeeReactivate?: (employee: Employee) => void;
  onAddEmployee?: () => void;
  showInactiveCount?: boolean;
}

export function EmployeeList({
  restaurantId,
  onEmployeeEdit,
  onEmployeeDeactivate,
  onEmployeeReactivate,
  onAddEmployee,
  showInactiveCount = true
}: EmployeeListProps) {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<EmployeeStatusFilter>('active');

  const { employees, loading, error } = useEmployees(restaurantId, { status: activeTab });

  const { connection: gustoConnection } = useGustoConnection(restaurantId);
  const hasGusto = !!gustoConnection;
  const gustoSync = useGustoEmployeeSync(hasGusto ? restaurantId : null);

  const syncEmployees = gustoSync?.syncEmployees;
  const handleSendToGusto = useCallback(async (employeeId: string) => {
    if (!syncEmployees) return;
    await syncEmployees([employeeId]);
  }, [syncEmployees]);

  const { employees: allActive } = useEmployees(restaurantId, { status: 'active' });
  const { employees: allInactive } = useEmployees(restaurantId, { status: 'inactive' });

  const activeCount = allActive?.length || 0;
  const inactiveCount = allInactive?.length || 0;

  if (error) {
    return (
      <Card>
        <CardContent className="py-8">
          <p className="text-center text-destructive">Failed to load employees</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Users className="h-5 w-5" />
                Employees
              </CardTitle>
              <CardDescription>
                Manage your restaurant staff
              </CardDescription>
            </div>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button 
                    variant="ghost" 
                    size="icon"
                    className="h-8 w-8"
                    onClick={() => navigate('/help/payroll-calculations')}
                    aria-label="Learn how payroll is calculated"
                  >
                    <HelpCircle className="h-4 w-4 text-muted-foreground" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>How payroll is calculated</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
          {onAddEmployee && (
            <Button onClick={onAddEmployee}>
              <Plus className="h-4 w-4 mr-2" />
              Add Employee
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent>
        <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as EmployeeStatusFilter)}>
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="active" className="flex items-center gap-2">
              <Users className="h-4 w-4" />
              Active
              {showInactiveCount && activeCount > 0 && (
                <Badge variant="secondary" className="ml-1">
                  {activeCount}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="inactive" className="flex items-center gap-2">
              <UserX className="h-4 w-4" />
              Inactive
              {showInactiveCount && inactiveCount > 0 && (
                <Badge variant="secondary" className="ml-1">
                  {inactiveCount}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="all" className="flex items-center gap-2">
              <UsersRound className="h-4 w-4" />
              All
            </TabsTrigger>
          </TabsList>

          {(['active', 'inactive', 'all'] as const).map((tab) => {
            const emptyConfig = {
              active: { icon: Users, title: 'No active employees', description: 'Get started by adding your first employee.', showAction: true },
              inactive: { icon: UserX, title: 'No inactive employees', description: 'Deactivated employees will appear here. They can be reactivated at any time.', showAction: false },
              all: { icon: UsersRound, title: 'No employees', description: 'Get started by adding your first employee.', showAction: true },
            }[tab];

            return (
              <TabsContent key={tab} value={tab} className="space-y-2 mt-4">
                {loading ? (
                  <EmployeeListSkeleton />
                ) : employees.length === 0 ? (
                  <EmptyState
                    icon={emptyConfig.icon}
                    title={emptyConfig.title}
                    description={emptyConfig.description}
                    actionLabel={emptyConfig.showAction && onAddEmployee ? 'Add Employee' : undefined}
                    onAction={emptyConfig.showAction ? onAddEmployee : undefined}
                  />
                ) : (
                  <div className="space-y-2">
                    {employees.map((employee) => {
                      const isActive = tab === 'active' || (tab === 'all' && employee.is_active);
                      const isInactive = tab === 'inactive' || (tab === 'all' && !employee.is_active);

                      return (
                        <EmployeeCard
                          key={employee.id}
                          employee={employee}
                          onEdit={onEmployeeEdit}
                          onDeactivate={isActive ? onEmployeeDeactivate : undefined}
                          onReactivate={isInactive ? onEmployeeReactivate : undefined}
                          hasGusto={hasGusto}
                          onSendToGusto={hasGusto && isActive ? handleSendToGusto : undefined}
                          variant={isActive ? 'active' : 'inactive'}
                        />
                      );
                    })}
                  </div>
                )}
              </TabsContent>
            );
          })}
        </Tabs>
      </CardContent>
    </Card>
  );
}

interface EmployeeCardProps {
  employee: Employee;
  onEdit?: (employee: Employee) => void;
  onDeactivate?: (employee: Employee) => void;
  onReactivate?: (employee: Employee) => void;
  hasGusto?: boolean;
  onSendToGusto?: (employeeId: string) => void;
  variant: 'active' | 'inactive';
}

function EmployeeCard({ employee, onEdit, onDeactivate, onReactivate, hasGusto, onSendToGusto, variant }: EmployeeCardProps) {
  function formatCurrency(cents: number): string {
    return `$${(cents / 100).toFixed(2)}`;
  }

  function getCompensationDisplay(): string {
    switch (employee.compensation_type) {
      case 'hourly':
        return `${formatCurrency(employee.hourly_rate)}/hr`;
      case 'salary':
        return `${formatCurrency(employee.salary_amount || 0)}/${employee.pay_period_type}`;
      case 'contractor':
        return `${formatCurrency(employee.contractor_payment_amount || 0)}/${employee.contractor_payment_interval}`;
      default:
        return '';
    }
  }

  function getDeactivationInfo(): string | null {
    const dateToUse = employee.last_active_date || employee.deactivated_at;
    if (!dateToUse) return null;

    const date = format(new Date(dateToUse), 'MMM d, yyyy');
    const label = employee.last_active_date ? 'Last active' : 'Deactivated';
    return `${label}: ${date}`;
  }

  const deactivationInfo = getDeactivationInfo();

  return (
    <Card
      className={cn(
        'transition-all',
        variant === 'active' 
          ? 'bg-card border-border' 
          : 'bg-muted/30 border-muted opacity-75'
      )}
    >
      <CardContent className="p-4">
        <div className="flex items-center gap-4">
          {/* Avatar/Initials */}
          <div className={cn(
            'flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-semibold',
            variant === 'active' 
              ? 'bg-primary/10 text-primary' 
              : 'bg-muted text-muted-foreground'
          )}>
            {employee.name
              .split(' ')
              .map((n) => n[0])
              .join('')
              .toUpperCase()
              .slice(0, 2)}
          </div>

          {/* Employee Info */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h4 className="font-semibold truncate">{employee.name}</h4>
              {variant === 'inactive' && (
                <Badge variant="secondary" className="shrink-0">
                  Inactive
                </Badge>
              )}
              {hasGusto && variant === 'active' && (
                <GustoSyncBadge employee={employee} />
              )}
            </div>
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <span className="truncate">{employee.position}</span>
              <span>•</span>
              <span className="shrink-0">{getCompensationDisplay()}</span>
            </div>
            {variant === 'inactive' && employee.deactivation_reason && (
              <div className="text-xs text-muted-foreground mt-1">
                Reason: {employee.deactivation_reason}
              </div>
            )}
            {variant === 'inactive' && deactivationInfo && (
              <div className="text-xs text-muted-foreground mt-0.5">{deactivationInfo}</div>
            )}
          </div>

          {/* Action Buttons */}
          <div className="flex items-center gap-2 shrink-0">
            {onEdit && (
              <Button
                variant="outline"
                size="sm"
                onClick={(e) => {
                  e.stopPropagation();
                  onEdit(employee);
                }}
                aria-label={`Edit ${employee.name}`}
              >
                Edit
              </Button>
            )}
            {onDeactivate && variant === 'active' && (
              <Button
                variant="outline"
                size="sm"
                onClick={(e) => {
                  e.stopPropagation();
                  onDeactivate(employee);
                }}
                aria-label={`Deactivate ${employee.name}`}
              >
                <UserMinus className="h-4 w-4 mr-2" />
                Deactivate
              </Button>
            )}
            {onReactivate && variant === 'inactive' && (
              <Button
                variant="outline"
                size="sm"
                onClick={(e) => {
                  e.stopPropagation();
                  onReactivate(employee);
                }}
                aria-label={`Reactivate ${employee.name}`}
              >
                <RotateCcw className="h-4 w-4 mr-2" />
                Reactivate
              </Button>
            )}
            {onSendToGusto && variant === 'active' && !employee.gusto_employee_uuid && (
              employee.email ? (
                <Button
                  variant="outline"
                  size="sm"
                  className="text-[13px]"
                  onClick={(e) => {
                    e.stopPropagation();
                    onSendToGusto(employee.id);
                  }}
                  aria-label={`Send ${employee.name} to Gusto`}
                >
                  <Send className="h-4 w-4 mr-2" />
                  Send to Gusto
                </Button>
              ) : (
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span>
                        <Button
                          variant="outline"
                          size="sm"
                          className="text-[13px]"
                          disabled
                          aria-label={`Send ${employee.name} to Gusto (email required)`}
                        >
                          <Send className="h-4 w-4 mr-2" />
                          Send to Gusto
                        </Button>
                      </span>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>Email address required to send to Gusto</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              )
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function GustoSyncBadge({ employee }: { employee: Employee }) {
  if (!employee.gusto_employee_uuid || employee.gusto_sync_status === 'not_synced') {
    return (
      <Badge variant="outline" className="shrink-0 text-[11px] text-muted-foreground">
        Not synced
      </Badge>
    );
  }

  if (employee.gusto_onboarding_status === 'onboarding_completed') {
    return (
      <Badge variant="outline" className="shrink-0 text-[11px] text-emerald-600 border-emerald-200 bg-emerald-50 dark:bg-emerald-950/30 dark:border-emerald-800">
        Onboarded
      </Badge>
    );
  }

  return (
    <Badge variant="outline" className="shrink-0 text-[11px] text-amber-600 border-amber-200 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-800">
      Pending onboarding
    </Badge>
  );
}

function EmployeeListSkeleton() {
  return (
    <div className="space-y-2">
      {[1, 2, 3].map((i) => (
        <div key={i} className="flex items-center gap-4 p-4 rounded-lg border">
          <Skeleton className="h-10 w-10 rounded-full" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-3 w-48" />
          </div>
        </div>
      ))}
    </div>
  );
}

interface EmptyStateProps {
  icon: React.ElementType;
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
}

function EmptyState({ icon: Icon, title, description, actionLabel, onAction }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      <Icon className="h-12 w-12 text-muted-foreground mb-4" />
      <h3 className="text-lg font-semibold mb-2">{title}</h3>
      <p className="text-sm text-muted-foreground mb-4 max-w-sm">{description}</p>
      {actionLabel && onAction && (
        <Button onClick={onAction} variant="outline">
          <Plus className="h-4 w-4 mr-2" />
          {actionLabel}
        </Button>
      )}
    </div>
  );
}
