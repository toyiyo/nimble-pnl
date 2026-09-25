// src/components/employee/MobileTabBar.tsx
import { Link, useLocation } from 'react-router-dom';
import { CalendarDays, Wallet, Clock, MoreHorizontal } from 'lucide-react';
import { useRestaurantContext } from '@/contexts/RestaurantContext';
import { useCurrentEmployee } from '@/hooks/useCurrentEmployee';
import { useClaimableTrades } from '@/hooks/useClaimableTrades';
import { TradeCountBadge } from '@/components/employee/TradeCountBadge';
import { shiftsUpForGrabsText } from '@/lib/claimableTrades';
import { cn } from '@/lib/utils';

const tabs = [
  { path: '/employee/schedule', label: 'Schedule', icon: CalendarDays },
  { path: '/employee/pay', label: 'Pay', icon: Wallet },
  { path: '/employee/clock', label: 'Clock', icon: Clock },
  { path: '/employee/more', label: 'More', icon: MoreHorizontal },
] as const;

const moreRoutes = ['/employee/timecard', '/employee/portal', '/employee/shifts', '/employee/tips', '/settings'];

export function MobileTabBar() {
  const { pathname } = useLocation();

  // The marketplace lives under "More", so the More tab carries the count.
  // With no restaurant or no employee row (a manager in work mode), the
  // hook stays off: no badge and no request.
  const { selectedRestaurant } = useRestaurantContext();
  const restaurantId = selectedRestaurant?.restaurant_id ?? null;
  const { currentEmployee } = useCurrentEmployee(restaurantId);
  const { trades: claimableTrades, count: tradeCount } = useClaimableTrades(
    restaurantId,
    currentEmployee?.id ?? null
  );
  const tradeUrgent = claimableTrades.some((t) => t.urgent);

  const isActive = (tab: typeof tabs[number]) => {
    if (tab.path === '/employee/more') {
      return pathname === '/employee/more' || moreRoutes.some(r => pathname.startsWith(r));
    }
    return pathname.startsWith(tab.path);
  };

  return (
    // Not self-positioned: `MobileLayout` wraps this in a single
    // `fixed bottom-0` stack (together with `PersonalViewBanner` in work
    // mode) so the two stack in normal flow instead of both independently
    // pinning to the viewport bottom and overlapping.
    <nav
      className="border-t border-border/40 bg-background"
      style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
      role="navigation"
      aria-label="Employee navigation"
    >
      <div className="flex justify-around py-2">
        {tabs.map((tab) => {
          const active = isActive(tab);
          const showBadge = tab.path === '/employee/more' && tradeCount > 0;
          return (
            <Link
              key={tab.path}
              to={tab.path}
              aria-current={active ? 'page' : undefined}
              aria-label={showBadge ? `${tab.label}, ${shiftsUpForGrabsText(tradeCount)}` : tab.label}
              className={cn(
                'flex flex-col items-center gap-0.5 px-3 py-2 text-[10px] font-medium transition-colors min-w-[64px] min-h-[44px]',
                active ? 'text-foreground' : 'text-muted-foreground'
              )}
            >
              <span className="relative">
                <tab.icon className="h-5 w-5" aria-hidden="true" />
                {showBadge && (
                  <TradeCountBadge
                    count={tradeCount}
                    urgent={tradeUrgent}
                    className="absolute -top-1.5 -right-2.5"
                  />
                )}
              </span>
              <span>{tab.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
