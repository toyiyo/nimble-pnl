import { Bell } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useWebPushSubscription } from '@/hooks/useWebPushSubscription';

export function EnableNotificationsBanner() {
  const { shouldShowBanner, subscribe, dismiss, isLoading } = useWebPushSubscription();

  if (!shouldShowBanner) return null;

  return (
    <div className="flex items-center gap-4 p-4 rounded-xl border border-border/40 bg-muted/30">
      <div className="h-10 w-10 shrink-0 rounded-xl bg-muted/50 flex items-center justify-center">
        <Bell className="h-5 w-5 text-foreground" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-[14px] font-medium text-foreground">
          Get instant shift updates
        </p>
        <p className="text-[13px] text-muted-foreground mt-0.5">
          Enable notifications to know immediately when your shifts change
        </p>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <Button
          variant="ghost"
          size="sm"
          className="h-9 px-4 rounded-lg text-[13px] font-medium text-muted-foreground hover:text-foreground"
          onClick={dismiss}
          disabled={isLoading}
        >
          Not now
        </Button>
        <Button
          size="sm"
          className="h-9 px-4 rounded-lg bg-foreground text-background hover:bg-foreground/90 text-[13px] font-medium"
          onClick={subscribe}
          disabled={isLoading}
        >
          {isLoading ? 'Enabling...' : 'Enable'}
        </Button>
      </div>
    </div>
  );
}
