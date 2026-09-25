import { cn } from '@/lib/utils';

interface TradeCountBadgeProps {
  count: number;
  /** A claimable trade starts in 24 h or less. */
  urgent?: boolean;
  className?: string;
}

/**
 * The count of claimable trades on a nav item. The badge is `aria-hidden`:
 * the parent link or button carries the count in words.
 *
 * White on `amber-600` is about 3.2:1, which meets the 3:1 rule for a
 * badge (WCAG 1.4.11).
 */
export function TradeCountBadge({ count, urgent = false, className }: TradeCountBadgeProps) {
  if (count <= 0) return null;
  return (
    <span
      aria-hidden="true"
      className={cn(
        'min-w-[16px] h-4 px-1 rounded-full text-[10px] font-semibold leading-4 text-center',
        urgent
          ? 'bg-amber-600 text-white dark:bg-amber-500 dark:text-amber-950'
          : 'bg-foreground text-background',
        className,
      )}
    >
      {count > 9 ? '9+' : count}
    </span>
  );
}
