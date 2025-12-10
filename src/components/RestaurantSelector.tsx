import { useState } from 'react';
import { Plus, Store } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { UserRestaurant } from '@/hooks/useRestaurants';
import { TimezoneSelector } from '@/components/TimezoneSelector';

interface RestaurantSelectorProps {
  selectedRestaurant: UserRestaurant | null;
  onSelectRestaurant: (restaurant: UserRestaurant) => void;
  restaurants: UserRestaurant[];
  loading: boolean;
  canCreateRestaurant: boolean;
  createRestaurant: (data: { name: string; address?: string; phone?: string; cuisine_type?: string; timezone?: string }) => Promise<any>;
}

export function RestaurantSelector({ 
  selectedRestaurant, 
  onSelectRestaurant, 
  restaurants, 
  loading,
  canCreateRestaurant,
  createRestaurant 
}: RestaurantSelectorProps) {
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [formData, setFormData] = useState({
    name: '',
    address: '',
    phone: '',
    cuisine_type: '',
    timezone: 'America/Chicago',
  });
  const [creating, setCreating] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreating(true);

    const result = await createRestaurant(formData);
    if (result) {
      setShowAddDialog(false);
      setFormData({ name: '', address: '', phone: '', cuisine_type: '', timezone: 'America/Chicago' });
    }

    setCreating(false);
  };

  if (loading) {
    return (
      <div className="p-6">
        <p className="text-muted-foreground">Loading restaurants...</p>
      </div>
    );
  }

  const renderAddDialog = () => (
    <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="mr-2 h-4 w-4" />
          Add Restaurant
        </Button>
      </DialogTrigger>
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

          <div className="space-y-2">
            <Label htmlFor="timezone">Timezone *</Label>
            <TimezoneSelector
              value={formData.timezone}
              onValueChange={(value) => setFormData({ ...formData, timezone: value })}
            />
          </div>

          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setShowAddDialog(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={creating}>
              {creating ? 'Creating...' : 'Create Restaurant'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );

  if (!restaurants || restaurants.length === 0) {
    return (
      <div className="p-6 text-center">
        <Store className="mx-auto h-12 w-12 text-muted-foreground mb-4" />
        <h3 className="text-lg font-semibold mb-2">No restaurants yet</h3>
        <p className="text-muted-foreground mb-4">
          Get started by adding your first restaurant location.
        </p>
        
        {canCreateRestaurant ? renderAddDialog() : (
          <div className="p-4 text-sm text-muted-foreground">Contact your manager or owner to add a restaurant.</div>
        )}
      </div>
    );
  }

  return (
    <div className="p-6">
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-2xl font-bold">Select Restaurant</h2>
        
        {canCreateRestaurant ? renderAddDialog() : null}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {restaurants && restaurants.map((userRestaurant) => (
          <Card 
            key={userRestaurant.id}
            className={`cursor-pointer transition-all hover:shadow-md ${
              selectedRestaurant?.id === userRestaurant.id ? 'ring-2 ring-primary' : ''
            }`}
            onClick={() => onSelectRestaurant(userRestaurant)}
          >
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-lg">{userRestaurant.restaurant.name}</CardTitle>
                <span className="text-xs bg-secondary text-secondary-foreground px-2 py-1 rounded">
                  {userRestaurant.role}
                </span>
              </div>
              {userRestaurant.restaurant.cuisine_type && (
                <CardDescription>
                  {userRestaurant.restaurant.cuisine_type.charAt(0).toUpperCase() + 
                   userRestaurant.restaurant.cuisine_type.slice(1)} Cuisine
                </CardDescription>
              )}
            </CardHeader>
            <CardContent>
              {userRestaurant.restaurant.address && (
                <p className="text-sm text-muted-foreground">
                  {userRestaurant.restaurant.address}
                </p>
              )}
              {userRestaurant.restaurant.phone && (
                <p className="text-sm text-muted-foreground mt-1">
                  {userRestaurant.restaurant.phone}
                </p>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}