import { TimeOffRow } from './TimeOffRow';
import { CalendarCheck, Inbox } from 'lucide-react';
import { TimeOffRequest } from '@/types/scheduling';

interface PendingQueueProps {
  requests: TimeOffRequest[];
  now?: Date;
  onApprove: (request: TimeOffRequest) => void;
  onReject: (request: TimeOffRequest) => void;
  onEdit: (request: TimeOffRequest) => void;
  onDelete: (request: TimeOffRequest) => void;
  isApproving?: boolean;
  isRejecting?: boolean;
}

export function PendingQueue({
  requests,
  now,
  onApprove,
  onReject,
  onEdit,
  onDelete,
  isApproving,
  isRejecting,
}: PendingQueueProps) {
  return (
    <section
      aria-label="Pending time-off requests"
      className="rounded-xl border border-amber-500/20 bg-amber-500/5 overflow-hidden"
    >
      <header className="flex items-center justify-between px-5 py-3 border-b border-amber-500/15 bg-amber-500/10">
        <div className="flex items-center gap-3">
          <div className="h-8 w-8 rounded-lg bg-amber-500/15 flex items-center justify-center">
            <Inbox className="h-4 w-4 text-amber-700" />
          </div>
          <h3 className="text-[14px] font-semibold text-foreground">Action needed</h3>
        </div>
        {requests.length > 0 && (
          <span className="text-[11px] font-medium text-amber-700 px-2 py-0.5 rounded-md bg-amber-500/15">
            {requests.length}
          </span>
        )}
      </header>

      {requests.length === 0 ? (
        <div className="flex flex-col items-center justify-center px-5 py-10 text-center">
          <CalendarCheck className="h-10 w-10 text-muted-foreground/60 mb-3" />
          <p className="text-[14px] font-medium text-foreground">You&apos;re all caught up</p>
          <p className="text-[13px] text-muted-foreground mt-1">No time-off requests waiting on a decision.</p>
        </div>
      ) : (
        <div className="px-3 py-3 space-y-2">
          {requests.map((r) => (
            <TimeOffRow
              key={r.id}
              variant="pending"
              request={r}
              now={now}
              onApprove={onApprove}
              onReject={onReject}
              onEdit={onEdit}
              onDelete={onDelete}
              isApproving={isApproving}
              isRejecting={isRejecting}
            />
          ))}
        </div>
      )}
    </section>
  );
}
