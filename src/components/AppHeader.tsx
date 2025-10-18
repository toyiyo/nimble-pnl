import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { 
  Plus, 
  Building2, 
  CalendarCheck, 
} from 'lucide-react';
import { TimezoneSelector } from '@/components/TimezoneSelector';
import { UserProfileDropdown } from '@/components/UserProfileDropdown';
import { SidebarTrigger } from '@/components/ui/sidebar';

export const AppHeader = () => {
  const { selectedRestaurant, setSelectedRestaurant, restaurants, createRestaurant } = useRestaurantContext();
  const navigate = useNavigate();
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [formData, setFormData] = useState({
    name: '',
    address: '',
    phone: '',
    cuisine_type: '',
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  });

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
      <header className="border-b bg-gradient-to-r from-background via-background to-muted/20 backdrop-blur-xl supports-[backdrop-filter]:bg-background/60 sticky top-0 z-50">
        <div className="container px-4 max-w-screen-2xl mx-auto">
          <div className="flex h-14 items-center justify-between gap-4">
            {/* Left: Sidebar toggle */}
            <div className="flex items-center">
              <SidebarTrigger className="-ml-1" />
            </div>

            {/* Center: Restaurant Selector */}
            <div className="flex items-center gap-2 flex-1 justify-center max-w-xs">
              <Building2 className="w-4 h-4 text-muted-foreground flex-shrink-0" />
              <Select
                value={selectedRestaurant?.restaurant_id || ''}
                onValueChange={handleRestaurantChange}
              >
                <SelectTrigger className="w-full hover:bg-accent/50 transition-all duration-200">
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

            {/* Right: User Profile */}
            <div className="flex items-center">
              <UserProfileDropdown />
            </div>
          </div>
        </div>
      </header>

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