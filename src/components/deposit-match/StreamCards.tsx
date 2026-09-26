import { Settings2 } from 'lucide-react';

import { formatCurrency } from '@/lib/utils';
import { settlingAmount } from '@/types/depositMatch';
import type { DepositMatchStreamSummary } from '@/types/depositMatch';

interface StreamCardsProps {
  streams: DepositMatchStreamSummary[];
  activeStreamId: string | null;
  onSelectStream: (ruleId: string) => void;
  onEditStream: (ruleId: string) => void;
}

/**
 * One card per rule, driven entirely by the report payload — the UI
 * hardcodes no POS source name, only the `pos_source` string it is given.
 */
export function StreamCards({ streams, activeStreamId, onSelectStream, onEditStream }: StreamCardsProps) {
  if (streams.length === 0) return null;

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
      {streams.map((stream) => {
        const isActive = stream.rule_id === activeStreamId;
        const remaining = settlingAmount(stream);
        return (
          <div
            key={stream.rule_id}
            className={`group relative rounded-xl border transition-colors ${
              isActive ? 'border-foreground/40 bg-muted/40' : 'border-border/40 bg-background hover:border-border'
            } ${!stream.active ? 'opacity-60' : ''}`}
          >
            <button
              type="button"
              onClick={() => onSelectStream(stream.rule_id)}
              aria-pressed={isActive}
              className="w-full text-left p-4"
            >
              <div className="flex items-center justify-between gap-2 pr-6">
                <p className="text-[14px] font-medium text-foreground">{stream.pos_source}</p>
                {!stream.active && (
                  <span className="text-[11px] px-1.5 py-0.5 rounded-md bg-muted text-muted-foreground">
                    Inactive
                  </span>
                )}
              </div>
              <p className="text-[17px] font-semibold text-foreground mt-1">
                {formatCurrency(stream.received_total)}
              </p>
              <p className="text-[12px] text-muted-foreground mt-0.5">
                of {formatCurrency(stream.expected_total)} expected
                {remaining > 0.005 ? ` · ${formatCurrency(remaining)} settling` : ''}
              </p>
              <p className="text-[12px] text-muted-foreground">{stream.item_count} days</p>
            </button>
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onEditStream(stream.rule_id);
              }}
              aria-label={`Edit the ${stream.pos_source} rule`}
              className="absolute top-3 right-3 h-6 w-6 rounded-md flex items-center justify-center text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-foreground hover:bg-muted transition-colors"
            >
              <Settings2 className="h-3.5 w-3.5" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
