import { useState, useEffect, useMemo } from 'react';
import { useRestaurantContext } from '@/contexts/RestaurantContext';
import { useAuth } from '@/hooks/useAuth';
import { useRestaurants } from '@/hooks/useRestaurants';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { RestaurantSelector } from '@/components/RestaurantSelector';
import { TimezoneSelector } from '@/components/TimezoneSelector';
import { MetricIcon } from '@/components/MetricIcon';
import { SecuritySettings } from '@/components/SecuritySettings';
import { NotificationSettings } from '@/components/NotificationSettings';
import { useToast } from '@/hooks/use-toast';
import { Settings, Save, RotateCcw, AlertCircle } from 'lucide-react';

export default function RestaurantSettings() {
  const { user } = useAuth();
  const { selectedRestaurant, restaurants, setSelectedRestaurant, loading: restaurantLoading, createRestaurant, canCreateRestaurant } = useRestaurantContext();
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

  const hasChanges = useMemo(() => {
    if (!selectedRestaurant) return false;
    return (
      name !== selectedRestaurant.restaurant.name ||
      address !== (selectedRestaurant.restaurant.address || '') ||
      phone !== (selectedRestaurant.restaurant.phone || '') ||
      cuisineType !== (selectedRestaurant.restaurant.cuisine_type || '') ||
      timezone !== (selectedRestaurant.restaurant.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone)
    );
  }, [selectedRestaurant, name, address, phone, cuisineType, timezone]);

  if (!user) {
    return (
      <div className="w-full px-4 py-8">
        <div className="text-center p-8 rounded-lg bg-gradient-to-br from-destructive/5 via-destructive/10 to-transparent border border-destructive/20">
          <MetricIcon icon={AlertCircle} variant="red" className="mx-auto mb-4" />
          <h2 className="text-xl font-semibold mb-2">Authentication Required</h2>
          <p className="text-muted-foreground">Please log in to access restaurant settings.</p>
        </div>
      </div>
    );
  }

  if (restaurantLoading) {
    return (
      <div className="w-full px-4 py-8">
        <div className="space-y-6">
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-96 w-full" />
        </div>
        <p className="sr-only">Loading restaurant settings...</p>
      </div>
    );
  }

  if (!selectedRestaurant) {
    return (
      <div className="w-full px-4 py-8">
        <div className="text-center space-y-6 p-8 rounded-lg bg-gradient-to-br from-primary/5 via-accent/5 to-transparent border border-border/50">
          <MetricIcon icon={Settings} variant="blue" className="mx-auto" />
          <div>
            <h2 className="text-2xl font-semibold mb-2">Select a Restaurant</h2>
            <p className="text-muted-foreground">Choose a restaurant to manage its settings.</p>
          </div>
          <RestaurantSelector
            restaurants={restaurants}
            selectedRestaurant={selectedRestaurant}
            onSelectRestaurant={setSelectedRestaurant}
            loading={restaurantLoading}
            canCreateRestaurant={canCreateRestaurant}
            createRestaurant={createRestaurant}
          />
        </div>
      </div>
    );
  }

  const canEdit = selectedRestaurant.role === 'owner' || selectedRestaurant.role === 'manager';

  return (
    <div className="w-full px-4 py-8">
      {/* Hero Section with Gradient */}
      <Card className="mb-6 bg-gradient-to-br from-primary/5 via-accent/5 to-transparent border-primary/10">
        <CardContent className="pt-6">
          <div className="flex items-start gap-4">
            <MetricIcon icon={Settings} variant="purple" />
            <div className="flex-1">
              <h1 className="text-3xl font-bold mb-2 tracking-tight bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
                Restaurant Settings
              </h1>
              <p className="text-muted-foreground leading-relaxed mb-3">
                Manage your restaurant information and preferences
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline" className="bg-background/50">
                  {selectedRestaurant.restaurant.name}
                </Badge>
                <Badge variant={canEdit ? "default" : "secondary"} aria-label={`Your role: ${selectedRestaurant.role}`}>
                  {selectedRestaurant.role.charAt(0).toUpperCase() + selectedRestaurant.role.slice(1)}
                </Badge>
                {!canEdit && (
                  <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-300 dark:bg-amber-950 dark:text-amber-400">
                    <AlertCircle className="h-3 w-3 mr-1" aria-hidden="true" />
                    Read Only
                  </Badge>
                )}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="shadow-md hover:shadow-lg transition-shadow duration-200">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
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
            <Label htmlFor="name" className="font-medium">
              Restaurant Name <span className="text-destructive" aria-label="required">*</span>
            </Label>
            <Input
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={!canEdit}
              placeholder="Enter restaurant name"
              className="transition-all duration-200 focus:ring-2 focus:ring-primary/20"
              aria-required="true"
              aria-describedby={!canEdit ? "name-readonly" : undefined}
            />
            {!canEdit && (
              <p id="name-readonly" className="text-xs text-muted-foreground">
                Contact an owner or manager to change this field
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="address" className="font-medium">Address</Label>
            <Input
              id="address"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              disabled={!canEdit}
              placeholder="123 Main St, City, State"
              className="transition-all duration-200 focus:ring-2 focus:ring-primary/20"
              aria-describedby="address-help"
            />
            <p id="address-help" className="text-xs text-muted-foreground">
              Physical location of your restaurant
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="phone" className="font-medium">Phone</Label>
            <Input
              id="phone"
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              disabled={!canEdit}
              placeholder="(555) 123-4567"
              className="transition-all duration-200 focus:ring-2 focus:ring-primary/20"
              aria-describedby="phone-help"
            />
            <p id="phone-help" className="text-xs text-muted-foreground">
              Primary contact number
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="cuisine" className="font-medium">Cuisine Type</Label>
            <Input
              id="cuisine"
              value={cuisineType}
              onChange={(e) => setCuisineType(e.target.value)}
              disabled={!canEdit}
              placeholder="e.g., Italian, Mexican, Asian Fusion"
              className="transition-all duration-200 focus:ring-2 focus:ring-primary/20"
              aria-describedby="cuisine-help"
            />
            <p id="cuisine-help" className="text-xs text-muted-foreground">
              Type of cuisine served
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="timezone" className="font-medium">
              Timezone <span className="text-destructive" aria-label="required">*</span>
            </Label>
            <TimezoneSelector
              value={timezone}
              onValueChange={setTimezone}
              disabled={!canEdit}
            />
            <p id="timezone-help" className="text-xs text-muted-foreground">
              Used for reports and inventory tracking. Browser timezone: {Intl.DateTimeFormat().resolvedOptions().timeZone}
            </p>
          </div>

          {canEdit && (
            <div 
              className="flex justify-end gap-3 pt-4 border-t" 
              role="group" 
              aria-label="Form actions"
            >
              <Button
                variant="outline"
                onClick={() => {
                  setName(selectedRestaurant.restaurant.name);
                  setAddress(selectedRestaurant.restaurant.address || '');
                  setPhone(selectedRestaurant.restaurant.phone || '');
                  setCuisineType(selectedRestaurant.restaurant.cuisine_type || '');
                  setTimezone(selectedRestaurant.restaurant.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone);
                }}
                disabled={saving || !hasChanges}
                className="transition-all duration-200 hover:bg-accent"
                aria-label="Reset form to original values"
              >
                <RotateCcw className="h-4 w-4 mr-2" aria-hidden="true" />
                Reset
              </Button>
              <Button 
                onClick={handleSave} 
                disabled={saving || !name || !hasChanges}
                className="transition-all duration-200"
                aria-label={saving ? "Saving changes" : "Save changes"}
              >
                <Save className="h-4 w-4 mr-2" aria-hidden="true" />
                {saving ? 'Saving...' : 'Save Changes'}
              </Button>
            </div>
          )}

          {/* Status announcement for screen readers */}
          {saving && (
            <div role="status" aria-live="polite" className="sr-only">
              Saving restaurant settings...
            </div>
          )}
        </CardContent>
      </Card>

      {/* Notification Settings */}
      {canEdit && (
        <div className="mt-6">
          <NotificationSettings restaurantId={selectedRestaurant.restaurant_id} />
        </div>
      )}

      {/* Security Settings */}
      <SecuritySettings />
    </div>
  );
}
