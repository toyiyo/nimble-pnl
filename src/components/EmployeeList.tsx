import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useEmployees, EmployeeStatusFilter } from '@/hooks/useEmployees';
import { Employee } from '@/types/scheduling';
import { Users, UserX, UsersRound, Plus, RotateCcw } from 'lucide-react';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';

interface EmployeeListProps {
  restaurantId: string;
  onEmployeeClick?: (employee: Employee) => void;
  onAddEmployee?: () => void;
  showInactiveCount?: boolean;
}

export const EmployeeList = ({ 
  restaurantId, 
  onEmployeeClick,
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
                    onClick={onEmployeeClick}
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
                    onClick={onEmployeeClick}
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
                    onClick={onEmployeeClick}
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
  onClick?: (employee: Employee) => void;
  variant: 'active' | 'inactive';
}

const EmployeeCard = ({ employee, onClick, variant }: EmployeeCardProps) => {
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
    if (!employee.deactivated_at) return null;
    
    const date = format(new Date(employee.deactivated_at), 'MMM d, yyyy');
    return `Last active: ${date}`;
  };

  return (
    <div
      className={cn(
        'flex items-center justify-between p-4 rounded-lg border transition-all cursor-pointer',
        variant === 'active' 
          ? 'bg-card hover:bg-accent/50 border-border' 
          : 'bg-muted/30 hover:bg-muted/50 border-muted opacity-75',
        onClick && 'hover:shadow-sm'
      )}
      onClick={() => onClick?.(employee)}
    >
      <div className="flex items-center gap-4 flex-1 min-w-0">
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

        {/* Reactivate hint for inactive employees */}
        {variant === 'inactive' && (
          <div className="hidden sm:flex items-center gap-2 text-sm text-muted-foreground">
            <RotateCcw className="h-4 w-4" />
            <span className="hidden md:inline">Click to reactivate</span>
          </div>
        )}
      </div>
    </div>
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
