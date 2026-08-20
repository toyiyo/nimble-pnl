import type { ReactNode } from 'react';
import { Info, TrendingDown, TrendingUp, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { CashFlowInsight } from '@/lib/cashflowInsights';

interface CashFlowNarrativeProps {
  insights: CashFlowInsight[];
  className?: string;
}

const CURRENCY_PATTERN = '\\$\\d{1,3}(?:,\\d{3})*(?:\\.\\d+)?';

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** The payee name for a top-source insight, read back out of its title. */
function payeeFor(insight: CashFlowInsight): string | undefined {
  if (insight.id !== 'top-source-change') return undefined;
  return insight.title.replace(/ (increased|decreased)$/, '');
}

function iconFor(insight: CashFlowInsight): LucideIcon {
  if (insight.title.endsWith(' increased')) return TrendingUp;
  if (insight.title.endsWith(' decreased')) return TrendingDown;
  return Info;
}

/** Split the body on amount and payee substrings, chip-styling each one. */
function renderBody(body: string, payee?: string): ReactNode[] {
  const patterns = [CURRENCY_PATTERN];
  if (payee) patterns.push(escapeRegExp(payee));
  const splitPattern = new RegExp(`(${patterns.join('|')})`, 'g');
  const matchPattern = new RegExp(`^(${patterns.join('|')})$`);

  // A key from the part text plus its occurrence count is stable across
  // re-renders, unlike the array index.
  const seen = new Map<string, number>();
  return body.split(splitPattern).map((part) => {
    const occurrence = seen.get(part) ?? 0;
    seen.set(part, occurrence + 1);
    const key = `${part}#${occurrence}`;
    return part && matchPattern.test(part) ? (
      <span key={key} className="bg-muted rounded-md px-1">
        {part}
      </span>
    ) : (
      <span key={key}>{part}</span>
    );
  });
}

/** The deterministic insight list for the cash flow view. All copy is visible text. */
export function CashFlowNarrative({ insights, className }: CashFlowNarrativeProps) {
  return (
    <section aria-label="Cash flow narrative" className={cn(className)}>
      {insights.length === 0 ? (
        <p className="text-[13px] text-muted-foreground">No notable trends for this period.</p>
      ) : (
        <ul className="space-y-4">
          {insights.map((insight) => {
            const Icon = iconFor(insight);
            return (
              <li key={insight.id} className="flex items-start gap-3">
                <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                <div>
                  <div className="text-[14px] font-medium text-foreground">{insight.title}</div>
                  <div className="text-[13px] text-muted-foreground">
                    {renderBody(insight.body, payeeFor(insight))}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
