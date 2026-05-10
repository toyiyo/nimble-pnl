import { memo, useMemo } from 'react';
import { format } from 'date-fns';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Calendar, Check, X, Edit, Trash2, User, Clock } from 'lucide-react';
import { TimeOffRequest } from '@/types/scheduling';
import { parseDateLocal } from '@/lib/dateUtils';
import { daysSince } from '@/lib/timeOffUtils';

const REASON_PREVIEW_MAX = 80;

export type TimeOffRowVariant = 'pending' | 'decided';

interface TimeOffRowProps {
  variant: TimeOffRowVariant;
  request: TimeOffRequest;
  /** Injectable clock for deterministic tests. */
  now?: Date;
  onApprove: (request: TimeOffRequest) => void;
  onReject: (request: TimeOffRequest) => void;
  onEdit: (request: TimeOffRequest) => void;
  onDelete: (request: TimeOffRequest) => void;
  isApproving?: boolean;
  isRejecting?: boolean;
}

const STATUS_BADGE: Record<TimeOffRequest['status'], { label: string; className: string; icon: typeof Check }> = {
  approved: { label: 'Approved', className: 'bg-success/15 text-success border-success/30', icon: Check },
  rejected: { label: 'Rejected', className: 'bg-destructive/15 text-destructive border-destructive/30', icon: X },
  pending: { label: 'Pending', className: 'bg-warning/15 text-warning border-warning/30', icon: Clock },
};

function formatDaysAgo(days: number): string {
  if (days === 0) return 'requested today';
  if (days === 1) return 'requested 1 day ago';
  return `requested ${days} days ago`;
}

function truncate(text: string): { display: string; truncated: boolean } {
  if (text.length <= REASON_PREVIEW_MAX) return { display: text, truncated: false };
  return { display: `${text.slice(0, REASON_PREVIEW_MAX - 1).trimEnd()}…`, truncated: true };
}

export const TimeOffRow = memo(function TimeOffRow({
  variant,
  request,
  now,
  onApprove,
  onReject,
  onEdit,
  onDelete,
  isApproving,
  isRejecting,
}: TimeOffRowProps) {
  const days = useMemo(() => daysSince(request.created_at, now), [request.created_at, now]);
  const dateRange = useMemo(() => {
    const start = format(parseDateLocal(request.start_date), 'MMM d, yyyy');
    const end = format(parseDateLocal(request.end_date), 'MMM d, yyyy');
    return start === end ? start : `${start} – ${end}`;
  }, [request.start_date, request.end_date]);
  const reasonPreview = request.reason ? truncate(request.reason) : null;
  const isPending = variant === 'pending';

  return (
    <div className="group flex items-start gap-3 p-4 rounded-xl border border-border/40 bg-background hover:border-border transition-colors">
      <div className="h-10 w-10 rounded-xl bg-muted/50 flex items-center justify-center flex-shrink-0">
        <User className="h-5 w-5 text-foreground" />
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[14px] font-medium text-foreground truncate">
            {request.employee?.name || 'Unknown employee'}
          </span>
          {!isPending && (
            <Badge variant="outline" className={`text-[11px] ${STATUS_BADGE[request.status].className}`}>
              {STATUS_BADGE[request.status].label}
            </Badge>
          )}
          {isPending && (
            <span className="text-[12px] text-muted-foreground">{formatDaysAgo(days)}</span>
          )}
        </div>
        <div className="flex items-center gap-1 text-[13px] text-muted-foreground mt-1">
          <Calendar className="h-3 w-3" />
          <span>{dateRange}</span>
        </div>
        {reasonPreview && (
          <p
            className="text-[13px] text-muted-foreground mt-1.5"
            data-testid="time-off-row-reason"
            title={reasonPreview.truncated ? request.reason : undefined}
          >
            {reasonPreview.display}
          </p>
        )}
      </div>

      {isPending ? (
        <div className="flex items-center gap-2 flex-shrink-0">
          <Button
            type="button"
            size="sm"
            onClick={() => onApprove(request)}
            disabled={isApproving}
            className="h-9 px-3 rounded-lg bg-success text-success-foreground hover:bg-success/90 text-[13px] font-medium"
            aria-label={`Approve time-off for ${request.employee?.name ?? 'employee'}`}
          >
            <Check className="h-4 w-4 mr-1" />
            Approve
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => onReject(request)}
            disabled={isRejecting}
            className="h-9 px-3 rounded-lg text-[13px] font-medium"
            aria-label={`Reject time-off for ${request.employee?.name ?? 'employee'}`}
          >
            <X className="h-4 w-4 mr-1" />
            Reject
          </Button>
          <div className="flex opacity-0 group-hover:opacity-100 transition-opacity">
            <Button
              type="button"
              size="icon"
              variant="ghost"
              onClick={() => onEdit(request)}
              aria-label="Edit request"
              className="h-8 w-8"
            >
              <Edit className="h-4 w-4" />
            </Button>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              onClick={() => onDelete(request)}
              aria-label="Delete request"
              className="h-8 w-8 text-destructive hover:text-destructive/80"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
          <Button
            type="button"
            size="icon"
            variant="ghost"
            onClick={() => onDelete(request)}
            aria-label="Delete request"
            className="h-8 w-8 text-destructive hover:text-destructive/80"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      )}
    </div>
  );
});
