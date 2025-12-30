import { ProductionRun, ProductionRunStatus } from '@/hooks/useProductionRuns';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { CalendarClock, ChevronRight, Clock3, User2 } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ProductionRunCardProps {
  run: ProductionRun;
  onClick?: () => void;
}

const statusTone: Record<ProductionRunStatus, string> = {
  completed: 'bg-emerald-100 text-emerald-800 border-emerald-200',
  in_progress: 'bg-amber-100 text-amber-800 border-amber-200',
  planned: 'bg-blue-100 text-blue-800 border-blue-200',
  cancelled: 'bg-destructive/10 text-destructive border-destructive/40',
  draft: 'bg-muted text-muted-foreground border-border',
};

export function ProductionRunCard({ run, onClick }: ProductionRunCardProps) {
  const variance = run.target_yield
    ? run.target_yield !== 0
      ? ((run.actual_yield ?? run.target_yield) - run.target_yield) / run.target_yield * 100
      : null
    : null;

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if ((e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') && onClick) {
      if (e.key === ' ' || e.key === 'Spacebar') {
        e.preventDefault();
      }
      onClick();
    }
  };

  return (
    <Card
      className="hover:shadow-md transition-all duration-200 cursor-pointer border-border/70"
      onClick={onClick}
      onKeyDown={handleKeyDown}
      role="button"
      tabIndex={0}
    >
      <CardContent className="p-4 md:p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-2">
            <div className="flex items-center gap-2 flex-wrap">
              <Badge variant="outline" className={cn('rounded-full text-xs', statusTone[run.status])}>
                {run.status.replace('_', ' ')}
              </Badge>
              <Badge variant="outline" className="rounded-full text-xs">
                Target {run.target_yield} {run.target_yield_unit}
              </Badge>
              {run.actual_yield && (
                <Badge variant="secondary" className="rounded-full text-xs">
                  Actual {run.actual_yield} {run.actual_yield_unit || run.target_yield_unit}
                </Badge>
              )}
              {variance !== null && run.status === 'completed' && (
                <Badge
                  variant="outline"
                  className={cn(
                    'rounded-full text-xs',
                    variance < 0 ? 'text-amber-700 border-amber-200 bg-amber-50' : 'text-emerald-700 border-emerald-200 bg-emerald-50'
                  )}
                >
                  {variance > 0 ? '+' : ''}
                  {variance.toFixed(1)}% yield
                </Badge>
              )}
            </div>
            <div>
              <p className="font-semibold text-lg leading-tight">{run.prep_recipe?.name || 'Batch'}</p>
              <p className="text-sm text-muted-foreground">{run.prep_recipe?.description}</p>
            </div>

            <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
              <div className="flex items-center gap-1">
                <Clock3 className="h-4 w-4" />
                {run.completed_at
                  ? `Completed ${new Date(run.completed_at).toLocaleString()}`
                  : run.started_at
                    ? `Started ${new Date(run.started_at).toLocaleString()}`
                    : 'Not started'}
              </div>
              <div className="flex items-center gap-1">
                <CalendarClock className="h-4 w-4" />
                {run.scheduled_for ? `Scheduled ${new Date(run.scheduled_for).toLocaleString()}` : 'Unscheduled'}
              </div>
              {run.prepared_by && (
                <div className="flex items-center gap-1">
                  <User2 className="h-4 w-4" />
                  Prepared by {run.prepared_by}
                </div>
              )}
            </div>
          </div>

          <ChevronRight className="h-5 w-5 text-muted-foreground flex-shrink-0 mt-1" />
        </div>
      </CardContent>
    </Card>
  );
}
