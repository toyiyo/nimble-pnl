import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Plus, Building2 } from 'lucide-react';

export const AppHeader = () => {
  const { user, signOut } = useAuth();
  const { selectedRestaurant, setSelectedRestaurant, restaurants, createRestaurant } = useRestaurantContext();
  const navigate = useNavigate();
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [formData, setFormData] = useState({
    name: '',
    address: '',
    phone: '',
    cuisine_type: '',
  });

  const handleCreateRestaurant = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name.trim()) return;

    const newRestaurant = await createRestaurant({
      name: formData.name,
      address: formData.address || undefined,
      phone: formData.phone || undefined,
      cuisine_type: formData.cuisine_type || undefined,
    });

    if (newRestaurant) {
      setFormData({ name: '', address: '', phone: '', cuisine_type: '' });
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
      <nav className="border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="container px-4">
          <div className="flex h-14 items-center justify-between">
            <div className="flex items-center gap-2 md:gap-4 min-w-0">
              <h1 className="text-lg md:text-xl font-semibold truncate">Restaurant Operations</h1>
              
              {/* Restaurant Selector */}
              <div className="hidden sm:flex items-center gap-2">
                <Building2 className="w-4 h-4 text-muted-foreground" />
                <Select
                  value={selectedRestaurant?.restaurant_id || ''}
                  onValueChange={handleRestaurantChange}
                >
                  <SelectTrigger className="w-[200px]">
                    <SelectValue placeholder="Select restaurant" />
                  </SelectTrigger>
                  <SelectContent>
                    {restaurants.map((restaurant) => (
                      <SelectItem key={restaurant.restaurant_id} value={restaurant.restaurant_id}>
                        {restaurant.restaurant.name}
                      </SelectItem>
                    ))}
                    <SelectItem value="create-new">
                      <div className="flex items-center gap-2">
                        <Plus className="w-4 h-4" />
                        Create new restaurant
                      </div>
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            
            {/* Navigation Buttons */}
            <div className="flex items-center gap-1 md:gap-4 overflow-x-auto">
              <span className="hidden md:block text-sm text-muted-foreground truncate">
                Welcome, {user?.email}
              </span>
              <div className="flex gap-1 md:gap-2">
                <Button variant="outline" size="sm" onClick={() => navigate('/')} className="text-xs whitespace-nowrap">
                  Dashboard
                </Button>
                <Button variant="outline" size="sm" onClick={() => navigate('/integrations')} className="text-xs whitespace-nowrap">
                  Integrations
                </Button>
                <Button variant="outline" size="sm" onClick={() => navigate('/pos-sales')} className="text-xs whitespace-nowrap">
                  POS Sales
                </Button>
                <Button variant="outline" size="sm" onClick={() => navigate('/recipes')} className="text-xs whitespace-nowrap">
                  Recipes
                </Button>
                <Button variant="outline" size="sm" onClick={() => navigate('/inventory')} className="text-xs whitespace-nowrap">
                  Inventory
                </Button>
                <Button variant="outline" size="sm" onClick={() => navigate('/reports')} className="text-xs whitespace-nowrap">
                  Reports
                </Button>
                <Button variant="outline" size="sm" onClick={() => navigate('/team')} className="text-xs whitespace-nowrap">
                  Team
                </Button>
                <Button variant="outline" size="sm" onClick={signOut} className="text-xs whitespace-nowrap">
                  Sign Out
                </Button>
              </div>
            </div>
          </div>
          
          {/* Mobile Restaurant Selector */}
          <div className="sm:hidden py-2 border-t">
            <div className="flex items-center gap-2">
              <Building2 className="w-4 h-4 text-muted-foreground" />
              <Select
                value={selectedRestaurant?.restaurant_id || ''}
                onValueChange={handleRestaurantChange}
              >
                <SelectTrigger className="flex-1">
                  <SelectValue placeholder="Select restaurant" />
                </SelectTrigger>
                <SelectContent>
                  {restaurants.map((restaurant) => (
                    <SelectItem key={restaurant.restaurant_id} value={restaurant.restaurant_id}>
                      {restaurant.restaurant.name}
                    </SelectItem>
                  ))}
                  <SelectItem value="create-new">
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