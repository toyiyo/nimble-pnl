import { cn } from '@/lib/utils';

interface TradeCountBadgeProps {
  count: number;
  /** A claimable trade starts in 24 h or less. */
  isUrgent?: boolean;
  className?: string;
}

/**
 * The count of claimable trades on a nav item. The badge is `aria-hidden`:
 * the parent link or button carries the count in words.
 *
 * The urgent state does not use `--warning`. `--warning-foreground` is
 * white, and white on `--warning` is about 2:1. `text-background` is near
 * white in light mode and dark in dark mode. Both pass the 3:1 badge rule
 * (WCAG 1.4.11) on the amber fill.
 */
export function TradeCountBadge({ count, isUrgent = false, className }: TradeCountBadgeProps) {
  if (count <= 0) return null;
  return (
    <span
      aria-hidden="true"
      className={cn(
        'min-w-[16px] h-4 px-1 rounded-full text-[10px] font-semibold leading-4 text-center',
        isUrgent
          ? 'bg-amber-600 dark:bg-amber-500 text-background'
          : 'bg-foreground text-background',
        className,
      )}
    >
      {count > 9 ? '9+' : count}
    </span>
  );
}
