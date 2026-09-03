import { settlingAmount } from '@/types/depositMatch';
import type { DepositMatchStreamSummary } from '@/types/depositMatch';

interface StreamCardsProps {
  streams: DepositMatchStreamSummary[];
  activeStreamId: string | null;
  onSelectStream: (ruleId: string) => void;
}

function formatMoney(amount: number): string {
  return amount.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/**
 * One card per rule, driven entirely by the report payload — the UI
 * hardcodes no POS source name, only the `pos_source` string it is given.
 */
export function StreamCards({ streams, activeStreamId, onSelectStream }: StreamCardsProps) {
  if (streams.length === 0) return null;

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
      {streams.map((stream) => {
        const isActive = stream.rule_id === activeStreamId;
        const remaining = settlingAmount(stream);
        return (
          <button
            key={stream.rule_id}
            type="button"
            onClick={() => onSelectStream(stream.rule_id)}
            aria-pressed={isActive}
            className={`text-left p-4 rounded-xl border transition-colors ${
              isActive ? 'border-foreground/40 bg-muted/40' : 'border-border/40 bg-background hover:border-border'
            } ${!stream.active ? 'opacity-60' : ''}`}
          >
            <div className="flex items-center justify-between gap-2">
              <p className="text-[14px] font-medium text-foreground">{stream.pos_source}</p>
              {!stream.active && (
                <span className="text-[11px] px-1.5 py-0.5 rounded-md bg-muted text-muted-foreground">
                  Inactive
                </span>
              )}
            </div>
            <p className="text-[17px] font-semibold text-foreground mt-1">
              {formatMoney(stream.received_total)}
            </p>
            <p className="text-[12px] text-muted-foreground mt-0.5">
              of {formatMoney(stream.expected_total)} expected
              {remaining > 0.005 ? ` · ${formatMoney(remaining)} settling` : ''}
            </p>
            <p className="text-[12px] text-muted-foreground">{stream.item_count} days</p>
          </button>
        );
      })}
    </div>
  );
}
