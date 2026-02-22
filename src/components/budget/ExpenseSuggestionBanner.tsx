import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Lightbulb } from 'lucide-react';
import type { ExpenseSuggestion } from '@/types/operatingCosts';

const MAX_VISIBLE = 3;

function formatDollars(cents: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

interface ExpenseSuggestionBannerProps {
  suggestions: ExpenseSuggestion[];
  onAccept: (suggestion: ExpenseSuggestion) => void;
  onSnooze: (suggestionId: string) => void;
  onDismiss: (suggestionId: string) => void;
}

export function ExpenseSuggestionBanner({
  suggestions,
  onAccept,
  onSnooze,
  onDismiss,
}: ExpenseSuggestionBannerProps) {
  const [showAll, setShowAll] = useState(false);

  if (suggestions.length === 0) return null;

  const visible = showAll ? suggestions : suggestions.slice(0, MAX_VISIBLE);
  const hiddenCount = suggestions.length - MAX_VISIBLE;

  return (
    <div className="space-y-2">
      {visible.map((suggestion) => (
        <div
          key={suggestion.id}
          className="flex items-center justify-between gap-3 p-2.5 rounded-lg bg-amber-500/10 border border-amber-500/20"
        >
          <div className="flex items-center gap-2 min-w-0">
            <Lightbulb className="h-4 w-4 text-amber-600 shrink-0" />
            <p className="text-[13px] text-foreground truncate">
              We found a recurring{' '}
              <span className="font-medium">
                {formatDollars(suggestion.monthlyAmount)}/mo
              </span>{' '}
              payment to{' '}
              <span className="font-medium">{suggestion.payeeName}</span>. Add
              as &ldquo;{suggestion.suggestedName}&rdquo;?
            </p>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-[12px] font-medium text-amber-700 hover:text-amber-800 hover:bg-amber-500/20"
              onClick={() => onAccept(suggestion)}
              aria-label="Add to Budget"
            >
              Add to Budget
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-[12px] text-muted-foreground hover:text-foreground"
              onClick={() => onSnooze(suggestion.id)}
              aria-label="Not Now"
            >
              Not Now
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-[12px] text-muted-foreground hover:text-destructive"
              onClick={() => onDismiss(suggestion.id)}
              aria-label="Dismiss"
            >
              Dismiss
            </Button>
          </div>
        </div>
      ))}
      {!showAll && hiddenCount > 0 && (
        <button
          onClick={() => setShowAll(true)}
          className="text-[12px] text-muted-foreground hover:text-foreground transition-colors px-2.5"
        >
          Show {hiddenCount} more suggestion{hiddenCount > 1 ? 's' : ''}
        </button>
      )}
    </div>
  );
}
