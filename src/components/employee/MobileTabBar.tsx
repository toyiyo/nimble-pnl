// src/components/employee/MobileTabBar.tsx
import { Link, useLocation } from 'react-router-dom';
import { CalendarDays, Wallet, Clock, MoreHorizontal } from 'lucide-react';
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

  const isActive = (tab: typeof tabs[number]) => {
    if (tab.path === '/employee/more') {
      return pathname === '/employee/more' || moreRoutes.some(r => pathname.startsWith(r));
    }
    return pathname.startsWith(tab.path);
  };

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-50 border-t border-border/40 bg-background"
      style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
      role="navigation"
      aria-label="Employee navigation"
    >
      <div className="flex justify-around py-2">
        {tabs.map((tab) => {
          const active = isActive(tab);
          return (
            <Link
              key={tab.path}
              to={tab.path}
              aria-current={active ? 'page' : undefined}
              aria-label={tab.label}
              className={cn(
                'flex flex-col items-center gap-0.5 px-3 py-1 text-[10px] font-medium transition-colors min-w-[64px]',
                active ? 'text-foreground' : 'text-muted-foreground'
              )}
            >
              <tab.icon className="h-5 w-5" aria-hidden="true" />
              <span>{tab.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
