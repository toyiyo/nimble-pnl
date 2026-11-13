import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react';

import type { ReturningGuestTrends } from '@/lib/returningGuests';
import { percentChange } from '@/lib/returningGuests';

interface ReturningGuestsSummaryProps {
  readonly summary: ReturningGuestTrends['summary'];
  readonly weeksCompared: number;
}

type Kind = 'money' | 'number';

const TILES: ReadonlyArray<{
  key: 'spend_per_week' | 'visits_per_card' | 'avg_check';
  label: string;
  kind: Kind;
}> = [
  { key: 'spend_per_week', label: 'Returning spend per week', kind: 'money' },
  { key: 'visits_per_card', label: 'Visits per returning card', kind: 'number' },
  { key: 'avg_check', label: 'Average check', kind: 'money' },
];

const NUM = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });

function format(value: number | null | undefined, kind: Kind): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return kind === 'money' ? `$${NUM.format(value)}` : NUM.format(value);
}

function ChangeText({ change }: { readonly change: number | null }) {
  if (change === null) {
    return (
      <span className="inline-flex items-center gap-1 text-[13px] text-muted-foreground">
        <Minus className="h-3.5 w-3.5" aria-hidden="true" />—
      </span>
    );
  }
  const rounded = Math.round(Math.abs(change));
  const word = change > 0 ? 'increased' : change < 0 ? 'decreased' : 'did not change';
  const Icon = change > 0 ? ArrowUpRight : change < 0 ? ArrowDownRight : Minus;
  return (
    <span className="inline-flex items-center gap-1 text-[13px] font-medium text-foreground">
      <Icon className="h-3.5 w-3.5" aria-hidden="true" />
      <span aria-hidden="true">{change > 0 ? '+' : change < 0 ? '-' : ''}{rounded}%</span>
      <span className="sr-only">
        {change === 0 ? word : `${word} ${rounded} percent`}
      </span>
    </span>
  );
}

export function ReturningGuestsSummary({ summary, weeksCompared }: ReturningGuestsSummaryProps) {
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {TILES.map((tile) => {
          const before = summary?.before[tile.key] ?? null;
          const after = summary?.after[tile.key] ?? null;
          return (
            <div
              key={tile.key}
              data-testid="rg-tile"
              className="rounded-xl border border-border/40 bg-background p-4 space-y-3"
            >
              <h3 className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider">
                {tile.label}
              </h3>
              <div className="flex items-baseline justify-between gap-2">
                <div>
                  <div className="text-[11px] text-muted-foreground">Before</div>
                  <div className="text-[14px] font-medium text-foreground">{format(before, tile.kind)}</div>
                </div>
                <div>
                  <div className="text-[11px] text-muted-foreground">After</div>
                  <div className="text-[14px] font-medium text-foreground">{format(after, tile.kind)}</div>
                </div>
              </div>
              <ChangeText change={percentChange(before, after)} />
            </div>
          );
        })}
      </div>
      {weeksCompared === 0 && (
        <p className="text-[13px] text-muted-foreground">Come back after the first full week.</p>
      )}
    </div>
  );
}
