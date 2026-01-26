import { useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { AlertTriangle, AlertCircle, Edit, ChevronRight } from 'lucide-react';
import { EmployeeLaborCost } from '@/hooks/useEmployeeLaborCosts';
import { cn } from '@/lib/utils';

interface LaborCostBreakdownProps {
  employeeCosts: EmployeeLaborCost[];
  onEditEmployee: (employeeId: string) => void;
  maxItems?: number;
  showViewAll?: boolean;
  onViewAll?: () => void;
}

export const LaborCostBreakdown = ({
  employeeCosts,
  onEditEmployee,
  maxItems = 5,
  showViewAll = true,
  onViewAll,
}: LaborCostBreakdownProps) => {
  const topEarners = useMemo(() => {
    return employeeCosts.slice(0, maxItems);
  }, [employeeCosts, maxItems]);

  const hasMoreItems = employeeCosts.length > maxItems;

  if (topEarners.length === 0) {
    return null;
  }

  return (
    <div className="space-y-2">
      <div className="text-xs font-medium text-muted-foreground">Top Earners</div>
      <div className="space-y-1.5">
        {topEarners.map((emp) => (
          <button
            key={emp.id}
            onClick={() => onEditEmployee(emp.id)}
            className={cn(
              "w-full flex items-center justify-between p-2 rounded-md text-left transition-colors",
              "hover:bg-accent/50 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1",
              emp.outlierLevel === 'critical' && "bg-destructive/10 border border-destructive/30",
              emp.outlierLevel === 'warning' && "bg-secondary/50 border border-secondary",
              emp.outlierLevel === 'none' && "bg-muted/30"
            )}
            aria-label={`Edit ${emp.name}'s rate`}
          >
            <div className="flex items-center gap-2 min-w-0">
              {emp.outlierLevel === 'critical' && (
                <AlertCircle className="h-4 w-4 text-destructive shrink-0" aria-hidden="true" />
              )}
              {emp.outlierLevel === 'warning' && (
                <AlertTriangle className="h-4 w-4 text-accent-foreground shrink-0" aria-hidden="true" />
              )}
              <div className="min-w-0">
                <div className="text-sm font-medium truncate">{emp.name}</div>
                <div className="text-xs text-muted-foreground">
                  {emp.hours.toFixed(1)}h × ${emp.rate.toFixed(2)}/hr
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <span className={cn(
                "text-sm font-semibold",
                emp.outlierLevel === 'critical' && "text-destructive",
                emp.outlierLevel === 'warning' && "text-accent-foreground"
              )}>
                ${emp.cost.toFixed(2)}
              </span>
              <Edit className="h-3.5 w-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
            </div>
          </button>
        ))}
      </div>
      
      {showViewAll && hasMoreItems && onViewAll && (
        <Button
          variant="ghost"
          size="sm"
          className="w-full text-xs text-muted-foreground hover:text-foreground"
          onClick={onViewAll}
        >
          View All Employees
          <ChevronRight className="h-3.5 w-3.5 ml-1" />
        </Button>
      )}
    </div>
  );
};
