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
  Clock,
  Info,
  Sparkles,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { TimezoneSelector } from '@/components/TimezoneSelector';
import { calculatePrice, formatPrice, getVolumeDiscountPercent } from '@/lib/subscriptionPlans';
import { UserProfileDropdown } from '@/components/UserProfileDropdown';
import { SidebarTrigger } from '@/components/ui/sidebar';
import { useSubscription } from '@/hooks/useSubscription';

/**
 * Get styles for trial countdown badge based on days remaining
 */
function getTrialBadgeStyles(daysRemaining: number): string {
  if (daysRemaining <= 3) {
    return 'border-red-500 text-red-600 hover:bg-red-50 dark:hover:bg-red-950';
  }
  if (daysRemaining <= 7) {
    return 'border-amber-500 text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-950';
  }
  return 'border-blue-500 text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-950';
}

/**
 * Volume discount progress indicator
 */
function VolumeDiscountProgress({
  newDiscount,
  currentDiscount,
  nextMilestone,
  restaurantsUntilMilestone,
}: {
  newDiscount: number;
  currentDiscount: number;
  nextMilestone: { threshold: number; percent: number } | null;
  restaurantsUntilMilestone: number;
}): React.ReactElement | null {
  // Unlocking a new discount tier
  if (newDiscount > currentDiscount) {
    return (
      <div className="flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400 pt-1">
        <Sparkles className="h-3 w-3" />
        <span>
          You'll unlock a {newDiscount}% volume discount with this location!
        </span>
      </div>
    );
  }

  // Show progress to next milestone
  if (nextMilestone && restaurantsUntilMilestone > 0) {
    return (
      <div className="text-xs text-muted-foreground pt-1">
        {restaurantsUntilMilestone} more location{restaurantsUntilMilestone !== 1 ? 's' : ''} until {nextMilestone.percent}% volume discount
      </div>
    );
  }

  return null;
}

/**
 * Billing preview shown when adding restaurants
 */
function BillingPreview({
  currentCount,
  tier,
  period,
}: {
  currentCount: number;
  tier: 'starter' | 'growth' | 'pro';
  period: 'monthly' | 'annual';
}) {
  const currentPricing = calculatePrice(tier, period, currentCount);
  const newPricing = calculatePrice(tier, period, currentCount + 1);
  const currentDiscount = getVolumeDiscountPercent(currentCount);
  const newDiscount = getVolumeDiscountPercent(currentCount + 1);

  // Find next volume discount milestone
  const getNextMilestone = (count: number): { threshold: number; percent: number } | null => {
    if (count < 3) return { threshold: 3, percent: 5 };
    if (count < 6) return { threshold: 6, percent: 10 };
    if (count < 11) return { threshold: 11, percent: 15 };
    return null;
  };

  const nextMilestone = getNextMilestone(currentCount + 1);
  const restaurantsUntilMilestone = nextMilestone ? nextMilestone.threshold - (currentCount + 1) : 0;

  return (
    <Alert className="bg-muted/50 border-muted-foreground/20">
      <Info className="h-4 w-4" />
      <AlertDescription className="space-y-2">
        <div className="flex justify-between items-center text-sm">
          <span className="text-muted-foreground">
            Current ({currentCount} location{currentCount !== 1 ? 's' : ''}):
          </span>
          <span className="font-medium">{formatPrice(currentPricing.totalPrice)}/mo</span>
        </div>
        <div className="flex justify-between items-center text-sm">
          <span className="text-muted-foreground">
            After adding this location:
          </span>
          <span className="font-semibold text-foreground">{formatPrice(newPricing.totalPrice)}/mo</span>
        </div>

        {/* Volume discount progress */}
        <VolumeDiscountProgress
          newDiscount={newDiscount}
          currentDiscount={currentDiscount}
          nextMilestone={nextMilestone}
          restaurantsUntilMilestone={restaurantsUntilMilestone}
        />
      </AlertDescription>
    </Alert>
  );
}

export const AppHeader = () => {
  const { selectedRestaurant, setSelectedRestaurant, restaurants, createRestaurant, canCreateRestaurant } = useRestaurantContext();
  const { isTrialing, trialDaysRemaining, effectiveTier, subscription } = useSubscription();
  const navigate = useNavigate();
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [creating, setCreating] = useState(false);
  const [formData, setFormData] = useState({
    name: '',
    address: '',
    phone: '',
    cuisine_type: '',
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  });

  const handleCreateRestaurant = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name.trim() || creating) return;

    setCreating(true);
    try {
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
    } finally {
      setCreating(false);
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
                  {canCreateRestaurant && (
                    <SelectItem 
                      value="create-new"
                      className="bg-gradient-to-r from-emerald-500/10 to-emerald-600/10 hover:from-emerald-500/20 hover:to-emerald-600/20 font-medium mt-1"
                    >
                      <div className="flex items-center gap-2">
                        <Plus className="w-4 h-4" />
                        Create new restaurant
                      </div>
                    </SelectItem>
                  )}
                </SelectContent>
              </Select>
            </div>

            {/* Right: Trial Countdown + User Profile */}
            <div className="flex items-center gap-3">
              {/* Trial Countdown Badge */}
              {isTrialing && trialDaysRemaining !== null && (
                <Badge
                  variant="outline"
                  className={`cursor-pointer transition-colors ${getTrialBadgeStyles(trialDaysRemaining)}`}
                  onClick={() => navigate('/settings?tab=subscription')}
                >
                  <Clock className="mr-1.5 h-3 w-3" />
                  {trialDaysRemaining} day{trialDaysRemaining !== 1 ? 's' : ''} left
                </Badge>
              )}
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

            {/* Billing Preview for existing owners */}
            {restaurants.length > 0 && effectiveTier && (
              <BillingPreview
                currentCount={restaurants.length}
                tier={effectiveTier}
                period={subscription?.period || 'monthly'}
              />
            )}

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setShowCreateDialog(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={!formData.name.trim() || creating}>
                {creating ? 'Creating...' : 'Create Restaurant'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
};
