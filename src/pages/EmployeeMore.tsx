import { Link } from 'react-router-dom';
import { Clock, CalendarCheck, ShoppingBag, Coins, Settings, ChevronRight, type LucideIcon } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';

interface NavItem {
  path: string;
  label: string;
  description: string;
  icon: LucideIcon;
}

const mainItems: NavItem[] = [
  { path: '/employee/timecard', label: 'Timecard', description: 'Hours worked this period', icon: Clock },
  { path: '/employee/portal', label: 'Requests', description: 'Time off & availability', icon: CalendarCheck },
  { path: '/employee/shifts', label: 'Shift Marketplace', description: 'Pick up available shifts', icon: ShoppingBag },
  { path: '/employee/tips', label: 'Tips', description: 'Tip history & breakdown', icon: Coins },
];

function EmployeeMore() {
  const { signOut } = useAuth();

  return (
    <div className="space-y-3">
      <div className="pt-2 pb-1">
        <h1 className="text-[20px] font-bold text-foreground">More</h1>
      </div>

      <div className="rounded-xl border border-border/40 bg-background overflow-hidden">
        {mainItems.map((item, index) => (
          <Link
            key={item.path}
            to={item.path}
            className={`flex items-center justify-between p-4 hover:bg-muted/50 transition-colors ${
              index < mainItems.length - 1 ? 'border-b border-border/40' : ''
            }`}
          >
            <div className="flex items-center gap-3">
              <item.icon className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
              <div>
                <div className="text-[14px] font-medium text-foreground">{item.label}</div>
                <div className="text-[11px] text-muted-foreground">{item.description}</div>
              </div>
            </div>
            <ChevronRight className="h-4 w-4 text-muted-foreground/50" aria-hidden="true" />
          </Link>
        ))}
      </div>

      <div className="rounded-xl border border-border/40 bg-background overflow-hidden">
        <Link
          to="/settings"
          className="flex items-center justify-between p-4 hover:bg-muted/50 transition-colors"
        >
          <div className="flex items-center gap-3">
            <Settings className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
            <span className="text-[14px] font-medium text-foreground">Settings</span>
          </div>
          <ChevronRight className="h-4 w-4 text-muted-foreground/50" aria-hidden="true" />
        </Link>
      </div>

      <div className="pt-2 text-center">
        <button
          onClick={() => signOut()}
          aria-label="Sign out"
          className="text-[13px] font-medium text-destructive hover:text-destructive/80 transition-colors py-3 px-6"
        >
          Sign Out
        </button>
      </div>
    </div>
  );
}

export default EmployeeMore;
