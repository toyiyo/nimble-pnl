import React, { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/hooks/useAuth';
import { useRestaurantContext } from '@/contexts/RestaurantContext';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { 
  Plus, 
  Building2, 
  CalendarCheck, 
  Menu,
  Home,
  Plug,
  ShoppingCart,
  ChefHat,
  Package,
  ClipboardCheck,
  FileText,
  Users,
  Settings,
  LogOut,
  Wallet,
  Receipt
} from 'lucide-react';
import { TimezoneSelector } from '@/components/TimezoneSelector';
import { UserProfileDropdown } from '@/components/UserProfileDropdown';

// Navigation configuration
const navigationGroups = [
  {
    label: 'Main',
    items: [
      { path: '/', label: 'Dashboard', icon: Home },
      { path: '/integrations', label: 'Integrations', icon: Plug },
      { path: '/pos-sales', label: 'POS Sales', icon: ShoppingCart },
    ]
  },
  {
    label: 'Inventory',
    items: [
      { path: '/recipes', label: 'Recipes', icon: ChefHat },
      { path: '/inventory', label: 'Inventory', icon: Package },
      { path: '/inventory-audit', label: 'Audit', icon: ClipboardCheck },
      { path: '/reports', label: 'Reports', icon: FileText },
    ]
  },
  {
    label: 'Financial',
    items: [
      { path: '/accounting', label: 'Banks', icon: Wallet },
      { path: '/transactions', label: 'Transactions', icon: Receipt },
    ]
  },
  {
    label: 'Admin',
    items: [
      { path: '/team', label: 'Team', icon: Users },
      { path: '/settings', label: 'Settings', icon: Settings },
    ]
  }
];

export const AppHeader = () => {
  const { signOut } = useAuth();
  const { selectedRestaurant, setSelectedRestaurant, restaurants, createRestaurant } = useRestaurantContext();
  const navigate = useNavigate();
  const location = useLocation();
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [showMobileMenu, setShowMobileMenu] = useState(false);
  const [formData, setFormData] = useState({
    name: '',
    address: '',
    phone: '',
    cuisine_type: '',
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  });

  const isActivePath = (path: string) => {
    if (path === '/') return location.pathname === '/';
    // Exact match or match with trailing slash to avoid /inventory matching /inventory-audit
    return location.pathname === path || location.pathname.startsWith(path + '/');
  };

  const handleCreateRestaurant = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name.trim()) return;

    const newRestaurant = await createRestaurant({
      name: formData.name,
      address: formData.address || undefined,
      phone: formData.phone || undefined,
      cuisine_type: formData.cuisine_type || undefined,
      timezone: formData.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone,
    });

    if (newRestaurant) {
      setFormData({ 
        name: '', 
        address: '', 
        phone: '', 
        cuisine_type: '', 
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone 
      });
      setShowCreateDialog(false);
    }
  };

  const handleRestaurantChange = (restaurantId: string) => {
    if (restaurantId === 'create-new') {
      setShowCreateDialog(true);
      return;
    }
    
    const restaurant = restaurants.find(r => r.restaurant_id === restaurantId);
    if (restaurant) {
      setSelectedRestaurant(restaurant);
    }
  };

  return (
    <>
      <nav className="border-b bg-gradient-to-r from-background via-background to-muted/20 backdrop-blur-xl supports-[backdrop-filter]:bg-background/60 sticky top-0 z-50">
        <div className="container px-4 max-w-screen-2xl mx-auto">
          <div className="flex h-16 items-center justify-between gap-4">
            {/* Left side: Logo */}
            <div className="flex items-center gap-2 flex-shrink-0">
              {/* Enhanced Logo */}
              <button 
                onClick={() => navigate('/')}
                className="flex gap-2 items-center text-lg md:text-xl font-bold group transition-transform duration-200 hover:scale-105"
              >
                <div className="bg-gradient-to-br from-emerald-500 to-emerald-600 rounded-lg shadow-lg p-2 group-hover:shadow-emerald-500/50 transition-shadow duration-200">
                  <CalendarCheck className="h-5 w-5 md:h-6 md:w-6 text-white" />
                </div>
                <span className="hidden xl:inline bg-gradient-to-r from-foreground to-foreground/70 bg-clip-text">EasyShiftHQ</span>
              </button>
            </div>

            {/* Center: Restaurant Selector - Desktop only */}
            <div className="hidden lg:flex items-center gap-2 flex-shrink-0 relative z-50">
              <Building2 className="w-4 h-4 text-muted-foreground" />
              <Select
                value={selectedRestaurant?.restaurant_id || ''}
                onValueChange={handleRestaurantChange}
              >
                <SelectTrigger className="w-[200px] hover:bg-accent/50 transition-all duration-200">
                  <SelectValue placeholder="Select restaurant" />
                </SelectTrigger>
                <SelectContent className="bg-background/95 backdrop-blur-xl border-border/50 z-[100]">
                  <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground">
                    Your Restaurants ({restaurants.length})
                  </div>
                  {restaurants.map((restaurant) => (
                    <SelectItem 
                      key={restaurant.restaurant_id} 
                      value={restaurant.restaurant_id}
                      className="hover:bg-gradient-to-r hover:from-accent/50 hover:to-accent/30 transition-all duration-200"
                    >
                      <div className="flex items-center gap-2">
                        <div className="w-2 h-2 rounded-full bg-emerald-500" />
                        {restaurant.restaurant.name}
                      </div>
                    </SelectItem>
                  ))}
                  <SelectItem 
                    value="create-new"
                    className="bg-gradient-to-r from-emerald-500/10 to-emerald-600/10 hover:from-emerald-500/20 hover:to-emerald-600/20 font-medium mt-1"
                  >
                    <div className="flex items-center gap-2">
                      <Plus className="w-4 h-4" />
                      Create new restaurant
                    </div>
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
            
            
            {/* Right side: Navigation + User Profile */}
            <div className="flex items-center gap-1.5 flex-shrink-0">
              {/* Desktop Navigation */}
              <div className="hidden xl:flex items-center gap-1">
                {navigationGroups.map((group, groupIdx) => (
                  <React.Fragment key={group.label}>
                    {groupIdx > 0 && (
                      <div className="h-6 w-px bg-border/50 mx-1" />
                    )}
                    {group.items.map((item) => {
                      const Icon = item.icon;
                      const isActive = isActivePath(item.path);
                      return (
                        <Button
                          key={item.path}
                          variant={isActive ? "default" : "ghost"}
                          size="sm"
                          onClick={() => navigate(item.path)}
                          className={`text-xs whitespace-nowrap transition-all duration-200 px-2.5 ${
                            isActive 
                              ? 'bg-gradient-to-r from-primary to-primary/90 shadow-md shadow-primary/20' 
                              : 'hover:bg-accent/50 hover:scale-105'
                          }`}
                        >
                          <Icon className="h-3.5 w-3.5 mr-1.5" />
                          {item.label}
                        </Button>
                      );
                    })}
                  </React.Fragment>
                ))}
              </div>

              {/* User Profile Dropdown */}
              <UserProfileDropdown />

              {/* Mobile Menu Button */}
              <Sheet open={showMobileMenu} onOpenChange={setShowMobileMenu}>
                <SheetTrigger asChild>
                  <Button variant="outline" size="sm" className="xl:hidden hover:bg-accent/50 transition-all duration-200">
                    <Menu className="h-4 w-4" />
                  </Button>
                </SheetTrigger>
                <SheetContent side="right" className="w-[280px] bg-background/95 backdrop-blur-xl flex flex-col">
                  <SheetHeader className="bg-gradient-to-r from-emerald-500/10 to-emerald-600/10 -mx-6 -mt-6 px-6 py-4 mb-6 flex-shrink-0">
                    <SheetTitle className="text-left">Navigation</SheetTitle>
                    {selectedRestaurant && (
                      <div className="flex items-center gap-2 text-sm text-muted-foreground mt-2">
                        <Building2 className="h-3.5 w-3.5" />
                        <span className="truncate">{selectedRestaurant.restaurant.name}</span>
                      </div>
                    )}
                  </SheetHeader>
                  
                  <div className="flex flex-col gap-6 overflow-y-auto flex-1 pr-2">
                    {navigationGroups.map((group) => (
                      <div key={group.label}>
                        <div className="text-xs font-semibold text-muted-foreground mb-2 px-2">
                          {group.label}
                        </div>
                        <div className="flex flex-col gap-1">
                          {group.items.map((item) => {
                            const Icon = item.icon;
                            const isActive = isActivePath(item.path);
                            return (
                              <Button
                                key={item.path}
                                variant={isActive ? "default" : "ghost"}
                                onClick={() => { 
                                  navigate(item.path); 
                                  setShowMobileMenu(false); 
                                }}
                                className={`justify-start transition-all duration-200 ${
                                  isActive 
                                    ? 'bg-gradient-to-r from-primary to-primary/90 shadow-md' 
                                    : 'hover:bg-accent/50 hover:translate-x-1'
                                }`}
                              >
                                <Icon className="h-4 w-4 mr-2" />
                                {item.label}
                              </Button>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                    
                    <div className="border-t pt-4">
                      <Button
                        variant="outline"
                        onClick={() => { 
                          signOut(); 
                          setShowMobileMenu(false); 
                        }}
                        className="w-full justify-start text-destructive hover:bg-destructive/10 transition-colors duration-200"
                      >
                        <LogOut className="h-4 w-4 mr-2" />
                        Sign Out
                      </Button>
                    </div>
                  </div>
                </SheetContent>
              </Sheet>
            </div>
          </div>
          
          {/* Mobile Restaurant Selector */}
          <div className="lg:hidden py-3 border-t bg-gradient-to-r from-muted/30 to-transparent">
            <div className="flex items-center gap-2">
              <Building2 className="w-4 h-4 text-muted-foreground flex-shrink-0" />
              <Select
                value={selectedRestaurant?.restaurant_id || ''}
                onValueChange={handleRestaurantChange}
              >
                <SelectTrigger className="flex-1 h-9 hover:bg-accent/50 transition-all duration-200">
                  <SelectValue placeholder="Select restaurant" />
                </SelectTrigger>
                <SelectContent className="bg-background/95 backdrop-blur-xl border-border/50">
                  <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground">
                    Your Restaurants ({restaurants.length})
                  </div>
                  {restaurants.map((restaurant) => (
                    <SelectItem 
                      key={restaurant.restaurant_id} 
                      value={restaurant.restaurant_id}
                      className="hover:bg-gradient-to-r hover:from-accent/50 hover:to-accent/30"
                    >
                      <div className="flex items-center gap-2">
                        <div className="w-2 h-2 rounded-full bg-emerald-500" />
                        {restaurant.restaurant.name}
                      </div>
                    </SelectItem>
                  ))}
                  <SelectItem 
                    value="create-new"
                    className="bg-gradient-to-r from-emerald-500/10 to-emerald-600/10 hover:from-emerald-500/20 hover:to-emerald-600/20 font-medium mt-1"
                  >
                    <div className="flex items-center gap-2">
                      <Plus className="w-4 h-4" />
                      Create new restaurant
                    </div>
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>
      </nav>

      {/* Create Restaurant Dialog */}
      <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>Create New Restaurant</DialogTitle>
            <DialogDescription>
              Add a new restaurant to your account.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleCreateRestaurant}>
            <div className="grid gap-4 py-4">
              <div className="grid grid-cols-4 items-center gap-4">
                <Label htmlFor="name" className="text-right">
                  Name *
                </Label>
                <Input
                  id="name"
                  placeholder="Restaurant name"
                  className="col-span-3"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  required
                />
              </div>
              <div className="grid grid-cols-4 items-center gap-4">
                <Label htmlFor="address" className="text-right">
                  Address
                </Label>
                <Input
                  id="address"
                  placeholder="Restaurant address"
                  className="col-span-3"
                  value={formData.address}
                  onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                />
              </div>
              <div className="grid grid-cols-4 items-center gap-4">
                <Label htmlFor="phone" className="text-right">
                  Phone
                </Label>
                <Input
                  id="phone"
                  placeholder="Phone number"
                  className="col-span-3"
                  value={formData.phone}
                  onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                />
              </div>
              <div className="grid grid-cols-4 items-center gap-4">
                <Label htmlFor="cuisine_type" className="text-right">
                  Cuisine
                </Label>
                <Input
                  id="cuisine_type"
                  placeholder="Cuisine type"
                  className="col-span-3"
                  value={formData.cuisine_type}
                  onChange={(e) => setFormData({ ...formData, cuisine_type: e.target.value })}
                />
              </div>
              <div className="grid grid-cols-4 items-center gap-4">
                <Label htmlFor="timezone" className="text-right">
                  Timezone *
                </Label>
                <div className="col-span-3">
                  <TimezoneSelector
                    value={formData.timezone}
                    onValueChange={(value) => setFormData({ ...formData, timezone: value })}
                  />
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setShowCreateDialog(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={!formData.name.trim()}>
                Create Restaurant
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
};