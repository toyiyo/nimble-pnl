import { useState, useEffect, useMemo, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useRestaurantContext } from '@/contexts/RestaurantContext';
import { useAuth } from '@/hooks/useAuth';
import { useRestaurants, type Restaurant } from '@/hooks/useRestaurants';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { RestaurantSelector } from '@/components/RestaurantSelector';
import { TimezoneSelector } from '@/components/TimezoneSelector';
import { MetricIcon } from '@/components/MetricIcon';
import { SecuritySettings } from '@/components/SecuritySettings';
import { NotificationSettings } from '@/components/NotificationSettings';
import { SubscriptionPlans, TrialBanner } from '@/components/subscription';
import { useToast } from '@/hooks/use-toast';
import { Settings, Save, RotateCcw, AlertCircle, CreditCard, Building } from 'lucide-react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

export default function RestaurantSettings() {
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const { selectedRestaurant, restaurants, setSelectedRestaurant, loading: restaurantLoading, createRestaurant, canCreateRestaurant } = useRestaurantContext();
  const { updateRestaurant } = useRestaurants();
  const { toast } = useToast();

  // Tab state from URL - memoize setActiveTab to prevent unnecessary re-renders
  const activeTab = searchParams.get('tab') || 'general';
  const setActiveTab = useCallback(
    (tab: string) => {
      setSearchParams({ tab });
    },
    [setSearchParams]
  );

  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [phone, setPhone] = useState('');
  const [cuisineType, setCuisineType] = useState('');
  const [timezone, setTimezone] = useState(Intl.DateTimeFormat().resolvedOptions().timeZone);
  const [saving, setSaving] = useState(false);

  // Business info state
  const [legalName, setLegalName] = useState('');
  const [addressLine1, setAddressLine1] = useState('');
  const [addressLine2, setAddressLine2] = useState('');
  const [city, setCity] = useState('');
  const [stateProv, setStateProv] = useState('');
  const [zip, setZip] = useState('');
  const [country, setCountry] = useState('US');
  const [businessEmail, setBusinessEmail] = useState('');
  const [ein, setEin] = useState('');
  const [entityType, setEntityType] = useState<Restaurant['entity_type'] | ''>('');
  const [savingBusiness, setSavingBusiness] = useState(false);

  // Update form when selected restaurant changes
  useEffect(() => {
    if (selectedRestaurant) {
      const r = selectedRestaurant.restaurant;
      setName(r.name);
      setAddress(r.address || '');
      setPhone(r.phone || '');
      setCuisineType(r.cuisine_type || '');
      setTimezone(r.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone);
      // Business info
      setLegalName(r.legal_name || '');
      setAddressLine1(r.address_line1 || '');
      setAddressLine2(r.address_line2 || '');
      setCity(r.city || '');
      setStateProv(r.state || '');
      setZip(r.zip || '');
      setCountry(r.country || 'US');
      setBusinessEmail(r.business_email || '');
      setEin(r.ein || '');
      setEntityType(r.entity_type || '');
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

  const hasBusinessChanges = useMemo(() => {
    if (!selectedRestaurant) return false;
    const r = selectedRestaurant.restaurant;
    return (
      legalName !== (r.legal_name || '') ||
      addressLine1 !== (r.address_line1 || '') ||
      addressLine2 !== (r.address_line2 || '') ||
      city !== (r.city || '') ||
      stateProv !== (r.state || '') ||
      zip !== (r.zip || '') ||
      country !== (r.country || 'US') ||
      businessEmail !== (r.business_email || '') ||
      ein !== (r.ein || '') ||
      entityType !== (r.entity_type || '')
    );
  }, [selectedRestaurant, legalName, addressLine1, addressLine2, city, stateProv, zip, country, businessEmail, ein, entityType]);

  const handleSaveBusiness = async () => {
    if (!selectedRestaurant) return;
    if (selectedRestaurant.role !== 'owner' && selectedRestaurant.role !== 'manager') {
      toast({ title: "Permission denied", description: "Only owners and managers can edit business information", variant: "destructive" });
      return;
    }
    setSavingBusiness(true);
    try {
      await updateRestaurant(selectedRestaurant.restaurant_id, {
        legal_name: legalName || null,
        address_line1: addressLine1 || null,
        address_line2: addressLine2 || null,
        city: city || null,
        state: stateProv || null,
        zip: zip || null,
        country: country || null,
        business_email: businessEmail || null,
        ein: ein || null,
        entity_type: entityType || null,
      });
      toast({ title: "Business info saved", description: "Business information has been updated successfully" });
    } catch (error) {
      console.error('Error saving business info:', error);
      toast({ title: "Failed to save", description: error instanceof Error ? error.message : "An unexpected error occurred", variant: "destructive" });
    } finally {
      setSavingBusiness(false);
    }
  };

  const canEdit = selectedRestaurant?.role === 'owner' || selectedRestaurant?.role === 'manager';
  const isOwner = selectedRestaurant?.role === 'owner';

  // Compute allowed tabs based on user role
  const allowedTabs = useMemo(() => {
    return [
      'general',
      ...(canEdit ? ['business'] : []),
      ...(isOwner ? ['subscription'] : []),
      ...(canEdit ? ['notifications'] : []),
      'security',
    ];
  }, [isOwner, canEdit]);

  // Normalize activeTab if it's not in allowedTabs
  useEffect(() => {
    if (!allowedTabs.includes(activeTab)) {
      setActiveTab(allowedTabs[0]);
    }
  }, [activeTab, allowedTabs, setActiveTab]);

  // Compute grid columns class based on visible tab count
  const gridColsMap: Record<number, string> = {
    5: 'grid-cols-5',
    4: 'grid-cols-4',
    3: 'grid-cols-3',
  };
  const gridColsClass = gridColsMap[allowedTabs.length] || 'grid-cols-2';

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

  return (
    <div className="w-full px-4 py-8">
      {/* Trial/Subscription Status Banner */}
      {isOwner && <TrialBanner />}

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

      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
        <TabsList className={`grid w-full ${gridColsClass}`}>
          <TabsTrigger value="general">
            <Settings className="h-4 w-4 mr-2" />
            General
          </TabsTrigger>
          {canEdit && (
            <TabsTrigger value="business">
              <Building className="h-4 w-4 mr-2" />
              Business
            </TabsTrigger>
          )}
          {isOwner && (
            <TabsTrigger value="subscription">
              <CreditCard className="h-4 w-4 mr-2" />
              Subscription
            </TabsTrigger>
          )}
          {canEdit && (
            <TabsTrigger value="notifications">
              Notifications
            </TabsTrigger>
          )}
          <TabsTrigger value="security">
            Security
          </TabsTrigger>
        </TabsList>

        {/* General Settings Tab */}
        <TabsContent value="general">
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
        </TabsContent>

        {/* Business Information Tab */}
        {canEdit && (
          <TabsContent value="business">
            <Card className="shadow-md hover:shadow-lg transition-shadow duration-200">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  Business Information
                </CardTitle>
                <CardDescription>
                  Used for check printing, invoices, and payment setup
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-5">
                {/* Entity Details */}
                <div className="rounded-xl border border-border/40 bg-muted/30 overflow-hidden">
                  <div className="px-4 py-3 border-b border-border/40 bg-muted/50">
                    <h3 className="text-[13px] font-semibold text-foreground">Entity Details</h3>
                  </div>
                  <div className="p-4 space-y-4">
                    <div className="grid gap-4 md:grid-cols-2">
                      <div className="space-y-2">
                        <Label htmlFor="legalName" className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider">
                          Legal Name
                        </Label>
                        <Input
                          id="legalName"
                          value={legalName}
                          onChange={(e) => setLegalName(e.target.value)}
                          placeholder="Legal entity name"
                          className="h-10 text-[14px] bg-muted/30 border-border/40 rounded-lg focus-visible:ring-1 focus-visible:ring-border"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="entityType" className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider">
                          Entity Type
                        </Label>
                        <Select value={entityType} onValueChange={(v) => setEntityType(v as typeof entityType)}>
                          <SelectTrigger id="entityType" className="h-10 text-[14px] bg-muted/30 border-border/40 rounded-lg">
                            <SelectValue placeholder="Select type" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="sole_proprietor">Sole Proprietor</SelectItem>
                            <SelectItem value="llc">LLC</SelectItem>
                            <SelectItem value="corporation">Corporation</SelectItem>
                            <SelectItem value="s_corporation">S Corporation</SelectItem>
                            <SelectItem value="partnership">Partnership</SelectItem>
                            <SelectItem value="non_profit">Non-Profit</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    <div className="grid gap-4 md:grid-cols-2">
                      <div className="space-y-2">
                        <Label htmlFor="businessEmail" className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider">
                          Business Email
                        </Label>
                        <Input
                          id="businessEmail"
                          type="email"
                          value={businessEmail}
                          onChange={(e) => setBusinessEmail(e.target.value)}
                          placeholder="billing@restaurant.com"
                          className="h-10 text-[14px] bg-muted/30 border-border/40 rounded-lg focus-visible:ring-1 focus-visible:ring-border"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="ein" className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider">
                          EIN
                        </Label>
                        <Input
                          id="ein"
                          value={ein}
                          onChange={(e) => {
                            const raw = e.target.value.replace(/[^0-9]/g, '').slice(0, 9);
                            setEin(raw.length > 2 ? `${raw.slice(0, 2)}-${raw.slice(2)}` : raw);
                          }}
                          placeholder="XX-XXXXXXX"
                          maxLength={10}
                          className="h-10 text-[14px] bg-muted/30 border-border/40 rounded-lg focus-visible:ring-1 focus-visible:ring-border"
                        />
                      </div>
                    </div>
                  </div>
                </div>

                {/* Address */}
                <div className="rounded-xl border border-border/40 bg-muted/30 overflow-hidden">
                  <div className="px-4 py-3 border-b border-border/40 bg-muted/50">
                    <h3 className="text-[13px] font-semibold text-foreground">Business Address</h3>
                  </div>
                  <div className="p-4 space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="addressLine1" className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider">
                        Address Line 1
                      </Label>
                      <Input
                        id="addressLine1"
                        value={addressLine1}
                        onChange={(e) => setAddressLine1(e.target.value)}
                        placeholder="Street address"
                        className="h-10 text-[14px] bg-muted/30 border-border/40 rounded-lg focus-visible:ring-1 focus-visible:ring-border"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="addressLine2" className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider">
                        Address Line 2
                      </Label>
                      <Input
                        id="addressLine2"
                        value={addressLine2}
                        onChange={(e) => setAddressLine2(e.target.value)}
                        placeholder="Suite, unit, etc."
                        className="h-10 text-[14px] bg-muted/30 border-border/40 rounded-lg focus-visible:ring-1 focus-visible:ring-border"
                      />
                    </div>
                    <div className="grid gap-4 md:grid-cols-4">
                      <div className="space-y-2 md:col-span-2">
                        <Label htmlFor="city" className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider">
                          City
                        </Label>
                        <Input
                          id="city"
                          value={city}
                          onChange={(e) => setCity(e.target.value)}
                          placeholder="City"
                          className="h-10 text-[14px] bg-muted/30 border-border/40 rounded-lg focus-visible:ring-1 focus-visible:ring-border"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="stateProv" className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider">
                          State
                        </Label>
                        <Input
                          id="stateProv"
                          value={stateProv}
                          onChange={(e) => setStateProv(e.target.value.toUpperCase())}
                          maxLength={2}
                          placeholder="CA"
                          className="h-10 text-[14px] bg-muted/30 border-border/40 rounded-lg focus-visible:ring-1 focus-visible:ring-border uppercase"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="zip" className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider">
                          ZIP
                        </Label>
                        <Input
                          id="zip"
                          value={zip}
                          onChange={(e) => setZip(e.target.value)}
                          maxLength={10}
                          placeholder="90210"
                          className="h-10 text-[14px] bg-muted/30 border-border/40 rounded-lg focus-visible:ring-1 focus-visible:ring-border"
                        />
                      </div>
                    </div>
                    <div className="space-y-2 max-w-[200px]">
                      <Label htmlFor="country" className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider">
                        Country
                      </Label>
                      <Input
                        id="country"
                        value={country}
                        onChange={(e) => setCountry(e.target.value.toUpperCase())}
                        maxLength={2}
                        placeholder="US"
                        className="h-10 text-[14px] bg-muted/30 border-border/40 rounded-lg focus-visible:ring-1 focus-visible:ring-border uppercase"
                      />
                    </div>
                  </div>
                </div>

                <div
                  className="flex justify-end gap-3 pt-4 border-t"
                  role="group"
                  aria-label="Business form actions"
                >
                  <Button
                    variant="outline"
                    onClick={() => {
                      if (!selectedRestaurant) return;
                      const r = selectedRestaurant.restaurant;
                      setLegalName(r.legal_name || '');
                      setAddressLine1(r.address_line1 || '');
                      setAddressLine2(r.address_line2 || '');
                      setCity(r.city || '');
                      setStateProv(r.state || '');
                      setZip(r.zip || '');
                      setCountry(r.country || 'US');
                      setBusinessEmail(r.business_email || '');
                      setEin(r.ein || '');
                      setEntityType(r.entity_type || '');
                    }}
                    disabled={savingBusiness || !hasBusinessChanges}
                    className="transition-all duration-200 hover:bg-accent"
                    aria-label="Reset business form to original values"
                  >
                    <RotateCcw className="h-4 w-4 mr-2" aria-hidden="true" />
                    Reset
                  </Button>
                  <Button
                    onClick={handleSaveBusiness}
                    disabled={savingBusiness || !hasBusinessChanges}
                    className="transition-all duration-200"
                    aria-label={savingBusiness ? "Saving business info" : "Save business info"}
                  >
                    <Save className="h-4 w-4 mr-2" aria-hidden="true" />
                    {savingBusiness ? 'Saving...' : 'Save Changes'}
                  </Button>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        )}

        {/* Subscription Tab - Only for owners */}
        {isOwner && (
          <TabsContent value="subscription">
            <SubscriptionPlans />
          </TabsContent>
        )}

        {/* Notification Settings Tab */}
        {canEdit && (
          <TabsContent value="notifications">
            <NotificationSettings restaurantId={selectedRestaurant.restaurant_id} />
          </TabsContent>
        )}

        {/* Security Settings Tab */}
        <TabsContent value="security">
          <SecuritySettings />
        </TabsContent>
      </Tabs>
    </div>
  );
}
