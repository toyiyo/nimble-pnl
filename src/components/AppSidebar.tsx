import { useLocation, useNavigate } from 'react-router-dom';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarTrigger,
  useSidebar,
} from '@/components/ui/sidebar';
import {
  Home,
  Plug,
  ShoppingCart,
  ChefHat,
  Package,
  ClipboardCheck,
  FileText,
  Users,
  Settings,
  Wallet,
  Receipt,
  CalendarCheck,
  LogOut,
  TrendingUp,
  Clock,
  ClipboardList,
  DollarSign,
  ShoppingBag,
  CalendarDays,
  Coins,
  CreditCard,
  Utensils,
  Calculator,
  Building2,
  Target,
  Sparkles,
} from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useRestaurantContext } from '@/contexts/RestaurantContext';
import { useSubscription } from '@/hooks/useSubscription';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { ChevronDown } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { SUBSCRIPTION_FEATURES } from '@/lib/subscriptionPlans';

/**
 * Map paths to subscription feature keys for tier badge display
 * Growth = AI-powered features, Pro = Stripe-powered features
 */
const FEATURE_GATED_PATHS: Record<string, keyof typeof SUBSCRIPTION_FEATURES> = {
  // Growth tier (AI features)
  '/financial-intelligence': 'financial_intelligence',
  '/scheduling': 'scheduling',
  '/receipt-import': 'inventory_automation',
  // Pro tier (Stripe features)
  '/banking': 'banking',
  '/invoices': 'invoicing',
  '/expenses': 'expenses',
  '/assets': 'assets',
  '/payroll': 'payroll',
};

// Navigation structure
const navigationGroups = [
  {
    label: 'Main',
    items: [
      { path: '/', label: 'Dashboard', icon: Home },
      { path: '/integrations', label: 'Integrations', icon: Plug },
      { path: '/pos-sales', label: 'POS Sales', icon: ShoppingCart },
    ],
  },
  {
    label: 'Operations',
    items: [
      { path: '/scheduling', label: 'Scheduling', icon: CalendarCheck },
      { path: '/time-punches', label: 'Time Clock', icon: ClipboardList },
      { path: '/tips', label: 'Tip Pooling', icon: Coins },
      { path: '/payroll', label: 'Payroll', icon: Wallet },
    ],
  },
  {
    label: 'Inventory',
    items: [
      { path: '/recipes', label: 'Recipes', icon: ChefHat },
      { path: '/prep-recipes', label: 'Prep Recipes', icon: Utensils },
      { path: '/inventory', label: 'Inventory', icon: Package },
      { path: '/inventory-audit', label: 'Audit', icon: ClipboardCheck },
      { path: '/purchase-orders', label: 'Purchase Orders', icon: ShoppingBag },
      { path: '/reports', label: 'Reports', icon: FileText },
    ],
  },
  {
    label: 'Accounting',
    items: [
      { path: '/budget', label: 'Budget & Run Rate', icon: Target },
      { path: '/customers', label: 'Customers', icon: Users },
      { path: '/invoices', label: 'Invoices', icon: FileText },
      { path: '/stripe-account', label: 'Financial Account', icon: CreditCard },
      { path: '/banking', label: 'Banks', icon: Wallet },
      { path: '/expenses', label: 'Expenses', icon: DollarSign },
      { path: '/assets', label: 'Assets & Equipment', icon: Building2 },
      { path: '/financial-intelligence', label: 'Financial Intelligence', icon: TrendingUp },
      { path: '/transactions', label: 'Transactions', icon: Receipt },
      { path: '/chart-of-accounts', label: 'Chart of Accounts', icon: FileText },
      { path: '/financial-statements', label: 'Statements', icon: FileText },
    ],
  },
  {
    label: 'Admin',
    items: [
      { path: '/employees', label: 'Employees', icon: Users },
      { path: '/team', label: 'Team', icon: Users },
      { path: '/settings', label: 'Settings', icon: Settings },
    ],
  },
];

// Navigation groups for collaborator roles
interface NavItem {
  path: string;
  label: string;
  icon: LucideIcon;
}

interface NavGroup {
  label: string;
  items: NavItem[];
}

const collaboratorAccountantNav: NavGroup[] = [
  {
    label: 'Financial',
    items: [
      { path: '/budget', label: 'Budget & Run Rate', icon: Target },
      { path: '/transactions', label: 'Transactions', icon: Receipt },
      { path: '/banking', label: 'Banks', icon: Wallet },
      { path: '/expenses', label: 'Expenses', icon: DollarSign },
      { path: '/assets', label: 'Assets', icon: Building2 },
      { path: '/invoices', label: 'Invoices', icon: FileText },
      { path: '/customers', label: 'Customers', icon: Users },
      { path: '/chart-of-accounts', label: 'Chart of Accounts', icon: FileText },
      { path: '/financial-statements', label: 'Statements', icon: FileText },
      { path: '/financial-intelligence', label: 'Intelligence', icon: TrendingUp },
    ],
  },
  {
    label: 'Payroll',
    items: [
      { path: '/payroll', label: 'Payroll', icon: Wallet },
      { path: '/employees', label: 'Employees', icon: Users },
    ],
  },
  {
    label: 'Settings',
    items: [
      { path: '/settings', label: 'Settings', icon: Settings },
    ],
  },
];

const collaboratorInventoryNav: NavGroup[] = [
  {
    label: 'Inventory',
    items: [
      { path: '/inventory', label: 'Inventory', icon: Package },
      { path: '/inventory-audit', label: 'Audit', icon: ClipboardCheck },
      { path: '/purchase-orders', label: 'Purchase Orders', icon: ShoppingBag },
      { path: '/receipt-import', label: 'Receipt Import', icon: Receipt },
    ],
  },
  {
    label: 'Settings',
    items: [
      { path: '/settings', label: 'Settings', icon: Settings },
    ],
  },
];

const collaboratorChefNav: NavGroup[] = [
  {
    label: 'Recipes',
    items: [
      { path: '/recipes', label: 'Recipes', icon: ChefHat },
      { path: '/prep-recipes', label: 'Prep Recipes', icon: Utensils },
    ],
  },
  {
    label: 'Inventory',
    items: [
      { path: '/inventory', label: 'Inventory', icon: Package },
    ],
  },
  {
    label: 'Settings',
    items: [
      { path: '/settings', label: 'Settings', icon: Settings },
    ],
  },
];

const staffNav: NavGroup[] = [
  {
    label: 'Employee',
    items: [
      { path: '/employee/clock', label: 'Time Clock', icon: Clock },
      { path: '/employee/timecard', label: 'My Timecard', icon: FileText },
      { path: '/employee/schedule', label: 'My Schedule', icon: CalendarDays },
      { path: '/employee/pay', label: 'My Pay', icon: Wallet },
      { path: '/employee/portal', label: 'My Requests', icon: CalendarCheck },
    ],
  },
  {
    label: 'Settings',
    items: [
      { path: '/settings', label: 'Settings', icon: Settings },
    ],
  },
];

// Get navigation groups based on role
function getNavigationForRole(role: string | undefined): NavGroup[] {
  if (!role) return [];

  switch (role) {
    case 'kiosk':
      return []; // Kiosk users see no sidebar
    case 'staff':
      return staffNav;
    case 'collaborator_accountant':
      return collaboratorAccountantNav;
    case 'collaborator_inventory':
      return collaboratorInventoryNav;
    case 'collaborator_chef':
      return collaboratorChefNav;
    default:
      // owner, manager, chef get full navigation
      return navigationGroups;
  }
}

export function AppSidebar() {
  const { state: sidebarState } = useSidebar();
  const location = useLocation();
  const navigate = useNavigate();
  const { signOut, user } = useAuth();
  const { selectedRestaurant } = useRestaurantContext();
  const { hasFeature } = useSubscription();

  // Get navigation based on user role
  const role = selectedRestaurant?.role;
  const filteredNavigationGroups = getNavigationForRole(role);

  const isActivePath = (path: string) => {
    if (path === '/') return location.pathname === '/';
    return location.pathname === path || location.pathname.startsWith(path + '/');
  };

  // Check if any item in a group is active
  const isGroupActive = (items: typeof navigationGroups[0]['items']) => {
    return items.some((item) => isActivePath(item.path));
  };

  const collapsed = sidebarState === 'collapsed';

  return (
    <Sidebar collapsible="icon" className="border-r">
      <SidebarHeader className="border-b h-14 p-0">
        <button 
          onClick={() => navigate('/')}
          className={`flex items-center gap-3 group transition-all duration-200 hover:scale-105 w-full h-full ${
            collapsed ? 'justify-center px-3' : 'px-4'
          }`}
        >
          <div className="bg-gradient-to-br from-emerald-500 to-emerald-600 rounded-lg shadow-lg p-1.5 group-hover:shadow-emerald-500/50 transition-all duration-200 flex-shrink-0">
            <CalendarCheck className="h-4 w-4 text-white" />
          </div>
          {!collapsed && (
            <div className="flex-1 min-w-0 text-left">
              <div className="font-bold text-sm truncate">EasyShiftHQ</div>
              {selectedRestaurant && (
                <div className="text-xs text-muted-foreground truncate">
                  {selectedRestaurant.restaurant.name}
                </div>
              )}
            </div>
          )}
        </button>
      </SidebarHeader>

      <SidebarContent className={collapsed ? 'px-0' : ''}>
        {collapsed ? (
          // Collapsed view: Show all items as flat icon list
          <SidebarMenu className="px-2">
            {filteredNavigationGroups.map((group, groupIndex) => (
              <div key={group.label}>
                {groupIndex > 0 && <div className="h-px bg-border/50 my-2" />}
                {group.items.map((item) => {
                  const Icon = item.icon;
                  const isActive = isActivePath(item.path);
                  const featureKey = FEATURE_GATED_PATHS[item.path];
                  const needsUpgrade = featureKey && !hasFeature(featureKey);
                  const requiredTier = featureKey ? SUBSCRIPTION_FEATURES[featureKey].requiredTier : null;
                  return (
                    <SidebarMenuItem key={item.path}>
                      <SidebarMenuButton
                        onClick={() => navigate(item.path)}
                        isActive={isActive}
                        tooltip={needsUpgrade ? `${item.label} (${requiredTier} tier)` : item.label}
                        className={`flex items-center justify-center !px-0 relative ${
                          isActive
                            ? 'bg-primary text-primary-foreground hover:bg-primary/90 shadow-md transition-all duration-200'
                            : 'hover:bg-sidebar-accent transition-all duration-200'
                        }`}
                      >
                        <Icon className="h-5 w-5" />
                        {needsUpgrade && (
                          <span
                            className={`absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full ${
                              requiredTier === 'pro' ? 'bg-purple-500' : 'bg-amber-500'
                            }`}
                          />
                        )}
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
              </div>
            ))}
          </SidebarMenu>
        ) : (
          // Expanded view: Show collapsible groups
          <>
            {filteredNavigationGroups.map((group) => {
              const groupIsActive = isGroupActive(group.items);
              
              return (
                <Collapsible
                  key={group.label}
                  defaultOpen={groupIsActive}
                  className="group/collapsible"
                >
                  <SidebarGroup>
                    <CollapsibleTrigger asChild>
                      <SidebarGroupLabel className="cursor-pointer hover:bg-accent/50 transition-colors duration-200">
                        {group.label}
                        <ChevronDown className="ml-auto transition-transform duration-200 group-data-[state=open]/collapsible:rotate-180" />
                      </SidebarGroupLabel>
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                      <SidebarGroupContent>
                        <SidebarMenu>
                          {group.items.map((item) => {
                            const Icon = item.icon;
                            const isActive = isActivePath(item.path);
                            const featureKey = FEATURE_GATED_PATHS[item.path];
                            const needsUpgrade = featureKey && !hasFeature(featureKey);
                            const requiredTier = featureKey ? SUBSCRIPTION_FEATURES[featureKey].requiredTier : null;

                            return (
                              <SidebarMenuItem key={item.path}>
                                <SidebarMenuButton
                                  onClick={() => navigate(item.path)}
                                  isActive={isActive}
                                  className={
                                    isActive
                                      ? 'bg-primary text-primary-foreground hover:bg-primary/90 shadow-md transition-all duration-200'
                                      : 'hover:bg-sidebar-accent hover:translate-x-0.5 transition-all duration-200'
                                  }
                                >
                                  <Icon className="h-4 w-4" />
                                  <span className="flex-1">{item.label}</span>
                                  {needsUpgrade && requiredTier && (
                                    <Badge
                                      variant="secondary"
                                      className={`ml-auto text-[9px] px-1 py-0 capitalize ${
                                        requiredTier === 'pro'
                                          ? 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200'
                                          : 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200'
                                      }`}
                                    >
                                      <Sparkles className="h-2 w-2 mr-0.5" />
                                      {requiredTier}
                                    </Badge>
                                  )}
                                </SidebarMenuButton>
                              </SidebarMenuItem>
                            );
                          })}
                        </SidebarMenu>
                      </SidebarGroupContent>
                    </CollapsibleContent>
                  </SidebarGroup>
                </Collapsible>
              );
            })}
          </>
        )}
      </SidebarContent>

      <SidebarFooter className="border-t border-sidebar-border p-3 mt-auto">
        {!collapsed ? (
          <div className="space-y-2 animate-fade-in">
            <div className="px-2 py-1.5 rounded-md bg-sidebar-accent border border-sidebar-border">
              <div className="text-xs text-sidebar-foreground truncate">
                {user?.email}
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={signOut}
              className="w-full justify-start text-destructive hover:bg-destructive/10 hover:text-destructive transition-all duration-200"
            >
              <LogOut className="h-4 w-4 mr-2" />
              Sign Out
            </Button>
          </div>
        ) : (
          <Button
            variant="ghost"
            size="icon"
            onClick={signOut}
            className="w-full h-10 text-destructive hover:bg-destructive/10 transition-all duration-200"
            title="Sign Out"
          >
            <LogOut className="h-5 w-5" />
          </Button>
        )}
      </SidebarFooter>
    </Sidebar>
  );
}
