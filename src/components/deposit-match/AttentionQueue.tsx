import { CheckCircle2 } from 'lucide-react';

import { sortAttentionQueue } from '@/lib/depositMatchUi';
import type { DepositMatchLedgerRow, DepositMatchReport } from '@/types/depositMatch';
import { StatusChip } from './StatusChip';

interface AttentionQueueProps {
  report: DepositMatchReport;
  onSelectItem: (row: DepositMatchLedgerRow) => void;
}

/** Exceptions across every stream, most urgent first. */
export function AttentionQueue({ report, onSelectItem }: AttentionQueueProps) {
  const queue = sortAttentionQueue(report.ledger);

  if (queue.length === 0) {
    return (
      <div className="rounded-xl border border-border/40 bg-muted/30 p-6 text-center">
        <CheckCircle2 className="h-6 w-6 text-emerald-600 mx-auto mb-2" aria-hidden="true" />
        <p className="text-[13px] text-muted-foreground">Nothing needs your attention.</p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-border/40 bg-background overflow-hidden">
      <div className="px-4 py-3 border-b border-border/40 bg-muted/50">
        <h3 className="text-[13px] font-semibold text-foreground">Needs attention ({queue.length})</h3>
      </div>
      <ul>
        {queue.map((row) => (
          <li key={row.item_id} className="border-b border-border/40 last:border-b-0">
            <button
              type="button"
              onClick={() => onSelectItem(row)}
              className="group flex w-full items-center justify-between gap-3 p-4 text-left hover:bg-muted/30 transition-colors"
            >
              <div className="min-w-0">
                <p className="text-[14px] font-medium text-foreground">
                  {row.business_date} &middot; {row.pos_source}
                </p>
                <p className="text-[12px] text-muted-foreground">
                  Expected ${row.expected_amount.toFixed(2)}, received ${row.received_amount.toFixed(2)}
                </p>
              </div>
              <StatusChip status={row.status} />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
