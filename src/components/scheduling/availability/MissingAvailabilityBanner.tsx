import { Button } from '@/components/ui/button';
import { AlertTriangle } from 'lucide-react';

interface MissingAvailabilityBannerProps {
  count: number;
  onSetDefaults: () => void;
  onSendReminder: () => void;
  reminderPending: boolean;
}

export function MissingAvailabilityBanner({
  count,
  onSetDefaults,
  onSendReminder,
  reminderPending,
}: MissingAvailabilityBannerProps) {
  if (count <= 0) return null;
  const noun = count === 1 ? 'employee' : 'employees';

  return (
    <div
      role="alert"
      aria-live="polite"
      className="mx-6 mt-4 rounded-xl border border-amber-500/20 bg-amber-500/10 px-4 py-3"
    >
      <div className="flex items-start gap-3">
        <AlertTriangle
          className="h-4 w-4 mt-0.5 shrink-0 text-amber-500"
          aria-hidden="true"
        />
        <div className="flex-1 min-w-0">
          <p className="text-[13px] font-medium text-foreground">
            {count} {noun} can&apos;t be scheduled — availability missing
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              className="min-h-[44px] text-[13px]"
              onClick={onSetDefaults}
            >
              Set defaults
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="min-h-[44px] text-[13px]"
              onClick={onSendReminder}
              disabled={reminderPending}
              aria-label="Email reminder"
            >
              {reminderPending && (
                <span
                  aria-hidden="true"
                  className="mr-2 h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent"
                />
              )}
              Email reminder
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
