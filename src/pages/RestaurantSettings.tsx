import { useState, useEffect } from 'react';
import { useRestaurantContext } from '@/contexts/RestaurantContext';
import { useAuth } from '@/hooks/useAuth';
import { useRestaurants } from '@/hooks/useRestaurants';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RestaurantSelector } from '@/components/RestaurantSelector';
import { TimezoneSelector } from '@/components/TimezoneSelector';
import { useToast } from '@/hooks/use-toast';
import { Settings } from 'lucide-react';

export default function RestaurantSettings() {
  const { user } = useAuth();
  const { selectedRestaurant, restaurants, setSelectedRestaurant, loading: restaurantLoading, createRestaurant } = useRestaurantContext();
  const { updateRestaurant } = useRestaurants();
  const { toast } = useToast();

  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [phone, setPhone] = useState('');
  const [cuisineType, setCuisineType] = useState('');
  const [timezone, setTimezone] = useState(Intl.DateTimeFormat().resolvedOptions().timeZone);
  const [saving, setSaving] = useState(false);

  // Update form when selected restaurant changes
  useEffect(() => {
    if (selectedRestaurant) {
      setName(selectedRestaurant.restaurant.name);
      setAddress(selectedRestaurant.restaurant.address || '');
      setPhone(selectedRestaurant.restaurant.phone || '');
      setCuisineType(selectedRestaurant.restaurant.cuisine_type || '');
      setTimezone(selectedRestaurant.restaurant.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone);
    }
  }, [selectedRestaurant]);

  const handleSave = async () => {
    if (!selectedRestaurant) return;

    // Check if user is owner or manager
    if (selectedRestaurant.role !== 'owner' && selectedRestaurant.role !== 'manager') {
      toast({
        title: "Permission denied",
        description: "Only owners and managers can edit restaurant settings",
        variant: "destructive",
      });
      return;
    }

    setSaving(true);
    try {
      await updateRestaurant(selectedRestaurant.restaurant_id, {
        name,
        address,
        phone,
        cuisine_type: cuisineType,
        timezone,
      });
      
      toast({
        title: "Settings saved",
        description: "Restaurant settings have been updated successfully",
      });
    } catch (error) {
      console.error('Error saving settings:', error);
      toast({
        title: "Failed to save settings",
        description: error instanceof Error ? error.message : "An unexpected error occurred",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  if (!user) {
    return (
      <div className="container mx-auto px-4 py-8 text-center">
        <p>Please log in to access restaurant settings.</p>
      </div>
    );
  }

  if (!selectedRestaurant) {
    return (
      <div className="container mx-auto px-4 py-8">
        <div className="text-center space-y-4">
          <Settings className="mx-auto h-16 w-16 text-muted-foreground" />
          <h2 className="text-2xl font-semibold">Select a Restaurant</h2>
          <p className="text-muted-foreground">Choose a restaurant to manage its settings.</p>
          <RestaurantSelector
            restaurants={restaurants}
            selectedRestaurant={selectedRestaurant}
            onSelectRestaurant={setSelectedRestaurant}
            loading={restaurantLoading}
            createRestaurant={createRestaurant}
          />
        </div>
      </div>
    );
  }

  const canEdit = selectedRestaurant.role === 'owner' || selectedRestaurant.role === 'manager';

  return (
    <div className="container mx-auto px-4 py-8 max-w-3xl">
      <div className="mb-6">
        <h1 className="text-3xl font-bold mb-2">Restaurant Settings</h1>
        <p className="text-muted-foreground">
          Manage your restaurant information and preferences
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Settings className="h-5 w-5" />
            Basic Information
          </CardTitle>
          <CardDescription>
            {canEdit 
              ? "Update your restaurant's basic information" 
              : "You don't have permission to edit these settings"}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-2">
            <Label htmlFor="name">Restaurant Name *</Label>
            <Input
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={!canEdit}
              placeholder="Enter restaurant name"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="address">Address</Label>
            <Input
              id="address"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              disabled={!canEdit}
              placeholder="123 Main St, City, State"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="phone">Phone</Label>
            <Input
              id="phone"
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              disabled={!canEdit}
              placeholder="(555) 123-4567"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="cuisine">Cuisine Type</Label>
            <Input
              id="cuisine"
              value={cuisineType}
              onChange={(e) => setCuisineType(e.target.value)}
              disabled={!canEdit}
              placeholder="e.g., Italian, Mexican, Asian Fusion"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="timezone">Timezone *</Label>
            <TimezoneSelector
              value={timezone}
              onValueChange={setTimezone}
            />
            <p className="text-sm text-muted-foreground">
              This timezone is used for reports and inventory tracking. Current browser timezone: {Intl.DateTimeFormat().resolvedOptions().timeZone}
            </p>
          </div>

          {canEdit && (
            <div className="flex justify-end gap-3 pt-4">
              <Button
                variant="outline"
                onClick={() => {
                  setName(selectedRestaurant.restaurant.name);
                  setAddress(selectedRestaurant.restaurant.address || '');
                  setPhone(selectedRestaurant.restaurant.phone || '');
                  setCuisineType(selectedRestaurant.restaurant.cuisine_type || '');
                  setTimezone(selectedRestaurant.restaurant.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone);
                }}
                disabled={saving}
              >
                Reset
              </Button>
              <Button onClick={handleSave} disabled={saving || !name}>
                {saving ? 'Saving...' : 'Save Changes'}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="mt-4 p-4 bg-muted rounded-lg">
        <p className="text-sm text-muted-foreground">
          <strong>Your Role:</strong> {selectedRestaurant.role.charAt(0).toUpperCase() + selectedRestaurant.role.slice(1)}
        </p>
      </div>
    </div>
  );
}
