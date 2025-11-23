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
  Sparkles,
  Clock,
  ClipboardList,
  DollarSign,
  ShoppingBag,
} from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useRestaurantContext } from '@/contexts/RestaurantContext';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { ChevronDown } from 'lucide-react';

// Navigation structure
const navigationGroups = [
  {
    label: 'Main',
    items: [
      { path: '/', label: 'Dashboard', icon: Home },
      { path: '/ai-assistant', label: 'AI Assistant', icon: Sparkles },
      { path: '/integrations', label: 'Integrations', icon: Plug },
      { path: '/pos-sales', label: 'POS Sales', icon: ShoppingCart },
    ],
  },
  {
    label: 'Operations',
    items: [
      { path: '/scheduling', label: 'Scheduling', icon: CalendarCheck },
      { path: '/employee/clock', label: 'Time Clock', icon: Clock },
      { path: '/time-punches', label: 'Time Punches', icon: ClipboardList },
      { path: '/payroll', label: 'Payroll', icon: Wallet },
    ],
  },
  {
    label: 'Inventory',
    items: [
      { path: '/recipes', label: 'Recipes', icon: ChefHat },
      { path: '/inventory', label: 'Inventory', icon: Package },
      { path: '/inventory-audit', label: 'Audit', icon: ClipboardCheck },
      { path: '/purchase-orders', label: 'Purchase Orders', icon: ShoppingBag },
      { path: '/reports', label: 'Reports', icon: FileText },
    ],
  },
  {
    label: 'Accounting',
    items: [
      { path: '/banking', label: 'Banks', icon: Wallet },
      { path: '/expenses', label: 'Expenses', icon: DollarSign },
      { path: '/financial-intelligence', label: 'Financial Intelligence', icon: TrendingUp },
      { path: '/transactions', label: 'Transactions', icon: Receipt },
      { path: '/chart-of-accounts', label: 'Chart of Accounts', icon: FileText },
      { path: '/financial-statements', label: 'Statements', icon: FileText },
    ],
  },
  {
    label: 'Admin',
    items: [
      { path: '/team', label: 'Team', icon: Users },
      { path: '/settings', label: 'Settings', icon: Settings },
    ],
  },
];

export function AppSidebar() {
  const { state: sidebarState } = useSidebar();
  const location = useLocation();
  const navigate = useNavigate();
  const { signOut, user } = useAuth();
  const { selectedRestaurant } = useRestaurantContext();

  // Check if user is staff
  const isStaff = selectedRestaurant?.role === 'staff';

  // Filter navigation groups for staff users
  const filteredNavigationGroups = isStaff
    ? [
        {
          label: 'Employee',
          items: [
            { path: '/employee/clock', label: 'Time Clock', icon: Clock },
            { path: '/employee/portal', label: 'My Requests', icon: CalendarCheck },
          ],
        },
        {
          label: 'Settings',
          items: [
            { path: '/settings', label: 'Settings', icon: Settings },
          ],
        },
      ]
    : navigationGroups;

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
                  return (
                    <SidebarMenuItem key={item.path}>
                      <SidebarMenuButton
                        onClick={() => navigate(item.path)}
                        isActive={isActive}
                        tooltip={item.label}
                        className={`flex items-center justify-center !px-0 ${
                          isActive
                            ? 'bg-gradient-to-r from-emerald-500 to-emerald-600 text-white hover:from-emerald-500 hover:to-emerald-600 shadow-md shadow-emerald-500/20 transition-all duration-200'
                            : 'hover:bg-accent/50 transition-all duration-200'
                        }`}
                      >
                        <Icon className="h-5 w-5" />
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
                            return (
                              <SidebarMenuItem key={item.path}>
                                <SidebarMenuButton
                                  onClick={() => navigate(item.path)}
                                  isActive={isActive}
                                  className={
                                    isActive
                                      ? 'bg-gradient-to-r from-emerald-500 to-emerald-600 text-white hover:from-emerald-500 hover:to-emerald-600 shadow-md shadow-emerald-500/20 transition-all duration-200'
                                      : 'hover:bg-accent/50 hover:translate-x-0.5 transition-all duration-200'
                                  }
                                >
                                  <Icon className="h-4 w-4" />
                                  <span>{item.label}</span>
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

      <SidebarFooter className="border-t p-3 mt-auto">
        {!collapsed ? (
          <div className="space-y-2 animate-fade-in">
            <div className="px-2 py-1.5 rounded-md bg-muted/30 border border-border/50">
              <div className="text-xs text-muted-foreground truncate">
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
