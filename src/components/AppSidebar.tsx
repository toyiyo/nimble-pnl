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
  Building2,
  LogOut,
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
      { path: '/integrations', label: 'Integrations', icon: Plug },
      { path: '/pos-sales', label: 'POS Sales', icon: ShoppingCart },
    ],
  },
  {
    label: 'Inventory',
    items: [
      { path: '/recipes', label: 'Recipes', icon: ChefHat },
      { path: '/inventory', label: 'Inventory', icon: Package },
      { path: '/inventory-audit', label: 'Audit', icon: ClipboardCheck },
      { path: '/reports', label: 'Reports', icon: FileText },
    ],
  },
  {
    label: 'Accounting',
    items: [
      { path: '/accounting', label: 'Banks', icon: Wallet },
      { path: '/transactions', label: 'Transactions', icon: Receipt },
      { path: '/chart-of-accounts', label: 'Accounts', icon: FileText },
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
      <SidebarHeader className="border-b p-4">
        <button 
          onClick={() => navigate('/')}
          className="flex items-center gap-2 w-full group transition-transform duration-200 hover:scale-105"
        >
          <div className="bg-gradient-to-br from-emerald-500 to-emerald-600 rounded-lg shadow-lg p-2 group-hover:shadow-emerald-500/50 transition-shadow duration-200 flex-shrink-0">
            <Building2 className="h-5 w-5 text-white" />
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

      <SidebarContent>
        {navigationGroups.map((group) => {
          const groupIsActive = isGroupActive(group.items);
          
          return (
            <Collapsible
              key={group.label}
              defaultOpen={groupIsActive}
              className="group/collapsible"
            >
              <SidebarGroup>
                <CollapsibleTrigger asChild>
                  <SidebarGroupLabel className="cursor-pointer hover:bg-accent/50 transition-colors">
                    {!collapsed && (
                      <>
                        {group.label}
                        <ChevronDown className="ml-auto transition-transform group-data-[state=open]/collapsible:rotate-180" />
                      </>
                    )}
                    {collapsed && (
                      <div className="w-full h-px bg-border my-2" />
                    )}
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
                              tooltip={collapsed ? item.label : undefined}
                              className={
                                isActive
                                  ? 'bg-gradient-to-r from-emerald-500 to-emerald-600 text-white hover:from-emerald-500 hover:to-emerald-600 shadow-md shadow-emerald-500/20'
                                  : 'hover:bg-accent/50'
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
      </SidebarContent>

      <SidebarFooter className="border-t p-4">
        {!collapsed && user && (
          <div className="space-y-2">
            <div className="text-xs text-muted-foreground truncate">
              {user.email}
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={signOut}
              className="w-full justify-start text-destructive hover:bg-destructive/10"
            >
              <LogOut className="h-4 w-4 mr-2" />
              Sign Out
            </Button>
          </div>
        )}
        {collapsed && (
          <Button
            variant="ghost"
            size="icon"
            onClick={signOut}
            className="w-full text-destructive hover:bg-destructive/10"
          >
            <LogOut className="h-4 w-4" />
          </Button>
        )}
      </SidebarFooter>
    </Sidebar>
  );
}
