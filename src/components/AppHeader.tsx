import { useState } from 'react';
import { ChevronDown, Plus, Store, Building, LogOut, User } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { useAuth } from '@/hooks/useAuth';
import { useRestaurants } from '@/hooks/useRestaurants';
import { useRestaurantContext } from '@/contexts/RestaurantContext';

export function AppHeader() {
  const { user, signOut } = useAuth();
  const { restaurants, createRestaurant } = useRestaurants();
  const { selectedRestaurant, setSelectedRestaurant } = useRestaurantContext();
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [formData, setFormData] = useState({
    name: '',
    address: '',
    phone: '',
    cuisine_type: '',
  });
  const [creating, setCreating] = useState(false);

  const handleRestaurantSelect = (restaurant: any) => {
    setSelectedRestaurant(restaurant);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreating(true);

    const result = await createRestaurant(formData);
    if (result) {
      setShowAddDialog(false);
      setFormData({ name: '', address: '', phone: '', cuisine_type: '' });
    }

    setCreating(false);
  };

  if (!user) return null;

  return (
    <>
      <header className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="container flex h-14 items-center justify-between">
          <div className="flex items-center space-x-4">
            <div className="flex items-center space-x-2">
              <Building className="h-6 w-6" />
              <span className="font-bold">RestaurantOS</span>
            </div>

            {/* Restaurant Selector */}
            <div className="hidden md:block">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" className="min-w-[200px] justify-between">
                    {selectedRestaurant ? (
                      <div className="flex items-center space-x-2">
                        <Store className="h-4 w-4" />
                        <span className="truncate">{selectedRestaurant.restaurant?.name}</span>
                        <Badge variant="secondary" className="text-xs">
                          {selectedRestaurant.role}
                        </Badge>
                      </div>
                    ) : (
                      <div className="flex items-center space-x-2">
                        <Store className="h-4 w-4" />
                        <span>Select Restaurant</span>
                      </div>
                    )}
                    <ChevronDown className="h-4 w-4 ml-2" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent className="w-[300px]">
                  {restaurants.map((restaurant) => (
                    <DropdownMenuItem
                      key={restaurant.id}
                      onClick={() => handleRestaurantSelect(restaurant)}
                      className="flex items-center justify-between p-3"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="font-medium truncate">
                          {restaurant.restaurant?.name}
                        </div>
                        {restaurant.restaurant?.cuisine_type && (
                          <div className="text-xs text-muted-foreground">
                            {restaurant.restaurant.cuisine_type.charAt(0).toUpperCase() + 
                             restaurant.restaurant.cuisine_type.slice(1)} Cuisine
                          </div>
                        )}
                      </div>
                      <Badge variant="outline" className="text-xs ml-2">
                        {restaurant.role}
                      </Badge>
                    </DropdownMenuItem>
                  ))}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onClick={() => setShowAddDialog(true)}
                    className="flex items-center space-x-2 p-3"
                  >
                    <Plus className="h-4 w-4" />
                    <span>Add New Restaurant</span>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>

          {/* User Menu */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className="relative h-9 w-9 rounded-full">
                <User className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent className="w-56" align="end">
              <div className="flex items-center justify-start gap-2 p-2">
                <div className="flex flex-col space-y-1 leading-none">
                  <p className="font-medium">{user.email}</p>
                </div>
              </div>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={signOut}>
                <LogOut className="mr-2 h-4 w-4" />
                Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {/* Mobile Restaurant Selector */}
        <div className="md:hidden border-t p-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" className="w-full justify-between">
                {selectedRestaurant ? (
                  <div className="flex items-center space-x-2">
                    <Store className="h-4 w-4" />
                    <span className="truncate">{selectedRestaurant.restaurant?.name}</span>
                    <Badge variant="secondary" className="text-xs">
                      {selectedRestaurant.role}
                    </Badge>
                  </div>
                ) : (
                  <div className="flex items-center space-x-2">
                    <Store className="h-4 w-4" />
                    <span>Select Restaurant</span>
                  </div>
                )}
                <ChevronDown className="h-4 w-4 ml-2" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent className="w-[calc(100vw-1rem)]">
              {restaurants.map((restaurant) => (
                <DropdownMenuItem
                  key={restaurant.id}
                  onClick={() => handleRestaurantSelect(restaurant)}
                  className="flex items-center justify-between p-3"
                >
                  <div className="flex-1 min-w-0">
                    <div className="font-medium truncate">
                      {restaurant.restaurant?.name}
                    </div>
                    {restaurant.restaurant?.cuisine_type && (
                      <div className="text-xs text-muted-foreground">
                        {restaurant.restaurant.cuisine_type.charAt(0).toUpperCase() + 
                         restaurant.restaurant.cuisine_type.slice(1)} Cuisine
                      </div>
                    )}
                  </div>
                  <Badge variant="outline" className="text-xs ml-2">
                    {restaurant.role}
                  </Badge>
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => setShowAddDialog(true)}
                className="flex items-center space-x-2 p-3"
              >
                <Plus className="h-4 w-4" />
                <span>Add New Restaurant</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>

      {/* Add Restaurant Dialog */}
      <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add New Restaurant</DialogTitle>
            <DialogDescription>
              Create a new restaurant location to start tracking your operations.
            </DialogDescription>
          </DialogHeader>
          
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name">Restaurant Name *</Label>
              <Input
                id="name"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder="Mario's Pizza"
                required
              />
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="address">Address</Label>
              <Input
                id="address"
                value={formData.address}
                onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                placeholder="123 Main St, City, State"
              />
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="phone">Phone</Label>
              <Input
                id="phone"
                value={formData.phone}
                onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                placeholder="(555) 123-4567"
              />
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="cuisine_type">Cuisine Type</Label>
              <Select onValueChange={(value) => setFormData({ ...formData, cuisine_type: value })}>
                <SelectTrigger>
                  <SelectValue placeholder="Select cuisine type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="italian">Italian</SelectItem>
                  <SelectItem value="mexican">Mexican</SelectItem>
                  <SelectItem value="american">American</SelectItem>
                  <SelectItem value="chinese">Chinese</SelectItem>
                  <SelectItem value="japanese">Japanese</SelectItem>
                  <SelectItem value="indian">Indian</SelectItem>
                  <SelectItem value="thai">Thai</SelectItem>
                  <SelectItem value="mediterranean">Mediterranean</SelectItem>
                  <SelectItem value="other">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>
            
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setShowAddDialog(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={creating}>
                {creating ? "Creating..." : "Create Restaurant"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}