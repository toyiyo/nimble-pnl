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
  useSidebar,
} from '@/components/ui/sidebar';
import {
  LogOut,
  Sparkles,
  ChevronDown,
} from 'lucide-react';
import { AppLogo } from '@/components/AppLogo';
import {
  getNavigationForRole,
} from '@/components/AppSidebar.nav';
import type { NavGroup } from '@/components/AppSidebar.nav';

import { useAuth } from '@/hooks/useAuth';
import { useRestaurantContext } from '@/contexts/RestaurantContext';
import { useSubscription } from '@/hooks/useSubscription';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
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
  '/ops-inbox': 'ops_inbox',
  '/weekly-brief': 'weekly_brief',
  '/banking': 'banking',
  '/invoices': 'invoicing',
  '/expenses': 'expenses',
  '/print-checks': 'expenses',
  '/assets': 'assets',
  '/payroll': 'payroll',
};

export function AppSidebar() {
  const { state: sidebarState, isMobile, setOpenMobile } = useSidebar();
  const location = useLocation();
  const navigate = useNavigate();
  const { signOut, user } = useAuth();
  const { selectedRestaurant } = useRestaurantContext();
  const { hasFeature } = useSubscription();

  // Get navigation based on user role
  const role = selectedRestaurant?.role;
  const filteredNavigationGroups = getNavigationForRole(role);

  const handleNavigate = (path: string) => {
    navigate(path);
    if (isMobile) setOpenMobile(false);
  };

  const isActivePath = (path: string) => {
    if (path === '/') return location.pathname === '/';
    return location.pathname === path || location.pathname.startsWith(path + '/');
  };

  // Check if any item in a group is active
  const isGroupActive = (items: NavGroup['items']) => {
    return items.some((item) => isActivePath(item.path));
  };

  const collapsed = sidebarState === 'collapsed';

  return (
    <Sidebar collapsible="icon" className="border-r">
      <SidebarHeader className="border-b h-14 p-0">
        <button
          onClick={() => handleNavigate('/')}
          aria-label="Go to dashboard"
          className={`flex items-center gap-3 group transition-all duration-200 hover:scale-105 w-full h-full ${
            collapsed ? 'justify-center px-3' : 'px-4'
          }`}
        >
          <AppLogo size={28} className="shadow-lg group-hover:shadow-emerald-500/50 transition-all duration-200 flex-shrink-0" />
          {!collapsed && (
            <div className="flex-1 min-w-0 text-left">
              <div className="font-bold text-sm truncate">EasyShiftHQ</div>
              {selectedRestaurant && (
                <div className="text-xs text-sidebar-foreground/60 truncate">
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
                        onClick={() => handleNavigate(item.path)}
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
                                  onClick={() => handleNavigate(item.path)}
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
