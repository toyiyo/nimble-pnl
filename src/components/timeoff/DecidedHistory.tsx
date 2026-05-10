import { useMemo, useState } from 'react';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { TimeOffRow } from './TimeOffRow';
import { ChevronDown, ChevronRight, History } from 'lucide-react';
import { TimeOffRequest } from '@/types/scheduling';

type Filter = 'all' | 'approved' | 'rejected';

interface DecidedHistoryProps {
  requests: TimeOffRequest[];
  onApprove: (request: TimeOffRequest) => void;
  onReject: (request: TimeOffRequest) => void;
  onEdit: (request: TimeOffRequest) => void;
  onDelete: (request: TimeOffRequest) => void;
}

const FILTERS: { value: Filter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'approved', label: 'Approved' },
  { value: 'rejected', label: 'Rejected' },
];

export function DecidedHistory({ requests, onApprove, onReject, onEdit, onDelete }: DecidedHistoryProps) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState<Filter>('all');

  const visible = useMemo(() => {
    if (filter === 'all') return requests;
    return requests.filter((r) => r.status === filter);
  }, [requests, filter]);

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="rounded-xl border border-border/40 bg-background overflow-hidden">
      <CollapsibleTrigger asChild>
        <button
          type="button"
          className="w-full flex items-center justify-between px-5 py-3 hover:bg-muted/30 transition-colors"
          aria-label={`Decided requests (${requests.length})`}
        >
          <span className="flex items-center gap-3">
            <span className="h-8 w-8 rounded-lg bg-muted/50 flex items-center justify-center">
              <History className="h-4 w-4 text-foreground" />
            </span>
            <span className="text-[14px] font-semibold text-foreground">Decided</span>
            <span className="text-[11px] font-medium text-muted-foreground px-2 py-0.5 rounded-md bg-muted">
              {requests.length}
            </span>
          </span>
          {open ? (
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          )}
        </button>
      </CollapsibleTrigger>

      <CollapsibleContent>
        <div className="px-5 py-3 border-t border-border/40 flex items-center gap-2">
          {FILTERS.map((f) => {
            const isActive = filter === f.value;
            return (
              <button
                key={f.value}
                type="button"
                onClick={() => setFilter(f.value)}
                aria-pressed={isActive}
                className={`text-[12px] font-medium px-3 py-1 rounded-full transition-colors ${
                  isActive
                    ? 'bg-foreground text-background'
                    : 'bg-muted/50 text-muted-foreground hover:bg-muted'
                }`}
              >
                {f.label}
              </button>
            );
          })}
        </div>

        <div className="px-3 py-3 space-y-2">
          {visible.length === 0 ? (
            <p className="text-[13px] text-muted-foreground text-center py-6">
              {requests.length === 0 ? 'No decided requests yet.' : 'No requests match this filter.'}
            </p>
          ) : (
            visible.map((r) => (
              <TimeOffRow
                key={r.id}
                variant="decided"
                request={r}
                onApprove={onApprove}
                onReject={onReject}
                onEdit={onEdit}
                onDelete={onDelete}
              />
            ))
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
