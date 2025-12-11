import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useEmployees, EmployeeStatusFilter } from '@/hooks/useEmployees';
import { Employee } from '@/types/scheduling';
import { Users, UserX, UsersRound, Plus, RotateCcw, Edit, UserMinus } from 'lucide-react';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';

interface EmployeeListProps {
  restaurantId: string;
  onEmployeeEdit?: (employee: Employee) => void;
  onEmployeeDeactivate?: (employee: Employee) => void;
  onEmployeeReactivate?: (employee: Employee) => void;
  onAddEmployee?: () => void;
  showInactiveCount?: boolean;
}

export const EmployeeList = ({ 
  restaurantId, 
  onEmployeeEdit,
  onEmployeeDeactivate,
  onEmployeeReactivate,
  onAddEmployee,
  showInactiveCount = true 
}: EmployeeListProps) => {
  const [activeTab, setActiveTab] = useState<EmployeeStatusFilter>('active');

  // Fetch employees based on active tab
  const { employees, loading, error } = useEmployees(restaurantId, { status: activeTab });

  // For showing counts, we need to fetch all separately
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
          <div>
            <CardTitle className="flex items-center gap-2">
              <Users className="h-5 w-5" />
              Employees
            </CardTitle>
            <CardDescription>
              Manage your restaurant staff
            </CardDescription>
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

          <TabsContent value="active" className="space-y-2 mt-4">
            {loading ? (
              <EmployeeListSkeleton />
            ) : employees.length === 0 ? (
              <EmptyState 
                icon={Users}
                title="No active employees"
                description="Get started by adding your first employee."
                actionLabel={onAddEmployee ? "Add Employee" : undefined}
                onAction={onAddEmployee}
              />
            ) : (
              <div className="space-y-2">
                {employees.map((employee) => (
                  <EmployeeCard
                    key={employee.id}
                    employee={employee}
                    onEdit={onEmployeeEdit}
                    onDeactivate={onEmployeeDeactivate}
                    variant="active"
                  />
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="inactive" className="space-y-2 mt-4">
            {loading ? (
              <EmployeeListSkeleton />
            ) : employees.length === 0 ? (
              <EmptyState 
                icon={UserX}
                title="No inactive employees"
                description="Deactivated employees will appear here. They can be reactivated at any time."
              />
            ) : (
              <div className="space-y-2">
                {employees.map((employee) => (
                  <EmployeeCard
                    key={employee.id}
                    employee={employee}
                    onEdit={onEmployeeEdit}
                    onReactivate={onEmployeeReactivate}
                    variant="inactive"
                  />
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="all" className="space-y-2 mt-4">
            {loading ? (
              <EmployeeListSkeleton />
            ) : employees.length === 0 ? (
              <EmptyState 
                icon={UsersRound}
                title="No employees"
                description="Get started by adding your first employee."
                actionLabel={onAddEmployee ? "Add Employee" : undefined}
                onAction={onAddEmployee}
              />
            ) : (
              <div className="space-y-2">
                {employees.map((employee) => (
                  <EmployeeCard
                    key={employee.id}
                    employee={employee}
                    onEdit={onEmployeeEdit}
                    onDeactivate={employee.is_active ? onEmployeeDeactivate : undefined}
                    onReactivate={!employee.is_active ? onEmployeeReactivate : undefined}
                    variant={employee.is_active ? 'active' : 'inactive'}
                  />
                ))}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
};

// Employee Card Component
interface EmployeeCardProps {
  employee: Employee;
  onEdit?: (employee: Employee) => void;
  onDeactivate?: (employee: Employee) => void;
  onReactivate?: (employee: Employee) => void;
  variant: 'active' | 'inactive';
}

const EmployeeCard = ({ employee, onEdit, onDeactivate, onReactivate, variant }: EmployeeCardProps) => {
  const formatCurrency = (cents: number) => {
    return `$${(cents / 100).toFixed(2)}`;
  };

  const getCompensationDisplay = () => {
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
  };

  const getDeactivationInfo = () => {
    // Prefer last_active_date, fall back to deactivated_at
    const dateToUse = employee.last_active_date || employee.deactivated_at;
    if (!dateToUse) return null;
    
    const date = format(new Date(dateToUse), 'MMM d, yyyy');
    
    // Use appropriate label based on which field we're displaying
    if (employee.last_active_date) {
      return `Last active: ${date}`;
    } else {
      return `Deactivated: ${date}`;
    }
  };

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
            {variant === 'inactive' && getDeactivationInfo() && (
              <div className="text-xs text-muted-foreground mt-0.5">
                {getDeactivationInfo()}
              </div>
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
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

// Skeleton Loader
const EmployeeListSkeleton = () => {
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
};

// Empty State Component
interface EmptyStateProps {
  icon: React.ElementType;
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
}

const EmptyState = ({ icon: Icon, title, description, actionLabel, onAction }: EmptyStateProps) => {
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
};
